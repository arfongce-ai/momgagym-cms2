import { describe, it, expect } from 'vitest';
import { holdThresholdsForAge, evaluateSingleLegStance } from '../ai-measure/core/singleLegStance';

const trial = (holdTimeMs) => ({ valid: true, holdTimeMs });
const leg = (ms) => ({ trial1: trial(ms), trial2: trial(ms) });

describe('한발서기 연령별 기준', () => {
  it('나이 미상·60대까지는 기존 30/20/10초', () => {
    for (const a of [null, undefined, 25, 45, 65]) {
      const t = holdThresholdsForAge(a);
      expect([t.targetMs, t.cautionMs, t.minMs]).toEqual([30000, 20000, 10000]);
    }
    expect(holdThresholdsForAge(25).referenceMeanS).toBe(44.7);
  });
  it('70대 이상은 평균/30 비율로 낮춘다', () => {
    const t = holdThresholdsForAge(75);
    expect(t.targetMs).toBe(21500);
    expect(t.minMs).toBe(7167);
    expect(holdThresholdsForAge(85).targetMs).toBe(9400);
  });
  it('같은 12초라도 30대는 위험, 85세는 정상 범위에 가깝다', () => {
    const young = evaluateSingleLegStance({ left: leg(12000), ageYears: 30 });
    const old = evaluateSingleLegStance({ left: leg(12000), ageYears: 85 });
    expect(young.status).toBe('caution');
    expect(old.status).toBe('normal');
  });
  it('4초는 30대·85세 모두 위험(최소 미달)', () => {
    expect(evaluateSingleLegStance({ left: leg(2000), ageYears: 85 }).status).toBe('risk');
    expect(evaluateSingleLegStance({ left: leg(4000), ageYears: 30 }).status).toBe('risk');
  });
});
