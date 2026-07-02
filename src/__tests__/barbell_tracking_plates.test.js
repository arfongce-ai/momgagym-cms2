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

  it('anchors color tracking to the original tapped color so it cannot drift onto the floor/background', () => {
    // 실제 촬영 영상에서 관찰된 버그: target 색이 매 프레임 서서히 적응(blendTargetColor)
    // 하기만 하고 원래 탭한 색으로 되돌아갈 기준이 없으면, 몇 프레임 만에 바닥/배경의
    // 비슷한 색으로 "걸어가 버려" 궤적선이 바벨과 완전히 동떨어진 곳에 그려진다.
    // origColor(고정 앵커) + ANCHOR_TOL 하드 상한으로 이 무한 드리프트를 막는다.
    expect(trackerSource).toContain('ANCHOR_TOL');
    expect(trackerSource).toContain('origColor');
    expect(trackerSource).toMatch(/anchorRef/);
  });

  it('applies multi-signal fusion (color/skeleton/plate) + COG cross-validation to VBT, matching lifting mode', () => {
    // VBT는 1렙 단위 속도 측정이라 추적 손실에 더 민감하므로, 역도 모드와 동일한
    // 다중 신호 융합·COG 교차검증이 반드시 적용돼야 한다(측정 정직성·신뢰성 일관화).
    for (const src of [liftingSource, vbtSource]) {
      expect(src).toContain('fuseTrackingCandidates');
      expect(src).toContain('summarizeCrossValidation');
      expect(src).toContain('estimateBodyCOG');
      expect(src).toContain('barCogHorizontalGap');
      expect(src).toContain('createPlateBlobTracker');
      expect(src).toContain('crossValidation: result.crossValidation');
      expect(src).toContain('cogGap: result.cogGap');
    }
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
