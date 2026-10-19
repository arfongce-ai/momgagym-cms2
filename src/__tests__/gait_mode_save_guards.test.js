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

import { createRecognitionTracker } from '../ai-measure/core/recognitionStats';
import { ROM_SYMMETRY_RANGE } from '../ai-measure/core/romThresholds';
import { rangeToStatus, METRIC_DEFINITIONS } from '../ai-measure/core/unifiedReport';

describe('측정 인식률 — 준비 시간 제외', () => {
  const lm = (vis) => Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: vis }));
  it('처음 또렷하게 인식되기 전 프레임은 분모에 넣지 않는다', () => {
    const t = createRecognitionTracker();
    for (let i = 0; i < 30; i++) t.record(null);       // 자세 잡는 중
    for (let i = 0; i < 10; i++) t.record(lm(0.9));    // 측정 중
    const s = t.snapshot();
    expect(s.frames).toBe(10);
    expect(s.ratio).toBe(1);
    expect(s.setupFrames).toBe(30);
  });
  it('측정 시작 후 놓친 프레임은 그대로 센다', () => {
    const t = createRecognitionTracker();
    t.record(lm(0.9)); t.record(null);
    expect(t.snapshot().ratio).toBe(0.5);
  });
  it('끝까지 인식되지 않으면 0%', () => {
    const t = createRecognitionTracker();
    t.record(null); t.record(lm(0.1));
    expect(t.snapshot().ratio).toBe(0);
  });
});

describe('ROM 좌우 비대칭 기준 통일 / 착지 대칭 미판정', () => {
  it('ROM 비대칭은 8% 이하 양호, 15% 이하 주의, 초과 위험(한 기준)', () => {
    expect(ROM_SYMMETRY_RANGE.good).toEqual([0, 8]);
    const def = METRIC_DEFINITIONS.rom.find((d) => d.key === 'asymmetry');
    expect(def.range).toBe(ROM_SYMMETRY_RANGE);
    expect(def.paths).not.toContain('leftRightDiffDeg'); // 단위(도) 섞임 방지
    expect(rangeToStatus(12, ROM_SYMMETRY_RANGE).key).toBe('caution');
  });
  it('착지 대칭은 검증된 기준이 없어 판정 범위가 없다', () => {
    const def = METRIC_DEFINITIONS.jump.find((d) => d.key === 'footLandingSymmetry');
    expect(def.range).toBeUndefined();
  });
});

import { verticalOscRangeFor } from '../ai-measure/core/gaitMode';
import { BiomechAccumulator } from '../ai-measure/core/gaitBiomechanics';

describe('수직 진폭 걷기/달리기 분리, 미측정은 null', () => {
  it('걷기와 달리기는 다른 기준을 쓴다', () => {
    expect(verticalOscRangeFor(116).good).toEqual([2.5, 5.0]);
    expect(verticalOscRangeFor(170).good).toEqual([4.5, 7.5]);
  });
  it('프레임이 없으면 수직 진폭·보폭 비율·무릎 대칭이 0이 아니라 null', () => {
    const s = new BiomechAccumulator().summary();
    expect(s.verticalOscillation).toBeNull();
    expect(s.strideToHeight).toBeNull();
    expect(s.kneeSymmetry).toBeNull();
  });
});
