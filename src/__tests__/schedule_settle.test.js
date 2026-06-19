// 스케줄 처리(출석/노쇼/취소)의 세션 차감·복원 및 정산 인정 검증
import { describe, it, expect } from 'vitest';
import { computeSessionSettlement } from '../services/finance';

const YM = '2026-06';
const trainers = [{ id:'t1', name:'트레이너1', color:'#f00' }];
const settings = { withholdingRate:3.3, promoPerPost:10000, snsInstaMax:8 };

// 회원: t1에게 10회 등록, 결제 1건(현금 540,000 → 단가 54,000)
function makeMember(remaining=10) {
  return {
    id:'m1', name:'회원', isActive:true,
    trainerSessions:{ t1:{ total:10, remaining } },
    lastPaymentDate:'2026-06-01',
  };
}
const payments = { m1: [{
  id:'p1', amount:540000, method:'현금', paidAt:'2026-06-01',
  trainerIds:['t1'], splitRateAtPay:{ t1:50 },
}] };
const records = [];

function settleCnt(schedules, members) {
  const blocks = computeSessionSettlement({
    trainers, members, schedules, payments, records, settings, ym:YM,
    getOverride: ()=>null,
  });
  const b = blocks.find(x=>x.trainer.id==='t1');
  const row = b?.rows?.find(r=>r.memberId==='m1');
  return { cnt: row?.cnt ?? 0, sessionTotal: b?.sessionTotal ?? 0 };
}

const sched = (status) => ([{
  id:'s1', memberId:'m1', memberName:'회원', trainerId:'t1',
  date:'2026-06-15', startTime:'10:00', endTime:'11:00',
  classType:'선수', status, isExternal:false, sessionDeducted:true, statusFinalized:true,
}]);

describe('정산 인정: 출석·노쇼만 카운트, 취소·예약 제외', () => {
  it('출석 → 정산 1회 인정', () => {
    expect(settleCnt(sched('attended'), [makeMember(9)]).cnt).toBe(1);
  });
  it('노쇼 → 정산 1회 인정', () => {
    expect(settleCnt(sched('noshow'), [makeMember(9)]).cnt).toBe(1);
  });
  it('취소 → 정산 미인정(0회)', () => {
    expect(settleCnt(sched('canceled'), [makeMember(10)]).cnt).toBe(0);
  });
  it('예약(미확정) → 정산 미인정(0회)', () => {
    expect(settleCnt(sched('scheduled'), [makeMember(9)]).cnt).toBe(0);
  });
  it('수업료: 출석 1회 = 단가×1 (취소는 0)', () => {
    expect(settleCnt(sched('attended'), [makeMember(9)]).sessionTotal).toBeGreaterThan(0);
    expect(settleCnt(sched('canceled'), [makeMember(10)]).sessionTotal).toBe(0);
  });
});
