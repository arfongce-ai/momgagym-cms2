// src/voice/chatHistory.js
// [음성 대화형 2026-08-09] "모미야"로 나눈 자유 질문(코칭 등) 대화의 맥락을
// 몇 턴 정도 기억해서, "그럼 그건요?" 같은 자연스러운 후속 질문을 알아듣게
// 한다. functions/api/voice-command.js가 이제 history를 받아 Claude에 이어
// 붙이므로(Axis4와 동일 패턴), 여기서는 그 history를 "누가/언제 채우고
// 비우는지"만 담당한다 — 순수 함수라 실제 인식/네트워크와 분리해서
// 테스트할 수 있다.
//
// KioskVoiceCommand.jsx와 GlobalVoiceCommand.jsx가 완전히 같은 로직을 각자
// useRef로 들고 쓰므로(두 곳 다 "모미야"로 시작하는 독립된 대화 세션),
// 중복 구현하지 않도록 여기 한 곳에 모은다.

// 이 시간 넘게 자유 질문이 없었으면 다음 대화는 새로 시작한다 — 키오스크처럼
// 하루 종일 켜져 있는 화면에서 오전에 물어본 내용이 오후 질문에 엉뚱하게
// 섞여 들어가는 것을 막는다.
export const CHAT_HISTORY_TIMEOUT_MS = 2 * 60 * 1000;

// user/assistant 합쳐서 최근 N개 턴만 유지(토큰 비용 방어). 3번 정도의
// 왕복이면 "그거·그럼" 같은 대명사 참조는 충분히 커버된다.
export const MAX_CHAT_HISTORY_TURNS = 4;

/**
 * 다음 요청에 실어 보낼 history를 반환한다 — 너무 오래 조용했으면(타임아웃)
 * 비워서 반환하고, ref 자체도 비운다(다음 recordChatTurn이 새로 쌓기 시작).
 * @param {{current: Array<{role:string,content:string}>}} historyRef
 * @param {{current: number|null}} lastChatAtRef
 */
export function getActiveHistory(historyRef, lastChatAtRef) {
  const last = lastChatAtRef.current;
  if (last && Date.now() - last > CHAT_HISTORY_TIMEOUT_MS) {
    historyRef.current = [];
    lastChatAtRef.current = null;
  }
  return historyRef.current;
}

/**
 * 자유 질문 왕복(사용자 발화 + 모미 답변) 한 턴을 history에 追加한다.
 * 화면 이동·예약류(navigate/reservation_*) 결과는 여기 안 쌓는다 — 그런
 * 액션은 "대화"가 아니라 단발성 명령이라 다음 자유 질문과 이어붙일 맥락이
 * 아니기 때문(호출부가 type==='chat'일 때만 이 함수를 부르는 게 맞다).
 */
export function recordChatTurn(historyRef, lastChatAtRef, transcript, replyText) {
  if (!transcript || !replyText) return;
  historyRef.current = [
    ...historyRef.current,
    { role: 'user', content: transcript },
    { role: 'assistant', content: replyText },
  ].slice(-MAX_CHAT_HISTORY_TURNS);
  lastChatAtRef.current = Date.now();
}

/**
 * navigate/reservation_* 처럼 실제 액션이 일어난 턴 뒤에는 대화 맥락을
 * 비운다 — 구체적인 행동으로 넘어갔으니 그 이전 잡담 맥락을 계속 끌고 가면
 * 오히려 다음 자유 질문 해석에 방해가 된다.
 */
export function clearHistory(historyRef, lastChatAtRef) {
  historyRef.current = [];
  lastChatAtRef.current = null;
}
