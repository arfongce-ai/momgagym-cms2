import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run the repository's actual finance.js functions under Node by inlining its
// single extensionless date helper import (Vite normally resolves that import).
const financeUrl = new URL('../services/finance.js', import.meta.url);
const financeSource = (await readFile(financeUrl, 'utf8'))
  .replace("import { toYMD } from '../utils/dates';", "const toYMD = value => typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);");
const finance = await import(`data:text/javascript;base64,${Buffer.from(financeSource).toString('base64')}`);

const settings = {
  withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8,
  lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2,
  rate50MinStudy: 1, trainerSplitRates: {}, vatRate: 10, cardFeeRate: 0.8,
};
const trainers = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
const member = { id: 'm1', trainerSessions: { t1: { total: 1 } } };
const calc = (payment, memberData = member) => {
  const rates = finance.computeMonthRates({ trainers, members: [memberData], payments: { m1: [payment] }, records: [], settings, ym: '2026-09' });
  return trainers.reduce((sum, trainer) => sum + (rates[trainer.id]?.depositRevenue || 0), 0);
};
const topNet = (payments, refundTotal = 0) => payments
  .filter(payment => !payment.isUnpaid)
  .reduce((sum, payment) => sum + finance.calcNet(payment, settings).net, 0) - refundTotal;

// 1. Monthly payments are shown under their assigned trainer.
const monthly = { amount: 1000, method: 'cash', paidAt: '2026-09-05', isMonthly: true, trainerIds: ['t1'] };
assert.equal(topNet([monthly]), 1000);
assert.equal(calc(monthly), 1000);

// 2. A refunded payment's remaining balance is retained by the center.
const partiallyRefunded = { amount: 1000, method: 'cash', paidAt: '2026-09-05', isRefunded: true, refundAmount: 200, refundedAt: '2026-09-20', trainerIds: ['t1'] };
assert.equal(topNet([partiallyRefunded], partiallyRefunded.refundAmount), 800);
assert.equal(calc(partiallyRefunded), 0);

// 3. The split allocates all whole won without losing a remainder.
const threeWay = { amount: 100, method: 'cash', paidAt: '2026-09-05', trainerIds: ['t1', 't2', 't3'] };
assert.equal(topNet([threeWay]), 100);
assert.equal(calc(threeWay), 100);

// 4. Missing or out-of-roster attribution is center revenue and not displayed.
const unattributed = { amount: 1000, method: 'cash', paidAt: '2026-09-05' };
assert.equal(topNet([unattributed]), 1000);
assert.equal(calc(unattributed, { id: 'm1' }), 0);
const unknownTrainer = { amount: 1000, method: 'cash', paidAt: '2026-09-05', trainerIds: ['unknown'] };
assert.equal(calc(unknownTrainer, { id: 'm1' }), 0);

console.log('R1 regression passed: monthly attribution, center-retained refund/unassigned revenue, and exact 3-way rounding.');
