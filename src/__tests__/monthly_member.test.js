// 월정액(monthly) + 세션 병행 구조 검증
//  · 한 회원이 세션과 월정액을 동시에 보유
//  · 월정액은 세션 차감 없음 + 트레이너 정산 제외(센터 수익으로만 합산)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isMonthlyActive, monthlyDueOf, addMonthsYMD, addDaysYMD, todayYMD } from '../utils/dates';
import { isMemberExpired } from '../services/sessionExpiry';

let FAIL = false;
const mem = {};
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: (_db, name, id) => ({ name, id }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async (ref, data) => { if (FAIL) throw new Error('denied'); (mem[ref.name] ||= {})[ref.id] = data; },
  deleteDoc: async (ref) => { if (FAIL) throw new Error('denied'); if (mem[ref.name]) delete mem[ref.name][ref.id]; },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(['set', ref, data]),
      delete: (ref) => ops.push(['del', ref]),
      commit: async () => {
        if (FAIL) throw new Error('batch denied');
        for (const [t, ref, data] of ops) {
          if (t === 'set') (mem[ref.name] ||= {})[ref.id] = data;
          else if (mem[ref.name]) delete mem[ref.name][ref.id];
        }
      },
    };
  },
}));

import { store } from '../demoData';
import { computeSessionSettlement } from '../services/finance';

beforeEach(() => { FAIL = false; });

const trainers = [{ id:'t1', name:'트레이너1', color:'#f00' }];
const M = (id) => store.getMembers().find(m => m.id === id);

describe('날짜 헬퍼', () => {
  it('한 달 뒤 / 말일 보정', () => {
    expect(addMonthsYMD(1, '2026-01-15')).toBe('2026-02-15');
    expect(addMonthsYMD(1, '2026-01-31')).toBe('2026-02-28');
  });
});

describe('월정액 헬퍼: isMonthlyActive / monthlyDueOf', () => {
  it('새 구조 monthly.active 인식', () => {
    expect(isMonthlyActive({ monthly:{ active:true, dueDate:'2026-07-01' } })).toBe(true);
    expect(monthlyDueOf({ monthly:{ active:true, dueDate:'2026-07-01' } })).toBe('2026-07-01');
  });
  it('구버전 membershipType 호환', () => {
    expect(isMonthlyActive({ membershipType:'monthly' })).toBe(true);
  });
  it('월정액 없음', () => {
    expect(isMonthlyActive({ trainerSessions:{ t1:{ total:10, remaining:5 } } })).toBe(false);
  });
});

describe('만료 판정 (월정액 7일 경고 + 세션제 등록분 유효기간)', () => {
  const settings = {}; // 기본값(expiryDaysPer10Sessions=90일) 사용

  it('월정액 예정일 8일 이상 남으면 정상', () => {
    expect(isMemberExpired({ monthly:{ active:true, dueDate: addDaysYMD(10) } }, [], settings)).toBe(false);
  });
  it('월정액 예정일 7일 이내면 만료 표시', () => {
    expect(isMemberExpired({ monthly:{ active:true, dueDate: addDaysYMD(5) } }, [], settings)).toBe(true);
  });
  it('세션제: 10회 등록 후 90일(3개월) 이내면 잔여 있어도 정상', () => {
    const m = { id:'sm1', trainerSessions:{ t1:{ total:10, remaining:4 } } };
    const payments = [{ id:'p1', amount:500000, method:'cash', paidAt: addDaysYMD(-60), trainerIds:['t1'],
      sessionAdds:[{ trainerId:'t1', count:10 }] }];
    expect(isMemberExpired(m, payments, settings)).toBe(false);
  });
  it('세션제: 10회 등록 후 90일(3개월)이 지났는데 잔여가 남아있으면 만료', () => {
    const m = { id:'sm2', trainerSessions:{ t1:{ total:10, remaining:4 } } };
    const payments = [{ id:'p2', amount:500000, method:'cash', paidAt: addDaysYMD(-120), trainerIds:['t1'],
      sessionAdds:[{ trainerId:'t1', count:10 }] }];
    expect(isMemberExpired(m, payments, settings)).toBe(true);
  });
  it('세션제: 유효기간이 지났어도 이미 다 소진했으면(잔여 0) 만료 아님', () => {
    const m = { id:'sm3', trainerSessions:{ t1:{ total:10, remaining:0 } } };
    const payments = [{ id:'p3', amount:500000, method:'cash', paidAt: addDaysYMD(-200), trainerIds:['t1'],
      sessionAdds:[{ trainerId:'t1', count:10 }] }];
    expect(isMemberExpired(m, payments, settings)).toBe(false);
  });
  it('세션+월정액 병행: 둘 중 하나만 만료여도 만료', () => {
    const m = {
      id:'sm4',
      trainerSessions:{ t1:{ total:10, remaining:4 } },
      monthly:{ active:true, dueDate: addDaysYMD(3) },
    };
    const payments = [{ id:'p4', amount:500000, method:'cash', paidAt: addDaysYMD(-10), trainerIds:['t1'],
      sessionAdds:[{ trainerId:'t1', count:10 }] }];
    expect(isMemberExpired(m, payments, settings)).toBe(true);
  });
});

describe('세션+월정액 병행 회원의 스케줄 차감', () => {
  it('세션 슬롯이 있으면 예약 시 차감된다(월정액 병행이어도)', async () => {
    const m = await store.addMember({
      name:'병행회원',
      trainerSessions:{ t1:{ total:10, remaining:10 } },
      monthly:{ active:true, fee:100000, dueDate: addMonthsYMD(1) },
      isActive:true,
    });
    const sch = await store.createScheduleWithDeduction({
      memberId:m.id, trainerId:'t1', isExternal:false,
      date: todayYMD(), startTime:'10:00', endTime:'11:00', classType:'PT', status:'scheduled',
    });
    expect(sch.sessionDeducted).toBe(true);
    expect(M(m.id).trainerSessions.t1.remaining).toBe(9);
  });

  it('월정액만 있는 회원(세션 슬롯 없음)은 차감 안 함', async () => {
    const m = await store.addMember({
      name:'월정액전용', trainerSessions:{},
      monthly:{ active:true, fee:80000, dueDate: addMonthsYMD(1) }, isActive:true,
    });
    const sch = await store.createScheduleWithDeduction({
      memberId:m.id, trainerId:'t1', isExternal:false,
      date: todayYMD(), startTime:'10:00', endTime:'11:00', classType:'그룹', status:'scheduled',
    });
    expect(sch.sessionDeducted).toBe(false);
    expect(M(m.id).trainerSessions.t1).toBeUndefined();
  });
});

describe('월정액 매출은 트레이너 정산에서 제외, 센터 수익에만', () => {
  const settleFor = (members, payments) => computeSessionSettlement({
    trainers, members, schedules: [],
    payments, records: [], settings: { withholdingRate:3.3 }, ym:'2026-06',
    getOverride: ()=>null,
  });

  it('월정액 결제(isMonthly)는 정산 단가에 잡히지 않는다', () => {
    const members = [{ id:'mm1', name:'A', trainerSessions:{ t1:{ total:10, remaining:8 } }, lastPaymentDate:'2026-06-01' }];
    const payments = { mm1: [
      { id:'p1', amount:540000, method:'현금', paidAt:'2026-06-01', trainerIds:['t1'], splitRateAtPay:{t1:50} },
      { id:'p2', amount:100000, method:'현금', paidAt:'2026-06-05', trainerIds:['t1'], isMonthly:true },
    ]};
    const blocks = settleFor(members, payments);
    const b = blocks.find(x=>x.trainer.id==='t1');
    const row = b.rows.find(r=>r.memberId==='mm1');
    expect(row.unit).toBe(54000); // 월정액 섞였다면 64000
  });

  it('월정액만 결제한 회원은 정산 매출이 0', () => {
    const members = [{ id:'mm2', name:'B', trainerSessions:{}, monthly:{active:true,fee:100000,dueDate:'2026-07-01'}, lastPaymentDate:'2026-06-01' }];
    const payments = { mm2: [
      { id:'p3', amount:100000, method:'현금', paidAt:'2026-06-03', trainerIds:['t1'], isMonthly:true },
    ]};
    const blocks = settleFor(members, payments);
    const b = blocks.find(x=>x.trainer.id==='t1');
    const row = b?.rows?.find(r=>r.memberId==='mm2');
    expect(row?.unit ?? 0).toBe(0);
  });
});

describe('월정액 결제 시 다음 예정일 갱신 로직(단위)', () => {
  const nextDue = (monthly, paidAt) => {
    const curDue = monthly.dueDate;
    const base = (curDue && curDue >= paidAt) ? curDue : paidAt;
    return addMonthsYMD(1, base);
  };
  it('예정일 전 미리 결제 → 기존 예정일 +1개월', () => {
    expect(nextDue({ dueDate:'2026-07-15' }, '2026-07-10')).toBe('2026-08-15');
  });
  it('예정일 지나 결제 → 결제일 +1개월', () => {
    expect(nextDue({ dueDate:'2026-06-15' }, '2026-07-02')).toBe('2026-08-02');
  });
});
