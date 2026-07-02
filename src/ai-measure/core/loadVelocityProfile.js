import { normalizeExerciseType } from './lifting';

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

export const DEFAULT_MIN_VELOCITY_THRESHOLDS = Object.freeze({
  squat: 0.30,
  deadlift: 0.20,
  bench_press: 0.15,
  snatch: 0.80,
  clean: 0.70,
  clean_jerk: 0.70,
});

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function minVelocityThresholdForExercise(exerciseType) {
  const key = normalizeExerciseType(exerciseType);
  return DEFAULT_MIN_VELOCITY_THRESHOLDS[key] ?? null;
}

export function buildLoadVelocityPoint(input = {}) {
  const loadKg = finiteNumber(input.loadKg ?? input.weight ?? input.metadata?.weight);
  const meanVelocity = finiteNumber(
    input.meanVelocity
      ?? input.velocity
      ?? input.metrics?.meanVelocity
      ?? input.repVelocity?.summary?.averageMeanVelocity
      ?? input.repVelocity?.summary?.bestMeanVelocity
      ?? input.metadata?.repVelocity?.summary?.averageMeanVelocity
      ?? input.metadata?.repVelocity?.summary?.bestMeanVelocity
  );
  if (loadKg == null || loadKg <= 0 || meanVelocity == null || meanVelocity <= 0) return null;

  const exerciseType = normalizeExerciseType(input.exerciseType);
  return {
    exerciseType,
    loadKg: r1(loadKg),
    meanVelocity: r2(meanVelocity),
    source: input.source || 'measurement',
    reps: finiteNumber(input.reps ?? input.metadata?.reps),
    recordedAt: input.recordedAt || new Date().toISOString(),
  };
}

export function cleanLoadVelocityPoints(points, exerciseType) {
  const wanted = exerciseType ? normalizeExerciseType(exerciseType) : null;
  return (Array.isArray(points) ? points : [])
    .map(p => buildLoadVelocityPoint(p))
    .filter(Boolean)
    .filter(p => !wanted || p.exerciseType === wanted)
    .sort((a, b) => a.loadKg - b.loadKg);
}

export function fitLoadVelocityProfile(points, opts = {}) {
  const clean = cleanLoadVelocityPoints(points, opts.exerciseType);
  if (clean.length < 2) {
    return { valid: false, reason: 'not_enough_points', points: clean };
  }

  const loadRangeKg = clean[clean.length - 1].loadKg - clean[0].loadKg;
  const velocities = clean.map(p => p.meanVelocity);
  const velocityRange = Math.max(...velocities) - Math.min(...velocities);
  if (loadRangeKg <= 0 || velocityRange <= 0) {
    return { valid: false, reason: 'no_range', points: clean };
  }

  const n = clean.length;
  const meanX = clean.reduce((sum, p) => sum + p.loadKg, 0) / n;
  const meanY = clean.reduce((sum, p) => sum + p.meanVelocity, 0) / n;
  const sxx = clean.reduce((sum, p) => sum + ((p.loadKg - meanX) ** 2), 0);
  const sxy = clean.reduce((sum, p) => sum + ((p.loadKg - meanX) * (p.meanVelocity - meanY)), 0);
  if (sxx <= 0) return { valid: false, reason: 'no_load_variation', points: clean };

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const residuals = clean.map(p => p.meanVelocity - (intercept + slope * p.loadKg));
  const ssRes = residuals.reduce((sum, e) => sum + e ** 2, 0);
  const ssTot = clean.reduce((sum, p) => sum + ((p.meanVelocity - meanY) ** 2), 0);
  const rSquared = ssTot > 0 ? Math.max(0, Math.min(1, 1 - (ssRes / ssTot))) : 1;
  const rmse = Math.sqrt(ssRes / n);

  return {
    valid: slope < 0,
    reason: slope < 0 ? 'ok' : 'non_negative_slope',
    points: clean,
    n,
    slope: r4(slope),
    intercept: r4(intercept),
    rSquared: r2(rSquared),
    rmse: r4(rmse),
    loadRangeKg: r1(loadRangeKg),
    velocityRange: r2(velocityRange),
  };
}

export function estimateOneRmFromVelocityProfile(points, opts = {}) {
  const exerciseType = normalizeExerciseType(opts.exerciseType);
  const mvt = finiteNumber(opts.minVelocityThreshold ?? opts.mvt)
    ?? minVelocityThresholdForExercise(exerciseType);
  if (mvt == null || mvt <= 0) {
    return { estimateKg: null, reason: 'no_min_velocity_threshold', mvt: null, profile: null };
  }

  const profile = fitLoadVelocityProfile(points, { exerciseType });
  if (!profile.valid) {
    return { estimateKg: null, reason: profile.reason, mvt: r2(mvt), profile };
  }

  const estimate = (mvt - profile.intercept) / profile.slope;
  const heaviest = Math.max(...profile.points.map(p => p.loadKg));
  if (!Number.isFinite(estimate) || estimate <= 0) {
    return { estimateKg: null, reason: 'invalid_estimate', mvt: r2(mvt), profile };
  }
  if (estimate < heaviest * 0.95) {
    return { estimateKg: null, reason: 'below_observed_loads', mvt: r2(mvt), profile };
  }

  const score = Math.max(0.35, Math.min(0.95,
    0.35
    + Math.min(0.25, (profile.n - 2) * 0.08)
    + Math.min(0.25, profile.rSquared * 0.25)
    + Math.min(0.10, profile.loadRangeKg / 200)
  ));

  return {
    estimateKg: r1(estimate),
    reason: 'ok',
    mvt: r2(mvt),
    confidenceScore: r2(score),
    profile,
  };
}
