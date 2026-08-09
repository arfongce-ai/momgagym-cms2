// ai-measure/core/squatBiomechanics.js
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트(Overhead Deep Squat) 판정 — 순수 함수/상수.
//  singleLegStance.js / reactiveJump.js 와 동일한 설계 철학:
//   · 현장 튜닝 상수를 SQUAT_TUNING 한 곳에 모음(사용하지 않는 상수는 두지 않는다)
//   · valid 플래그로 무효 측정(랜드마크 신뢰도 부족) 원천 차단
//   · 판정 근거를 결과에 그대로 노출(측정 정직성) — 시행별 원본값을 그대로 두고,
//     "여러 시행 중 더 좋은 값"을 골라 대표값으로 보여주는 방식은 쓰지 않는다
//     (실제 상태보다 좋아 보이게 만드는 왜곡이라 금지).
//
//  ── 측정 항목(표준 오버헤드 스쿼트 체크포인트) ──
//   · thighInclineDeg — 깊이: 대퇴부(엉덩이-무릎)가 수평에서 얼마나 못 미쳤는지(deg).
//     0°=완전 패러렐(수평) 도달, 클수록 얕은 스쿼트.
//   · torsoLeanDeg — 상체 전방 기울기: 엉덩이-어깨 벡터 vs 수직(Y축).
//     정강이 평행 기준 대신 이 방식을 쓰는 이유는 랜드마크 2점(엉덩이·어깨)만
//     있으면 되어, 깊은 스쿼트에서 발목이 가려져도 흔들리지 않기 때문
//     (singleLegStance.js 설계 노트와 동일한 "최소 랜드마크" 원칙).
//   · kneeValgusDeg — 동적 무릎 외반(무릎이 안으로 모이는 정도). 좌우 중 더 큰 쪽.
//   · pelvicTiltDeg — 좌우 골반 기울기/체중 쏠림(Trendelenburg 패턴과 동일 지표명).
//   · armDropDeg — 팔(어깨-손목) 처짐: 수직 대비 팔이 앞으로 떨어진 각.
//     [2026-08-03 추가] torsoLeanDeg와 같은 이유로 측면에서만 신뢰할 수 있다.
//   · balanceLoss / heelLift — 즉시확정용 이진 신호(균형 상실, 뒤꿈치 들림).
//
//  ── 입력 계약 ──
//   원시 랜드마크가 아니라, 상위 캡처 레이어가 이미 프레임별로 신뢰도를 검증하고
//   집계한 "시행(trial) 요약값"을 입력으로 받는다(reactiveJump.js와 동일 분리).
//
//  ── 판정 2단계 구조 ──
//   1) 즉시확정(immediate): 균형 상실 · 뒤꿈치 들림 — 1회만 나와도 그 시행은
//      즉시 RISK(이미 명백한 실패, 재현성 확인 불필요).
//   2) 재현성확정(reproducibility): 깊이 부족 · 상체 기울기 · 무릎 외반 ·
//      골반 기울기처럼 애매한 신호 — 2회 시행(trial1, trial2) 모두에서
//      반복돼야 CAUTION/RISK로 확정한다. trial1만 보고 trial2를 누락하는 실수를
//      막기 위해 두 시행 모두 동일한 judgeTrial()을 거친다.
//
//  ⚠ 측정 한계(결과에 그대로 노출):
//   · 통증·부상 위험을 단정하지 않는다. 임상 해석은 Momi/전문가 몫이며, 여기서는
//     측정된 패턴(정상/주의/위험/확인 필요)만 노출한다.
//   · 아래 임계값은 실측 캡처 데이터 보정 전까지의 시작 기본값이다.
//
//  ── 정면+측면 결합 판정(2026-07-30 추가) ──
//   라이브 촬영은 이제 정면 1회 + 측면 1회, 총 2회로 진행한다(기존: 정면만 2회).
//   지표마다 "어느 각도가 신뢰할 수 있는 소스인지"가 다르므로, 예전처럼 "같은
//   지표가 두 시행 모두에서 반복돼야 확정"하는 재현성 방식을 그대로 쓸 수 없다
//   (무릎외반은 애초에 측면 시행에서 반복될 수가 없는 지표라서, 그대로 두면
//   정면에서 아무리 명확히 잡혀도 영원히 "미확정"에 머무는 문제가 생긴다).
//   그래서 지표별로 확정 규칙을 분리했다:
//    · kneeValgusDeg · pelvicTiltDeg — 정면 시행 단독으로 확정(측면은 애초에
//      좌우 편차를 볼 수 없는 각도라 관여하지 않는다).
//    · torsoLeanDeg — 측면 시행을 우선 소스로 단독 확정(시상면 굽힘은 측면이
//      정확하다는 기존 주석 근거 그대로). 측면 시행이 무효면 정면 값으로
//      대체하되(폴백), 대체 사용 여부를 torsoLeanSource 로 결과에 노출한다.
//    · armDropDeg — [2026-08-03] 측면 시행 단독으로 확정(정면은 관여하지
//      않음). torsoLeanDeg와 달리 정면 폴백을 두지 않는다 — 팔이 앞으로
//      떨어지는 움직임은 정면에서 근본적으로 관측할 수 없는 축이라(무릎외반과
//      반대로, 폴백용 대체 신호 자체가 없음), 측면이 없으면 그냥 판정하지
//      않는 편이 "못 보는 것을 본 척하지 않는다"는 이 코드베이스 원칙에 맞다.
//    · thighInclineDeg(깊이) — 정면·측면 모두 같은 공식(엉덩이-무릎 수직 접근도)을
//      쓰므로 값이 서로 비교 가능하다. 둘 다 유효하면 기존과 같은 재현성 방식
//      (양쪽 다 나와야 확정)을 그대로 유지하고, 한쪽만 있으면 그 값으로 단독 확정.
//    · balanceLoss·heelLift(즉시확정) — 정면·측면 어느 쪽에서 나와도 그대로 RISK.
//   evaluateSquatBiomechanics()는 {front, side}(신규)와 {trial1, trial2}(기존 —
//   영상 업로드 모드처럼 정면 2회만 있는 경우) 두 입력 형태를 모두 지원한다.
// ════════════════════════════════════════════════════════════════════════

export const SQUAT_TUNING = {
  // ── 깊이(thighInclineDeg) — 0°=패러렐 도달, 클수록 얕음 ──
  depthCautionDeg: 15,
  depthRiskDeg: 30,

  // ── 상체 전방 기울기(torsoLeanDeg) ──
  torsoLeanCautionDeg: 25,
  torsoLeanRiskDeg: 35,

  // ── 동적 무릎 외반(kneeValgusDeg) ──
  kneeValgusCautionDeg: 10,
  kneeValgusRiskDeg: 15,

  // ── 골반 기울기/체중 쏠림(pelvicTiltDeg) ──
  pelvicTiltCautionDeg: 5,
  pelvicTiltRiskDeg: 10,

  // ── 팔 처짐(armDropDeg) — 어깨→손목 벡터가 수직에서 앞으로 떨어진 각.
  //    [2026-08-03 추가] squatFms.js의 라이브 오버레이가 먼저 쓰던 값인데,
  //    이 종합 판정(정상/주의/위험)에는 연결돼 있지 않아 최종 리포트에는
  //    팔 처짐이 전혀 반영되지 않고 있었다. squatFms.js도 이제 이 값을
  //    그대로 가져다 쓰도록 통일해, 라이브 화면과 최종 리포트가 서로 다른
  //    기준으로 말하지 않게 한다(파일 상단 설계 원칙과 동일).
  armDropCautionDeg: 20,
  armDropRiskDeg: 35,

  // ── [2026-08-06 추가] squatJointAngles.js(라이브 표시용) 11개 각도 중
  //    방향·크기가 명확한 5개를 판정에 연결. 나머지(관절별 굽힘 4개·귀-어깨
  //    간격)는 squatBiomechanicsTracker.js 상단 주석 이유로 표시 전용 유지.
  //    이 임계값들도 파일 상단 설계원칙과 동일하게 실측 데이터 보정 전
  //    시작 기본값이다.

  // CoG-발목 편차(측면) — torsoLeanDeg와 유사 개념이지만 엉덩이까지 반영해
  // 더 민감하므로 살짝 낮게 잡음.
  cogOverAnkleCautionDeg: 20,
  cogOverAnkleRiskDeg: 30,

  // CoG 좌우쏠림(정면) — pelvicTiltDeg(골반 라인만 봄)보다 넓은 구간의 단순
  // 2점 평균이라 노이즈가 커 살짝 넉넉하게 잡음.
  cogTiltCautionDeg: 6,
  cogTiltRiskDeg: 12,

  // 머리 좌우 기울기(정면)
  headTiltCautionDeg: 8,
  headTiltRiskDeg: 15,

  // 팔꿈치 폄 부족(정면) — 180°가 완전히 폄. 판정은 "낮을수록 나쁨"(다른
  // 지표와 방향 반대)이라 judgeTrial에서 <= 비교로 별도 처리한다.
  elbowExtensionCautionDeg: 165, // 180°에서 15° 이상 굽으면 주의
  elbowExtensionRiskDeg: 150,    // 180°에서 30° 이상 굽으면 위험

  // 팔꿈치 좌우 비대칭(정면) — 한쪽 팔만 유독 처지는 패턴.
  elbowAsymCautionDeg: 10,
  elbowAsymRiskDeg: 20,
};

const STATUS_RANK = { normal: 0, caution: 1, risk: 2, unknown: 3 };

// 재현성확정된 소프트 플래그가 어떤 등급으로 확정되는지 명시적으로 정의.
// (플래그 이름 규칙에 암묵적으로 의존하지 않도록 - 새 플래그 추가 시 여기 함께 추가)
const FLAG_SEVERITY = {
  depth_borderline: 'caution',
  depth_high: 'risk',
  torso_lean_borderline: 'caution',
  torso_lean_high: 'risk',
  knee_valgus_borderline: 'caution',
  knee_valgus_high: 'risk',
  pelvic_tilt_borderline: 'caution',
  pelvic_tilt_high: 'risk',
  arm_drop_borderline: 'caution',
  arm_drop_high: 'risk',
  cog_over_ankle_borderline: 'caution',
  cog_over_ankle_high: 'risk',
  cog_tilt_borderline: 'caution',
  cog_tilt_high: 'risk',
  head_tilt_borderline: 'caution',
  head_tilt_high: 'risk',
  elbow_bend_borderline: 'caution',
  elbow_bend_high: 'risk',
  elbow_asym_borderline: 'caution',
  elbow_asym_high: 'risk',
};

function worse(a, b) {
  return (STATUS_RANK[b] ?? 0) > (STATUS_RANK[a] ?? 0) ? b : a;
}

/**
 * 단일 시행(trial) 판정. trial1/trial2 모두 반드시 이 함수를 통과해야 한다.
 * @param {object} trial
 * @param {boolean} trial.valid            상위 레이어의 랜드마크 신뢰도 게이트 통과 여부
 * @param {string}  [trial.reason]         valid=false 사유
 * @param {boolean} [trial.balanceLoss]    균형 상실 여부 — 즉시확정 신호
 * @param {boolean} [trial.heelLift]       뒤꿈치 들림 여부 — 즉시확정 신호
 * @param {number}  [trial.thighInclineDeg] 대퇴부 수평 대비 기울기(deg) — 깊이
 * @param {number}  [trial.torsoLeanDeg]   상체 전방 기울기(deg)
 * @param {number}  [trial.kneeValgusDeg]  동적 무릎 외반각(deg)
 * @param {number}  [trial.pelvicTiltDeg]  골반 기울기/체중 쏠림(deg)
 * @param {number}  [trial.armDropDeg]    팔(어깨-손목) 처짐각(deg) — 수직 대비
 * @param {number}  [trial.cogOverAnkleDeg] CoG-발목 편차각(deg, 측면) — [2026-08-06]
 * @param {number}  [trial.cogTiltDeg]     CoG 좌우쏠림(deg, 정면) — [2026-08-06]
 * @param {number}  [trial.headTiltDeg]    머리 좌우 기울기(deg, 정면) — [2026-08-06]
 * @param {number}  [trial.elbowExtensionDeg] 팔꿈치 폄(deg, 정면, 낮을수록 나쁨) — [2026-08-06]
 * @param {number}  [trial.elbowAsymDeg]   팔꿈치 좌우 비대칭(deg, 정면) — [2026-08-06]
 * @returns {object}
 */
function judgeTrial(trial = {}) {
  if (!trial.valid) {
    return {
      valid: false,
      status: 'unknown',
      reason: trial.reason || 'landmarks_unreliable',
      immediateFail: false,
      softFlags: [],
    };
  }

  // ── 1) 즉시확정: 균형 상실 / 뒤꿈치 들림 ──
  const immediateReasons = [];
  if (trial.balanceLoss) immediateReasons.push('balance_loss');
  if (trial.heelLift) immediateReasons.push('heel_lift');

  const base = {
    thighInclineDeg: trial.thighInclineDeg ?? null,
    torsoLeanDeg: trial.torsoLeanDeg ?? null,
    kneeValgusDeg: trial.kneeValgusDeg ?? null,
    pelvicTiltDeg: trial.pelvicTiltDeg ?? null,
    armDropDeg: trial.armDropDeg ?? null,
    cogOverAnkleDeg: trial.cogOverAnkleDeg ?? null,
    cogTiltDeg: trial.cogTiltDeg ?? null,
    headTiltDeg: trial.headTiltDeg ?? null,
    elbowExtensionDeg: trial.elbowExtensionDeg ?? null,
    elbowAsymDeg: trial.elbowAsymDeg ?? null,
  };

  if (immediateReasons.length) {
    return { valid: true, status: 'risk', immediateFail: true, immediateReasons, softFlags: [], ...base };
  }

  // ── 2) 재현성확정 대상: 경계성 소프트 신호 수집(이 시행 자체는 RISK가 아님) ──
  let status = 'normal';
  const softFlags = [];

  if (trial.thighInclineDeg != null) {
    if (trial.thighInclineDeg >= SQUAT_TUNING.depthRiskDeg) { softFlags.push('depth_high'); status = worse(status, 'risk'); }
    else if (trial.thighInclineDeg >= SQUAT_TUNING.depthCautionDeg) { softFlags.push('depth_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.torsoLeanDeg != null) {
    if (trial.torsoLeanDeg >= SQUAT_TUNING.torsoLeanRiskDeg) { softFlags.push('torso_lean_high'); status = worse(status, 'risk'); }
    else if (trial.torsoLeanDeg >= SQUAT_TUNING.torsoLeanCautionDeg) { softFlags.push('torso_lean_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.kneeValgusDeg != null) {
    if (trial.kneeValgusDeg >= SQUAT_TUNING.kneeValgusRiskDeg) { softFlags.push('knee_valgus_high'); status = worse(status, 'risk'); }
    else if (trial.kneeValgusDeg >= SQUAT_TUNING.kneeValgusCautionDeg) { softFlags.push('knee_valgus_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.pelvicTiltDeg != null) {
    if (trial.pelvicTiltDeg >= SQUAT_TUNING.pelvicTiltRiskDeg) { softFlags.push('pelvic_tilt_high'); status = worse(status, 'risk'); }
    else if (trial.pelvicTiltDeg >= SQUAT_TUNING.pelvicTiltCautionDeg) { softFlags.push('pelvic_tilt_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.armDropDeg != null) {
    if (trial.armDropDeg >= SQUAT_TUNING.armDropRiskDeg) { softFlags.push('arm_drop_high'); status = worse(status, 'risk'); }
    else if (trial.armDropDeg >= SQUAT_TUNING.armDropCautionDeg) { softFlags.push('arm_drop_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.cogOverAnkleDeg != null) {
    if (trial.cogOverAnkleDeg >= SQUAT_TUNING.cogOverAnkleRiskDeg) { softFlags.push('cog_over_ankle_high'); status = worse(status, 'risk'); }
    else if (trial.cogOverAnkleDeg >= SQUAT_TUNING.cogOverAnkleCautionDeg) { softFlags.push('cog_over_ankle_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.cogTiltDeg != null) {
    if (trial.cogTiltDeg >= SQUAT_TUNING.cogTiltRiskDeg) { softFlags.push('cog_tilt_high'); status = worse(status, 'risk'); }
    else if (trial.cogTiltDeg >= SQUAT_TUNING.cogTiltCautionDeg) { softFlags.push('cog_tilt_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.headTiltDeg != null) {
    if (trial.headTiltDeg >= SQUAT_TUNING.headTiltRiskDeg) { softFlags.push('head_tilt_high'); status = worse(status, 'risk'); }
    else if (trial.headTiltDeg >= SQUAT_TUNING.headTiltCautionDeg) { softFlags.push('head_tilt_borderline'); status = worse(status, 'caution'); }
  }
  // 팔꿈치 폄만 방향이 반대(값이 낮을수록 나쁨 = 더 굽음) — <= 비교.
  if (trial.elbowExtensionDeg != null) {
    if (trial.elbowExtensionDeg <= SQUAT_TUNING.elbowExtensionRiskDeg) { softFlags.push('elbow_bend_high'); status = worse(status, 'risk'); }
    else if (trial.elbowExtensionDeg <= SQUAT_TUNING.elbowExtensionCautionDeg) { softFlags.push('elbow_bend_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.elbowAsymDeg != null) {
    if (trial.elbowAsymDeg >= SQUAT_TUNING.elbowAsymRiskDeg) { softFlags.push('elbow_asym_high'); status = worse(status, 'risk'); }
    else if (trial.elbowAsymDeg >= SQUAT_TUNING.elbowAsymCautionDeg) { softFlags.push('elbow_asym_borderline'); status = worse(status, 'caution'); }
  }

  return { valid: true, status, immediateFail: false, softFlags, ...base };
}

/**
 * 정면 1회 + 측면 1회를 지표별 권위 소스 규칙으로 결합(파일 상단 설계 노트 참고).
 */
function combineFrontSide(front, side) {
  const f = judgeTrial(front);
  const s = judgeTrial(side);

  if (f.immediateFail || s.immediateFail) {
    const failed = f.immediateFail ? f : s;
    return { status: 'risk', confirmed: true, basis: 'immediate', immediateReasons: failed.immediateReasons, trials: [f, s] };
  }

  if (!f.valid && !s.valid) {
    return { status: 'unknown', confirmed: false, basis: 'no_valid_trial', trials: [f, s] };
  }

  const bothValid = f.valid && s.valid;
  let status = 'normal';
  const confirmedFlags = [];
  const unconfirmedFlags = [];

  const takeSingle = (trial, prefix) => {
    if (!trial?.valid) return;
    trial.softFlags.filter((fl) => fl.startsWith(prefix)).forEach((fl) => {
      confirmedFlags.push(fl);
      status = worse(status, FLAG_SEVERITY[fl] || 'caution');
    });
  };

  // 무릎외반·골반기울기 — 정면 단독(측면은 관여하지 않음).
  takeSingle(f, 'knee_valgus_');
  takeSingle(f, 'pelvic_tilt_');

  // 팔 처짐 — 측면 단독(정면은 애초에 안정적으로 볼 수 없는 각도라 관여하지
  // 않는다 — squatFms.js의 evaluateSquatFrame과 동일한 view 제한 원칙).
  takeSingle(s, 'arm_drop_');

  // CoG-발목 편차 — armDropDeg와 같은 이유로 측면 단독(앞뒤 편차는 정면에서
  // 근본적으로 관측 불가).
  takeSingle(s, 'cog_over_ankle_');

  // CoG 좌우쏠림·머리기울기·팔꿈치폄·팔꿈치비대칭 — kneeValgus·pelvicTilt와
  // 같은 이유로 정면 단독(좌우 편차는 측면에서 관측 불가).
  takeSingle(f, 'cog_tilt_');
  takeSingle(f, 'head_tilt_');
  takeSingle(f, 'elbow_bend_');
  takeSingle(f, 'elbow_asym_');

  // 상체기울기 — 측면 우선 단독, 측면 무효면 정면으로 대체.
  const torsoLeanSource = s.valid ? 'side' : (f.valid ? 'front_fallback' : null);
  takeSingle(torsoLeanSource === 'side' ? s : f, 'torso_lean_');

  // 깊이 — 같은 공식이라 값이 비교 가능: 둘 다 있으면 재현성(양쪽 다 나와야 확정),
  // 한쪽만 있으면 그 값으로 단독 확정.
  if (bothValid) {
    const fDepth = f.softFlags.filter((fl) => fl.startsWith('depth_'));
    const sDepth = s.softFlags.filter((fl) => fl.startsWith('depth_'));
    const repeated = fDepth.filter((fl) => sDepth.includes(fl));
    repeated.forEach((fl) => { confirmedFlags.push(fl); status = worse(status, FLAG_SEVERITY[fl] || 'caution'); });
    [...new Set([...fDepth, ...sDepth])].filter((fl) => !repeated.includes(fl)).forEach((fl) => unconfirmedFlags.push(fl));
  } else {
    takeSingle(f.valid ? f : s, 'depth_');
  }

  const missingView = bothValid ? null : (f.valid ? 'side' : 'front');

  return {
    status,
    confirmed: true,
    basis: bothValid ? 'front_side_combined' : 'single_view_only',
    confirmedFlags,
    repeatedFlags: confirmedFlags, // crossMeasureContext.js 등 기존 소비자가 쓰는 이름과 호환(같은 배열 별칭)
    unconfirmedFlags,
    torsoLeanSource,
    missingView,
    needsRetest: missingView != null && status !== 'normal',
    trials: [f, s],
  };
}

/**
 * 2회 시행(trial1, trial2)을 재현성 로직으로 결합.
 * - 어느 한 시행이라도 즉시확정 RISK면 → 그대로 RISK(이미 명백, 재현성 확인 불필요).
 * - 둘 다 무효면 → unknown.
 * - 하나만 유효하면 → 그 시행 결과를 그대로 쓰되 재측정 필요 플래그를 남긴다.
 * - 둘 다 유효하면 → 같은 softFlag가 양쪽에서 반복된 것만 CAUTION/RISK로 확정하고,
 *   한쪽에만 나온 소프트 신호는 상태를 올리지 않고 "미확정 관찰"로만 남긴다.
 *   (다시 말해 두 시행 중 "더 좋아 보이는 값"을 골라 쓰지 않는다 — 대신 반복
 *    여부로만 확정한다. 원본 시행값은 trials[]에 그대로 보존.)
 */
function combineTrials(trial1, trial2) {
  const t1 = judgeTrial(trial1);
  const t2 = judgeTrial(trial2);

  if (t1.immediateFail || t2.immediateFail) {
    const failed = t1.immediateFail ? t1 : t2;
    return { status: 'risk', confirmed: true, basis: 'immediate', immediateReasons: failed.immediateReasons, trials: [t1, t2] };
  }

  if (!t1.valid && !t2.valid) {
    return { status: 'unknown', confirmed: false, basis: 'no_valid_trial', trials: [t1, t2] };
  }
  if (t1.valid !== t2.valid) {
    const only = t1.valid ? t1 : t2;
    return { status: only.status, confirmed: false, basis: 'single_trial_only', needsRetest: only.status !== 'normal', trials: [t1, t2] };
  }

  const repeated = t1.softFlags.filter((f) => t2.softFlags.includes(f));
  const unconfirmed = [...new Set([...t1.softFlags, ...t2.softFlags])].filter((f) => !repeated.includes(f));

  let status = 'normal';
  repeated.forEach((f) => { status = worse(status, FLAG_SEVERITY[f] || 'caution'); });

  return { status, confirmed: true, basis: 'reproducibility', repeatedFlags: repeated, unconfirmedFlags: unconfirmed, trials: [t1, t2] };
}

/**
 * 정면 2회 + 측면 2회 결합(2026-07-30 → 07-31 재변경: 운영 방식이 "정면 2회 →
 * 측면 2회"로 확정됨). 뷰 내부는 combineTrials()로 먼저 재현성 확정(각 뷰의
 * 2회가 반복돼야 그 뷰 안에서 CAUTION/RISK 확정)하고, 그 결과를
 * combineFrontSide()와 동일한 지표별 권위 소스 규칙(무릎외반·골반기울기=정면
 * 단독, 상체기울기=측면 우선, 깊이=양쪽 비교 가능)으로 뷰 간 결합한다 — 즉
 * "반복돼야 확정한다"는 원칙을 뷰 내부·뷰 간 두 층 모두에 그대로 적용.
 * trials[]는 [front1,front2,side1,side2] 순서로 반환 — trials[0]가 기존과 동일한
 * 정면 판정값이라 unifiedReport.js 등 trials.0.* 소비자와 하위 호환된다.
 */
function combineFrontSideTwice(front1, front2, side1, side2) {
  const frontCombined = combineTrials(front1, front2);
  const sideCombined = combineTrials(side1, side2);
  const trials = [...frontCombined.trials, ...sideCombined.trials];

  if (frontCombined.basis === 'immediate' || sideCombined.basis === 'immediate') {
    const failed = frontCombined.basis === 'immediate' ? frontCombined : sideCombined;
    return { status: 'risk', confirmed: true, basis: 'immediate', immediateReasons: failed.immediateReasons, trials };
  }

  const frontValid = frontCombined.basis !== 'no_valid_trial';
  const sideValid = sideCombined.basis !== 'no_valid_trial';

  if (!frontValid && !sideValid) {
    return { status: 'unknown', confirmed: false, basis: 'no_valid_trial', trials };
  }

  let status = 'normal';
  const confirmedFlags = [];
  const unconfirmedFlags = [];

  // 이미 뷰 내부에서 반복 확정된(repeatedFlags) 항목만 승격하고, 뷰 내부에서도
  // 확정 못 한(unconfirmedFlags) 항목은 뷰 간 결합에서도 "미확정 관찰"로만 남긴다.
  const takeFromView = (viewResult, prefix) => {
    (viewResult.repeatedFlags || []).filter((fl) => fl.startsWith(prefix)).forEach((fl) => {
      confirmedFlags.push(fl);
      status = worse(status, FLAG_SEVERITY[fl] || 'caution');
    });
    (viewResult.unconfirmedFlags || []).filter((fl) => fl.startsWith(prefix) && !unconfirmedFlags.includes(fl))
      .forEach((fl) => unconfirmedFlags.push(fl));
  };

  // 무릎외반·골반기울기 — 정면 단독(측면은 관여하지 않음).
  if (frontValid) { takeFromView(frontCombined, 'knee_valgus_'); takeFromView(frontCombined, 'pelvic_tilt_'); }

  // 팔 처짐 — 측면 단독(정면은 관여하지 않음, 위 combineFrontSide와 동일 이유).
  if (sideValid) { takeFromView(sideCombined, 'arm_drop_'); }

  // CoG-발목 편차 — armDropDeg와 같은 이유로 측면 단독.
  if (sideValid) { takeFromView(sideCombined, 'cog_over_ankle_'); }

  // CoG 좌우쏠림·머리기울기·팔꿈치폄·팔꿈치비대칭 — 정면 단독(위
  // combineFrontSide와 동일 이유).
  if (frontValid) {
    takeFromView(frontCombined, 'cog_tilt_');
    takeFromView(frontCombined, 'head_tilt_');
    takeFromView(frontCombined, 'elbow_bend_');
    takeFromView(frontCombined, 'elbow_asym_');
  }

  // 상체기울기 — 측면 우선 단독, 측면 무효면 정면으로 대체.
  const torsoLeanSource = sideValid ? 'side' : (frontValid ? 'front_fallback' : null);
  takeFromView(torsoLeanSource === 'side' ? sideCombined : frontCombined, 'torso_lean_');

  // 깊이 — 양쪽 다 유효하면 뷰 간에도 반복돼야 확정, 한쪽만 유효하면 그 뷰의
  // (이미 뷰 내부에서 재현성 확정된) 결과를 그대로 쓴다.
  if (frontValid && sideValid) {
    const fDepth = (frontCombined.repeatedFlags || []).filter((fl) => fl.startsWith('depth_'));
    const sDepth = (sideCombined.repeatedFlags || []).filter((fl) => fl.startsWith('depth_'));
    const repeated = fDepth.filter((fl) => sDepth.includes(fl));
    repeated.forEach((fl) => { confirmedFlags.push(fl); status = worse(status, FLAG_SEVERITY[fl] || 'caution'); });
    [...new Set([...fDepth, ...sDepth])].filter((fl) => !repeated.includes(fl) && !unconfirmedFlags.includes(fl))
      .forEach((fl) => unconfirmedFlags.push(fl));
  } else {
    takeFromView(frontValid ? frontCombined : sideCombined, 'depth_');
  }

  const missingView = (frontValid && sideValid) ? null : (frontValid ? 'side' : 'front');

  return {
    status,
    confirmed: true,
    basis: (frontValid && sideValid) ? 'front_side_combined' : 'single_view_only',
    confirmedFlags,
    repeatedFlags: confirmedFlags,
    unconfirmedFlags,
    torsoLeanSource,
    missingView,
    needsRetest: missingView != null && status !== 'normal',
    trials,
  };
}

/**
 * 오버헤드 딥 스쿼트 종합 판정.
 * @param {object} input
 * @param {object} [input.front1]  최신(2026-07-31): 정면 1차 시행
 * @param {object} [input.front2]  최신: 정면 2차 시행
 * @param {object} [input.side1]   최신: 측면 1차 시행
 * @param {object} [input.side2]   최신: 측면 2차 시행
 * @param {object} [input.front]   구(2026-07-30): 정면 1회 시행 — 하위 호환
 * @param {object} [input.side]    구: 측면 1회 시행 — 하위 호환
 * @param {object} [input.trial1]  기존(하위 호환 — 예: 영상 업로드 모드, 정면만 2회)
 * @param {object} [input.trial2]  기존(하위 호환)
 * @returns {object} valid:false 시 { valid:false, reason, message }
 */
export function evaluateSquatBiomechanics(input = {}) {
  if (input.front1 || input.front2 || input.side1 || input.side2) {
    return { valid: true, kind: 'squat', ...combineFrontSideTwice(input.front1, input.front2, input.side1, input.side2) };
  }
  if (input.front || input.side) {
    return { valid: true, kind: 'squat', ...combineFrontSide(input.front, input.side) };
  }
  if (!input.trial1 && !input.trial2) {
    return { valid: false, reason: 'no_trials', message: '오버헤드 딥 스쿼트 측정 데이터가 없습니다.' };
  }

  return { valid: true, kind: 'squat', ...combineTrials(input.trial1, input.trial2) };
}

// ════════════════════════════════════════════════════════════════════════
//  [리포트 통합 2026-08-09] 아래 세 함수는 원래 SquatAnalysisHub.jsx(측정
//  화면)에 있었다. SquatReportDashboard.jsx(저장된 리포트를 다시 보는 화면 —
//  결과리포트 통합 프로젝트로 신설)도 똑같은 점수·상태 판정이 필요한데, 두
//  화면 파일이 서로를 import하면 순환 참조가 생긴다. 판정 로직 자체는 이
//  파일(core)에 두는 게 원래 맞는 자리라 여기로 옮기고, 두 화면 다 여기서
//  가져다 쓰게 한다(재구현 아님 — 그대로 이동, singleLegStance.js와 동일 처리).
// ════════════════════════════════════════════════════════════════════════

// trials=[front1,front2,side1,side2](또는 구버전 [front,side])에서 지표별
// 권위 소스(무릎·골반=정면, 팔=측면, 상체=torsoLeanSource, 깊이=양쪽)만 골라
// "더 나쁜 값"을 대표값으로 삼는다(더 좋은 값을 고르지 않는다는 측정 정직성 원칙).
export function extractSquatMetrics(report) {
  const trials = report?.trials || [];
  const half = Math.ceil(trials.length / 2) || 1;
  const front = trials.slice(0, half);
  const side = trials.slice(half);
  const worstOf = (arr, key) => {
    const vals = arr.map((t) => t?.[key]).filter((v) => v != null);
    return vals.length ? Math.round(Math.max(...vals) * 10) / 10 : null;
  };
  return {
    depthDeg: worstOf(trials, 'thighInclineDeg'),
    kneeValgusDeg: worstOf(front, 'kneeValgusDeg'),
    pelvicTiltDeg: worstOf(front, 'pelvicTiltDeg'),
    armDropDeg: worstOf(side, 'armDropDeg'),
    torsoLeanDeg: report?.torsoLeanSource === 'side' ? worstOf(side, 'torsoLeanDeg') : worstOf(front, 'torsoLeanDeg'),
  };
}

// 재현성 2단계 판정을 그대로 반영 — 같은 신호가 반복돼야 확정(caution/risk)이고,
// 한 번만 나오면 "observed"(관찰됨·미확정)로 정상과 구분해 보여준다. 일반
// range 재계산이 아니라 evaluateSquatBiomechanics()가 이미 낸 결론을 그대로 쓴다.
export function squatMetricStatus(report, flagPrefix) {
  const confirmed = (report?.confirmedFlags || []).find((f) => f.startsWith(flagPrefix));
  if (confirmed) return confirmed.endsWith('_high') ? 'risk' : 'caution';
  const unconfirmed = (report?.unconfirmedFlags || []).some((f) => f.startsWith(flagPrefix));
  return unconfirmed ? 'observed' : 'normal';
}

// [주의] flagPrefix 문자열은 원래 화면 쪽 METRIC_RANGES 테이블에서 읽었는데,
// 그 테이블(라벨·단위 등 표시 전용 정보)은 SquatReportDashboard.jsx에 그대로
// 남아있다 — 여기(core)로 그 표시용 테이블까지 끌고 오면 화면 쪽 정보가
// 로직 파일에 섞이므로, 대신 이 다섯 개 flagPrefix만 인라인 상수로 둔다(값
// 자체는 원래 테이블과 정확히 동일 — 이동일 뿐 변경 없음).
const SCORE_FLAG_PREFIXES = ['depth_', 'torso_lean_', 'knee_valgus_', 'pelvic_tilt_', 'arm_drop_'];

export function computeSquatScore(report, m) {
  if (report?.valid === false) return 0;
  const entries = [
    [SCORE_FLAG_PREFIXES[0], m.depthDeg],
    [SCORE_FLAG_PREFIXES[1], m.torsoLeanDeg],
    [SCORE_FLAG_PREFIXES[2], m.kneeValgusDeg],
    [SCORE_FLAG_PREFIXES[3], m.pelvicTiltDeg],
    [SCORE_FLAG_PREFIXES[4], m.armDropDeg],
  ];
  const scores = [];
  entries.forEach(([prefix, val]) => {
    if (val == null) return;
    const st = squatMetricStatus(report, prefix);
    scores.push(st === 'normal' ? 100 : st === 'risk' ? 35 : 65);
  });
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}
