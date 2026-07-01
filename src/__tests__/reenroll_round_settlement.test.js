import { describe, it, expect } from 'vitest';
import { computeSessionSettlement } from '../services/finance.js';
const YM='2026-06';
const trainers=[{id:'t1',name:'T',color:'#f00'}];
const settings={withholdingRate:3.3,promoPerPost:10000,snsInstaMax:8,lowSplitRate:40,rate60MinSales:3000000,rate50MinBlog:2,rate50MinStudy:1,trainerSplitRates:{}};
function build(remaining, seq){
  const members=[{id:'m1',name:'회원',isActive:true,trainerSessions:{t1:{total:20,remaining}}}];
  const payments={m1:[
    {id:'p1',paidAt:'2026-04-01',method:'cash',amount:500000,trainerIds:['t1'],isNew:true,
      splitRateAtPay:{t1:60}, sessionAdds:[{trainerId:'t1',count:10}]},
    {id:'p2',paidAt:'2026-06-01',method:'cash',amount:550000,trainerIds:['t1'],isReEnroll:true,reEnrollNo:2,
      splitRateAtPay:{t1:60}, sessionAdds:[{trainerId:'t1',count:10}]},
  ]};
  const sched=seq.map((rb,i)=>({id:`s${i}`,memberId:'m1',trainerId:'t1',
    date:`2026-06-${String(10+i).padStart(2,'0')}`,status:'attended',isExternal:false,sessionAtBooking:rb}));
  const blocks=computeSessionSettlement({trainers,members,schedules:sched,payments,records:[],settings,ym:YM,getOverride:()=>null});
  return blocks[0].rows.find(r=>r.memberId==='m1');
}
describe('회차별 재등록 정산', ()=>{
  it('재등록2회차 5회 → 단가55000·60%·165000·라벨', ()=>{
    const r=build(5,[5,4,3,2,1]);
    expect(r.autoCnt).toBe(5);
    expect(Math.round(r.autoUnit)).toBe(55000);
    expect(r.regReEnrollNo).toBe(2);
    expect(r.regRound).toBe('재등록 2회차');
    expect(r.payAmount).toBe(165000);
  });
  it('신규 잔여2회 + 재등록3회 혼합 → 회차별·159000', ()=>{
    const r=build(12,[12,11,10,9,8]);
    expect(r.autoCnt).toBe(5);
    expect(r.regRound).toBe('회차별');
    expect(r.payAmount).toBe(159000);
    const bd=r.settlementBreakdown;
    expect(bd.length).toBe(2);
    expect(bd.find(b=>b.label==='신규').payAmount).toBe(60000);
    expect(bd.find(b=>b.label==='재등록 2회차').payAmount).toBe(99000);
  });
  it('구버전(sessionAtBooking 없음) → __aggregate__ 폴백, 크래시 없음', ()=>{
    const members=[{id:'m1',name:'회원',isActive:true,trainerSessions:{t1:{total:20,remaining:5}}}];
    const payments={m1:[
      {id:'p1',paidAt:'2026-04-01',method:'cash',amount:500000,trainerIds:['t1'],isNew:true,splitRateAtPay:{t1:60},sessionAdds:[{trainerId:'t1',count:10}]},
      {id:'p2',paidAt:'2026-06-01',method:'cash',amount:550000,trainerIds:['t1'],isReEnroll:true,reEnrollNo:2,splitRateAtPay:{t1:60},sessionAdds:[{trainerId:'t1',count:10}]},
    ]};
    const sched=Array.from({length:5},(_,i)=>({id:`s${i}`,memberId:'m1',trainerId:'t1',date:`2026-06-1${i}`,status:'attended',isExternal:false}));
    const blocks=computeSessionSettlement({trainers,members,schedules:sched,payments,records:[],settings,ym:YM,getOverride:()=>null});
    const r=blocks[0].rows.find(x=>x.memberId==='m1');
    expect(r.autoCnt).toBe(5);
    expect(r.payAmount).toBeGreaterThan(0);
  });
});
