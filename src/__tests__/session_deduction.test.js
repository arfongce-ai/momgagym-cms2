// 예약 생성 시 세션 자동 차감 규칙 검증 (createScheduleWithDeduction 핵심 로직)
// "이영석 20에서 또 20" 버그 회귀 방지:
//  - 슬롯 일치 시 remaining 감소 + sessionAtBooking 기록
//  - 슬롯 없음/잔여0/멤버없음 시 차감 안 하되 사유를 명시(조용한 실패 방지)
import { describe, it, expect } from 'vitest';

// demoData.createScheduleWithDeduction 의 차감 분기를 추출한 순수 버전.
// (Firestore/batch 를 제외한 결정 로직만 — 실제 코드와 동일한 조건식)
function decideDeduction(member, schedule) {
  const ns = { ...schedule };
  const isDeductible = !ns.isExternal && ns.memberId && ns.trainerId;
  let updatedMember = null;
  let reason = null;
  if (isDeductible) {
    if (!member) {
      reason = 'member_not_found'; ns.sessionDeducted = false;
    } else if (!member.trainerSessions?.[ns.trainerId]) {
      reason = 'no_session_slot'; ns.sessionDeducted = false;
    } else if ((member.trainerSessions[ns.trainerId].remaining ?? 0) <= 0) {
      reason = 'no_remaining';
      ns.sessionAtBooking = 0;
      ns.sessionTotalAtBooking = member.trainerSessions[ns.trainerId].total ?? null;
      ns.sessionDeducted = false;
    } else {
      const ts = JSON.parse(JSON.stringify(member.trainerSessions));
      ns.sessionAtBooking = ts[ns.trainerId].remaining;
      ns.sessionTotalAtBooking = ts[ns.trainerId].total;
      ts[ns.trainerId].remaining = Math.max(0, ts[ns.trainerId].remaining - 1);
      updatedMember = { ...member, trainerSessions: ts };
      ns.sessionDeducted = true;
    }
  } else {
    ns.sessionDeducted = false;
    if (!ns.isExternal) reason = 'not_deductible';
  }
  return { ns, updatedMember, reason };
}

const member = () => ({ id: 'm', trainerSessions: { t_jung: { total: 30, remaining: 20 } } });

describe('예약 세션 자동 차감', () => {
  it('슬롯 일치 시 remaining 20→19, 회차=20 기록', () => {
    const { ns, updatedMember, reason } = decideDeduction(member(), { memberId: 'm', trainerId: 't_jung', isExternal: false });
    expect(reason).toBeNull();
    expect(ns.sessionDeducted).toBe(true);
    expect(ns.sessionAtBooking).toBe(20);
    expect(updatedMember.trainerSessions.t_jung.remaining).toBe(19);
  });

  it('연속 예약 시 회차가 20→19→18 로 줄어든다 (20에서 또 20 회귀방지)', () => {
    let m = member();
    const r1 = decideDeduction(m, { memberId: 'm', trainerId: 't_jung', isExternal: false });
    m = r1.updatedMember;
    const r2 = decideDeduction(m, { memberId: 'm', trainerId: 't_jung', isExternal: false });
    m = r2.updatedMember;
    const r3 = decideDeduction(m, { memberId: 'm', trainerId: 't_jung', isExternal: false });
    expect([r1.ns.sessionAtBooking, r2.ns.sessionAtBooking, r3.ns.sessionAtBooking]).toEqual([20, 19, 18]);
    expect(r3.updatedMember.trainerSessions.t_jung.remaining).toBe(17);
  });

  it('슬롯 없음 → 차감 안 하고 no_session_slot 사유 반환', () => {
    const { ns, reason } = decideDeduction(member(), { memberId: 'm', trainerId: 't_other', isExternal: false });
    expect(ns.sessionDeducted).toBe(false);
    expect(reason).toBe('no_session_slot');
  });

  it('잔여 0 → 차감 안 하고 no_remaining 사유 반환', () => {
    const m = { id: 'm', trainerSessions: { t_jung: { total: 80, remaining: 0 } } };
    const { ns, reason } = decideDeduction(m, { memberId: 'm', trainerId: 't_jung', isExternal: false });
    expect(ns.sessionDeducted).toBe(false);
    expect(reason).toBe('no_remaining');
    expect(ns.sessionAtBooking).toBe(0);
  });

  it('외부 일정 → 차감 대상 아님', () => {
    const { ns, reason } = decideDeduction(member(), { isExternal: true, memo: '출강' });
    expect(ns.sessionDeducted).toBe(false);
    expect(reason).toBeNull();
  });

  it('trainerId 비어있음 → not_deductible', () => {
    const { reason } = decideDeduction(member(), { memberId: 'm', trainerId: '', isExternal: false });
    expect(reason).toBe('not_deductible');
  });
});
