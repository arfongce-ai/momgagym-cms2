// ───────────────────────────────────────────────────────────────
// 회원 이전 시나리오 검증:
//  1-1) 신규등록 → 결제·세션·스케줄·정산
//  1-2) (신규 후) 재등록 → 결제·세션·스케줄·정산
//  1-3) 신규등록 없이 곧바로 재등록 → 결제·세션·스케줄·정산
// 핵심: isNew/isReEnroll 여부와 무관하게 세션·차감·출석정산이 어긋나지 않는다.
// ───────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

let FAIL = false;
const mem = {};
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: (_db, name, id) => ({ name, id }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async (ref, data) => { if (FAIL) throw new Error('denied'); (mem[ref.name] ||= {})[ref.id] = data; },
  deleteDoc: async (ref) => { if (FAIL) throw new Error('denied'); if (mem[ref.name]) delete mem[ref.name][ref.id]; },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(['set', ref, data]),
      delete: (ref) => ops.push(['del', ref]),
      commit: async () => {
        if (FAIL) throw new Error('batch denied');
        for (const [t, ref, data] of ops) {
          if (t === 'set') (mem[ref.name] ||= {})[ref.id] = data;
          else if (mem[ref.name]) delete mem[ref.name][ref.id];
        }
      },
    };
  },
}));

import { store } from '../demoData';
import { computeSessionSettlement } from '../services/finance';

const YM = '2026-06';
const PAID = '2026-06-02';
const trainers = [{ id: 't1', name: '트레이너1', color: '#f00' }];

const M = (mid) => store.getMembers().find(m => m.id === mid);
const remain = (mid) => M(mid).trainerSessions?.t1?.remaining;
const total  = (mid) => M(mid).trainerSessions?.t1?.total;

function settle(mid) {
  const members = store.getMembers();
  const schedules = store.getSchedules();
  const payments = {}; members.forEach(m => payments[m.id] = store.getPayments(m.id));
  const blocks = computeSessionSettlement({
    trainers, members, schedules, payments,
    records: store.getPromos(), settings: store.getSettings(), ym: YM,
    getOverride: (t, y) => store.getSettleOverride(t, y),
  });
  const b = blocks.find(x => x.trainer.id === 't1');
  const row = b?.rows?.find(r => r.memberId === mid);
  return { cnt: row?.cnt ?? 0, reSales: b?.reEnrollSales ?? 0, reInc: b?.reInc ?? 0, payout: b?.payout ?? 0, rate: b?.splitRate };
}

// 결제 + 세션 적립 (MemberDetail 저장 로직과 동형)
async function pay(mid, { amount, count, isNew = false, isReEnroll = false, paidAt = PAID }) {
  const fresh = M(mid);
  const ts = JSON.parse(JSON.stringify(fresh.trainerSessions || {}));
  if (ts.t1) { ts.t1.total += count; ts.t1.remaining += count; }
  else ts.t1 = { total: count, remaining: count };
  const p = {
    amount, method: '현금', paidAt, trainerIds: ['t1'],
    sessionAdds: [{ trainerId: 't1', count, classType: '선수' }],
    splitRateAtPay: { t1: 50 },
    isNew, isReEnroll,
    consultTrainerId: isNew ? 't1' : '',
  };
  await store.addPaymentWithMemberUpdate(mid, p, { lastPaymentDate: paidAt, trainerSessions: ts });
}

async function bookAttend(mid, status = 'attended', date = '2026-06-15') {
  const s = await store.createScheduleWithDeduction({
    memberId: mid, memberName: 'X', trainerId: 't1',
    date, startTime: '10:00', endTime: '11:00', classType: '선수',
    status: 'scheduled', isExternal: false,
  });
  await store.finalizeSchedule(s.id, status);
  return s;
}

beforeEach(() => { FAIL = false; });

describe('1-1. 신규등록 → 결제·세션·스케줄·정산', () => {
  it('신규 회원이 결제·출석까지 정상 연동된다', async () => {
    const m = await store.addMember({ name: '신규A', trainerSessions: {}, isActive: true });
    await pay(m.id, { amount: 540000, count: 10, isNew: true });
    expect(total(m.id)).toBe(10);
    expect(remain(m.id)).toBe(10);
    await bookAttend(m.id, 'attended');
    await bookAttend(m.id, 'attended');
    expect(remain(m.id)).toBe(8);
    expect(settle(m.id).cnt).toBe(2);
    expect(settle(m.id).payout).toBeGreaterThan(0);
  });
});

describe('1-2. (신규 후) 재등록 → 결제·세션·스케줄·정산', () => {
  it('신규로 시작한 회원이 재등록하면 세션 누적·정산 반영', async () => {
    const m = await store.addMember({ name: '신규B', trainerSessions: {}, isActive: true });
    await pay(m.id, { amount: 540000, count: 10, isNew: true });
    await bookAttend(m.id, 'attended'); // 10→9, 정산 1
    // 재등록 (300만원 → 재등록 인센티브 3건)
    await pay(m.id, { amount: 3000000, count: 20, isReEnroll: true });
    expect(total(m.id)).toBe(30);      // 10 + 20
    expect(remain(m.id)).toBe(29);     // 9 + 20
    expect(store.getPayments(m.id).length).toBe(2);
    await bookAttend(m.id, 'attended'); // 29→28, 정산 2
    expect(remain(m.id)).toBe(28);
    const r = settle(m.id);
    expect(r.cnt).toBe(2);
    expect(r.reSales).toBeGreaterThanOrEqual(3000000); // 재등록 매출 반영
    expect(r.reInc).toBeGreaterThan(0);                // 재등록 인센티브 발생
  });
});

describe('1-3. 신규등록 없이 곧바로 재등록 → 결제·세션·스케줄·정산 (회원 이전 핵심)', () => {
  it('회원 등록 직후 isNew 없이 재등록만 해도 오류 없이 전 과정 연동', async () => {
    // 작년 신규였던 회원을 새 시스템에 "그냥 등록"만 하고(세션 0),
    // 바로 2~3번째 재등록을 isReEnroll로 진행하는 상황
    const m = await store.addMember({
      name: '이전C', trainerSessions: {}, isActive: true,
      memo: '작년 신규, 시스템 이전',
    });
    // 곧바로 재등록 (신규 결제 단계 건너뜀)
    await pay(m.id, { amount: 2000000, count: 20, isReEnroll: true });
    expect(total(m.id)).toBe(20);
    expect(remain(m.id)).toBe(20);
    expect(store.getPayments(m.id).length).toBe(1);

    // 스케줄·출석·취소·노쇼 모두 정상 작동
    await bookAttend(m.id, 'attended'); // 20→19, 정산 1
    await bookAttend(m.id, 'noshow');   // 19→18, 정산 2
    const sCancel = await store.createScheduleWithDeduction({
      memberId: m.id, memberName: 'X', trainerId: 't1', date: '2026-06-16',
      startTime: '10:00', endTime: '11:00', classType: '선수', status: 'scheduled', isExternal: false,
    });
    expect(remain(m.id)).toBe(17);      // 예약으로 차감
    await store.finalizeSchedule(sCancel.id, 'canceled');
    expect(remain(m.id)).toBe(18);      // 취소 복원

    const r = settle(m.id);
    expect(r.cnt).toBe(2);              // 출석+노쇼만 정산 (취소 제외)
    expect(r.reSales).toBeGreaterThanOrEqual(2000000);
    expect(r.payout).toBeGreaterThan(0);

    // 또 한 번 재등록(3번째) — 누적 정상
    await pay(m.id, { amount: 1500000, count: 10, isReEnroll: true });
    expect(total(m.id)).toBe(30);
    expect(remain(m.id)).toBe(28);
    expect(store.getPayments(m.id).length).toBe(2);
  });

  it('세션 0으로 등록한 직후 잔여 표시가 깨지지 않는다(undefined 안전)', async () => {
    const m = await store.addMember({ name: '이전D', trainerSessions: {}, isActive: true });
    // 잔여 조회가 안전해야 함(스케줄 화면 등에서 0회로 표시)
    const r = M(m.id).trainerSessions?.t1?.remaining ?? 0;
    expect(r).toBe(0);
    // 곧바로 재등록
    await pay(m.id, { amount: 500000, count: 5, isReEnroll: true });
    expect(remain(m.id)).toBe(5);
  });
});

describe('교차 검증: isReEnroll 유무는 세션/차감/출석정산에 영향 없음', () => {
  it('동일 결제를 isReEnroll=true/false로 해도 세션·정산 cnt 동일', async () => {
    const a = await store.addMember({ name: 'flagT', trainerSessions: {}, isActive: true });
    const b = await store.addMember({ name: 'flagF', trainerSessions: {}, isActive: true });
    await pay(a.id, { amount: 600000, count: 10, isReEnroll: true });
    await pay(b.id, { amount: 600000, count: 10, isReEnroll: false });
    await bookAttend(a.id, 'attended');
    await bookAttend(b.id, 'attended');
    expect(remain(a.id)).toBe(remain(b.id)); // 둘 다 9
    expect(settle(a.id).cnt).toBe(settle(b.id).cnt); // 둘 다 1
    // 차이는 오직 결제의 재등록 플래그에만 — 세션/차감/출석정산은 동일
    expect(store.getPayments(a.id)[0].isReEnroll).toBe(true);
    expect(store.getPayments(b.id)[0].isReEnroll).toBe(false);
    expect(total(a.id)).toBe(total(b.id)); // 세션 적립 동일
  });
});
