// demoData.js — v5 (수납·신체정보 추가)
const DATA_VERSION = 'v5.0';

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

// 수납 기록 (memberId 키로 배열)
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

// 신체정보 기록 (memberId 키로 배열)
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

function load(key, init) {
  try { const v=localStorage.getItem('fitcms_'+key); return v?JSON.parse(v):init; } catch { return init; }
}
function save(key, data) {
  try { localStorage.setItem('fitcms_'+key, JSON.stringify(data)); } catch {} }

// 버전 불일치 시 전체 재시딩
if (localStorage.getItem('fitcms_seeded') !== DATA_VERSION) {
  save('members',   INITIAL_MEMBERS);
  save('trainers',  INITIAL_TRAINERS);
  save('schedules', INITIAL_SCHEDULES);
  save('notices',   INITIAL_NOTICES);
  save('payments',  INITIAL_PAYMENTS);
  save('body',      INITIAL_BODY);
  localStorage.setItem('fitcms_seeded', DATA_VERSION);
  console.log('[FitCMS] Seeded:', DATA_VERSION);
}

export const store = {
  // Members
  getMembers:    ()     => load('members', []),
  addMember:     m      => { const a=store.getMembers(); const nm={...m,id:'m'+Date.now()}; save('members',[...a,nm]); return nm; },
  updateMember:  (id,p) => { save('members', store.getMembers().map(m=>m.id===id?{...m,...p}:m)); },
  deleteMember:  id     => save('members', store.getMembers().filter(m=>m.id!==id)),

  // Trainers
  getTrainers:    ()     => load('trainers', []),
  addTrainer:     t      => { const a=store.getTrainers(); const nt={...t,id:'t'+Date.now()}; save('trainers',[...a,nt]); return nt; },
  updateTrainer:  (id,p) => { save('trainers', store.getTrainers().map(t=>t.id===id?{...t,...p}:t)); },
  deleteTrainer:  id     => save('trainers', store.getTrainers().filter(t=>t.id!==id)),

  // Schedules
  getSchedules:    ()     => load('schedules', []),
  addSchedule:     s      => { const a=store.getSchedules(); const ns={...s,id:'s'+Date.now()}; save('schedules',[...a,ns]); return ns; },
  updateSchedule:  (id,p) => { save('schedules', store.getSchedules().map(s=>s.id===id?{...s,...p}:s)); },
  deleteSchedule:  id     => save('schedules', store.getSchedules().filter(s=>s.id!==id)),

  // Notices
  getNotices: ()  => load('notices', []),
  addNotice:  n   => { const a=store.getNotices(); const nn={...n,id:'n'+Date.now()}; save('notices',[...a,nn]); return nn; },

  // Payments (수납)
  getPayments:   (mid)    => (load('payments',{}))[mid] || [],
  addPayment:    (mid,p)  => {
    const all=load('payments',{}); const list=all[mid]||[];
    const np={...p,id:'p'+Date.now()}; all[mid]=[...list,np]; save('payments',all); return np;
  },
  deletePayment: (mid,pid)=> {
    const all=load('payments',{}); all[mid]=(all[mid]||[]).filter(p=>p.id!==pid); save('payments',all);
  },
  deleteAllPayments: (mid)=> { const all=load('payments',{}); delete all[mid]; save('payments',all); },

  // Body records (신체정보)
  getBodyRecords:   (mid)    => (load('body',{}))[mid] || [],
  addBodyRecord:    (mid,r)  => {
    const all=load('body',{}); const list=all[mid]||[];
    const nr={...r,id:'b'+Date.now()}; all[mid]=[...list,nr]; save('body',all); return nr;
  },
  deleteBodyRecord: (mid,rid)=> {
    const all=load('body',{}); all[mid]=(all[mid]||[]).filter(r=>r.id!==rid); save('body',all);
  },
  deleteAllBodyRecords: (mid)=> { const all=load('body',{}); delete all[mid]; save('body',all); },
};

// ── AI 측정 세션 (aiSessions) ──────────────────────────────
// AiSession = { id, memberId, recordedAt, measurements, analysisResult, memo }
export const aiStore = {
  getSessions:   (mid)    => {
    try { const all=JSON.parse(localStorage.getItem('fitcms_ai')||'{}'); return all[mid]||[]; } catch { return []; }
  },
  addSession:    (mid, s) => {
    try {
      const all=JSON.parse(localStorage.getItem('fitcms_ai')||'{}');
      const ns={...s, id:'ai'+Date.now()};
      all[mid]=[...(all[mid]||[]), ns];
      localStorage.setItem('fitcms_ai', JSON.stringify(all));
      return ns;
    } catch(e) { console.error('[aiStore.add]', e); return null; }
  },
  deleteSession: (mid, sid) => {
    try {
      const all=JSON.parse(localStorage.getItem('fitcms_ai')||'{}');
      all[mid]=(all[mid]||[]).filter(s=>s.id!==sid);
      localStorage.setItem('fitcms_ai', JSON.stringify(all));
    } catch(e) { console.error('[aiStore.delete]', e); }
  },
  deleteAll:     (mid) => {
    try {
      const all=JSON.parse(localStorage.getItem('fitcms_ai')||'{}');
      delete all[mid];
      localStorage.setItem('fitcms_ai', JSON.stringify(all));
    } catch(e) { console.error('[aiStore.deleteAll]', e); }
  },
};
