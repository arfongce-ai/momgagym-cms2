import { describe, expect, it } from 'vitest';
import {
  POSE_LANDMARKS as LM,
  analyzePostureFromLandmarks,
  analyzeFrontalAlignment,
  analyzeSagittalAlignment,
  asymmetryIndex,
  calculateCenterOfGravity,
  calculatePostureScore,
  classifyPostureAgeGroup,
  getReliableLandmarks,
  isPelvisDataReliable,
  mapScoreToBodyAge,
  medianLandmarks,
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

  it('filters unreliable landmarks and reports pelvis reliability', () => {
    const pose = makePose({ [LM.LEFT_HIP]: { visibility: 0.2 } });
    const reliable = getReliableLandmarks(pose, 0.75);
    expect(reliable[LM.LEFT_HIP].isValid).toBe(false);
    expect(reliable[LM.LEFT_HIP].x).toBeNull();
    expect(isPelvisDataReliable(pose)).toBe(false);
  });

  it('classifies age groups for posture screening rules', () => {
    expect(classifyPostureAgeGroup(5)).toBe('under_7_screening_limited');
    expect(classifyPostureAgeGroup(12)).toBe('youth_growth');
    expect(classifyPostureAgeGroup(35)).toBe('adult');
  });

  it('returns trainer-facing frontal and sagittal posture metrics', () => {
    const pose = makePose({
      [LM.LEFT_HIP]: { y: 0.50 },
      [LM.RIGHT_HIP]: { y: 0.53 },
      [LM.LEFT_EAR]: { x: 0.50 },
      [LM.RIGHT_EAR]: { x: 0.54 },
      [LM.LEFT_SHOULDER]: { x: 0.42 },
      [LM.RIGHT_SHOULDER]: { x: 0.58 },
    });
    const frontal = analyzeFrontalAlignment(pose, { heightCm: 175 });
    const sagittal = analyzeSagittalAlignment(pose, { heightCm: 175 });
    expect(Math.abs(frontal.pelvisHeightDiffMm)).toBeGreaterThan(0);
    expect(sagittal.forwardHeadMm).toBeGreaterThan(0);
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

describe('medianLandmarks (capture-time jitter rejection)', () => {
  const frame = (vals) =>
    Array.from({ length: 33 }, (_, i) => ({
      x: vals.x ?? 0.5,
      y: vals.y ?? 0.5,
      z: 0,
      visibility: 0.9,
      _i: i,
    }));

  it('returns null for empty input', () => {
    expect(medianLandmarks([])).toBe(null);
    expect(medianLandmarks(null)).toBe(null);
  });

  it('returns the single frame unchanged when only one is given', () => {
    const f = frame({ x: 0.4 });
    expect(medianLandmarks([f])).toBe(f);
  });

  it('takes per-coordinate median across frames', () => {
    const frames = [frame({ x: 0.40 }), frame({ x: 0.50 }), frame({ x: 0.60 })];
    const out = medianLandmarks(frames);
    expect(out[LM.LEFT_HIP].x).toBeCloseTo(0.50, 5);
  });

  it('rejects a single-frame outlier (median not pulled by the spike)', () => {
    // 4 frames near 0.50, one wild spike at 0.99 → median stays ~0.50, not the mean
    const frames = [
      frame({ x: 0.50 }),
      frame({ x: 0.51 }),
      frame({ x: 0.49 }),
      frame({ x: 0.50 }),
      frame({ x: 0.99 }), // 순간 오검출(튐)
    ];
    const out = medianLandmarks(frames);
    expect(out[LM.LEFT_SHOULDER].x).toBeCloseTo(0.50, 2);
    // 평균(≈0.598)과는 분명히 다름 → 이상치에 끌려가지 않음
    expect(out[LM.LEFT_SHOULDER].x).toBeLessThan(0.6);
  });

  it('combines only frames where a landmark is present', () => {
    const f1 = frame({ x: 0.40 });
    const f2 = frame({ x: 0.60 });
    const f3 = frame({ x: 0.50 });
    f2[LM.NOSE] = null; // 한 프레임에서 코가 안 잡힘
    const out = medianLandmarks([f1, f2, f3]);
    // 코는 잡힌 두 프레임(0.40, 0.50)만으로 중앙값 → 0.45
    expect(out[LM.NOSE].x).toBeCloseTo(0.45, 5);
  });

  it('produces a usable pose for analysis (no crash, valid score)', () => {
    const frames = [makePose(), makePose(), makePose()];
    const combined = medianLandmarks(frames);
    const analysis = analyzePostureFromLandmarks(combined, { heightCm: 175, actualAge: 35 });
    expect(analysis.score).toBeGreaterThan(0);
  });
});
