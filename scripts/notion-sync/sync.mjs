// scripts/notion-sync/sync.mjs
// ─────────────────────────────────────────────────────────────
// 매주 실행되어 momgagym-cms(Firestore)에서 지난 7일간의
// 회원·매출·측정 리포트 요약만 읽어와 Notion 데이터베이스에
// 새 행으로 저장합니다.
//
// ⚠️ 이 스크립트는 Firestore에서 "읽기"만 합니다. members/payments
//    등 원본 데이터는 절대 쓰거나 수정하지 않습니다.
// ⚠️ 회원 개인을 특정할 수 있는 정보(이름, 전화번호 등)는 Notion으로
//    보내지 않습니다 — 합계 숫자만 전송합니다. (세컨드 브레인 전략
//    문서의 "데이터 흐름 원칙"과 동일합니다.)
// ─────────────────────────────────────────────────────────────

import admin from 'firebase-admin';
import { Client } from '@notionhq/client';

// ─────────────────────────────────────────────────────────────
// 아래 calcNet 로직은 src/services/finance.js 의 함수를 그대로 복사한
// 것입니다 (2026-08-18 기준 스냅샷). 원래는 그 파일을 직접 import해서
// 쓰려 했지만, Vite 코드는 확장자 없이 파일을 불러와도(import '../utils/dates')
// 알아서 찾아주는 반면, 순수 Node.js(이 스크립트가 돌아가는 환경)는 그걸
// 못 찾아서 에러가 났습니다. CMS 쪽 코드를 고치는 대신, 이 스크립트 안에
// 계산 공식만 그대로 옮겨왔습니다.
// ⚠️ finance.js의 calcNet 계산 방식이 나중에 바뀌면, 여기도 같이 고쳐야
//    두 곳의 매출 숫자가 계속 일치합니다.
const CARD_METHODS = ['card', 'card1', 'card2'];       // 부가세+카드수수료
const VAT_ONLY_METHODS = ['pay', 'cash_receipt'];        // 부가세만

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
// ─────────────────────────────────────────────────────────────

// ---- 1. 환경변수(GitHub Secrets) 확인 ----
const { FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('❌ 환경변수가 비어 있습니다. GitHub Secrets 3개(FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN, NOTION_DATABASE_ID)가 모두 등록됐는지 확인하세요.');
  process.exit(1);
}

async function main() {
  // ---- 2. Firebase Admin 초기화 ----
  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  // ---- 3. 집계 기간: 최근 7일 ----
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toYMD = (d) => d.toISOString().slice(0, 10);
  const startYMD = toYMD(weekAgo);
  const endYMD = toYMD(now);
  const startISO = weekAgo.toISOString();
  const endISO = now.toISOString();

  console.log(`집계 기간: ${startYMD} ~ ${endYMD}`);

  // ---- 4. 회원 통계 ----
  // 4-1. 활성 회원 수 (전체, 기간과 무관)
  const activeSnap = await db.collection('members').where('isActive', '==', true).get();
  const totalActive = activeSnap.size;

  // 4-2. 이번 주 신규 회원 수 (joinDate 기준)
  const newMembersSnap = await db
    .collection('members')
    .where('joinDate', '>=', startYMD)
    .where('joinDate', '<=', endYMD)
    .get();
  const newThisWeek = newMembersSnap.size;

  // ---- 5. 매출 통계 (payments 컬렉션, 결제일 기준) ----
  // settings/config 문서에 카드수수료율(cardFeeRate)·부가세율(vatRate)이 있습니다.
  // calcNet이 이 값을 참조해서 결제수단별로 공제한 "입금액"을 계산합니다.
  const settingsDoc = await db.collection('settings').doc('config').get();
  const settings = settingsDoc.exists ? settingsDoc.data() : {};

  const paymentsSnap = await db
    .collection('payments')
    .where('paidAt', '>=', startYMD)
    .where('paidAt', '<=', endYMD)
    .get();

  let weeklyRevenue = 0; // = 입금액 합계 (결제금액 - 카드수수료 - 부가세), 미수금 제외
  paymentsSnap.forEach((doc) => {
    const p = doc.data();
    if (p.isUnpaid) return; // 미수금은 매출 합계에서 제외
    weeklyRevenue += calcNet(p, settings).net;
  });

  // ---- 6. 측정 리포트 건수 (4개 컬렉션 합산) ----
  // 참고: '위험/주의 판정 건수'는 리포트 종류마다 데이터 구조가 달라
  //       아직 포함하지 않았습니다. 다음 버전에서 추가할 수 있습니다.
  const reportCollections = ['gait_reports', 'posture_reports', 'rom_reports', 'ai'];
  let reportCount = 0;
  for (const col of reportCollections) {
    const snap = await db
      .collection(col)
      .where('createdAt', '>=', startISO)
      .where('createdAt', '<=', endISO)
      .get();
    reportCount += snap.size;
  }

  const summary = { startYMD, endYMD, totalActive, newThisWeek, weeklyRevenue, reportCount };
  console.log('집계 결과:', summary);

  // ---- 7. Notion에 새 행 추가 ----
  const notion = new Client({ auth: NOTION_TOKEN });
  await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      '기간': { title: [{ text: { content: `${startYMD} ~ ${endYMD}` } }] },
      '신규 회원수': { number: newThisWeek },
      '활성 회원수': { number: totalActive },
      '주간 매출': { number: weeklyRevenue },
      '측정 리포트 건수': { number: reportCount },
    },
  });

  console.log('✅ Notion에 저장 완료!');
}

main().catch((err) => {
  console.error('❌ 실행 중 오류 발생:', err);
  process.exit(1);
});
