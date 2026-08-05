// slst_squat_landmark_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크)에서 SLST·
//  스쿼트 판정(기준선·유지시간·균형상실·골반기울기·체간기울기·무릎각도)이
//  원본 좌표를 그대로 쓰던 문제 수정. 녹화 합성 루프는 latestLandmarksRef의
//  원본(raw) 값을 coverTransform(rotationDeg)에 직접 넘겨 자체적으로 회전
//  보정하므로 그 값은 건드리지 않고, 판정(calib.push/tracker.push)에만
//  회전 보정된 좌표를 쓴다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const files = [
  ['src/ai-measure/menus/StanceLiveAnalysis.jsx', 'calib.push(corrected)', 'tracker.push(corrected, ts)'],
  ['src/ai-measure/menus/SquatLiveAnalysis.jsx', 'calib.push(corrected)', 'tracker.push(corrected, ts)'],
];

describe.each(files)('%s — 카메라 회전 보정 배선', (path, calibPushExpr, trackerPushExpr) => {
  const src = readFileSync(join(process.cwd(), path), 'utf8');

  it('rotateLandmarksNormalized를 recordAspect에서 가져온다', () => {
    expect(src).toMatch(/rotateLandmarksNormalized/);
  });

  it('rotationDeg 선언이 handleResult보다 앞에 있고 정확히 한 번만 있다', () => {
    const matches = src.match(/const \[rotationDeg\] = useCameraRotation\(\);/g) || [];
    expect(matches.length).toBe(1);
    const rotIdx = src.indexOf('const [rotationDeg] = useCameraRotation();');
    const handleIdx = src.indexOf('const handleResult = useCallback');
    expect(rotIdx).toBeLessThan(handleIdx);
  });

  it('latestLandmarksRef는 원본(raw) landmarks를 그대로 보관한다(녹화 합성이 자체 회전 보정)', () => {
    expect(src).toMatch(/latestLandmarksRef\.current = landmarks;/);
  });

  it('라이브 스켈레톤 오버레이(drawSkeleton)는 원본 landmarks를 그대로 쓴다(이중 회전 방지)', () => {
    expect(src).toMatch(/drawSkeleton\(canvasRef\.current, video, landmarks, calib\.locked/);
  });

  it('캘리브레이션·트래커 판정은 corrected(회전 보정)를 쓴다', () => {
    expect(src).toMatch(/const corrected = rotateLandmarksNormalized\(landmarks, rotationDeg\);/);
    expect(src).toContain(calibPushExpr);
    expect(src).toContain(trackerPushExpr);
    // 원본 landmarks가 판정 쪽에 실수로 남아있지 않은지 확인.
    expect(src).not.toMatch(/calib\.push\(landmarks\)/);
    expect(src).not.toMatch(/tracker\.push\(landmarks, ts\)/);
  });

  it('handleResult의 dependency 배열에 rotationDeg가 포함된다', () => {
    expect(src).toMatch(/rotationDeg\]\);\s*\n\s*const \{ videoRef/);
  });
});
