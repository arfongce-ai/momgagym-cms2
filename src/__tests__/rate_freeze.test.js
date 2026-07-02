import { describe, expect, it } from 'vitest';
import { planRateFreeze } from '../services/finance.js';

// 방향 A: 수동 정산비율을 결제 건(splitRateAtPay)에 영구 박제.
// 시나리오: 한도현이 2월에 재등록 8회차(10회)를 결제, 2~5월에 나눠 소진.
// 2월에 50%로 정하면 3·4·5월 소진분도 50%로 유지되어야 한다.
// planRateFreeze 는 그 결제의 splitRateAtPay[tid] 를 50으로 바꾸는 patch 를 만든다.

const member = {
  id: 'm-han',
  name: '한도현',
  trainerSessions: { 't-hwang': { total: 10, remaining: 0 } },
};

const payments = [
  { id: 'p-feb', paidAt: '2026-02-06', amount: 600000, trainerIds: ['t-hwang'],
    isReEnroll: true, reEnrollNo: 8, splitRateAtPay: { 't-hwang': 40 } },
];

describe('planRateFreeze — 수동 비율을 결제 건에 박제(방향 A)', () => {
  it('40%로 박제된 결제를 50%로 고정하는 patch 를 만든다', () => {
    const { patches, count } = planRateFreeze({
      member, payments, trainerId: 't-hwang', rate: 50,
    });
    expect(count).toBe(1);
    expect(patches[0].pid).toBe('p-feb');
    expect(patches[0].splitRateAtPay['t-hwang']).toBe(50);
    expect(patches[0].prev['t-hwang']).toBe(40); // 이전 값 보존(감사용)
  });

  it('이미 같은 값(50%)이면 patch 를 만들지 않는다(불필요한 쓰기 방지)', () => {
    const already = [{ ...payments[0], splitRateAtPay: { 't-hwang': 50 } }];
    const { count } = planRateFreeze({ member, payments: already, trainerId: 't-hwang', rate: 50 });
    expect(count).toBe(0);
  });

  it('다른 트레이너 키는 건드리지 않고 보존한다', () => {
    const multi = [{ ...payments[0], trainerIds: ['t-hwang', 't-kim'],
      splitRateAtPay: { 't-hwang': 40, 't-kim': 60 } }];
    const { patches } = planRateFreeze({ member, payments: multi, trainerId: 't-hwang', rate: 50 });
    expect(patches[0].splitRateAtPay).toEqual({ 't-hwang': 50, 't-kim': 60 });
  });

  it('환불 결제는 대상에서 제외한다', () => {
    const refunded = [{ ...payments[0], isRefunded: true }];
    const { count } = planRateFreeze({ member, payments: refunded, trainerId: 't-hwang', rate: 50 });
    expect(count).toBe(0);
  });

  it('trainerIds 가 비어도 회원이 그 트레이너 세션을 보유하면 대상에 포함한다', () => {
    const noTids = [{ id: 'p2', paidAt: '2026-02-06', amount: 600000,
      splitRateAtPay: { 't-hwang': 40 } }]; // trainerIds 없음
    const { count, patches } = planRateFreeze({ member, payments: noTids, trainerId: 't-hwang', rate: 50 });
    expect(count).toBe(1);
    expect(patches[0].splitRateAtPay['t-hwang']).toBe(50);
  });

  it('잘못된 입력(비회원/비율 NaN)은 빈 결과를 낸다', () => {
    expect(planRateFreeze({ member: null, payments, trainerId: 't-hwang', rate: 50 }).count).toBe(0);
    expect(planRateFreeze({ member, payments, trainerId: 't-hwang', rate: 'x' }).count).toBe(0);
  });
});
