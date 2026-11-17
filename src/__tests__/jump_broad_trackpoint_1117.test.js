// [2026-11-17] 멀리뛰기 측정 부위 선택·바닥 마크 보정, 스프린트 추적 부위 선택.
import { describe, it, expect } from 'vitest';
import { measurePointX, broadJumpDistanceCm, feetCenterX, MEASURE_POINTS } from '../ai-measure/core/jumpBiomechanics';
import { trackPointCenter, TRACK_POINTS } from '../ai-measure/core/sprintAgility';

const lm = (() => {
  const a = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 1 }));
  a[11] = { x: 0.40, y: 0.3, visibility: 1 }; a[12] = { x: 0.44, y: 0.3, visibility: 1 };
  a[23] = { x: 0.41, y: 0.5, visibility: 1 }; a[24] = { x: 0.45, y: 0.5, visibility: 1 };
  a[27] = { x: 0.40, y: 0.9, visibility: 1 }; a[28] = { x: 0.44, y: 0.9, visibility: 1 };
  a[29] = { x: 0.38, y: 0.9, visibility: 1 }; a[30] = { x: 0.42, y: 0.9, visibility: 1 };
  a[31] = { x: 0.46, y: 0.92, visibility: 1 }; a[32] = { x: 0.50, y: 0.92, visibility: 1 };
  return a;
})();

describe('멀리뛰기 측정 부위', () => {
  it('feet(기본)는 기존 feetCenterX 와 같다', () => {
    expect(measurePointX(lm, 'feet')).toBe(feetCenterX(lm));
    expect(measurePointX(lm)).toBe(feetCenterX(lm));
  });
  it('부위별 x 평균', () => {
    expect(measurePointX(lm, 'heel')).toBeCloseTo(0.40, 5);
    expect(measurePointX(lm, 'toe')).toBeCloseTo(0.48, 5);
    expect(measurePointX(lm, 'hip')).toBeCloseTo(0.43, 5);
    expect(measurePointX(lm, 'shoulder')).toBeCloseTo(0.42, 5);
    expect(Object.keys(MEASURE_POINTS)).toEqual(['feet', 'heel', 'toe', 'hip', 'shoulder']);
  });
  it('좌우 중 보이는 쪽만 쓴다', () => {
    const l2 = lm.map((p) => ({ ...p }));
    l2[29].visibility = 0;
    expect(measurePointX(l2, 'heel')).toBeCloseTo(0.42, 5);
  });
});

describe('바닥 마크 보정', () => {
  it('floorCmPerX 가 있으면 키 환산 없이 실측 스케일로 계산한다', () => {
    // 마크 간격이 화면 가로의 0.5 = 100cm → X 1.0 = 200cm. 이동 0.25 → 50cm
    expect(broadJumpDistanceCm(0.6, 0.35, null, 1, 200)).toBe(50);
    expect(broadJumpDistanceCm(0.6, 0.35, 170, 1.78, 200)).toBe(50);
  });
  it('보정값이 없으면 기존 키 환산 그대로', () => {
    expect(broadJumpDistanceCm(0.6, 0.35, 100, 2)).toBe(50);
    expect(broadJumpDistanceCm(0.6, 0.35, null)).toBeNull();
  });
});

describe('스프린트 추적 부위', () => {
  it('hip/shoulder/trunk 중심', () => {
    expect(trackPointCenter(lm, 'hip').x).toBeCloseTo(0.43, 5);
    expect(trackPointCenter(lm, 'shoulder').y).toBeCloseTo(0.3, 5);
    expect(trackPointCenter(lm, 'trunk').y).toBeCloseTo(0.4, 5);
    expect(Object.keys(TRACK_POINTS)).toEqual(['hip', 'shoulder', 'trunk']);
  });
  it('안 보이는 랜드마크가 있으면 null', () => {
    const l2 = lm.map((p) => ({ ...p })); l2[11].visibility = 0;
    expect(trackPointCenter(l2, 'shoulder')).toBeNull();
  });
});
