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

  it('VBT/1RM은 스켈레톤(손목 중점) 기반 자동 렙 인식 — 추적선·오버레이 없음(RSI 방식)', () => {
    // 사용자가 추적점을 탭해서 만드는 색 추적선은 현장에서 바벨을 놓치는 문제가
    // 확인되어 제거됐다. 바 위치는 barbellPoint(양 손목 중점)로 항상 자동 산출되고,
    // 화면에는 어떤 추적 오버레이도 그리지 않는다.
    for (const src of [vbtSource, oneRmSource]) {
      expect(src).toContain('barbellPoint(lms)');
      expect(src).not.toContain('fuseTrackingCandidates');
      expect(src).not.toContain('cap.update(');           // 탭 색 추적 사용 금지
      expect(src).not.toContain('drawBarPathToRecord');   // 녹화 영상에도 궤적선 없음
    }
    // 원판 색 인식(무게 자동 제안)은 유지하되, ROI 박스 오버레이는 그리지 않는다.
    for (const src of [vbtSource, oneRmSource]) {
      expect(src).toContain('detectPlatesFromVideo');
      expect(src).not.toContain("fillText('원판 색 인식'");
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
