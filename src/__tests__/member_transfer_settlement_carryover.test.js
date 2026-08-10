// member_transfer_settlement_carryover.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-10 신규] 회원↔회원 세션 양도 후, "매출관리 → 정산" 화면이 실제로
//  쓰는 계산 함수(computeSessionSettlement)가 새 결제(영수증) 없이도 넘어간
//  세션의 단가·정산비율을 정확히 반영하는지 end-to-end로 검증한다.
//  (store.test.js의 transferBasis 테스트는 "저장이 맞는지"만 보고, 여기서는
//  "그 저장값이 실제 정산 화면 계산 결과로 정확히 이어지는지"까지 본다.)
//
//  사용자 시나리오 그대로:
//   1. A회원이 A트레이너(t1)에게 50%로 정산되고 있었다.
//   2. B회원에게 양도하면서 B트레이너(t2)가 담당하게 된다.
//   3. 넘어간 횟수만큼 B트레이너 정산에도 같은 단가·50%가 자동으로 반영된다.
//   4. 영수증(결제 기록)은 새로 만들지 않는다.
//
//  store.test.js와 동일한 관례: firebase를 모킹해 실제 네트워크 없이 store를 씀.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeSessionSettlement } from '../services/finance.js';

// ── firebase 모킹(store.test.js와 동일) ──────────────────────────────────
let FAIL = false;
const mem = {};
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
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

const { store, initStore } = await import('../demoData.js');
beforeEach(async () => { FAIL = false; await initStore(); });

const YM = '2026-06';
const trainers = [{ id: 't1', name: '트레이너1', color: '#f00' }, { id: 't2', name: '트레이너2', color: '#0f0' }];
const settings = { withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8, lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, trainerSplitRates: {} };

function settleFor(tid, mid, members, payments, schedules) {
  const blocks = computeSessionSettlement({ trainers, members, schedules, payments, records: [], settings, ym: YM, getOverride: () => null });
  const block = blocks.find(b => b.trainer.id === tid);
  return { block, row: block?.rows?.find(r => r.memberId === mid) };
}

describe('회원↔회원 양도 → 정산 자동 반영 end-to-end (computeSessionSettlement)', () => {
  it('A(t1, 50%, 회당 10만원)에서 B(t2)로 4회 양도 후, B가 t2와 2회 출석하면 정산에 20만원·50%가 자동으로 잡힌다(새 결제 없이)', async () => {
    const a = await store.addMember({ name: 'E2E양도A1', trainerSessions: { t1: { total: 10, remaining: 10 } } });
    const b = await store.addMember({ name: 'E2E양도B1', trainerSessions: {} });
    await store.addPayment(a.id, {
      paidAt: '2026-05-01', amount: 1000000, method: 'cash',
      trainerIds: ['t1'], splitRateAtPay: { t1: 50 },
      sessionAdds: [{ trainerId: 't1', count: 10 }],
    });
    await store.transferSessions(a.id, { fromTid: 't1', toTid: 't2', count: 4, toMemberId: b.id });

    const freshB = store.getMembers().find(m => m.id === b.id);
    // B가 t2와 실제로 2회 출석(정산월 6월) — 매출관리 화면이 실제로 넘기는 것과 동일한 스케줄 형태.
    const schedules = [
      { id: 'e1', memberId: b.id, memberName: freshB.name, trainerId: 't2', date: '2026-06-10', startTime:'10:00', endTime:'11:00', status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true },
      { id: 'e2', memberId: b.id, memberName: freshB.name, trainerId: 't2', date: '2026-06-11', startTime:'10:00', endTime:'11:00', status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true },
    ];
    // B는 payments가 전혀 없다(요청사항 그대로 — 새 영수증 안 만듦).
    const { row } = settleFor('t2', b.id, [freshB], { [b.id]: [] }, schedules);

    expect(row).toBeTruthy();
    expect(row.autoUnit).toBeCloseTo(100000, 0);   // A가 내던 회당 단가 그대로
    expect(row.cnt).toBe(2);
    expect(row.amount).toBeCloseTo(200000, 0);     // 100,000 × 2회
    expect(row.rate).toBe(50);                     // A의 50% 그대로 이어짐
    expect(row.payAmount).toBeCloseTo(100000, 0);  // 200,000 × 50%
  });

  it('양도 안 하면(비교군) B의 정산은 0원이다 — transferBasis가 실제로 0원 문제를 해결했음을 대조 확인', async () => {
    const b = await store.addMember({ name: 'E2E양도B2', trainerSessions: { t2: { total: 4, remaining: 4 } } }); // 결제 없이 그냥 세션만 있는 회원(양도 없이 수기 입력된 경우 가정)
    const schedules = [
      { id: 'e3', memberId: b.id, memberName: b.name, trainerId: 't2', date: '2026-06-10', startTime:'10:00', endTime:'11:00', status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true },
    ];
    const { row } = settleFor('t2', b.id, [b], { [b.id]: [] }, schedules);
    expect(row.autoUnit).toBe(0);
    expect(row.amount).toBe(0);
    expect(row.payAmount).toBe(0);
  });

  it('트레이너 고정(같은 트레이너, 회원만 이동)으로 양도해도 정산비율·단가가 새 회원에게 그대로 반영된다', async () => {
    const a = await store.addMember({ name: 'E2E양도A3', trainerSessions: { t1: { total: 5, remaining: 5 } } });
    const b = await store.addMember({ name: 'E2E양도B3', trainerSessions: {} });
    await store.addPayment(a.id, {
      paidAt: '2026-05-01', amount: 300000, method: 'cash',
      trainerIds: ['t1'], splitRateAtPay: { t1: 60 },
      sessionAdds: [{ trainerId: 't1', count: 5 }],
    });
    // 트레이너 고정: fromTid===toTid('t1'), 회원만 A→B로 이동.
    await store.transferSessions(a.id, { fromTid: 't1', toTid: 't1', count: 3, toMemberId: b.id });
    const freshB = store.getMembers().find(m => m.id === b.id);
    const schedules = [
      { id: 'e4', memberId: b.id, memberName: freshB.name, trainerId: 't1', date: '2026-06-05', startTime:'10:00', endTime:'11:00', status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true },
    ];
    const { row } = settleFor('t1', b.id, [freshB], { [b.id]: [] }, schedules);
    expect(row.autoUnit).toBeCloseTo(60000, 0); // 300,000 ÷ 5회
    expect(row.rate).toBe(60);
    expect(row.payAmount).toBeCloseTo(36000, 0); // 60,000 × 60%
  });

  it('원래 회원(A) 쪽 정산은 양도 후에도 그대로 정상 계산된다(A 결제 기록을 안 건드렸으므로)', async () => {
    const a = await store.addMember({ name: 'E2E양도A4', trainerSessions: { t1: { total: 10, remaining: 10 } } });
    const b = await store.addMember({ name: 'E2E양도B4', trainerSessions: {} });
    await store.addPayment(a.id, {
      paidAt: '2026-05-01', amount: 1000000, method: 'cash',
      trainerIds: ['t1'], splitRateAtPay: { t1: 50 },
      sessionAdds: [{ trainerId: 't1', count: 10 }],
    });
    await store.transferSessions(a.id, { fromTid: 't1', toTid: 't2', count: 4, toMemberId: b.id });
    const freshA = store.getMembers().find(m => m.id === a.id);
    const paysA = store.getPayments(a.id);
    const schedules = [
      { id: 'e5', memberId: a.id, memberName: freshA.name, trainerId: 't1', date: '2026-06-10', startTime:'10:00', endTime:'11:00', status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true },
    ];
    const { row } = settleFor('t1', a.id, [freshA], { [a.id]: paysA }, schedules);
    expect(row.autoUnit).toBeCloseTo(100000, 0); // A 자신의 단가 — 양도로 안 바뀜
    expect(row.rate).toBe(50);
  });
});
