import { describe, it, expect } from 'vitest';
import { buildRefreezeAllPlan } from '../services/finance.js';

const settings = {
  withholdingRate:3.3, promoPerPost:10000, snsInstaMax:8, vatRate:10, cardFeeRate:2,
  lowSplitRate:40, rate60MinSales:3000000, rate50MinBlog:2, rate50MinStudy:1, trainerSplitRates:{},
};
const trainers = [{ id:'t1', name:'황지영', color:'#f00' }];

describe('buildRefreezeAllPlan — 전체 기간 결제월 조건 일괄 박제', () => {
  it('각 결제를 자기 결제월 조건 비율로 박제 계획을 만든다', () => {
    // 2월: 매출 큰 재등록(조건B 충족 → 최소 50%) / 6월: 소액(조건 미달 → 40%)
    const members = [{ id:'m1', name:'회원', isActive:true, trainerSessions:{ t1:{ total:20, remaining:5 } } }];
    const payments = { m1:[
      { id:'p1', paidAt:'2026-02-06', amount:4000000, method:'cash', trainerIds:['t1'],
        isReEnroll:true, reEnrollNo:1, splitRateAtPay:{}, sessionAdds:[{trainerId:'t1',count:10}] },
      { id:'p2', paidAt:'2026-06-05', amount:400000, method:'cash', trainerIds:['t1'],
        isReEnroll:true, reEnrollNo:2, splitRateAtPay:{}, sessionAdds:[{trainerId:'t1',count:10}] },
    ]};
    const plan = buildRefreezeAllPlan({ trainers, members, payments, records:[], settings });
    const byId = Object.fromEntries(plan.patches.map(p => [p.pid, p.splitRateAtPay.t1]));
    // 2월: 재등록 매출 400만 ≥ 300만 → 조건B 충족 → 50%
    expect(byId.p1).toBe(50);
    // 6월: 조건 미달 → 40%
    expect(byId.p2).toBe(40);
    expect(plan.months).toContain('2026-02');
    expect(plan.months).toContain('2026-06');
  });

  it('이미 결제월 조건과 같으면 그 건은 제외', () => {
    const members = [{ id:'m1', name:'회원', isActive:true, trainerSessions:{ t1:{ total:10, remaining:5 } } }];
    const payments = { m1:[
      { id:'p1', paidAt:'2026-06-05', amount:400000, method:'cash', trainerIds:['t1'],
        isReEnroll:true, reEnrollNo:1, splitRateAtPay:{ t1:40 }, sessionAdds:[{trainerId:'t1',count:10}] },
    ]};
    const plan = buildRefreezeAllPlan({ trainers, members, payments, records:[], settings });
    expect(plan.count).toBe(0);
  });
});
