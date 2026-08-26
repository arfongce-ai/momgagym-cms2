// scripts/segment-stats/sync.mjs
// ─────────────────────────────────────────────────────────────
// 8장 "타깃 세그먼트별 통계" (세컨드브레인_CMS연동_수익구조_전략.md 8-1).
//
// 매주 지난 7일간 3대 타깃 세그먼트(삼산동·달동 지역 / 운동선수·학생운동선수 /
// 재활·노인)별로 신규 회원 수·활성 회원 수를 집계해 Notion "세그먼트별 통계
// (자동집계)" DB에 새 행으로 쌓습니다. scripts/trainer-stats/sync.mjs 옆에
// 나란히 놓이는 배치 스크립트입니다.
//
// ⚠️ 이 배치는 회원 문서의 targetSegment 필드(2026-08-25 신규 추가, MemberRegister.jsx/
//    MemberDetail.jsx에서 등록·수정 가능)를 그대로 씁니다. 이 필드는 신규 회원
//    등록 시점부터만 채워지므로, 이 배치를 처음 돌렸을 때 대부분의 기존 회원은
//    "미지정"으로 잡힙니다 — 실제로 세그먼트별 숫자가 의미 있어지려면 트레이너가
//    CMS 회원 상세 화면에서 기존 회원들을 하나씩 태깅해야 합니다(자동 태깅 불가 —
//    종목·연령 등으로 추론하는 규칙 기반 매핑은 예외가 계속 늘어난다는 이유로
//    8-1 설계 단계에서 이미 기각됨).
// ⚠️ "측정 이상감지 비율" (2026-08-26 추가): ai 컬렉션 문서를 Firebase 콘솔에서
//    직접 열어 확인한 결과, "이상/정상"을 직접 나타내는 필드는 없었습니다.
//    대신 member.valid(측정이 유효하게 처리됐는지 여부, boolean)가 있어 —
//    사용자 확인 하에 이걸 "이상감지" 대용 지표로 씁니다: member.valid===false
//    비율을 세그먼트별로 집계. (관절 각도 등 수치 기반의 "진짜" 이상 판정은
//    트레이너가 기준값을 정리해서 알려주면 추후 교체 예정 — 그 전까지 이
//    비율은 "측정 유효성 이상 비율" 정도로 이해할 것.)
// ⚠️ Firestore에는 읽기만 합니다. Notion에는 세그먼트 이름 + 집계 숫자만
//    올라갑니다 — 회원 개인을 특정할 수 있는 정보는 보내지 않습니다.
// ─────────────────────────────────────────────────────────────

import admin from 'firebase-admin';
import { Client } from '@notionhq/client';

const SEGMENT_STATS_DATABASE_ID = '683ee29b-72d4-44da-8125-3e16a6edce03'; // 세그먼트별 통계 (자동집계)

// src/components/members/MemberRegister.jsx의 SEGMENT_OPTIONS와 반드시 같이 맞출 것 —
// value가 여기서 바뀌면 과거에 이미 저장된 회원의 targetSegment 값과 어긋난다.
const SEGMENT_LABELS = {
  local: '삼산동·달동 지역',
  athlete: '운동선수·학생운동선수',
  rehab: '재활·노인',
};
const UNSET_LABEL = '미지정';
const SEGMENT_KEYS = [...Object.keys(SEGMENT_LABELS), null]; // null = 미지정

const { FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !NOTION_TOKEN) {
  console.error('❌ 환경변수가 비어 있습니다. GitHub Secrets(FIREBASE_SERVICE_ACCOUNT, NOTION_TOKEN)가 등록됐는지 확인하세요.');
  process.exit(1);
}

async function main() {
  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  // 집계 기간: 최근 7일 (trainer-stats/sync.mjs와 동일 방식)
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toYMD = (d) => d.toISOString().slice(0, 10);
  const startYMD = toYMD(weekAgo);
  const endYMD = toYMD(now);
  const startISO = weekAgo.toISOString();
  const endISO = now.toISOString();
  console.log(`집계 기간: ${startYMD} ~ ${endYMD}`);

  // 회원은 세그먼트 집계에만 쓰므로 필요한 필드만 읽어 비용을 아낀다. id는 ai
  // 컬렉션 문서(__mid)와 맞춰보기 위해 이번에 새로 같이 들고 온다.
  const membersSnap = await db.collection('members').select('isActive', 'joinDate', 'targetSegment').get();
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`회원 ${members.length}명 로드`);

  // 회원 id -> 세그먼트 키(SEGMENT_LABELS의 키 또는 null=미지정) 매핑. ai 컬렉션
  // 문서의 __mid로 이 회원이 어느 세그먼트인지 역으로 찾는 데 쓴다.
  const segmentByMemberId = new Map(
    members.map((m) => [m.id, SEGMENT_LABELS[m.targetSegment] ? m.targetSegment : null])
  );

  const newBySegment = {};    // key -> count (key는 SEGMENT_LABELS의 키 또는 null)
  const activeBySegment = {};
  SEGMENT_KEYS.forEach((k) => { newBySegment[k] = 0; activeBySegment[k] = 0; });

  members.forEach((m) => {
    const key = SEGMENT_LABELS[m.targetSegment] ? m.targetSegment : null; // 모르는 값도 미지정으로 묶음
    if (m.joinDate >= startYMD && m.joinDate <= endYMD) newBySegment[key] += 1;
    if (m.isActive) activeBySegment[key] += 1;
  });

  // 측정 이상감지 비율: 이번 주 ai 컬렉션 문서를 세그먼트별로 모아서
  // member.valid === false 비율을 구한다(자세한 이유는 파일 상단 주석 참고).
  const totalMeasuredBySegment = {};
  const invalidMeasuredBySegment = {};
  SEGMENT_KEYS.forEach((k) => { totalMeasuredBySegment[k] = 0; invalidMeasuredBySegment[k] = 0; });

  const aiSnap = await db
    .collection('ai')
    .where('recordedAtFull', '>=', startISO)
    .where('recordedAtFull', '<=', endISO)
    .get();
  aiSnap.forEach((doc) => {
    const data = doc.data();
    const mid = data.__mid;
    if (!mid || !segmentByMemberId.has(mid)) return; // 탈퇴 등으로 회원을 못 찾으면 집계에서 제외
    const key = segmentByMemberId.get(mid);
    totalMeasuredBySegment[key] += 1;
    if (data.member && data.member.valid === false) invalidMeasuredBySegment[key] += 1;
  });

  const notion = new Client({ auth: NOTION_TOKEN });
  const periodLabel = `${startYMD} ~ ${endYMD}`;
  for (const key of SEGMENT_KEYS) {
    const label = key ? SEGMENT_LABELS[key] : UNSET_LABEL;
    const totalMeasured = totalMeasuredBySegment[key];
    const invalidMeasured = invalidMeasuredBySegment[key];
    // Notion 숫자 속성이 percent 포맷이라 0~1 사이 값으로 저장(0.15 -> 화면엔 15%로 표시).
    const abnormalRate = totalMeasured > 0 ? invalidMeasured / totalMeasured : null;
    const row = { newMembers: newBySegment[key], activeMembers: activeBySegment[key], abnormalRate, totalMeasured };
    console.log(`- ${label}:`, row);
    await notion.pages.create({
      parent: { database_id: SEGMENT_STATS_DATABASE_ID },
      properties: {
        '기간': { title: [{ text: { content: periodLabel } }] },
        '세그먼트': { select: { name: label } },
        '신규회원수': { number: row.newMembers },
        '활성회원수': { number: row.activeMembers },
        '이상감지비율': { number: abnormalRate },
      },
    });
  }

  console.log('✅ 세그먼트별 통계 저장 완료!');
}

main().catch((err) => {
  console.error('❌ 실행 중 오류 발생:', err);
  process.exit(1);
});
