// scripts/dashboard-snapshot/sync.mjs
// ─────────────────────────────────────────────────────────────
// 9장 "준실시간 그래프뷰 대시보드" (세컨드브레인_CMS연동_수익구조_전략.md 9장,
// CMS전담대화_인계자료.md 9-6 실제 구현 순서 1~2번).
//
// 30분마다 실행되어 "오늘" 기준 스냅샷 한 장을 Firestore `dashboardSnapshots`
// 컬렉션에 새 문서로 추가합니다. 앱(src/pages/Dashboard.jsx)이 이 컬렉션을
// 시간순으로 읽어 그래프를 그립니다 — 완전 실시간 리스너가 아니라 이 배치가
// 쌓아놓은 스냅샷을 주기적으로 다시 읽는 방식(준실시간)입니다.
//
// ⚠️ Firestore members/payments/trainers/settings/측정 리포트 컬렉션에는
//    읽기만 합니다.
// ⚠️ dashboardSnapshots에 쓰는 숫자는 전부 집계값입니다 — 회원 개인을 특정할
//    수 있는 정보는 전혀 담지 않습니다(트레이너 이름만 포함, 회원 이름/연락처 없음).
// ⚠️ 비용 관리: 30분마다 도는 배치라 8장(scripts/trainer-stats)처럼 무겁게
//    풀 스캔하지 않습니다. 측정 리포트 건수는 트레이너별로 쪼개지 않고
//    전체 합계만 count() 집계 쿼리로 구합니다(문서를 실제로 읽지 않고 개수만
//    세는 방식이라 요금이 훨씬 쌈) — 트레이너별 리포트 건수 비교가 필요하면
//    scripts/trainer-stats(주 1회)의 Notion 표를 참고하세요.
// ⚠️ TTL: 이 문서들의 expireAt 필드에 Firestore TTL 정책을 걸어두면(최초 1회
//    수동 설정, Firebase 콘솔 → Firestore Database → TTL) 90일 지난 스냅샷이
//    자동으로 정리됩니다. 이 스크립트는 그 필드를 채워두기만 합니다 — TTL
//    정책 자체는 콘솔에서 한 번 켜야 합니다(코드로는 켤 수 없음).
// ─────────────────────────────────────────────────────────────

import admin from 'firebase-admin';

const RETENTION_DAYS = 90;

const { FIREBASE_SERVICE_ACCOUNT } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ 환경변수가 비어 있습니다. GitHub Secrets(FIREBASE_SERVICE_ACCOUNT)가 등록됐는지 확인하세요.');
  process.exit(1);
}

// ── finance.js calcNet 스냅샷 (notion-sync/trainer-stats와 동일 — 세 파일이
//    전부 같은 계산식을 복사해 쓰고 있으니, finance.js가 바뀌면 셋 다 같이 고칠 것) ──
const CARD_METHODS = ['card', 'card1', 'card2'];
const VAT_ONLY_METHODS = ['pay', 'cash_receipt'];

function deductFor(method, amount, settings) {
  const isCard = CARD_METHODS.includes(method);
  const isVatOnly = VAT_ONLY_METHODS.includes(method);
  const cardFee = isCard ? amount * (settings.cardFeeRate / 100) : 0;
  const vat = (isCard || isVatOnly) ? amount * (settings.vatRate / 100) : 0;
  return { cardFee, vat };
}

function calcNet(payment, settings) {
  const methods = Array.isArray(payment.methods) && payment.methods.length ? payment.methods : null;
  if (methods) {
    const amount = methods.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    let cardFee = 0, vat = 0;
    methods.forEach((x) => {
      const d = deductFor(x.method, Number(x.amount) || 0, settings);
      cardFee += d.cardFee; vat += d.vat;
    });
    return { amount, cardFee, vat, net: amount - cardFee - vat };
  }
  const amount = payment.amount || 0;
  const d = deductFor(payment.method, amount, settings);
  return { amount, cardFee: d.cardFee, vat: d.vat, net: amount - d.cardFee - d.vat };
}

// scripts/trainer-stats/sync.mjs의 attributeParts()와 동일(결제 → 트레이너별 귀속분).
function attributeParts(payment, member, net) {
  const ts = member?.trainerSessions || {};
  const tids = Object.keys(ts);
  const totalReg = Object.values(ts).reduce((s, v) => s + (v.total || 0), 0);
  const parts = [];
  const splitList = Array.isArray(payment.split) && payment.split.length ? payment.split : null;
  const pTids = (payment.trainerIds && payment.trainerIds.length) ? payment.trainerIds : null;
  if (splitList) {
    const gross = splitList.reduce((s, x) => s + (Number(x.amount) || 0), 0) || (payment.amount || 0) || 1;
    splitList.forEach(({ trainerId, amount }) => parts.push([trainerId, net * ((Number(amount) || 0) / gross)]));
  } else if (pTids) {
    const per = net / pTids.length;
    pTids.forEach((tid) => parts.push([tid, per]));
  } else if (totalReg > 0) {
    tids.forEach((tid) => parts.push([tid, net * ((ts[tid].total || 0) / totalReg)]));
  } else if (tids.length) {
    const per = net / tids.length;
    tids.forEach((tid) => parts.push([tid, per]));
  }
  return parts;
}

async function main() {
  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  // KST(UTC+9) 기준 "오늘" 날짜 — voice-command.js의 todayKST 계산과 동일 방식.
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayYMD = nowKST.toISOString().slice(0, 10);
  const todayStartISO = new Date(`${todayYMD}T00:00:00+09:00`).toISOString();
  const todayEndISO = new Date(`${todayYMD}T23:59:59.999+09:00`).toISOString();
  console.log(`스냅샷 기준일(KST): ${todayYMD}`);

  const [trainersSnap, membersSnap, settingsDoc] = await Promise.all([
    db.collection('trainers').get(),
    db.collection('members').select('isActive', 'trainerSessions', 'joinDate').get(),
    db.collection('settings').doc('config').get(),
  ]);
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  const trainers = trainersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const memberById = new Map(members.map((m) => [m.id, m]));

  // ---- 활성 회원 수(전체 + 트레이너별) ----
  let activeMembers = 0;
  const activeByTrainer = {};
  members.forEach((m) => {
    if (m.isActive) {
      activeMembers += 1;
      Object.keys(m.trainerSessions || {}).forEach((tid) => {
        activeByTrainer[tid] = (activeByTrainer[tid] || 0) + 1;
      });
    }
  });

  // ---- 오늘 신규 회원 수 ----
  const newMembersToday = members.filter((m) => m.joinDate === todayYMD).length;

  // ---- 오늘 매출(전체 + 트레이너별 귀속) ----
  const paymentsSnap = await db
    .collection('payments')
    .where('paidAt', '==', todayYMD)
    .get();
  let revenueToday = 0;
  const revenueByTrainer = {};
  paymentsSnap.forEach((doc) => {
    const p = doc.data();
    if (p.isUnpaid || p.isRefunded || p.isMonthly) return;
    const { net } = calcNet(p, settings);
    revenueToday += net;
    const member = memberById.get(p.__mid);
    attributeParts(p, member, net).forEach(([tid, part]) => {
      revenueByTrainer[tid] = (revenueByTrainer[tid] || 0) + part;
    });
  });

  // ---- 오늘 측정 리포트 건수(전체 합계만 — count() 집계로 저렴하게) ----
  const reportCollections = ['ai', 'gait_reports', 'posture_reports', 'rom_reports'];
  let reportsToday = 0;
  for (const col of reportCollections) {
    const agg = await db
      .collection(col)
      .where('createdAt', '>=', todayStartISO)
      .where('createdAt', '<=', todayEndISO)
      .count()
      .get();
    reportsToday += agg.data().count;
  }

  // ---- byTrainer 요약(활성 회원·오늘 매출만 — 리포트 건수는 비용상 주간 배치로 대체) ----
  const byTrainer = {};
  trainers.forEach((t) => {
    byTrainer[t.id] = {
      name: t.name || t.id,
      activeMembers: activeByTrainer[t.id] || 0,
      revenueToday: Math.round(revenueByTrainer[t.id] || 0),
    };
  });

  const snapshot = {
    timestamp: new Date().toISOString(),
    expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    newMembersToday,
    activeMembers,
    revenueToday: Math.round(revenueToday),
    reportsToday,
    byTrainer,
  };
  console.log('스냅샷:', snapshot);

  await db.collection('dashboardSnapshots').add(snapshot);
  console.log('✅ dashboardSnapshots에 저장 완료!');
}

main().catch((err) => {
  console.error('❌ 실행 중 오류 발생:', err);
  process.exit(1);
});
