// scripts/member-detail/sync.mjs
// ─────────────────────────────────────────────────────────────
// 8-2 "개별 회원 상세" (세컨드브레인_CMS연동_수익구조_전략.md 8-2,
// 개별회원상세_법률자문_질문지.md — 대표님 판단으로 법률 자문 없이 진행하기로
// 결정, 단 8-2에 정리된 안전장치는 그대로 지킴).
//
// 매주 지난 7일간의 측정 리포트(ai/gait_reports/posture_reports/rom_reports)를
// "코칭 이력"으로 보고, 회원 1명당 방문(측정) 1건 = 1행으로 Notion
// "회원별 측정 이력 (자동집계)" DB에 쌓습니다. 트레이너별 실적(8장)·세그먼트별
// 통계(8-1) 옆에 나란히 놓이는 배치입니다.
//
// ⚠️ 8-2 안전장치 4가지를 그대로 적용합니다:
//   1) 실명 대신 가명 회원코드만 사용 (member.id 뒷 6자리 기반 "M-XXXXXX")
//   2) 연락처·주소·결제수단은 아예 읽지 않음(members.select로 필요한 필드만)
//   3) 부상 부위·병력 같은 자유서술 텍스트는 올리지 않음 — 세그먼트 태그로만 요약
//   4) Notion에는 담당트레이너 "이름"만 나가고(연락처 없음), 전체 트레이너에게
//      공유하되 각자 "담당트레이너" 컬럼으로 필터링해서 보는 방식(대표님 결정)
// ⚠️ Firestore에는 읽기만 합니다.
// ─────────────────────────────────────────────────────────────

import admin from 'firebase-admin';
import { Client } from '@notionhq/client';

// ⚠️ 2026-08-26 수정: 처음엔 데이터 소스 ID(280c7da4-...)를 잘못 넣어서
//    notion.pages.create가 "database not found"로 계속 실패했습니다. Notion의
//    데이터베이스/데이터소스 분리 모델 때문에 pages.create의 parent.database_id
//    에는 반드시 데이터베이스(페이지) ID를 써야 합니다 — notion-fetch로 확인한
//    실제 데이터베이스 ID로 교체.
const MEMBER_DETAIL_DATABASE_ID = '56497823-72f8-4600-893e-2bf2f530b129'; // 회원별 측정 이력 (자동집계)
const MEMBER_ID_CHUNK_SIZE = 10;

// segment-stats/sync.mjs와 반드시 같이 맞출 것
const SEGMENT_LABELS = {
  local: '삼산동·달동 지역',
  athlete: '운동선수·학생운동선수',
  rehab: '재활·노인',
};
const UNSET_LABEL = '미지정';

// menuTitle/menu 필드가 없는 컬렉션(ai 이외)을 위한 기본 라벨
const COLLECTION_LABELS = {
  ai: 'AI 측정',
  gait_reports: '보행·러닝',
  posture_reports: '자세·체형',
  rom_reports: 'ROM',
};

const { FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !NOTION_TOKEN) {
  console.error('❌ 환경변수가 비어 있습니다. GitHub Secrets(FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN)가 등록됐는지 확인하세요.');
  process.exit(1);
}

// member.id 뒷 6자리 기반 가명 회원코드. 실명·연락처는 절대 쓰지 않는다.
function pseudonym(memberId) {
  const tail = String(memberId).slice(-6).toUpperCase();
  return `M-${tail}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  // 집계 기간: 최근 7일 (trainer-stats/segment-stats와 동일 방식)
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startISO = weekAgo.toISOString();
  const endISO = now.toISOString();
  console.log(`집계 기간: ${startISO} ~ ${endISO}`);

  // 트레이너 이름 조회용(연락처 등은 읽지 않음)
  const trainersSnap = await db.collection('trainers').get();
  const trainerNameById = new Map(trainersSnap.docs.map((d) => [d.id, d.data().name || d.id]));

  // 회원은 가명코드·담당트레이너·세그먼트 매칭에만 쓰므로 필요한 필드만 읽는다
  // (연락처·주소·결제수단은 select에 넣지 않아 아예 안 읽힘).
  const membersSnap = await db.collection('members').select('trainerSessions', 'targetSegment').get();
  const memberInfoById = new Map(
    membersSnap.docs.map((d) => {
      const data = d.data();
      const tids = Object.keys(data.trainerSessions || {});
      const trainerNames = tids.map((tid) => trainerNameById.get(tid) || tid).join(', ') || '미배정';
      const segment = SEGMENT_LABELS[data.targetSegment] ? SEGMENT_LABELS[data.targetSegment] : UNSET_LABEL;
      return [d.id, { trainerNames, segment }];
    })
  );
  console.log(`회원 ${memberInfoById.size}명 로드`);

  const reportCollections = ['ai', 'gait_reports', 'posture_reports', 'rom_reports'];
  const rows = [];
  for (const col of reportCollections) {
    const snap = await db
      .collection(col)
      .where('recordedAtFull', '>=', startISO)
      .where('recordedAtFull', '<=', endISO)
      .get();
    snap.forEach((doc) => {
      const data = doc.data();
      const mid = data.__mid;
      const info = memberInfoById.get(mid);
      if (!info) return; // 탈퇴 등으로 회원을 못 찾으면 이력에서 제외
      const 측정종류 = data.menuTitle || data.menu || COLLECTION_LABELS[col] || col;
      const 측정일 = data.recordedAt || (data.recordedAtFull ? data.recordedAtFull.slice(0, 10) : startISO.slice(0, 10));
      rows.push({
        회원코드: pseudonym(mid),
        담당트레이너: info.trainerNames,
        세그먼트: info.segment,
        측정종류,
        측정일,
      });
    });
  }
  console.log(`이번 주 측정 이력 ${rows.length}건`);

  const notion = new Client({ auth: NOTION_TOKEN });
  for (const batch of chunk(rows, 1)) {
    // Notion API 레이트리밋을 피하려고 1건씩 순차 처리(다른 배치들과 동일 패턴).
    for (const row of batch) {
      await notion.pages.create({
        parent: { database_id: MEMBER_DETAIL_DATABASE_ID },
        properties: {
          '회원코드': { title: [{ text: { content: row.회원코드 } }] },
          '담당트레이너': { rich_text: [{ text: { content: row.담당트레이너 } }] },
          '세그먼트': { select: { name: row.세그먼트 } },
          '측정종류': { rich_text: [{ text: { content: row.측정종류 } }] },
          '측정일': { date: { start: row.측정일 } },
        },
      });
    }
  }

  console.log('✅ 회원별 측정 이력 저장 완료!');
}

main().catch((err) => {
  console.error('❌ 실행 중 오류 발생:', err);
  process.exit(1);
});
