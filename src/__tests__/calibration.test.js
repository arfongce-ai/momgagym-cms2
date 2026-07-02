import { describe, expect, it } from 'vitest';
import {
  buildReferenceScale,
  resolveDistanceScale,
  ratioToCm,
  serializeDistanceScale,
} from '../ai-measure/core/calibration.js';

describe('barbell distance calibration', () => {
  it('builds a cm-per-screen-ratio scale from a known reference object', () => {
    const scale = buildReferenceScale([{ x: 0, y: 0 }, { x: 0, y: 0.45 }], 45);
    expect(scale.cmPerRatio).toBeCloseTo(100);
    expect(ratioToCm(0.32, scale.cmPerRatio)).toBe(32);
  });

  it('prefers reference calibration over body-height fallback', () => {
    const referenceScale = buildReferenceScale([{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }], 30);
    const resolved = resolveDistanceScale({
      referenceScale,
      personHeightRatio: 0.5,
      heightCm: 180,
    });

    expect(resolved.source).toBe('reference');
    expect(resolved.cmPerRatio).toBeCloseTo(100);
    expect(resolved.isCalibrated).toBe(true);
  });

  it('falls back to body-height scale and serializes safely', () => {
    const resolved = resolveDistanceScale({ personHeightRatio: 0.85, heightCm: 170 });
    expect(resolved.source).toBe('body_height');
    expect(resolved.cmPerRatio).toBeCloseTo(200);

    const serialized = serializeDistanceScale(resolved);
    expect(serialized).toMatchObject({ source: 'body_height', isCalibrated: true });
    expect(serialized.cmPerRatio).toBe(200);
  });
});
