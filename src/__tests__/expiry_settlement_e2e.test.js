// expiry_settlement_e2e.test.js
// ════════════════════════════════════════════════════════════════════════
//  단위 테스트(session_expiry.test.js, expiry_settlement.test.js)는 함수
//  하나하나가 옳은지 손으로 만든 fixture로 검증한다. 이 파일은 그와 달리
//  실제 store(demoData.js)를 통해 "등록 → 시간 경과 → 만료 감지 → 정산 처리
//  → 트레이너 월 지급액 반영"까지 실제 앱이 쓰는 함수들을 그대로 이어 붙여
//  전체 파이프라인이 진짜로 맞물려 돌아가는지 검증한다(회귀 방지용 종단 테스트).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDaysYMD, todayYMD } from '../utils/dates';
import { buildMemberSessionExpiry, computeExpirySettlement } from '../services/sessionExpiry';
import { computeSessionSettlementWithExpiry } from '../services/finance';

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

beforeEach(async () => {
  await initStore({ force: true });
});

describe('종단 검증 1 — 만료 정산 전체 파이프라인 (실제 store 사용)', () => {
  it('등록(과거 날짜) → 만료 감지 → 정산 처리 → 트레이너 이번 달 지급액 반영까지 실제로 이어진다', async () => {
    const settings = store.getSettings();
    const trainer = await store.addTrainer({ name: '박트레이너', color: '#f59e0b' });
    const member = await store.addMember({ name: '김회원', trainerSessions: {} });

    // 200일 전에 10회 등록(90일짜리 유효기간이므로 이미 지났어야 함). 6회 출석 소진 → 잔여 4.
    const orderDate = addDaysYMD(-200);
    const payment = await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 600000, method: 'cash', paidAt: orderDate, trainerIds: [trainer.id], sessionAdds: [{ trainerId: trainer.id, count: 10 }] },
      { trainerSessions: { [trainer.id]: { total: 10, remaining: 4 } } },
    );
    for (let i = 0; i < 6; i++) {
      await store.addSchedule({
        memberId: member.id, memberName: member.name, trainerId: trainer.id,
        date: addDaysYMD(-200 + i), startTime: '10:00', endTime: '11:00',
        status: 'attended', isExternal: false,
      });
    }

    // 1) 실제 store 데이터로 만료 여부를 판정 — Members.jsx/Home.jsx가 쓰는 것과 동일한 호출.
    let freshMember = store.getMembers().find(m => m.id === member.id);
    let freshPayments = store.getPayments(member.id);
    let lots = buildMemberSessionExpiry({ member: freshMember, payments: freshPayments, settings });
    let lot = lots[trainer.id][0];
    expect(lot.status).toBe('expired');
    expect(lot.remaining).toBe(4);
    expect(lot.paymentId).toBe(payment.id);

    // 2) 정산 처리 — MemberDetail.jsx의 handleExpirySettlement가 실제로 호출하는 것과 동일한 경로.
    const est = computeExpirySettlement(lot, settings);
    expect(est.sessions).toBe(4);
    const result = await store.processExpirySettlement(member.id, {
      trainerId: trainer.id, lotId: lot.id, paymentId: lot.paymentId, legacy: !!lot.legacy,
      remaining: lot.remaining, sessions: est.sessions, unit: est.unit, rate: est.rate, amount: est.amount,
    });
    expect(result).toBeTruthy();

    // 3) 재조회 — 잔여는 0, 결제 문서엔 정산 기록, 상태는 더 이상 expired가 아님(중복 정산 방지 확인).
    freshMember = store.getMembers().find(m => m.id === member.id);
    freshPayments = store.getPayments(member.id);
    expect(freshMember.trainerSessions[trainer.id].remaining).toBe(0);
    expect(freshPayments.find(p => p.id === payment.id).expirySettlements[lot.id].amount).toBe(est.amount);
    lots = buildMemberSessionExpiry({ member: freshMember, payments: freshPayments, settings });
    expect(lots[trainer.id][0].status).not.toBe('expired');

    // 4) 트레이너 이번 달(정산 처리월) 지급액에 실제로 합산되는지 — Revenue.jsx SettleTab이 쓰는 것과 동일한 함수.
    const ym = todayYMD().slice(0, 7);
    const paymentsGrouped = { [member.id]: freshPayments };
    const blocks = computeSessionSettlementWithExpiry({
      trainers: store.getTrainers(), members: store.getMembers(), schedules: store.getSchedules(),
      payments: paymentsGrouped, records: [], settings, ym,
      getOverride: (tid, m) => store.getSettleOverride(tid, m),
    });
    const block = blocks.find(b => b.trainer.id === trainer.id);
    expect(block).toBeTruthy();
    expect(block.expirySettlement.total).toBe(est.amount);
    expect(block.expirySettlement.items[0].memberName).toBe('김회원');
    expect(block.payout).toBeGreaterThanOrEqual(est.amount);
  });

  it('같은 등록분을 두 번 정산 처리해도(예: 두 화면에서 거의 동시에 클릭) 두 번 지급되지 않는다', async () => {
    const settings = store.getSettings();
    const trainer = await store.addTrainer({ name: '이트레이너', color: '#22c55e' });
    const member = await store.addMember({ name: '최회원', trainerSessions: {} });
    const orderDate = addDaysYMD(-300);
    const payment = await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 500000, method: 'cash', paidAt: orderDate, trainerIds: [trainer.id], sessionAdds: [{ trainerId: trainer.id, count: 10 }] },
      { trainerSessions: { [trainer.id]: { total: 10, remaining: 5 } } },
    );
    const lots = buildMemberSessionExpiry({
      member: store.getMembers().find(m => m.id === member.id),
      payments: store.getPayments(member.id), settings,
    });
    const lot = lots[trainer.id][0];
    const est = computeExpirySettlement(lot, settings);
    const params = { trainerId: trainer.id, lotId: lot.id, paymentId: payment.id, legacy: false, remaining: lot.remaining, sessions: est.sessions, unit: est.unit, rate: est.rate, amount: est.amount };

    const first = await store.processExpirySettlement(member.id, params);
    const second = await store.processExpirySettlement(member.id, params);
    expect(first).toBeTruthy();
    expect(second).toBeNull();

    const finalMember = store.getMembers().find(m => m.id === member.id);
    expect(finalMember.trainerSessions[trainer.id].remaining).toBe(0); // 5 - 5, 추가로 깎이지 않음
  });
});

describe('종단 검증 2 — 회원관리 일괄 처리(handleSettleExpiredSessions 로직 재현)', () => {
  it('한 회원이 트레이너 A(만료)·B(미만료)를 동시에 등록했으면, 일괄 처리는 A만 정산하고 B는 그대로 둔다', async () => {
    const settings = store.getSettings();
    const trainerA = await store.addTrainer({ name: '트레이너A', color: '#ef4444' });
    const trainerB = await store.addTrainer({ name: '트레이너B', color: '#3b82f6' });
    const member = await store.addMember({ name: '정회원', trainerSessions: {} });

    // A: 250일 전 등록(90일 유효기간 지남, 미소진 3회). B: 10일 전 등록(아직 안 지남, 미소진 5회).
    await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 300000, method: 'cash', paidAt: addDaysYMD(-250), trainerIds: [trainerA.id], sessionAdds: [{ trainerId: trainerA.id, count: 10 }] },
      { trainerSessions: { [trainerA.id]: { total: 10, remaining: 3 } } },
    );
    const afterA = store.getMembers().find(m => m.id === member.id);
    await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 500000, method: 'cash', paidAt: addDaysYMD(-10), trainerIds: [trainerB.id], sessionAdds: [{ trainerId: trainerB.id, count: 10 }] },
      { trainerSessions: { ...afterA.trainerSessions, [trainerB.id]: { total: 10, remaining: 5 } } },
    );

    // 사전 확인: A는 실제로 expired, B는 실제로 ok(또는 warning 아님)로 판정되는지.
    const preCheck = store.getMembers().find(m => m.id === member.id);
    const preLots = buildMemberSessionExpiry({ member: preCheck, payments: store.getPayments(member.id), settings });
    expect(preLots[trainerA.id][0].status).toBe('expired');
    expect(preLots[trainerB.id][0].status).toBe('ok');

    // Members.jsx의 handleSettleExpiredSessions와 동일한 알고리즘을 그대로 재현해 실행.
    const targets = [];
    store.getMembers().forEach(m => {
      const lotsByTrainer = buildMemberSessionExpiry({ member: m, payments: store.getPayments(m.id), settings });
      Object.values(lotsByTrainer).flat().forEach(lot => {
        if (lot.remaining > 0 && lot.status === 'expired') targets.push({ member: m, lot });
      });
    });
    for (const { member: m, lot } of targets) {
      const est = computeExpirySettlement(lot, settings);
      await store.processExpirySettlement(m.id, {
        trainerId: lot.trainerId, lotId: lot.id, paymentId: lot.paymentId, legacy: !!lot.legacy,
        remaining: lot.remaining, sessions: est.sessions, unit: est.unit, rate: est.rate, amount: est.amount,
      });
    }

    const finalMember = store.getMembers().find(m => m.id === member.id);
    expect(finalMember.trainerSessions[trainerA.id].remaining).toBe(0); // 만료분 정산됨
    expect(finalMember.trainerSessions[trainerB.id].remaining).toBe(5); // 미만료분은 손대지 않음
  });
});

describe('종단 검증 3 — 정상가(환불) 파이프라인 (실제 store 사용)', () => {
  it('정상가를 설정하면, 할인 등록된 회원의 환불 진행분이 실제 결제 단가가 아닌 정상가 기준으로 계산되고 실제로 처리된다', async () => {
    await store.updateSettings({ sessionRegularPrice: 60000 });
    const settings = store.getSettings();
    expect(settings.sessionRegularPrice).toBe(60000);

    const trainer = await store.addTrainer({ name: '한트레이너', color: '#a855f7' });
    // 10회를 400,000원(회당 40,000원)에 할인 등록 — 정상가(60,000원)보다 낮음.
    const member = await store.addMember({ name: '오회원', trainerSessions: { [trainer.id]: { total: 10, remaining: 7 } } });
    const payment = await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 400000, method: 'cash', paidAt: addDaysYMD(-10), trainerIds: [trainer.id] },
      {},
    );
    for (let i = 0; i < 3; i++) {
      await store.addSchedule({
        memberId: member.id, memberName: member.name, trainerId: trainer.id,
        date: addDaysYMD(-5 + i), startTime: '09:00', endTime: '10:00', status: 'attended', isExternal: false,
      });
    }

    const { autoRefundUsedAmount } = await import('../services/finance');
    const freshMember = store.getMembers().find(m => m.id === member.id);
    const freshSchedules = store.getSchedules();
    const suggested = autoRefundUsedAmount(payment, member.id, { members: [freshMember], schedules: freshSchedules, settings });
    expect(suggested).toBe(60000 * 3); // 정상가 기준 180,000 — 할인단가(40,000×3=120,000) 아님
    expect(suggested).not.toBe(40000 * 3);

    const result = await store.processRefund(member.id, payment.id, {
      isRefunded: true, refundedAt: todayYMD(), refundUsedAmount: suggested,
    });
    expect(result).toBeTruthy();
    const finalMember = store.getMembers().find(m => m.id === member.id);
    expect(finalMember.trainerSessions[trainer.id].remaining).toBe(0); // 환불 처리로 잔여 정리됨
  });
});
