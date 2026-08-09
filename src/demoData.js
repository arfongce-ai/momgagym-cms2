// demoData.js — v6 (Firebase 연동)
// ⚠️ 화면 코드는 그대로 둡니다. store / aiStore 의 사용법은 기존과 호환됩니다.
//    내부 저장소만 "브라우저(localStorage)" → "Firebase(Firestore) + 로컬 캐시"로 바뀌었습니다.

import { db } from './firebase';
import {
  collection, doc, getDocs, setDoc, deleteDoc, writeBatch,
  query, where,
} from 'firebase/firestore';
import { toYMD, todayYMD } from './utils/dates';
import { buildUnifiedReportDocument, inferReportType } from './ai-measure/core/unifiedReport';

// v6.2: 델타 동기화 도입 직후, 원자 배치(예약+차감 등)가 updatedAt 도장 없이
//        저장되던 기간이 있었다. 그 문서들은 델타 조회에 영원히 걸리지 않으므로
//        버전을 올려 모든 기기의 스냅샷을 무효화 → 배포 후 첫 실행에서 1회
//        전체 재로딩으로 최신 상태를 다시 기준선으로 잡는다(즉시 복구).
const DATA_VERSION = 'v6.2';

// ── [진단] Firestore 읽기 계측 ───────────────────────────────────────
// 어떤 컬렉션이 읽기를 얼마나 일으키는지 콘솔에서 눈으로 확인하기 위한 래퍼.
// 모든 전수 조회(getDocs)는 이 함수를 통과시켜 누적 읽기 수를 집계한다.
// 배포 후 브라우저 콘솔에서 `window.__fsReads` 로 실시간 확인 가능.
const __readStats = { total: 0, byCollection: {}, calls: [] };
if (typeof window !== 'undefined') window.__fsReads = __readStats;

async function countedGetDocs(name, q) {
  const snap = await getDocs(q);
  const n = Number.isFinite(snap?.size) ? snap.size : (snap?.docs?.length || 0);
  __readStats.total += n;
  __readStats.byCollection[name] = (__readStats.byCollection[name] || 0) + n;
  __readStats.calls.push({ name, n, at: new Date().toISOString() });
  // 한 번에 50건 이상 읽으면 경고 (전체 재로딩 신호)
  console.log(`[FS-READ] ${name}: ${n}건 (누적 ${__readStats.total}건)`);
  return snap;
}

// 로그인 계정은 Firebase Authentication + roles 문서로 관리합니다.
// (이전의 평문 비밀번호 DEMO_USERS는 보안상 제거되었습니다.)

const fmt = toYMD; // CV-A: 로컬 시간 기준(UTC 버그 수정)
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
  // AI 분석 테스트 전용 가상 회원 (점프/RSI/보행 등 측정 테스트용)
  { id:'mtest', name:'테스트회원', phone:'010-0000-1111', birthDate:'1995-01-01',
    joinDate:fmt(today), lastPaymentDate:fmt(today), lastAttendedDate:fmt(today),
    classTypes:['선수'], memo:'AI 분석 테스트용 (실제 회원 아님)',
    trainerSessions:{ t1:{total:99,remaining:99} }, isActive:true },
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
  // AI 분석 테스트용 회원 — 키·몸무게 자동 연동 확인용
  mtest: [
    { id:'bt1', recordedAt:fmt(today), height:175, weight:70.0, systolic:120, diastolic:78, note:'AI 테스트 기준값' },
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
  defaultSplitRate: 40, // (구 호환) 기본 정산 비율 하한(%)
  lowSplitRate: 40,     // 정산비율 하한(%) — 조건 미달 시 적용
  // 트레이너별 정산 비율 { trainerId: 40|50|60 } — 수동 지정(있으면 자동판정보다 우선)
  trainerSplitRates: {},
  // 정산비율 자동판정 조건 (계약서 4조)
  //  · 기본 50% 시작, 미달 시 40%로 하향(블로그<2 또는 스터디<1)
  //  · 60%: 신규매출 또는 재등록매출 중 하나라도 임계액 이상
  rate60MinSales: 3000000,  // 60%: 신규 OR 재등록 매출 300만원 이상
  rate50MinBlog: 2,         // 50%: 블로그 월 2회 이상
  rate50MinStudy: 1,        // 50%: 스터디 월 1회 이상
  // 인센티브 규칙 (계약서 5조)
  promoPerPost: 10000,        // SNS 1건당 (블로그/인스타 공통)
  snsInstaMax: 8,             // 인스타그램: 최대 8회까지 인정
  // 신규/재등록 매출 인센티브: 단위 매출당 고정액 (기본 100만원당 1만원)
  incentivePer: 1000000,      // 신규매출 단위(원)
  incentiveAmount: 10000,     // 신규: 단위당 인센티브(원)
  reEnrollPer: 1000000,       // 재등록매출 단위(원)
  reEnrollAmount: 10000,      // 재등록: 단위당 인센티브(원)
  // 교육활동 매출 비율 (계약서 8조)
  eduCenterRate: 90,          // 센터 내 교육 90%
  eduExternalRate: 100,       // 외부 활동 100%
  paydayDay: 5,               // 임금지급일 (매월 5일, 참고)
  // 세전/세후 — 원천징수(국세+지방세) 세율(%). 기본 3.3%.
  //  · 실제 세액은 매달 세무신고 후 확정되므로 자동값은 추정치다. 설정에서 수정 가능.
  withholdingRate: 3.3,
};

const cache = {
  members:[], trainers:[], schedules:[], notices:[], payments:{}, body:{}, ai:{},
  settings:{...INITIAL_SETTINGS}, expenses:[], promos:[], settleOverrides:[], gaitReports:{}, postureReports:{}, romReports:{},
  integrityDismissals: [],
};

// 충돌 방지 ID 생성기 — Date.now()만 쓰면 같은 밀리초에 두 건이 생길 때
// (예: 결제 등록 직후 회원 갱신, 버튼 빠른 연타) ID가 겹쳐 문서가 덮어써질 수 있다.
// 타임스탬프 + 단조 카운터로 같은 ms 안에서도 항상 유일하게 만든다.
let __idCounter = 0;
export function uid(prefix) {
  __idCounter = (__idCounter + 1) % 1000;
  return `${prefix}${Date.now()}${String(__idCounter).padStart(3, '0')}`;
}

async function loadCollection(name, { optional = false } = {}) {
  try {
    const snap = await countedGetDocs(name, collection(db, name));
    return snap.docs.map(d => d.data());
  } catch (e) {
    // 관리자 전용 컬렉션은 로그인/권한 전에 막힐 수 있다. 앱 전체를 죽이지 않고
    // 빈 배열로 시작 → 로그인(관리자) 후 해당 화면에서 다시 읽는다.
    if (optional) {
      console.warn(`[FitCMS] ${name} 로딩 건너뜀(권한):`, e?.code || e?.message);
      __failedOptional.add(name); // 실패 기록 — syncedAt을 "성공"으로 잘못 찍지 않도록
      return [];
    }
    throw e;
  }
}
async function loadGrouped(name, { optional = false } = {}) {
  try {
    const snap = await countedGetDocs(name, collection(db, name));
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
  } catch (e) {
    if (optional) {
      console.warn(`[FitCMS] ${name} 로딩 건너뜀(권한):`, e?.code || e?.message);
      __failedOptional.add(name); // 실패 기록 — syncedAt을 "성공"으로 잘못 찍지 않도록
      return {};
    }
    throw e;
  }
}
async function seedIfEmpty() {
  // [읽기 절감] 시드는 '최초 1회'만 필요하다. 매 initStore 마다 members 전체를
  // 다시 읽어 "비었나?" 확인하면 members 를 사실상 2배로 읽게 된다.
  // → 한 번 시드(또는 비어있지 않음 확인)했으면 localStorage 플래그로 영구 스킵.
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('fitcms_seeded') === DATA_VERSION) {
      return; // 이미 시드 확인됨 → members 읽기 0건
    }
  } catch (e) { /* localStorage 불가 환경은 아래로 진행 */ }

  const membersSnap = await countedGetDocs('members(seed-check)', collection(db, 'members'));
  if (!membersSnap.empty) {
    // 이미 데이터가 있음 → 플래그만 남기고 이후엔 이 읽기조차 건너뛴다.
    try { localStorage.setItem('fitcms_seeded', DATA_VERSION); } catch (e) { /* noop */ }
    return;
  }
  // 초기 시드도 500건 한계를 넘을 수 있으므로 ops로 모아 chunk 처리한다.
  const ops = [];
  INITIAL_MEMBERS.forEach(m  => ops.push({ op:'set', name:'members',   id:m.id, data:m }));
  INITIAL_TRAINERS.forEach(t => ops.push({ op:'set', name:'trainers',  id:t.id, data:t }));
  INITIAL_SCHEDULES.forEach(s => ops.push({ op:'set', name:'schedules', id:s.id, data:s }));
  INITIAL_NOTICES.forEach(n  => ops.push({ op:'set', name:'notices',   id:n.id, data:n }));
  Object.entries(INITIAL_PAYMENTS).forEach(([mid, list]) =>
    list.forEach(p => ops.push({ op:'set', name:'payments', id:p.id, data:{ ...p, __mid: mid } })));
  Object.entries(INITIAL_BODY).forEach(([mid, list]) =>
    list.forEach(b => ops.push({ op:'set', name:'body', id:b.id, data:{ ...b, __mid: mid } })));
  await fbWriteBatch(ops);
  try { localStorage.setItem('fitcms_seeded', DATA_VERSION); } catch (e) { /* noop */ }
  console.log('[FitCMS] Firebase 최초 시드 완료:', DATA_VERSION);
}

// [읽기 절감] 한 페이지 세션에서 initStore 가 여러 번 호출돼도(로그인 흐름·
// 익명 인증 재콜백·트레이너 전환 등) 전체 컬렉션을 다시 읽지 않도록 모듈 차원에서
// 1회만 실제 로딩한다. 캐시는 모듈 싱글턴이라 한 번 채우면 유지된다.
// 진짜로 새로고침이 필요하면 initStore({ force:true }) 로 호출한다.
let __loadPromise = null;

// ── 새로고침 캐시(localStorage) ──────────────────────────────
// 모듈 싱글턴 캐시는 새로고침(F5)·새 탭이면 사라져 매번 전 컬렉션을 다시 읽는다.
// 짧은 TTL 동안 localStorage 스냅샷에서 복원하면 새로고침 직후 재접속은 읽기 0건.
// 운영 데이터라 신선도가 중요하므로 TTL 은 짧게(5분). 본인 쓰기는 캐시에 즉시
// 반영되고 스냅샷도 갱신되므로 본인 편집은 항상 최신. 다른 기기의 변경만 최대
// TTL 만큼 지연될 수 있다. force 로딩 시에는 캐시를 무시하고 새로 읽는다.
const __SNAP_KEY = 'fitcms_snap';
const __SNAP_VER = DATA_VERSION;

// ── 델타 동기화(변경분만 읽기) 설정 ──────────────────────────
//  구조: 모든 쓰기가 updatedAt(ms)을 문서에 남기고 meta/versions 문서에
//  "컬렉션별 마지막 쓰기 시각"을 갱신한다. 앱을 열면
//   ① localStorage 스냅샷 복원(읽기 0)
//   ② meta 컬렉션 1건 읽기 → 어떤 컬렉션이 바뀌었는지 확인
//   ③ 바뀐 컬렉션만 where(updatedAt > 마지막 동기화 시각) 델타 조회
//  변경이 없으면 앱 오픈 1회당 Firestore 읽기 = 단 1건.
//  삭제는 deletions 톰스톤(어느 컬렉션의 어떤 id가 지워졌나)으로 전파한다.
//  안전망: 주 1회(FULL TTL) 전체 재검증 + 기기 시계 오차는 MARGIN 으로 흡수
//  (id 기준 병합이라 중복 조회는 무해).
const __SYNC_COLLECTIONS = ['members','trainers','schedules','notices','payments','body','settings','expenses','promos','settleOverrides'];
const __GROUPED = new Set(['payments','body']);
const __DELTA_MARGIN_MS = 10 * 60 * 1000;
const __FULL_SYNC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let __syncedAt = {};      // 컬렉션별 마지막 동기화 시각(ms)
let __fullSyncAt = 0;     // 마지막 전체 로딩 시각(ms)
// [버그 수정 2026-07] optional 컬렉션(expenses 등)이 전체 로딩 중 읽기 실패하면
// loadCollection이 빈 배열로 "조용히" 넘어가는데, 그 상태를 그대로 syncedAt에
// "지금 막 성공적으로 동기화됨"이라고 찍어버리면 실패가 성공으로 둔갑한다.
// 그 뒤로 델타 동기화는 "이미 확인함"이라 착각해 영원히 그 컬렉션을 건너뛰고,
// 실제 데이터가 있어도 화면엔 계속 빈 값으로 보인다("서버 새로고침"으로만 복구).
// → 이번 로딩에서 실패한 optional 컬렉션 이름을 기록해두고, initStore가
//   syncedAt을 찍을 때 이 목록에 있는 컬렉션은 건너뛰어 다음 기회에 재시도되게 한다.
const __failedOptional = new Set();

function __readSnapshot() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(__SNAP_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (snap.ver !== __SNAP_VER) return null;
    return snap; // { ver, at, data, syncedAt, fullSyncAt }
  } catch (e) { return null; }
}
function __writeSnapshot(data) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(__SNAP_KEY, JSON.stringify({
      ver: __SNAP_VER, at: Date.now(), data,
      syncedAt: __syncedAt, fullSyncAt: __fullSyncAt,
    }));
  } catch (e) { /* 용량 초과 등은 무시 — 다음 로딩 때 Firestore 에서 읽음 */ }
}
// 쓰기 후 스냅샷을 최신 캐시로 갱신(본인 편집이 새로고침에도 유지되도록).
function __refreshSnapshot() {
  __writeSnapshot({
    members: cache.members, trainers: cache.trainers, schedules: cache.schedules,
    notices: cache.notices, payments: cache.payments, body: cache.body,
    settings: cache.settings, expenses: cache.expenses,
    promos: cache.promos, settleOverrides: cache.settleOverrides,
  });
}

// ── 델타 병합 헬퍼 ─────────────────────────────────────────
function __upsertList(list, docData) {
  const i = list.findIndex(x => x.id === docData.id);
  if (i >= 0) list[i] = docData; else list.push(docData);
}
function __applyDeltaDoc(col, docData) {
  if (__GROUPED.has(col)) {
    const { __mid, ...rest } = docData;
    if (!__mid) return;
    if (!cache[col][__mid]) cache[col][__mid] = [];
    __upsertList(cache[col][__mid], rest);
    return;
  }
  if (col === 'settings') { if (docData.id === 'config') cache.settings = docData; return; }
  __upsertList(cache[col], docData);
}
function __applyDeletion(col, id) {
  if (__GROUPED.has(col)) {
    Object.keys(cache[col] || {}).forEach(mid => {
      cache[col][mid] = (cache[col][mid] || []).filter(x => x.id !== id);
    });
    return;
  }
  if (col === 'settings') return;
  if (Array.isArray(cache[col])) cache[col] = cache[col].filter(x => x.id !== id);
}

// 변경분만 동기화 — meta 1건 읽고, 바뀐 컬렉션만 updatedAt 범위 조회.
async function __deltaSync() {
  const metaSnap = await countedGetDocs('meta', collection(db, 'meta'));
  const versions = metaSnap.docs.find(d => d.id === 'versions')?.data() || null;
  if (!versions) {
    console.log('[FitCMS] 델타: 신규 변경 기록 없음 — 추가 읽기 0건');
    return;
  }
  let pulled = 0;
  for (const col of __SYNC_COLLECTIONS) {
    const since = __syncedAt[col] || 0;
    if (!(Number(versions[col]) >= since)) continue; // 이 컬렉션은 그대로(같은 ms 경계 포함)
    try {
      const q = query(collection(db, col), where('updatedAt', '>', since - __DELTA_MARGIN_MS));
      const snap = await countedGetDocs(`${col}(delta)`, q);
      snap.docs.forEach(d => __applyDeltaDoc(col, d.data()));
      pulled += snap.docs.length;
      __syncedAt[col] = Date.now();
    } catch (e) {
      // 트레이너 계정은 expenses 등 관리자 전용 컬렉션 접근이 거부된다 — 건너뜀.
      console.warn(`[FitCMS] ${col} 델타 건너뜀:`, e?.code || e?.message);
    }
  }
  const delSince = __syncedAt.deletions || 0;
  if (Number(versions.deletions) >= delSince) {
    const q = query(collection(db, 'deletions'), where('at', '>', delSince - __DELTA_MARGIN_MS));
    const snap = await countedGetDocs('deletions(delta)', q);
    snap.docs.forEach(d => { const t = d.data(); __applyDeletion(t.col, t.id); });
    pulled += snap.docs.length;
    __syncedAt.deletions = Date.now();
  }
  __refreshSnapshot();
  console.log(`[FitCMS] 델타 동기화 완료 — 변경 ${pulled}건 반영, 이번 세션 총 읽기 ${__readStats.total}건`);
}

export async function initStore({ force = false } = {}) {
  if (!force && __loadPromise) return __loadPromise; // 이미 로딩(중)이면 그대로 재사용
  __loadPromise = (async () => {
    try {
      // 1) 스냅샷 복원(읽기 0) → 델타 동기화(변경분만).
      if (!force) {
        const snap = __readSnapshot();
        if (snap?.data) {
          const d = snap.data;
          cache.members=d.members||[]; cache.trainers=d.trainers||[];
          cache.schedules=d.schedules||[]; cache.notices=d.notices||[];
          cache.payments=d.payments||{}; cache.body=d.body||{};
          cache.settings=d.settings||{...INITIAL_SETTINGS};
          cache.expenses=d.expenses||[]; cache.promos=d.promos||[];
          cache.settleOverrides=d.settleOverrides||[];
          cache.ai = {}; cache.gaitReports = {}; cache.postureReports = {}; cache.romReports = {};   // 측정 데이터는 항상 지연 로딩
          __syncedAt = snap.syncedAt || {};
          __fullSyncAt = snap.fullSyncAt || 0;
          if (Date.now() - __fullSyncAt <= __FULL_SYNC_TTL_MS && Object.keys(__syncedAt).length) {
            console.log('[FitCMS] 스냅샷 복원 — 변경분만 확인합니다.');
            try {
              await __deltaSync();
              return;
            } catch (e) {
              // 규칙 미게시·일시 오류 등으로 델타가 실패해도 앱이 죽지 않고
              // 전체 로딩으로 폴백한다(아래로 진행).
              console.warn('[FitCMS] 델타 동기화 실패 → 전체 로딩 폴백:', e?.code || e?.message);
            }
          } else {
            console.log('[FitCMS] 스냅샷 복원 — 주기 전체 재검증을 수행합니다.');
          }
        }
      }
      // 2) 캐시가 없거나 강제/주기 재검증 → Firestore 전수 로딩.
      await seedIfEmpty();
      __failedOptional.clear(); // 이번 전체 로딩 시도 기준으로 초기화
      // [읽기 절감 핵심] ai · gait_reports · posture_reports · rom_reports 는 회원별로만 조회되므로(측정 화면을 열 때),
      // 앱 시작 시 전수 조회하지 않는다. 빈 캐시로 시작 → 회원 화면에서 그 회원 것만
      // 지연 로딩(ensureSessions/ensureGaitReports)한다. 측정 데이터가 쌓일수록
      // 시작 시 읽기가 폭증하던 문제를 차단한다.
      const [members, trainers, schedules, notices, payments, body, settings, expenses, promos, settleOverrides, integrityDismissals] = await Promise.all([
        loadCollection('members'),
        loadCollection('trainers'),
        loadCollection('schedules'),
        loadCollection('notices'),
        loadGrouped('payments'),
        loadGrouped('body'),
        loadCollection('settings'),
        loadCollection('expenses', { optional: true }),
        loadCollection('promos', { optional: true }),
        loadCollection('settleOverrides', { optional: true }),
        loadCollection('integrityDismissals', { optional: true }), // 관리자 전용 — 일반 트레이너 로그인 시 권한 오류 나도 앱 안 죽게 optional
      ]);
      cache.members=members; cache.trainers=trainers; cache.schedules=schedules;
      cache.notices=notices; cache.payments=payments; cache.body=body;
      cache.ai = {};                 // 지연 로딩 — 회원별로 ensureSessions 시 채움
      cache.gaitReports = {};        // 지연 로딩 — 회원별로 ensureGaitReports 시 채움
      cache.postureReports = {};     // 지연 로딩 — 회원별로 자세 리포트 조회 시 채움
      cache.romReports = {};         // 지연 로딩 — 회원별로 ROM 리포트 조회 시 채움
      cache.settings = settings.find(s=>s.id==='config') || {...INITIAL_SETTINGS};
      cache.expenses = expenses;
      cache.promos   = promos;
      cache.settleOverrides = settleOverrides;
      cache.integrityDismissals = integrityDismissals;
      const now = Date.now();
      __SYNC_COLLECTIONS.forEach(c => { if (!__failedOptional.has(c)) __syncedAt[c] = now; }); // 실패한 컬렉션은 "동기화됨" 표시를 건너뛰어 다음 번에 재시도
      __syncedAt.deletions = now;
      __fullSyncAt = now;
      __refreshSnapshot();           // 새로고침 캐시에 저장(동기화 메타 포함)
      console.log(`[FitCMS] Firebase 로딩 완료 — 이번 세션 총 읽기 ${__readStats.total}건`);
    } catch (e) {
      __loadPromise = null; // 실패 시 다음 호출에서 재시도 가능하도록 가드 해제
      console.error('[FitCMS] Firebase 로딩 실패:', e);
      throw e;
    }
  })();
  return __loadPromise;
}

// Firestore 쓰기/삭제 — Promise를 그대로 반환해 호출자가 await/실패 처리할 수 있게 한다.
// (이전: .catch로 로그만 남겨 실패가 화면에 전달되지 않던 문제 수정)
// 쓰기 후 새로고침 캐시를 갱신(디바운스) — 본인 편집이 새로고침에도 유지되도록.
// ai/gait_reports 쓰기는 스냅샷 대상이 아니지만, 호출돼도 무해(현재 cache 만 기록).
let __snapTimer = null;
function __touchSnapshot() {
  if (typeof __refreshSnapshot !== 'function') return;
  if (__snapTimer) clearTimeout(__snapTimer);
  // 즉시 기록하지 않고 매크로태스크(0ms)로 미룬다 — 원자 배치 흐름은
  // 'await batch.commit() → 캐시 갱신' 순서라, 즉시 기록하면 갱신 전
  // 캐시가 스냅샷에 담겨 "새로고침하면 사라지는" 창이 생긴다.
  setTimeout(() => { try { __refreshSnapshot(); } catch (e) { /* noop */ } }, 0);
  __snapTimer = setTimeout(() => { try { __refreshSnapshot(); } catch (e) { /* noop */ } }, 400);
}

// meta/versions: 컬렉션별 마지막 쓰기 시각. 델타 동기화의 '변경 여부 1건 조회' 대상.
function __bumpMeta(names) {
  const stamp = {};
  names.forEach(n => { stamp[n] = Date.now(); });
  // best-effort — 실패해도 본 저장은 유지(다음 전체 동기화가 안전망).
  return setDoc(doc(db, 'meta', 'versions'), stamp, { merge: true })
    .catch(e => console.warn('[FitCMS] meta 갱신 실패(무시):', e?.code || e?.message));
}

function fbSet(name, id, data) {
  const stamped = { ...data, updatedAt: Date.now() }; // 델타 조회 기준 시각
  return setDoc(doc(db, name, id), stamped).then(r => {
    __bumpMeta([name]);
    __touchSnapshot();
    return r;
  });
}

// 통합 리포트 미러 — 모든 측정 저장 시 users/{mid}/reports/{reportId} 에 표준 규격으로 동시 저장.
// 핵심 원칙(측정 정직성): 통합 저장은 best-effort 부수 작업이며, 실패해도 본래의 측정 저장은
// 절대 회귀하지 않는다. 따라서 호출부에서 try/catch 로 감싸 실패를 삼킨다(경고만 남김).
async function mirrorUnifiedReport(mid, report, reportType) {
  if (!mid || !report) return null;
  try {
    const document = buildUnifiedReportDocument(report, {
      userId: mid,
      reportId: report.id,
      reportType,
      member: { ...(report.member || {}), id: mid },
    });
    await setDoc(doc(db, 'users', mid, 'reports', document.reportId), document, { merge: true });
    return document;
  } catch (e) {
    console.warn('[mirrorUnifiedReport] 통합 저장 실패(무시):', e?.code || e?.message);
    return null;
  }
}
// mirrorUnifiedReport의 짝 함수 — 전용 리포트(gait/posture/rom)·측정 세션(ai) 삭제 시
// users/{mid}/reports/{reportId}에 남아있는 미러 사본도 함께 지운다. mirror와 동일하게
// best-effort(실패해도 본래의 삭제는 절대 막지 않음) — 호출부에서 await 없이 fire-and-forget.
function unmirrorUnifiedReport(mid, reportId) {
  if (!mid || !reportId) return Promise.resolve();
  return deleteDoc(doc(db, 'users', mid, 'reports', reportId))
    .catch(e => console.warn('[unmirrorUnifiedReport] 통합 미러 삭제 실패(무시):', e?.code || e?.message));
}
function fbDelete(name, id) {
  return deleteDoc(doc(db, name, id)).then(r => {
    // 톰스톤: 다른 기기의 델타 동기화가 이 삭제를 알 수 있게 한다.
    setDoc(doc(db, 'deletions', `${name}_${id}_${Date.now()}`), { col: name, id, at: Date.now() })
      .catch(e => console.warn('[FitCMS] 삭제 톰스톤 실패(무시):', e?.code || e?.message));
    __bumpMeta([name, 'deletions']);
    __touchSnapshot();
    return r;
  });
}

// ── Firestore WriteBatch 하드 리밋 대응 ───────────────────────────
// Firestore writeBatch는 1회 commit당 최대 500개 문서 조작만 허용한다.
// 장기 회원의 누적 데이터(예약/수납/신체/AI)가 500건을 넘으면
// 한 batch로는 처리할 수 없으므로 500건 미만 단위로 쪼개어(chunk) 처리한다.
// 여유분(450)을 두어 호출부에서 set/delete를 섞어 쓰더라도 안전하게.
const CHUNK_SIZE  = 450;

function chunk(arr, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 여러 문서를 삭제 (부분 실패 방지) — [{name, id}, ...]
// ⚠️ 원자성 주의: Firestore batch는 500건이 한계라 그 이상은 여러 batch로 나뉜다.
//    각 chunk는 원자적이지만 chunk 간에는 원자적이지 않다(중간 실패 시 일부만 삭제될 수 있음).
//    → 호출부(purgeMember 등)는 "실패 시 재시도하면 멱등하게 마저 삭제된다"는 전제로 설계한다.
async function fbDeleteBatch(items) {
  if (!items.length) return;
  const now = Date.now();
  for (const part of chunk(items, Math.floor(CHUNK_SIZE / 2))) { // 톰스톤 포함이라 절반 단위
    const batch = writeBatch(db);
    part.forEach(({ name, id }, i) => {
      batch.delete(doc(db, name, id));
      batch.set(doc(db, 'deletions', `${name}_${id}_${now + i}`), { col: name, id, at: now });
    });
    await batch.commit();
  }
  __bumpMeta([...new Set(items.map(it => it.name)), 'deletions']);
  __touchSnapshot();
}

// 여러 문서를 set/delete 혼합으로 처리 — [{op:'set'|'del', name, id, data?}, ...]
// 500건 단위로 쪼개어 commit. (set/delete를 한 흐름에서 원자 처리할 때 사용)
async function fbWriteBatch(ops) {
  if (!ops.length) return;
  const now = Date.now();
  for (const part of chunk(ops, Math.floor(CHUNK_SIZE / 2))) { // 톰스톤 여유 포함
    const batch = writeBatch(db);
    part.forEach(({ op, name, id, data }, i) => {
      const ref = doc(db, name, id);
      if (op === 'del') {
        batch.delete(ref);
        batch.set(doc(db, 'deletions', `${name}_${id}_${now + i}`), { col: name, id, at: now });
      } else {
        batch.set(ref, { ...data, updatedAt: now });
      }
    });
    await batch.commit();
  }
  const touched = [...new Set(ops.map(o => o.name))];
  if (ops.some(o => o.op === 'del')) touched.push('deletions');
  __bumpMeta(touched);
  __touchSnapshot();
}

// ── 원자 배치 헬퍼(델타 계약 준수) ──────────────────────────
// '읽고-조합해-원자 커밋' 흐름(예약+차감, 상태확정+세션복원 등)은 fbSet 을 쓸 수
// 없어 raw writeBatch 를 직접 써 왔다. 그 결과 updatedAt 도장·meta 갱신·스냅샷
// 갱신이 빠져 "저장은 됐는데 새로고침하면 사라지는" 버그가 생긴다(델타 동기화가
// 변경을 인지하지 못함). 모든 원자 배치는 반드시 이 헬퍼를 쓴다.
function createStampedBatch() {
  const batch = writeBatch(db);
  const touched = new Set();
  const now = Date.now();
  let tombSeq = 0;
  return {
    set(name, id, data) {
      touched.add(name);
      batch.set(doc(db, name, id), { ...data, updatedAt: Date.now() });
    },
    delete(name, id) {
      touched.add(name); touched.add('deletions');
      batch.delete(doc(db, name, id));
      batch.set(doc(db, 'deletions', `${name}_${id}_${now + (tombSeq++)}`), { col: name, id, at: now });
    },
    async commit() {
      await batch.commit();
      __bumpMeta([...touched]);
      __touchSnapshot();
    },
  };
}

// 저장/삭제 함수는 async — Firestore 완료를 기다리고, 실패 시 캐시를 되돌린다.
// UI는 await 후 성공/실패를 알 수 있다. (호출부가 await 안 해도 기존처럼 동작하되,
//  실패 시에는 캐시가 롤백되어 다음 렌더에서 화면이 실제 상태로 복구된다.)

// 같은 회원+트레이너의 회차(sessionAtBooking)는 원래 "예약을 만든 순서"대로
// 매겨진다(createScheduleWithDeduction이 그 순간의 잔여값을 그대로 씀). 그런데
// 화요일 수업을 월·목보다 나중에 등록하면(날짜상 그 사이인데 생성은 마지막)
// 회차가 예약 생성 순서를 따라가 버려 날짜순으로 보면 회차가 거꾸로 튄다
// (예: 월8·화6·목7 — 화가 목보다 나중 날짜인데 회차는 더 낮음).
// 이 함수는 같은 회원+트레이너 예약들을 날짜순으로 봤을 때 회차가 항상
// 내림차순이 되도록 필요한 것만 재배정한다. 표시용 보정이라 실패해도
// 방금 만든 예약 자체의 성패에는 영향을 주지 않는다(로그만 남김).
//
// ⚠ 회귀 방지(회차가 음수로 표시되던 버그, 2026-07): 재배정 "대상"에 실제로는
//   차감되지 않은 예약까지 섞이면(예: 잔여 0이라 차감을 건너뛴 예약 — 항상
//   sessionAtBooking=0 · sessionDeducted=false, 혹은 취소되어 차감이 이미
//   복원된 예약) 대상 인원수가 진짜 차감 건수보다 많아진다. 예전 코드는
//   maxVal에서 인원수만큼 그냥 1씩 빼며 채웠기 때문에, 그 초과분이 0 밑으로
//   (-1, -2 …) 떨어지는 오표시를 만들어냈다.
//   → 아래는 이를 세 가지로 막는다:
//     1) 재배정 "대상"을 실제로 차감되어 있고(sessionDeducted===true) 취소로
//        복원되지 않았고(status!=='canceled') 수동 고정되지 않은
//        (sessionManual!==true — 트레이너가 세션 탭에서 수동 수정한 값은
//        자동 보정이 덮어쓰지 않는다) 예약으로만 제한한다.
//     2) 재등록(재등록 시 total은 누적 가산되어 항상 커짐 — session_reenroll
//        참고)으로 총횟수(sessionTotalAtBooking)가 바뀐 예약끼리는 서로 다른
//        "묶음(lot)"으로 보고 절대 섞어 재배정하지 않는다. 안 그러면 이전
//        패키지의 진짜 마지막 회차(예: 1(e))가 재등록 후 패키지의 숫자로
//        둔갑해버릴 수 있다 — 값 자체는 양수여도 사실과 다른 회차가 된다.
//     3) 공식으로 새 숫자를 만들어 채우지 않는다. 같은 lot 안에서 그 대상들이
//        "이미 갖고 있던 값들의 집합"을 날짜순 자리에 재배치(치환)만 한다 —
//        존재한 적 없는 값을 만들어내지 않으므로 0 미만이나 실제보다 큰
//        값이 나올 수 없다(측정 정직성 원칙).
function isAutoRenumberEligible(s) {
  return s.sessionDeducted === true && s.sessionAtBooking != null &&
    s.status !== 'canceled' && !s.sessionManual;
}

const dateKey = (s) => `${s.date}T${s.startTime || '00:00'}`;

// lot(재등록 묶음) 하나에 대해서만 재배정 — 그 lot이 갖고 있던 값들만 재사용.
function renumberLot(lot) {
  if (lot.length < 2) return [];
  const byDateAsc = [...lot].sort((a, b) => {
    const ka = dateKey(a), kb = dateKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  // 이미 존재하던 값들만 재사용(치환)한다 — 새 값을 계산해 만들지 않는다.
  const valuesDesc = lot.map((s) => s.sessionAtBooking).sort((a, b) => b - a);

  // 이미 날짜순=값 내림차순이면 손대지 않는다(불필요한 쓰기 방지).
  const alreadyOrdered = byDateAsc.every((s, i) => s.sessionAtBooking === valuesDesc[i]);
  if (alreadyOrdered) return [];

  const updates = [];
  byDateAsc.forEach((s, i) => {
    const newVal = valuesDesc[i];
    if (s.sessionAtBooking !== newVal) updates.push({ id: s.id, sessionAtBooking: newVal });
  });
  return updates;
}

// 순수 계산(부작용 없음 — 테스트 용이): 재배정이 필요한 {id, sessionAtBooking}
// 목록만 반환한다. candidates는 한 회원+트레이너의 후보 예약 전체(외부/상담
// 제외하고 넘기면 됨) — 자동 재배정 대상 판정과 lot 분리는 이 함수 내부에서 한다.
export function computeSessionRenumbering(candidates = []) {
  const eligible = candidates.filter(isAutoRenumberEligible);
  if (eligible.length < 2) return [];

  const byLot = new Map();
  for (const s of eligible) {
    const key = s.sessionTotalAtBooking ?? '∅';
    if (!byLot.has(key)) byLot.set(key, []);
    byLot.get(key).push(s);
  }

  const updates = [];
  for (const lot of byLot.values()) updates.push(...renumberLot(lot));
  return updates;
}

async function renumberSessionAtBooking(memberId, trainerId) {
  if (!memberId || !trainerId) return;
  const siblings = cache.schedules.filter(s =>
    s.memberId === memberId && s.trainerId === trainerId &&
    !s.isExternal && !s.isConsult
  );
  const updates = computeSessionRenumbering(siblings);
  if (!updates.length) return;

  try {
    const batch = createStampedBatch();
    const byId = new Map(siblings.map((s) => [s.id, s]));
    updates.forEach((u) => batch.set('schedules', u.id, { ...byId.get(u.id), sessionAtBooking: u.sessionAtBooking }));
    await batch.commit();
    cache.schedules = cache.schedules.map((s) => {
      const u = updates.find((x) => x.id === s.id);
      return u ? { ...s, sessionAtBooking: u.sessionAtBooking } : s;
    });
  } catch (e) {
    console.error('[회차 재배정 실패]', e);
  }
}

export const store = {
  getMembers:    ()     => cache.members,
  addMember:     async m => {
    const nm={...m,id:uid('m')}; const prev=cache.members;
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
  // 세션 양도/부분양도: fromTid 트레이너의 잔여 세션 중 count회를 toTid 트레이너에게 넘긴다.
  // - total/remaining 모두 count만큼 이동(소유권 이전 개념)
  // - fromTid 잔여가 0이 되고 total도 0이면(=전체 양도) 슬롯 제거
  // - 대상 슬롯이 이미 있으면 합산, 없으면 생성
  //
  // ▣ 정산 자동정리(결제금·박제비율 이전):
  //   정산 단가 = (트레이너 귀속 결제금) ÷ (등록횟수 total). 양도로 total만 옮기면
  //   출발 단가가 부풀고 대상 단가가 0이 되므로, 양도 비율 f = n / origTotal 만큼
  //   해당 회원의 미환불 결제에서 출발 트레이너 귀속분을 대상 트레이너로 함께 옮긴다.
  //   · 결제월에 박제된 정산비율(splitRateAtPay)은 그대로 복사(재판정 안 함).
  //   · 과거 출석/지급은 스케줄의 trainerId로 귀속되어 양도가 건드리지 못하므로,
  //     이미 지급·원천징수된 과거분은 불변 → 원천세 이중부과가 구조적으로 발생하지 않음.
  //   · split/trainerIds가 없는 결제(등록횟수 비율 안분)는 live total로 자동 재계산되어
  //     별도 수정이 필요 없다.
  transferSessions: async (memberId, { fromTid, toTid, count }) => {
    const n = Math.floor(Number(count) || 0);
    if (!fromTid || !toTid) throw new Error('양도/대상 트레이너를 선택하세요.');
    if (fromTid === toTid)  throw new Error('같은 트레이너로는 양도할 수 없습니다.');
    if (n <= 0)             throw new Error('양도할 세션 수는 1회 이상이어야 합니다.');

    const prevMembers  = cache.members;
    const prevPayments = JSON.parse(JSON.stringify(cache.payments));
    const m = cache.members.find(x => x.id === memberId);
    if (!m) throw new Error('회원을 찾을 수 없습니다.');
    const ts = JSON.parse(JSON.stringify(m.trainerSessions || {}));
    const src = ts[fromTid];
    if (!src) throw new Error('양도할 세션이 없습니다.');
    if (src.monthly) throw new Error('월정액 세션은 양도할 수 없습니다.');
    if (n > (src.remaining ?? 0)) throw new Error('양도 수가 잔여 세션을 초과합니다.');
    if (ts[toTid] && ts[toTid].monthly) throw new Error('월정액 슬롯으로는 양도할 수 없습니다.');

    // 양도 비율 — 출발 트레이너의 양도 전 등록횟수 기준. total 정보가 없으면 전액(1).
    const origTotal = src.total ?? 0;
    const f = origTotal > 0 ? n / origTotal : 1;

    // 출발 슬롯 차감 (total도 함께 줄여 소유 세션 이동을 표현)
    src.remaining -= n;
    src.total     = Math.max(src.remaining, origTotal - n);
    if (src.remaining <= 0 && src.total <= 0) delete ts[fromTid];

    // 대상 슬롯 가산
    if (ts[toTid]) {
      ts[toTid].total     = (ts[toTid].total     || 0) + n;
      ts[toTid].remaining = (ts[toTid].remaining || 0) + n;
    } else {
      ts[toTid] = { total: n, remaining: n };
    }

    // ── 결제금 재배분: 미환불 결제의 출발 트레이너 귀속분을 f만큼 대상으로 이전 ──
    const memberPays = cache.payments[memberId] || [];
    const touchedPays = []; // { pid, patch }
    memberPays.forEach(p => {
      if (p.isUnpaid || p.isRefunded) return;           // 미수금·환불은 정산 단가에서 제외/특수처리 → 건드리지 않음
      const tids = (p.trainerIds && p.trainerIds.length) ? p.trainerIds : null;
      const hasSplit = Array.isArray(p.split) && p.split.length;
      // 이 결제가 출발 트레이너에 귀속돼 있지 않으면 스킵(등록횟수 안분 결제 포함)
      if (!tids || !tids.includes(fromTid)) return;

      const amount = Number(p.amount) || 0;
      // 현재 split(없으면 trainerIds 1/n으로 가정)에서 출발 트레이너 몫을 구한다.
      const splitMap = {};
      if (hasSplit) {
        p.split.forEach(s => { splitMap[s.trainerId] = Number(s.amount) || 0; });
      } else {
        const per = tids.length ? Math.round(amount / tids.length) : 0;
        tids.forEach((id, i) => { splitMap[id] = (i === tids.length - 1) ? amount - per * (tids.length - 1) : per; });
      }
      const fromAmt = splitMap[fromTid] || 0;
      if (fromAmt <= 0) return;

      const move = Math.round(fromAmt * f);             // 대상으로 옮길 금액
      if (move <= 0) return;
      splitMap[fromTid] = fromAmt - move;
      splitMap[toTid]   = (splitMap[toTid] || 0) + move;

      // 출발 몫이 0이 되면(전체 양도) split/trainerIds에서 제거
      if ((splitMap[fromTid] || 0) <= 0) delete splitMap[fromTid];

      const finalTids = [...new Set([...tids, toTid])].filter(id => splitMap[id] != null);
      const newSplit  = finalTids.map(id => ({ trainerId: id, amount: splitMap[id] }));

      // 박제 정산비율 복사: 대상에 없으면 출발 값을 그대로 가져온다(재판정 금지 → 비율·과세 변동 없음)
      const newRate = { ...(p.splitRateAtPay || {}) };
      if (newRate[toTid] == null && newRate[fromTid] != null) newRate[toTid] = newRate[fromTid];
      if (splitMap[fromTid] == null) delete newRate[fromTid];

      touchedPays.push({ pid: p.id, patch: { trainerIds: finalTids, split: newSplit, splitRateAtPay: newRate } });
    });

    // ── 원자적 저장: 회원 + 영향받은 결제들을 한 배치로 ──
    const updatedMember = { ...m, trainerSessions: ts };
    const batch = createStampedBatch();
    batch.set('members', memberId, updatedMember);
    touchedPays.forEach(({ pid, patch }) => {
      const cur = (cache.payments[memberId] || []).find(p => p.id === pid);
      if (cur) batch.set('payments', pid, { ...cur, ...patch, __mid: memberId });
    });

    try {
      await batch.commit();
      cache.members = cache.members.map(x => x.id === memberId ? updatedMember : x);
      cache.payments[memberId] = (cache.payments[memberId] || []).map(p => {
        const hit = touchedPays.find(tp => tp.pid === p.id);
        return hit ? { ...p, ...hit.patch } : p;
      });
      __touchSnapshot();
      return updatedMember;
    } catch (e) {
      cache.members = prevMembers;
      cache.payments = prevPayments;
      __touchSnapshot();
      throw e;
    }
  },

  getTrainers:    ()     => cache.trainers,
  addTrainer:     async t => {
    const nt={...t,id:uid('t')}; const prev=cache.trainers;
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
    const ns={...s,id:uid('s')}; const prev=cache.schedules;
    cache.schedules=[...cache.schedules,ns];
    try { await fbSet('schedules',ns.id,ns); return ns; }
    catch(e){ cache.schedules=prev; throw e; }
  },
  updateSchedule:  async (id,p) => {
    const prev=cache.schedules;
    cache.schedules=cache.schedules.map(s=>s.id===id?{...s,...p}:s);
    const u=cache.schedules.find(s=>s.id===id);
    // [버그 수정 2026-08-09] u가 없으면(캐시에 해당 id가 없음 — 이미 다른 곳에서
    // 삭제됐거나 캐시가 오래됨) 예전엔 그냥 조용히 아무것도 안 하고 성공한 것처럼
    // 리턴했다(if(u)가 false라 fbSet 자체를 안 부르고 그대로 끝남). 호출부는
    // "성공"으로 알고 다음 단계(예: 트레이너에게 "옮겼어요"라고 말하기)를
    // 진행하는데 실제로는 Firestore에 아무 것도 안 바뀐 상태 — 특히 예약 시간
    // 변경(reservationService.rescheduleReservation) 확인 흐름처럼 propose(조회)와
    // confirm(저장) 사이에 시간차가 있으면, 그 사이 다른 기기에서 같은 예약을
    // 지웠을 때 이 상태가 재현된다. deleteScheduleWithRestore와 같은 방식으로
    // 명확히 실패시킨다.
    if (!u) {
      cache.schedules = prev;
      throw new Error('스케줄을 찾을 수 없습니다.');
    }
    try { await fbSet('schedules',id,u); }
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
    const nn={...n,id:uid('n')}; const prev=cache.notices;
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
    const np={...p,id:uid('p')}; const prev=cache.payments[mid];
    cache.payments[mid]=[...(cache.payments[mid]||[]), np];
    try { await fbSet('payments', np.id, {...np, __mid:mid}); return np; }
    catch(e){ cache.payments[mid]=prev; throw e; }
  },
  addPaymentWithMemberUpdate: async (mid,p,memberPatch={}) => {
    const np = { ...p, id:uid('p') };
    const member = cache.members.find(m=>m.id===mid);
    const updatedMember = member ? { ...member, ...memberPatch } : null;
    const batch = createStampedBatch();
    batch.set('payments', np.id, { ...np, __mid:mid });
    if (updatedMember) batch.set('members', mid, updatedMember);
    await batch.commit();
    cache.payments[mid]=[...(cache.payments[mid]||[]), np];
    if (updatedMember) cache.members=cache.members.map(m=>m.id===mid?updatedMember:m);
    __touchSnapshot(); // writeBatch는 fbSet을 거치지 않으므로 새로고침 캐시를 직접 갱신(수납+세션 즉시 반영)
    return np;
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
  // 환불 처리 — 결제건에 환불 필드를 기록하고, 회원의 모든 트레이너 잔여 세션을 0으로
  // 정리하는 걸 한 배치로 원자 커밋한다(둘 중 하나만 되는 상황 방지). 환불 전 잔여를
  // payment.refundPrevSessions에 스냅샷으로 남겨, cancelRefund가 정확히 되돌릴 수 있게
  // 한다. total(등록 총회차)은 정산 단가 계산의 기준값이라 건드리지 않는다.
  processRefund: async (mid, pid, fields = {}) => {
    const payment = (cache.payments[mid] || []).find(p => p.id === pid);
    if (!payment) return null;
    const member = cache.members.find(m => m.id === mid);
    const ts = member?.trainerSessions || {};
    const prevSessions = Object.fromEntries(Object.entries(ts).map(([tid, s]) => [tid, s?.remaining ?? 0]));
    const zeroedTs = Object.fromEntries(Object.entries(ts).map(([tid, s]) => [tid, { ...s, remaining: 0 }]));
    const updatedPayment = { ...payment, ...fields, refundPrevSessions: prevSessions };
    const updatedMember = member ? { ...member, trainerSessions: zeroedTs } : null;
    const batch = createStampedBatch();
    batch.set('payments', pid, { ...updatedPayment, __mid: mid });
    if (updatedMember) batch.set('members', mid, updatedMember);
    await batch.commit(); // 실패 시 여기서 throw — 캐시는 아직 안 건드렸으므로 자동으로 이전 상태 그대로.
    cache.payments[mid] = (cache.payments[mid] || []).map(p => p.id === pid ? updatedPayment : p);
    if (updatedMember) cache.members = cache.members.map(m => m.id === mid ? updatedMember : m);
    __touchSnapshot();
    return updatedPayment;
  },
  // 만료 정산 처리 — sessionExpiry.js의 computeExpirySettlement()가 계산한 값을 받아
  // 실제로 기록한다. explicit lot은 payment.expirySettlements[lotId], legacy lot은
  // member.legacyExpirySettlements[trainerId]에 남기고, 그 lot의 잔여만큼만 정확히
  // 차감한다(다른 트레이너 잔여는 건드리지 않음). 이미 정산된 lot이면 이중 지급 방지를
  // 위해 null을 반환하고 아무것도 바꾸지 않는다.
  processExpirySettlement: async (mid, params = {}) => {
    const { trainerId, lotId, paymentId, legacy, sessions, unit, rate, amount } = params;
    if (!(Number(sessions) > 0) || !(Number(amount) > 0)) return null;
    const member = cache.members.find(m => m.id === mid);
    if (!member) return null;
    const ts = member.trainerSessions || {};
    if (!ts[trainerId]) return null;

    const record = { trainerId, sessions: Number(sessions), unit: Number(unit) || 0, rate: Number(rate) || 0, amount: Number(amount), settledAt: todayYMD() };

    let updatedPayment = null;
    if (legacy) {
      if (member.legacyExpirySettlements?.[trainerId]) return null; // 이중 지급 방지
    } else {
      const payment = (cache.payments[mid] || []).find(p => p.id === paymentId);
      if (!payment) return null;
      if (payment.expirySettlements?.[lotId]) return null; // 이중 지급 방지
      updatedPayment = { ...payment, expirySettlements: { ...(payment.expirySettlements || {}), [lotId]: record } };
    }

    const nextRemaining = Math.max(0, (Number(ts[trainerId].remaining) || 0) - Number(sessions));
    const updatedMember = {
      ...member,
      trainerSessions: { ...ts, [trainerId]: { ...ts[trainerId], remaining: nextRemaining } },
      ...(legacy ? { legacyExpirySettlements: { ...(member.legacyExpirySettlements || {}), [trainerId]: record } } : {}),
    };

    const batch = createStampedBatch();
    batch.set('members', mid, updatedMember);
    if (updatedPayment) batch.set('payments', paymentId, { ...updatedPayment, __mid: mid });
    await batch.commit(); // 실패 시 여기서 throw — 캐시는 아직 안 건드렸으므로 자동으로 이전 상태 그대로.

    cache.members = cache.members.map(m => m.id === mid ? updatedMember : m);
    if (updatedPayment) cache.payments[mid] = (cache.payments[mid] || []).map(p => p.id === paymentId ? updatedPayment : p);
    __touchSnapshot();
    return { record };
  },
  // 연장 등록(수동) — 약관 3항 유효기간이 지났거나 임박한 lot에 한해, 관리자가 건별로
  // 남기는 기록. 세션 잔여는 건드리지 않는다(정산이 아니라 유효기간만 뒤로 미는 것).
  // lot당 1건만 허용 — 이미 등록돼 있으면 null(재등록하려면 먼저 취소해야 함).
  registerExpiryExtension: async (mid, params = {}) => {
    const { trainerId, lotId, paymentId, legacy, days } = params;
    if (!(Number(days) > 0)) return null;
    const member = cache.members.find(m => m.id === mid);
    if (!member) return null;

    const record = { days: Number(days), registeredAt: todayYMD() };
    const batch = createStampedBatch();
    let updatedPayment = null;
    let updatedMember = member;

    if (legacy) {
      if (member.legacyExpiryExtensions?.[trainerId]) return null;
      updatedMember = { ...member, legacyExpiryExtensions: { ...(member.legacyExpiryExtensions || {}), [trainerId]: record } };
      batch.set('members', mid, updatedMember);
    } else {
      const payment = (cache.payments[mid] || []).find(p => p.id === paymentId);
      if (!payment) return null;
      if (payment.expiryExtensions?.[lotId]) return null;
      updatedPayment = { ...payment, expiryExtensions: { ...(payment.expiryExtensions || {}), [lotId]: record } };
      batch.set('payments', paymentId, { ...updatedPayment, __mid: mid });
    }

    await batch.commit();
    if (legacy) cache.members = cache.members.map(m => m.id === mid ? updatedMember : m);
    if (updatedPayment) cache.payments[mid] = (cache.payments[mid] || []).map(p => p.id === paymentId ? updatedPayment : p);
    __touchSnapshot();
    return { record };
  },
  // 연장 등록 취소 — 원래(연장 전) 유효기간으로 정확히 되돌린다. 기록이 없으면 null.
  cancelExpiryExtension: async (mid, params = {}) => {
    const { trainerId, lotId, paymentId, legacy } = params;
    const member = cache.members.find(m => m.id === mid);
    if (!member) return null;

    const batch = createStampedBatch();
    let updatedPayment = null;
    let updatedMember = member;

    if (legacy) {
      if (!member.legacyExpiryExtensions?.[trainerId]) return null;
      const next = { ...member.legacyExpiryExtensions };
      delete next[trainerId];
      updatedMember = { ...member, legacyExpiryExtensions: next };
      batch.set('members', mid, updatedMember);
    } else {
      const payment = (cache.payments[mid] || []).find(p => p.id === paymentId);
      if (!payment || !payment.expiryExtensions?.[lotId]) return null;
      const next = { ...payment.expiryExtensions };
      delete next[lotId];
      updatedPayment = { ...payment, expiryExtensions: next };
      batch.set('payments', paymentId, { ...updatedPayment, __mid: mid });
    }

    await batch.commit();
    if (legacy) cache.members = cache.members.map(m => m.id === mid ? updatedMember : m);
    if (updatedPayment) cache.payments[mid] = (cache.payments[mid] || []).map(p => p.id === paymentId ? updatedPayment : p);
    __touchSnapshot();
    return { ok: true };
  },
  // 환불취소 — 환불 필드를 지우고, processRefund가 남긴 refundPrevSessions 스냅샷으로
  // 잔여 세션을 정확히 복구한다. 스냅샷이 없는(옛 데이터/수기 환불) 결제는 세션은
  // 건드리지 않고 환불 필드만 정리한다(잘못 건드려 세션이 어긋나는 것을 방지).
  cancelRefund: async (mid, pid) => {
    const payment = (cache.payments[mid] || []).find(p => p.id === pid);
    if (!payment) return null;
    const member = cache.members.find(m => m.id === mid);
    const snapshot = payment.refundPrevSessions;
    let updatedMember = null;
    if (member && snapshot) {
      const ts = member.trainerSessions || {};
      const restoredTs = Object.fromEntries(
        Object.entries(ts).map(([tid, s]) => [tid, { ...s, remaining: snapshot[tid] ?? s.remaining }])
      );
      updatedMember = { ...member, trainerSessions: restoredTs };
    }
    const updatedPayment = {
      ...payment,
      isRefunded: false,
      refundAmount: null,
      refundedAt: null,
      refundCardFee: null,
      refundPenalty: null,
      refundUsed: null,
      refundPrevSessions: null,
    };
    const batch = createStampedBatch();
    batch.set('payments', pid, { ...updatedPayment, __mid: mid });
    if (updatedMember) batch.set('members', mid, updatedMember);
    await batch.commit();
    cache.payments[mid] = (cache.payments[mid] || []).map(p => p.id === pid ? updatedPayment : p);
    if (updatedMember) cache.members = cache.members.map(m => m.id === mid ? updatedMember : m);
    __touchSnapshot();
    return updatedPayment;
  },
  // 과거 스케줄에 consumedIndexAtBooking 소급 부여(회차 매핑 마이그레이션).
  //  · patches: [{ id, consumedIndexAtBooking }] (finance.planConsumedIndexBackfill 결과)
  //  · Firestore 배치 한도(500) 고려해 나눠 커밋. 실패 시 캐시 롤백.
  backfillConsumedIndex: async (patches = []) => {
    if (!patches.length) return 0;
    const prev = JSON.parse(JSON.stringify(cache.schedules));
    try {
      for (let i = 0; i < patches.length; i += 400) {
        const chunk = patches.slice(i, i + 400);
        const batch = createStampedBatch();
        chunk.forEach(({ id, consumedIndexAtBooking }) => {
          const cur = cache.schedules.find(s => s.id === id);
          if (cur) batch.set('schedules', id, { ...cur, consumedIndexAtBooking });
        });
        await batch.commit();
        chunk.forEach(({ id, consumedIndexAtBooking }) => {
          cache.schedules = cache.schedules.map(s => s.id === id ? { ...s, consumedIndexAtBooking } : s);
        });
      }
      __touchSnapshot();
      return patches.length;
    } catch (e) {
      cache.schedules = prev;
      __touchSnapshot();
      throw e;
    }
  },
  // 방향 A: 수동 정산비율을 결제 건에 영구 박제 — planRateFreeze 가 만든 patch 목록을
  // 한 배치로 적용한다(splitRateAtPay 갱신). 소진 끝까지 그 비율이 유지된다.
  //  · patches: [{ mid, pid, splitRateAtPay, prev }] (finance.planRateFreeze 결과)
  //  · 원자적 저장 — 하나라도 실패하면 캐시를 롤백한다.
  freezeMemberRate: async (patches = []) => {
    if (!patches.length) return 0;
    const prevPayments = JSON.parse(JSON.stringify(cache.payments));
    try {
      for (let i = 0; i < patches.length; i += 400) {
        const chunk = patches.slice(i, i + 400);
        const batch = createStampedBatch();
        chunk.forEach(({ mid, pid, splitRateAtPay }) => {
          const cur = (cache.payments[mid] || []).find(p => p.id === pid);
          if (cur) batch.set('payments', pid, { ...cur, splitRateAtPay, __mid: mid });
        });
        await batch.commit();
        chunk.forEach(({ mid, pid, splitRateAtPay }) => {
          cache.payments[mid] = (cache.payments[mid] || []).map(p =>
            p.id === pid ? { ...p, splitRateAtPay } : p);
        });
      }
      __touchSnapshot();
      return patches.length;
    } catch (e) {
      cache.payments = prevPayments;
      __touchSnapshot();
      throw e;
    }
  },
  deleteAllPayments: async (mid) => {
    const list=cache.payments[mid]||[];
    await fbDeleteBatch(list.map(p=>({name:'payments',id:p.id})));
    delete cache.payments[mid];
  },

  getBodyRecords:   (mid)    => cache.body[mid] || [],
  addBodyRecord:    async (mid,r) => {
    const nr={...r,id:uid('b')}; const prev=cache.body[mid];
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
  // ROM 측정 요약을 회원 신체기록(body)에 남긴다(실회원만). 신체기록 타임라인에
  // '최신 ROM 상태'가 함께 보이도록 하기 위한 것. 기존 body 스키마를 그대로 쓰되
  // recordType='rom_summary' 로 구분하고, 키/몸무게 칸은 비운다(측정 정직성).
  //  summary: { joint, poseMode, movement, left, right, symmetry, unit, confidenceScore, measureType, reportId }
  addRomSummaryToBody: async (mid, summary) => {
    if (!mid || !summary) return null;
    const nr = {
      id: uid('b'),
      recordType: 'rom_summary',
      recordedAt: summary.recordedAt || new Date().toISOString().slice(0, 10),
      height: null,
      weight: null,
      systolic: null,
      diastolic: null,
      romSummary: {
        joint: summary.joint || '',
        poseMode: summary.poseMode || '',
        movement: summary.movement || '',
        angle: summary.angle ?? null,      // 단일 가동각(센서 고니오메타)
        left: summary.left ?? null,
        right: summary.right ?? null,
        symmetry: summary.symmetry ?? null,
        unit: summary.unit || 'deg',
        measureType: summary.measureType || '',
        confidenceScore: summary.confidenceScore ?? null,
        reportId: summary.reportId || '',
      },
      note: summary.note || 'AI ROM 측정 요약',
    };
    const prev = cache.body[mid];
    cache.body[mid] = [...(cache.body[mid] || []), nr];
    try { await fbSet('body', nr.id, { ...nr, __mid: mid }); return nr; }
    catch (e) { cache.body[mid] = prev; throw e; }
  },
  deleteAllBodyRecords: async (mid) => {
    const list=cache.body[mid]||[];
    await fbDeleteBatch(list.map(r=>({name:'body',id:r.id})));
    delete cache.body[mid];
  },

  // 회원 1명의 모든 개인정보를 삭제 (스케줄·수납·신체·AI·회원) — CV-04/CV-06
  // ⚠️ 장기 회원은 누적 문서가 500건(Firestore batch 한계)을 넘을 수 있다.
  //    fbDeleteBatch가 500건 미만으로 쪼개 여러 batch로 처리한다.
  //    회원 문서(members)는 "맨 마지막"에 삭제한다 → 중간에 실패해도 회원이 남아 있어
  //    같은 작업을 다시 실행하면 남은 데이터를 멱등하게 마저 지울 수 있다.
  purgeMember: async (mid) => {
    const sub = [];   // 하위 데이터(여러 chunk로 나뉠 수 있음)
    cache.schedules.filter(s=>s.memberId===mid).forEach(s=>sub.push({name:'schedules',id:s.id}));
    (cache.payments[mid]||[]).forEach(p=>sub.push({name:'payments',id:p.id}));
    (cache.body[mid]||[]).forEach(r=>sub.push({name:'body',id:r.id}));
    (cache.ai[mid]||[]).forEach(a=>sub.push({name:'ai',id:a.id}));

    // 측정 데이터(ai/gait_reports)는 지연 로딩이라 캐시가 비어 있을 수 있다.
    // 고아 데이터 방지를 위해 Firestore 에서 __mid 로 직접 조회해 삭제 목록에 포함.
    try {
      const aiSnap = await getDocs(query(collection(db,'ai'), where('__mid','==',mid)));
      aiSnap.docs.forEach(d => { if (!sub.some(x=>x.name==='ai'&&x.id===d.id)) sub.push({name:'ai',id:d.id}); });
    } catch (e) { console.warn('[purgeMember] ai 조회 실패:', e?.code||e?.message); }
    try {
      const gSnap = await getDocs(query(collection(db,'gait_reports'), where('__mid','==',mid)));
      gSnap.docs.forEach(d => sub.push({name:'gait_reports',id:d.id}));
    } catch (e) { console.warn('[purgeMember] gait_reports 조회 실패:', e?.code||e?.message); }
    try {
      const pSnap = await getDocs(query(collection(db,'posture_reports'), where('__mid','==',mid)));
      pSnap.docs.forEach(d => sub.push({name:'posture_reports',id:d.id}));
    } catch (e) { console.warn('[purgeMember] posture_reports 조회 실패:', e?.code||e?.message); }
    try {
      const rSnap = await getDocs(query(collection(db,'rom_reports'), where('__mid','==',mid)));
      rSnap.docs.forEach(d => sub.push({name:'rom_reports',id:d.id}));
    } catch (e) { console.warn('[purgeMember] rom_reports 조회 실패:', e?.code||e?.message); }

    // 1) 하위 데이터 먼저 chunk 단위로 삭제 (실패 시 여기서 throw → 회원 문서는 손대지 않음)
    await fbDeleteBatch(sub);
    // 2) 모든 하위 삭제 성공 후에만 회원 문서 삭제
    await fbDeleteBatch([{name:'members',id:mid}]);

    // 성공 시에만 캐시 반영
    cache.schedules=cache.schedules.filter(s=>s.memberId!==mid);
    delete cache.payments[mid];
    delete cache.body[mid];
    delete cache.ai[mid];
    if (cache.gaitReports) delete cache.gaitReports[mid];
    if (cache.postureReports) delete cache.postureReports[mid];
    if (cache.romReports) delete cache.romReports[mid];
    aiStore._aiLoaded.delete(mid);
    aiStore._gaitLoaded.delete(mid);
    aiStore._postureLoaded.delete(mid);
    aiStore._romLoaded.delete(mid);
    cache.members=cache.members.filter(m=>m.id!==mid);
  },

  // 예약 생성 + 세션 차감 + sessionDeducted 플래그를 한 batch로 원자적 처리 — NEW-03
  // 일반 수업(회원+트레이너, 비외부)만 차감. 하나라도 실패하면 전체 실패.
  //
  //  ★ 동시 예약 경쟁 방지: 두 예약이 거의 동시에 들어오면 둘 다 캐시의 같은
  //  잔여값(예: 10)을 읽어, 둘 다 sessionAtBooking=10(첫 수업)으로 찍히고 차감은
  //  한 번만 반영되는 문제가 있었다(스케줄엔 10(s)가 두 번, 세션은 1회만 사용).
  //  → 차감 로직을 직렬화(이전 차감이 끝난 뒤 다음 차감이 캐시를 읽도록)한다.
  createScheduleWithDeduction: async (scheduleData) => {
    const run = () => store._doCreateScheduleWithDeduction(scheduleData);
    // 직전 차감이 끝난 뒤 실행(성공/실패 무관하게 이어서). 체인으로 순차 보장.
    const prev = store._deductionChain || Promise.resolve();
    const next = prev.then(run, run);
    // 체인에는 에러가 전파되지 않도록 감싸서 저장(다음 호출이 막히지 않게)
    store._deductionChain = next.then(() => undefined, () => undefined);
    return next;
  },

  _deductionChain: null,

  _doCreateScheduleWithDeduction: async (scheduleData) => {
    const ns = { ...scheduleData, id: uid('s') };
    // 세션 슬롯이 있는 회원·트레이너만 차감 대상.
    //  · 월정액만 있는 회원은 trainerSessions에 해당 슬롯이 없어 자동으로 차감되지 않는다.
    //  · 세션 수업과 월정액을 함께 보유한 회원도, 세션 슬롯이 있으면 그 수업은 정상 차감된다.
    const isDeductible = !ns.isExternal && ns.memberId && ns.trainerId;
    const batch = createStampedBatch();

    let updatedMember = null;
    let deductionSkipReason = null; // 차감이 안 된 사유(진단용)
    if (isDeductible) {
      const member = cache.members.find(m=>m.id===ns.memberId);
      if (!member) {
        deductionSkipReason = 'member_not_found';
        ns.sessionDeducted = false;
      } else if (!member.trainerSessions?.[ns.trainerId]) {
        // 이 회원-트레이너 조합에 세션 슬롯이 없음
        deductionSkipReason = 'no_session_slot';
        ns.sessionDeducted = false;
      } else if ((member.trainerSessions[ns.trainerId].remaining ?? 0) <= 0) {
        // 슬롯은 있으나 잔여 0 — 차감할 회차 없음(세션 소진)
        deductionSkipReason = 'no_remaining';
        ns.sessionAtBooking      = 0;
        ns.sessionTotalAtBooking = member.trainerSessions[ns.trainerId].total ?? null;
        ns.sessionDeducted = false;
      } else {
        const ts = JSON.parse(JSON.stringify(member.trainerSessions||{}));
        // ★ 회차표기: 차감 직전 잔여값 = 이 수업의 회차 번호. 총횟수와 함께 기록.
        ns.sessionAtBooking      = ts[ns.trainerId].remaining ?? null;
        ns.sessionTotalAtBooking = ts[ns.trainerId].total ?? null;
        // ★ 누적 소진 인덱스(0-기반) = (누적 등록 총횟수) − (차감 직전 잔여).
        //   등록분마다 리셋되는 잔여번호와 달리 전 등록분에 걸쳐 단조 증가 → 회차 매핑이 겹치지 않는다.
        {
          const totalEver = Number(ts[ns.trainerId].total);
          const remainBefore = Number(ts[ns.trainerId].remaining);
          ns.consumedIndexAtBooking = (Number.isFinite(totalEver) && Number.isFinite(remainBefore))
            ? Math.max(0, totalEver - remainBefore) : null;
        }
        ts[ns.trainerId].remaining = Math.max(0, ts[ns.trainerId].remaining - 1);
        updatedMember = { ...member, trainerSessions: ts };
        ns.sessionDeducted = true;
        batch.set('members', ns.memberId, updatedMember);
      }
    } else {
      ns.sessionDeducted = false;
      if (!ns.isExternal) deductionSkipReason = 'not_deductible';
    }
    batch.set('schedules', ns.id, ns);
    await batch.commit();   // 예약+차감이 함께 성공하거나 함께 실패

    // 성공 시에만 캐시 반영
    cache.schedules=[...cache.schedules, ns];
    if (updatedMember) cache.members=cache.members.map(m=>m.id===updatedMember.id?updatedMember:m);
    // 방금 예약이 날짜순으로 봤을 때 기존 예약들 사이에 끼어들었다면(생성 순서 ≠
    // 날짜 순서) 회차 표기가 역전될 수 있다 — 날짜순 내림차순으로 재정렬한다.
    // 표시용 보정이라 실패해도 방금 만든 예약 자체는 이미 정상 저장된 상태.
    if (ns.sessionDeducted && ns.sessionAtBooking != null) {
      await renumberSessionAtBooking(ns.memberId, ns.trainerId);
    }
    // 진단 정보를 반환(호출부에서 경고 표시 가능). 일반 수업인데 차감 안 됐으면 사유 포함.
    return { ...ns, _deductionSkipReason: deductionSkipReason };
  },

  // 상태 확정 + (출석 시 출석일 / 취소·노쇼 시 세션 복원)을 한 batch로 — NEW-03
  // createScheduleWithDeduction 과 동일한 이유로 _deductionChain 에 직렬화한다:
  // 더블탭이나 다른 탭/기기에서 같은 스케줄을 거의 동시에 확정(특히 취소)하면
  // 둘 다 statusFinalized=false 스냅샷을 읽어 세션을 이중 복원할 수 있다.
  finalizeSchedule: async (scheduleId, status) => {
    const run = () => store._doFinalizeSchedule(scheduleId, status);
    const prev = store._deductionChain || Promise.resolve();
    const next = prev.then(run, run);
    store._deductionChain = next.then(() => undefined, () => undefined);
    return next;
  },

  _doFinalizeSchedule: async (scheduleId, status) => {
    const sched = cache.schedules.find(s=>s.id===scheduleId);
    if (!sched) throw new Error('스케줄을 찾을 수 없습니다.');
    // 체인에서 순서가 밀리는 동안(직전 호출 처리 중) 이미 확정됐을 수 있다 —
    // 여기서 최신 캐시 기준으로 재확인해야 이중 복원을 실제로 막는다.
    if (sched.statusFinalized) throw new Error('이미 처리된 스케줄입니다.');
    const batch = createStampedBatch();
    const updatedSched = { ...sched, status, statusFinalized: true };
    batch.set('schedules', scheduleId, updatedSched);

    let updatedMember = null;
    if (!sched.isExternal && sched.memberId) {
      const member = cache.members.find(m=>m.id===sched.memberId);
      if (member) {
        if (status === 'attended' || status === 'noshow') {
          // 계약서 2조: 노쇼도 출석과 동일하게 횟수 차감 유지(복원 안 함)
          updatedMember = { ...member, lastAttendedDate: todayYMD() }; // CV-A: 로컬 날짜
        } else if (status === 'canceled' && sched.sessionDeducted) {
          // 취소만 세션 복원
          const ts = JSON.parse(JSON.stringify(member.trainerSessions||{}));
          if (ts[sched.trainerId]) {
            const cap = ts[sched.trainerId].total ?? Infinity;
            ts[sched.trainerId].remaining = Math.min(cap, ts[sched.trainerId].remaining + 1);
          }
          updatedMember = { ...member, trainerSessions: ts };
        }
        if (updatedMember) batch.set('members', sched.memberId, updatedMember);
      }
    }
    await batch.commit();

    cache.schedules=cache.schedules.map(s=>s.id===scheduleId?updatedSched:s);
    if (updatedMember) cache.members=cache.members.map(m=>m.id===updatedMember.id?updatedMember:m);
    return updatedSched;
  },

  // 스케줄 삭제 + (필요 시 세션 복원)을 한 batch로 — 삭제만 성공/복원만 성공하는 불일치 방지
  //  · 예약 시 차감(sessionDeducted)했고 아직 출석/취소 확정 전(!statusFinalized)일 때만 복원
  //  · finalizeSchedule과 동일한 이유로 _deductionChain에 직렬화(동시 삭제 이중 복원 방지)
  deleteScheduleWithRestore: async (scheduleId) => {
    const run = () => store._doDeleteScheduleWithRestore(scheduleId);
    const prev = store._deductionChain || Promise.resolve();
    const next = prev.then(run, run);
    store._deductionChain = next.then(() => undefined, () => undefined);
    return next;
  },

  _doDeleteScheduleWithRestore: async (scheduleId) => {
    const sched = cache.schedules.find(s=>s.id===scheduleId);
    if (!sched) throw new Error('스케줄을 찾을 수 없습니다.');
    const batch = createStampedBatch();
    batch.delete('schedules', scheduleId);

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
        batch.set('members', sched.memberId, updatedMember);
      }
    }
    await batch.commit();

    cache.schedules = cache.schedules.filter(s=>s.id!==scheduleId);
    if (updatedMember) cache.members=cache.members.map(m=>m.id===updatedMember.id?updatedMember:m);
  },

  // ── 매출/정산 설정 ───────────────────────────────────────
  getSettings: () => ({ ...INITIAL_SETTINGS, ...cache.settings }),
  // 설정 저장 — 저장 직전 서버 최신값을 다시 읽어 그 위에 patch만 얹는다.
  //  · 배경: 설정 탭을 오래 열어둔 세션에서 저장하면, 그 사이 다른 기기/세션이
  //    바꾼 값(예: 트레이너별 정산비율)을 옛 스냅샷으로 덮어써 되돌리는 사고가 있었다
  //    (6월에 60%로 고정했는데 7월에 다시 50%로 보이던 문제).
  //  · trainerSplitRateChanges: { [trainerId]: rate|null } — 실제로 사용자가 건드린
  //    트레이너만 담아서 넘기면, 다른 트레이너의 비율은 항상 "방금 읽은 서버 최신값"을
  //    그대로 보존한다(건드리지 않은 트레이너는 절대 덮어쓰지 않음).
  //  · patch의 나머지 키도 호출부(설정 화면)에서 실제로 바뀐 필드만 담아 보낸다.
  updateSettings: async (patch) => {
    const prev = cache.settings;
    try {
      let fresh = cache.settings || {};
      try {
        const snap = await countedGetDocs('settings(refresh)', collection(db, 'settings'));
        const doc0 = snap.docs.find(d => d.data().id === 'config');
        if (doc0) fresh = doc0.data();
      } catch (e) { /* 네트워크 실패 시 로컬 캐시로 폴백 */ }

      const { trainerSplitRateChanges, ...rest } = patch || {};
      const mergedRates = { ...(fresh.trainerSplitRates || {}) };
      if (trainerSplitRateChanges) {
        Object.entries(trainerSplitRateChanges).forEach(([tid, v]) => {
          if (v === null || v === undefined || v === '') delete mergedRates[tid];
          else mergedRates[tid] = v;
        });
      }
      cache.settings = { ...INITIAL_SETTINGS, ...fresh, ...rest, trainerSplitRates: mergedRates, id: 'config' };
      await fbSet('settings', 'config', cache.settings);
      return cache.settings;
    } catch (e) { cache.settings = prev; throw e; }
  },

  // ── 지출(고정비/월별) ────────────────────────────────────
  // kind: 'fixed' | 'monthly'
  getExpenses: () => cache.expenses,
  addExpense: async (e) => {
    const ne = { ...e, id:uid('e') }; const prev = cache.expenses;
    cache.expenses = [...cache.expenses, ne];
    try { await fbSet('expenses', ne.id, ne); return ne; }
    catch(err){ cache.expenses = prev; throw err; }
  },
  // 회원+결제 일괄 등록(매출관리 엑셀 가져오기).
  // members: [{ name, phone?, monthly, trainerSessions, classTypes, lastPaymentDate, payments[] }]
  // 같은 이름(+연락처)이 이미 있으면 건너뛴다. 회원·결제를 한 배치로 원자적 등록.
  addMembersBatch: async (members) => {
    const prevM = cache.members;
    const prevP = JSON.parse(JSON.stringify(cache.payments));
    const existKey = new Set(cache.members.map(m => `${(m.name||'').trim()}|${(m.phone||'').replace(/\D/g,'')}`));
    const batch = createStampedBatch();
    const addedMembers = [];
    const addedPays = {};
    let skipped = 0;
    for (const M of members) {
      const name = (M.name || '').trim();
      if (!name) { skipped++; continue; }
      const phoneDigits = (M.phone || '').replace(/\D/g, '');
      if (existKey.has(`${name}|${phoneDigits}`)) { skipped++; continue; }
      existKey.add(`${name}|${phoneDigits}`);
      const mid = uid('m');
      const member = {
        id: mid, name, phone: M.phone || '', phone2: '',
        gender: M.gender || '', birthDate: '', address: '', job: '',
        joinDate: M.lastPaymentDate || todayYMD(),
        lastPaymentDate: M.lastPaymentDate || null,
        lastAttendedDate: null, memo: M.memo || '',
        classTypes: M.classTypes || [],
        trainerSessions: M.trainerSessions || {},
        monthly: M.monthly || null,
        isActive: true, createdAt: new Date().toISOString(),
        importedFrom: 'excel',
      };
      batch.set('members', mid, member);
      addedMembers.push(member);
      (M.payments || []).forEach(p => {
        const pid = uid('p');
        const np = { ...p, id: pid, __mid: mid };
        batch.set('payments', pid, np);
        (addedPays[mid] = addedPays[mid] || []).push(np);
      });
    }
    if (!addedMembers.length) return { added: 0, skipped };
    try {
      await batch.commit();
      cache.members = [...cache.members, ...addedMembers];
      Object.entries(addedPays).forEach(([mid, arr]) => {
        cache.payments[mid] = [...(cache.payments[mid] || []), ...arr];
      });
      return { added: addedMembers.length, skipped };
    } catch (err) { cache.members = prevM; cache.payments = prevP; throw err; }
  },
  // 지출 일괄 등록(엑셀 가져오기). 같은 분류·귀속월·항목명·금액이면 중복으로 보고 건너뛴다.
  addExpenseBatch: async (list) => {
    const prev = cache.expenses;
    const key = (e) => `${e.kind||'monthly'}|${e.category||''}|${e.ym||''}|${(e.name||'').trim()}|${Number(e.amount)||0}`;
    const existing = new Set(cache.expenses.map(key));
    const toAdd = [];
    for (const raw of list) {
      const e = {
        kind: raw.kind || 'monthly',
        category: raw.category || '기타',
        name: (raw.name || '').trim(),
        amount: Number(raw.amount) || 0,
        ym: raw.ym || '',
        date: raw.date || (raw.ym ? `${raw.ym}-01` : todayYMD()),
        note: raw.note || '',
      };
      if (!e.amount || (e.kind === 'monthly' && !e.ym)) continue; // 금액·귀속월 필수
      const k = key(e);
      if (existing.has(k)) continue; // 중복 스킵
      existing.add(k);
      toAdd.push({ ...e, id: uid('e') });
    }
    if (toAdd.length === 0) return { added: 0, skipped: list.length };
    const batch = createStampedBatch();
    toAdd.forEach(e => batch.set('expenses', e.id, e));
    try {
      await batch.commit();
      cache.expenses = [...cache.expenses, ...toAdd];
      return { added: toAdd.length, skipped: list.length - toAdd.length };
    } catch (err) { cache.expenses = prev; throw err; }
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
    const np = { ...p, id:uid('pr') }; const prev = cache.promos;
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

  // 정산 수정값(단가/횟수/정산비율 override) — 문서 id = `${trainerId}_${ym}`
  // { id, trainerId, ym, unitPrices:{memberId:단가}, sessionCounts:{memberId:횟수}, splitRates:{memberId:비율}, blogCount, instaCount }
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
  deleteSettleOverride: async (trainerId, ym) => {
    const id = `${trainerId}_${ym}`;
    const prev = cache.settleOverrides;
    cache.settleOverrides = cache.settleOverrides.filter(o => o.id !== id);
    try { await fbDelete('settleOverrides', id); }
    catch(e){ cache.settleOverrides = prev; throw e; }
  },

  // ── 데이터 무결성 검사(integrityAudit.js) — "무시(정상)" 처리 ──────────────
  //  finding.key를 문서 id로 그대로 써서 같은 문제는 항상 같은 문서에 덮어쓴다
  //  (재무시해도 중복 안 쌓임). addPostureReport(aiStore)와 동일한 낙관적 갱신 +
  //  실패 시 롤백 패턴 — 화면은 즉시 반영되고, 저장 실패 시에만 되돌아간다.
  getIntegrityDismissals: () => cache.integrityDismissals,
  dismissIntegrityFinding: async (finding, { dismissedBy = null } = {}) => {
    if (!finding?.key) throw new Error('finding.key가 없어 무시 처리를 할 수 없습니다.');
    const prev = cache.integrityDismissals;
    const record = { ...finding, id: finding.key, dismissedBy, dismissedAt: Date.now() };
    cache.integrityDismissals = [...prev.filter(d => d.id !== finding.key), record];
    try {
      await fbSet('integrityDismissals', finding.key, record);
      return record;
    } catch (e) {
      cache.integrityDismissals = prev;
      throw e;
    }
  },
};

// 가상(미등록)회원 측정 데이터의 __mid 접두사. 실제 회원 id(m...)와 구분되며,
// 한 번의 미등록회원 측정 묶음마다 고유 guest id 를 발급해 개인별로 분리 저장한다.
//  예: 'guest_1782648377018042'
export const GUEST_MID_PREFIX = 'guest_';
export const VIRTUAL_MID = '__virtual__'; // (구버전 호환용 — 신규 측정엔 개별 guest id 사용)

// 미등록회원 1인의 측정 묶음용 고유 id 발급. 측정 세션 시작 시 1회 호출해
// 여러 면/여러 항목이 같은 id 로 묶이게 한다.
export function makeGuestId() {
  return uid(GUEST_MID_PREFIX);
}

// __mid 가 미등록(게스트) 측정인지 판별.
export function isGuestMid(mid) {
  return typeof mid === 'string' && mid.startsWith(GUEST_MID_PREFIX);
}

export const aiStore = {
  // ── 지연 로딩 추적: 이미 읽은 회원은 다시 읽지 않는다(세션 내) ──
  _aiLoaded: new Set(),
  _gaitLoaded: new Set(),
  _postureLoaded: new Set(),
  _romLoaded: new Set(),

  // 회원별 ai 세션을 필요 시점에만 읽어 캐시에 채운다(전수 조회 회피).
  // 측정 화면 effect 에서 await 후 동기 getSessions 로 읽으면 된다.
  ensureSessions: async (mid) => {
    if (!mid || aiStore._aiLoaded.has(mid)) return cache.ai[mid] || [];
    try {
      const snap = await countedGetDocs(`ai(mid:${mid})`, query(collection(db, 'ai'), where('__mid', '==', mid)));
      cache.ai[mid] = snap.docs.map(d => { const { __mid, ...rest } = d.data(); return rest; });
      aiStore._aiLoaded.add(mid);
    } catch (e) {
      console.warn('[aiStore.ensureSessions] 로딩 실패:', e?.code || e?.message);
      cache.ai[mid] = cache.ai[mid] || [];
    }
    return cache.ai[mid];
  },
  ensureGaitReports: async (mid) => {
    if (!mid || aiStore._gaitLoaded.has(mid)) return cache.gaitReports[mid] || [];
    try {
      const snap = await countedGetDocs(`gait_reports(mid:${mid})`, query(collection(db, 'gait_reports'), where('__mid', '==', mid)));
      cache.gaitReports[mid] = snap.docs.map(d => { const { __mid, ...rest } = d.data(); return rest; });
      aiStore._gaitLoaded.add(mid);
    } catch (e) {
      console.warn('[aiStore.ensureGaitReports] 로딩 실패:', e?.code || e?.message);
      cache.gaitReports[mid] = cache.gaitReports[mid] || [];
    }
    return cache.gaitReports[mid];
  },
  ensureRomReports: async (mid) => {
    if (!mid || aiStore._romLoaded.has(mid)) return cache.romReports[mid] || [];
    try {
      const snap = await countedGetDocs(`rom_reports(mid:${mid})`, query(collection(db, 'rom_reports'), where('__mid', '==', mid)));
      cache.romReports[mid] = snap.docs.map(d => { const { __mid, ...rest } = d.data(); return rest; });
      aiStore._romLoaded.add(mid);
    } catch (e) {
      console.warn('[aiStore.ensureRomReports] 로딩 실패:', e?.code || e?.message);
      cache.romReports[mid] = cache.romReports[mid] || [];
    }
    return cache.romReports[mid];
  },

  getSessions:   (mid)    => cache.ai[mid] || [],
  addSession:    async (mid, s) => {
    const ns={...s, id:uid('ai')}; const prev=cache.ai[mid];
    cache.ai[mid]=[...(cache.ai[mid]||[]), ns];
    aiStore._aiLoaded.add(mid);   // 이후 ensureSessions 가 덮어쓰지 않도록 로딩됨 표시
    try {
      await fbSet('ai', ns.id, {...ns, __mid:mid});
      // jump/vbt/1RM 등 측정 세션만 통합 리포트로 미러링(신체정보 등 비측정 세션은 제외).
      const t = inferReportType({ ...ns, member: { id: mid } });
      if (t !== 'general') await mirrorUnifiedReport(mid, { ...ns, member: { id: mid } }, t);
      return ns;
    }
    catch(e){ cache.ai[mid]=prev; throw e; }
  },
  deleteSession: async (mid, sid) => {
    const prev=cache.ai[mid];
    cache.ai[mid]=(cache.ai[mid]||[]).filter(s=>s.id!==sid);
    try { await fbDelete('ai', sid); await unmirrorUnifiedReport(mid, sid); }
    catch(e){ cache.ai[mid]=prev; throw e; }
  },
  // [Axis3 확장 2026-08-08] MomiAutoNote.jsx(자동 노트)를 VBT/스탠스/스쿼트처럼
  // 전용 컬렉션 없이 세션(ai)에 저장되는 측정에도 연결하기 위해 추가 —
  // updateGaitReport/updateRomReport와 동일한 낙관적 갱신 + 실패 시 롤백 패턴.
  updateSession: async (mid, sid, patch) => {
    const prev = cache.ai[mid];
    cache.ai[mid] = (cache.ai[mid] || []).map(s => s.id === sid ? { ...s, ...patch } : s);
    const u = (cache.ai[mid] || []).find(s => s.id === sid);
    try { if (u) await fbSet('ai', sid, { ...u, __mid: mid }); return u; }
    catch (e) { cache.ai[mid] = prev; throw e; }
  },
  // 전용 리포트 삭제(측정별/회차별 삭제 기능) — deleteSession과 동일한 낙관적 캐시 반영 패턴.
  deleteGaitReport: async (mid, rid) => {
    const prev = cache.gaitReports[mid];
    cache.gaitReports[mid] = (cache.gaitReports[mid] || []).filter(r => r.id !== rid);
    try { await fbDelete('gait_reports', rid); await unmirrorUnifiedReport(mid, rid); }
    catch (e) { cache.gaitReports[mid] = prev; throw e; }
  },
  // [Axis3 확장 2026-08-08] MomiAutoNote.jsx(자동 노트)를 gait/jump 리포트에도 연결하기
  // 위해 추가 — updatePostureReport와 동일한 낙관적 갱신 + 실패 시 롤백 패턴.
  updateGaitReport: async (mid, rid, patch) => {
    const prev = cache.gaitReports[mid];
    cache.gaitReports[mid] = (cache.gaitReports[mid] || []).map(r => r.id === rid ? { ...r, ...patch } : r);
    const u = (cache.gaitReports[mid] || []).find(r => r.id === rid);
    try { if (u) await fbSet('gait_reports', rid, { ...u, __mid: mid }); return u; }
    catch (e) { cache.gaitReports[mid] = prev; throw e; }
  },
  deletePostureReport: async (mid, rid) => {
    const prev = cache.postureReports[mid];
    cache.postureReports[mid] = (cache.postureReports[mid] || []).filter(r => r.id !== rid);
    try { await fbDelete('posture_reports', rid); await unmirrorUnifiedReport(mid, rid); }
    catch (e) { cache.postureReports[mid] = prev; throw e; }
  },
  deleteRomReport: async (mid, rid) => {
    const prev = cache.romReports[mid];
    cache.romReports[mid] = (cache.romReports[mid] || []).filter(r => r.id !== rid);
    try { await fbDelete('rom_reports', rid); await unmirrorUnifiedReport(mid, rid); }
    catch (e) { cache.romReports[mid] = prev; throw e; }
  },
  // [Axis3 확장 2026-08-08] MomiAutoNote.jsx를 ROM 리포트에도 연결하기 위해 추가 —
  // updatePostureReport와 동일한 낙관적 갱신 + 실패 시 롤백 패턴.
  updateRomReport: async (mid, rid, patch) => {
    const prev = cache.romReports[mid];
    cache.romReports[mid] = (cache.romReports[mid] || []).map(r => r.id === rid ? { ...r, ...patch } : r);
    const u = (cache.romReports[mid] || []).find(r => r.id === rid);
    try { if (u) await fbSet('rom_reports', rid, { ...u, __mid: mid }); return u; }
    catch (e) { cache.romReports[mid] = prev; throw e; }
  },
  deleteAll:     async (mid) => {
    const list=cache.ai[mid]||[];
    await fbDeleteBatch(list.map(s=>({name:'ai',id:s.id})));
    delete cache.ai[mid];
  },
  // 분석 리포트 전용 컬렉션(gait_reports)에 정량 데이터를 저장 + 재조회 가능하게.
  // 보행/점프 모두 이 컬렉션에 쌓아 회차별 비교(추세)에 쓴다.
  // 영상 자체는 용량이 커 Firestore 에 올리지 않고, 리포트(JSON) + 캡처(JPG)만 남긴다.
  getGaitReports: (mid) => (cache.gaitReports[mid] || []),
  addGaitReport: async (report) => {
    const mid = report?.member?.id || null;
    const r = { ...report, id: uid('gait'), createdAt: new Date().toISOString() };
    // 캐시 즉시 반영(낙관적) — 재조회 없이도 추세에 바로 보이게
    if (mid) { cache.gaitReports[mid] = [...(cache.gaitReports[mid] || []), r]; aiStore._gaitLoaded.add(mid); }
    try {
      await fbSet('gait_reports', r.id, { ...r, __mid: mid });
      await mirrorUnifiedReport(mid, r, undefined);
      return r;
    } catch (e) {
      if (mid) cache.gaitReports[mid] = (cache.gaitReports[mid] || []).filter(x => x.id !== r.id);
      throw e;
    }
  },
  getRomReports: (mid) => (cache.romReports[mid] || []),
  addRomReport: async (report) => {
    const mid = report?.member?.id || report?.memberId || report?.basic_info?.memberId || null;
    const createdAt = new Date();
    const baseBasic = report?.basic_info || {};
    const basic_info = {
      ...baseBasic,
      memberId: baseBasic.memberId || mid || '',
      trainerId: baseBasic.trainerId || report?.trainerId || '',
      createdAt: baseBasic.createdAt || createdAt,
      linkedPostureReportId: baseBasic.linkedPostureReportId || report?.linkedPostureReportId || report?.posture_context?.sourceReportId || '',
    };
    const { basic_info: _basicInfo, linkedPostureReportId: _linkedPostureReportId, ...rest } = report || {};
    const r = { ...rest, id: uid('rom'), createdAt: createdAt.toISOString(), basic_info };
    if (mid) { cache.romReports[mid] = [...(cache.romReports[mid] || []), r]; aiStore._romLoaded.add(mid); }
    try {
      await fbSet('rom_reports', r.id, { ...r, __mid: mid });
      await mirrorUnifiedReport(mid, r, 'rom');
      return r;
    } catch (e) {
      if (mid) cache.romReports[mid] = (cache.romReports[mid] || []).filter(x => x.id !== r.id);
      throw e;
    }
  },
  ensurePostureReports: async (mid) => {
    if (!mid || aiStore._postureLoaded.has(mid)) return cache.postureReports[mid] || [];
    try {
      const snap = await countedGetDocs(`posture_reports(mid:${mid})`, query(collection(db, 'posture_reports'), where('__mid', '==', mid)));
      cache.postureReports[mid] = snap.docs.map(d => { const { __mid, ...rest } = d.data(); return rest; });
      aiStore._postureLoaded.add(mid);
    } catch (e) {
      console.warn('[aiStore.ensurePostureReports] 로딩 실패:', e?.code || e?.message);
      cache.postureReports[mid] = cache.postureReports[mid] || [];
    }
    return cache.postureReports[mid];
  },
  getPostureReports: (mid) => (cache.postureReports[mid] || []),
  addPostureReport: async (report) => {
    const mid = report?.member?.id || report?.memberId || null;
    const r = { ...report, id: uid('posture'), createdAt: new Date().toISOString() };
    if (mid) { cache.postureReports[mid] = [...(cache.postureReports[mid] || []), r]; aiStore._postureLoaded.add(mid); }
    try {
      await fbSet('posture_reports', r.id, { ...r, __mid: mid });
      await mirrorUnifiedReport(mid, r, 'posture');
      return r;
    } catch (e) {
      if (mid) cache.postureReports[mid] = (cache.postureReports[mid] || []).filter(x => x.id !== r.id);
      throw e;
    }
  },
  // 저장된 자세 리포트 일부 필드 보정용(예: 계산식 수정 후 과거 값 재계산).
  // updatePayment/updateNotice와 동일한 낙관적 갱신 + 실패 시 롤백 패턴.
  updatePostureReport: async (mid, rid, patch) => {
    const prev = cache.postureReports[mid];
    cache.postureReports[mid] = (cache.postureReports[mid] || []).map(r => r.id === rid ? { ...r, ...patch } : r);
    const u = (cache.postureReports[mid] || []).find(r => r.id === rid);
    try { if (u) await fbSet('posture_reports', rid, { ...u, __mid: mid }); return u; }
    catch (e) { cache.postureReports[mid] = prev; throw e; }
  },
};
