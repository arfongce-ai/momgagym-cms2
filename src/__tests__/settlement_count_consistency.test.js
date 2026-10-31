// 수납(회차)·스케줄(수업)·정산(횟수/금액) 정합성 회귀 테스트 (2026-10 점검에서 발견된 불일치)
import { describe, it, expect } from 'vitest';
import { computeSessionSettlement, autoRefundUsedAmount, buildTrainerLots } from '../services/finance';

const settings = { cardFeeRate: 0, vatRate: 0, lowSplitRate: 40, promoPerPost: 0, withholdingRate: 3.3, trainerSplitRates: {} };
const trainers = [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }];
const P1 = { id: 'p1', paidAt: '2026-08-01', amount: 1000000, method: 'cash', trainerIds: ['t1'], sessionAdds: [{ trainerId: 't1', count: 10 }], splitRateAtPay: { t1: 50 } };
const P2 = { id: 'p2', paidAt: '2026-09-01', amount: 2000000, method: 'cash', trainerIds: ['t1'], sessionAdds: [{ trainerId: 't1', count: 10 }], isReEnroll: true, reEnrollNo: 1, splitRateAtPay: { t1: 50 } };
const sched = ['2026-10-02', '2026-10-03', '2026-10-04'].map((d, i) => ({ id: 's' + i, memberId: 'm1', trainerId: 't1', date: d, status: 'attended', sessionDeducted: true }));
const settle = (members, payments, schedules) =>
  computeSessionSettlement({ trainers, members, schedules, payments: { m1: payments }, records: [], settings, ym: '2026-10' })[0]?.rows[0];

describe('환불로 잔여가 0이 돼도 이번 달 수업은 원래 등록분 단가로 정산', () => {
  it('환불 스냅샷(refundPrevSessions)을 되돌려 회차 매핑', () => {
    const refunded = { ...P2, isRefunded: true, refundedAt: '2026-10-20', refundAmount: 0, refundPrevSessions: { t1: 17 } };
    const row = settle([{ id: 'm1', name: 'M', trainerSessions: { t1: { total: 20, remaining: 0 } } }], [P1, refunded], sched);
    expect(row.autoUnit).toBe(100000);
    expect(row.cnt).toBe(3);
  });
});

describe('세션카드가 없어도(삭제/전체양도) 결제 lot 단가로 금액 계산', () => {
  it('출석 3회 → 금액 0원이 아니라 300,000원', () => {
    const row = settle([{ id: 'm1', name: 'M', trainerSessions: {} }], [P1], sched);
    expect(row.cnt).toBe(3);
    expect(row.amount).toBe(300000);
  });
});

describe('재등록 회원의 환불 진행분은 그 결제 lot 기준', () => {
  const m = { id: 'm1', trainerSessions: { t1: { total: 20, remaining: 17 } } };
  const opts = { members: [m], schedules: sched, settings, payments: [P1, P2] };
  it('재등록 결제(P2)는 아직 소진 전 → 0원', () => expect(autoRefundUsedAmount(P2, 'm1', opts)).toBe(0));
  it('1차 결제(P1)는 3회 × 100,000', () => expect(autoRefundUsedAmount(P1, 'm1', opts)).toBe(300000));
  it('payments 미전달 시 기존 계산 유지', () => {
    expect(autoRefundUsedAmount(P1, 'm1', { members: [m], schedules: sched, settings })).toBe(Math.round(1000000 / 20 * 3));
  });
});

describe('buildTrainerLots: split(7:3) 결제 귀속이 월 정산과 동일', () => {
  const S = [{ id: 'p', paidAt: '2026-08-01', amount: 1000000, method: 'cash', trainerIds: ['t1', 't2'],
    split: [{ trainerId: 't1', amount: 700000 }, { trainerId: 't2', amount: 300000 }],
    sessionAdds: [{ trainerId: 't1', count: 10 }, { trainerId: 't2', count: 10 }] }];
  it('t1 70,000 / t2 30,000', () => {
    expect(buildTrainerLots({ payments: S, trainerId: 't1', settings, trainerRegTotal: 10 })[0].unit).toBe(70000);
    expect(buildTrainerLots({ payments: S, trainerId: 't2', settings, trainerRegTotal: 10 })[0].unit).toBe(30000);
  });
});

describe('결제 없는 증정 세션도 0원 기록(sessionAdds)으로 남기면 유료 수업이 0원 단가가 되지 않는다', () => {
  const free = { id: 'pf', paidAt: '2026-09-15', amount: 0, method: 'transfer', trainerIds: ['t1'], sessionAdds: [{ trainerId: 't1', count: 5 }], isFree: true };
  it('유료 10회 + 증정 5회: 처음 3회 출석은 유료 단가 100,000', () => {
    const row = settle([{ id: 'm1', name: 'M', trainerSessions: { t1: { total: 15, remaining: 12 } } }], [P1, free], sched);
    expect(row.autoUnit).toBe(100000);
    expect(row.amount).toBe(300000);
    expect(row.regRoundCount).toBe(10);
  });
  it('(참고) 기록 없이 세션만 늘린 예전 방식은 0원 단가가 나온다 — 이 경로를 더 이상 쓰지 않는다', () => {
    const row = settle([{ id: 'm1', name: 'M', trainerSessions: { t1: { total: 15, remaining: 12 } } }], [P1], sched);
    expect(row.autoUnit).toBe(0);
  });
});

describe('MemberDetail 소스 점검', () => {
  it('재등록 체크 + 횟수 미입력은 저장 전에 막고, 증정 추가는 0원 기록을 남긴다', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../components/members/MemberDetail.jsx', import.meta.url), 'utf8');
    expect(src).toContain('payForm.isReEnroll && sessionAdds.length === 0');
    expect(src).toContain('isFree: true');
    expect(src).toContain('addPaymentWithMemberUpdate(member.id, freePayment');
  });
});
