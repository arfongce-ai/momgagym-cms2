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

  return { valid: true, status, immediateFail: false, softFlags, ...base };
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
 * 오버헤드 딥 스쿼트 종합 판정.
 * @param {object} input
 * @param {object} [input.trial1]
 * @param {object} [input.trial2]
 * @returns {object} valid:false 시 { valid:false, reason, message }
 */
export function evaluateSquatBiomechanics(input = {}) {
  if (!input.trial1 && !input.trial2) {
    return { valid: false, reason: 'no_trials', message: '오버헤드 딥 스쿼트 측정 데이터가 없습니다.' };
  }

  return { valid: true, kind: 'squat', ...combineTrials(input.trial1, input.trial2) };
}
