import { describe, it, expect } from 'vitest';
import { buildRefreezePlan, buildRefreezeAllPlan } from '../services/finance.js';
const settings = { withholdingRate:3.3, promoPerPost:10000, snsInstaMax:8, vatRate:10, cardFeeRate:2,
  lowSplitRate:40, rate60MinSales:3000000, rate50MinBlog:2, rate50MinStudy:1, trainerSplitRates:{} };
const trainers = [{ id:'t1', name:'박병준', color:'#f00' }];

describe('수동 고정 비율 보호', () => {
  // 6월 조건상 자동은 40%인데, 수동으로 60% 고정한 회원 + 자동 회원
  const members = [
    { id:'mA', name:'수동회원', isActive:true, trainerSessions:{ t1:{ total:10, remaining:5 } } },
    { id:'mB', name:'자동회원', isActive:true, trainerSessions:{ t1:{ total:10, remaining:5 } } },
  ];
  const payments = {
    mA:[{ id:'pA', paidAt:'2026-06-05', amount:300000, method:'transfer', trainerIds:['t1'],
      isReEnroll:true, reEnrollNo:1, splitRateAtPay:{t1:60}, rateManualFrozen:{t1:true},
      sessionAdds:[{trainerId:'t1',count:10}] }],
    mB:[{ id:'pB', paidAt:'2026-06-05', amount:300000, method:'transfer', trainerIds:['t1'],
      isReEnroll:true, reEnrollNo:1, splitRateAtPay:{t1:60}, // 수동 아님
      sessionAdds:[{trainerId:'t1',count:10}] }],
  };

  it('이 달 확정: 수동 고정(mA)은 60% 유지, 자동(mB)은 재판정', () => {
    const plan = buildRefreezePlan({ trainers, members, payments, records:[], settings, ym:'2026-06' });
    // mA는 patch에 없어야(안 바뀜) 하거나, 있어도 60 유지
    const pa = plan.patches.find(p=>p.mid==='mA');
    const pb = plan.patches.find(p=>p.mid==='mB');
    expect(pa).toBeUndefined();          // 수동 고정 → 변경 없음
    expect(pb?.splitRateAtPay.t1).toBe(40); // 자동 → 조건 40%로 재판정
  });

  it('전체 박제: 수동 고정(mA)은 유지, 자동(mB)만 재판정', () => {
    const plan = buildRefreezeAllPlan({ trainers, members, payments, records:[], settings });
    const pa = plan.patches.find(p=>p.mid==='mA');
    const pb = plan.patches.find(p=>p.mid==='mB');
    expect(pa).toBeUndefined();
    expect(pb?.splitRateAtPay.t1).toBe(40);
  });
});
