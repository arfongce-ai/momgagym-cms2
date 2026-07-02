import { describe, expect, it } from 'vitest';
import { buildLiftingPayload } from '../ai-measure/core/lifting.js';
import { estimate1RM } from '../ai-measure/core/strength.js';

describe('1RM formula spread stats', () => {
  it('returns spread and a reference interval alongside the average estimate', () => {
    const result = estimate1RM(100, 5);

    expect(result.average).toBeGreaterThan(100);
    expect(result.stats.count).toBeGreaterThan(1);
    expect(result.stats.spreadKg).toBeGreaterThan(0);
    expect(result.confidenceInterval.low).toBeLessThanOrEqual(result.average);
    expect(result.confidenceInterval.high).toBeGreaterThanOrEqual(result.average);
  });

  it('keeps direct 1RM attempts as a zero-spread estimate', () => {
    const result = estimate1RM(120, 1);

    expect(result.average).toBe(120);
    expect(result.stats.spreadKg).toBe(0);
    expect(result.confidenceInterval.low).toBe(120);
    expect(result.confidenceInterval.high).toBe(120);
  });

  it('preserves velocity loss in the unified lifting payload metrics', () => {
    const payload = buildLiftingPayload({
      mode: 'vbt',
      exerciseType: 'squat',
      source: 'upload',
      metrics: { meanVelocity: 0.55, velocityLoss: 18.4 },
    });

    expect(payload.metrics.velocityLoss).toBe(18.4);
  });
});
