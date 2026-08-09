// src/voice/pendingTimerCommand.js
// [음성 타이머 제어 2026-08-09] "모미야, 타이머 30초 돌려줘" 같은 명령이 왔는데
// 아직 초시계·타이머·인터벌·메트로놈 화면(TimerTool.jsx)이 열려있지 않을 때,
// 화면 이동 후 도착하면 실행할 명령을 1회성으로 담아 전달한다.
//
// pendingVoiceTarget.js와 같은 sessionStorage 1회성 패턴(정확히는 그 파일의
// setPendingVoiceTarget/consumePendingVoiceTarget 쌍과 동일한 구조)을 쓰되,
// 별도 저장 키를 쓴다 — AiMeasureHub.jsx가 이미 pendingVoiceTarget을 마운트
// 시 한 번 소비해버리므로, 같은 저장소를 같이 쓰면 그 다음 TimerTool.jsx가
// 열렸을 때는 이미 비어있게 된다.
const STORAGE_KEY = 'momi_pending_timer_command';

/**
 * @param {object} cmd
 * @param {string} cmd.tool   'stopwatch'|'countdown'|'interval'|'metronome'
 * @param {string} cmd.action 'start'|'pause'|'reset'|'lap'
 * @param {number} [cmd.seconds]  countdown 전용 — 시작할 총 시간(초).
 * @param {number} [cmd.workSec] [cmd.restSec] [cmd.rounds]  interval 전용.
 * @param {number} [cmd.bpm]  metronome 전용.
 */
export function setPendingTimerCommand(cmd) {
  if (!cmd?.tool || !cmd?.action) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cmd, ts: Date.now() }));
  } catch (e) {
    // sessionStorage 접근 실패(프라이빗 모드 등)는 조용히 무시 — 화면 이동 자체는 그대로 진행
  }
}

// 도착한 화면(TimerTool.jsx)에서 마운트 시 한 번만 호출한다. 호출 즉시 저장된
// 값을 지운다(1회성).
export function consumePendingTimerCommand() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    // 5분 넘게 묵은 값은 무시(pendingVoiceTarget.js와 동일 기준 — 뒤늦게 다른
    // 경로로 이 화면에 들어왔을 때 엉뚱한 명령이 재생되는 것 방지)
    if (!parsed || Date.now() - parsed.ts > 5 * 60 * 1000) return null;
    const { ts, ...cmd } = parsed;
    return cmd;
  } catch (e) {
    return null;
  }
}
