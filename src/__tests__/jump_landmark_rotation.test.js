// jump_landmark_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 점프
//  높이(수직 변위 기반) 판정이 원본 좌표를 그대로 쓰던 문제 수정 — 회전
//  보정 없이는 수직 변위 대신 완전히 다른 축(예: 좌우 흔들림)을 재게 된다.
//  캘리브레이션·플라이트 트래킹·생체역학 누적·방향 판별 전부 회전 보정된
//  좌표(corrected)를 쓰고, 라이브 스켈레톤 오버레이만 원본(raw)을 유지한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('JumpPrecisionAnalysis.jsx — 카메라 회전 보정 배선', () => {
  it('rotateLandmarksNormalized를 recordAspect에서 가져온다', () => {
    expect(src).toMatch(/import \{ rotateLandmarksNormalized \} from '\.\.\/core\/recordAspect'/);
  });

  it('라이브 오버레이(drawSkeleton/drawBaseline)는 원본 landmarks를 그대로 쓴다(이중 회전 방지)', () => {
    expect(src).toMatch(/drawSkeleton\(skeletonCanvasRef\.current, video, landmarks, ph\)/);
  });

  it('corrected는 기존 rotationDegRef(스테일 클로저 방지용)로 계산한다', () => {
    expect(src).toMatch(/const corrected = landmarks \? rotateLandmarksNormalized\(landmarks, rotationDegRef\.current\) : null;/);
  });

  it('캘리브레이션·트래커·생체역학·방향판별이 전부 corrected를 쓴다', () => {
    const start = src.indexOf('const corrected = landmarks ?');
    const end = src.indexOf("} else if (viewRef.current === 'camera')", start);
    const body = src.slice(start, end);
    expect(body).toMatch(/calib\.push\(corrected, ts\)/);
    expect(body).toMatch(/tracker\.push\(corrected, ts\)/);
    expect(body).toMatch(/biomechAccRef\.current\?\.push\(corrected, ts, jp, justTookOff\)/);
    expect(body).toMatch(/orientRef\.current\.push\(corrected\)/);
    // 원본 landmarks가 판정 쪽에 실수로 남아있지 않은지도 함께 확인.
    expect(body).not.toMatch(/calib\.push\(landmarks,/);
    expect(body).not.toMatch(/tracker\.push\(landmarks,/);
  });
});
