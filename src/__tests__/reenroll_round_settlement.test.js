import { describe, expect, it } from 'vitest';
import { computeSessionSettlement } from '../services/finance.js';

const YM = '2026-06';
const trainers = [{ id: 't1', name: 'Trainer', color: '#f00' }];
const settings = {
  withholdingRate: 3.3,
  promoPerPost: 10000,
  snsInstaMax: 8,
  lowSplitRate: 40,
  rate60MinSales: 3000000,
  rate50MinBlog: 2,
  rate50MinStudy: 1,
  trainerSplitRates: {},
};

function build(remaining, rounds) {
  const members = [{
    id: 'm1',
    name: 'Member',
    isActive: true,
    trainerSessions: { t1: { total: 20, remaining } },
  }];
  const payments = { m1: [
    {
      id: 'p1',
      paidAt: '2026-04-01',
      method: 'cash',
      amount: 500000,
      trainerIds: ['t1'],
      isNew: true,
      splitRateAtPay: { t1: 60 },
      sessionAdds: [{ trainerId: 't1', count: 10 }],
    },
    {
      id: 'p2',
      paidAt: '2026-06-01',
      method: 'cash',
      amount: 550000,
      trainerIds: ['t1'],
      isReEnroll: true,
      reEnrollNo: 2,
      splitRateAtPay: { t1: 60 },
      sessionAdds: [{ trainerId: 't1', count: 10 }],
    },
  ] };
  const schedules = rounds.map((round, idx) => ({
    id: `s${idx}`,
    memberId: 'm1',
    trainerId: 't1',
    date: `2026-06-${String(10 + idx).padStart(2, '0')}`,
    status: 'attended',
    isExternal: false,
    sessionAtBooking: round,
  }));
  const blocks = computeSessionSettlement({
    trainers, members, schedules, payments, records: [], settings, ym: YM, getOverride: () => null,
  });
  return blocks[0].rows.find(row => row.memberId === 'm1');
}

describe('reenroll round settlement', () => {
  it('uses the current reenroll unit price for current reenroll rounds', () => {
    const row = build(5, [5, 4, 3, 2, 1]);

    expect(row.autoCnt).toBe(5);
    expect(Math.round(row.autoUnit)).toBe(55000);
    expect(row.regReEnrollNo).toBe(2);
    expect(row.payAmount).toBe(165000);
  });

  it('sums mixed previous and current registration rounds by lot', () => {
    // 신규 lot(10) 마지막 2개 + 재등록2 lot(10) 처음 3개가 6월에 소진.
    // 5개가 누적 인덱스 8~12 → 13개 소진 → remaining = 20-13 = 7.
    const row = build(7, [12, 11, 10, 9, 8]);
    const parts = row.settlementBreakdown;

    expect(row.autoCnt).toBe(5);
    expect(row.payAmount).toBe(159000);
    expect(parts).toHaveLength(2);
    expect(parts.find(part => !part.reEnrollNo)?.payAmount).toBe(60000);
    expect(parts.find(part => part.reEnrollNo === 2)?.payAmount).toBe(99000);
  });

  it('infers missing legacy booking rounds instead of falling back to zero payout', () => {
    const members = [{
      id: 'm1',
      name: 'Member',
      isActive: true,
      trainerSessions: { t1: { total: 20, remaining: 5 } },
    }];
    const payments = { m1: [
      {
        id: 'p1',
        paidAt: '2026-04-01',
        method: 'cash',
        amount: 500000,
        trainerIds: ['t1'],
        isNew: true,
        splitRateAtPay: { t1: 60 },
        sessionAdds: [{ trainerId: 't1', count: 10 }],
      },
      {
        id: 'p2',
        paidAt: '2026-06-01',
        method: 'cash',
        amount: 550000,
        trainerIds: ['t1'],
        isReEnroll: true,
        reEnrollNo: 2,
        splitRateAtPay: { t1: 60 },
        sessionAdds: [{ trainerId: 't1', count: 10 }],
      },
    ] };
    const schedules = Array.from({ length: 5 }, (_, idx) => ({
      id: `s${idx}`,
      memberId: 'm1',
      trainerId: 't1',
      date: `2026-06-${String(10 + idx).padStart(2, '0')}`,
      status: 'attended',
      isExternal: false,
    }));
    const blocks = computeSessionSettlement({
      trainers, members, schedules, payments, records: [], settings, ym: YM, getOverride: () => null,
    });
    const row = blocks[0].rows.find(item => item.memberId === 'm1');

    expect(row.autoCnt).toBe(5);
    expect(row.payAmount).toBeGreaterThan(0);
    expect(row.settlementBreakdown.find(part => part.reEnrollNo === 2)?.count).toBe(5);
  });
});
