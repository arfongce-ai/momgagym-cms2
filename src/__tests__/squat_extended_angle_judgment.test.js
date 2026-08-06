// squat_extended_angle_judgment.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-06] squatJointAngles.js(라이브 화면 표시용, 2026-07-30 도입)의 11개
//  각도는 그동안 순수 표시 전용이었다("판정에는 아직 연결하지 않고 표시만
//  한다" — 원 커밋 주석). 이번 세션 요청으로 이 중 방향·크기가 명확한 5개를
//  squatBiomechanics.js/squatBiomechanicsTracker.js에 연결한다:
//   · cogOverAnkleDeg(측면) — CoG-발목 편차. armDropDeg와 같은 이유로 측면 단독.
//   · cogTiltDeg(정면) — CoG 좌우쏠림. kneeValgus·pelvicTilt와 같은 이유로 정면 단독.
//   · headTiltDeg(정면) — 머리 좌우 기울기. 정면 단독.
//   · elbowExtensionDeg(정면) — 팔꿈치 폄(180°=완전히 폄, 낮을수록 나쁨 — 방향 반대).
//   · elbowAsymDeg(정면) — 팔꿈치 좌우 비대칭.
//  나머지 6개(관절별 굽힘 4개·귀-어깨 간격 2개)는 스쿼트 깊이에 따라 계속
//  바뀌거나(굽힘 4개, thighInclineDeg·torsoLeanDeg가 이미 깊이·기울기를 대표)
//  카메라 거리·고개 회전에 흔들리는(귀-어깨 간격) 값이라 단일 목표값이 없어
//  의도적으로 표시 전용으로 남긴다 — 이 테스트는 그 5개만 검증한다.
//
//  squat_arm_drop_fix.test.js가 남긴 교훈(반쪽짜리 수정 방지) 그대로 적용:
//  판정 로직만 추가하고 crossMeasureContext.js의 SQUAT_FLAG_KO에 문구를
//  안 넣으면 상태는 바뀌는데 이유 설명이 안 나온다 — 이 파일 마지막 describe가
//  그 문구 존재를 별도로 확인한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SquatBiomechanicsTracker,
  cogOverAnkleDegOf, cogTiltDegOf, headTiltDegOf, elbowExtensionOf,
} from '../ai-measure/core/squatBiomechanicsTracker.js';
import { evaluateSquatBiomechanics, SQUAT_TUNING } from '../ai-measure/core/squatBiomechanics.js';

const calib = { baselinePelvisY: 0.50, baselineKneeY: 0.70, baselineHeelY: 0.95, baselineFeetY: 0.95 };

// squat_biomechanics_tracker.test.js와 동일한 fixture 패턴(독립적으로 읽혀도
// 되도록 자체 정의) — 팔꿈치(13/14)는 어깨-손목 중점에 둬 "편 팔"을 기본
// 가정한다(안 그러면 elbowExtensionDeg가 다른 케이스에서 엉뚱하게 걸림).
function frame({ hipY, kneeY = 0.70, shoY = 0.30, ankY = 0.90, heelY = 0.95, elbowBendFrac = 0, elbowAsymDx = 0, headTiltDx = 0 }) {
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[7] = { x: 0.42 + headTiltDx, y: shoY - 0.12, visibility: 1 };  // L ear
  lm[8] = { x: 0.58, y: shoY - 0.12, visibility: 1 };               // R ear
  lm[11] = { x: 0.45, y: shoY, visibility: 1 }; lm[12] = { x: 0.55, y: shoY, visibility: 1 }; // shoulders
  lm[23] = { x: 0.45, y: hipY, visibility: 1 }; lm[24] = { x: 0.55, y: hipY, visibility: 1 }; // hips
  lm[25] = { x: 0.45, y: kneeY, visibility: 1 }; lm[26] = { x: 0.55, y: kneeY, visibility: 1 }; // knees
  lm[27] = { x: 0.45, y: ankY, visibility: 1 }; lm[28] = { x: 0.55, y: ankY, visibility: 1 }; // ankles
  lm[29] = { x: 0.45, y: heelY, visibility: 1 }; lm[30] = { x: 0.55, y: heelY, visibility: 1 }; // heels
  // 손목: 어깨 바로 위(완전히 편 팔 기본형).
  lm[15] = { x: 0.45, y: shoY - 0.35, visibility: 1 };
  lm[16] = { x: 0.55 + elbowAsymDx, y: shoY - 0.35, visibility: 1 };
  // 팔꿈치: elbowBendFrac=0이면 어깨-손목 중점(편 팔). 커질수록 옆으로 밀어 굽힘 근사.
  lm[13] = { x: (0.45 + lm[15].x) / 2 - elbowBendFrac, y: (shoY + lm[15].y) / 2, visibility: 1 };
  lm[14] = { x: (0.55 + lm[16].x) / 2 + elbowBendFrac, y: (shoY + lm[16].y) / 2, visibility: 1 };
  return lm;
}

function runOneRep(tracker, { startMs = 0, targetHipY = 0.69, steps = 30, stepMs = 33, ...frameOpts } = {}) {
  let t = startMs;
  const push = (hipY) => { tracker.push(frame({ hipY, ...frameOpts }), t); t += stepMs; };
  const standY = 0.50;
  push(standY); push(standY);
  for (let i = 1; i <= steps; i++) push(standY + (targetHipY - standY) * (i / steps));
  for (let i = steps - 1; i >= 0; i--) push(standY + (targetHipY - standY) * (i / steps));
  push(standY);
  return t;
}

describe('squatBiomechanicsTracker — 새 5개 지표 계산 헬퍼', () => {
  it('cogOverAnkleDegOf: CoG가 발목 바로 위면 0에 가깝다', () => {
    const lm = frame({ hipY: 0.60 });
    expect(cogOverAnkleDegOf(lm, 'left')).toBeCloseTo(0, 0);
  });

  it('cogTiltDegOf: 좌우 대칭이면 0에 가깝다', () => {
    const lm = frame({ hipY: 0.60 });
    expect(cogTiltDegOf(lm)).toBeCloseTo(0, 0);
  });

  it('headTiltDegOf: 귀가 수평이면 0, 한쪽이 기울면 커진다', () => {
    const level = frame({ hipY: 0.60 });
    const tilted = frame({ hipY: 0.60, headTiltDx: 0.08 });
    expect(headTiltDegOf(level)).toBeCloseTo(0, 0);
    expect(headTiltDegOf(tilted)).toBeGreaterThan(headTiltDegOf(level));
  });

  it('elbowExtensionOf: 편 팔이면 minExt가 180에 가깝고 asymDeg는 0에 가깝다', () => {
    const lm = frame({ hipY: 0.60 });
    const { minExt, asymDeg } = elbowExtensionOf(lm);
    expect(minExt).toBeGreaterThan(170);
    expect(asymDeg).toBeCloseTo(0, 0);
  });

  it('elbowExtensionOf: 한쪽 팔이 굽으면 minExt가 줄어든다', () => {
    const straight = elbowExtensionOf(frame({ hipY: 0.60 }));
    const bent = elbowExtensionOf(frame({ hipY: 0.60, elbowBendFrac: 0.12 }));
    expect(bent.minExt).toBeLessThan(straight.minExt);
  });
});

describe('SquatBiomechanicsTracker — 새 5개 지표가 trial에 담긴다', () => {
  it('편 팔·수평 정렬로 한 반복을 마치면 새 필드가 모두 정상 범위로 기록된다', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { targetHipY: 0.70 });
    const t1 = tracker.summary().trial1;
    expect(t1.cogOverAnkleDeg).toBeLessThan(SQUAT_TUNING.cogOverAnkleCautionDeg);
    expect(t1.cogTiltDeg).toBeLessThan(SQUAT_TUNING.cogTiltCautionDeg);
    expect(t1.headTiltDeg).toBeLessThan(SQUAT_TUNING.headTiltCautionDeg);
    expect(t1.elbowExtensionDeg).toBeGreaterThan(SQUAT_TUNING.elbowExtensionCautionDeg);
    expect(t1.elbowAsymDeg).toBeLessThan(SQUAT_TUNING.elbowAsymCautionDeg);
  });

  it('팔꿈치가 굽은 채로 반복하면 elbowExtensionDeg가 임계값 이하로 낮게 기록된다', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { targetHipY: 0.70, elbowBendFrac: 0.18 });
    expect(tracker.summary().trial1.elbowExtensionDeg).toBeLessThanOrEqual(SQUAT_TUNING.elbowExtensionRiskDeg);
  });

  it('liveMetrics()에도 새 5개 필드가 노출된다', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    tracker.push(frame({ hipY: 0.50 }), 0);
    tracker.push(frame({ hipY: 0.60 }), 33);
    const live = tracker.liveMetrics();
    expect(live).not.toBeNull();
    ['cogOverAnkleDeg', 'cogTiltDeg', 'headTiltDeg', 'elbowExtensionDeg', 'elbowAsymDeg'].forEach((k) => {
      expect(live[k]).not.toBeUndefined();
    });
  });
});

describe('evaluateSquatBiomechanics — 새 5개 지표의 뷰 권위(정면/측면 단독) 배정', () => {
  it('cogOverAnkle 위험값은 측면(side)에서만 확정되고, 정면(front)에 있어도 무시된다', () => {
    const bad = { valid: true, cogOverAnkleDeg: SQUAT_TUNING.cogOverAnkleRiskDeg + 5 };
    const clean = { valid: true, thighInclineDeg: 0, torsoLeanDeg: 0, kneeValgusDeg: 0, pelvicTiltDeg: 0, armDropDeg: 0 };

    const fromSide = evaluateSquatBiomechanics({ front: clean, side: { ...clean, ...bad } });
    expect(fromSide.status).toBe('risk');
    expect(fromSide.confirmedFlags).toContain('cog_over_ankle_high');

    const fromFrontOnly = evaluateSquatBiomechanics({ front: { ...clean, ...bad }, side: clean });
    expect(fromFrontOnly.confirmedFlags || []).not.toContain('cog_over_ankle_high');
  });

  it('cogTilt·headTilt·elbow 위험값은 정면(front)에서만 확정되고, 측면(side)에 있어도 무시된다', () => {
    const clean = { valid: true, thighInclineDeg: 0, torsoLeanDeg: 0, kneeValgusDeg: 0, pelvicTiltDeg: 0, armDropDeg: 0 };
    const bad = {
      cogTiltDeg: SQUAT_TUNING.cogTiltRiskDeg + 5,
      headTiltDeg: SQUAT_TUNING.headTiltRiskDeg + 5,
      elbowExtensionDeg: SQUAT_TUNING.elbowExtensionRiskDeg - 5,
      elbowAsymDeg: SQUAT_TUNING.elbowAsymRiskDeg + 5,
    };

    const fromFront = evaluateSquatBiomechanics({ front: { ...clean, ...bad }, side: clean });
    expect(fromFront.status).toBe('risk');
    ['cog_tilt_high', 'head_tilt_high', 'elbow_bend_high', 'elbow_asym_high'].forEach((flag) => {
      expect(fromFront.confirmedFlags).toContain(flag);
    });

    const fromSideOnly = evaluateSquatBiomechanics({ front: clean, side: { ...clean, ...bad } });
    ['cog_tilt_high', 'head_tilt_high', 'elbow_bend_high', 'elbow_asym_high'].forEach((flag) => {
      expect(fromSideOnly.confirmedFlags || []).not.toContain(flag);
    });
  });

  it('caution 경계값은 caution으로, 정상 범위는 어떤 플래그도 안 남긴다', () => {
    const clean = { valid: true, thighInclineDeg: 0, torsoLeanDeg: 0, kneeValgusDeg: 0, pelvicTiltDeg: 0, armDropDeg: 0 };
    const caution = evaluateSquatBiomechanics({
      front: { ...clean, cogTiltDeg: SQUAT_TUNING.cogTiltCautionDeg + 1 },
      side: clean,
    });
    expect(caution.status).toBe('caution');
    expect(caution.confirmedFlags).toContain('cog_tilt_borderline');

    const normal = evaluateSquatBiomechanics({ front: clean, side: clean });
    expect(normal.status).toBe('normal');
  });
});

describe('crossMeasureContext.js — 새 플래그에 대한 한글 설명 문구 존재 확인(반쪽짜리 수정 방지)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'ai-measure', 'core', 'crossMeasureContext.js'), 'utf8');
  ['cog_over_ankle_borderline', 'cog_over_ankle_high', 'cog_tilt_borderline', 'cog_tilt_high',
   'head_tilt_borderline', 'head_tilt_high', 'elbow_bend_borderline', 'elbow_bend_high',
   'elbow_asym_borderline', 'elbow_asym_high'].forEach((flag) => {
    it(`SQUAT_FLAG_KO에 ${flag} 문구가 있다`, () => {
      expect(src).toContain(`${flag}:`);
    });
  });
});
