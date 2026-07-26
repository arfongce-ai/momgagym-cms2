// src/services/voiceCommandService.js
// "모미야" 이후 들린 말을 /api/voice-command로 보내 분류하고,
// 회원 이름이 포함돼 있으면 실제 회원 목록에서 매칭한다.
//
// ⚠️ scopeMembersToTrainer의 정확한 위치는 실제 프로젝트의 회원 서비스 파일 경로에 맞춰
// 한 번 확인해주세요(트레이너 계정은 자기 담당 회원만 매칭되도록 하는 기존 함수입니다).
import { scopeMembersToTrainer } from './memberService.js';
import { findDestination } from '../voice/commandRegistry.js';
import { setPendingVoiceTarget } from '../voice/pendingVoiceTarget.js';

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
  const res = await fetch('/api/voice-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, role }),
  });

  if (!res.ok) {
    throw new Error(`음성 명령 처리 실패 (status ${res.status})`);
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
