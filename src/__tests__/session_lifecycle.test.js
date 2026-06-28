// 세션 차감 ↔ 복원의 상태전이 일관성 검증
// 예약(차감) → 출석/노쇼/취소 → 삭제 의 전 경로에서 잔여 회차가 정확히 유지되는지.
import { describe, it, expect } from 'vitest';

// store 의 차감/복원 결정 로직을 추출한 순수 모델 (실제 코드와 동일한 조건식)
function createWithDeduction(member, sched) {
  const ns = { ...sched };
  const isDeductible = !ns.isExternal && ns.memberId && ns.trainerId;
  let m = member;
  if (isDeductible && member?.trainerSessions?.[ns.trainerId] && member.trainerSessions[ns.trainerId].remaining > 0) {
    const ts = clone(member.trainerSessions);
    ns.sessionAtBooking = ts[ns.trainerId].remaining;
    ts[ns.trainerId].remaining -= 1;
    ns.sessionDeducted = true;
    m = { ...member, trainerSessions: ts };
  } else {
    ns.sessionDeducted = false;
  }
  return { ns, member: m };
}

function finalize(member, sched, status) {
  const s = { ...sched, status, statusFinalized: true };
  let m = member;
  if (!s.isExternal && s.memberId && member) {
    if (status === 'canceled' && s.sessionDeducted) {
      const ts = clone(member.trainerSessions);
      if (ts[s.trainerId]) {
        const cap = ts[s.trainerId].total ?? Infinity;
        ts[s.trainerId].remaining = Math.min(cap, ts[s.trainerId].remaining + 1);
      }
      m = { ...member, trainerSessions: ts };
    }
    // attended/noshow: 차감 유지(복원 안 함)
  }
  return { sched: s, member: m };
}

function deleteWithRestore(member, sched) {
  let m = member;
  const needRestore = !sched.isExternal && sched.memberId && sched.sessionDeducted && !sched.statusFinalized;
  if (needRestore && member) {
    const ts = clone(member.trainerSessions);
    if (ts[sched.trainerId]) {
      const cap = ts[sched.trainerId].total ?? Infinity;
      ts[sched.trainerId].remaining = Math.min(cap, ts[sched.trainerId].remaining + 1);
    }
    m = { ...member, trainerSessions: ts };
  }
  return { member: m };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const member = (remaining = 10) => ({ id: 'm', trainerSessions: { t: { total: 10, remaining } } });
const rem = (m) => m.trainerSessions.t.remaining;
const booking = { memberId: 'm', trainerId: 't', isExternal: false };

describe('세션 차감↔복원 상태전이', () => {
  it('예약 → 출석: 1회 차감되고 유지 (10→9)', () => {
    let { ns, member: m } = createWithDeduction(member(10), booking);
    expect(rem(m)).toBe(9);
    ({ member: m } = finalize(m, ns, 'attended'));
    expect(rem(m)).toBe(9); // 출석은 복원 안 함
  });

  it('예약 → 노쇼: 차감 유지 (10→9, 계약서 2조)', () => {
    let { ns, member: m } = createWithDeduction(member(10), booking);
    ({ member: m } = finalize(m, ns, 'noshow'));
    expect(rem(m)).toBe(9);
  });

  it('예약 → 취소: 세션 복원 (10→9→10)', () => {
    let { ns, member: m } = createWithDeduction(member(10), booking);
    expect(rem(m)).toBe(9);
    ({ member: m } = finalize(m, ns, 'canceled'));
    expect(rem(m)).toBe(10); // 취소는 복원
  });

  it('예약 → 확정 전 삭제: 복원됨 (10→9→10)', () => {
    let { ns, member: m } = createWithDeduction(member(10), booking);
    ({ member: m } = deleteWithRestore(m, ns));
    expect(rem(m)).toBe(10);
  });

  it('예약 → 출석확정 → 삭제: 복원 안 됨 (출석 수업은 차감 유지)', () => {
    let { ns, member: m } = createWithDeduction(member(10), booking);
    let s2;
    ({ sched: s2, member: m } = finalize(m, ns, 'attended'));
    ({ member: m } = deleteWithRestore(m, s2));
    expect(rem(m)).toBe(9); // statusFinalized=true 라 복원 안 함
  });

  it('취소(복원)된 예약을 삭제해도 중복 복원 안 됨 (10 유지)', () => {
    let { ns, member: m } = createWithDeduction(member(10), booking);
    let s2;
    ({ sched: s2, member: m } = finalize(m, ns, 'canceled'));
    expect(rem(m)).toBe(10);
    // 취소는 statusFinalized=true 이므로 삭제 시 복원 조건(!statusFinalized) 불충족
    ({ member: m } = deleteWithRestore(m, s2));
    expect(rem(m)).toBe(10); // 중복 복원 없음
  });

  it('잔여 0에서 예약: 차감 안 되고, 삭제해도 복원 안 됨', () => {
    let { ns, member: m } = createWithDeduction(member(0), booking);
    expect(ns.sessionDeducted).toBe(false);
    expect(rem(m)).toBe(0);
    ({ member: m } = deleteWithRestore(m, ns));
    expect(rem(m)).toBe(0); // sessionDeducted=false 라 복원 안 함
  });

  it('복원은 total 한도를 넘지 않는다', () => {
    // 잔여=총횟수인 상태에서 취소 복원 시 cap 초과 방지
    const m0 = member(10); // 10/10
    const ns = { ...booking, sessionDeducted: true, trainerId: 't' };
    const { member: m } = finalize(m0, ns, 'canceled');
    expect(rem(m)).toBe(10); // 11 안 됨
  });
});
