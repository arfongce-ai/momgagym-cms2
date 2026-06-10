// demoData.js — v6 (Firebase 연동)
// ⚠️ 화면 코드는 그대로 둡니다. store / aiStore / DEMO_USERS 의 사용법은 기존과 100% 동일합니다.
//    내부 저장소만 "브라우저(localStorage)" → "Firebase(Firestore) + 로컬 캐시"로 바뀌었습니다.

import { db } from './firebase';
import {
  collection, doc, getDocs, setDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';

const DATA_VERSION = 'v6.0';

export const DEMO_USERS = [
  { id:'admin1',   email:'admin@fitcms.demo',   password:'admin1234',   role:'admin',   name:'관리자'   },
  { id:'trainer1', email:'trainer@fitcms.demo', password:'trainer1234', role:'trainer', name:'김트레이너' },
];

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
  { id:'n1', title:'🎉 몸가짐운동센터 시스템 오픈', content:'센터 통합 관리 시스템이 오픈되었습니다.\n\n데모 계정\n• 관리자: admin@fitcms.demo / admin1234\n• 트레이너: trainer@fitcms.demo / trainer1234', createdAt:new Date().toISOString(), isPinned:true },
  { id:'n2', title:'📅 휴무 안내', content:'공휴일은 센터 휴무입니다.', createdAt:new Date(Date.now()-864e5).toISOString(), isPinned:false },
];

const cache = {
  members:[], trainers:[], schedules:[], notices:[], payments:{}, body:{}, ai:{},
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
    const [members, trainers, schedules, notices, payments, body, ai] = await Promise.all([
      loadCollection('members'),
      loadCollection('trainers'),
      loadCollection('schedules'),
      loadCollection('notices'),
      loadGrouped('payments'),
      loadGrouped('body'),
      loadGrouped('ai'),
    ]);
    cache.members=members; cache.trainers=trainers; cache.schedules=schedules;
    cache.notices=notices; cache.payments=payments; cache.body=body; cache.ai=ai;
    console.log('[FitCMS] Firebase 로딩 완료');
  } catch (e) {
    console.error('[FitCMS] Firebase 로딩 실패:', e);
    throw e;
  }
}

function fbSet(name, id, data) { setDoc(doc(db, name, id), data).catch(e => console.error('[fbSet]', name, e)); }
function fbDelete(name, id)    { deleteDoc(doc(db, name, id)).catch(e => console.error('[fbDelete]', name, e)); }

export const store = {
  getMembers:    ()     => cache.members,
  addMember:     m      => { const nm={...m,id:'m'+Date.now()}; cache.members=[...cache.members,nm]; fbSet('members',nm.id,nm); return nm; },
  updateMember:  (id,p) => { cache.members=cache.members.map(m=>m.id===id?{...m,...p}:m); const u=cache.members.find(m=>m.id===id); if(u) fbSet('members',id,u); },
  deleteMember:  id     => { cache.members=cache.members.filter(m=>m.id!==id); fbDelete('members',id); },

  getTrainers:    ()     => cache.trainers,
  addTrainer:     t      => { const nt={...t,id:'t'+Date.now()}; cache.trainers=[...cache.trainers,nt]; fbSet('trainers',nt.id,nt); return nt; },
  updateTrainer:  (id,p) => { cache.trainers=cache.trainers.map(t=>t.id===id?{...t,...p}:t); const u=cache.trainers.find(t=>t.id===id); if(u) fbSet('trainers',id,u); },
  deleteTrainer:  id     => { cache.trainers=cache.trainers.filter(t=>t.id!==id); fbDelete('trainers',id); },

  getSchedules:    ()     => cache.schedules,
  addSchedule:     s      => { const ns={...s,id:'s'+Date.now()}; cache.schedules=[...cache.schedules,ns]; fbSet('schedules',ns.id,ns); return ns; },
  updateSchedule:  (id,p) => { cache.schedules=cache.schedules.map(s=>s.id===id?{...s,...p}:s); const u=cache.schedules.find(s=>s.id===id); if(u) fbSet('schedules',id,u); },
  deleteSchedule:  id     => { cache.schedules=cache.schedules.filter(s=>s.id!==id); fbDelete('schedules',id); },

  getNotices: ()  => cache.notices,
  addNotice:  n   => { const nn={...n,id:'n'+Date.now()}; cache.notices=[...cache.notices,nn]; fbSet('notices',nn.id,nn); return nn; },

  getPayments:   (mid)    => cache.payments[mid] || [],
  addPayment:    (mid,p)  => { const np={...p,id:'p'+Date.now()}; cache.payments[mid]=[...(cache.payments[mid]||[]), np]; fbSet('payments', np.id, {...np, __mid:mid}); return np; },
  deletePayment: (mid,pid)=> { cache.payments[mid]=(cache.payments[mid]||[]).filter(p=>p.id!==pid); fbDelete('payments', pid); },
  deleteAllPayments: (mid)=> { (cache.payments[mid]||[]).forEach(p=>fbDelete('payments', p.id)); delete cache.payments[mid]; },

  getBodyRecords:   (mid)    => cache.body[mid] || [],
  addBodyRecord:    (mid,r)  => { const nr={...r,id:'b'+Date.now()}; cache.body[mid]=[...(cache.body[mid]||[]), nr]; fbSet('body', nr.id, {...nr, __mid:mid}); return nr; },
  deleteBodyRecord: (mid,rid)=> { cache.body[mid]=(cache.body[mid]||[]).filter(r=>r.id!==rid); fbDelete('body', rid); },
  deleteAllBodyRecords: (mid)=> { (cache.body[mid]||[]).forEach(r=>fbDelete('body', r.id)); delete cache.body[mid]; },
};

export const aiStore = {
  getSessions:   (mid)    => cache.ai[mid] || [],
  addSession:    (mid, s) => { const ns={...s, id:'ai'+Date.now()}; cache.ai[mid]=[...(cache.ai[mid]||[]), ns]; fbSet('ai', ns.id, {...ns, __mid:mid}); return ns; },
  deleteSession: (mid, sid) => { cache.ai[mid]=(cache.ai[mid]||[]).filter(s=>s.id!==sid); fbDelete('ai', sid); },
  deleteAll:     (mid) => { (cache.ai[mid]||[]).forEach(s=>fbDelete('ai', s.id)); delete cache.ai[mid]; },
};
