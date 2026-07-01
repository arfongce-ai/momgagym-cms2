import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fuseTrackingCandidates, summarizeCrossValidation } from '../ai-measure/core/trackFusion.js';
import { estimateBodyCOG, barCogHorizontalGap } from '../ai-measure/core/bodyCog.js';
import { vbtConfidence } from '../ai-measure/core/lifting.js';
import { createPlateBlobTracker } from '../ai-measure/core/plates.js';
import { LM } from '../ai-measure/core/geometry.js';

// ── 다중 신호 융합(요구사항 2) ──
describe('trackFusion — 색/스켈레톤/원판색 신호 융합', () => {
  it('색 추적이 살아있으면 색 좌표를 그대로 대표값으로 쓴다', () => {
    const out = fuseTrackingCandidates({
      colorPoint: { x: 0.5, y: 0.4 }, colorActive: 2,
      skeletonPoint: { x: 0.52, y: 0.41 }, plateColorPoint: { x: 0.49, y: 0.39 },
    });
    expect(out.source).toBe('color');
    expect(out.point).toEqual({ x: 0.5, y: 0.4 });
    expect(out.usedFallback).toBe(false);
  });

  it('skeleton·plate가 서로 합의하는데 color만 크게 벗어나면(드리프트) 거부하고 합의 지점을 쓴다', () => {
    // 색 추적이 바닥/배경 등 엉뚱한 곳으로 걸어가 버린 시나리오.
    const out = fuseTrackingCandidates({
      colorPoint: { x: 0.1, y: 0.9 }, colorActive: 1,
      skeletonPoint: { x: 0.5, y: 0.4 }, plateColorPoint: { x: 0.51, y: 0.41 },
    });
    expect(out.source).toBe('fused_fallback');
    expect(out.usedFallback).toBe(true);
    expect(out.colorRejected).toBe(true);
    expect(out.point.x).toBeCloseTo(0.505, 5);
    expect(out.point.y).toBeCloseTo(0.405, 5);
  });

  it('skeleton·plate가 서로도 합의하지 않으면(교차검증 불가) color를 그대로 신뢰한다', () => {
    const out = fuseTrackingCandidates({
      colorPoint: { x: 0.1, y: 0.9 }, colorActive: 1,
      skeletonPoint: { x: 0.5, y: 0.4 }, plateColorPoint: { x: 0.9, y: 0.1 },
    });
    expect(out.source).toBe('color');
    expect(out.colorRejected).toBeUndefined();
  });

  it('color가 합의 지점에서 크게 벗어나지 않으면(정상 범위) 그대로 신뢰한다', () => {
    const out = fuseTrackingCandidates({
      colorPoint: { x: 0.52, y: 0.4 }, colorActive: 1,
      skeletonPoint: { x: 0.5, y: 0.4 }, plateColorPoint: { x: 0.5, y: 0.4 },
    });
    expect(out.source).toBe('color');
    expect(out.colorRejected).toBeUndefined();
  });

  it('세 신호가 가까우면 일치도(agreement)가 1', () => {
    const out = fuseTrackingCandidates({
      colorPoint: { x: 0.5, y: 0.4 }, colorActive: 1,
      skeletonPoint: { x: 0.51, y: 0.41 }, plateColorPoint: { x: 0.49, y: 0.4 },
    });
    expect(out.agreement).toBe(1);
  });

  it('신호가 서로 멀면 일치도가 낮아진다', () => {
    const out = fuseTrackingCandidates({
      colorPoint: { x: 0.5, y: 0.4 }, colorActive: 1,
      skeletonPoint: { x: 0.9, y: 0.9 }, plateColorPoint: { x: 0.1, y: 0.1 },
    });
    expect(out.agreement).toBe(0);
  });

  it('색 추적이 소실되면 남은 신호의 가중평균으로 대체(fallback)한다', () => {
    const out = fuseTrackingCandidates({
      colorPoint: null, colorActive: 0,
      skeletonPoint: { x: 0.6, y: 0.5 }, plateColorPoint: { x: 0.4, y: 0.5 },
    });
    expect(out.usedFallback).toBe(true);
    expect(out.source).toBe('fused_fallback');
    expect(out.point.y).toBeCloseTo(0.5, 5);
    // plate weight(0.65) > skeleton(0.45) → plate 쪽으로 치우침
    expect(out.point.x).toBeLessThan(0.5);
  });

  it('후보가 하나도 없으면 point=null, source=none', () => {
    const out = fuseTrackingCandidates({ colorPoint: null, colorActive: 0, skeletonPoint: null, plateColorPoint: null });
    expect(out.point).toBeNull();
    expect(out.source).toBe('none');
  });

  it('교차검증 요약 — 보완비율/평균일치도 집계', () => {
    const s = summarizeCrossValidation([
      { source: 'color', agreement: 1, usedFallback: false },
      { source: 'color', agreement: 0.5, usedFallback: false },
      { source: 'fused_fallback', agreement: 0, usedFallback: true },
      { source: 'skeleton', agreement: null, usedFallback: true },
    ]);
    expect(s.totalFrames).toBe(4);
    expect(s.fallbackFrames).toBe(2);
    expect(s.assistRatio).toBe(0.5);
    expect(s.avgAgreement).toBeCloseTo(0.5, 5); // (1+0.5+0)/3
  });
});

// ── COG 자동 인식(요구사항 3) ──
function makeSidePose() {
  // 오른쪽이 카메라 쪽으로 잘 보이는 측면 자세(대략 수직 정렬).
  const lms = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const put = (i, x, y) => { lms[i] = { x, y, z: 0, visibility: 0.95 }; };
  put(LM.NOSE, 0.5, 0.1);
  put(LM.RIGHT_EAR, 0.5, 0.1);
  put(LM.RIGHT_SHOULDER, 0.5, 0.28);
  put(LM.RIGHT_ELBOW, 0.5, 0.42);
  put(LM.RIGHT_WRIST, 0.5, 0.55);
  put(LM.RIGHT_HIP, 0.5, 0.55);
  put(LM.RIGHT_KNEE, 0.5, 0.75);
  put(LM.RIGHT_ANKLE, 0.5, 0.95);
  put(LM.RIGHT_HEEL, 0.48, 0.96);
  put(LM.RIGHT_FOOT, 0.55, 0.97);
  return lms;
}

describe('bodyCog — 측면 전신 무게중심', () => {
  it('측면(side)에서 COG를 산출한다', () => {
    const cog = estimateBodyCOG(makeSidePose(), 'side');
    expect(cog.available).toBe(true);
    expect(cog.point).toBeTruthy();
    expect(cog.point.y).toBeGreaterThan(0.1);
    expect(cog.point.y).toBeLessThan(0.95);
    expect(cog.segmentCoverage).toBeGreaterThanOrEqual(0.55);
  });

  it('정면(front)에서는 정직성 원칙상 COG를 거부한다', () => {
    const cog = estimateBodyCOG(makeSidePose(), 'front');
    expect(cog.available).toBe(false);
    expect(cog.reason).toBe('not_side_view');
  });

  it('핵심 랜드마크가 부족하면 거부한다', () => {
    const sparse = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
    const cog = estimateBodyCOG(sparse, 'side');
    expect(cog.available).toBe(false);
  });

  it('바-COG 수평 이격은 절대 수평거리', () => {
    expect(barCogHorizontalGap({ x: 0.6, y: 0.4 }, { x: 0.5, y: 0.4 })).toBeCloseTo(0.1, 5);
    expect(barCogHorizontalGap(null, { x: 0.5, y: 0.4 })).toBeNull();
  });
});

// ── 신뢰도에 교차검증 반영 ──
describe('vbtConfidence — 교차검증 감점', () => {
  it('신호 일치도가 낮으면 감점 + 사유코드', () => {
    const base = vbtConfidence({ isCalibrated: true, source: 'upload' });
    const low = vbtConfidence({ isCalibrated: true, source: 'upload', crossValidation: { avgAgreement: 0.1, assistRatio: 0 } });
    expect(low.score).toBeLessThan(base.score);
    expect(low.reasons).toContain('low_track_agreement');
  });

  it('대체 추적 과다면 감점 + 사유코드', () => {
    const hi = vbtConfidence({ isCalibrated: true, source: 'upload', crossValidation: { avgAgreement: 0.9, assistRatio: 0.6 } });
    expect(hi.reasons).toContain('high_fallback_tracking');
  });
});

// ── 원판 색 연속 추적기 시드 ──
describe('createPlateBlobTracker', () => {
  it('유효 태그로만 시드된다', () => {
    const t = createPlateBlobTracker();
    expect(t.isSeeded()).toBe(false);
    expect(t.seed('bogus', 0.5, 0.5)).toBe(false);
    expect(t.seed('red', 0.5, 0.5)).toBe(true);
    expect(t.isSeeded()).toBe(true);
    expect(t.tag()).toBe('red');
  });
});

// ── 배선(오버레이 겹침·COG·융합) 정적 확인 ──
describe('LiftingMeasure/Hub 배선', () => {
  const lifting = readFileSync(new URL('../ai-measure/menus/LiftingMeasure.jsx', import.meta.url), 'utf8');
  const hub = readFileSync(new URL('../ai-measure/menus/BarbellLiftingHub.jsx', import.meta.url), 'utf8');
  const stage = readFileSync(new URL('../ai-measure/menus/CameraStage.jsx', import.meta.url), 'utf8');

  it('LiftingMeasure가 융합·COG·교차검증을 사용한다', () => {
    expect(lifting).toContain('fuseTrackingCandidates');
    expect(lifting).toContain('estimateBodyCOG');
    expect(lifting).toContain('summarizeCrossValidation');
    expect(lifting).toContain('createPlateBlobTracker');
  });

  it('CameraStage가 topOffset 오버레이 겹침 보정을 지원한다', () => {
    expect(stage).toContain('topOffset');
    expect(stage).toContain('topPad');
  });

  it('Hub가 오버레이 높이를 측정해 topOffset으로 내려준다', () => {
    expect(hub).toContain('hubBarRef');
    expect(hub).toContain('ResizeObserver');
    expect(hub).toContain('topOffset={camTopOffset}');
  });
});
