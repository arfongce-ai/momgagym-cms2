import { describe, expect, it } from 'vitest';
import {
  POSE_LANDMARKS as LM,
  analyzePostureFromLandmarks,
  asymmetryIndex,
  calculateCenterOfGravity,
  calculatePostureScore,
  mapScoreToBodyAge,
} from '../ai-measure/core/postureMath';
import { normalizeLandmarksForOverlay } from '../ai-measure/menus/PostureReport.jsx';

function makePose(overrides = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  Object.assign(pose[LM.NOSE], { x: 0.5, y: 0.08 });
  Object.assign(pose[LM.LEFT_EAR], { x: 0.47, y: 0.1 });
  Object.assign(pose[LM.RIGHT_EAR], { x: 0.53, y: 0.1 });
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.42, y: 0.25, z: 0 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.58, y: 0.25, z: 0 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.43, y: 0.52, z: 0 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.57, y: 0.52, z: 0 });
  Object.assign(pose[LM.LEFT_KNEE], { x: 0.44, y: 0.71, z: 0 });
  Object.assign(pose[LM.RIGHT_KNEE], { x: 0.56, y: 0.71, z: 0 });
  Object.assign(pose[LM.LEFT_ANKLE], { x: 0.43, y: 0.92, z: 0 });
  Object.assign(pose[LM.RIGHT_ANKLE], { x: 0.57, y: 0.92, z: 0 });
  Object.assign(pose[LM.LEFT_HEEL], { x: 0.42, y: 0.94, z: 0 });
  Object.assign(pose[LM.RIGHT_HEEL], { x: 0.58, y: 0.94, z: 0 });
  Object.assign(pose[LM.LEFT_FOOT_INDEX], { x: 0.41, y: 0.96, z: 0 });
  Object.assign(pose[LM.RIGHT_FOOT_INDEX], { x: 0.59, y: 0.96, z: 0 });

  for (const [index, value] of Object.entries(overrides)) {
    Object.assign(pose[Number(index)], value);
  }
  return pose;
}

describe('postureMath', () => {
  it('calculates ASI as absolute percentage difference', () => {
    expect(asymmetryIndex(90, 100)).toBe(10.5);
    expect(asymmetryIndex(0, 0)).toBe(0);
  });

  it('calculates CoG offset against the base of support', () => {
    const pose = makePose({
      [LM.LEFT_SHOULDER]: { x: 0.46 },
      [LM.RIGHT_SHOULDER]: { x: 0.62 },
      [LM.LEFT_HIP]: { x: 0.47 },
      [LM.RIGHT_HIP]: { x: 0.61 },
    });
    const cog = calculateCenterOfGravity(pose);
    expect(cog.available).toBe(true);
    expect(cog.direction).toBe('right');
    expect(cog.offsetPct).toBeGreaterThan(0);
  });

  it('treats CoG offsets within +/-5% as normal balance', () => {
    const pose = makePose({
      [LM.LEFT_SHOULDER]: { x: 0.422 },
      [LM.RIGHT_SHOULDER]: { x: 0.582 },
      [LM.LEFT_HIP]: { x: 0.432 },
      [LM.RIGHT_HIP]: { x: 0.572 },
    });
    const cog = calculateCenterOfGravity(pose);
    expect(Math.abs(cog.offsetPct)).toBeLessThanOrEqual(5);
    expect(cog.balanceOffsetPct).toBe(0);
    expect(cog.direction).toBe('center');
    expect(cog.status).toBe('normal');
  });

  it('maps high scores to younger body age and low scores to older body age', () => {
    expect(mapScoreToBodyAge(92, 40)).toBeLessThan(40);
    expect(mapScoreToBodyAge(48, 40)).toBeGreaterThan(40);
  });

  it('penalizes risk findings and large CoG offset in posture score', () => {
    const good = calculatePostureScore({
      deviationsMm: { head: 4, shoulder: 3, pelvis: 2 },
      asi: 3,
      ruleFindings: [],
      cog: { available: true, offsetPct: 4 },
    });
    const risky = calculatePostureScore({
      deviationsMm: { head: 45, shoulder: 34, pelvis: 28 },
      asi: 18,
      ruleFindings: [{ status: 'risk' }],
      cog: { available: true, offsetPct: 42 },
    });
    expect(good.score).toBeGreaterThan(risky.score);
    expect(risky.score).toBeLessThan(70);
  });

  it('clamps posture score to the 0..100 range', () => {
    const overWeighted = calculatePostureScore({
      deviationsMm: { head: 0, shoulder: 0 },
      asi: 0,
      ruleFindings: [],
      cog: { available: true, balanceOffsetPct: 0 },
      weights: { deviation: 1, asymmetry: 1, rules: 1, cog: 1 },
    });
    const extremeRisk = calculatePostureScore({
      deviationsMm: { head: 500, shoulder: 400, pelvis: 350 },
      asi: 100,
      ruleFindings: [{ status: 'risk' }, { status: 'risk' }, { status: 'risk' }, { status: 'risk' }],
      cog: { available: true, balanceOffsetPct: 100 },
    });
    expect(overWeighted.score).toBe(100);
    expect(extremeRisk.score).toBe(0);
  });

  it('normalizes ghosting landmarks by mid-hip alignment and torso scale', () => {
    const current = makePose();
    const previous = makePose({
      [LM.LEFT_SHOULDER]: { x: 0.30, y: 0.10 },
      [LM.RIGHT_SHOULDER]: { x: 0.50, y: 0.10 },
      [LM.LEFT_HIP]: { x: 0.30, y: 0.40 },
      [LM.RIGHT_HIP]: { x: 0.50, y: 0.40 },
      [LM.LEFT_KNEE]: { x: 0.31, y: 0.60 },
      [LM.RIGHT_KNEE]: { x: 0.49, y: 0.60 },
    });
    const normalized = normalizeLandmarksForOverlay(previous, current);
    const hipMidX = (normalized[LM.LEFT_HIP].x + normalized[LM.RIGHT_HIP].x) / 2;
    const hipMidY = (normalized[LM.LEFT_HIP].y + normalized[LM.RIGHT_HIP].y) / 2;
    const currentHipMidX = (current[LM.LEFT_HIP].x + current[LM.RIGHT_HIP].x) / 2;
    const currentHipMidY = (current[LM.LEFT_HIP].y + current[LM.RIGHT_HIP].y) / 2;

    expect(hipMidX).toBeCloseTo(currentHipMidX, 5);
    expect(hipMidY).toBeCloseTo(currentHipMidY, 5);
  });

  it('returns a complete posture assessment from BlazePose landmarks', () => {
    const analysis = analyzePostureFromLandmarks(makePose(), { heightCm: 175, actualAge: 35 });
    expect(analysis.score).toBeGreaterThan(0);
    expect(analysis.bodyAge).toBeGreaterThan(0);
    expect(analysis.cog.available).toBe(true);
    expect(analysis.asymmetry.jointAsi).toHaveProperty('knee');
  });
});
