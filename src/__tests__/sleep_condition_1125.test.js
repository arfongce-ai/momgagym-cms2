import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../ai-measure/core/conditionAssessment';

describe('수면 컨디션 (2026-11-25)', () => {
  it('수면 1~2는 주의, 3 이상은 정상', () => {
    expect(evaluateCondition({ sleepQuality: 2 }).status).toBe('caution');
    expect(evaluateCondition({ sleepQuality: 2 }).flags).toContain('sleep_poor');
    expect(evaluateCondition({ sleepQuality: 3 }).status).toBe('normal');
  });
  it('수면 시간만 있어도 유효 기록이고 판정에는 쓰지 않는다', () => {
    const r = evaluateCondition({ sleepHours: 4 });
    expect(r.valid).toBe(true);
    expect(r.status).toBe('normal');
    expect(r.sleepHours).toBe(4);
  });
  it('범위를 벗어난 값은 보정한다', () => {
    expect(evaluateCondition({ sleepQuality: 9 }).sleepQuality).toBe(5);
    expect(evaluateCondition({ sleepHours: 40 }).sleepHours).toBe(24);
  });
  it('입력이 없으면 기존처럼 무효', () => {
    expect(evaluateCondition({}).valid).toBe(false);
  });
});
