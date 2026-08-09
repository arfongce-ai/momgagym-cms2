// src/voice/timerControlBus.js
// [음성 타이머 제어 2026-08-09] TimerTool.jsx(초시계·타이머·인터벌·메트로놈)가
// 이미 화면에 떠 있을 때, "모미야 타이머 멈춰줘" 같은 명령을 새로고침·재마운트
// 없이 그 자리에서 즉시 실행하기 위한 같은 탭 내 발행-구독 버스.
//
// pendingVoiceTarget.js/pendingTimerCommand.js와 역할이 다르다 — 그쪽은
// "아직 안 열린 화면에 도착하면 실행"할 값을 sessionStorage에 1회성으로 담아두는
// 것이고, 이건 "이미 열려 있는 화면에 지금 바로" 전달하는 것이다. 구독자가 있을
// 때만 쓰고, 없으면 pendingTimerCommand로 대신 저장해야 한다는 신호(false)를
// 돌려준다 — 호출부(voiceCommandService.js)가 그 신호로 둘 중 하나를 고른다.
const listeners = new Set();

export function subscribeTimerControl(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {object} cmd
 * @returns {boolean} 구독자가 있어 실제로 전달됐으면 true, 아무도 듣고 있지
 *   않으면(=화면이 아직 안 열려 있음) false.
 */
export function publishTimerControl(cmd) {
  if (listeners.size === 0) return false;
  listeners.forEach((fn) => fn(cmd));
  return true;
}

// 테스트 전용 — 구독자를 전부 비운다(테스트 간 상태 누수 방지).
export function _resetTimerControlBusForTest() {
  listeners.clear();
}
