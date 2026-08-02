// gait_running_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 보행
//  판정(보폭·관절각·좌우뷰 판별·카메라 각도·세이프존)이 원본 좌표를 그대로
//  쓰던 문제 수정. loop()가 requestAnimationFrame 재귀호출 단일 클로저라
//  rotationDegRef(ref)로 최신값을 참조해야 회전 버튼이 즉시 반영된다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/GaitRunningAnalysis.jsx'),
  'utf8',
);

describe('GaitRunningAnalysis.jsx — 카메라 회전 보정 배선', () => {
  it('rotateLandmarksNormalized를 recordAspect에서 가져온다', () => {
    expect(src).toMatch(/import \{ rotateLandmarksNormalized \} from '\.\.\/core\/recordAspect'/);
  });

  it('rotationDegRef로 최신 회전값을 참조한다(loop 재귀 클로저의 stale 값 방지)', () => {
    expect(src).toMatch(/const rotationDegRef = useRef\(0\);/);
    expect(src).toMatch(/useEffect\(\(\) => \{ rotationDegRef\.current = rotationDeg; \}, \[rotationDeg\]\);/);
  });

  it('라이브 오버레이(drawSkeleton)는 원본 landmarks를 그대로 쓴다(이중 회전 방지)', () => {
    expect(src).toMatch(/drawSkeleton\(skeletonCanvasRef\.current, video, landmarks, isReadyRef\.current\)/);
  });

  it('판정 경로(트래커·관절각·방향판별·카메라각도·세이프존)는 corrected를 쓴다', () => {
    const start = src.indexOf('const corrected = landmarks ?');
    const end = src.indexOf("} else if (viewRef.current !== 'recording')", start);
    const body = src.slice(start, end);
    expect(body).toMatch(/rotateLandmarksNormalized\(landmarks, rotationDegRef\.current\)/);
    expect(body).toMatch(/pelvisRelativeFeet\(corrected\)/);
    expect(body).toMatch(/jointAnglesFromPose\(corrected\)/);
    expect(body).toMatch(/detectOrientation\(corrected, orientationRef\.current\)/);
    expect(body).toMatch(/cameraAngleQuality\(corrected\)/);
    expect(body).toMatch(/isInSafeZone\(corrected\)/);
  });
});
