// demoData.js — v6 (Firebase 연동)
// ⚠️ 화면 코드는 그대로 둡니다. store / aiStore 의 사용법은 기존과 호환됩니다.
//    내부 저장소만 "브라우저(localStorage)" → "Firebase(Firestore) + 로컬 캐시"로 바뀌었습니다.

import { db } from './firebase';
import {
  collection, doc, getDocs, setDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';

const DATA_VERSION = 'v6.0';

// 로그인 계정은 Firebase Authentication + roles 문서로 관리합니다.
// (이전의 평문 비밀번호 DEMO_USERS는 보안상 제거되었습니다.)

function fmt(d){ return new Date(d).toISOString().slice(0,10); }
function ago(d,n){ const r=new Date(d); r.setDate(r.getDate()-n); return r; }
const today = new Date();

const INITIAL_TRAINERS = [
  { id:'t1', name:'김민준', phone:'010-1234-5678', birthDate:'1990-03-15', hireDate:'2021-01-10', classTypes:['재활','컨디셔닝'], status:'full',      color:'#f59e0b', memo:'주력: 재활운동' },
  { id:'t2', name:'이서연', phone:'010-9876-5432', birthDate:'1993-07-22', hireDate:'2022-05-01', classTypes:['6대체력','다이어트'], status:'freelance', color:'#10b981', memo:'주 4일 근무'  },
  { id:'t3', name:'박지훈', phone:'010-5555-1234', birthDate:'1988-11-08', hireDate:'2020-03-15', classTypes:['선수','6대체력'],   status:'full',      color:'#6366f1', memo:'' },
];
const INITIAL_MEMBERS = [
  { id:'m1', name:'홍길동', phone:'010-1111-2222', birthDate:'1985-06-20',
    joinDate:'2024-01-15', lastPaymentDate:'2024-11-01', lastAttendedDate:fmt(ago(today,16)),
    classTypes:['재활'], memo:'무릎 부상 이력',
    trainerSessions:{ t1:{total:20,remaining:8} }, isActive:true },
  { id:'m2', name:'김영희', phone:'010-3333-4444', birthDate:'1992-03-12',
    joinDate:'2024-03-20', lastPaymentDate:'2025-02-15', lastAttendedDate:fmt(ago(today,6)),
    classTypes:['트레이닝','컨디셔닝'], memo:'',
    trainerSessions:{ t1:{total:10,remaining:10}, t2:{total:12,remaining:3} }, isActive:true },
  { id:'m3', name:'이철수', phone:'010-5555-6666', birthDate:'1978-09-05',
    joinDate:'2023-06-01', lastPaymentDate:'2023-07-01', lastAttendedDate:'2023-08-20',
    classTypes:['재활'], memo:'장기 미방문',
    trainerSessions:{ t2:{total:20,remaining:0} }, isActive:true },
  { id:'m4', name:'박수진', phone:'010-7777-8888', birthDate:'1995-12-30',
    joinDate:'2025-01-10', lastPaymentDate:'2025-01-10', lastAttendedDate:fmt(ago(today,4)),
    classTypes:['선수'], memo:'',
    trainerSessions:{ t2:{total:8,remaining:4} }, isActive:true },
  { id:'m5', name:'최민호', phone:'010-9999-0000', birthDate:'1988-04-18',
    joinDate:'2024-09-01', lastPaymentDate:'2024-09-01', lastAttendedDate:fmt(ago(today,11)),
    classTypes:['컨디셔닝'], memo:'대회 준비',
    trainerSessions:{ t3:{total:30,remaining:2} }, isActive:true },
];
const INITIAL_PAYMENTS = {
  m1: [
    { id:'p1', paidAt:'2024-01-15', amount:500000, method:'card',     isUnpaid:false, note:'PT 20회 등록' },
    { id:'p2', paidAt:'2024-11-01', amount:450000, method:'transfer', isUnpaid:false, note:'재등록 할인' },
  ],
  m2: [
    { id:'p3', paidAt:'2024-03-20', amount:300000, method:'cash',     isUnpaid:false, note:'PT 10회' },
    { id:'p4', paidAt:'2024-03-20', amount:360000, method:'card',     isUnpaid:true,  note:'필라테스 12회 — 미수금' },
    { id:'p5', paidAt:'2025-02-15', amount:500000, method:'card',     isUnpaid:false, note:'재등록' },
  ],
  m5: [
    { id:'p6', paidAt:'2024-09-01', amount:900000, method:'card',     isUnpaid:false, note:'선수반 30회' },
  ],
};
const INITIAL_BODY = {
  m1: [
    { id:'b1', recordedAt:'2024-01-15', height:178, weight:82.5, systolic:138, diastolic:88, note:'최초 측정' },
    { id:'b2', recordedAt:'2024-06-01', height:178, weight:78.0, systolic:128, diastolic:82, note:'6개월 후' },
  ],
  m2: [
    { id:'b3', recordedAt:'2024-03-20', height:162, weight:58.0, systolic:118, diastolic:76, note:'최초' },
    { id:'b4', recordedAt:'2024-10-10', height:162, weight:55.5, systolic:115, diastolic:74, note:'재측정' },
  ],
};
const INITIAL_SCHEDULES = [
  { id:'s1', memberId:'m1', memberName:'홍길동', trainerId:'t1', trainerName:'김민준', trainerColor:'#f59e0b', date:fmt(today), startTime:'10:00', endTime:'11:00', classType:'재활',     status:'scheduled', sessionDeducted:false, isExternal:false },
  { id:'s2', memberId:'m2', memberName:'김영희', trainerId:'t1', trainerName:'김민준', trainerColor:'#f59e0b', date:fmt(today), startTime:'11:00', endTime:'12:00', classType:'트레이닝', status:'attended',  sessionDeducted:true,  isExternal:false },
  { id:'s3', memberId:'m4', memberName:'박수진', trainerId:'t2', trainerName:'이서연', trainerColor:'#10b981', date:fmt(today), startTime:'14:00', endTime:'15:00', classType:'6대체력',  status:'scheduled', sessionDeducted:false, isExternal:false },
  { id:'s4', memberId:'m5', memberName:'최민호', trainerId:'t3', trainerName:'박지훈', trainerColor:'#6366f1', date:fmt(ago(today,-1)), startTime:'09:00', endTime:'10:00', classType:'선수', status:'scheduled', sessionDeducted:false, isExternal:false },
  { id:'s5', memberId:'m1', memberName:'홍길동', trainerId:'t1', trainerName:'김민준', trainerColor:'#f59e0b', date:fmt(ago(today,1)), startTime:'10:00', endTime:'11:00', classType:'컨디셔닝', status:'attended', sessionDeducted:true, isExternal:false },
  { id:'s6', memberId:null, memberName:null, trainerId:'t2', trainerName:'이서연', trainerColor:'#10b981', date:fmt(ago(today,-2)), startTime:'09:00', endTime:'17:00', classType:'출강', memo:'○○피트니스 출강', status:'scheduled', sessionDeducted:true, isExternal:true },
];
const INITIAL_NOTICES = [
  { id:'n1', title:'🎉 몸가짐운동센터 시스템 오픈', content:'센터 통합 관리 시스템이 오픈되었습니다.', createdAt:new Date().toISOString(), isPinned:true },
  { id:'n2', title:'📅 휴무 안내', content:'공휴일은 센터 휴무입니다.', createdAt:new Date(Date.now()-864e5).toISOString(), isPinned:false },
];

// 매출/정산 설정 (단일 문서). 모두 화면에서 수정 가능.
// 계약서(프리랜서 계약서) 기준
const INITIAL_SETTINGS = {
  id:'config',
  cardFeeRate: 0.4,   // 카드 수수료(%) — 2026 우대 수수료율
  vatRate: 10,        // 부가세(%)
  defaultSplitRate: 50, // 기본 정산 비율(%)
  // 트레이너별 정산 비율 { trainerId: 40|50|60 } — 수동 지정(자동판정 우선이나 덮어쓰기 가능)
  trainerSplitRates: {},
  // 정산비율 자동판정 조건 (계약서 4조)
  rate60MinSales: 3000000,  // 60%: 월 매출(입금금액) 300만원 이상
  rate50MinBlog: 2,         // 50%: 블로그 월 2회 이상
  rate50MinStudy: 1,        // 50%: 스터디 월 1회 이상
  // 인센티브 규칙 (계약서 5조)
  promoPerPost: 10000,        // SNS 1건당 (블로그/인스타 공통)
  snsInstaMax: 8,             // 인스타그램: 최대 8회까지 인정
  incentivePer: 1000000,      // 신규상담 등록 매출 기준 단위
  incentiveAmount: 10000,     // 단위당 인센티브
  reEnrollPer: 1000000,       // 재등록 매출 기준 단위
  reEnrollAmount: 10000,      // 단위당 인센티브
  // 교육활동 매출 비율 (계약서 8조)
  eduCenterRate: 90,          // 센터 내 교육 90%
  eduExternalRate: 100,       // 외부 활동 100%
  paydayDay: 5,               // 임금지급일 (매월 5일, 참고)
};

const cache = {
  members:[], trainers:[], schedules:[], notices:[], payments:{}, body:{}, ai:{},
  settings:{...INITIAL_SETTINGS}, expenses:[], promos:[], settleOverrides:[],
};

async function loadCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => d.data());
}
async function loadGrouped(name) {
  const snap = await getDocs(collection(db, name));
  const grouped = {};
  snap.docs.forEach(d => {
    const data = d.data();
    const mid = data.__mid;
    if (!mid) return;
    if (!grouped[mid]) grouped[mid] = [];
    const { __mid, ...rest } = data;
    grouped[mid].push(rest);
  });
  return grouped;
}
async function seedIfEmpty() {
  const membersSnap = await getDocs(collection(db, 'members'));
  if (!membersSnap.empty) return;
  const batch = writeBatch(db);
  INITIAL_MEMBERS.forEach(m  => batch.set(doc(db, 'members', m.id), m));
  INITIAL_TRAINERS.forEach(t => batch.set(doc(db, 'trainers', t.id), t));
  INITIAL_SCHEDULES.forEach(s => batch.set(doc(db, 'schedules', s.id), s));
  INITIAL_NOTICES.forEach(n  => batch.set(doc(db, 'notices', n.id), n));
  Object.entries(INITIAL_PAYMENTS).forEach(([mid, list]) =>
    list.forEach(p => batch.set(doc(db, 'payments', p.id), { ...p, __mid: mid })));
  Object.entries(INITIAL_BODY).forEach(([mid, list]) =>
    list.forEach(b => batch.set(doc(db, 'body', b.id), { ...b, __mid: mid })));
  await batch.commit();
  console.log('[FitCMS] Firebase 최초 시드 완료:', DATA_VERSION);
}

export async function initStore() {
  try {
    await seedIfEmpty();
    const [members, trainers, schedules, notices, payments, body, ai, settings, expenses, promos, settleOverrides] = await Promise.all([
      loadCollection('members'),
      loadCollection('trainers'),
      loadCollection('schedules'),
      loadCollection('notices'),
      loadGrouped('payments'),
      loadGrouped('body'),
      loadGrouped('ai'),
      loadCollection('settings'),
      loadCollection('expenses'),
      loadCollection('promos'),
      loadCollection('settleOverrides'),
    ]);
    cache.members=members; cache.trainers=trainers; cache.schedules=schedules;
    cache.notices=notices; cache.payments=payments; cache.body=body; cache.ai=ai;
    cache.settings = settings.find(s=>s.id==='config') || {...INITIAL_SETTINGS};
    cache.expenses = expenses;
    cache.promos   = promos;
    cache.settleOverrides = settleOverrides;
    console.log('[FitCMS] Firebase 로딩 완료');
  } catch (e) {
    console.error('[FitCMS] Firebase 로딩 실패:', e);
    throw e;
  }
}

// Firestore 쓰기/삭제 — Promise를 그대로 반환해 호출자가 await/실패 처리할 수 있게 한다.
// (이전: .catch로 로그만 남겨 실패가 화면에 전달되지 않던 문제 수정)
function fbSet(name, id, data) { return setDoc(doc(db, name, id), data); }
function fbDelete(name, id)    { return deleteDoc(doc(db, name, id)); }

// 여러 문서를 원자적으로 삭제 (부분 실패 방지) — [{name, id}, ...]
async function fbDeleteBatch(items) {
  if (!items.length) return;
  const batch = writeBatch(db);
  items.forEach(({ name, id }) => batch.delete(doc(db, name, id)));
  await batch.commit();
}

// 저장/삭제 함수는 async — Firestore 완료를 기다리고, 실패 시 캐시를 되돌린다.
// UI는 await 후 성공/실패를 알 수 있다. (호출부가 await 안 해도 기존처럼 동작하되,
//  실패 시에는 캐시가 롤백되어 다음 렌더에서 화면이 실제 상태로 복구된다.)
export const store = {
  getMembers:    ()     => cache.members,
  addMember:     async m => {
    const nm={...m,id:'m'+Date.now()}; const prev=cache.members;
    cache.members=[...cache.members,nm];
    try { await fbSet('members',nm.id,nm); return nm; }
    catch(e){ cache.members=prev; throw e; }
  },
  updateMember:  async (id,p) => {
    const prev=cache.members;
    cache.members=cache.members.map(m=>m.id===id?{...m,...p}:m);
    const u=cache.members.find(m=>m.id===id);
    try { if(u) await fbSet('members',id,u); }
    catch(e){ cache.members=prev; throw e; }
  },
  deleteMember:  async id => {
    const prev=cache.members;
    cache.members=cache.members.filter(m=>m.id!==id);
    try { await fbDelete('members',id); }
    catch(e){ cache.members=prev; throw e; }
  },

  getTrainers:    ()     => cache.trainers,
  addTrainer:     async t => {
    const nt={...t,id:'t'+Date.now()}; const prev=cache.trainers;
    cache.trainers=[...cache.trainers,nt];
    try { await fbSet('trainers',nt.id,nt); return nt; }
    catch(e){ cache.trainers=prev; throw e; }
  },
  updateTrainer:  async (id,p) => {
    const prev=cache.trainers;
    cache.trainers=cache.trainers.map(t=>t.id===id?{...t,...p}:t);
    const u=cache.trainers.find(t=>t.id===id);
    try { if(u) await fbSet('trainers',id,u); }
    catch(e){ cache.trainers=prev; throw e; }
  },
  deleteTrainer:  async id => {
    const prev=cache.trainers;
    cache.trainers=cache.trainers.filter(t=>t.id!==id);
    try { await fbDelete('trainers',id); }
    catch(e){ cache.trainers=prev; throw e; }
  },

  getSchedules:    ()     => cache.schedules,
  addSchedule:     async s => {
    const ns={...s,id:'s'+Date.now()}; const prev=cache.schedules;
    cache.schedules=[...cache.schedules,ns];
    try { await fbSet('schedules',ns.id,ns); return ns; }
    catch(e){ cache.schedules=prev; throw e; }
  },
  updateSchedule:  async (id,p) => {
    const prev=cache.schedules;
    cache.schedules=cache.schedules.map(s=>s.id===id?{...s,...p}:s);
    const u=cache.schedules.find(s=>s.id===id);
    try { if(u) await fbSet('schedules',id,u); }
    catch(e){ cache.schedules=prev; throw e; }
  },
  deleteSchedule:  async id => {
    const prev=cache.schedules;
    cache.schedules=cache.schedules.filter(s=>s.id!==id);
    try { await fbDelete('schedules',id); }
    catch(e){ cache.schedules=prev; throw e; }
  },

  getNotices: ()  => cache.notices,
  addNotice:  async n => {
    const nn={...n,id:'n'+Date.now()}; const prev=cache.notices;
    cache.notices=[...cache.notices,nn];
    try { await fbSet('notices',nn.id,nn); return nn; }
    catch(e){ cache.notices=prev; throw e; }
  },
  updateNotice: async (id,p) => {
    const prev=cache.notices;
    cache.notices=cache.notices.map(n=>n.id===id?{...n,...p}:n);
    const u=cache.notices.find(n=>n.id===id);
    try { if(u) await fbSet('notices',id,u); return u; }
    catch(e){ cache.notices=prev; throw e; }
  },
  deleteNotice: async id => {
    const prev=cache.notices;
    cache.notices=cache.notices.filter(n=>n.id!==id);
    try { await fbDelete('notices',id); }
    catch(e){ cache.notices=prev; throw e; }
  },

  getPayments:   (mid)    => cache.payments[mid] || [],
  addPayment:    async (mid,p) => {
    const np={...p,id:'p'+Date.now()}; const prev=cache.payments[mid];
    cache.payments[mid]=[...(cache.payments[mid]||[]), np];
    try { await fbSet('payments', np.id, {...np, __mid:mid}); return np; }
    catch(e){ cache.payments[mid]=prev; throw e; }
  },
  updatePayment: async (mid,pid,patch) => {
    const prev=cache.payments[mid];
    cache.payments[mid]=(cache.payments[mid]||[]).map(p=>p.id===pid?{...p,...patch}:p);
    const u=(cache.payments[mid]||[]).find(p=>p.id===pid);
    try { if(u) await fbSet('payments', pid, {...u, __mid:mid}); return u; }
    catch(e){ cache.payments[mid]=prev; throw e; }
  },
  deletePayment: async (mid,pid) => {
    const prev=cache.payments[mid];
    cache.payments[mid]=(cache.payments[mid]||[]).filter(p=>p.id!==pid);
    try { await fbDelete('payments', pid); }
    catch(e){ cache.payments[mid]=prev; throw e; }
  },
  deleteAllPayments: async (mid) => {
    const list=cache.payments[mid]||[];
    await fbDeleteBatch(list.map(p=>({name:'payments',id:p.id})));
    delete cache.payments[mid];
  },

  getBodyRecords:   (mid)    => cache.body[mid] || [],
  addBodyRecord:    async (mid,r) => {
    const nr={...r,id:'b'+Date.now()}; const prev=cache.body[mid];
    cache.body[mid]=[...(cache.body[mid]||[]), nr];
    try { await fbSet('body', nr.id, {...nr, __mid:mid}); return nr; }
    catch(e){ cache.body[mid]=prev; throw e; }
  },
  deleteBodyRecord: async (mid,rid) => {
    const prev=cache.body[mid];
    cache.body[mid]=(cache.body[mid]||[]).filter(r=>r.id!==rid);
    try { await fbDelete('body', rid); }
    catch(e){ cache.body[mid]=prev; throw e; }
  },
  deleteAllBodyRecords: async (mid) => {
    const list=cache.body[mid]||[];
    await fbDeleteBatch(list.map(r=>({name:'body',id:r.id})));
    delete cache.body[mid];
  },

  // 회원 1명의 모든 개인정보를 원자적으로 삭제 (스케줄·수납·신체·AI·회원) — CV-04/CV-06
  purgeMember: async (mid) => {
    const items = [];
    cache.schedules.filter(s=>s.memberId===mid).forEach(s=>items.push({name:'schedules',id:s.id}));
    (cache.payments[mid]||[]).forEach(p=>items.push({name:'payments',id:p.id}));
    (cache.body[mid]||[]).forEach(r=>items.push({name:'body',id:r.id}));
    (cache.ai[mid]||[]).forEach(a=>items.push({name:'ai',id:a.id}));
    items.push({name:'members',id:mid});
    await fbDeleteBatch(items);   // 하나라도 실패하면 전체 실패(원자적)
    // 성공 시에만 캐시 반영
    cache.schedules=cache.schedules.filter(s=>s.memberId!==mid);
    delete cache.payments[mid];
    delete cache.body[mid];
    delete cache.ai[mid];
    cache.members=cache.members.filter(m=>m.id!==mid);
  },

  // 예약 생성 + 세션 차감 + sessionDeducted 플래그를 한 batch로 원자적 처리 — NEW-03
  // 일반 수업(회원+트레이너, 비외부)만 차감. 하나라도 실패하면 전체 실패.
  createScheduleWithDeduction: async (scheduleData) => {
    const ns = { ...scheduleData, id: 's'+Date.now() };
    const isDeductible = !ns.isExternal && ns.memberId && ns.trainerId;
    const batch = writeBatch(db);

    let updatedMember = null;
    if (isDeductible) {
      const member = cache.members.find(m=>m.id===ns.memberId);
      if (member) {
        const ts = JSON.parse(JSON.stringify(member.trainerSessions||{}));
        if (ts[ns.trainerId]) {
          // ★ 회차표기: 차감 직전 잔여값 = 이 수업의 회차 번호. 총횟수와 함께 기록.
          ns.sessionAtBooking      = ts[ns.trainerId].remaining ?? null;
          ns.sessionTotalAtBooking = ts[ns.trainerId].total ?? null;
          ts[ns.trainerId].remaining = Math.max(0, ts[ns.trainerId].remaining - 1);
        }
        updatedMember = { ...member, trainerSessions: ts };
        ns.sessionDeducted = true;
        batch.set(doc(db,'members',ns.memberId), updatedMember);
      }
    }
    batch.set(doc(db,'schedules',ns.id), ns);
    await batch.commit();   // 예약+차감이 함께 성공하거나 함께 실패

    // 성공 시에만 캐시 반영
    cache.schedules=[...cache.schedules, ns];
    if (updatedMember) cache.members=cache.members.map(m=>m.id===updatedMember.id?updatedMember:m);
    return ns;
  },

  // 상태 확정 + (출석 시 출석일 / 취소·노쇼 시 세션 복원)을 한 batch로 — NEW-03
  finalizeSchedule: async (scheduleId, status) => {
    const sched = cache.schedules.find(s=>s.id===scheduleId);
    if (!sched) throw new Error('스케줄을 찾을 수 없습니다.');
    const batch = writeBatch(db);
    const updatedSched = { ...sched, status, statusFinalized: true };
    batch.set(doc(db,'schedules',scheduleId), updatedSched);

    let updatedMember = null;
    if (!sched.isExternal && sched.memberId) {
      const member = cache.members.find(m=>m.id===sched.memberId);
      if (member) {
        if (status === 'attended' || status === 'noshow') {
          // 계약서 2조: 노쇼도 출석과 동일하게 횟수 차감 유지(복원 안 함)
          updatedMember = { ...member, lastAttendedDate: new Date().toISOString().slice(0,10) };
        } else if (status === 'canceled' && sched.sessionDeducted) {
          // 취소만 세션 복원
          const ts = JSON.parse(JSON.stringify(member.trainerSessions||{}));
          if (ts[sched.trainerId]) {
            const cap = ts[sched.trainerId].total ?? Infinity;
            ts[sched.trainerId].remaining = Math.min(cap, ts[sched.trainerId].remaining + 1);
          }
          updatedMember = { ...member, trainerSessions: ts };
        }
        if (updatedMember) batch.set(doc(db,'members',sched.memberId), updatedMember);
      }
    }
    await batch.commit();

    cache.schedules=cache.schedules.map(s=>s.id===scheduleId?updatedSched:s);
    if (updatedMember) cache.members=cache.members.map(m=>m.id===updatedMember.id?updatedMember:m);
    return updatedSched;
  },

  // 스케줄 삭제 + (필요 시 세션 복원)을 한 batch로 — 삭제만 성공/복원만 성공하는 불일치 방지
  //  · 예약 시 차감(sessionDeducted)했고 아직 출석/취소 확정 전(!statusFinalized)일 때만 복원
  deleteScheduleWithRestore: async (scheduleId) => {
    const sched = cache.schedules.find(s=>s.id===scheduleId);
    if (!sched) throw new Error('스케줄을 찾을 수 없습니다.');
    const batch = writeBatch(db);
    batch.delete(doc(db,'schedules',scheduleId));

    let updatedMember = null;
    const needRestore = !sched.isExternal && sched.memberId && sched.sessionDeducted && !sched.statusFinalized;
    if (needRestore) {
      const member = cache.members.find(m=>m.id===sched.memberId);
      if (member) {
        const ts = JSON.parse(JSON.stringify(member.trainerSessions||{}));
        if (ts[sched.trainerId]) {
          const cap = ts[sched.trainerId].total ?? Infinity;
          ts[sched.trainerId].remaining = Math.min(cap, ts[sched.trainerId].remaining + 1);
        }
        updatedMember = { ...member, trainerSessions: ts };
        batch.set(doc(db,'members',sched.memberId), updatedMember);
      }
    }
    await batch.commit();

    cache.schedules = cache.schedules.filter(s=>s.id!==scheduleId);
    if (updatedMember) cache.members=cache.members.map(m=>m.id===updatedMember.id?updatedMember:m);
  },

  // ── 매출/정산 설정 ───────────────────────────────────────
  getSettings: () => ({ ...INITIAL_SETTINGS, ...cache.settings }),
  updateSettings: async (patch) => {
    const prev = cache.settings;
    cache.settings = { ...INITIAL_SETTINGS, ...cache.settings, ...patch, id:'config' };
    try { await fbSet('settings', 'config', cache.settings); return cache.settings; }
    catch(e){ cache.settings = prev; throw e; }
  },

  // ── 지출(고정비/월별) ────────────────────────────────────
  // kind: 'fixed' | 'monthly'
  getExpenses: () => cache.expenses,
  addExpense: async (e) => {
    const ne = { ...e, id:'e'+Date.now() }; const prev = cache.expenses;
    cache.expenses = [...cache.expenses, ne];
    try { await fbSet('expenses', ne.id, ne); return ne; }
    catch(err){ cache.expenses = prev; throw err; }
  },
  updateExpense: async (id, patch) => {
    const prev = cache.expenses;
    cache.expenses = cache.expenses.map(e=>e.id===id?{...e,...patch}:e);
    const u = cache.expenses.find(e=>e.id===id);
    try { if(u) await fbSet('expenses', id, u); return u; }
    catch(err){ cache.expenses = prev; throw err; }
  },
  deleteExpense: async (id) => {
    const prev = cache.expenses;
    cache.expenses = cache.expenses.filter(e=>e.id!==id);
    try { await fbDelete('expenses', id); }
    catch(err){ cache.expenses = prev; throw err; }
  },

  // ── 트레이너 홍보 기록(인센티브) ─────────────────────────
  // { trainerId, ym:'2026-06', channel:'blog'|'insta', date }
  getPromos: () => cache.promos,
  addPromo: async (p) => {
    const np = { ...p, id:'pr'+Date.now() }; const prev = cache.promos;
    cache.promos = [...cache.promos, np];
    try { await fbSet('promos', np.id, np); return np; }
    catch(err){ cache.promos = prev; throw err; }
  },
  deletePromo: async (id) => {
    const prev = cache.promos;
    cache.promos = cache.promos.filter(p=>p.id!==id);
    try { await fbDelete('promos', id); }
    catch(err){ cache.promos = prev; throw err; }
  },

  // 모든 회원 결제를 회원명 부착하여 평탄화
  getAllPayments: () => {
    const rows = [];
    cache.members.forEach(m => {
      (cache.payments[m.id]||[]).forEach(p => rows.push({ ...p, memberId:m.id, memberName:m.name }));
    });
    return rows;
  },

  // 정산 수정값(단가/횟수 override) — 문서 id = `${trainerId}_${ym}`
  // { id, trainerId, ym, unitPrices:{memberId:단가}, sessionCounts:{memberId:횟수}, blogCount, instaCount }
  getSettleOverride: (trainerId, ym) =>
    cache.settleOverrides.find(o => o.id === `${trainerId}_${ym}`) || null,
  saveSettleOverride: async (trainerId, ym, data) => {
    const id = `${trainerId}_${ym}`;
    const prev = cache.settleOverrides;
    const existing = cache.settleOverrides.find(o => o.id === id);
    const merged = { ...(existing||{}), ...data, id, trainerId, ym };
    cache.settleOverrides = existing
      ? cache.settleOverrides.map(o => o.id===id ? merged : o)
      : [...cache.settleOverrides, merged];
    try { await fbSet('settleOverrides', id, merged); return merged; }
    catch(e){ cache.settleOverrides = prev; throw e; }
  },
};

export const aiStore = {
  getSessions:   (mid)    => cache.ai[mid] || [],
  addSession:    async (mid, s) => {
    const ns={...s, id:'ai'+Date.now()}; const prev=cache.ai[mid];
    cache.ai[mid]=[...(cache.ai[mid]||[]), ns];
    try { await fbSet('ai', ns.id, {...ns, __mid:mid}); return ns; }
    catch(e){ cache.ai[mid]=prev; throw e; }
  },
  deleteSession: async (mid, sid) => {
    const prev=cache.ai[mid];
    cache.ai[mid]=(cache.ai[mid]||[]).filter(s=>s.id!==sid);
    try { await fbDelete('ai', sid); }
    catch(e){ cache.ai[mid]=prev; throw e; }
  },
  deleteAll:     async (mid) => {
    const list=cache.ai[mid]||[];
    await fbDeleteBatch(list.map(s=>({name:'ai',id:s.id})));
    delete cache.ai[mid];
  },
};
