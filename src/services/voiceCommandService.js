// src/services/voiceCommandService.js
// "모미야" 이후 들린 말을 처리한다. [무료 우선 2026-08-08] 목적지가 명확한
// "OO 화면 열어줘" 류 명령은 규칙 기반(키워드)으로 먼저 처리해서 API 비용 없이
// $0으로 끝낸다. 애매하거나 자유 질문(코칭 등)일 때만 /api/voice-command(Claude,
// 유료)로 넘어간다. 회원 이름이 포함돼 있으면 실제 회원 목록에서 매칭한다.
import { scopeMembersToTrainer } from '../utils/memberList.js';
import { findDestination } from '../voice/commandRegistry.js';
import { setPendingVoiceTarget } from '../voice/pendingVoiceTarget.js';
import { auth } from '../firebase.js';

// 간단한 한글 이름 퍼지 매칭: 공백 제거 + 부분 일치 우선, 없으면 자모 유사도로 fallback.
function normalize(str) {
  return (str || '').replace(/\s+/g, '').toLowerCase();
}

function fuzzyFindMember(members, spokenName) {
  if (!spokenName || !members || members.length === 0) return null;
  const target = normalize(spokenName);

  // 1순위: 정확히 포함
  const exact = members.find((m) => normalize(m.name) === target);
  if (exact) return exact;

  // 2순위: 부분 일치 (예: "김철수님" -> "김철수")
  const partial = members.find(
    (m) => normalize(m.name).includes(target) || target.includes(normalize(m.name))
  );
  if (partial) return partial;

  return null;
}

// [무료 우선 2026-08-08] 목적지별 키워드. 순서가 우선순위다 — 더 구체적인
// 키워드를 먼저 검사해야 "가상 회원 리포트 열어 줘"처럼 여러 후보가 겹치는
// 문장에서 올바른 쪽("리포트")이 먼저 걸린다("회원"이 먼저 걸리면 회원관리
// 화면으로 잘못 이동함).
const DESTINATION_KEYWORDS = [
  { id: 'report', keywords: ['리포트'] },
  { id: 'ai_measure', keywords: ['에이아이측정', 'ai측정', '측정'] },
  { id: 'schedule', keywords: ['스케줄', '일정'] },
  { id: 'settings', keywords: ['설정'] },
  { id: 'trainers', keywords: ['트레이너'] },
  { id: 'revenue', keywords: ['매출'] },
  { id: 'members', keywords: ['회원관리', '회원'] },
  { id: 'home', keywords: ['홈', '대시보드'] },
];

// "화면 이동해줘"라는 의도가 명확할 때만 규칙 기반으로 처리한다 — 목적지
// 키워드만 보고 판단하면 "이 회원한테 어떤 운동을 추천해야 할까요?" 같은
// 코칭 질문(회원이 들어있지만 이동 명령이 아님)도 잘못 화면 이동으로
// 처리해버릴 수 있다. 이동 동사가 없으면 애매한 걸로 보고 Claude로 넘긴다.
const NAVIGATION_VERBS = ['열어', '띄워', '보여', '가줘', '가자', '이동', '들어가'];

function hasNavigationVerb(normalizedText) {
  return NAVIGATION_VERBS.some((v) => normalizedText.includes(normalize(v)));
}

/**
 * 규칙 기반으로 목적지를 찾는다. 확신 있게 못 찾으면 null(→ 호출부가 Claude로 넘김).
 * [보안] 관리자 전용 화면(트레이너관리·매출관리)은 절대 여기서 끝내지 않고 null을
 * 반환해 반드시 Claude 경로(서버가 Firebase ID 토큰으로 role을 직접 검증,
 * functions/_shared/verifyFirebaseToken.js)로 넘긴다. 여기서 쓰는 role은 클라이언트
 * 값이라 조작 가능해서, 규칙 기반 경로에서 그대로 통과시키면 예전에 고쳤던 보안
 * 취약점(트레이너가 role만 바꿔 관리자 화면 접근)이 이 경로로 다시 뚫리게 된다.
 */
export function matchRuleBasedDestination(commandText) {
  const normalized = normalize(commandText);
  if (!hasNavigationVerb(normalized)) return null;
  for (const { id, keywords } of DESTINATION_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(normalize(k)))) {
      const destination = findDestination(id);
      if (destination?.adminOnly) return null;
      return id;
    }
  }
  return null;
}

/** 명령 텍스트 안에 실제 등록된 회원 이름이 포함돼 있으면 가장 긴 매치를 추출한다. */
export function extractMemberNameFromText(commandText, members) {
  if (!members || members.length === 0) return null;
  const normalized = normalize(commandText);
  let best = null;
  for (const m of members) {
    const n = normalize(m.name);
    if (n && normalized.includes(n) && (!best || n.length > normalize(best).length)) {
      best = m.name;
    }
  }
  return best;
}

export async function processVoiceCommand({ transcript, role, currentUser, allMembers, navigate }) {
  // [무료 우선 2026-08-08] 규칙 기반으로 먼저 시도 — 매치되면 API 호출 자체가
  // 없어서 비용이 전혀 안 든다.
  const ruleDestId = matchRuleBasedDestination(transcript);
  if (ruleDestId) {
    const destination = findDestination(ruleDestId);
    const scopedMembers =
      role === 'admin' ? allMembers : scopeMembersToTrainer(allMembers, currentUser);
    const memberName = extractMemberNameFromText(transcript, scopedMembers);
    const matchedMember = memberName ? fuzzyFindMember(scopedMembers, memberName) : null;

    setPendingVoiceTarget({
      memberName: matchedMember ? matchedMember.name : null,
      testId: null, // 규칙 기반에서는 측정 종류까진 안 뽑는다 — 필요하면 Claude 경로에서 처리됨.
    });

    if (navigate) navigate(destination.path);

    return {
      type: 'navigate',
      destination,
      matchedMember,
      requestedName: memberName,
    };
  }

  // 규칙 기반으로 확신 있게 못 찾았으면(자유 질문·코칭·애매한 표현·관리자 전용
  // 화면 등) 기존처럼 Claude(/api/voice-command)로 넘어간다.
  // [보안 수정] 서버는 이제 이 role 문자열을 그대로 믿지 않고, 아래 idToken을 직접
  // 검증해서 진짜 role을 구한다(functions/_shared/verifyFirebaseToken.js 참고).
  // role은 과도기 호환용으로만 계속 같이 보낸다.
  let idToken = null;
  try { idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null; }
  catch (e) { console.warn('[voiceCommandService] ID 토큰 발급 실패:', e?.message || e); }

  const res = await fetch('/api/voice-command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ transcript, role }),
  });

  if (!res.ok) {
    // [진단용 2026-08-08] "명령 실행이 안 된다"는 문의 대응 — 예전엔 상태 코드만
    // 담아 던져서 정작 왜 실패했는지(예: Anthropic API 크레딧 부족 등 서버 쪽
    // 문제)는 화면에 안 보였다. 백엔드(functions/api/voice-command.js)가 실패
    // 응답에 detail을 이미 담아 보내주므로, 그걸 읽어서 에러 메시지에 포함한다.
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.detail || body?.error || '';
    } catch (e) {
      // 응답이 JSON이 아닌 경우(네트워크 레벨 오류 등) — 상태 코드만으로 넘어간다.
    }
    throw new Error(`음성 명령 처리 실패 (status ${res.status})${detail ? ` — ${detail}` : ''}`);
  }

  const data = await res.json();

  if (data.type === 'chat') {
    return { type: 'chat', text: data.text };
  }

  // type === 'navigate'
  const destination = findDestination(data.destinationId);
  if (!destination) {
    return { type: 'chat', text: '어디로 이동해야 할지 못 알아들었어요. 다시 말씀해주세요.' };
  }

  // role에 안 맞는 목적지는 백엔드에서도 걸러지지만, 프론트에서도 한 번 더 방어.
  if (destination.adminOnly && role !== 'admin') {
    return { type: 'chat', text: '죄송해요, 그 화면은 권한이 없어서 열어드릴 수 없어요.' };
  }

  let matchedMember = null;
  if (data.memberName) {
    const scopedMembers =
      role === 'admin' ? allMembers : scopeMembersToTrainer(allMembers, currentUser);
    matchedMember = fuzzyFindMember(scopedMembers, data.memberName);
  }

  setPendingVoiceTarget({
    memberName: matchedMember ? matchedMember.name : null,
    testId: data.testId || null,
  });

  if (navigate) navigate(destination.path);

  return {
    type: 'navigate',
    destination,
    matchedMember,
    requestedName: data.memberName || null,
  };
}
