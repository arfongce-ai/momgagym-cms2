// src/services/voiceCommandService.js
// "모미야" 이후 들린 말을 /api/voice-command로 보내 분류하고,
// 회원 이름이 포함돼 있으면 실제 회원 목록에서 매칭한다.
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

export async function processVoiceCommand({ transcript, role, currentUser, allMembers, navigate }) {
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
