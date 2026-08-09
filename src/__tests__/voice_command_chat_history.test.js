// [음성 대화형 2026-08-09] processVoiceCommand()가 history를 받아서 실제로
// /api/voice-command 요청 바디에 실어 보내는지 검증한다. 백엔드(functions/api/
// voice-command.js)가 이걸 받아 Claude에 이어붙이는 로직 자체는
// voice_command_backend.test.js에서 이미 검증됨(중복 안 함) — 여기선 프론트가
// 그 값을 제대로 전달하는지만 확인한다.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../firebase.js', () => ({
  auth: { currentUser: null },
}));

vi.mock('../demoData.js', () => ({
  store: {
    getMembers: () => [],
    getTrainers: () => [],
    getSchedules: () => [],
    createScheduleWithDeduction: vi.fn(),
    deleteScheduleWithRestore: vi.fn(),
    updateSchedule: vi.fn(),
  },
}));

import { processVoiceCommand } from '../services/voiceCommandService.js';

function mockFetchChat(text = '네, 알겠습니다!') {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    json: async () => ({ type: 'chat', text }),
  }));
  global.fetch = fetchSpy;
  return fetchSpy;
}

describe('processVoiceCommand() — history를 백엔드 요청에 그대로 실어 보낸다', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('history를 안 넘기면 빈 배열로 기본값 처리해서 보낸다(회귀 방지 — 기존 단발성 호출)', async () => {
    const fetchSpy = mockFetchChat();
    await processVoiceCommand({
      transcript: '오늘 컨디션 어때요',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: [],
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.history).toEqual([]);
  });

  it('history를 넘기면 요청 바디에 그대로 포함된다', async () => {
    const fetchSpy = mockFetchChat();
    const history = [
      { role: 'user', content: '홍길동님 요즘 어때요?' },
      { role: 'assistant', content: '꾸준히 좋아지고 있어요!' },
    ];
    await processVoiceCommand({
      transcript: '그럼 다음엔 뭘 해야 해요?',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: [],
      history,
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.history).toEqual(history);
    expect(body.transcript).toBe('그럼 다음엔 뭘 해야 해요?');
  });

  it('type: chat 응답을 그대로 반환한다(호출부가 history에 쌓을 재료)', async () => {
    mockFetchChat('꾸준히 좋아지고 있어요!');
    const result = await processVoiceCommand({
      transcript: '홍길동님 요즘 어때요?',
      role: 'trainer',
      currentUser: { trainerId: 't1' },
      allMembers: [],
    });
    expect(result).toEqual({ type: 'chat', text: '꾸준히 좋아지고 있어요!' });
  });
});
