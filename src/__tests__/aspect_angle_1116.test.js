import { describe, it, expect, afterEach } from 'vitest';
import { jointAngleDeg, tiltAngleDeg, symmetryTilt, setFrameAspect, getFrameAspect } from '../ai-measure/core/geometry';
import { angleDeg } from '../ai-measure/core/postureMath';
import { pelvicTiltDegOf } from '../ai-measure/core/squatBiomechanicsTracker';

// 실제 45° 기울기: 픽셀 dx=dy. 정규화하면 dx_n = dx/W, dy_n = dy/H.
const norm = (px, py, W, H) => ({ x: px / W, y: py / H });
afterEach(() => setFrameAspect(1, 1));

describe('가로세로비 보정', () => {
  it('기본은 보정 없음', () => {
    expect(getFrameAspect()).toBe(1);
    expect(tiltAngleDeg({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 1);
  });
  it('16:9 가로에서 실제 45° 선이 45°로 나온다', () => {
    setFrameAspect(1280, 720);
    const a = norm(100, 100, 1280, 720), b = norm(300, 300, 1280, 720);
    expect(tiltAngleDeg(a, b)).toBeCloseTo(45, 1);
    expect(symmetryTilt(a, b).deg).toBeCloseTo(45, 1);
  });
  it('폰 세로 9:16 에서도 45° 로 나온다', () => {
    setFrameAspect(720, 1280);
    const a = norm(100, 100, 720, 1280), b = norm(300, 300, 720, 1280);
    expect(tiltAngleDeg(a, b)).toBeCloseTo(45, 1);
  });
  it('관절 내각: 실제 90° 가 가로 영상에서도 90°', () => {
    setFrameAspect(1280, 720);
    const a = norm(500, 300, 1280, 720), b = norm(500, 500, 1280, 720), c = norm(700, 500, 1280, 720);
    expect(jointAngleDeg(a, b, c)).toBeCloseTo(90, 1);
    expect(angleDeg(a, b, c, false)).toBeCloseTo(90, 1);
    setFrameAspect(1, 1);
    expect(jointAngleDeg(a, b, c)).toBeCloseTo(90, 1); // 직각은 원래도 축 정렬이라 같다
  });
  it('스쿼트 골반 기울기도 보정된다', () => {
    setFrameAspect(1280, 720);
    const lm = []; lm[23] = norm(500, 400, 1280, 720); lm[24] = norm(700, 600, 1280, 720);
    expect(pelvicTiltDegOf(lm)).toBeCloseTo(45, 0);
  });
});
