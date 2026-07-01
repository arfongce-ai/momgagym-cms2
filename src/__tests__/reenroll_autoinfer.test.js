import { describe, expect, it } from 'vitest';
import { computeSessionSettlement } from '../services/finance.js';

const YM = '2026-06';
const trainers = [{ id: 't1', name: 'Trainer', color: '#00f' }];
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

function settle(remaining, schedules) {
  const members = [{
    id: 'm1',
    name: 'Member',
    isActive: true,
    trainerSessions: { t1: { total: 25, remaining } },
  }];
  const payments = { m1: [
    {
      id: 'p6',
      paidAt: '2026-03-01',
      method: 'cash',
      amount: 986000,
      trainerIds: ['t1'],
      isReEnroll: true,
      reEnrollNo: 6,
      splitRateAtPay: { t1: 60 },
      sessionAdds: [{ trainerId: 't1', count: 20 }],
    },
    {
      id: 'p7',
      paidAt: '2026-06-01',
      method: 'cash',
      amount: 246400,
      trainerIds: ['t1'],
      isReEnroll: true,
      reEnrollNo: 7,
      splitRateAtPay: { t1: 60 },
      sessionAdds: [{ trainerId: 't1', count: 5 }],
    },
  ] };
  const blocks = computeSessionSettlement({
    trainers, members, schedules, payments, records: [], settings, ym: YM, getOverride: () => null,
  });
  return blocks[0].rows.find(row => row.memberId === 'm1');
}

const schedule = (idx, sessionAtBooking = null) => ({
  id: `s${idx}`,
  memberId: 'm1',
  trainerId: 't1',
  date: `2026-06-${String(10 + idx).padStart(2, '0')}`,
  status: 'attended',
  isExternal: false,
  ...(sessionAtBooking != null ? { sessionAtBooking } : {}),
});

describe('reenroll round auto inference', () => {
  it('splits missing booking rounds across the previous and current reenroll lots', () => {
    const row = settle(0, Array.from({ length: 7 }, (_, idx) => schedule(idx)));
    const parts = row.settlementBreakdown;

    expect(parts.find(part => part.reEnrollNo === 6)?.count).toBe(2);
    expect(parts.find(part => part.reEnrollNo === 7)?.count).toBe(5);
  });

  it('keeps explicit booking rounds and infers only the missing remainder', () => {
    const row = settle(0, [
      schedule(0, 7),
      schedule(1, 6),
      schedule(2),
      schedule(3),
      schedule(4),
      schedule(5),
      schedule(6),
    ]);
    const parts = row.settlementBreakdown;

    expect(parts.find(part => part.reEnrollNo === 6)?.count).toBe(2);
    expect(parts.find(part => part.reEnrollNo === 7)?.count).toBe(5);
  });

  it('does not override explicit booking rounds with inferred rounds', () => {
    const row = settle(0, [5, 4, 3, 2, 1].map((round, idx) => schedule(idx, round)));
    const parts = row.settlementBreakdown.filter(part => part.count > 0);

    expect(parts.every(part => part.reEnrollNo === 7)).toBe(true);
    expect(parts.find(part => part.reEnrollNo === 7)?.count).toBe(5);
  });
});
