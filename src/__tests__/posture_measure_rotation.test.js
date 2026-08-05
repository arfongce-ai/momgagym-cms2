// posture_measure_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 자세·체형
//  리포트의 사진이 옆으로 눕고, 목 기울기가 88° 같은 값으로 나오는 등 판정
//  수치 자체가 잘못되던 문제 수정. 라이브 스켈레톤 오버레이(canvasRef)는
//  CameraStage와 같은 CSS 회전 래퍼를 공유하므로 원본(raw) 좌표를 그대로 써야
//  하고, 그 외(뷰 판정·캡처·분석)는 회전 보정된 좌표를 써야 한다 — 이 둘이
//  섞이면 안 되므로 소스 레벨로 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/PostureMeasure.jsx'),
  'utf8',
);

describe('PostureMeasure.jsx — 카메라 회전 보정 배선', () => {
  it('useCameraRotation과 rotateLandmarksNormalized를 가져와 쓴다', () => {
    expect(src).toMatch(/import \{ useCameraRotation \} from '\.\.\/core\/useCameraRotation'/);
    expect(src).toMatch(/rotateLandmarksNormalized/);
  });

  it('handlePose 안에서 라이브 오버레이(drawSkeleton)는 원본 smoothed를 그대로 쓴다(이중 회전 방지)', () => {
    const start = src.indexOf('const handlePose = useCallback');
    const drawCallIdx = src.indexOf('drawSkeleton(canvasRef.current', start);
    expect(drawCallIdx).toBeGreaterThan(start);
    const drawCallLine = src.slice(drawCallIdx, drawCallIdx + 80);
    expect(drawCallLine).toMatch(/drawSkeleton\(canvasRef\.current, video, smoothed,/);
  });

  it('handlePose 안에서 판정 관련 경로(버퍼 누적·뷰 판정)는 corrected를 쓴다', () => {
    const start = src.indexOf('const handlePose = useCallback');
    const end = src.indexOf('if (autoBusyRef.current) return', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const corrected = smoothed \? rotateLandmarksNormalized\(smoothed, rotationDegRef\.current\) : null;/);
    expect(body).toMatch(/buf\.push\(\{ landmarks: corrected, ts \}\)/);
    expect(body).toMatch(/detectPostureView\(corrected\)/);
  });

  it('captureVideoSnapshot이 rotationDeg를 받아 drawVideoCover로 사진을 그린다(캔버스 크기도 회전 시 가로/세로 반전)', () => {
    const start = src.indexOf('function captureVideoSnapshot(');
    const end = src.indexOf('\n}', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/function captureVideoSnapshot\(video, rotationDeg = 0\)/);
    expect(body).toMatch(/const swapped = rotationDeg === 90 \|\| rotationDeg === 270;/);
    expect(body).toMatch(/drawVideoCover\(ctx, video, canvas\.width, canvas\.height, rotationDeg\)/);
  });

  it('캡처 호출부가 rotationDegRef.current를 함께 넘긴다', () => {
    expect(src).toMatch(/captureVideoSnapshot\(latestVideoRef\.current, rotationDegRef\.current\)/);
  });
});
