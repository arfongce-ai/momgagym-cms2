import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerFreeDataQuestion } from '../services/freeVoiceDataService.js';
import {
  cacheVoiceResponse,
  getCachedVoiceResponse,
  isSafeVoiceCacheQuestion,
} from '../services/voiceResponseCache.js';
import { matchRuleBasedDestination, processVoiceCommand } from '../services/voiceCommandService.js';
import { estimateAnthropicCostUsd, recordPaidAiCost, reservePaidAiCall } from '../../functions/_shared/aiBudget.js';
import { classifyFreeNavigation } from '../../functions/_shared/freeAiRouter.js';

const MEMBERS = [
  { id: 'm1', name: '김철수', trainerSessions: { t1: { remaining: 7 }, t2: { remaining: 2 } } },
];
const SCHEDULES = [
  { id: 's1', date: '2026-08-15', trainerId: 't1', status: 'scheduled' },
  { id: 's2', date: '2026-08-15', trainerId: 't1', status: 'attended' },
  { id: 's3', date: '2026-08-15', trainerId: 't2', status: 'scheduled' },
  { id: 's4', date: '2026-08-15', trainerId: 't1', status: 'canceled' },
];
const PAYMENTS = [
  { paidAt: '2026-08-01', amount: 700000 },
  { paidAt: '2026-08-03', amount: 300000, isUnpaid: true },
  { paidAt: '2026-08-04', amount: 200000, isRefunded: true, refundedAt: '2026-08-10', refundAmount: 200000 },
  { paidAt: '2026-07-31', amount: 900000 },
];

describe('MOMI 무료 데이터 질문', () => {
  it('트레이너에게 오늘 본인 예약 건수를 캐시 데이터로 답한다', () => {
    const result = answerFreeDataQuestion({
      transcript: '오늘 예약 몇 명이야?', role: 'trainer', currentUser: { trainerId: 't1' },
      members: MEMBERS, schedules: SCHEDULES, payments: PAYMENTS, nowYMD: '2026-08-15',
    });
    expect(result.text).toContain('총 2건');
    expect(result.source).toBe('free-data');
  });

  it('담당 트레이너 기준 회원 잔여 세션을 답한다', () => {
    const result = answerFreeDataQuestion({
      transcript: '김철수 회원 잔여 세션 알려 줘', role: 'trainer', currentUser: { trainerId: 't1' },
      members: MEMBERS, nowYMD: '2026-08-15',
    });
    expect(result.text).toBe('김철수 회원님의 잔여 세션은 7회예요.');
  });

  it('관리자에게 이번 달 확정 매출만 합산하고, 트레이너에게는 공개하지 않는다', () => {
    const admin = answerFreeDataQuestion({
      transcript: '이번 달 매출 총 얼마야?', role: 'admin', members: MEMBERS,
      payments: PAYMENTS, nowYMD: '2026-08-15',
    });
    expect(admin.text).toContain('700,000원');
    expect(admin.text).toContain('결제 2건');
    const trainer = answerFreeDataQuestion({
      transcript: '이번 달 매출 알려 줘', role: 'trainer', members: MEMBERS,
      payments: PAYMENTS, nowYMD: '2026-08-15',
    });
    expect(trainer.text).toContain('관리자만');
  });

  it('processVoiceCommand에서도 데이터 질문은 fetch 없이 끝난다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await processVoiceCommand({
      transcript: '김철수 회원 세션 몇 회 남았어?', role: 'trainer',
      currentUser: { trainerId: 't1' }, allMembers: MEMBERS,
    });
    expect(result.text).toContain('7회');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('MOMI 표현 사전 확장', () => {
  it.each([
    ['회원 목록 보여 줘', 'members'],
    ['회원 화면 가자', 'members'],
    ['예약표 찾아줘', 'schedule'],
    ['결과 보고서 꺼내줘', 'report'],
    ['메인 화면으로 넘어가', 'home'],
  ])('%s', (text, expected) => {
    expect(matchRuleBasedDestination(text)).toBe(expected);
  });
});

describe('MOMI 안전 반복 질문 캐시', () => {
  function memoryStorage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  }

  it('비개인·비실시간 FAQ만 저장하고 다시 꺼낸다', () => {
    const storage = memoryStorage();
    expect(cacheVoiceResponse('모미 사용법 알려줘', '이렇게 사용하세요.', { storage })).toBe(true);
    expect(getCachedVoiceResponse('모미 사용법 알려줘', { storage })).toEqual({
      type: 'chat', text: '이렇게 사용하세요.', source: 'safe-cache',
    });
  });

  it('회원 이름·실시간 데이터·대화 맥락이 있으면 캐시하지 않는다', () => {
    expect(isSafeVoiceCacheQuestion('김철수 회원 사용법 알려줘', { memberNames: ['김철수'] })).toBe(false);
    expect(isSafeVoiceCacheQuestion('오늘 운영시간 알려줘')).toBe(false);
    expect(isSafeVoiceCacheQuestion('사용법 다시 알려줘', { history: [{ role: 'user', content: '앞 질문' }] })).toBe(false);
  });
});

describe('MOMI 서버 일일 유료 AI 한도', () => {
  function kvEnv(extra = {}) {
    const data = new Map();
    return {
      ...extra,
      MOMI_USAGE: {
        get: async (key) => JSON.parse(data.get(key) || 'null'),
        put: async (key, value) => data.set(key, value),
      },
    };
  }

  it('호출 횟수 한도를 넘으면 유료 AI만 차단한다', async () => {
    const env = kvEnv({ MOMI_DAILY_CLAUDE_CALL_LIMIT: '1', MOMI_DAILY_CLAUDE_BUDGET_USD: '5' });
    await reservePaidAiCall(env);
    await expect(reservePaidAiCall(env)).rejects.toMatchObject({ status: 429, code: 'AI_DAILY_BUDGET_REACHED' });
  });

  it('Anthropic usage를 모델별 실제 단가로 계산해 기록한다', async () => {
    expect(estimateAnthropicCostUsd('claude-haiku-4-5-20251001', {
      input_tokens: 1_000_000, output_tokens: 1_000_000,
    })).toBe(6);
    const env = kvEnv({ MOMI_DAILY_CLAUDE_CALL_LIMIT: '10', MOMI_DAILY_CLAUDE_BUDGET_USD: '10' });
    const reservation = await reservePaidAiCall(env);
    await recordPaidAiCost(env, reservation, 'claude-haiku-4-5-20251001', { input_tokens: 1000, output_tokens: 100 });
    await expect(reservePaidAiCall(env)).resolves.toBeTruthy();
  });
});

describe('Cloudflare Workers AI 무료 보조 분류', () => {
  it('신뢰도 높은 허용 화면만 반환한다', async () => {
    const env = { AI: { run: vi.fn().mockResolvedValue({ response: '{"destinationId":"members","confidence":0.96}' }) } };
    await expect(classifyFreeNavigation(env, '회원 명단 쪽으로 데려가 줘', 'trainer')).resolves.toBe('members');
  });

  it('관리자 화면·낮은 신뢰도·바인딩 없음은 안전하게 거절한다', async () => {
    const adminOnly = { AI: { run: vi.fn().mockResolvedValue({ response: '{"destinationId":"revenue","confidence":0.99}' }) } };
    await expect(classifyFreeNavigation(adminOnly, '매출 페이지 열어', 'trainer')).resolves.toBeNull();
    await expect(classifyFreeNavigation({}, '회원 페이지 열어', 'trainer')).resolves.toBeNull();
  });
});

afterEach(() => vi.restoreAllMocks());
