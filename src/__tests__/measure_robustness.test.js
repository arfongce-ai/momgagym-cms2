// 측정 분석 함수들의 경계/안전성 — 나쁜 데이터에 크래시하지 않고 안전하게 처리.
// 측정 정직성: 이상 입력은 거부/보류하되 예외로 앱을 죽이지 않는다.
import { describe, it, expect } from 'vitest';
import { analyzePostureFromLandmarks, detectPostureView, sanitizeBackLandmarks } from '../ai-measure/core/postureMath';
import { analyzeAxialRotation } from '../ai-measure/core/postureRotation';
import { buildClinicalInterpretation } from '../ai-measure/core/postureClinical';

describe('측정 함수 경계/안전성', () => {
  it('빈 배열/null 입력에 크래시 안 남', () => {
    expect(() => analyzePostureFromLandmarks([], {})).not.toThrow();
    expect(() => analyzePostureFromLandmarks(null, {})).not.toThrow();
    expect(detectPostureView(null).view).toBe('unknown');
    expect(() => analyzeAxialRotation({})).not.toThrow();
    expect(analyzeAxialRotation({}).available).toBe(false);
    expect(() => buildClinicalInterpretation({ perViewAnalysis: {}, bodyInfo: {} })).not.toThrow();
  });

  it('일부 랜드마크 누락(visibility 0)에도 안전', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
    expect(() => analyzePostureFromLandmarks(lm, { heightCm: 170 })).not.toThrow();
  });

  it('NaN 좌표 방어', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: NaN, y: NaN, z: NaN, visibility: 0.9 }));
    expect(() => analyzePostureFromLandmarks(lm, {})).not.toThrow();
  });

  it('sanitizeBackLandmarks가 원본 불변(순수 함수)', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    const out = sanitizeBackLandmarks(lm);
    expect(lm[0].visibility).toBe(0.9); // 원본 보존
    expect(out[0].visibility).toBe(0);  // 사본만 코·눈 제거
    expect(out[7].visibility).toBe(0.9); // 귀는 유지
  });
});
