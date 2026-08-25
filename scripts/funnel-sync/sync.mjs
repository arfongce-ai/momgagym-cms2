// scripts/funnel-sync/sync.mjs
// ─────────────────────────────────────────────────────────────
// 8-3. AI 측정 상담 퍼널 전환율 자동화 (세컨드브레인_CMS연동_수익구조_전략.md 8-3,
// CMS전담대화_인계자료.md 참고).
//
// 지금까지 "상담 예약 신청 관리" Notion DB의 리드가 실제로 CMS(members)에
// 등록됐는지, 채널(신청경로)별 전환율이 얼마인지를 사람이 매주 손으로 대조해
// 콘텐츠 캘린더에 옮기고 있었습니다. 이 스크립트가 그 대조·집계를 대신합니다.
//
// 동작:
//   1) Firestore members 컬렉션에서 전화번호만 읽어옵니다(다른 회원 정보는 안 읽음).
//   2) "상담 예약 신청 관리" DB의 리드를 전부 조회해 연락처를 그 목록과 대조합니다.
//   3) 매칭 결과를 리드 각각의 "CMS등록여부" 체크박스에 반영합니다(값이 바뀐
//      경우만 API 호출 — 담당자가 수동으로 관리하는 "등록전환여부"는 절대 건드리지 않음).
//   4) 신청경로(채널)별로 전체 신청수·CMS등록수·전환율을 계산해 "채널별 전환율
//      (자동집계)" DB에 오늘 날짜로 새 행을 추가합니다.
//
// ⚠️ Firestore에는 읽기만 합니다(members 원본 데이터는 절대 쓰거나 수정하지 않음).
// ⚠️ 리드 개인정보(이름·연락처)는 이미 Notion에 있던 값을 그대로 쓸 뿐, 이
//    스크립트가 새로 CMS 쪽으로 내보내는 개인정보는 없습니다(반대 방향: CMS→
//    "등록 여부"라는 boolean 하나만 Notion으로 흘러갑니다).
// ─────────────────────────────────────────────────────────────

import admin from 'firebase-admin';
import { Client } from '@notionhq/client';

// 하드코딩: DB ID는 자격증명이 아니라 식별자라 GitHub Secrets로 관리할 필요가
// 없습니다(같은 이유로 scripts/notion-sync/sync.mjs는 NOTION_DATABASE_ID를
// Secret으로 뒀지만, 여기선 두 DB ID 모두 이 파일에 직접 적어 관리 부담을 줄입니다).
const LEADS_DATABASE_ID = '30de7a74-331f-4b65-9e98-af5ceda9816a'; // 상담 예약 신청 관리
const CONVERSION_DATABASE_ID = '90b5213d-9876-44dc-a675-760c4eeb2b63'; // 채널별 전환율 (자동집계)

const { FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !NOTION_TOKEN) {
  console.error('❌ 환경변수가 비어 있습니다. GitHub Secrets(FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN)가 등록됐는지 확인하세요.');
  process.exit(1);
}

// "010-1234-5678"과 "01012345678"처럼 표기가 달라도 같은 번호로 인식하도록
// 숫자만 남긴다.
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '');
}

async function fetchAllLeads(notion) {
  const leads = [];
  let cursor;
  for (;;) {
    const res = await notion.databases.query({
      database_id: LEADS_DATABASE_ID,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    leads.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return leads;
}

async function main() {
  // ---- 1. Firebase Admin 초기화, members 전화번호만 로드 ----
  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const membersSnap = await db.collection('members').select('phone').get();
  const registeredPhones = new Set();
  membersSnap.forEach((doc) => {
    const p = normalizePhone(doc.data().phone);
    if (p) registeredPhones.add(p);
  });
  console.log(`CMS 등록 회원 전화번호 ${registeredPhones.size}건 로드`);

  // ---- 2. Notion 리드 전부 조회 ----
  const notion = new Client({ auth: NOTION_TOKEN });
  const leads = await fetchAllLeads(notion);
  console.log(`상담 예약 신청 리드 ${leads.length}건 조회`);

  if (leads.length === 0) {
    console.log('리드가 아직 없습니다 — 집계할 것이 없어 여기서 종료합니다.');
    return;
  }

  // ---- 3. 리드별 CMS등록여부 판정 + 채널별 집계 ----
  const byChannel = {}; // { 채널명: { total, matched } }
  let updated = 0;
  let noChannelCount = 0;

  for (const page of leads) {
    const props = page.properties;
    const phone = normalizePhone(props['연락처']?.phone_number);
    const channel = props['신청경로']?.select?.name || null;
    const currentFlag = props['CMS등록여부']?.checkbox || false;
    const matched = phone ? registeredPhones.has(phone) : false;

    if (channel) {
      byChannel[channel] = byChannel[channel] || { total: 0, matched: 0 };
      byChannel[channel].total += 1;
      if (matched) byChannel[channel].matched += 1;
    } else {
      noChannelCount += 1; // 신청경로 미기재 — 전환율 DB의 select 옵션에 없는 값이라 집계에서 제외
    }

    // 실제로 값이 바뀔 때만 Notion에 쓴다(불필요한 API 호출·수정이력 방지).
    if (matched !== currentFlag) {
      await notion.pages.update({
        page_id: page.id,
        properties: { 'CMS등록여부': { checkbox: matched } },
      });
      updated += 1;
    }
  }
  console.log(`CMS등록여부 갱신: ${updated}건 (변경분만)`);
  if (noChannelCount > 0) {
    console.warn(`⚠️ 신청경로 미기재 리드 ${noChannelCount}건은 채널별 집계에서 제외됨`);
  }

  // ---- 4. 채널별 전환율을 "채널별 전환율 (자동집계)" DB에 새 행으로 적재 ----
  const todayYMD = new Date().toISOString().slice(0, 10);
  for (const [channel, { total, matched }] of Object.entries(byChannel)) {
    const rate = total > 0 ? matched / total : 0;
    await notion.pages.create({
      parent: { database_id: CONVERSION_DATABASE_ID },
      properties: {
        '집계일': { title: [{ text: { content: todayYMD } }] },
        '채널': { select: { name: channel } },
        '전체신청수': { number: total },
        'CMS등록수': { number: matched },
        '전환율': { number: rate },
      },
    });
  }
  console.log('✅ 채널별 전환율 저장 완료:', byChannel);
}

main().catch((err) => {
  console.error('❌ 실행 중 오류 발생:', err);
  process.exit(1);
});
