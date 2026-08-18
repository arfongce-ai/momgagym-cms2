// [음성 대화형 2026-08-09] chatHistory.js는 순수 함수라 실제 음성인식/네트워크
// 없이 로직만 검증한다.
import { describe, expect, it, vi } from 'vitest';
import {
  getActiveHistory,
  recordChatTurn,
  clearHistory,
  CHAT_HISTORY_TIMEOUT_MS,
  MAX_CHAT_HISTORY_TURNS,
} from '../voice/chatHistory.js';

function makeRefs() {
  return { historyRef: { current: [] }, lastChatAtRef: { current: null } };
}

describe('recordChatTurn() — 대화 왕복 쌓기', () => {
  it('사용자 발화+모미 답변을 한 쌍으로 history에 추가한다', () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    recordChatTurn(historyRef, lastChatAtRef, '오늘 날씨 어때?', '오늘은 맑아요!');
    expect(historyRef.current).toEqual([
      { role: 'user', content: '오늘 날씨 어때?' },
      { role: 'assistant', content: '오늘은 맑아요!' },
    ]);
  });

  it('여러 턴을 순서대로 이어붙인다', () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    recordChatTurn(historyRef, lastChatAtRef, 'Q1', 'A1');
    recordChatTurn(historyRef, lastChatAtRef, 'Q2', 'A2');
    expect(historyRef.current.map((t) => t.content)).toEqual(['Q1', 'A1', 'Q2', 'A2']);
  });

  it(`MAX_CHAT_HISTORY_TURNS(${MAX_CHAT_HISTORY_TURNS})를 넘으면 오래된 턴부터 잘린다(토큰 비용 방어)`, () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    for (let i = 1; i <= 10; i++) {
      recordChatTurn(historyRef, lastChatAtRef, `Q${i}`, `A${i}`);
    }
    expect(historyRef.current.length).toBe(MAX_CHAT_HISTORY_TURNS);
    // 가장 최근 것들만 남아야 한다.
    expect(historyRef.current[0].content).toBe(`Q${11 - (MAX_CHAT_HISTORY_TURNS / 2)}`);
    expect(historyRef.current.at(-1).content).toBe('A10');
  });

  it('transcript나 replyText가 없으면 아무것도 추가하지 않는다(방어)', () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    recordChatTurn(historyRef, lastChatAtRef, '', '답변');
    recordChatTurn(historyRef, lastChatAtRef, '질문', '');
    recordChatTurn(historyRef, lastChatAtRef, null, null);
    expect(historyRef.current).toEqual([]);
  });

  it('lastChatAtRef를 현재 시각으로 갱신한다', () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    const before = Date.now();
    recordChatTurn(historyRef, lastChatAtRef, 'Q', 'A');
    expect(lastChatAtRef.current).toBeGreaterThanOrEqual(before);
  });
});

describe('getActiveHistory() — 시간 경과에 따른 자동 리셋', () => {
  it('최근에 대화했으면(타임아웃 이내) history를 그대로 반환한다', () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    recordChatTurn(historyRef, lastChatAtRef, 'Q', 'A');
    const active = getActiveHistory(historyRef, lastChatAtRef);
    expect(active.length).toBe(2);
  });

  it(`${CHAT_HISTORY_TIMEOUT_MS / 1000}초 넘게 조용했으면 빈 배열로 리셋한다(오전/오후 대화가 안 섞이도록)`, () => {
    vi.useFakeTimers();
    try {
      const { historyRef, lastChatAtRef } = makeRefs();
      recordChatTurn(historyRef, lastChatAtRef, 'Q', 'A');
      vi.advanceTimersByTime(CHAT_HISTORY_TIMEOUT_MS + 1000);
      const active = getActiveHistory(historyRef, lastChatAtRef);
      expect(active).toEqual([]);
      expect(lastChatAtRef.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('아직 한 번도 대화한 적 없으면(lastChatAtRef.current=null) 빈 배열을 그대로 반환한다', () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    expect(getActiveHistory(historyRef, lastChatAtRef)).toEqual([]);
  });
});

describe('clearHistory() — 액션(navigate/예약류) 뒤 맥락 초기화', () => {
  it('history와 lastChatAtRef를 모두 비운다', () => {
    const { historyRef, lastChatAtRef } = makeRefs();
    recordChatTurn(historyRef, lastChatAtRef, 'Q', 'A');
    clearHistory(historyRef, lastChatAtRef);
    expect(historyRef.current).toEqual([]);
    expect(lastChatAtRef.current).toBeNull();
  });
});
