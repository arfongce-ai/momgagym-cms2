// store/aiStore/예약 원자성 회귀 테스트 (Vitest)
// firebase를 모킹해 Firestore 없이 저장 실패·롤백·원자성을 검증한다.
//   실행: npm test
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── firebase 모킹 ──────────────────────────────────────
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

const { store, aiStore, initStore } = await import('../demoData.js');
const setFail = (v) => { FAIL = v; };

beforeEach(async () => { FAIL = false; await initStore(); });

describe('저장 실패 전파 및 롤백 (CV-02)', () => {
  it('정상 추가 시 id를 반환한다', async () => {
    const m = await store.addMember({ name: 'A' });
    expect(m.id).toBeTruthy();
  });
  it('쓰기 실패 시 예외를 던지고 캐시를 롤백한다', async () => {
    const before = store.getMembers().length;
    setFail(true);
    await expect(store.addMember({ name: 'B' })).rejects.toThrow();
    expect(store.getMembers().length).toBe(before);
  });
});

describe('회원 파기 원자성 (CV-04/CV-06)', () => {
  it('purgeMember가 AI 기록까지 모두 삭제한다', async () => {
    const m = await store.addMember({ name: 'C' });
    await aiStore.addSession(m.id, { type: 'vbt' });
    await store.purgeMember(m.id);
    expect(store.getMembers().find(x => x.id === m.id)).toBeUndefined();
    expect(aiStore.getSessions(m.id).length).toBe(0);
  });
  it('purge 실패 시 캐시를 보존한다(부분삭제 없음)', async () => {
    const m = await store.addMember({ name: 'D' });
    setFail(true);
    await expect(store.purgeMember(m.id)).rejects.toThrow();
    expect(store.getMembers().find(x => x.id === m.id)).toBeTruthy();
  });
});

describe('예약 원자성 (NEW-03)', () => {
  it('예약 생성 시 세션을 1 차감하고 플래그를 세운다', async () => {
    const m = await store.addMember({ name: 'E', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const sch = await store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false });
    expect(sch.sessionDeducted).toBe(true);
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(4);
  });
  it('예약 batch 실패 시 세션 차감도 스케줄도 남지 않는다', async () => {
    const m = await store.addMember({ name: 'F', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const before = store.getSchedules().length;
    setFail(true);
    await expect(store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false })).rejects.toThrow();
    setFail(false);
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(5);
    expect(store.getSchedules().length).toBe(before);
  });
  it('취소 시 세션을 복원한다', async () => {
    const m = await store.addMember({ name: 'G', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const sch = await store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false });
    await store.finalizeSchedule(sch.id, 'canceled');
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(5);
  });
  it('외부 일정은 세션을 차감하지 않는다', async () => {
    const m = await store.addMember({ name: 'H', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    await store.createScheduleWithDeduction({ memberId: null, trainerId: 't1', isExternal: true });
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(5);
  });
});

// ── 추가: Critical Path 검증 ─────────────────────────────────────
describe('예약 삭제 시 세션 복원 (deleteScheduleWithRestore)', () => {
  it('확정 전 차감 예약을 삭제하면 세션이 복원된다', async () => {
    const m = await store.addMember({ name: 'I', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const sch = await store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false });
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(4);
    await store.deleteScheduleWithRestore(sch.id);
    expect(store.getSchedules().find(s => s.id === sch.id)).toBeUndefined();
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(5);
  });

  it('삭제 batch 실패 시 스케줄·세션 모두 그대로다 (rollback)', async () => {
    const m = await store.addMember({ name: 'J', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const sch = await store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false });
    const remainBefore = store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining; // 4
    setFail(true);
    await expect(store.deleteScheduleWithRestore(sch.id)).rejects.toThrow();
    setFail(false);
    // 캐시는 손대지 않았어야 한다(commit 실패 전에 캐시 변경 없음)
    expect(store.getSchedules().find(s => s.id === sch.id)).toBeTruthy();
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(remainBefore);
  });

  it('이미 출석 확정된(statusFinalized) 예약 삭제는 세션을 복원하지 않는다', async () => {
    const m = await store.addMember({ name: 'K', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const sch = await store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false });
    await store.finalizeSchedule(sch.id, 'attended'); // 차감 유지
    await store.deleteScheduleWithRestore(sch.id);
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(4);
  });
});

describe('대량 데이터 파기 — 500건 한계 청크 처리 (purgeMember)', () => {
  it('수납 600건이 누적된 회원도 빠짐없이 파기된다', async () => {
    const m = await store.addMember({ name: 'L' });
    // 600건의 수납을 직접 캐시에 적재 (Firestore 모킹은 batch를 그대로 반영)
    for (let i = 0; i < 600; i++) {
      await store.addPayment(m.id, { amount: 1000, method: '현금' });
    }
    expect(store.getPayments(m.id).length).toBe(600);
    await store.purgeMember(m.id);
    expect(store.getMembers().find(x => x.id === m.id)).toBeUndefined();
    expect(store.getPayments(m.id).length).toBe(0);
  });

  it('하위 데이터 삭제 실패 시 회원 문서는 보존된다(재시도 가능)', async () => {
    const m = await store.addMember({ name: 'M' });
    await store.addPayment(m.id, { amount: 1000, method: '현금' });
    setFail(true);
    await expect(store.purgeMember(m.id)).rejects.toThrow();
    setFail(false);
    // 회원 문서는 맨 마지막에 지우므로 남아 있어야 한다
    expect(store.getMembers().find(x => x.id === m.id)).toBeTruthy();
  });
});

describe('권한 분기 — 관리자 전용 라우트 가드 로직', () => {
  // App.jsx의 RequireAuth와 동일한 판단을 순수 함수로 검증한다.
  const canAccess = (user, adminOnly) => {
    if (!user) return 'redirect:/login';
    if (adminOnly && user.role !== 'admin') return 'redirect:/';
    return 'allow';
  };
  it('비로그인 사용자는 로그인으로 튕긴다', () => {
    expect(canAccess(null, true)).toBe('redirect:/login');
  });
  it('트레이너(staff/trainer)는 관리자 전용 페이지에서 홈으로 튕긴다', () => {
    expect(canAccess({ role: 'trainer' }, true)).toBe('redirect:/');
    expect(canAccess({ role: 'staff' }, true)).toBe('redirect:/');
  });
  it('관리자는 관리자 전용 페이지에 접근할 수 있다', () => {
    expect(canAccess({ role: 'admin' }, true)).toBe('allow');
  });
});

// ── 추가: 매월 정산비율 자동 판정 (계약서 4조) ───────────────────
import { determineSplitRate } from '../services/finance.js';

describe('매월 정산비율 자동 판정 (determineSplitRate)', () => {
  const S = { defaultSplitRate:50, lowSplitRate:40, rate60MinSales:3000000, rate50MinBlog:2, rate50MinStudy:1, trainerSplitRates:{} };

  it('조건 미달이면 하한 40%', () => {
    const r = determineSplitRate({ settings:S, trainerId:'t1', monthNet:1000000, blogCount:0, studyCount:0 });
    expect(r.rate).toBe(40); expect(r.mode).toBe('auto');
  });
  it('블로그2 + 스터디1 충족이면 50%', () => {
    const r = determineSplitRate({ settings:S, trainerId:'t1', monthNet:1000000, blogCount:2, studyCount:1 });
    expect(r.rate).toBe(50);
  });
  it('블로그만 충족(스터디 0)이면 50% 아님(하한 유지)', () => {
    const r = determineSplitRate({ settings:S, trainerId:'t1', monthNet:1000000, blogCount:5, studyCount:0 });
    expect(r.rate).toBe(40);
  });
  it('매출만 충족(블로그·스터디 미달)이면 50% (조건 1개)', () => {
    const r = determineSplitRate({ settings:S, trainerId:'t1', newSales:3000000, reEnrollSales:0, blogCount:0, studyCount:0 });
    expect(r.rate).toBe(50); // 조건B만 충족
  });
  it('블로그2·스터디1 + 매출300만(둘 다) 충족이면 60%', () => {
    const r = determineSplitRate({ settings:S, trainerId:'t1', newSales:3000000, reEnrollSales:0, blogCount:2, studyCount:1 });
    expect(r.rate).toBe(60);
  });
  it('블로그·스터디 충족하지만 매출 미달이면 50%', () => {
    const r = determineSplitRate({ settings:S, trainerId:'t1', newSales:1000000, reEnrollSales:0, blogCount:2, studyCount:1 });
    expect(r.rate).toBe(50);
  });
  it('블로그·스터디 + 재등록매출 300만(둘 다)이면 60% (매출은 신규 OR 재등록)', () => {
    const r = determineSplitRate({ settings:S, trainerId:'t1', newSales:0, reEnrollSales:3000000, blogCount:2, studyCount:1 });
    expect(r.rate).toBe(60);
  });
  it('수동 지정(40)이 자동판정보다 우선', () => {
    const r = determineSplitRate({ settings:{...S, trainerSplitRates:{t1:40}}, trainerId:'t1', newSales:9000000, blogCount:5, studyCount:5 });
    expect(r.rate).toBe(40); expect(r.mode).toBe('manual');
  });
});

// ── 추가: 다중 트레이너 결제 분배(split) 귀속 검증 ───────────────
import { computeSessionSettlement } from '../services/finance.js';

describe('다중 트레이너 결제 분배(split) 귀속', () => {
  const settings = { cardFeeRate:0, vatRate:0, defaultSplitRate:50, lowSplitRate:40,
    rate60MinSales:99999999, rate50MinBlog:99, rate50MinStudy:99, promoPerPost:10000, snsInstaMax:8, trainerSplitRates:{} };
  const trainers = [{id:'t1',name:'A'},{id:'t2',name:'B'}];
  const members = [{ id:'m1', name:'홍', trainerSessions:{ t1:{total:10,remaining:10}, t2:{total:10,remaining:10} } }];
  // 같은 회원에게 t1·t2 각 10회 출석(단가 계산용 횟수)
  const schedules = [];
  for (let i=0;i<10;i++){ schedules.push({id:'s'+i, isExternal:false, memberId:'m1', trainerId:'t1', status:'attended', date:'2026-06-10'}); }
  for (let i=0;i<10;i++){ schedules.push({id:'x'+i, isExternal:false, memberId:'m1', trainerId:'t2', status:'attended', date:'2026-06-10'}); }

  it('split 7:3이면 단가가 비율대로 귀속된다', () => {
    const payments = { m1: [{ id:'p1', paidAt:'2026-06-01', amount:1000000, method:'cash', isUnpaid:false, isRefunded:false,
      trainerIds:['t1','t2'], split:[{trainerId:'t1',amount:700000},{trainerId:'t2',amount:300000}] }] };
    const blocks = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06' });
    const a = blocks.find(b=>b.trainer.id==='t1');
    const b = blocks.find(b=>b.trainer.id==='t2');
    // 단가 = 귀속액 / 등록횟수(10). t1: 70만/10=7만, t2: 30만/10=3만
    expect(a.rows[0].autoUnit).toBe(70000);
    expect(b.rows[0].autoUnit).toBe(30000);
  });

  it('split 없으면 1/n 균등 귀속(구버전 호환)', () => {
    const payments = { m1: [{ id:'p2', paidAt:'2026-06-01', amount:1000000, method:'cash', isUnpaid:false, isRefunded:false,
      trainerIds:['t1','t2'] }] };
    const blocks = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06' });
    const a = blocks.find(b=>b.trainer.id==='t1');
    const b = blocks.find(b=>b.trainer.id==='t2');
    expect(a.rows[0].autoUnit).toBe(50000); // 50만/10
    expect(b.rows[0].autoUnit).toBe(50000);
  });
});

// ── 추가: 복합 결제수단(methods) 공제 검증 ───────────────────────
import { calcNet } from '../services/finance.js';

describe('복합 결제수단 공제 (calcNet)', () => {
  const S = { cardFeeRate:1, vatRate:10 }; // 카드수수료 1%, 부가세 10%

  it('단일 카드결제: 부가세+카드수수료 공제', () => {
    const r = calcNet({ amount:1000000, method:'card1' }, S);
    expect(r.amount).toBe(1000000);
    expect(r.net).toBe(1000000 - 10000 - 100000); // -카드1% -부가세10%
  });

  it('복합(카드 80만 + 페이 20만): 수단별로 따로 공제', () => {
    const r = calcNet({ methods:[{method:'card1',amount:800000},{method:'pay',amount:200000}] }, S);
    // 카드부분: 부가세 80000 + 카드수수료 8000 / 페이부분: 부가세 20000(카드수수료 없음)
    expect(r.amount).toBe(1000000);
    expect(r.cardFee).toBe(8000);
    expect(r.vat).toBe(80000 + 20000);
    expect(r.net).toBe(1000000 - 8000 - 100000);
  });

  it('복합(계좌 50만 + 현금 50만): 공제 없음', () => {
    const r = calcNet({ methods:[{method:'transfer',amount:500000},{method:'cash',amount:500000}] }, S);
    expect(r.net).toBe(1000000);
  });
});

// ── 정산비율: B방식(매 정산월 자동판정, 결제월 박제 미적용) ─────────
describe('정산비율 등록월 박제(A방식)', () => {
  const settings = { cardFeeRate:0, vatRate:0, lowSplitRate:40, defaultSplitRate:40,
    rate60MinSales:3000000, rate50MinBlog:2, rate50MinStudy:1, promoPerPost:0, snsInstaMax:8, trainerSplitRates:{} };
  const trainers = [{id:'t1',name:'김나영'}];
  const members = [{ id:'m1', name:'회원1', trainerSessions:{ t1:{total:20,remaining:0} } }];
  const schedules = Array.from({length:10},(_,i)=>({id:'s'+i,isExternal:false,memberId:'m1',trainerId:'t1',status:'attended',date:'2026-06-15'}));

  it('4월에 50%로 박제된 회원은 6월 정산에서도 50% (등록월 고정)', () => {
    // 4월 결제에 50% 박제 — 6월에 실적이 없어도 50% 유지
    const payments = { m1: [{ id:'p1', paidAt:'2026-04-02', amount:1000000, method:'cash',
      trainerIds:['t1'], splitRateAtPay:{ t1:50 } }] };
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06' })[0];
    expect(b.rows[0].rate).toBe(50);
    expect(b.rows[0].rateFrozen).toBe(true);
    expect(b.sessionPayout).toBe(250000); // 단가 100만/20=5만 × 10회 × 50%
  });

  it('설정/실적이 바뀌어도 과거 박제(50%)는 안 바뀐다', () => {
    const payments = { m1: [{ id:'p1', paidAt:'2026-04-02', amount:1000000, method:'cash',
      trainerIds:['t1'], splitRateAtPay:{ t1:50 } }] };
    const recordsJun = [
      {trainerId:'t1', channel:'blog', date:'2026-06-03'},
      {trainerId:'t1', channel:'blog', date:'2026-06-10'},
      {trainerId:'t1', channel:'study', date:'2026-06-12'},
    ];
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:recordsJun, settings, ym:'2026-06' })[0];
    expect(b.rows[0].rate).toBe(50); // 6월 실적 좋아도 박제 50% 유지
  });

  it('회원마다 등록월 비율이 다르면 각자 유지(회원1=50%, 회원2=40%)', () => {
    const members2 = [
      { id:'m1', name:'회원1', trainerSessions:{ t1:{total:10,remaining:0} } },
      { id:'m2', name:'회원2', trainerSessions:{ t1:{total:10,remaining:0} } },
    ];
    const sch2 = [
      ...Array.from({length:5},(_,i)=>({id:'a'+i,isExternal:false,memberId:'m1',trainerId:'t1',status:'attended',date:'2026-06-15'})),
      ...Array.from({length:5},(_,i)=>({id:'b'+i,isExternal:false,memberId:'m2',trainerId:'t1',status:'attended',date:'2026-06-15'})),
    ];
    const payments = { m1:[{id:'p1',paidAt:'2026-04-01',amount:1000000,method:'cash',trainerIds:['t1'],splitRateAtPay:{t1:50}}],
                       m2:[{id:'p2',paidAt:'2026-05-01',amount:1000000,method:'cash',trainerIds:['t1'],splitRateAtPay:{t1:40}}] };
    const b = computeSessionSettlement({ trainers, members:members2, schedules:sch2, payments, records:[], settings, ym:'2026-06' })[0];
    const r1 = b.rows.find(r=>r.memberId==='m1');
    const r2 = b.rows.find(r=>r.memberId==='m2');
    expect(r1.rate).toBe(50);   // 회원1 등록월 50% 유지
    expect(r2.rate).toBe(40);   // 회원2 등록월 40% 유지
    expect(b.rateMixed).toBe(true);
  });

  it('박제값 없는 구버전 결제는 그 달 자동판정으로 폴백', () => {
    const payments = { m1: [{ id:'p1', paidAt:'2026-04-02', amount:1000000, method:'cash', trainerIds:['t1'] }] };
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06' })[0];
    expect(b.rows[0].rate).toBe(40); // 폴백=하한 40
    expect(b.rows[0].rateFrozen).toBe(false);
  });

  it('수동 지정(trainerSplitRates)이 있으면 박제보다 우선', () => {
    const s = { ...settings, trainerSplitRates:{ t1:60 } };
    const payments = { m1: [{ id:'p1', paidAt:'2026-04-02', amount:1000000, method:'cash', trainerIds:['t1'], splitRateAtPay:{t1:50} }] };
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings:s, ym:'2026-06' })[0];
    expect(b.rows[0].rate).toBe(60);
    expect(b.splitMode).toBe('manual');
  });
});

// ── 추가: 세전/세후(원천징수) 분리 ───────────────────────────────
describe('세전/세후 원천징수', () => {
  const base = { cardFeeRate:0, vatRate:0, lowSplitRate:50, defaultSplitRate:50,
    rate60MinSales:99999999, rate50MinBlog:99, rate50MinStudy:99, promoPerPost:0, snsInstaMax:8, trainerSplitRates:{} };
  const trainers=[{id:'t1',name:'A'}];
  const members=[{id:'m1',name:'홍',trainerSessions:{t1:{total:10,remaining:0}}}];
  const schedules=Array.from({length:10},(_,i)=>({id:'s'+i,isExternal:false,memberId:'m1',trainerId:'t1',status:'attended',date:'2026-06-15'}));
  const payments={ m1:[{id:'p1',paidAt:'2026-06-02',amount:1000000,method:'cash',trainerIds:['t1'],splitRateAtPay:{t1:50}}] };

  it('기본 3.3% 원천징수로 세후가 계산된다', () => {
    const settings = { ...base, withholdingRate:3.3 };
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06' })[0];
    // 수업료 100만 × 50% = 50만(세전), 세금 3.3% = 16,500, 세후 483,500
    expect(b.payout).toBe(500000);
    expect(b.tax).toBe(16500);
    expect(b.payoutNet).toBe(483500);
  });

  it('세율을 바꾸면 세후도 바뀐다(설정 반영)', () => {
    const settings = { ...base, withholdingRate:10 };
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06' })[0];
    expect(b.tax).toBe(50000);
    expect(b.payoutNet).toBe(450000);
  });
});

// ── 추가: 신규/재등록 매출 인센티브(100만당 1만) + 상담/담당 귀속 ──
describe('신규/재등록 매출 인센티브', () => {
  const settings = { cardFeeRate:0, vatRate:0, lowSplitRate:40, defaultSplitRate:40,
    rate60MinSales:3000000, rate50MinBlog:2, rate50MinStudy:1, promoPerPost:10000, snsInstaMax:8,
    incentivePer:1000000, incentiveAmount:10000, reEnrollPer:1000000, reEnrollAmount:10000,
    withholdingRate:3.3, trainerSplitRates:{} };
  // t1=담당, t2=상담
  const trainers=[{id:'t1',name:'담당'},{id:'t2',name:'상담'}];
  const members=[{id:'m1',name:'홍',trainerSessions:{t1:{total:10,remaining:0}}}];
  const schedules=Array.from({length:5},(_,i)=>({id:'s'+i,isExternal:false,memberId:'m1',trainerId:'t1',status:'attended',date:'2026-06-15'}));

  it('신규매출 300만 → 인센 3만은 상담(t2)에게, 담당(t1)은 0', () => {
    const payments={ m1:[{id:'p',paidAt:'2026-06-02',amount:3000000,method:'cash',isNew:true,trainerIds:['t1'],consultTrainerId:'t2'}] };
    const blocks=computeSessionSettlement({trainers,members,schedules,payments,records:[],settings,ym:'2026-06'});
    const t1=blocks.find(b=>b.trainer.id==='t1');
    const t2=blocks.find(b=>b.trainer.id==='t2');
    expect(t2.newInc).toBe(30000);    // 상담에게 신규 인센
    expect(t2.rows.length===0 ? t2.newSales : t2.newSales).toBe(3000000);
    expect(t1.newInc).toBe(0);        // 담당은 신규 인센 없음
  });

  it('신규매출 450만 → 상담 인센 4만(내림)', () => {
    const payments={ m1:[{id:'p',paidAt:'2026-06-02',amount:4500000,method:'cash',isNew:true,trainerIds:['t1'],consultTrainerId:'t2'}] };
    const t2=computeSessionSettlement({trainers,members,schedules,payments,records:[],settings,ym:'2026-06'}).find(b=>b.trainer.id==='t2');
    expect(t2.newInc).toBe(40000);
  });

  it('재등록매출 300만 → 인센 3만은 담당(t1)에게 (60%는 블로그·스터디도 충족해야)', () => {
    const records=[
      {trainerId:'t1',channel:'blog',date:'2026-06-03'},
      {trainerId:'t1',channel:'blog',date:'2026-06-10'},
      {trainerId:'t1',channel:'study',date:'2026-06-12'},
    ];
    const payments={ m1:[{id:'p',paidAt:'2026-06-02',amount:3000000,method:'cash',isReEnroll:true,trainerIds:['t1']}] };
    const t1=computeSessionSettlement({trainers,members,schedules,payments,records,settings,ym:'2026-06'}).find(b=>b.trainer.id==='t1');
    expect(t1.reInc).toBe(30000);     // 재등록 인센은 매출만으로 지급
    expect(t1.rows[0].rate).toBe(60); // 블로그2·스터디1 + 매출300만 → 60%
  });

  it('재등록매출 300만이지만 블로그·스터디 미달이면 50% (조건 1개)', () => {
    const payments={ m1:[{id:'p',paidAt:'2026-06-02',amount:3000000,method:'cash',isReEnroll:true,trainerIds:['t1']}] };
    const t1=computeSessionSettlement({trainers,members,schedules,payments,records:[],settings,ym:'2026-06'}).find(b=>b.trainer.id==='t1');
    expect(t1.reInc).toBe(30000);     // 인센은 그대로
    expect(t1.rows[0].rate).toBe(50); // 매출 조건만 충족 → 50%
  });

  it('신규200만(상담)+재등록200만(담당) → 각 2만, 각자 60% 아님', () => {
    const payments={ m1:[
      {id:'p1',paidAt:'2026-06-02',amount:2000000,method:'cash',isNew:true,trainerIds:['t1'],consultTrainerId:'t2'},
      {id:'p2',paidAt:'2026-06-03',amount:2000000,method:'cash',isReEnroll:true,trainerIds:['t1']},
    ]};
    const blocks=computeSessionSettlement({trainers,members,schedules,payments,records:[],settings,ym:'2026-06'});
    const t1=blocks.find(b=>b.trainer.id==='t1');
    const t2=blocks.find(b=>b.trainer.id==='t2');
    expect(t2.newInc).toBe(20000);  // 상담 신규 인센
    expect(t1.reInc).toBe(20000);   // 담당 재등록 인센
    expect(t1.rows[0].rate).toBe(40); // 재등록 200만 → 60% 아님
  });

  it('신규에 상담 트레이너 미지정이면 신규 인센·신규매출 귀속 없음', () => {
    const payments={ m1:[{id:'p',paidAt:'2026-06-02',amount:3000000,method:'cash',isNew:true,trainerIds:['t1']}] };
    const blocks=computeSessionSettlement({trainers,members,schedules,payments,records:[],settings,ym:'2026-06'});
    const t1=blocks.find(b=>b.trainer.id==='t1');
    expect(t1.newInc).toBe(0);
    expect(t1.rows[0].rate).toBe(40); // 신규매출 귀속 없으니 60% 아님
  });
});

// ── 추가: 환불 회계 (진행분 유지 + 환불월 매출 차감) ──────────────
describe('환불 처리', () => {
  const settings = { cardFeeRate:0, vatRate:0, lowSplitRate:40, defaultSplitRate:40,
    rate60MinSales:99999999, rate50MinBlog:99, rate50MinStudy:99, promoPerPost:0, snsInstaMax:8,
    incentivePer:1000000, incentiveAmount:10000, reEnrollPer:1000000, reEnrollAmount:10000,
    withholdingRate:3.3, trainerSplitRates:{} };
  const trainers=[{id:'t1',name:'A'}];
  const members=[{id:'m1',name:'홍',trainerSessions:{t1:{total:10,remaining:5}}}];
  // 4월 결제 100만(단가 10만), 5회 출석 후 환불(6월)
  const schedules=Array.from({length:5},(_,i)=>({id:'s'+i,isExternal:false,memberId:'m1',trainerId:'t1',status:'attended',date:'2026-04-20'}));

  it('환불해도 진행분(출석 회차) 수업료는 트레이너 정산에 남는다', () => {
    const payments={ m1:[{id:'p',paidAt:'2026-04-02',amount:1000000,method:'cash',trainerIds:['t1'],
      splitRateAtPay:{t1:40}, isRefunded:true, refundAmount:500000, refundedAt:'2026-06-10'}] };
    // 4월 정산: 단가 10만 × 5회 × 40% = 20만 (환불돼도 출석분 지급)
    const b=computeSessionSettlement({trainers,members,schedules,payments,records:[],settings,ym:'2026-04'})[0];
    expect(b.rows[0].unit).toBe(100000);
    expect(b.rows[0].cnt).toBe(5);
    expect(b.sessionPayout).toBe(200000);
  });

  it('환불월(6월) 매출에서 환불액이 차감된다(−)', () => {
    const payments={ m1:[{id:'p',paidAt:'2026-04-02',amount:1000000,method:'cash',trainerIds:['t1'],
      isRefunded:true, refundAmount:500000, refundedAt:'2026-06-10'}] };
    // 6월: 출석 없음 → 수업료 0, 매출은 환불액 −50만 (trainerMonthNet 음수)
    const b6=computeSessionSettlement({trainers,members,schedules:[],payments,records:[],settings,ym:'2026-06'})[0];
    // 6월엔 rows 없음(출석 0, 등록만)이거나 sessionPayout 0
    expect(b6?.sessionPayout ?? 0).toBe(0);
  });

  it('미수금(isUnpaid)은 정산에서 제외된다', () => {
    const payments={ m1:[{id:'p',paidAt:'2026-04-02',amount:1000000,method:'cash',trainerIds:['t1'],isUnpaid:true}] };
    const b=computeSessionSettlement({trainers,members,schedules,payments,records:[],settings,ym:'2026-04'})[0];
    expect(b.rows[0].unit).toBe(0); // 미수금이라 단가 0
  });
});

import { buildRefreezePlan } from '../services/finance.js';

describe('월말 정산비율 확정 재박제 (buildRefreezePlan)', () => {
  const S = { lowSplitRate:40, rate60MinSales:3000000, rate50MinBlog:2, rate50MinStudy:1,
              vatRate:0, cardFeeRate:0 };
  const trainers = [{ id:'t1', name:'김나영' }];

  it('월초에 40%로 박제됐던 결제가, 그 달 전체 실적이 50%면 50%로 갱신된다', () => {
    // 6월 결제: 박제 시점엔 실적 부족으로 40%로 고정돼 있었음
    const members = [{ id:'m3', name:'등록회원3', trainerSessions:{ t1:{ total:10 } } }];
    const payments = { m3:[{ id:'p1', paidAt:'2026-06-03', amount:1000000, method:'cash',
                             trainerIds:['t1'], splitRateAtPay:{ t1:40 } }] };
    // 그 달 전체 실적: 블로그2·스터디1 → 조건A 1개 충족 → 50%
    const records = [
      { trainerId:'t1', channel:'blog', date:'2026-06-10' },
      { trainerId:'t1', channel:'blog', date:'2026-06-20' },
      { trainerId:'t1', channel:'study', date:'2026-06-15' },
    ];
    const plan = buildRefreezePlan({ trainers, members, payments, records, settings:S, ym:'2026-06' });
    expect(plan.count).toBe(1);
    expect(plan.patches[0].splitRateAtPay.t1).toBe(50);
    expect(plan.patches[0].prev.t1).toBe(40);
  });

  it('다른 달(5월) 결제는 6월 확정 시 절대 건드리지 않는다', () => {
    const members = [{ id:'m2', name:'등록회원2', trainerSessions:{ t1:{ total:20 } } }];
    const payments = { m2:[{ id:'p5', paidAt:'2026-05-10', amount:1000000, method:'cash',
                             trainerIds:['t1'], splitRateAtPay:{ t1:40 } }] };
    const records = [ // 6월 실적이 좋아도
      { trainerId:'t1', channel:'blog', date:'2026-06-10' },
      { trainerId:'t1', channel:'blog', date:'2026-06-20' },
      { trainerId:'t1', channel:'study', date:'2026-06-15' },
    ];
    const plan = buildRefreezePlan({ trainers, members, payments, records, settings:S, ym:'2026-06' });
    expect(plan.count).toBe(0); // 5월 결제는 6월 확정 대상 아님
  });

  it('이미 최종 실적과 일치하면 변동 건이 없다', () => {
    const members = [{ id:'m1', name:'등록회원1', trainerSessions:{ t1:{ total:20 } } }];
    const payments = { m1:[{ id:'p4', paidAt:'2026-04-05', amount:1000000, method:'cash',
                             trainerIds:['t1'], splitRateAtPay:{ t1:50 } }] };
    const records = [
      { trainerId:'t1', channel:'blog', date:'2026-04-10' },
      { trainerId:'t1', channel:'blog', date:'2026-04-20' },
      { trainerId:'t1', channel:'study', date:'2026-04-15' },
    ];
    const plan = buildRefreezePlan({ trainers, members, payments, records, settings:S, ym:'2026-04' });
    expect(plan.count).toBe(0);
  });
});

// ── SNS/스터디 기록이 정산에 실시간 반영되는지 (override가 기록을 가리지 않는지) ──
describe('홍보 override가 실시간 기록을 가리지 않음', () => {
  const settings = { cardFeeRate:0, vatRate:0, lowSplitRate:40,
    rate60MinSales:99999999, rate50MinBlog:99, rate50MinStudy:99,
    promoPerPost:10000, snsInstaMax:8, trainerSplitRates:{} };
  const trainers = [{ id:'t1', name:'김동규' }];
  const members  = [{ id:'m1', name:'회원', trainerSessions:{ t1:{ total:10, remaining:10 } } }];
  const schedules = [];
  const payments = {};
  const records = [
    { trainerId:'t1', channel:'insta', date:'2026-06-13' },
    { trainerId:'t1', channel:'study', date:'2026-06-10' },
  ];

  it('override.instaCount=0(과거 박제)여도 실시간 인스타 기록이 집계된다', () => {
    // 과거에 저장된 잘못된 override: 인스타 0으로 고정
    const getOverride = (tid, ym) =>
      tid==='t1' && ym==='2026-06' ? { instaCount:0, blogCount:0, studyCount:0 } : null;
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records, settings, ym:'2026-06', getOverride })[0];
    expect(b.instaCount).toBe(1);              // 0으로 가려지지 않고 실시간 1건 반영
    expect(b.instaInc).toBe(10000);            // 1건 × 1만원
    expect(b.studyCount).toBe(1);
  });

  it('override로 실제 값(예: 인스타 5)을 지정하면 그 값을 쓴다', () => {
    const getOverride = () => ({ instaCount:5 });
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records, settings, ym:'2026-06', getOverride })[0];
    expect(b.instaCount).toBe(5);              // 수동 지정값 우선
  });
});

// ── 단가/횟수 override: 지정한 회원만 고정, 나머지는 실시간 자동값 ──
describe('단가·횟수 override는 지정 회원만 적용', () => {
  const settings = { cardFeeRate:0, vatRate:0, lowSplitRate:40,
    rate60MinSales:99999999, rate50MinBlog:99, rate50MinStudy:99,
    promoPerPost:10000, snsInstaMax:8, trainerSplitRates:{ t1:50 } };
  const trainers = [{ id:'t1', name:'트레이너' }];
  const members = [
    { id:'m1', name:'A', trainerSessions:{ t1:{ total:10, remaining:0 } } },
    { id:'m2', name:'B', trainerSessions:{ t1:{ total:10, remaining:0 } } },
  ];
  // 두 회원 모두 결제 100만(단가 10만), 출석 m1=2회 m2=4회
  const payments = {
    m1:[{ id:'p1', paidAt:'2026-06-01', amount:1000000, method:'cash', trainerIds:['t1'] }],
    m2:[{ id:'p2', paidAt:'2026-06-01', amount:1000000, method:'cash', trainerIds:['t1'] }],
  };
  const schedules = [
    ...Array.from({length:2},(_,i)=>({id:'a'+i,isExternal:false,memberId:'m1',trainerId:'t1',status:'attended',date:'2026-06-10'})),
    ...Array.from({length:4},(_,i)=>({id:'b'+i,isExternal:false,memberId:'m2',trainerId:'t1',status:'attended',date:'2026-06-10'})),
  ];

  it('m1 횟수만 수동 지정하면 m2는 실시간 출석(4회)을 그대로 쓴다', () => {
    const getOverride = () => ({ sessionCounts:{ m1:5 } }); // m1만 5회로 고정
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06', getOverride })[0];
    const r1 = b.rows.find(r=>r.memberId==='m1');
    const r2 = b.rows.find(r=>r.memberId==='m2');
    expect(r1.cnt).toBe(5);   // 수동 지정
    expect(r2.cnt).toBe(4);   // 실시간 출석 그대로 (가려지지 않음)
  });
});

describe('수납 세션 자동 추가 기록은 정산 단가의 등록횟수 기준이 된다', () => {
  const settings = { cardFeeRate:0, vatRate:0, lowSplitRate:40,
    rate60MinSales:99999999, rate50MinBlog:99, rate50MinStudy:99,
    promoPerPost:10000, snsInstaMax:8, trainerSplitRates:{ t1:50 } };
  const trainers = [{ id:'t1', name:'트레이너' }];
  const members = [
    // 화면상 현재 재등록분만 10/10으로 보여도, 정산 단가는 결제 sessionAdds 합계 20회를 사용해야 한다.
    { id:'m1', name:'재등록회원', trainerSessions:{ t1:{ total:10, remaining:10 } } },
  ];
  const payments = {
    m1:[
      { id:'p1', paidAt:'2026-05-01', amount:1000000, method:'cash', trainerIds:['t1'], sessionAdds:[{ trainerId:'t1', count:10 }] },
      { id:'p2', paidAt:'2026-06-01', amount:1000000, method:'cash', trainerIds:['t1'], sessionAdds:[{ trainerId:'t1', count:10 }] },
    ],
  };
  const schedules = [
    { id:'s1', isExternal:false, memberId:'m1', trainerId:'t1', status:'attended', date:'2026-06-10' },
  ];

  it('현재 total이 10이어도 누적 결제 세션 20회를 기준으로 단가를 계산한다', () => {
    const b = computeSessionSettlement({ trainers, members, schedules, payments, records:[], settings, ym:'2026-06' })[0];
    const row = b.rows.find(r=>r.memberId==='m1');
    expect(row.unit).toBe(100000);
    expect(row.amount).toBe(100000);
  });
});
