import { describe, it, expect } from 'vitest';
import { CONDITION_TUNING, evaluateCondition } from '../ai-measure/core/conditionAssessment.js';
import { buildProblemFocus } from '../ai-measure/core/crossMeasureContext.js';

describe('PRS(운동 전 회복 느낌 0~10) — 신체정보 컨디션', () => {
  it('PRS 하나만 입력해도 유효한 체크인이다(0 포함)', () => {
    const r0 = evaluateCondition({ prs: '0' });
    expect(r0.valid).toBe(true);
    expect(r0.prs).toBe(0);
    expect(r0.status).toBe('caution');
    expect(r0.flags).toContain('prs_low');
  });
  it('기준선 이하는 주의, 초과는 정상, 단독으로 위험까지 가지 않는다', () => {
    expect(evaluateCondition({ prs: String(CONDITION_TUNING.prsCautionAt) }).status).toBe('caution');
    expect(evaluateCondition({ prs: String(CONDITION_TUNING.prsCautionAt + 1) }).status).toBe('normal');
    expect(evaluateCondition({ prs: 10 }).status).toBe('normal');
    expect(evaluateCondition({ prs: 0 }).status).not.toBe('risk');
  });
  it('통증이 심하면 PRS와 무관하게 위험이 우선(더 나쁜 쪽)', () => {
    expect(evaluateCondition({ prs: 9, painNrs: 8 }).status).toBe('risk');
    expect(evaluateCondition({ prs: 2, painNrs: 1 }).status).toBe('caution');
  });
  it('범위를 벗어난 값은 0~10으로 맞추고, 빈 값은 입력 없음', () => {
    expect(evaluateCondition({ prs: 15 }).prs).toBe(10);
    expect(evaluateCondition({ prs: -3 }).prs).toBe(0);
    const empty = evaluateCondition({ prs: '' });
    expect(empty.valid).toBe(false);
    expect(empty.prs).toBeNull();
  });
  it('기존 입력(피로도·통증·메모)의 결과는 그대로다', () => {
    const r = evaluateCondition({ fatigue: 5, painNrs: 5, memo: '무릎' });
    expect(r.status).toBe('caution');
    expect(r.flags).toEqual(expect.arrayContaining(['pain_moderate', 'fatigue_elevated']));
    expect(r.prs).toBeNull();
  });
  it('종합분석(buildProblemFocus daily)에 PRS 낮음이 주의로 전달된다', () => {
    const f = buildProblemFocus('daily', evaluateCondition({ prs: 3 }));
    const text = JSON.stringify(f);
    expect(text).toContain('PRS');
    const ok = buildProblemFocus('daily', evaluateCondition({ prs: 8 }));
    expect(JSON.stringify(ok)).not.toContain('낮게 보고');
  });
});
