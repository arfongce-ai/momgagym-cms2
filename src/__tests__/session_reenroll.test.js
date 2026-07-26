// 세션 재등록 시 결제(payment)와 세션(trainerSessions)이 함께 기록되는지 검증.
// handleAddSession 의 페이로드 구성 로직을 추출한 순수 모델.
import { describe, it, expect } from 'vitest';

function buildReEnrollPayload({ member, existingPayments, addTrainerId, addCount, addSessDate, addSessAmount, addSessMethod, addSessNoPay, addClassType }) {
  const ts = JSON.parse(JSON.stringify(member.trainerSessions || {}));
  if (ts[addTrainerId]) {
    ts[addTrainerId].total += Number(addCount);
    ts[addTrainerId].remaining += Number(addCount);
  } else {
    ts[addTrainerId] = { total: Number(addCount), remaining: Number(addCount) };
  }
  const curCT = member.classTypes || [];
  const upCT = addClassType && !curCT.includes(addClassType) ? [...curCT, addClassType] : curCT;

  if (addSessNoPay) {
    return { kind: 'session_only', memberPatch: { trainerSessions: ts, classTypes: upCT, lastPaymentDate: addSessDate }, payment: null };
  }
  const reEnrollNo = existingPayments.filter(x => x.isReEnroll).length + 1;
  const payment = {
    paidAt: addSessDate, amount: Number(addSessAmount) || 0, method: addSessMethod,
    trainerIds: [addTrainerId],
    sessionAdds: [{ trainerId: addTrainerId, count: Number(addCount), classType: addClassType || '' }],
    isReEnroll: true, reEnrollNo, isNew: false,
  };
  return { kind: 'payment_and_session', memberPatch: { trainerSessions: ts, classTypes: upCT, lastPaymentDate: addSessDate }, payment };
}

const member = () => ({ id: 'm', trainerSessions: { t: { total: 30, remaining: 5 } }, classTypes: ['PT'] });

describe('세션 재등록 = 결제 + 세션 동시', () => {
  it('결제 동반 재등록: payment 생성 + 세션 증가가 함께', () => {
    const r = buildReEnrollPayload({
      member: member(), existingPayments: [], addTrainerId: 't', addCount: 10,
      addSessDate: '2026-06-28', addSessAmount: 600000, addSessMethod: '카드', addSessNoPay: false, addClassType: 'PT',
    });
    expect(r.kind).toBe('payment_and_session');
    // 세션 증가
    expect(r.memberPatch.trainerSessions.t.total).toBe(40);
    expect(r.memberPatch.trainerSessions.t.remaining).toBe(15);
    // 결제 기록
    expect(r.payment.amount).toBe(600000);
    expect(r.payment.isReEnroll).toBe(true);
    expect(r.payment.reEnrollNo).toBe(1);
    // 결제의 sessionAdds 와 세션 증가가 일치
    expect(r.payment.sessionAdds[0].count).toBe(10);
  });

  it('재등록 회차는 기존 재등록 결제 수 + 1', () => {
    const existing = [{ isReEnroll: true }, { isReEnroll: true }, { isReEnroll: false }];
    const r = buildReEnrollPayload({
      member: member(), existingPayments: existing, addTrainerId: 't', addCount: 10,
      addSessDate: '2026-06-28', addSessAmount: 600000, addSessMethod: '카드', addSessNoPay: false,
    });
    expect(r.payment.reEnrollNo).toBe(3); // 2 + 1
  });

  it('결제 없이 추가: payment=null, 세션만 증가', () => {
    const r = buildReEnrollPayload({
      member: member(), existingPayments: [], addTrainerId: 't', addCount: 10,
      addSessDate: '2026-06-28', addSessAmount: 0, addSessMethod: '카드', addSessNoPay: true,
    });
    expect(r.kind).toBe('session_only');
    expect(r.payment).toBeNull();
    expect(r.memberPatch.trainerSessions.t.remaining).toBe(15);
  });

  it('새 트레이너 슬롯도 재등록으로 생성 가능', () => {
    const r = buildReEnrollPayload({
      member: member(), existingPayments: [], addTrainerId: 't_new', addCount: 20,
      addSessDate: '2026-06-28', addSessAmount: 1000000, addSessMethod: '현금', addSessNoPay: false,
    });
    expect(r.memberPatch.trainerSessions.t_new).toEqual({ total: 20, remaining: 20 });
    expect(r.payment.amount).toBe(1000000);
  });

  it('세션 증가량과 결제의 sessionAdds count 가 항상 일치 (정합성)', () => {
    const r = buildReEnrollPayload({
      member: member(), existingPayments: [], addTrainerId: 't', addCount: 7,
      addSessDate: '2026-06-28', addSessAmount: 420000, addSessMethod: '카드', addSessNoPay: false,
    });
    const sessionDelta = r.memberPatch.trainerSessions.t.remaining - member().trainerSessions.t.remaining;
    expect(sessionDelta).toBe(r.payment.sessionAdds[0].count);
  });
});
