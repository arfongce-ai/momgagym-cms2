// record_trajectory_toggle.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-16] '일반 영상 녹화' 손·발 궤적(잔상) ON/OFF 기능 회귀 테스트.
//  요구사항: 스켈레톤 on/off와는 완전히 별도의 토글로, 손목(15/16)·
//  발목(27/28)의 최근 위치만 잔상처럼 남기고(전체 누적 아님), 미리보기뿐
//  아니라 녹화·저장되는 영상에도 그대로 구워진다(baked-in).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isTrajectoryEnabled,
  setTrajectoryEnabled,
  subscribeTrajectory,
} from '../ai-measure/core/trajectoryPref';
import { isSkeletonEnabled, setSkeletonEnabled } from '../ai-measure/core/skeletonPref';

function read(rel) {
  return readFileSync(join(process.cwd(), 'src', rel), 'utf8');
}

describe('trajectoryPref — 궤적 on/off 전역 설정', () => {
  beforeEach(() => setTrajectoryEnabled(false));

  it('기본값은 OFF다(스켈레톤과 달리 신규 오버레이라 opt-in)', () => {
    expect(isTrajectoryEnabled()).toBe(false);
  });

  it('set/get/subscribe가 동작한다', () => {
    let notified = null;
    const off = subscribeTrajectory((v) => { notified = v; });
    setTrajectoryEnabled(true);
    expect(isTrajectoryEnabled()).toBe(true);
    expect(notified).toBe(true);
    off();
    setTrajectoryEnabled(false);
    // 해제 후에는 더 이상 통지되지 않음
    expect(notified).toBe(true);
  });

  it('스켈레톤 설정과 완전히 독립적이다(한쪽을 꺼도 다른 쪽은 그대로)', () => {
    setSkeletonEnabled(true);
    setTrajectoryEnabled(true);
    expect(isSkeletonEnabled()).toBe(true);
    expect(isTrajectoryEnabled()).toBe(true);
    setSkeletonEnabled(false);
    expect(isTrajectoryEnabled()).toBe(true); // 궤적은 영향 안 받음
    setSkeletonEnabled(true); // 다른 테스트를 위해 원복
  });
});

describe('TrajectoryToggleChip — 손·발 궤적 토글 칩', () => {
  it('전역 훅을 쓰고 "궤적" 라벨을 보여준다', () => {
    const chip = read('ai-measure/menus/TrajectoryToggleChip.jsx');
    expect(chip).toMatch(/useTrajectoryOverlay/);
    expect(chip).toMatch(/궤적/);
  });
});

describe('RecordMeasure.jsx — 손·발 궤적(잔상) 통합', () => {
  const rec = read('ai-measure/menus/RecordMeasure.jsx');

  it('궤적 토글 칩을 스켈레톤 토글과 나란히 렌더한다', () => {
    expect(rec).toMatch(/<SkeletonToggleChip \/>/);
    expect(rec).toMatch(/<TrajectoryToggleChip \/>/);
  });

  it('궤적 on/off는 스켈레톤과 별도의 ref/훅을 쓴다(토글이 독립적)', () => {
    expect(rec).toMatch(/const trajectoryOnRef = useRef\(isTrajectoryEnabled\(\)\);/);
    expect(rec).toMatch(/const \[trajectoryOn\] = useTrajectoryOverlay\(\);/);
  });

  it('손목(15,16)·발목(27,28)을 궤적 추적 대상으로 쓴다', () => {
    expect(rec).toMatch(/const TRAIL_POINTS = \{ leftHand: 15, rightHand: 16, leftFoot: 27, rightFoot: 28 \};/);
  });

  it('궤적은 전체 누적이 아니라 최근 구간만 남기고(TRAIL_MAX_AGE_MS), 오래된 점을 제거한다', () => {
    expect(rec).toMatch(/const TRAIL_MAX_AGE_MS = \d+;/);
    expect(rec).toMatch(/function pruneTrail\(/);
  });

  it('기존 스켈레톤 회귀 테스트가 고정한 스무딩 블록을 건드리지 않는다', () => {
    // record_measure_skeleton_quality.test.js가 정확히 이 블록만 있어야 한다고
    // 검증한다 — 궤적 기능이 그 안에 코드를 추가하면 안 됨(별도 statement로 분리).
    expect(rec).toMatch(/if \(landmarks\) \{\s*latestLandmarksRef\.current = smootherRef\.current\(landmarks\);\s*\}/);
  });

  it('스켈레톤 ON일 때: 같은 프레임에 궤적 버퍼 갱신 + 캔버스를 지우지 않고(clear=false) 겹쳐 그린다', () => {
    const idx = rec.indexOf('drawSkeletonCover(canvas, video, latestLandmarksRef.current, angleStabilizerRef.current);');
    expect(idx).toBeGreaterThan(-1);
    const after = rec.slice(idx, idx + 400);
    expect(after).toMatch(/drawTrajectoryCover\(canvas, video, trailBufferRef\.current, false\);/);
  });

  it('스켈레톤 OFF·궤적 ON일 때도 포즈 검출을 계속하고, 캔버스를 직접 지운다(clear=true)', () => {
    expect(rec).toMatch(/\} else if \(trajectoryOnRef\.current && isPoseReady\(\)\) \{/);
    const idx = rec.indexOf('} else if (trajectoryOnRef.current && isPoseReady()) {');
    const block = rec.slice(idx, rec.indexOf('} else {', idx));
    expect(block).toMatch(/drawTrajectoryCover\(canvas, video, trailBufferRef\.current, true\);/);
  });

  it('녹화 합성 캔버스(저장되는 영상)에도 스켈레톤과 별개로 궤적을 굽는다', () => {
    const skelIdx = rec.indexOf('drawSkeletonToRecordCover(ctx, video, latestLandmarksRef.current, canvas.width, canvas.height, angleStabilizerRef.current);');
    expect(skelIdx).toBeGreaterThan(-1);
    const after = rec.slice(skelIdx, skelIdx + 400);
    expect(after).toMatch(/drawTrajectoryToRecordCover\(ctx, video, trailBufferRef\.current, canvas\.width, canvas\.height\);/);
  });

  it('궤적이 꺼지면 잔상 버퍼를 즉시 비운다(스켈레톤 구독 효과와 별개의 useEffect)', () => {
    const idx = rec.indexOf('const off = subscribeTrajectory');
    expect(idx).toBeGreaterThan(-1);
    const block = rec.slice(idx, rec.indexOf('});', idx));
    expect(block).toMatch(/trailBufferRef\.current = emptyTrail\(\);/);
  });
});
