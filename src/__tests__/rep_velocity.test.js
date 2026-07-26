import { describe, expect, it } from 'vitest';
import { buildRepVelocityMetrics, segmentBarPath } from '../ai-measure/core/repVelocity.js';

const TWO_REP_PATH = [
  { x: 0.5, y: 0.80, ts: 0 },
  { x: 0.5, y: 0.50, ts: 500 },
  { x: 0.5, y: 0.72, ts: 800 },
  { x: 0.5, y: 0.47, ts: 1300 },
  { x: 0.5, y: 0.74, ts: 1600 },
];

describe('rep velocity metrics', () => {
  it('segments a bar path into up/down phases', () => {
    const segments = segmentBarPath(TWO_REP_PATH, { minTravelRatio: 0.05 });
    expect(segments.map(s => s.direction)).toEqual(['up', 'down', 'up', 'down']);
  });

  it('computes per-rep mean velocity and velocity loss from concentric reps', () => {
    const metrics = buildRepVelocityMetrics(TWO_REP_PATH, {
      minTravelRatio: 0.05,
      cmPerRatio: 100,
      source: 'upload',
      fps: 240,
    });

    expect(metrics.summary.repCount).toBe(2);
    expect(metrics.reps[0].meanVelocity).toBeCloseTo(0.6);
    expect(metrics.reps[1].meanVelocity).toBeCloseTo(0.5);
    expect(metrics.summary.velocityLossPct).toBeCloseTo(16.7);
  });
});
