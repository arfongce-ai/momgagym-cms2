// squat_arm_drop_fix.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-03] 회귀 테스트 — "팔이 앞으로 떨어짐" 판정이 절대 뜨지 않던 버그.
//
//  원인: squatFms.js의 evaluateSquatFrame()은 m.armDropDeg를 받아 측면 뷰에서
//  팔 상태를 판정하도록 설계돼 있었는데, 이 값을 계산해서 넘기는 코드가
//  squatBiomechanicsTracker.js 어디에도 없었다(liveMetrics()가 depth/torso/
//  knee/pelvis/heel만 반환). 그 결과 arms는 항상 'unknown'(회색)이었고,
//  scoreDeepSquatFms()의 armsAligned 기준도 영원히 통과할 수 없었다.
//  squat_fms_scoring.test.js는 armDropDeg를 테스트에서 직접 주입해서 이 갭을
//  못 잡았다 — 여기서는 실제 트래커가 랜드마크로부터 armDropDeg를 만들어내는
//  경로 자체를 검증한다.
//
//  1차 수정: squatBiomechanicsTracker.js에 armDropDegOf() 추가(torsoLeanDegOf와
//  동일한 "기준점→끝점 벡터의 수직 편차" 방식)하고 push()/trials/liveMetrics()에
//  연결. squatFms.js에 worstOfTrials() 추가해 정면·측면 각 2회 반복의 저장된
//  trial로부터 scoreDeepSquatFms()에 필요한 입력을 만듦.
//
//  2차 수정(피드백 반영, 같은 날): 두 가지가 더 빠져 있었다.
//   (a) 라이브 화면 'finished' 배지가 앱 전체가 쓰는 정상/주의/위험 어휘
//       대신 "FMS 3점" 같은 원시 점수 텍스트를 썼다 — SquatAnalysisHub.jsx가
//       이미 STATUS_KO(정상/주의/위험/확인 필요)로 표시하고 있었는데 그와
//       다른 어휘를 새로 만든 것. evaluateSquatBiomechanics() 결과로 통일.
//   (b) armDropDeg가 squatFms.js(라이브 오버레이·FMS 점수)에만 연결되고
//       squatBiomechanics.js(정상/주의/위험 종합 판정 + Firestore에 저장되는
//       리포트)에는 전혀 연결되지 않아, 실제 저장되는 리포트에는 팔 처짐이
//       반영되지 않고 있었다. judgeTrial()·combineFrontSide()·
//       combineFrontSideTwice()에 측면 단독 판정으로 추가하고,
//       crossMeasureContext.js의 SQUAT_FLAG_KO에도 문구를 추가했다(안 하면
//       상태는 위험/주의로 바뀌는데 이유 설명이 안 나오는 반쪽짜리 수정이 됨).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SquatBiomechanicsTracker, armDropDegOf } from '../ai-measure/core/squatBiomechanicsTracker.js';
import { evaluateSquatFrame, scoreDeepSquatFms, worstOfTrials, ARM_DROP_CAUTION_DEG, ARM_DROP_RISK_DEG } from '../ai-measure/core/squatFms.js';
import { evaluateSquatBiomechanics, SQUAT_TUNING } from '../ai-measure/core/squatBiomechanics.js';
import { buildProblemFocus } from '../ai-measure/core/crossMeasureContext.js';

// squat_biomechanics_tracker.test.js와 동일한 캘리브레이션/프레임 패턴 — 이 파일도
// 독립적으로 읽힐 수 있도록 자체 fixture를 둔다(기존 컨벤션과 동일).
const calib = { baselinePelvisY: 0.50, baselineKneeY: 0.70, baselineHeelY: 0.95, baselineFeetY: 0.95 };

function frame({ hipY, kneeY = 0.70, shoY = 0.30, ankY = 0.90, heelY = 0.95, armDrop = 0 }) {
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[11] = { x: 0.45, y: shoY, visibility: 1 }; lm[12] = { x: 0.55, y: shoY, visibility: 1 }; // shoulders
  lm[23] = { x: 0.45, y: hipY, visibility: 1 }; lm[24] = { x: 0.55, y: hipY, visibility: 1 }; // hips
  lm[25] = { x: 0.45, y: kneeY, visibility: 1 }; lm[26] = { x: 0.55, y: kneeY, visibility: 1 }; // knees
  lm[27] = { x: 0.45, y: ankY, visibility: 1 }; lm[28] = { x: 0.55, y: ankY, visibility: 1 }; // ankles
  lm[29] = { x: 0.45, y: heelY, visibility: 1 }; lm[30] = { x: 0.55, y: heelY, visibility: 1 }; // heels
  // 손목: 어깨 바로 위(armDrop=0)에서 armDrop 값만큼 앞으로(+x) 떨어뜨린 위치.
  // 팔 길이를 넉넉히(0.35) 잡아 각도-좌표 환산 오차를 줄인다.
  const armLen = 0.35;
  const rad = (armDrop * Math.PI) / 180;
  const dx = armLen * Math.sin(rad), dy = armLen * Math.cos(rad);
  lm[15] = { x: 0.45 + dx, y: shoY - dy, visibility: 1 };
  lm[16] = { x: 0.55 + dx, y: shoY - dy, visibility: 1 };
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

describe('armDropDegOf — 팔(어깨→손목)이 수직에서 벗어난 각', () => {
  it('손목이 어깨 바로 위(완전한 수직)면 0°에 가깝다', () => {
    const lm = frame({ hipY: 0.60, armDrop: 0 });
    expect(armDropDegOf(lm)).toBeLessThan(0.5);
  });

  it('팔이 앞으로 떨어질수록 각도가 커진다', () => {
    const small = armDropDegOf(frame({ hipY: 0.60, armDrop: 10 }));
    const big = armDropDegOf(frame({ hipY: 0.60, armDrop: 40 }));
    expect(big).toBeGreaterThan(small);
    expect(big).toBeCloseTo(40, 0);
  });

  it('어깨나 손목 랜드마크가 없으면 null', () => {
    const lm = frame({ hipY: 0.60 });
    lm[15] = null; lm[16] = null;
    expect(armDropDegOf(lm)).toBeNull();
  });

  it('좌우 중 더 크게(나쁘게) 벗어난 쪽을 쓴다(kneeValgusDegOf와 동일 원칙)', () => {
    const lm = frame({ hipY: 0.60, armDrop: 10 });
    // 오른쪽 손목만 크게 앞으로 이동시켜 좌우 비대칭을 만든다.
    lm[16] = { x: lm[16].x + 0.3, y: lm[16].y, visibility: 1 };
    const asymmetric = armDropDegOf(lm);
    const symmetric = armDropDegOf(frame({ hipY: 0.60, armDrop: 10 }));
    expect(asymmetric).toBeGreaterThan(symmetric);
  });
});

describe('[회귀] SquatBiomechanicsTracker가 armDropDeg를 실제로 만들어낸다', () => {
  it('trial에 armDropDeg 필드가 채워진다(이전엔 아예 없었음)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { armDrop: 25 });
    const trial = tracker.summary().trial1;
    expect(trial.armDropDeg).toBeGreaterThan(20);
  });

  it('liveMetrics()에도 armDropDeg가 포함된다(라이브 화면 오버레이가 쓰는 값)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    tracker.push(frame({ hipY: 0.50, armDrop: 30 }), 0);
    tracker.push(frame({ hipY: 0.60, armDrop: 30 }), 33); // 하강 시작 → phase active
    const live = tracker.liveMetrics();
    expect(live).not.toBeNull();
    expect(live.armDropDeg).toBeGreaterThan(20);
  });

  it('[핵심 회귀] 트래커가 만든 trial을 evaluateSquatFrame에 넣으면 arms가 더 이상 unknown 고정이 아니다', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { armDrop: 40 }); // 명확한 팔 처짐
    const trial = tracker.summary().trial1;
    const assessment = evaluateSquatFrame(trial, 'side');
    // 수정 전에는 armDropDeg가 undefined라 아래 값이 항상 'unknown'이었다.
    expect(assessment.parts.arms).not.toBe('unknown');
    expect(assessment.parts.arms).toBe('risk');
    expect(assessment.compensations).toContain('arms_fall_forward');
  });

  it('팔이 수직에 가까우면 정상적으로 normal 판정을 받는다(오탐 방지)', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { armDrop: 2 });
    const trial = tracker.summary().trial1;
    const assessment = evaluateSquatFrame(trial, 'side');
    expect(assessment.parts.arms).toBe('normal');
  });
});

describe('worstOfTrials — 같은 뷰 두 반복을 부위별로 합친다', () => {
  const good = evaluateSquatFrame({ thighInclineDeg: 5, torsoLeanDeg: 5, armDropDeg: 5, heelLift: false }, 'side');
  const bad = evaluateSquatFrame({ thighInclineDeg: 40, torsoLeanDeg: 5, armDropDeg: 5, heelLift: false }, 'side');

  it('둘 다 없으면 null', () => {
    expect(worstOfTrials(null, null)).toBeNull();
  });

  it('하나만 있으면 그대로 반환', () => {
    expect(worstOfTrials(good, null)).toBe(good);
    expect(worstOfTrials(null, good)).toBe(good);
  });

  it('부위별로 더 나쁜 쪽을 택한다(좋은 값으로 덮어쓰지 않음 — 측정 정직성)', () => {
    const merged = worstOfTrials(good, bad);
    expect(merged.parts.depth).toBe('risk'); // bad 쪽 depth가 risk
    expect(merged.parts.torso).toBe('normal'); // 둘 다 normal
  });

  it('compensations를 합치고 중복을 제거한다', () => {
    const merged = worstOfTrials(bad, bad);
    const count = merged.compensations.filter((c) => c === 'depth_insufficient').length;
    expect(count).toBe(1);
  });
});

describe('[통합] armDropDeg가 실제로 있으면 FMS 3점(만점)이 나올 수 있다', () => {
  it('모든 지표가 정상 + armDropDeg도 정상이면 3점', () => {
    const tracker = new SquatBiomechanicsTracker(calib);
    runOneRep(tracker, { targetHipY: 0.70, armDrop: 3 }); // 패러렐 도달 + 팔 거의 수직
    const trial = tracker.summary().trial1;
    const side = evaluateSquatFrame(trial, 'side');
    const front = evaluateSquatFrame({ kneeValgusDeg: 2, pelvicTiltDeg: 2 }, 'front');
    const result = scoreDeepSquatFms(front, side);
    expect(result.score).toBe(3);
  });
});

describe('SquatLiveAnalysis.jsx — FMS 점수·종합 판정 계산 및 표시 배선 확인', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/ai-measure/menus/SquatLiveAnalysis.jsx'),
    'utf8',
  );

  it('squatFms에서 scoreDeepSquatFms·worstOfTrials를, squatBiomechanics에서 evaluateSquatBiomechanics를 가져온다', () => {
    expect(src).toMatch(/scoreDeepSquatFms/);
    expect(src).toMatch(/worstOfTrials/);
    expect(src).toMatch(/evaluateSquatBiomechanics/);
  });

  it('computeFmsResult가 정면·측면 각각에 evaluateSquatFrame을 적용한다', () => {
    const idx = src.indexOf('function computeFmsResult');
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 700);
    expect(body).toMatch(/evaluateSquatFrame\([^)]*'front'\)/);
    expect(body).toMatch(/evaluateSquatFrame\([^)]*'side'\)/);
    expect(body).toMatch(/scoreDeepSquatFms\(/);
  });

  it('finishAndSubmit의 summary에 fmsScore가 담긴다(리포트/onComplete로 전달)', () => {
    const idx = src.indexOf('const finishAndSubmit');
    const body = src.slice(idx, src.indexOf('};', idx));
    expect(body).toMatch(/fmsScore:\s*fms\.score/);
  });

  it("'finished' 단계 배지는 STATUS_KO(정상/주의/위험)로 표시하고, FMS 점수는 보조 정보로만 덧붙인다", () => {
    // [2026-08-03] 처음엔 "FMS 3점 — 보상 없이 기준 충족" 텍스트를 직접
    // 보여줬는데, 앱 전체(SquatAnalysisHub 등)가 쓰는 정상/주의/위험 어휘와
    // 달라 피드백을 받고 통일했다 — 그 통일이 유지되는지 확인.
    expect(src).toMatch(/uiPhase === 'finished' && finishedBio/);
    expect(src).toMatch(/STATUS_KO\[st\]/);
    expect(src).toMatch(/finishedFms\?\.score/);
  });

  it("finishedBio는 evaluateSquatBiomechanics로 계산되고, SquatAnalysisHub.jsx의 STATUS_KO와 같은 4개 상태를 쓴다", () => {
    const idx = src.indexOf('const finishedBio');
    const body = src.slice(idx, idx + 400);
    expect(body).toMatch(/evaluateSquatBiomechanics\(/);
    expect(src).toMatch(/const STATUS_KO = \{ normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' \}/);
  });
});

describe('[2차 수정] squatBiomechanics.js — armDropDeg가 정상/주의/위험 종합 판정에도 반영된다', () => {
  it('SQUAT_TUNING에 armDropCautionDeg/armDropRiskDeg가 추가됐다', () => {
    expect(SQUAT_TUNING.armDropCautionDeg).toBe(20);
    expect(SQUAT_TUNING.armDropRiskDeg).toBe(35);
  });

  it('squatFms.js의 ARM_DROP_CAUTION_DEG/RISK_DEG가 SQUAT_TUNING과 같은 값을 쓴다(기준 이원화 방지)', () => {
    expect(ARM_DROP_CAUTION_DEG).toBe(SQUAT_TUNING.armDropCautionDeg);
    expect(ARM_DROP_RISK_DEG).toBe(SQUAT_TUNING.armDropRiskDeg);
  });

  it('측면 시행의 armDropDeg가 위험 수준이면 combineFrontSideTwice 결과가 risk가 된다', () => {
    const goodTrial = { valid: true, thighInclineDeg: 5, torsoLeanDeg: 5, kneeValgusDeg: 2, pelvicTiltDeg: 2, armDropDeg: 5, heelLift: false };
    const armDroppedSide = { ...goodTrial, armDropDeg: 40 };
    const result = evaluateSquatBiomechanics({
      front1: goodTrial, front2: goodTrial,
      side1: armDroppedSide, side2: armDroppedSide,
    });
    expect(result.status).toBe('risk');
    expect(result.confirmedFlags).toContain('arm_drop_high');
  });

  it('정면 시행에만 팔 처짐 값이 있어도 무시한다(측면 단독 판정 — 정면 폴백 없음)', () => {
    const goodSide = { valid: true, thighInclineDeg: 5, torsoLeanDeg: 5, kneeValgusDeg: 2, pelvicTiltDeg: 2, armDropDeg: 5, heelLift: false };
    const frontWithArmValue = { ...goodSide, armDropDeg: 40 }; // 정면인데 팔 값이 나쁨 — 무시돼야 함
    const result = evaluateSquatBiomechanics({
      front1: frontWithArmValue, front2: frontWithArmValue,
      side1: goodSide, side2: goodSide,
    });
    expect(result.status).toBe('normal');
    expect(result.confirmedFlags || []).not.toContain('arm_drop_high');
  });

  it('측면 2회 중 1회만 팔 처짐이면 재현성 미확정으로 남는다(반복돼야 확정 원칙)', () => {
    const goodTrial = { valid: true, thighInclineDeg: 5, torsoLeanDeg: 5, kneeValgusDeg: 2, pelvicTiltDeg: 2, armDropDeg: 5, heelLift: false };
    const armDroppedOnce = { ...goodTrial, armDropDeg: 40 };
    const result = evaluateSquatBiomechanics({
      front1: goodTrial, front2: goodTrial,
      side1: armDroppedOnce, side2: goodTrial,
    });
    expect(result.status).toBe('normal'); // 1회만이라 확정 안 됨
    expect(result.unconfirmedFlags).toContain('arm_drop_high');
  });

  it('[통합] 트래커가 만든 실제 trial로도 combineFrontSideTwice가 팔 처짐을 잡는다', () => {
    const calib = { baselinePelvisY: 0.50, baselineKneeY: 0.70, baselineHeelY: 0.95, baselineFeetY: 0.95 };
    const goodFrontTrial = { valid: true, kneeValgusDeg: 2, pelvicTiltDeg: 2 };
    const sideTracker = new SquatBiomechanicsTracker(calib);
    // 팔이 40도 떨어진 측면 반복 2회
    for (let rep = 0; rep < 2; rep++) {
      let t = rep * 3000;
      const push = (hipY) => { sideTracker.push(frame({ hipY, armDrop: 40 }), t); t += 33; };
      push(0.50); push(0.50);
      for (let i = 1; i <= 30; i++) push(0.50 + (0.70 - 0.50) * (i / 30));
      for (let i = 29; i >= 0; i--) push(0.50 + (0.70 - 0.50) * (i / 30));
      push(0.50);
    }
    const sideSummary = sideTracker.summary();
    const result = evaluateSquatBiomechanics({
      front1: goodFrontTrial, front2: goodFrontTrial,
      side1: sideSummary.trial1, side2: sideSummary.trial2,
    });
    expect(result.status).toBe('risk');
    expect(result.confirmedFlags).toContain('arm_drop_high');
  });
});

describe('[2차 수정] crossMeasureContext.js — 팔 처짐 플래그도 사람이 읽을 문장으로 설명된다', () => {
  it('arm_drop_high가 risk 이슈 문장으로 나온다(상태만 바뀌고 설명이 없는 반쪽 수정 방지)', () => {
    const report = {
      valid: true, status: 'risk', basis: 'front_side_combined',
      repeatedFlags: ['arm_drop_high'], confirmedFlags: ['arm_drop_high'],
    };
    const focus = buildProblemFocus('squat', report);
    expect(focus.severity).toBe('risk');
    expect(focus.issues.some((i) => i.text.includes('팔'))).toBe(true);
  });

  it('arm_drop_borderline이 caution 이슈 문장으로 나온다', () => {
    const report = {
      valid: true, status: 'caution', basis: 'front_side_combined',
      repeatedFlags: ['arm_drop_borderline'], confirmedFlags: ['arm_drop_borderline'],
    };
    const focus = buildProblemFocus('squat', report);
    expect(focus.severity).toBe('caution');
    expect(focus.issues.some((i) => i.text.includes('팔'))).toBe(true);
  });
});

describe('[2차 수정] SquatAnalysisHub.jsx — FMS 점수가 저장 리포트까지 전달된다', () => {
  const hubSrc = readFileSync(
    join(process.cwd(), 'src/ai-measure/menus/SquatAnalysisHub.jsx'),
    'utf8',
  );

  it('handleComplete가 summary.fmsScore/fmsReasons를 reportData에 옮겨 담는다', () => {
    const idx = hubSrc.indexOf('const reportData');
    const body = hubSrc.slice(idx, idx + 700);
    expect(body).toMatch(/fmsScore:\s*summary\?\.fmsScore/);
    expect(body).toMatch(/fmsReasons:\s*summary\?\.fmsReasons/);
  });

  it('리포트 화면이 report.fmsScore를 표시한다', () => {
    expect(hubSrc).toMatch(/report\.fmsScore/);
  });

  it('[덤으로 발견한 기존 버그] 정면 2회+측면 2회(4개 trials) 배열에서 앞 절반만 정면으로 표시한다', () => {
    // 이전엔 i===0만 '정면'이라 front2(index 1)가 '측면'으로 잘못 표시됐다.
    expect(hubSrc).not.toMatch(/\{i === 0 \? '정면' : '측면'\}/);
    expect(hubSrc).toMatch(/i < report\.trials\.length \/ 2 \? '정면' : '측면'/);
  });
});
