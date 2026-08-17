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
// 매출(입금액) 계산은 새로 만들지 않고, 실제 앱이 쓰는 계산 함수를 그대로 가져다 씁니다.
// (카드수수료·부가세 공제 로직은 momgagym-cms2/src/services/finance.js 가 원본입니다.
//  이 파일이 나중에 옮겨지거나 함수명이 바뀌면 아래 import 경로도 같이 고쳐야 해요.)
import { calcNet } from '../../src/services/finance.js';

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
