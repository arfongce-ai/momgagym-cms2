import { describe, it, expect } from 'vitest';
import { BroadJumpTracker, combineJumpTrials, MULTI_TRIAL_JUMP_SUBTYPES } from '../ai-measure/core/jumpBiomechanics';
import { JUMP_SUBTYPES, JUMP_SUBTYPE_ORDER, BROAD_JUMP_SUBTYPES, VERTICAL_JUMP_SUBTYPES, requiredJumpsFor, hopsFor, engineOf } from '../ai-measure/core/jumpTypes';
import { menuGroupKey } from '../services/reportService';
import { subtypeOf } from '../ai-measure/core/measureSubtype';

// 플로우: 발목 y 신호를 직접 만들어 BroadJumpTracker 에 넣는다(점프 높이 임계 = baseline - band).
const BASE_Y = 0.9;
const mkCalib = () => ({ baselineAnkleY: BASE_Y, baselineFeetY: BASE_Y, baselineFeetX: 0.1, baselineMeasureX: 0.1, scaleCmPerY: 170, ankleSide: null, measurePoint: 'feet' });
const lm = (y, x) => {
  const a = Array.from({ length: 33 }, () => ({ x, y, visibility: 1 }));
  return a;
};
// 한 번 이륙 → 착지. landingX 는 착지 프레임의 x.
function hop(tracker, t0, landingX) {
  tracker.push(lm(BASE_Y, 0.1), t0);
  tracker.push(lm(BASE_Y - 0.2, 0.2), t0 + 100);
  tracker.push(lm(BASE_Y - 0.2, 0.3), t0 + 250);
  tracker.push(lm(BASE_Y, landingX), t0 + 400);
}

describe('트리플·크로스오버 홉 종류', () => {
  it('종류 정의: 수평 엔진·한발·3연속', () => {
    for (const k of ['thop', 'chop']) {
      expect(JUMP_SUBTYPES[k].engine).toBe('horizontal');
      expect(JUMP_SUBTYPES[k].singleLeg).toBe(true);
      expect(hopsFor(k)).toBe(3);
      expect(requiredJumpsFor(k)).toBe(3);
      expect(engineOf(k)).toBe('horizontal');
      expect(JUMP_SUBTYPE_ORDER).toContain(k);
      expect(BROAD_JUMP_SUBTYPES).toContain(k);
      expect(VERTICAL_JUMP_SUBTYPES).not.toContain(k);
      expect(MULTI_TRIAL_JUMP_SUBTYPES).toContain(k);
    }
  });
  it('기존 종류는 그대로 1회', () => {
    expect(hopsFor('sbj')).toBe(1);
    expect(hopsFor('cmj')).toBe(1);
    expect(requiredJumpsFor('sbj')).toBe(1);
    expect(requiredJumpsFor('bosco')).toBe(10);
    expect(requiredJumpsFor('rsi')).toBe(3);
  });
  it('리포트 그룹 키·세부 분류(종합분석)가 종류별로 분리된다', () => {
    expect(menuGroupKey({ menu: 'jump', data: { jumpSubType: 'thop' } })).toBe('jump_thop');
    expect(menuGroupKey({ menu: 'jump', data: { jumpSubType: 'chop' } })).toBe('jump_chop');
    const a = subtypeOf('jump', { jumpSubType: 'thop', leg: 'left' });
    const b = subtypeOf('jump', { jumpSubType: 'thop', leg: 'right' });
    const c = subtypeOf('jump', { jumpSubType: 'shjf', leg: 'left' });
    expect(a.key).toBe('thop:left');
    expect(a.label).toContain('트리플');
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
  });
});

describe('BroadJumpTracker hops', () => {
  it('hops=3: 출발선→마지막 착지 총거리와 구간 거리', () => {
    const t = new BroadJumpTracker(mkCalib(), { hops: 3 });
    t.frameAspect = 1;
    hop(t, 0, 0.3);
    hop(t, 1000, 0.5);
    hop(t, 2000, 0.7);
    const s = t.summary({ heightCm: 170 });
    expect(s.hops).toBe(3);
    expect(s.hopsDetected).toBe(3);
    expect(s.reason).toBe('ok');
    expect(s.valid).toBe(true);
    // 정규화 dx 0.6 × 170cm
    expect(s.distanceCm).toBeCloseTo(102, 0);
    expect(s.hopSplitsCm).toHaveLength(3);
    expect(s.hopSplitsCm.reduce((a, b) => a + b, 0)).toBeCloseTo(s.distanceCm, 0);
  });
  it('도약이 모자라도 기록은 남기고 valid=false(few_hops)', () => {
    const t = new BroadJumpTracker(mkCalib(), { hops: 3 });
    hop(t, 0, 0.3);
    hop(t, 1000, 0.5);
    const s = t.summary({ heightCm: 170 });
    expect(s.valid).toBe(false);
    expect(s.reason).toBe('few_hops');
    expect(s.hopsDetected).toBe(2);
    expect(s.distanceCm).toBeGreaterThan(0);
  });
  it('뒤로 간 도약은 not_forward', () => {
    const t = new BroadJumpTracker(mkCalib(), { hops: 3 });
    hop(t, 0, 0.4);
    hop(t, 1000, 0.55);
    hop(t, 2000, 0.3);
    const s = t.summary({ heightCm: 170 });
    expect(s.reason).toBe('not_forward');
    expect(s.valid).toBe(false);
  });
  it('hops 기본값(1)은 기존 제자리멀리뛰기 요약과 같다(hopSplitsCm 없음)', () => {
    const t = new BroadJumpTracker(mkCalib());
    hop(t, 0, 0.4);
    const s = t.summary({ heightCm: 170 });
    expect(s.hopSplitsCm).toBeUndefined();
    expect(s.distanceCm).toBeCloseTo(0.3 * 170, 0);
    expect(s.valid).toBe(true);
  });
  it('회차 평균에서 구간 거리도 평균된다', () => {
    const base = { valid: true, hops: 3 };
    const r = combineJumpTrials([
      { ...base, distanceCm: 300, hopSplitsCm: [90, 100, 110] },
      { ...base, distanceCm: 330, hopSplitsCm: [100, 110, 120] },
    ], 'horizontal');
    expect(r.distanceCm).toBeCloseTo(315, 0);
    expect(r.hopSplitsCm).toEqual([95, 105, 115]);
    expect(r.trials).toHaveLength(2);
  });
});
