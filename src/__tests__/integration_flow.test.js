// ───────────────────────────────────────────────────────────────
// 통합 연동 검증: 회원관리(수납·세션) → 스케줄(출석·취소·노쇼) → 매출관리(정산)
// 실제 store 함수를 사용 순서대로 호출하며 단계별 상태와 정산 반영을 확인한다.
// firebase는 store.test.js와 동일하게 모킹한다.
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
const PAID = '2026-06-01';
const trainers = [
  { id: 't1', name: '트레이너1', color: '#f00' },
  { id: 't2', name: '트레이너2', color: '#0f0' },
];
const settings = () => store.getSettings();

function remainingOf(mid, tid) {
  return store.getMembers().find(m => m.id === mid).trainerSessions[tid].remaining;
}
function totalOf(mid, tid) {
  return store.getMembers().find(m => m.id === mid).trainerSessions[tid].total;
}
// 특정 회원·트레이너의 정산 월 수업횟수(cnt)와 수업료
function settleRow(mid, tid) {
  const members = store.getMembers();
  const schedules = store.getSchedules();
  const payments = {}; members.forEach(m => payments[m.id] = store.getPayments(m.id));
  const blocks = computeSessionSettlement({
    trainers, members, schedules, payments,
    records: store.getPromos(), settings: settings(), ym: YM,
    getOverride: (t, y) => store.getSettleOverride(t, y),
  });
  const b = blocks.find(x => x.trainer.id === tid);
  const row = b?.rows?.find(r => r.memberId === mid);
  return { cnt: row?.cnt ?? 0, unit: row?.unit ?? 0, sessionTotal: b?.sessionTotal ?? 0, payout: b?.payout ?? 0 };
}

// 수납 1건을 etc 결제로 적립(세션 추가 포함) — MemberDetail의 저장 로직과 동형
async function payAndAddSessions(mid, { amount, method = '현금', trainerId, count, splitRate = 50, paidAt = PAID, isReEnroll = false }) {
  const fresh = store.getMembers().find(m => m.id === mid);
  const ts = JSON.parse(JSON.stringify(fresh.trainerSessions || {}));
  if (ts[trainerId]) { ts[trainerId].total += count; ts[trainerId].remaining += count; }
  else ts[trainerId] = { total: count, remaining: count };
  const newPayment = {
    amount, method, paidAt, trainerIds: [trainerId],
    sessionAdds: [{ trainerId, count, classType: '선수' }],
    splitRateAtPay: { [trainerId]: splitRate },
    isReEnroll,
  };
  await store.addPaymentWithMemberUpdate(mid, newPayment, {
    lastPaymentDate: paidAt, trainerSessions: ts,
  });
}

async function book(mid, tid, date = '2026-06-15') {
  return store.createScheduleWithDeduction({
    memberId: mid, memberName: 'X', trainerId: tid,
    date, startTime: '10:00', endTime: '11:00', classType: '선수',
    status: 'scheduled', isExternal: false,
  });
}

beforeEach(() => { FAIL = false; });

describe('통합: 수납 → 세션 → 예약 → 처리 → 정산 (단일 트레이너)', () => {
  it('전 과정이 단계별로 정확히 연동된다', async () => {
    // 1) 회원 등록 (세션 0)
    const m = await store.addMember({ name: '연동회원', trainerSessions: {}, isActive: true });
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions).toEqual({});

    // 2) 수납: 540,000 현금, t1에 10회 적립
    await payAndAddSessions(m.id, { amount: 540000, trainerId: 't1', count: 10, splitRate: 50 });
    expect(totalOf(m.id, 't1')).toBe(10);
    expect(remainingOf(m.id, 't1')).toBe(10);
    // 결제가 회원에 기록됨
    expect(store.getPayments(m.id).length).toBe(1);
    // 아직 출석 0 → 정산 수업횟수 0
    expect(settleRow(m.id, 't1').cnt).toBe(0);

    // 3) 예약 2건 → 세션 2 차감 (10 → 8)
    const s1 = await book(m.id, 't1');
    const s2 = await book(m.id, 't1');
    expect(remainingOf(m.id, 't1')).toBe(8);
    // 예약만 한 상태(미확정)는 정산 미인정
    expect(settleRow(m.id, 't1').cnt).toBe(0);

    // 4) s1 출석 처리 → 차감 유지(8), 정산 1회 인정
    await store.finalizeSchedule(s1.id, 'attended');
    expect(remainingOf(m.id, 't1')).toBe(8);
    expect(settleRow(m.id, 't1').cnt).toBe(1);

    // 5) s2 취소 처리 → 세션 복원(8 → 9), 정산 미인정(여전히 1회)
    await store.finalizeSchedule(s2.id, 'canceled');
    expect(remainingOf(m.id, 't1')).toBe(9);
    expect(settleRow(m.id, 't1').cnt).toBe(1);

    // 6) 새 예약 후 노쇼 → 차감 유지(9 → 8), 정산 2회 인정
    const s3 = await book(m.id, 't1');
    expect(remainingOf(m.id, 't1')).toBe(8);
    await store.finalizeSchedule(s3.id, 'noshow');
    expect(remainingOf(m.id, 't1')).toBe(8);
    expect(settleRow(m.id, 't1').cnt).toBe(2);

    // 7) 정산 수업료 = 단가 × 2회, payout > 0
    const r = settleRow(m.id, 't1');
    expect(r.unit).toBeGreaterThan(0);
    expect(r.sessionTotal).toBe(r.unit * 2);
    expect(r.payout).toBeGreaterThan(0);
  });
});

describe('통합: 재등록(추가 수납)이 세션·정산에 누적된다', () => {
  it('재등록하면 총/잔여가 늘고, 이후 출석이 정산에 반영된다', async () => {
    const m = await store.addMember({ name: '재등록회원', trainerSessions: {}, isActive: true });
    await payAndAddSessions(m.id, { amount: 540000, trainerId: 't1', count: 10 });
    // 8회 소진(예약+출석)
    for (let i = 0; i < 3; i++) {
      const s = await book(m.id, 't1');
      await store.finalizeSchedule(s.id, 'attended');
    }
    expect(remainingOf(m.id, 't1')).toBe(7);
    expect(settleRow(m.id, 't1').cnt).toBe(3);

    // 재등록 +10
    await payAndAddSessions(m.id, { amount: 500000, trainerId: 't1', count: 10, isReEnroll: true, paidAt: PAID });
    expect(totalOf(m.id, 't1')).toBe(20);
    expect(remainingOf(m.id, 't1')).toBe(17);
    expect(store.getPayments(m.id).length).toBe(2);
  });
});

describe('통합: 두 트레이너 공동 담당 — 정산이 트레이너별로 분리된다', () => {
  it('각 트레이너는 자기 담당 출석분만 정산에 잡힌다', async () => {
    const m = await store.addMember({ name: '공동회원', trainerSessions: {}, isActive: true });
    await payAndAddSessions(m.id, { amount: 540000, trainerId: 't1', count: 10, splitRate: 50 });
    await payAndAddSessions(m.id, { amount: 480000, trainerId: 't2', count: 10, splitRate: 50 });

    // t1 출석 2회, t2 출석 1회
    for (let i = 0; i < 2; i++) { const s = await book(m.id, 't1'); await store.finalizeSchedule(s.id, 'attended'); }
    const s = await book(m.id, 't2'); await store.finalizeSchedule(s.id, 'attended');

    expect(settleRow(m.id, 't1').cnt).toBe(2);
    expect(settleRow(m.id, 't2').cnt).toBe(1);
    expect(remainingOf(m.id, 't1')).toBe(8);
    expect(remainingOf(m.id, 't2')).toBe(9);
  });
});

describe('통합: 원자성 — 결제 저장 실패 시 세션도 안 늘어난다', () => {
  it('수납 batch 실패하면 결제·세션 모두 롤백', async () => {
    const m = await store.addMember({ name: '실패회원', trainerSessions: { t1: { total: 5, remaining: 5 } }, isActive: true });
    FAIL = true;
    await expect(
      payAndAddSessions(m.id, { amount: 100000, trainerId: 't1', count: 10 })
    ).rejects.toThrow();
    FAIL = false;
    expect(totalOf(m.id, 't1')).toBe(5);     // 안 늘어남
    expect(remainingOf(m.id, 't1')).toBe(5);
    expect(store.getPayments(m.id).length).toBe(0);
  });
});
