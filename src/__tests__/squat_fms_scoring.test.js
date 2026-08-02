// squat_fms_scoring.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] 오버헤드 딥 스쿼트 FMS 채점 + 부위별 색상 오버레이 테스트.
//
//  현장 요청 두 가지를 함께 다룬다:
//   (5) "깊이 120%가 뭔지 모르겠다" → 패러렐(대퇴골 수평)까지의 진행도로 변경.
//       예전 값은 (엉덩이 하강거리 ÷ 선 자세 엉덩이~무릎 간격)이라 깊게 앉으면
//       상한 1.2에 걸려 항상 120%로 고정 표시됐다.
//   (6) "정상은 푸른색, 이상은 붉은색으로 부위별 표시" → FMS 기준/보상패턴에
//       따른 부위별 상태 판정.
//
//  설계상 가장 중요한 원칙: 현재 촬영 방향에서 볼 수 없는 항목은 'unknown'으로
//  남겨야 한다. 정면 영상으로 상체 기울기를 판정하거나, 측면 영상으로 무릎
//  안쪽 무너짐을 판정하면 임상적으로 틀린 결과가 나온다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  depthPctFromThighIncline,
  evaluateSquatFrame,
  scoreDeepSquatFms,
  worseStatus,
  partForBone,
  colorForBone,
  FMS_SEGMENT_COLORS,
  COMPENSATION_KO,
} from '../ai-measure/core/squatFms';

describe('깊이 표시 — 패러렐까지의 진행도(%)', () => {
  it('선 자세(대퇴 경사 90°)는 0%', () => {
    expect(depthPctFromThighIncline(90)).toBe(0);
  });

  it('대퇴골이 수평에 도달(0°)하면 100%', () => {
    expect(depthPctFromThighIncline(0)).toBe(100);
  });

  it('절반쯤 내려간 상태(45°)는 50%', () => {
    expect(depthPctFromThighIncline(45)).toBe(50);
  });

  it('[회귀] 아무리 깊이 앉아도 100%를 넘지 않는다(예전 "120%" 문제)', () => {
    for (const v of [0, -5, -30]) {
      expect(depthPctFromThighIncline(v)).toBeLessThanOrEqual(100);
    }
  });

  it('값이 없으면 0%로 안전하게 처리한다', () => {
    expect(depthPctFromThighIncline(null)).toBe(0);
    expect(depthPctFromThighIncline(NaN)).toBe(0);
  });
});

describe('worseStatus — 상태 병합', () => {
  it('risk가 caution보다 우선한다', () => {
    expect(worseStatus('caution', 'risk')).toBe('risk');
  });

  it('unknown은 정보가 있는 쪽에 밀린다', () => {
    expect(worseStatus('unknown', 'normal')).toBe('normal');
    expect(worseStatus('normal', 'unknown')).toBe('normal');
  });

  it('둘 다 모르면 unknown', () => {
    expect(worseStatus('unknown', 'unknown')).toBe('unknown');
  });
});

describe('evaluateSquatFrame — 촬영 방향별로 볼 수 있는 것만 판정한다', () => {
  const goodSide = { thighInclineDeg: 5, torsoLeanDeg: 10, armDropDeg: 5, heelLift: false };
  const goodFront = { kneeValgusDeg: 3, pelvicTiltDeg: 2 };

  it('측면에서 깊이·상체·팔·뒤꿈치를 판정하고, 무릎·골반은 unknown으로 남긴다', () => {
    const r = evaluateSquatFrame(goodSide, 'side');
    expect(r.parts.depth).toBe('normal');
    expect(r.parts.torso).toBe('normal');
    expect(r.parts.arms).toBe('normal');
    expect(r.parts.heel).toBe('normal');
    expect(r.parts.knee).toBe('unknown');
    expect(r.parts.pelvis).toBe('unknown');
  });

  it('정면에서 무릎·골반을 판정하고, 깊이·상체는 unknown으로 남긴다', () => {
    const r = evaluateSquatFrame(goodFront, 'front');
    expect(r.parts.knee).toBe('normal');
    expect(r.parts.pelvis).toBe('normal');
    expect(r.parts.depth).toBe('unknown');
    expect(r.parts.torso).toBe('unknown');
  });

  it('[중요] 정면 데이터에 상체 기울기 값이 들어와도 정면에서는 판정하지 않는다', () => {
    const r = evaluateSquatFrame({ ...goodFront, torsoLeanDeg: 60 }, 'front');
    expect(r.parts.torso).toBe('unknown');
    expect(r.compensations).not.toContain('excessive_trunk_flexion');
  });

  it('깊이가 얕으면(대퇴 경사 35°) risk로 잡고 보상패턴에 넣는다', () => {
    const r = evaluateSquatFrame({ ...goodSide, thighInclineDeg: 35 }, 'side');
    expect(r.parts.depth).toBe('risk');
    expect(r.compensations).toContain('depth_insufficient');
  });

  it('무릎 안쪽 무너짐(외반 18°)을 정면에서 risk로 잡는다', () => {
    const r = evaluateSquatFrame({ ...goodFront, kneeValgusDeg: 18 }, 'front');
    expect(r.parts.knee).toBe('risk');
    expect(r.compensations).toContain('knee_valgus');
  });

  it('뒤꿈치 들림은 불리언이라 바로 risk로 본다', () => {
    const r = evaluateSquatFrame({ ...goodSide, heelLift: true }, 'side');
    expect(r.parts.heel).toBe('risk');
    expect(r.compensations).toContain('heel_lift');
  });

  it('팔이 앞으로 떨어지면(40°) 보상패턴으로 잡는다', () => {
    const r = evaluateSquatFrame({ ...goodSide, armDropDeg: 40 }, 'side');
    expect(r.parts.arms).toBe('risk');
    expect(r.compensations).toContain('arms_fall_forward');
  });

  it('모든 보상패턴 코드에 한글 문구가 정의돼 있다(화면에 원시 코드가 노출되지 않도록)', () => {
    const all = evaluateSquatFrame(
      { thighInclineDeg: 40, torsoLeanDeg: 40, armDropDeg: 40, heelLift: true },
      'side',
    ).compensations.concat(
      evaluateSquatFrame({ kneeValgusDeg: 20, pelvicTiltDeg: 12 }, 'front').compensations,
    );
    expect(all.length).toBeGreaterThan(0);
    all.forEach((c) => expect(COMPENSATION_KO[c]).toBeTruthy());
  });
});

describe('scoreDeepSquatFms — 3/2/1/0 채점', () => {
  const cleanSide = evaluateSquatFrame(
    { thighInclineDeg: 5, torsoLeanDeg: 10, armDropDeg: 5, heelLift: false }, 'side');
  const cleanFront = evaluateSquatFrame({ kneeValgusDeg: 3, pelvicTiltDeg: 2 }, 'front');

  it('모든 기준 충족 + 뒤꿈치 유지 → 3점', () => {
    expect(scoreDeepSquatFms(cleanFront, cleanSide).score).toBe(3);
  });

  it('기준은 충족했으나 뒤꿈치가 들리면 → 2점', () => {
    const heelSide = evaluateSquatFrame(
      { thighInclineDeg: 5, torsoLeanDeg: 10, armDropDeg: 5, heelLift: true }, 'side');
    const r = scoreDeepSquatFms(cleanFront, heelSide);
    expect(r.score).toBe(2);
    expect(r.reasons).toContain('heel_lift');
  });

  it('기준 하나라도 미충족이면 → 1점, 실패 항목이 reasons에 남는다', () => {
    const shallowSide = evaluateSquatFrame(
      { thighInclineDeg: 40, torsoLeanDeg: 10, armDropDeg: 5, heelLift: false }, 'side');
    const r = scoreDeepSquatFms(cleanFront, shallowSide);
    expect(r.score).toBe(1);
    expect(r.reasons).toContain('depthBelowParallel');
  });

  it('무릎이 무너지면 정면 기준 미충족으로 1점', () => {
    const valgusFront = evaluateSquatFrame({ kneeValgusDeg: 20, pelvicTiltDeg: 2 }, 'front');
    const r = scoreDeepSquatFms(valgusFront, cleanSide);
    expect(r.score).toBe(1);
    expect(r.reasons).toContain('kneesAligned');
  });

  it('통증이 보고되면 다른 지표와 무관하게 0점', () => {
    expect(scoreDeepSquatFms(cleanFront, cleanSide, true).score).toBe(0);
  });

  it('[정직성] 한쪽 방향만 있으면 점수를 확정하지 않는다(못 본 항목을 통과 처리하지 않음)', () => {
    expect(scoreDeepSquatFms(cleanFront, null).score).toBeNull();
    expect(scoreDeepSquatFms(null, cleanSide).reasons).toContain('incomplete_views');
  });
});

describe('부위별 색상 매핑', () => {
  it('대퇴(고관절–무릎)는 깊이 판정에 연결된다', () => {
    expect(partForBone(23, 25)).toBe('depth');
    expect(partForBone(24, 26)).toBe('depth');
  });

  it('정강이(무릎–발목)는 무릎 정렬에 연결된다', () => {
    expect(partForBone(25, 27)).toBe('knee');
  });

  it('뼈대 순서가 뒤집혀도 같은 부위로 찾는다', () => {
    expect(partForBone(25, 23)).toBe('depth');
  });

  it('정상은 푸른색, 이상은 붉은색으로 칠한다(요청 사양)', () => {
    const parts = { depth: 'normal', knee: 'risk' };
    expect(colorForBone(23, 25, parts)).toBe(FMS_SEGMENT_COLORS.normal);
    expect(colorForBone(25, 27, parts)).toBe(FMS_SEGMENT_COLORS.risk);
  });

  it('판정 불가(unknown)는 회색 — "정상(파랑)"과 구분된다', () => {
    expect(colorForBone(23, 25, { depth: 'unknown' })).toBe(FMS_SEGMENT_COLORS.unknown);
    expect(FMS_SEGMENT_COLORS.unknown).not.toBe(FMS_SEGMENT_COLORS.normal);
  });

  it('매핑에 없는 뼈대나 판정값이 없으면 회색으로 안전하게 처리한다', () => {
    expect(colorForBone(0, 1, { depth: 'normal' })).toBe(FMS_SEGMENT_COLORS.unknown);
    expect(colorForBone(23, 25, null)).toBe(FMS_SEGMENT_COLORS.unknown);
  });
});
