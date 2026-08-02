// squat_angle_overlay_wiring.test.js
// ════════════════════════════════════════════════════════════════════════
//  drawSkeleton에 view(정면/측면)를 넘겨야 각도 라벨이 올바르게 그려진다.
//  실시간 화면 호출부와 녹화 합성 호출부 둘 다 빠짐없이 넘기는지 확인한다
//  (녹화 쪽만 빠뜨리면 "라이브에는 보이는데 저장 영상엔 안 보이는" 회귀가 생김).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/SquatLiveAnalysis.jsx'),
  'utf8',
);

describe('SquatLiveAnalysis.jsx — 관절 각도 라벨이 라이브·녹화 양쪽에 다 연결돼 있다', () => {
  it('drawSkeleton 함수 시그니처에 view 파라미터가 있다', () => {
    // [2026-08-02] 녹화 저장본에 스켈레톤만 나오던 버그 수정으로 clearFirst
    // 파라미터가 뒤에 추가됐다 — view 파라미터는 그대로 유지되는지만 본다.
    expect(src).toMatch(/function drawSkeleton\(canvas, video, landmarks, locked, mapper, view, clearFirst = true\)/);
  });

  it('locked 상태에서만(측정 중에만) 각도 라벨을 그린다', () => {
    expect(src).toMatch(/if \(locked\) drawJointAngleLabels\(ctx, landmarks, view, X, Y\);/);
  });

  it('실시간(라이브) 호출부가 view를 넘긴다', () => {
    expect(src).toMatch(/drawSkeleton\(canvasRef\.current, video, landmarks, calib\.locked, null, view\);/);
  });

  it('녹화 합성 호출부도 view(viewRef.current)를 넘긴다', () => {
    const idx = src.indexOf('drawSkeleton(canvas, video, latestLandmarksRef.current');
    expect(idx).toBeGreaterThan(-1);
    const line = src.slice(idx, src.indexOf(';', idx));
    expect(line).toMatch(/viewRef\.current/);
  });

  it('computeDisplayAngles와 골반기울기·무릎외반 함수를 import한다', () => {
    expect(src).toMatch(/import \{ computeDisplayAngles \} from '..\/core\/squatJointAngles';/);
    expect(src).toMatch(/pelvicTiltDegOf, kneeValgusDegOf/);
  });
});
