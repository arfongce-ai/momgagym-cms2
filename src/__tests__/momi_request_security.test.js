import { describe, expect, it } from 'vitest';
import { applyMomiSafetyGuard, enforceMomiRateLimit, normalizeMomiHistory, readMomiJson } from '../../functions/_shared/momiRequest.js';
import { resolveVerifiedRole } from '../../functions/_shared/verifyFirebaseToken.js';

describe('MOMI 요청 보호', () => {
  it('토큰이 없으면 trainer로 통과시키지 않고 미인증으로 반환한다', async () => {
    await expect(resolveVerifiedRole(null)).resolves.toEqual({ authenticated: false, role: null, uid: null });
  });

  it('대화 이력을 정리하고 연속된 같은 role을 합친다', () => {
    const history = normalizeMomiHistory([
      { role: 'assistant', content: '앞에 잘못 붙은 답' },
      { role: 'user', content: '첫 질문' },
      { role: 'user', content: '보충 질문' },
      { role: 'system', content: '주입 시도' },
      { role: 'assistant', content: '답변' },
    ]);
    expect(history).toEqual([
      { role: 'user', content: '첫 질문\n보충 질문' },
      { role: 'assistant', content: '답변' },
    ]);
  });

  it('256KB를 넘는 실제 요청 바디를 거부한다', async () => {
    const request = new Request('https://example.com/api/momi', {
      method: 'POST',
      body: JSON.stringify({ report: 'x'.repeat(260 * 1024) }),
    });
    await expect(readMomiJson(request)).rejects.toMatchObject({ status: 413 });
  });

  it('Rate Limiting binding이 없어도 isolate 단위 호출 제한을 적용한다', async () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    await enforceMomiRateLimit({}, key, { limit: 2 });
    await enforceMomiRateLimit({}, key, { limit: 2 });
    await expect(enforceMomiRateLimit({}, key, { limit: 2 })).rejects.toMatchObject({ status: 429 });
  });

  it('응급 레드플래그는 모델 답변 대신 즉시 진료 안내를 보장한다', () => {
    const text = applyMomiSafetyGuard({
      kind: 'daily',
      report: { measurements: { memo: '대소변 조절 장애가 새로 생김' } },
      text: '가벼운 운동을 해보세요.',
    });
    expect(text).toContain('즉시 응급실');
    expect(text).not.toContain('가벼운 운동');
  });

  it('일일 통증 NRS 7 이상은 운동 처방을 보류한다', () => {
    const text = applyMomiSafetyGuard({
      kind: 'daily',
      report: { measurements: { painNrs: 8 } },
      text: '스쿼트 3세트를 진행하세요.',
    });
    expect(text).toContain('운동은 보류');
    expect(text).not.toContain('스쿼트');
  });
});
