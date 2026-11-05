// member_schedule_settlement_e2e.test.js
// ════════════════════════════════════════════════════════════════════════
//  회원관리(수납·재등록) ↔ 스케줄(회원 수업 차감) ↔ 매출관리(트레이너 월 정산)가
//  실제 store(demoData.js)를 거쳐 서로 맞는지 종단 검증한다(2026-10 정합성 점검).
//  · 수납 → 세션(총/잔여) → 예약 차감 → 출석/취소 → 월 정산 → 무결성 점검이 한 흐름으로 일치해야 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeSessionSettlement } from '../services/finance';
import { auditMemberIntegrity, auditPaymentConsistency } from '../services/integrityAudit';

vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async () => {},
  deleteDoc: async () => {},
  writeBatch: () => {
    const ops = [];
    return {
      set(ref, data) { ops.push({ type: 'set', ref, data }); },
      delete(ref) { ops.push({ type: 'delete', ref }); },
      async commit() { return ops; },
    };
  },
}));

const { store, initStore } = await import('../demoData.js');
const YM = '2026-10';

beforeEach(async () => { await initStore({ force: true }); });

// 회원 + 트레이너 + 1차(10회 100만원) 수납 + 재등록(10회 200만원, 회당 20만원) 수납을 MemberDetail과 같은 방식으로 만든다.
async function setup() {
  const trainer = await store.addTrainer({ name: '박트레이너', color: '#f59e0b' });
  const tid = trainer.id;
  const member = await store.addMember({ name: '김회원', trainerSessions: {} });
  await store.addPaymentWithMemberUpdate(member.id,
    { paidAt: '2026-08-01', amount: 1000000, method: 'cash', methods: [], split: [], trainerIds: [tid],
      sessionAdds: [{ trainerId: tid, count: 10 }], isNew: true, splitRateAtPay: { [tid]: 50 } },
    { trainerSessions: { [tid]: { total: 10, remaining: 10 } } });
  await store.addPaymentWithMemberUpdate(member.id,
    { paidAt: '2026-09-20', amount: 2000000, method: 'cash', methods: [], split: [], trainerIds: [tid],
      sessionAdds: [{ trainerId: tid, count: 10 }], isReEnroll: true, reEnrollNo: 1, splitRateAtPay: { [tid]: 50 } },
    { trainerSessions: { [tid]: { total: 20, remaining: 20 } } });
  return { tid, mid: member.id, trainer };
}

const book = (mid, tid, day) => store.createScheduleWithDeduction({
  memberId: mid, memberName: '김회원', trainerId: tid, trainerName: '박트레이너',
  date: `2026-10-${String(day).padStart(2, '0')}`, startTime: '10:00', endTime: '11:00',
  classType: 'PT', status: 'scheduled', sessionDeducted: false, isExternal: false,
});
const slot = (mid, tid) => store.getMembers().find(m => m.id === mid).trainerSessions[tid];
const settle = (tid) => {
  const blocks = computeSessionSettlement({
    trainers: store.getTrainers(), members: store.getMembers(), schedules: store.getSchedules(),
    payments: Object.fromEntries(store.getMembers().map(m => [m.id, store.getPayments(m.id)])),
    records: [], settings: store.getSettings(), ym: YM, getOverride: () => null,
  });
  return blocks.find(b => b.trainer.id === tid)?.rows[0];
};
const audit = () => {
  const members = store.getMembers(), trainers = store.getTrainers(), schedules = store.getSchedules();
  const payments = Object.fromEntries(members.map(m => [m.id, store.getPayments(m.id)]));
  return [...auditMemberIntegrity({ members, trainers, schedules, payments }),
          ...auditPaymentConsistency({ members, trainers, schedules, payments })];
};

describe('수납 ↔ 스케줄 ↔ 정산 종단 일치', () => {
  it('예약 4건(차감) → 출석 3 + 취소 1: 잔여·정산 횟수·금액·무결성 점검이 모두 일치', async () => {
    const { tid, mid } = await setup();
    const made = [];
    for (let d = 5; d <= 8; d++) made.push(await book(mid, tid, d));
    expect(slot(mid, tid).remaining).toBe(16);               // 예약 시점에 4회 차감
    for (const s of made.slice(0, 3)) await store.finalizeSchedule(s.id, 'attended');
    await store.finalizeSchedule(made[3].id, 'canceled');    // 취소는 잔여 복원
    expect(slot(mid, tid)).toEqual({ total: 20, remaining: 17 });

    const row = settle(tid);
    expect(row.cnt).toBe(3);                                  // 정산 횟수 = 출석 3
    expect(row.regTotal - row.remaining).toBe(row.cnt);       // 회원 소진(총−잔여) = 정산 횟수
    expect(row.autoUnit).toBe(100000);                        // 1차분(100만원/10회) 단가로 소진 중
    expect(row.amount).toBe(300000);
    expect(row.payAmount).toBe(150000);                       // 50%
    expect(audit()).toEqual([]);                              // 수납·세션·스케줄 정합성 이상 없음
  });

  it('1차분을 다 쓰고 재등록분으로 넘어가면 회차별로 단가가 갈린다 (10회@10만 + 2회@20만)', async () => {
    const { tid, mid } = await setup();
    for (let d = 1; d <= 12; d++) { const s = await book(mid, tid, d); await store.finalizeSchedule(s.id, 'attended'); }
    expect(slot(mid, tid).remaining).toBe(8);
    const row = settle(tid);
    expect(row.cnt).toBe(12);
    expect(row.amount).toBe(10 * 100000 + 2 * 200000);        // 1,400,000
    expect(row.settlementBreakdown.map(x => x.count).sort((a, b) => a - b)).toEqual([2, 10]);
    expect(audit()).toEqual([]);
  });

  it('재등록 결제를 환불해 잔여가 0이 돼도 이번 달 정산 횟수·금액은 그대로', async () => {
    const { tid, mid } = await setup();
    for (let d = 1; d <= 12; d++) { const s = await book(mid, tid, d); await store.finalizeSchedule(s.id, 'attended'); }
    const reEnroll = store.getPayments(mid).find(p => p.isReEnroll);
    await store.processRefund(mid, reEnroll.id, { isRefunded: true, refundAmount: 0, refundedAt: '2026-10-25' });
    expect(slot(mid, tid).remaining).toBe(0);
    const row = settle(tid);
    expect(row.cnt).toBe(12);
    expect(row.amount).toBe(1400000);
  });

  it('예약 삭제는 차감을 복원하고, 정산·무결성에 흔적이 남지 않는다', async () => {
    const { tid, mid } = await setup();
    const s = await book(mid, tid, 9);
    expect(slot(mid, tid).remaining).toBe(19);
    await store.deleteScheduleWithRestore(s.id);
    expect(slot(mid, tid).remaining).toBe(20);
    expect(audit()).toEqual([]);
  });

  it('잔여 0일 때 잡은 예약은 재등록 후 출석 확정 시점에 차감된다(정산은 지급되는데 잔여가 그대로 남지 않는다)', async () => {
    const trainer = await store.addTrainer({ name: '이트레이너', color: '#10b981' });
    const tid = trainer.id;
    const member = await store.addMember({ name: '최회원', trainerSessions: {} });
    await store.addPaymentWithMemberUpdate(member.id,
      { paidAt: '2026-08-01', amount: 100000, method: 'cash', trainerIds: [tid], sessionAdds: [{ trainerId: tid, count: 1 }], splitRateAtPay: { [tid]: 50 } },
      { trainerSessions: { [tid]: { total: 1, remaining: 1 } } });
    const first = await book(member.id, tid, 2);
    await store.finalizeSchedule(first.id, 'attended');       // 잔여 0
    const over = await book(member.id, tid, 3);               // 잔여 0 → 차감 없이 예약만 저장
    expect(over.sessionDeducted).toBe(false);
    await store.addPaymentWithMemberUpdate(member.id,
      { paidAt: '2026-10-03', amount: 100000, method: 'cash', trainerIds: [tid], sessionAdds: [{ trainerId: tid, count: 1 }], isReEnroll: true, reEnrollNo: 1, splitRateAtPay: { [tid]: 50 } },
      { trainerSessions: { [tid]: { total: 2, remaining: 1 } } });
    await store.finalizeSchedule(over.id, 'attended');
    expect(slot(member.id, tid)).toEqual({ total: 2, remaining: 0 }); // 출석 확정 때 차감됨
  });
});
