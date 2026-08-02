// landmark_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 근본 원인: 카메라 원본 영상이 회전된 채로 들어오는 기종(키오스크
//  등)에서 usePoseEngine이 그 원본 프레임에 그대로 포즈 인식을 돌려, 반환되는
//  랜드마크의 x/y 축이 실제 좌우/상하와 어긋난 채로 각 모듈에 전달되고 있었다.
//  drawVideoCover/coverTransform은 "화면에 그릴 때"만 보정할 뿐 판정 계산에
//  들어가는 랜드마크 좌표 자체는 그대로였다 — 그래서 목 기울기가 88° 같은
//  값으로 나오는 등(수직↔수평이 뒤바뀐 전형적 증상) 여러 리포트의 판정
//  수치가 잘못 나왔다. rotateLandmarksNormalized()가 판정 직전에 좌표계를
//  통일해 이를 근본적으로 막는다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { rotateLandmarksNormalized, coverTransform } from '../ai-measure/core/recordAspect';

describe('rotateLandmarksNormalized', () => {
  it('rotationDeg=0이면 좌표를 전혀 바꾸지 않는다(회귀 방지 — 기존 회전 불필요 기기는 그대로)', () => {
    const lm = [{ x: 0.3, y: 0.7, z: 0.1, visibility: 0.9 }];
    const result = rotateLandmarksNormalized(lm, 0);
    expect(result[0].x).toBe(0.3);
    expect(result[0].y).toBe(0.7);
  });

  it('배열이 아니거나 landmarks가 없으면 그대로 반환한다', () => {
    expect(rotateLandmarksNormalized(null, 90)).toBeNull();
    expect(rotateLandmarksNormalized(undefined, 90)).toBeUndefined();
  });

  it('x/y가 유효하지 않은 포인트는 건드리지 않고 그대로 통과시킨다', () => {
    const lm = [null, { x: NaN, y: 0.5 }, { visibility: 0.9 }];
    const result = rotateLandmarksNormalized(lm, 90);
    expect(result[0]).toBeNull();
    expect(result[1].x).toBeNaN();
    expect(result[2].x).toBeUndefined();
  });

  it('z와 visibility 등 나머지 필드는 그대로 보존한다', () => {
    const lm = [{ x: 0.2, y: 0.4, z: -0.15, visibility: 0.87 }];
    const result = rotateLandmarksNormalized(lm, 90);
    expect(result[0].z).toBe(-0.15);
    expect(result[0].visibility).toBe(0.87);
  });

  it.each([0, 90, 180, 270])(
    'rot=%i: 정사각(크롭 없음) 조건에서 coverTransform과 동일한 결과를 낸다(기존 신뢰된 로직과 교차검증)',
    (rot) => {
      const fakeVideo = { videoWidth: 100, videoHeight: 100 };
      const W = 100, H = 100;
      const cover = coverTransform(fakeVideo, W, H, rot);
      const points = [{ x: 0.9, y: 0.5 }, { x: 0.1, y: 0.2 }, { x: 0, y: 0 }, { x: 1, y: 1 }];
      const rotated = rotateLandmarksNormalized(points, rot);
      points.forEach((p, i) => {
        expect(rotated[i].x).toBeCloseTo(cover.X(p) / W, 9);
        expect(rotated[i].y).toBeCloseTo(cover.Y(p) / H, 9);
      });
    },
  );

  it('90도 보정: 목 기울기 계산에서 "수직 기준" 축이 실제로 바로잡히는지 확인(버그 재현 시나리오)', () => {
    // 카메라가 90도 돌아간 상태에서, 실제로는 어깨 바로 위에 귀가 있는(정상) 사람의
    // 원본(raw) 좌표는 x축 방향으로 나란히 찍힌다(세로가 raw 프레임의 가로로 들어오므로).
    const rawShoulder = { x: 0.5, y: 0.5 };
    const rawEar = { x: 0.35, y: 0.5 }; // raw 프레임에서 귀가 어깨와 같은 y, x만 다름
    const [corrEar, corrShoulder] = rotateLandmarksNormalized([rawEar, rawShoulder], 90);
    // 보정 후에는 "같은 x(좌우), 다른 y(상하)"가 되어야 정상적인 '귀가 어깨 위' 형태다.
    expect(Math.abs(corrEar.x - corrShoulder.x)).toBeLessThan(1e-9);
    expect(corrEar.y).not.toBeCloseTo(corrShoulder.y, 5);
  });
});
