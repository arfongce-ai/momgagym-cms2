import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyPixel, suggestSidePlates } from '../ai-measure/core/plates.js';
import { LM } from '../ai-measure/core/geometry.js';
import { estimateSideCog, fuseBarbellPoint } from '../ai-measure/core/barbell.js';

const trackerSource = readFileSync(new URL('../ai-measure/core/endcapTracker.js', import.meta.url), 'utf8');
const platesSource = readFileSync(new URL('../ai-measure/core/plates.js', import.meta.url), 'utf8');
const barbellSource = readFileSync(new URL('../ai-measure/core/barbell.js', import.meta.url), 'utf8');
const overlaySource = readFileSync(new URL('../ai-measure/core/recordingOverlay.js', import.meta.url), 'utf8');
const hubSource = readFileSync(new URL('../ai-measure/menus/BarbellLiftingHub.jsx', import.meta.url), 'utf8');
const liftingSource = readFileSync(new URL('../ai-measure/menus/LiftingMeasure.jsx', import.meta.url), 'utf8');
const vbtSource = readFileSync(new URL('../ai-measure/menus/VbtMeasure.jsx', import.meta.url), 'utf8');
const oneRmSource = readFileSync(new URL('../ai-measure/menus/OneRMEstimate.jsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../styles/index.css', import.meta.url), 'utf8');

const lm = (x, y, visibility = 0.95) => ({ x, y, visibility });

describe('barbell tracking robustness', () => {
  it('uses relaxed color matching, edge weighting, and slow target adaptation', () => {
    expect(trackerSource).toContain('RELAXED_COLOR_TOL');
    expect(trackerSource).toContain('edgeStrength');
    expect(trackerSource).toContain('spatialWt');
    expect(trackerSource).toContain('blendTargetColor');
  });

  it('fuses plate/endcap tracking with skeleton fallback only when the tracker is active', () => {
    expect(fuseBarbellPoint({ x: 0.50, y: 0.40 }, { x: 0.54, y: 0.42 })).toMatchObject({
      source: 'fused',
    });
    expect(fuseBarbellPoint(null, { x: 0.54, y: 0.42 })).toMatchObject({
      x: 0.54,
      y: 0.42,
      source: 'pose',
    });

    [liftingSource, vbtSource, oneRmSource].forEach(source => {
      expect(source).toContain('const act = cap.activeCount()');
      expect(source).toContain('fuseBarbellPoint(act > 0 ? tracked : null, poseBar)');
    });
  });

  it('estimates side-view COG from skeleton landmarks and draws it in live/record overlays', () => {
    const lms = [];
    lms[LM.NOSE] = lm(0.50, 0.12);
    lms[LM.LEFT_EAR] = lm(0.49, 0.13);
    lms[LM.RIGHT_EAR] = lm(0.51, 0.13);
    lms[LM.LEFT_SHOULDER] = lm(0.50, 0.24);
    lms[LM.RIGHT_SHOULDER] = lm(0.53, 0.25);
    lms[LM.LEFT_HIP] = lm(0.49, 0.48);
    lms[LM.RIGHT_HIP] = lm(0.52, 0.49);
    lms[LM.LEFT_KNEE] = lm(0.48, 0.68);
    lms[LM.RIGHT_KNEE] = lm(0.51, 0.69);
    lms[LM.LEFT_ANKLE] = lm(0.47, 0.88);
    lms[LM.RIGHT_ANKLE] = lm(0.50, 0.89);
    lms[LM.LEFT_HEEL] = lm(0.46, 0.91);
    lms[LM.RIGHT_HEEL] = lm(0.50, 0.91);
    lms[LM.LEFT_FOOT] = lm(0.48, 0.92);
    lms[LM.RIGHT_FOOT] = lm(0.52, 0.92);
    lms[LM.LEFT_ELBOW] = lm(0.50, 0.34);
    lms[LM.RIGHT_ELBOW] = lm(0.53, 0.35);
    lms[LM.LEFT_WRIST] = lm(0.50, 0.41);
    lms[LM.RIGHT_WRIST] = lm(0.53, 0.42);

    const cog = estimateSideCog(lms);
    expect(cog).toMatchObject({ sideView: true });
    expect(cog.confidence).toBeGreaterThan(0.75);
    expect(cog.x).toBeGreaterThan(0.47);
    expect(cog.x).toBeLessThan(0.53);
    expect(cog.supportX).toBeGreaterThan(0.47);
    expect(cog.supportX).toBeLessThan(0.51);

    expect(barbellSource).toContain('estimateSideCog');
    expect(overlaySource).toContain('drawCogOverlay');
    [liftingSource, vbtSource, oneRmSource].forEach(source => {
      expect(source).toContain('drawCogOverlay(ctx, cw, ch, cog)');
      expect(source).toContain('drawCogOverlay(ctx, canvas.width, canvas.height, cogRef.current');
    });
  });

  it('keeps parent hub overlays out of the live camera viewport', () => {
    expect(hubSource).toContain('cameraOverlayActive');
    expect(hubSource).toContain('!cameraOverlayActive && <div');
    expect(hubSource).toContain('onCameraActiveChange={setCameraOverlayActive}');
    expect(liftingSource).toContain("onCameraActiveChange?.(status !== 'idle')");
    expect(vbtSource).toContain("onCameraActiveChange?.(status !== 'idle')");
    expect(oneRmSource).toContain("onCameraActiveChange?.(status !== 'idle')");
    expect(cssSource).toMatch(/\.cam-stage\s*\{[\s\S]*z-index:\s*120;/);
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
