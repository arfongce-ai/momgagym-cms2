import { describe, it, expect } from 'vitest';
import { assessPlacement, jitterRange, accDeviation } from '../ai-measure/core/sensorPlacementCheck';
import { getSensorJointTip } from '../ai-measure/core/sensorJointTips';
import { ROM_NORMS } from '../ai-measure/core/bodyMechanics';

describe('위치·민감도 확인', () => {
  it('표본 부족이면 대기', () => {
    expect(assessPlacement({ recentDegs: [1, 1] }).level).toBe('wait');
  });
  it('안정적이면 good', () => {
    const r = assessPlacement({ recentDegs: [10, 10.2, 10.1, 10.3, 10.1, 10.2], tiltErrDeg: 1, accDev: 0.01 });
    expect(r.level).toBe('good');
  });
  it('흔들림 크면 bad + 힌트', () => {
    const r = assessPlacement({ recentDegs: [0, 4, 1, 5, 0, 4], tiltErrDeg: 1, accDev: 0.01 });
    expect(r.level).toBe('bad');
    expect(r.hints.length).toBeGreaterThan(0);
  });
  it('비틀림 경고 구간은 warn', () => {
    expect(assessPlacement({ recentDegs: [1, 1, 1, 1, 1], tiltErrDeg: 3.5, accDev: 0 }).level).toBe('warn');
  });
  it('유틸', () => {
    expect(jitterRange([1, 2, 3])).toBeNull();
    expect(accDeviation(9.81)).toBeCloseTo(0, 5);
  });
});
describe('무릎 안내', () => {
  it('KNEE 안내가 있고 교재 수치 135° 와 CMS 정상값이 일치', () => {
    const t = getSensorJointTip('KNEE');
    expect(t.blocks.length).toBe(3);
    expect(t.blocks[0].norms).toContain('135');
    expect(JSON.stringify(ROM_NORMS.KNEE)).toContain('135');
  });
});
