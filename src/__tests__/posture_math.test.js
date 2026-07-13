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
  recomputeBodyAgeIfStale,
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

  it('[회귀] 측면(발목 거의 겹침)에서는 CoG를 계산하지 않고 available:false', () => {
    const pose = makePose({
      [LM.LEFT_SHOULDER]: { x: 0.50 },
      [LM.RIGHT_SHOULDER]: { x: 0.505 },
      [LM.LEFT_ANKLE]: { x: 0.50 },
      [LM.RIGHT_ANKLE]: { x: 0.503 },
    });
    const cog = calculateCenterOfGravity(pose);
    expect(cog.available).toBe(false);
    expect(cog.offsetPct).toBeUndefined();
  });

  it('[회귀] 정상 정면 자세에서는 CoG가 정상 계산된다(가드 오작동 없음)', () => {
    const cog = calculateCenterOfGravity(makePose());
    expect(cog.available).toBe(true);
    expect(Math.abs(cog.offsetPct)).toBeLessThanOrEqual(120);
  });

  it('maps high scores to younger body age and low scores to older body age', () => {
    expect(mapScoreToBodyAge(92, 40)).toBeLessThan(40);
    expect(mapScoreToBodyAge(48, 40)).toBeGreaterThan(40);
  });

  // [회귀] 이전엔 delta가 계단식 + 별도 선형 fineTune 구조라, 점수가 45/60/70/80/90
  // 경계를 살짝(0.01점) 넘을 때마다 체형나이가 4~6세씩 튀는 불연속이 있었다.
  // 구간별 선형보간으로 교체해 경계 부근에서 매끄럽게 이어지는지 검증한다.
  it('점수 경계(45/60/70/80/90)를 0.01점 차이로 넘어도 체형나이가 크게 튀지 않는다', () => {
    for (const b of [45, 60, 70, 80, 90]) {
      const below = mapScoreToBodyAge(b - 0.01, 30);
      const at = mapScoreToBodyAge(b, 30);
      // 0.01점 차이의 결과이므로 반올림 오차 수준(최대 1세)만 허용 — 수정 전엔 4~6세였다.
      expect(Math.abs(at - below)).toBeLessThanOrEqual(1);
    }
  });

  it('점수가 높을수록 체형나이는 단조 감소(혹은 동일)한다 — 역전 없음', () => {
    const scores = Array.from({ length: 41 }, (_, i) => i * 2.5); // 0,2.5,...,100
    const ages = scores.map((s) => mapScoreToBodyAge(s, 30));
    for (let i = 1; i < ages.length; i++) {
      expect(ages[i]).toBeLessThanOrEqual(ages[i - 1]);
    }
  });

  it('기존 보정 기준값(0/45/60/70/80/90/100점, 실제나이 30세)은 그대로 유지된다', () => {
    expect(mapScoreToBodyAge(0, 30)).toBe(Math.round(30 + 26.5));
    expect(mapScoreToBodyAge(45, 30)).toBe(Math.round(30 + 13.75));
    expect(mapScoreToBodyAge(60, 30)).toBe(Math.round(30 + 6.5));
    expect(mapScoreToBodyAge(70, 30)).toBe(30);
    expect(mapScoreToBodyAge(80, 30)).toBe(Math.round(30 - 5.5));
    expect(mapScoreToBodyAge(90, 30)).toBe(Math.round(30 - 11));
    expect(mapScoreToBodyAge(100, 30)).toBe(Math.round(30 - 12.5));
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

// ── 체형나이 소급 보정 도구용 순수 헬퍼 ────────────────────────────
describe('recomputeBodyAgeIfStale — 소급 보정 대상 판정', () => {
  it('저장된 bodyAge가 옛 공식 값이면 needsUpdate=true와 새 값을 반환한다', () => {
    // 79.99점 실제나이 30세는 예전 공식으로 59세(계단식 불연속)가 저장돼 있었다고 가정.
    const staleAnalysis = { score: 79.99, bodyAge: 59 };
    const { needsUpdate, newBodyAge } = recomputeBodyAgeIfStale(staleAnalysis, 30);
    expect(needsUpdate).toBe(true);
    expect(newBodyAge).toBe(mapScoreToBodyAge(79.99, 30));
    expect(newBodyAge).not.toBe(59);
  });

  it('이미 새 공식대로 저장된 값이면 needsUpdate=false다(중복 보정 방지)', () => {
    const correctAge = mapScoreToBodyAge(79.99, 30);
    const analysis = { score: 79.99, bodyAge: correctAge };
    expect(recomputeBodyAgeIfStale(analysis, 30).needsUpdate).toBe(false);
  });

  it('score나 actualAge가 없으면 안전하게 needsUpdate=false를 반환한다', () => {
    expect(recomputeBodyAgeIfStale(null, 30).needsUpdate).toBe(false);
    expect(recomputeBodyAgeIfStale({ score: null, bodyAge: 40 }, 30).needsUpdate).toBe(false);
    expect(recomputeBodyAgeIfStale({ score: 80, bodyAge: 40 }, null).needsUpdate).toBe(false);
  });
});
