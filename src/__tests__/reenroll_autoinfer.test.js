import { describe, it, expect } from 'vitest';
import { computeSessionSettlement } from '../services/finance.js';
const YM='2026-06';
const trainers=[{id:'t1',name:'김나영',color:'#00f'}];
const settings={withholdingRate:3.3,promoPerPost:10000,snsInstaMax:8,lowSplitRate:40,rate60MinSales:3000000,rate50MinBlog:2,rate50MinStudy:1,trainerSplitRates:{}};
function base(remaining, sched){
  const members=[{id:'m1',name:'정재은',isActive:true,trainerSessions:{t1:{total:25,remaining}}}];
  const payments={m1:[
    {id:'p6',paidAt:'2026-03-01',method:'cash',amount:986000,trainerIds:['t1'],isReEnroll:true,reEnrollNo:6,splitRateAtPay:{t1:60},sessionAdds:[{trainerId:'t1',count:20}]},
    {id:'p7',paidAt:'2026-06-01',method:'cash',amount:246400,trainerIds:['t1'],isReEnroll:true,reEnrollNo:7,splitRateAtPay:{t1:60},sessionAdds:[{trainerId:'t1',count:5}]},
  ]};
  const blocks=computeSessionSettlement({trainers,members,schedules:sched,payments,records:[],settings,ym:YM,getOverride:()=>null});
  return blocks[0].rows.find(r=>r.memberId==='m1');
}
const mk=(i,at)=>({id:`s${i}`,memberId:'m1',trainerId:'t1',date:`2026-06-${String(10+i).padStart(2,'0')}`,status:'attended',isExternal:false,...(at!=null?{sessionAtBooking:at}:{})});

describe('회차 자동보정 — 다양한 상태', ()=>{
  it('booking 전무 · 6월 7세션 다 출석(remaining0) → 6회차2 / 7회차5', ()=>{
    const r=base(0, [7,6,5,4,3,2,1].map((_,i)=>mk(i,null)));
    const bd=r.settlementBreakdown;
    expect(bd.find(b=>b.reEnrollNo===6)?.count).toBe(2);
    expect(bd.find(b=>b.reEnrollNo===7)?.count).toBe(5);
  });
  it('일부만 booking 기록 · 나머지 자동보정 → 합산 동일', ()=>{
    // 앞 2개만 booking(7,6=6회차), 뒤 5개 없음
    const sched=[mk(0,7),mk(1,6),mk(2,null),mk(3,null),mk(4,null),mk(5,null),mk(6,null)];
    const r=base(0, sched);
    const bd=r.settlementBreakdown;
    expect(bd.find(b=>b.reEnrollNo===6)?.count).toBe(2);
    expect(bd.find(b=>b.reEnrollNo===7)?.count).toBe(5);
  });
  it('기록된 booking 값은 자동추정으로 덮어쓰지 않음(정직성)', ()=>{
    // 명시적으로 전부 7회차(1~5)로 booking된 5세션 → 자동추정 무시하고 그대로
    const r=base(0, [5,4,3,2,1].map((v,i)=>mk(i,v)));
    const bd=r.settlementBreakdown;
    expect(bd.filter(x=>x.count>0).every(b=>b.reEnrollNo===7)).toBe(true);
    expect(bd.find(b=>b.reEnrollNo===7)?.count).toBe(5);
  });
});
