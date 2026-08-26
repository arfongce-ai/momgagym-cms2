// scripts/trainer-stats/sync.mjs
// ─────────────────────────────────────────────────────────────
// 8장 "트레이너별 실적" (세컨드브레인_CMS연동_수익구조_전략.md 8-1,
// 2026-08-25_CMS필드명검증_완료.md의 정정된 필드명 반영).
//
// 매주 지난 7일간 트레이너별로 신규 회원 수·활성 회원 수·매출 기여도·측정
// 리포트 작성 건수를 집계해 Notion "트레이너별 실적 (자동집계)" DB에 새 행으로
// 쌓습니다. 기존 notion-sync/sync.mjs(전체 요약)와 funnel-sync/sync.mjs(8-3)
// 옆에 나란히 놓이는 세 번째 배치 스크립트입니다.
//
// ⚠️ Firestore에는 읽기만 합니다(members/payments/trainers/settings 원본
//    데이터는 절대 쓰거나 수정하지 않습니다. ai/gait_reports/posture_reports/
//    rom_reports도 건수만 셀 뿐 내용은 읽지 않습니다).
// ⚠️ Notion에는 트레이너 이름 + 집계 숫자만 올라갑니다 — 회원 개인을 특정할
//    수 있는 정보(이름·연락처 등)는 절대 보내지 않습니다(데이터 흐름 원칙 준수).
//
// 매출 기여도 계산은 assignedTrainer 같은 단일 필드가 아니라, 실제 스키마
// (members.trainerSessions, payments.trainerIds/split)를 기준으로 finance.js
// computeMonthRates()의 결제 분배 로직을 그대로 옮겨왔습니다(정산 화면과 같은
// 숫자가 나오게 하기 위함 — 이 파일의 로직이 원본과 달라지면 두 곳의 숫자가
// 어긋나므로, finance.js의 분배 방식이 바뀌면 여기도 같이 고쳐야 합니다).
// ─────────────────────────────────────────────────────────────

import admin from 'firebase-admin';
import { Client } from '@notionhq/client';

const TRAINER_STATS_DATABASE_ID = '6862d1d6-3e21-41ca-8f74-6db9c79e840c'; // 트레이너별 실적 (자동집계)
const MEMBER_ID_CHUNK_SIZE = 10; // Firestore 'in' 쿼리 제한을 넉넉히 피하기 위한 청크 크기

const { FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !NOTION_TOKEN) {
  console.error('❌ 환경변수가 비어 있습니다. GitHub Secrets(FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN)가 등록됐는지 확인하세요.');
  process.exit(1);
}

// ── finance.js calcNet 스냅샷 (notion-sync/sync.mjs와 동일한 이유로 복사본 사용) ──
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

// ── finance.js computeMonthRates()의 "결제 → 트레이너별 귀속분(parts)" 로직 스냅샷.
//    비율판정(40/50/60%) 부분은 이 요약에 필요 없어 가져오지 않았고, 순수
//    귀속 로직만 옮겼습니다. 우선순위: p.split(명시적 분배) → p.trainerIds
//    (균등분배) → member.trainerSessions(등록 회차 비율) → trainerSessions
//    키 균등분배.
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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  // ---- 1. Firebase Admin 초기화 ----
  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  // ---- 2. 집계 기간: 최근 7일 (notion-sync/sync.mjs와 동일 방식) ----
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toYMD = (d) => d.toISOString().slice(0, 10);
  const startYMD = toYMD(weekAgo);
  const endYMD = toYMD(now);
  const startISO = weekAgo.toISOString();
  const endISO = now.toISOString();
  console.log(`집계 기간: ${startYMD} ~ ${endYMD}`);

  // ---- 3. 트레이너·회원·결제설정 로드 ----
  const [trainersSnap, membersSnap, settingsDoc] = await Promise.all([
    db.collection('trainers').get(),
    db.collection('members').get(),
    db.collection('settings').doc('config').get(),
  ]);
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  const trainers = trainersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const memberById = new Map(members.map((m) => [m.id, m]));
  console.log(`트레이너 ${trainers.length}명, 회원 ${members.length}명 로드`);

  // ---- 4. 트레이너별 신규/활성 회원 집계 (trainerSessions 키 기준, assignedTrainer 없음) ----
  const newMembersByTrainer = {};   // tid -> count
  const activeMembersByTrainer = {}; // tid -> count
  const memberIdsByTrainer = {};    // tid -> [memberId, ...] (측정 리포트 건수 집계용, 담당 이력 전체 기준)
  members.forEach((m) => {
    const tids = Object.keys(m.trainerSessions || {});
    tids.forEach((tid) => {
      (memberIdsByTrainer[tid] = memberIdsByTrainer[tid] || []).push(m.id);
      if (m.joinDate >= startYMD && m.joinDate <= endYMD) {
        newMembersByTrainer[tid] = (newMembersByTrainer[tid] || 0) + 1;
      }
      if (m.isActive) {
        activeMembersByTrainer[tid] = (activeMembersByTrainer[tid] || 0) + 1;
      }
    });
  });

  // ---- 5. 매출 기여도 (payments, 결제일 paidAt 기준, finance.js 분배 로직 재사용) ----
  const revenueByTrainer = {}; // tid -> net 합계
  const paymentsSnap = await db
    .collection('payments')
    .where('paidAt', '>=', startYMD)
    .where('paidAt', '<=', endYMD)
    .get();
  paymentsSnap.forEach((doc) => {
    const p = doc.data();
    if (p.isUnpaid || p.isRefunded || p.isMonthly) return; // 정산 화면과 동일 제외 기준
    const member = memberById.get(p.__mid);
    const { net } = calcNet(p, settings);
    const parts = attributeParts(p, member, net);
    parts.forEach(([tid, part]) => {
      revenueByTrainer[tid] = (revenueByTrainer[tid] || 0) + part;
    });
  });

  // ---- 6. 측정 리포트 건수 (4개 컬렉션 합산, __mid로 담당 회원과 매칭, recordedAtFull 기준) ----
  // ⚠️ 2026-08-26 수정: 원래 여기서 'createdAt' 필드로 걸러냈는데, Firebase 콘솔에서
  //    ai 컬렉션 문서를 직접 열어 확인해보니 실제로는 createdAt 필드가 존재하지
  //    않습니다(측정 시각은 recordedAtFull에 ISO 문자열로 들어있음). 필드명이
  //    안 맞아서 이 쿼리는 색인이 걸려도 계속 0건만 반환하고 있었습니다 —
  //    아래처럼 recordedAtFull로 바꿔야 실제 건수가 집계됩니다.
  const reportCollections = ['ai', 'gait_reports', 'posture_reports', 'rom_reports'];
  const reportsByTrainer = {};
  for (const trainer of trainers) {
    const memberIds = memberIdsByTrainer[trainer.id] || [];
    if (memberIds.length === 0) { reportsByTrainer[trainer.id] = 0; continue; }
    let count = 0;
    for (const idChunk of chunk(memberIds, MEMBER_ID_CHUNK_SIZE)) {
      for (const col of reportCollections) {
        const snap = await db
          .collection(col)
          .where('__mid', 'in', idChunk)
          .where('recordedAtFull', '>=', startISO)
          .where('recordedAtFull', '<=', endISO)
          .get();
        count += snap.size;
      }
    }
    reportsByTrainer[trainer.id] = count;
  }

  // ---- 7. Notion "트레이너별 실적 (자동집계)"에 트레이너별 새 행 추가 ----
  const notion = new Client({ auth: NOTION_TOKEN });
  const periodLabel = `${startYMD} ~ ${endYMD}`;
  for (const trainer of trainers) {
    const row = {
      newMembers: newMembersByTrainer[trainer.id] || 0,
      activeMembers: activeMembersByTrainer[trainer.id] || 0,
      revenue: Math.round(revenueByTrainer[trainer.id] || 0),
      reports: reportsByTrainer[trainer.id] || 0,
    };
    console.log(`- ${trainer.name}:`, row);
    await notion.pages.create({
      parent: { database_id: TRAINER_STATS_DATABASE_ID },
      properties: {
        '기간': { title: [{ text: { content: periodLabel } }] },
        '트레이너': { rich_text: [{ text: { content: trainer.name || trainer.id } }] },
        '신규회원수': { number: row.newMembers },
        '활성회원수': { number: row.activeMembers },
        '매출기여도': { number: row.revenue },
        '측정리포트건수': { number: row.reports },
      },
    });
  }

  console.log('✅ 트레이너별 실적 저장 완료!');
}

main().catch((err) => {
  console.error('❌ 실행 중 오류 발생:', err);
  process.exit(1);
});
