// src/voice/pendingVoiceTarget.js
// 음성 명령으로 화면을 이동할 때 "도착하면 누구를, 어떤 측정을 선택해둘지"를
// sessionStorage에 1회성으로 담아 전달한다. 도착한 화면이 소비(consume)하면 즉시 삭제된다.

const STORAGE_KEY = 'momi_pending_voice_target';

export function setPendingVoiceTarget({ memberName = null, testId = null } = {}) {
  if (!memberName && !testId) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ memberName, testId, ts: Date.now() }));
  } catch (e) {
    // sessionStorage 접근 실패(프라이빗 모드 등)는 조용히 무시 — 화면 이동 자체는 그대로 진행
  }
}

// 도착한 화면에서 한 번만 호출한다. 호출 즉시 저장된 값을 지운다(1회성).
export function consumePendingVoiceTarget() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    // 5분 넘게 묵은 값은 무시(예: 뒤로가기로 다시 들어온 경우 엉뚱하게 자동 선택되는 것 방지)
    if (!parsed || Date.now() - parsed.ts > 5 * 60 * 1000) return null;
    return { memberName: parsed.memberName || null, testId: parsed.testId || null };
  } catch (e) {
    return null;
  }
}
