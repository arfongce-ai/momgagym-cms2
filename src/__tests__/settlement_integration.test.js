// 운영(스케줄·결제) ↔ 정산 연결성 통합 검증
// computeSessionSettlement 가 결제·세션·출석을 정확히 연결하는지.
import { describe, it, expect } from 'vitest';
import { computeSessionSettlement, calcNet } from '../services/finance';

const YM = '2026-06';
const trainers = [{ id: 't1', name: '트레이너1', color: '#f00' }];
const settings = { withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8, lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, trainerSplitRates: {} };
const records = [];

function settle(members, payments, schedules) {
  const blocks = computeSessionSettlement({ trainers, members, schedules, payments, records, settings, ym: YM, getOverride: () => null });
  const b = blocks.find(x => x.trainer.id === 't1');
  return { block: b, row: b?.rows?.find(r => r.memberId === 'm1') };
}

const attendedSched = (n) => Array.from({ length: n }, (_, i) => ({
  id: `s${i}`, memberId: 'm1', memberName: '회원', trainerId: 't1',
  date: `2026-06-${String(10 + i).padStart(2, '0')}`, startTime: '10:00', endTime: '11:00',
  status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true,
}));

describe('단가 계산: 귀속결제액 ÷ 등록횟수', () => {
  it('현금 54만원 / 10회 등록 → 단가 54,000, 출석3회 → 수업료 162,000', () => {
    const members = [{ id: 'm1', name: '회원', isActive: true, trainerSessions: { t1: { total: 10, remaining: 7 } } }];
    const payments = { m1: [{ id: 'p1', amount: 540000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 50 } }] };
    const { row } = settle(members, payments, attendedSched(3));
    expect(row.autoUnit).toBe(54000);
    expect(row.cnt).toBe(3);
    expect(row.amount).toBe(162000); // 54000 * 3
    expect(row.rate).toBe(50);
    expect(row.payAmount).toBe(81000); // 162000 * 50%
  });
});

describe('박제비율(splitRateAtPay)이 정산에 반영', () => {
  it('박제 60% → 그 비율로 지급', () => {
    const members = [{ id: 'm1', name: '회원', isActive: true, trainerSessions: { t1: { total: 10, remaining: 8 } } }];
    const payments = { m1: [{ id: 'p1', amount: 500000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 60 } }] };
    const { row } = settle(members, payments, attendedSched(2));
    expect(row.rate).toBe(60);
    expect(row.rateFrozen).toBe(true);
  });

  it('두 결제 박제비율 다르면 입금액 가중평균', () => {
    // 결제1: 40만원 @50%, 결제2: 60만원 @60% → 가중평균 = (40*50+60*60)/100 = 56%
    const members = [{ id: 'm1', name: '회원', isActive: true, trainerSessions: { t1: { total: 20, remaining: 18 } } }];
    const payments = { m1: [
      { id: 'p1', amount: 400000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 50 } },
      { id: 'p2', amount: 600000, method: '현금', paidAt: '2026-06-10', trainerIds: ['t1'], splitRateAtPay: { t1: 60 } },
    ] };
    const { row } = settle(members, payments, attendedSched(2));
    expect(row.rate).toBe(56); // 가중평균
  });
});

describe('환불/미수금/월정액 처리', () => {
  it('미수금(isUnpaid) 결제는 단가 계산에서 제외', () => {
    const members = [{ id: 'm1', name: '회원', isActive: true, trainerSessions: { t1: { total: 10, remaining: 9 } } }];
    const payments = { m1: [{ id: 'p1', amount: 540000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], isUnpaid: true, splitRateAtPay: { t1: 50 } }] };
    const { row } = settle(members, payments, attendedSched(1));
    expect(row.autoUnit).toBe(0); // 미수금이라 귀속결제액 0
  });

  it('환불 결제도 단가에 포함(출석한 회차만 지급)', () => {
    const members = [{ id: 'm1', name: '회원', isActive: true, trainerSessions: { t1: { total: 10, remaining: 9 } } }];
    const payments = { m1: [{ id: 'p1', amount: 540000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], isRefunded: true, splitRateAtPay: { t1: 50 } }] };
    const { row } = settle(members, payments, attendedSched(1));
    expect(row.autoUnit).toBe(54000); // 환불해도 단가 계산엔 포함
  });
});

describe('출석 집계 ↔ 스케줄 상태 연결', () => {
  it('출석 5회 → 정산 cnt=5', () => {
    const members = [{ id: 'm1', name: '회원', isActive: true, trainerSessions: { t1: { total: 10, remaining: 5 } } }];
    const payments = { m1: [{ id: 'p1', amount: 500000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 50 } }] };
    const { row } = settle(members, payments, attendedSched(5));
    expect(row.cnt).toBe(5);
  });
});
