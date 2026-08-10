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
//   2) 재현성확정(reproducibility): 골반기울기(Trendelenburg) · 유지시간 경계
//      미달처럼 애매한 신호 — 같은 다리의 2회 시행 모두에서 반복돼야
//      CAUTION/RISK로 확정한다. 한 번만 나오면 노이즈일 수 있어 불필요한
//      재측정 지시를 피한다.
//
//  ⚠ 측정 한계(결과에 그대로 노출):
//   · 좌우 비대칭은 "질환"으로 진단하지 않는다. 임상 해석은 Momi/전문가 몫이며,
//     여기서는 측정된 패턴(정상/주의/위험/확인 필요)만 노출한다.
//   · 아래 임계값은 실측 캡처 데이터 보정 전까지의 시작 기본값이다.
//  [2026-08-02] 판정에서 흔들림(sway 경로 누적) 신호를 뺐다 — 발을 드는
//  순간(lift)과 다시 딛는 순간(touch)만으로 유지시간을 확정하는 것이 핵심
//  측정 대상이고, 흔들림은 원래도 키(cm 환산) 의존 부가 신호였다. 균형 상실
//  (balanceLoss)은 흔들림 누적이 아니라 순간 이동 속도로 별도 판정되므로
//  그대로 유지된다.
// ════════════════════════════════════════════════════════════════════════

export const SLST_TUNING = {
  // ── 목표/최소 유지 시간(ms) ──
  targetHoldMs: 30000,          // 목표 유지시간(일반 성인 기준, 참고치)
  minAcceptableHoldMs: 10000,   // 이보다 짧으면 즉시확정 실패(테스트 자체가 무의미)
  cautionHoldMs: 20000,         // 최소는 넘겼지만 목표에는 못 미친 경계 구간 기준선

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
 * @param {number}  trial.holdTimeMs      실제 유지 시간(ms) — 발을 든 순간부터 다시 딛는 순간까지
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

/**
 * SLST 종합 판정 — 눈뜨고/눈감고 두 조건을 함께 평가.
 *
 * 눈뜨고·눈감고는 서로 다른 조건(눈감으면 정상인도 흔들림·유지시간이 짧아지는
 * 것이 자연스럽다)이라, combineLegTrials()의 "같은 신호가 2회 다 나와야 확정"
 * 재현성 로직으로 서로 섞어 판정하지 않는다 — 각 조건을 evaluateSingleLegStance()
 * 로 독립적으로(조건 내부에서는 기존과 동일하게 다리당 1회 시행) 판정한 뒤,
 * 종합 status만 더 나쁜 쪽으로 취합한다.
 *
 * @param {object} input
 * @param {{left, right}} [input.open]   눈뜨고 조건의 {trial1} 좌/우 입력
 * @param {{left, right}} [input.closed] 눈감고 조건의 {trial1} 좌/우 입력
 * @returns {object} valid:false 시 { valid:false, reason, message }
 */
export function evaluateSingleLegStanceWithEyes(input = {}) {
  const eyesOpen = evaluateSingleLegStance(input.open || {});
  const eyesClosed = evaluateSingleLegStance(input.closed || {});

  if (!eyesOpen.valid && !eyesClosed.valid) {
    return { valid: false, reason: 'no_trials', message: '한다리서기 측정 데이터가 없습니다.' };
  }

  const status = worse(
    eyesOpen.valid ? eyesOpen.status : 'unknown',
    eyesClosed.valid ? eyesClosed.status : 'unknown',
  );

  return {
    valid: true,
    kind: 'stance',
    status,
    eyesOpen,
    eyesClosed,
    // 하위 호환: unifiedReport.js 지표 추출(left.trials.0.holdTimeMs 등)·
    // crossMeasureContext.js·momiService.js처럼 기존 { left, right, asymmetryFlag }
    // 형태를 그대로 읽던 화면이 계속 정상 동작하도록, 눈뜨고 조건을 대표값으로 얹는다.
    left: eyesOpen.valid ? eyesOpen.left : null,
    right: eyesOpen.valid ? eyesOpen.right : null,
    asymmetryFlag: eyesOpen.valid ? eyesOpen.asymmetryFlag : false,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  [리포트 통합 2026-08-09] 아래 세 함수는 원래 StanceAnalysisHub.jsx(측정
//  화면)에 있었다. StanceReportDashboard.jsx(저장된 리포트를 다시 보는 화면
//  — 결과리포트 통합 프로젝트로 신설)도 똑같은 점수·상태 판정이 필요한데,
//  두 화면 파일이 서로를 import하면 순환 참조가 생긴다. 판정 로직 자체는
//  이 파일(core)에 두는 게 원래 맞는 자리라 여기로 옮기고, 두 화면 다 여기서
//  가져다 쓰게 한다(재구현 아님 — 그대로 이동).
// ════════════════════════════════════════════════════════════════════════

// leg = combineLegTrials() 결과(evaluateSingleLegStanceWithEyes의 eyesOpen.left 등).
// 즉시확정(균형상실/스텝아웃/최소유지시간 미달)은 특정 항목이 원인이라 그 항목만
// risk로 잡고 나머지는 판정 보류(unknown)로 남긴다 — 안 그러면 실제로 재보지도
// 않은 지표까지 risk로 잘못 표시된다.
export function stanceMetricStatus(leg, flagPrefix, immediateKey) {
  if (!leg) return 'unknown';
  if (leg.basis === 'immediate') {
    return immediateKey && leg.immediateReasons?.includes(immediateKey) ? 'risk' : 'unknown';
  }
  const confirmed = (leg.repeatedFlags || []).find((f) => f.startsWith(flagPrefix));
  if (confirmed) return confirmed.endsWith('_high') ? 'risk' : 'caution';
  const unconfirmed = (leg.unconfirmedFlags || []).some((f) => f.startsWith(flagPrefix));
  return unconfirmed ? 'observed' : 'normal';
}

// 같은 다리·조건의 두 시행 중 "더 나쁜 값"을 대표값으로(측정 정직성 원칙 —
// squatBiomechanics.js·squatFms.js와 동일). 유지시간은 짧을수록, 각도는
// 클수록 나쁘다.
export function legMetrics(leg) {
  const trials = (leg?.trials || []).filter((t) => t.valid);
  const worst = (key, dir) => {
    const vals = trials.map((t) => t[key]).filter((v) => v != null);
    if (!vals.length) return null;
    return Math.round((dir === 'min' ? Math.min(...vals) : Math.max(...vals)) * 10) / 10;
  };
  return {
    holdMs: worst('holdTimeMs', 'min'),
    pelvicTiltDeg: worst('pelvicTiltDeg', 'max'),
    kneeValgusDeg: worst('kneeValgusDeg', 'max'),
  };
}

export function computeStanceScore(report) {
  if (report?.valid === false) return 0;
  const scores = [];
  [report?.eyesOpen, report?.eyesClosed].forEach((cond) => {
    if (!cond?.valid) return;
    [cond.left, cond.right].forEach((leg) => {
      if (!leg || leg.status === 'unknown') return;
      scores.push(leg.status === 'normal' ? 100 : leg.status === 'risk' ? 35 : 65);
    });
  });
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}
