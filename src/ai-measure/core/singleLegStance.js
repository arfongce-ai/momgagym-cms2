// ai-measure/core/singleLegStance.js
// ════════════════════════════════════════════════════════════════════════
//  한다리서기 검사(SLST, Single Leg Stance Test) 판정 — 순수 함수/상수.
//  reactiveJump.js 와 동일한 설계 철학:
//   · 현장 튜닝 상수를 SLST_TUNING 한 곳에 모음
//   · valid 플래그로 무효 측정(랜드마크 신뢰도 부족) 원천 차단
//   · 판정 근거를 결과에 그대로 노출(측정 정직성)
//
//  ── 입력 계약 ──
//   이 모듈은 원시 랜드마크가 아니라, 상위 캡처 레이어가 프레임별로
//   isVisible()/areLandmarksReliable()(postureMath.js)로 신뢰도를 이미 검증하고
//   구간별로 집계한 "시행(trial) 요약값"을 입력으로 받는다.
//   (reactiveJump.js 가 원시 랜드마크가 아닌 flights[] 이벤트를 받는 것과 동일한
//    "추적(tracking)"과 "판정(judgment)"의 역할 분리)
//
//  ── 판정 2단계 구조 ──
//   1) 즉시확정(immediate): 균형 상실 · 스텝아웃 · 최소 유지시간 미달 — 1회만
//      나와도 그 시행은 즉시 RISK. 이미 명백한 실패라 재현성 확인이 불필요하다.
//   2) 재현성확정(reproducibility): 흔들림(sway) · 골반기울기(Trendelenburg) ·
//      유지시간 경계 미달처럼 애매한 신호 — 같은 다리의 2회 시행 모두에서
//      반복돼야 CAUTION/RISK로 확정한다. 한 번만 나오면 노이즈일 수 있어
//      불필요한 재측정 지시를 피한다.
//
//  ⚠ 측정 한계(결과에 그대로 노출):
//   · 좌우 비대칭은 "질환"으로 진단하지 않는다. 임상 해석은 Momi/전문가 몫이며,
//     여기서는 측정된 패턴(정상/주의/위험/확인 필요)만 노출한다.
//   · 아래 임계값은 실측 캡처 데이터 보정 전까지의 시작 기본값이다.
// ════════════════════════════════════════════════════════════════════════

export const SLST_TUNING = {
  // ── 목표/최소 유지 시간(ms) ──
  targetHoldMs: 30000,          // 목표 유지시간(일반 성인 기준, 참고치)
  minAcceptableHoldMs: 10000,   // 이보다 짧으면 즉시확정 실패(테스트 자체가 무의미)
  cautionHoldMs: 20000,         // 최소는 넘겼지만 목표에는 못 미친 경계 구간 기준선

  // ── 흔들림(sway) 경로 길이(cm) — 유지 구간 동안 발목/무게중심 이동 누적 ──
  swayCautionCm: 8,
  swayRiskCm: 15,

  // ── 골반 기울기(Trendelenburg pattern, deg) ──
  pelvicTiltCautionDeg: 5,
  pelvicTiltRiskDeg: 10,

  // ── 동적 무릎 외반(dynamic knee valgus, deg) — 보조 신호, 값이 있을 때만 사용 ──
  kneeValgusCautionDeg: 10,
  kneeValgusRiskDeg: 15,

  // ── 좌우 비대칭 판정: 두 다리 등급(rank) 차이가 이 이상이면 "비대칭 확인 필요" ──
  asymmetryRankGap: 1,
};

const STATUS_RANK = { normal: 0, caution: 1, risk: 2, unknown: 3 };

// 재현성확정된 소프트 플래그가 어떤 등급으로 확정되는지 명시적으로 정의.
// (플래그 이름 규칙에 암묵적으로 의존하지 않도록 - 새 플래그 추가 시 여기 함께 추가)
const FLAG_SEVERITY = {
  hold_time_borderline: 'caution',
  sway_borderline: 'caution',
  sway_high: 'risk',
  pelvic_tilt_borderline: 'caution',
  pelvic_tilt_high: 'risk',
  knee_valgus_borderline: 'caution',
  knee_valgus_high: 'risk',
};

function worse(a, b) {
  return (STATUS_RANK[b] ?? 0) > (STATUS_RANK[a] ?? 0) ? b : a;
}

/**
 * 단일 시행(trial) 판정.
 * @param {object} trial
 * @param {boolean} trial.valid           상위 레이어의 랜드마크 신뢰도 게이트 통과 여부
 * @param {string}  [trial.reason]        valid=false 사유
 * @param {boolean} [trial.balanceLoss]   균형 상실(반대발 착지/손짚음) 여부 — 즉시확정 신호
 * @param {boolean} [trial.stepOut]       지지발 이동(스텝아웃) 여부 — 즉시확정 신호
 * @param {number}  trial.holdTimeMs      실제 유지 시간(ms)
 * @param {number}  [trial.swayPathCm]    유지 구간 동안 흔들림 누적 경로(cm)
 * @param {number}  [trial.pelvicTiltDeg] 최대 골반 기울기(Trendelenburg, deg)
 * @param {number}  [trial.kneeValgusDeg] 최대 동적 무릎 외반각(deg, 선택 신호)
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

  // ── 1) 즉시확정: 균형 상실 / 스텝아웃 / 최소 유지시간 미달 ──
  const immediateReasons = [];
  if (trial.balanceLoss) immediateReasons.push('balance_loss');
  if (trial.stepOut) immediateReasons.push('step_out');
  if ((trial.holdTimeMs ?? 0) < SLST_TUNING.minAcceptableHoldMs) immediateReasons.push('hold_time_insufficient');

  const base = {
    holdTimeMs: trial.holdTimeMs ?? null,
    swayPathCm: trial.swayPathCm ?? null,
    pelvicTiltDeg: trial.pelvicTiltDeg ?? null,
    kneeValgusDeg: trial.kneeValgusDeg ?? null,
  };

  if (immediateReasons.length) {
    return { valid: true, status: 'risk', immediateFail: true, immediateReasons, softFlags: [], ...base };
  }

  // ── 2) 재현성확정 대상: 경계성 소프트 신호 수집(이 시행 자체는 RISK가 아님) ──
  let status = 'normal';
  const softFlags = [];

  if ((trial.holdTimeMs ?? 0) < SLST_TUNING.cautionHoldMs) {
    softFlags.push('hold_time_borderline');
    status = worse(status, 'caution');
  }
  if (trial.swayPathCm != null) {
    if (trial.swayPathCm >= SLST_TUNING.swayRiskCm) { softFlags.push('sway_high'); status = worse(status, 'risk'); }
    else if (trial.swayPathCm >= SLST_TUNING.swayCautionCm) { softFlags.push('sway_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.pelvicTiltDeg != null) {
    if (trial.pelvicTiltDeg >= SLST_TUNING.pelvicTiltRiskDeg) { softFlags.push('pelvic_tilt_high'); status = worse(status, 'risk'); }
    else if (trial.pelvicTiltDeg >= SLST_TUNING.pelvicTiltCautionDeg) { softFlags.push('pelvic_tilt_borderline'); status = worse(status, 'caution'); }
  }
  if (trial.kneeValgusDeg != null) {
    if (trial.kneeValgusDeg >= SLST_TUNING.kneeValgusRiskDeg) { softFlags.push('knee_valgus_high'); status = worse(status, 'risk'); }
    else if (trial.kneeValgusDeg >= SLST_TUNING.kneeValgusCautionDeg) { softFlags.push('knee_valgus_borderline'); status = worse(status, 'caution'); }
  }

  return { valid: true, status, immediateFail: false, softFlags, ...base };
}

/**
 * 한쪽 다리의 2회 시행(trial1, trial2)을 재현성 로직으로 결합.
 * - 어느 한 시행이라도 즉시확정 RISK면 → 그대로 RISK(이미 명백, 재현성 확인 불필요).
 * - 둘 다 무효면 → unknown.
 * - 하나만 유효하면 → 그 시행 결과를 그대로 쓰되 재측정 필요 플래그를 남긴다.
 * - 둘 다 유효하면 → 같은 softFlag가 양쪽에서 반복된 것만 CAUTION/RISK로 확정하고,
 *   한쪽에만 나온 소프트 신호는 상태를 올리지 않고 "미확정 관찰"로만 남긴다.
 */
function combineLegTrials(trial1, trial2) {
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
 * SLST 종합 판정 — 좌우 두 다리를 함께 평가.
 * @param {object} input
 * @param {{trial1:object, trial2:object}} [input.left]
 * @param {{trial1:object, trial2:object}} [input.right]
 * @returns {object} valid:false 시 { valid:false, reason, message }
 */
export function evaluateSingleLegStance(input = {}) {
  const left = input.left ? combineLegTrials(input.left.trial1, input.left.trial2) : null;
  const right = input.right ? combineLegTrials(input.right.trial1, input.right.trial2) : null;

  if (!left && !right) {
    return { valid: false, reason: 'no_trials', message: '한다리서기 측정 데이터가 없습니다.' };
  }

  const overallStatus = [left?.status, right?.status].filter(Boolean).reduce((acc, s) => worse(acc, s), 'normal');

  const bothKnown = !!(left && right && left.status !== 'unknown' && right.status !== 'unknown');
  const rankGap = bothKnown ? Math.abs((STATUS_RANK[left.status] ?? 0) - (STATUS_RANK[right.status] ?? 0)) : 0;
  const asymmetryFlag = bothKnown && rankGap >= SLST_TUNING.asymmetryRankGap;

  return {
    valid: true,
    kind: 'stance',
    status: overallStatus,
    left,
    right,
    asymmetryFlag,
  };
}
