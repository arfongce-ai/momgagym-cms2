import { describe, it, expect } from 'vitest';
import { barTiltDeg, summarizeBarTilt } from '../ai-measure/core/barbell';
import { LM } from '../ai-measure/core/geometry';

const lms = (l, r) => { const a = Array(33).fill(null); a[LM.LEFT_WRIST] = { ...l, visibility: 1 }; a[LM.RIGHT_WRIST] = { ...r, visibility: 1 }; return a; };

describe('바 기울기', () => {
  it('수평이면 0°', () => {
    expect(barTiltDeg(lms({ x: 0.6, y: 0.3 }, { x: 0.4, y: 0.3 }))).toBeCloseTo(0, 5);
    expect(barTiltDeg(lms({ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }))).toBeCloseTo(0, 5);
  });
  it('높이 차가 있으면 각도로 환산(0.2 폭에 0.2 차이=45°)', () => {
    expect(Math.abs(barTiltDeg(lms({ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.5 })))).toBeCloseTo(45, 5);
    expect(Math.abs(barTiltDeg(lms({ x: 0.6, y: 0.3 }, { x: 0.4, y: 0.5 })))).toBeCloseTo(45, 5);
  });
  it('손목이 하나라도 안 보이면 null', () => {
    const a = lms({ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.5 }); a[LM.RIGHT_WRIST].visibility = 0.1;
    expect(barTiltDeg(a)).toBeNull();
    expect(barTiltDeg(null)).toBeNull();
  });
  it('요약: 표본 5개 미만이면 null, 아니면 평균·최대', () => {
    expect(summarizeBarTilt([1, 2])).toBeNull();
    const s = summarizeBarTilt([1, -2, 3, -4, 5]);
    expect(s.maxAbsDeg).toBe(5);
    expect(s.meanAbsDeg).toBe(3);
    expect(s.samples).toBe(5);
  });
});
