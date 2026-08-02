// rom_measure_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 ROM
//  리포트의 측정 캡처 사진이 옆으로 눕고, 판정에 쓰이는 각도 계산도 원본
//  좌표를 그대로 쓰던 문제 수정. 라이브 스켈레톤 오버레이는 CameraStage와
//  같은 CSS 회전 래퍼를 공유하므로 원본(raw) 좌표를 그대로 써야 하고,
//  그 외(누적 판정·라이브 각도·캡처 사진)는 회전 보정된 좌표를 써야 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/RomMeasure.jsx'),
  'utf8',
);

describe('RomMeasure.jsx — 카메라 회전 보정 배선', () => {
  it('rotateLandmarksNormalized를 recordAspect에서 가져온다', () => {
    expect(src).toMatch(/rotateLandmarksNormalized/);
    expect(src).toMatch(/from '\.\.\/core\/recordAspect'/);
  });

  it('handlePose 안에서 라이브 오버레이(drawSkeleton)는 원본 smoothed를 그대로 쓴다(이중 회전 방지)', () => {
    const start = src.indexOf('const handlePose = useCallback');
    const drawCallIdx = src.indexOf('drawSkeleton(canvasRef.current', start);
    expect(drawCallIdx).toBeGreaterThan(start);
    expect(src.slice(drawCallIdx, drawCallIdx + 90)).toMatch(/drawSkeleton\(canvasRef\.current, video, smoothed,/);
  });

  it('handlePose 안에서 누적 판정·라이브 각도는 corrected를 쓴다', () => {
    const start = src.indexOf('const handlePose = useCallback');
    const end = src.indexOf('}, [joint, poseMode, side, rotationDeg]', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const corrected = rotateLandmarksNormalized\(smoothed, rotationDeg\);/);
    expect(body).toMatch(/accRef\.current\.push\(corrected, tMs\)/);
    expect(body).toMatch(/normalizePose\(corrected\)/);
  });

  it('handlePose의 dependency 배열에 rotationDeg가 포함돼 최신값을 참조한다', () => {
    expect(src).toMatch(/\}, \[joint, poseMode, side, rotationDeg\]\);/);
  });

  it('captureVideoSnapshot이 rotationDeg를 받아 drawVideoCover로 사진을 그린다', () => {
    const start = src.indexOf('function captureVideoSnapshot(');
    const end = src.indexOf('\n}', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/function captureVideoSnapshot\(video, rotationDeg = 0\)/);
    expect(body).toMatch(/const swapped = rotationDeg === 90 \|\| rotationDeg === 270;/);
    expect(body).toMatch(/drawVideoCover\(ctx, video, canvas\.width, canvas\.height, rotationDeg\)/);
  });

  it('캡처 호출부가 rotationDeg를 함께 넘긴다', () => {
    expect(src).toMatch(/captureVideoSnapshot\(latestVideoRef\.current, rotationDeg\)/);
  });
});
