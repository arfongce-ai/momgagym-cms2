// expiry_extension_e2e.test.js
// ════════════════════════════════════════════════════════════════════════
//  배경: 세션 유효기간 연장을 "자동"이 아닌 "관리자 수동 등록"으로 전환한 기능
//  (store.registerExpiryExtension / cancelExpiryExtension, services/sessionExpiry.js의
//  extension 반영)의 종단 테스트. expiry_settlement_e2e.test.js와 동일하게 실제
//  store(demoData.js)를 통해 "등록 → 만료 감지 → 연장 등록 → 만료 상태 해제 →
//  (필요 시) 연장 취소 → 원상 복구"까지 실제 앱이 쓰는 함수들을 그대로 이어 붙여
//  검증한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDaysYMD } from '../utils/dates';
import { buildMemberSessionExpiry, suggestedExtensionDays } from '../services/sessionExpiry';

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

describe('종단 검증 — 연장 수동 등록 전체 파이프라인 (실제 store 사용)', () => {
  it('만료된 등록분을 연장 등록하면 만료일이 밀리고 더 이상 expired가 아니며, 잔여는 그대로다', async () => {
    const settings = store.getSettings();
    const trainer = await store.addTrainer({ name: '박트레이너', color: '#f59e0b' });
    const member = await store.addMember({ name: '김회원', trainerSessions: {} });

    // 100일 전 10회 등록(90일 유효기간이므로 이미 지남). 6회 소진 → 잔여 4.
    const orderDate = addDaysYMD(-100);
    const payment = await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 600000, method: 'cash', paidAt: orderDate, trainerIds: [trainer.id], sessionAdds: [{ trainerId: trainer.id, count: 10 }] },
      { trainerSessions: { [trainer.id]: { total: 10, remaining: 4 } } },
    );

    let freshMember = store.getMembers().find(m => m.id === member.id);
    let freshPayments = store.getPayments(member.id);
    let lots = buildMemberSessionExpiry({ member: freshMember, payments: freshPayments, settings });
    let lot = lots[trainer.id][0];
    expect(lot.status).toBe('expired');
    expect(lot.remaining).toBe(4);

    // 연장 등록 — MemberDetail.jsx의 handleRegisterExtension이 실제로 호출하는 것과 동일한 경로.
    const suggested = suggestedExtensionDays(lot, settings);
    expect(suggested).toBe(90); // 10회 lot → 기본 제안 90일
    const result = await store.registerExpiryExtension(member.id, {
      trainerId: trainer.id, lotId: lot.id, paymentId: lot.paymentId, legacy: !!lot.legacy, days: suggested,
    });
    expect(result).toBeTruthy();
    expect(result.record.days).toBe(90);

    // 재조회 — 잔여는 그대로(연장은 정산이 아니므로 세션을 소모하지 않음), 상태는 더 이상 expired 아님.
    freshMember = store.getMembers().find(m => m.id === member.id);
    freshPayments = store.getPayments(member.id);
    expect(freshMember.trainerSessions[trainer.id].remaining).toBe(4); // 손대지 않음
    expect(freshPayments.find(p => p.id === payment.id).expiryExtensions[lot.id].days).toBe(90);
    lots = buildMemberSessionExpiry({ member: freshMember, payments: freshPayments, settings });
    const extendedLot = lots[trainer.id][0];
    expect(extendedLot.status).not.toBe('expired');
    expect(extendedLot.expiresAt).toBe(addDaysYMD(90, lot.expiresAt)); // 원래 만료일 + 90일
  });

  it('이미 연장 등록된 lot에 다시 등록을 시도하면 null을 반환하고 중복 등록되지 않는다', async () => {
    const settings = store.getSettings();
    const trainer = await store.addTrainer({ name: '이트레이너', color: '#22c55e' });
    const member = await store.addMember({ name: '최회원', trainerSessions: {} });
    await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 500000, method: 'cash', paidAt: addDaysYMD(-100), trainerIds: [trainer.id], sessionAdds: [{ trainerId: trainer.id, count: 10 }] },
      { trainerSessions: { [trainer.id]: { total: 10, remaining: 5 } } },
    );
    const lots = buildMemberSessionExpiry({
      member: store.getMembers().find(m => m.id === member.id),
      payments: store.getPayments(member.id), settings,
    });
    const lot = lots[trainer.id][0];
    const params = { trainerId: trainer.id, lotId: lot.id, paymentId: lot.paymentId, legacy: false, days: 90 };

    const first = await store.registerExpiryExtension(member.id, params);
    const second = await store.registerExpiryExtension(member.id, { ...params, days: 30 }); // 다른 값으로도 재시도
    expect(first).toBeTruthy();
    expect(second).toBeNull();

    const finalPayments = store.getPayments(member.id);
    expect(finalPayments.find(p => p.id === lot.paymentId).expiryExtensions[lot.id].days).toBe(90); // 최초값 유지
  });

  it('연장 등록을 취소하면 원래(연장 전) 유효기간·상태로 정확히 되돌아간다', async () => {
    const settings = store.getSettings();
    const trainer = await store.addTrainer({ name: '한트레이너', color: '#a855f7' });
    const member = await store.addMember({ name: '오회원', trainerSessions: {} });
    await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 600000, method: 'cash', paidAt: addDaysYMD(-100), trainerIds: [trainer.id], sessionAdds: [{ trainerId: trainer.id, count: 10 }] },
      { trainerSessions: { [trainer.id]: { total: 10, remaining: 4 } } },
    );
    const originalLots = buildMemberSessionExpiry({
      member: store.getMembers().find(m => m.id === member.id),
      payments: store.getPayments(member.id), settings,
    });
    const originalLot = originalLots[trainer.id][0];
    const originalExpiresAt = originalLot.expiresAt;
    expect(originalLot.status).toBe('expired');

    await store.registerExpiryExtension(member.id, {
      trainerId: trainer.id, lotId: originalLot.id, paymentId: originalLot.paymentId, legacy: false, days: 90,
    });
    const midLots = buildMemberSessionExpiry({
      member: store.getMembers().find(m => m.id === member.id),
      payments: store.getPayments(member.id), settings,
    });
    expect(midLots[trainer.id][0].status).not.toBe('expired');

    const cancelResult = await store.cancelExpiryExtension(member.id, {
      trainerId: trainer.id, lotId: originalLot.id, paymentId: originalLot.paymentId, legacy: false,
    });
    expect(cancelResult).toBeTruthy();

    const finalLots = buildMemberSessionExpiry({
      member: store.getMembers().find(m => m.id === member.id),
      payments: store.getPayments(member.id), settings,
    });
    const finalLot = finalLots[trainer.id][0];
    expect(finalLot.expiresAt).toBe(originalExpiresAt); // 연장 전 만료일로 정확히 복귀
    expect(finalLot.status).toBe('expired');             // 상태도 원래대로
    expect(finalLot.extension).toBeNull();
  });

  it('연장 기록이 없는 lot을 취소하려 하면 null을 반환하고 아무것도 바뀌지 않는다', async () => {
    const trainer = await store.addTrainer({ name: '정트레이너', color: '#3b82f6' });
    const member = await store.addMember({ name: '장회원', trainerSessions: {} });
    await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 500000, method: 'cash', paidAt: addDaysYMD(-10), trainerIds: [trainer.id], sessionAdds: [{ trainerId: trainer.id, count: 10 }] },
      { trainerSessions: { [trainer.id]: { total: 10, remaining: 10 } } },
    );
    const lots = buildMemberSessionExpiry({
      member: store.getMembers().find(m => m.id === member.id),
      payments: store.getPayments(member.id), settings: store.getSettings(),
    });
    const lot = lots[trainer.id][0];
    const result = await store.cancelExpiryExtension(member.id, {
      trainerId: trainer.id, lotId: lot.id, paymentId: lot.paymentId, legacy: false,
    });
    expect(result).toBeNull();
  });

  it('legacy 등록분(sessionAdds 없는 구버전 결제)도 연장 등록·취소가 member.legacyExpiryExtensions로 동일하게 동작한다', async () => {
    const settings = store.getSettings();
    const trainer = await store.addTrainer({ name: '윤트레이너', color: '#ec4899' });
    // sessionAdds 없이 결제 등록 → legacy lot 생성.
    const member = await store.addMember({ name: '조회원', trainerSessions: { [trainer.id]: { total: 10, remaining: 6 } } });
    await store.addPaymentWithMemberUpdate(
      member.id,
      { amount: 600000, method: 'cash', paidAt: addDaysYMD(-100), trainerIds: [trainer.id] }, // sessionAdds 없음
      {},
    );
    const lots = buildMemberSessionExpiry({
      member: store.getMembers().find(m => m.id === member.id),
      payments: store.getPayments(member.id), settings,
    });
    const lot = lots[trainer.id][0];
    expect(lot.legacy).toBe(true);
    expect(lot.status).toBe('expired');

    const registerResult = await store.registerExpiryExtension(member.id, {
      trainerId: trainer.id, lotId: lot.id, paymentId: lot.paymentId, legacy: true, days: 90,
    });
    expect(registerResult).toBeTruthy();
    let finalMember = store.getMembers().find(m => m.id === member.id);
    expect(finalMember.legacyExpiryExtensions[trainer.id].days).toBe(90);
    let midLots = buildMemberSessionExpiry({ member: finalMember, payments: store.getPayments(member.id), settings });
    expect(midLots[trainer.id][0].status).not.toBe('expired');

    const cancelResult = await store.cancelExpiryExtension(member.id, {
      trainerId: trainer.id, lotId: lot.id, paymentId: lot.paymentId, legacy: true,
    });
    expect(cancelResult).toBeTruthy();
    finalMember = store.getMembers().find(m => m.id === member.id);
    expect(finalMember.legacyExpiryExtensions[trainer.id]).toBeUndefined();
    const finalLots = buildMemberSessionExpiry({ member: finalMember, payments: store.getPayments(member.id), settings });
    expect(finalLots[trainer.id][0].status).toBe('expired');
  });
});
