import { describe, expect, it } from 'vitest';
import {
  buildLoadVelocityPoint,
  estimateOneRmFromVelocityProfile,
  fitLoadVelocityProfile,
  minVelocityThresholdForExercise,
} from '../ai-measure/core/loadVelocityProfile.js';

describe('load-velocity profile', () => {
  it('normalizes a measurement into a profile point', () => {
    const point = buildLoadVelocityPoint({
      exerciseType: 'bench_press',
      weight: 80,
      repVelocity: { summary: { averageMeanVelocity: 0.52 } },
      reps: 3,
      source: 'upload',
      recordedAt: '2026-07-02T00:00:00.000Z',
    });

    expect(point).toMatchObject({
      exerciseType: 'bench_press',
      loadKg: 80,
      meanVelocity: 0.52,
      reps: 3,
      source: 'upload',
    });
  });

  it('fits a negative load-velocity slope and estimates 1RM at the exercise threshold', () => {
    const points = [
      { exerciseType: 'squat', loadKg: 80, meanVelocity: 0.70 },
      { exerciseType: 'squat', loadKg: 100, meanVelocity: 0.55 },
      { exerciseType: 'squat', loadKg: 120, meanVelocity: 0.40 },
    ];

    const profile = fitLoadVelocityProfile(points, { exerciseType: 'squat' });
    expect(profile.valid).toBe(true);
    expect(profile.slope).toBeLessThan(0);
    expect(profile.rSquared).toBeCloseTo(1);

    const estimate = estimateOneRmFromVelocityProfile(points, { exerciseType: 'squat' });
    expect(minVelocityThresholdForExercise('squat')).toBe(0.3);
    expect(estimate.reason).toBe('ok');
    expect(estimate.estimateKg).toBeGreaterThan(120);
  });

  it('rejects profiles where speed does not drop as load increases', () => {
    const estimate = estimateOneRmFromVelocityProfile([
      { exerciseType: 'bench_press', loadKg: 60, meanVelocity: 0.40 },
      { exerciseType: 'bench_press', loadKg: 80, meanVelocity: 0.45 },
    ], { exerciseType: 'bench_press' });

    expect(estimate.estimateKg).toBeNull();
    expect(estimate.reason).toBe('non_negative_slope');
  });
});
