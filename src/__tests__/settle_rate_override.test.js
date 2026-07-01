import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeSessionSettlement } from '../services/finance.js';

// ── 정산 카드 저장 로직(TrainerSettleCard.save)의 rate override 판정 재현 ──
// 버그: 표시값(r.rate)과 다른 baseRate로 비교해 "수정 후 닫으면 값이 사라지던" 문제.
// 수정: 자동값(autoRate) 기준으로 비교 → 사용자가 바꾼 값은 항상 저장/표시된다.
function buildSplitRates(rows, rateEdits) {
  const autoRate = {};
  rows.forEach(r => { autoRate[r.memberId] = r.autoRate ?? r.baseRate ?? r.rate; });
  const clampRate = (v) => { if (v===''||v==null) return null; const n=Number(v); return Number.isFinite(n)?Math.max(0,Math.min(100,n)):null; };
  const splitRates = {};
  Object.entries(rateEdits).forEach(([mid, v]) => {
    const val = clampRate(v);
    if (val != null && val !== (Number(autoRate[mid])||0)) splitRates[mid] = val;
  });
  return splitRates;
}

describe('정산 rate override 저장 판정', () => {
  it('표시 60(autoRate 60)을 50으로 낮추면 저장된다', () => {
    const rows = [{ memberId:'m1', rate:60, autoRate:60, baseRate:60 }];
    expect(buildSplitRates(rows, { m1: 50 })).toEqual({ m1: 50 });
  });

  it('[회귀] baseRate가 표시값과 달라도(수동50 트레이너) 사용자가 바꾼 값이 저장된다', () => {
    // 표시/자동 60, 그러나 등록월 baseRate=50 (수동50 트레이너 케이스)
    const rows = [{ memberId:'m1', rate:60, autoRate:60, baseRate:50 }];
    // 예전 코드: 50==baseRate(50) → 저장 누락(값 사라짐). 수정 후: autoRate(60) 기준 → 저장됨.
    expect(buildSplitRates(rows, { m1: 50 })).toEqual({ m1: 50 });
  });

  it('자동값과 같은 값으로 두면 override를 만들지 않는다(실시간 추종)', () => {
    const rows = [{ memberId:'m1', rate:60, autoRate:60, baseRate:50 }];
    expect(buildSplitRates(rows, { m1: 60 })).toEqual({});
  });
});

// ── compute가 autoRate를 노출하고 override를 표시하는지 ──
const YM = '2026-06';
const trainers = [{ id: 't1', name: 'T', color: '#f00' }];
const settings = { withholdingRate: 3.3, promoPerPost: 10000, snsInstaMax: 8, lowSplitRate: 40, rate60MinSales: 3000000, rate50MinBlog: 2, rate50MinStudy: 1, trainerSplitRates: {} };
const sched = (n) => Array.from({ length: n }, (_, i) => ({
  id: `s${i}`, memberId: 'm1', memberName: '회원', trainerId: 't1',
  date: `2026-06-${String(10 + i).padStart(2, '0')}`, status: 'attended', isExternal: false, sessionDeducted: true, statusFinalized: true,
}));
function settle(override) {
  const members = [{ id: 'm1', name: '회원', isActive: true, trainerSessions: { t1: { total: 10, remaining: 5 } } }];
  const payments = { m1: [{ id: 'p1', amount: 540000, method: '현금', paidAt: '2026-06-01', trainerIds: ['t1'], splitRateAtPay: { t1: 60 } }] };
  const blocks = computeSessionSettlement({ trainers, members, schedules: sched(5), payments, records: [], settings, ym: YM, getOverride: () => override });
  return blocks[0].rows.find(r => r.memberId === 'm1');
}

describe('compute가 autoRate 노출 + override 반영', () => {
  it('override 없으면 autoRate가 노출된다', () => {
    const row = settle(null);
    expect(row.autoRate).toBe(60);
    expect(row.rate).toBe(60);
    expect(row.rateManual).toBe(false);
  });
  it('splitRates override 50이 표시·지급에 반영된다', () => {
    const row = settle({ id:'t1_2026-06', trainerId:'t1', ym:YM, splitRates:{ m1: 50 } });
    expect(row.rate).toBe(50);
    expect(row.rateManual).toBe(true);
    expect(row.payAmount).toBe(135000); // 270000 * 50%
    expect(row.autoRate).toBe(60);       // 자동값은 60으로 계속 노출
  });
});
