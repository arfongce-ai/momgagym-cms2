import { describe, it, expect } from 'vitest';
import { classifyGaitMode, cadenceRangeFor, stanceRangeFor } from '../ai-measure/core/gaitMode';
import { isGaitStorable, isSprintStorable } from '../ai-measure/core/saveGuards';
import { extractKeyMetrics } from '../ai-measure/core/unifiedReport';

describe('gaitMode', () => {
  it('케이던스로 걷기/달리기를 나눈다', () => {
    expect(classifyGaitMode(116)).toBe('walk');
    expect(classifyGaitMode(139)).toBe('walk');
    expect(classifyGaitMode(140)).toBe('run');
    expect(classifyGaitMode(null)).toBeNull();
    expect(classifyGaitMode(0)).toBeNull();
  });
  it('걷기 116 spm 은 걷기 기준 안, 입각기는 달리기에서 기준 없음', () => {
    expect(cadenceRangeFor(116).good).toEqual([100, 130]);
    expect(cadenceRangeFor(170).good).toEqual([160, 180]);
    expect(stanceRangeFor(170)).toBeNull();
    expect(stanceRangeFor(116).good).toEqual([55, 65]);
  });
  it('통합 리포트: 걷기 116 은 정상, 달리기 입각기는 판정 없음', () => {
    const walk = extractKeyMetrics({ kind: 'gait', metrics: { cadence: 116, stancePct: 60 } }, 'gait');
    expect(walk.find((m) => m.key === 'cadence').status).toBe(walk.find((m) => m.key === 'stancePct').status);
    const run = extractKeyMetrics({ kind: 'gait', metrics: { cadence: 170, stancePct: 40 } }, 'gait');
    expect(run.find((m) => m.key === 'stancePct').status).not.toBe('risk');
  });
  it('착지 무릎 각도는 등급 없이 값만', () => {
    const m = extractKeyMetrics({ kind: 'jump', valid: true, biomech: { landingKneeAngle: 75 } }, 'jump').find((x) => x.key === 'landingKneeAngle');
    expect(m).toBeTruthy();
    expect(m.status).not.toBe('risk');
    expect(m.status).not.toBe('caution');
  });
});

describe('saveGuards', () => {
  it('보행은 metrics.valid 가 true 일 때만 저장', () => {
    expect(isGaitStorable({ metrics: { valid: true } })).toBe(true);
    expect(isGaitStorable({ metrics: { valid: false } })).toBe(false);
    expect(isGaitStorable({})).toBe(false);
  });
  it('스프린트는 불가능한 반응시간을 막는다', () => {
    expect(isSprintStorable({ reactionTimeMs: 300 })).toBe(true);
    expect(isSprintStorable({ reactionTimeMs: 6530 })).toBe(false);
    expect(isSprintStorable({ reactionTimeMs: 10 })).toBe(false);
    expect(isSprintStorable({})).toBe(true);
  });
});
