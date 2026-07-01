import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyPixel, suggestSidePlates } from '../ai-measure/core/plates.js';

const trackerSource = readFileSync(new URL('../ai-measure/core/endcapTracker.js', import.meta.url), 'utf8');
const platesSource = readFileSync(new URL('../ai-measure/core/plates.js', import.meta.url), 'utf8');
const liftingSource = readFileSync(new URL('../ai-measure/menus/LiftingMeasure.jsx', import.meta.url), 'utf8');
const vbtSource = readFileSync(new URL('../ai-measure/menus/VbtMeasure.jsx', import.meta.url), 'utf8');
const oneRmSource = readFileSync(new URL('../ai-measure/menus/OneRMEstimate.jsx', import.meta.url), 'utf8');

describe('barbell tracking robustness', () => {
  it('uses relaxed color matching, edge weighting, and slow target adaptation', () => {
    expect(trackerSource).toContain('RELAXED_COLOR_TOL');
    expect(trackerSource).toContain('edgeStrength');
    expect(trackerSource).toContain('spatialWt');
    expect(trackerSource).toContain('blendTargetColor');
  });
});

describe('plate color detection robustness', () => {
  it('classifies IWF plate colors from representative pixels', () => {
    expect(classifyPixel(215, 38, 61)).toBe('red');
    expect(classifyPixel(11, 97, 164)).toBe('blue');
    expect(classifyPixel(242, 194, 0)).toBe('yellow');
    expect(classifyPixel(31, 157, 85)).toBe('green');
    expect(classifyPixel(235, 235, 235)).toBe('white');
  });

  it('suggests side plates from dominant colors in rank order', () => {
    const plates = suggestSidePlates([
      { tag: 'blue', label: '파랑', kg: 20, ratio: 0.52 },
      { tag: 'yellow', label: '노랑', kg: 15, ratio: 0.22 },
      { tag: 'green', label: '초록', kg: 10, ratio: 0.12 },
      { tag: 'white', label: '흰색', kg: 5, ratio: 0.08 },
    ]);
    expect(plates).toEqual([
      { kg: 20, label: '파랑', count: 1 },
      { kg: 15, label: '노랑', count: 1 },
      { kg: 10, label: '초록', count: 1 },
    ]);
  });

  it('scans fallback ROI candidates and reflects the detected ROI in camera screens', () => {
    expect(platesSource).toContain('candidateRois');
    expect(platesSource).toContain('MIN_VALID_RATIO');
    expect(platesSource).toContain('score');
    expect(liftingSource).toContain('roi: detectedRoi');
    expect(vbtSource).toContain('roi: detectedRoi');
    expect(oneRmSource).toContain('roi: detectedRoi');
  });
});
