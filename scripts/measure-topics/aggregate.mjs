// scripts/measure-topics/aggregate.mjs
// ─────────────────────────────────────────────────────────────
// 센터 회원 측정 기록 → 익명 집계 → Notion 콘텐츠 캘린더에 "주제후보" 행(검수 상태 '아이디어').
//  - 기본은 시험 실행(dry-run): Firestore 읽기 + 로그만, Notion에는 아무것도 쓰지 않는다.
//  - Notion 쓰기는 --write(또는 WRITE=1)를 줄 때만.
//  - 같은 제목의 후보가 이미 있으면 새로 만들지 않는다.
//  - '승인' 상태를 절대 만들지 않는다 — 사람이 Notion에서 직접 바꿔야 글·쇼츠로 이어진다.
//  - 내부용이라 인원 수·비율은 정확히 낸다(최소 인원 기본 1명, MIN_MEMBERS 로 조절).
//  - 로그와 Notion에는 회원 id·이름·개별 수치를 찍지 않는다(회원 수, 문서 수, 집계 결과만).
// 환경변수: FIREBASE_SERVICE_ACCOUNT, (쓰기 시) NOTION_CONTENT_CALENDAR_TOKEN, NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID
// ─────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import { aggregateTopics, topicTitle, MIN_MEMBERS as DEFAULT_MIN } from './core.mjs';

const MIN_MEMBERS = Number(process.env.MIN_MEMBERS) >= 1 ? Number(process.env.MIN_MEMBERS) : DEFAULT_MIN;

const WRITE = process.argv.includes('--write') || process.env.WRITE === '1';
const { FIREBASE_SERVICE_ACCOUNT, NOTION_CONTENT_CALENDAR_TOKEN, NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID } = process.env;
const NOTION_VERSION = '2026-03-11';

if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT 가 비어 있습니다.');
  process.exit(1);
}
if (WRITE && (!NOTION_CONTENT_CALENDAR_TOKEN || !NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID)) {
  console.error('❌ 쓰기 모드에는 NOTION_CONTENT_CALENDAR_TOKEN, NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID 가 필요합니다.');
  process.exit(1);
}

async function notion(route, body) {
  const res = await fetch(`https://api.notion.com${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NOTION_CONTENT_CALENDAR_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${route} ${res.status}`);
  return res.json();
}

async function titleExists(title) {
  const r = await notion(`/v1/data_sources/${NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID}/query`, {
    filter: { property: '콘텐츠 제목', title: { equals: title } },
    page_size: 1,
  });
  return (r.results || []).length > 0;
}

async function main() {
  console.log(`모드: ${WRITE ? '쓰기(--write)' : '시험 실행(Notion에 쓰지 않음)'}  · 최소 인원 ${MIN_MEMBERS}명`);
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  let reads = 0;
  const membersSnap = await db.collection('members').select('isActive').get();
  reads += membersSnap.size;
  const activeIds = new Set(membersSnap.docs.filter((d) => d.data().isActive !== false).map((d) => d.id));
  console.log(`회원 ${membersSnap.size}명(활성 ${activeIds.size}명)`);

  // 회원별 문서 모으기: ai(세션) + 전용 컬렉션. 회원 id 는 메모리에서만 쓴다.
  const byMember = new Map();
  const counts = {};
  for (const col of ['ai', 'gait_reports', 'posture_reports', 'rom_reports']) {
    const snap = await db.collection(col).get();
    reads += snap.size;
    counts[col] = snap.size;
    snap.forEach((doc) => {
      const data = doc.data();
      const mid = data.__mid;
      if (!mid || !activeIds.has(mid)) return;
      if (!byMember.has(mid)) byMember.set(mid, []);
      byMember.get(mid).push(data);
    });
  }
  console.log(`읽은 문서 수: ${reads}건 (members+ai+gait+posture+rom). ai ${counts.ai} / gait ${counts.gait_reports} / posture ${counts.posture_reports} / rom ${counts.rom_reports}`);
  console.log(`측정 기록이 있는 활성 회원: ${byMember.size}명`);

  const { candidates, skipped } = aggregateTopics(byMember, MIN_MEMBERS);
  console.log(`후보 ${candidates.length}개 (최소 인원 미달로 제외 ${skipped.belowMinMembers}건, 범위 밖 0명이라 제외 ${skipped.noneOutOfRange}건)`);
  // 점검용: 범위 설정이 실제 측정값과 맞는지 보려고 권장 범위와 중앙값(개별 값 아님)을 같이 찍는다.
  // ⚠️ 저장소가 public 이라 Actions 로그도 공개된다 — 개별 값·회원 정보는 찍지 않는다.
  for (const c of candidates) console.log(`- ${topicTitle(c)} (n=${c.members}) · 권장범위 ${c.goodRange?.join('~')} · 중앙값 ${c.median}`);

  if (!WRITE) {
    console.log('ℹ️ 시험 실행이라 Notion에는 아무것도 쓰지 않았습니다. 쓰려면 write 옵션으로 다시 실행하세요.');
    return;
  }
  let created = 0;
  let existed = 0;
  for (const c of candidates) {
    const title = topicTitle(c);
    if (await titleExists(title)) { existed += 1; continue; }
    await notion('/v1/pages', {
      parent: { type: 'data_source_id', data_source_id: NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID },
      properties: {
        '콘텐츠 제목': { title: [{ text: { content: title } }] },
        '검수 상태': { select: { name: '아이디어' } },
        '제작 상태': { select: { name: '아이디어' } },
      },
    });
    created += 1;
  }
  console.log(`✅ Notion 새 후보 ${created}개 생성, 이미 있어서 건너뜀 ${existed}개`);
}

main().catch((err) => {
  console.error('❌ 실행 중 오류:', err?.message || err);
  process.exit(1);
});
