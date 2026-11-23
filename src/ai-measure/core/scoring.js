// [2026-11-17] 종합 점수 단일 기준 — 상세 화면·리포트 목록·종합/회차 비교가 모두 여기 함수를 쓴다.
//  규칙: ① 판정 근거 2개 미만이면 점수 없음(null) ② 정상=100·주의=65·위험=35 평균
//        ③ 측정 단계에서 이미 확정된 종합 판정(status)이 있으면 점수가 그 등급 범위를 넘지 않게 상한(위험≤59, 주의≤79).
import { cadenceRangeFor, stanceRangeFor, verticalOscRangeFor } from './gaitMode';

export { capScoreByStatus } from './scoreCap';

// ── 보행 ──
export const GAIT_RANGES = {
  cadence: { good: [160, 180], warn: [150, 190], unit: 'SPM', label: '케이던스' },
  stance: { good: [55, 65], warn: [50, 70], unit: '%', label: '입각기' },
  trunkLean: { good: [4, 12], warn: [0, 18], unit: '°', label: '몸통 기울기' },
  pelvicDrop: { good: [0, 4], warn: [0, 7], unit: '%', label: '골반 드롭' },
  kneeSym: { good: [92, 100], warn: [85, 100], unit: '%', label: '무릎 대칭' },
  stride: { good: [0.7, 1.1], warn: [0.5, 1.4], unit: '×', label: '보폭/신장' },
};
// 구버전 데이터(metrics 없음) 폴백 — 최상위 필드에서 끌어온다.
export function normalizeGaitMetrics(report) {
  const m = report?.metrics || {};
  const top = report || {};
  return {
    cadence: m.cadence ?? top.cadence ?? 0,
    stancePct: m.stancePct ?? top.stancePct ?? null,
    swingPct: m.swingPct ?? top.swingPct ?? null,
    totalSteps: m.totalSteps ?? top.totalSteps ?? 0,
    valid: m.valid ?? top.valid,
    angles: m.angles ?? top.angles ?? { hip: {}, knee: {}, ankle: {} },
    trunkLean: m.trunkLean ?? { avg: null, max: null, min: null },
    kneeFlexion: m.kneeFlexion ?? { left: {}, right: {} },
    pelvicDrop: m.pelvicDrop ?? { avg: null, max: null, min: null },
    pelvicDropAbs: m.pelvicDropAbs ?? null,
    verticalOscillation: m.verticalOscillation ?? null,
    kneeSymmetry: m.kneeSymmetry ?? null,
    strideToHeight: m.strideToHeight ?? null,
    // [임상 플래그 추가 2026-09-14] 후면뷰 전용(Trendelenburg)/정면뷰 전용(외반·내반) —
    // ClinicalFlagCard.jsx의 buildClinicalFlag가 report.orientation과 함께 읽는다.
    pelvicDropAssessment: m.pelvicDropAssessment ?? null,
    kneeAlignment: m.kneeAlignment ?? null,
    stepWidthAssessment: m.stepWidthAssessment ?? null,
    scissoringAssessment: m.scissoringAssessment ?? null,
    crossoverAssessment: m.crossoverAssessment ?? null,
    armCrossAssessment: m.armCrossAssessment ?? null,
    toeAngleAssessment: m.toeAngleAssessment ?? null,
    // [2026-11-23] 접지·체공·오버스트라이드·팔 스윙(runMechanics.js) — 없으면 null(구버전 기록)
    runMechanics: m.runMechanics ?? null,
    // [체간 시상면 기울기 2026-09-14] 측면뷰 전용 — 보행(Gait)에만 적용, 스프린트는
    // 가속기/최고속기 구간별 기준 분리가 필요해 보류(사용자 확인, ways-of-working 참고).
    trunkLeanAssessment: m.trunkLeanAssessment ?? null,
    strideLengthAssessment: m.strideLengthAssessment ?? null,
  };
}



// 종합 점수: 핵심 지표가 정상범위에 들면 가점 (0~100)
// [2026-09-22 버그수정] trunkLean·pelvicDrop은 gaitBiomechanics.js 원문 주석대로
// 특정 촬영각(각각 측면뷰/후면뷰)에서만 의미가 있고, 그 외 각도에서는 노이즈다
// (예: 정면뷰에서 trunkLean은 거의 0에 수렴 → GAIT_RANGES.trunkLean 기준 "주의"로
// 잘못 표시됨). orientation을 알 때는 맞는 각도의 값만 점수에 반영하고, 구버전
// 리포트처럼 orientation이 없어 알 수 없을 때만 기존처럼 그대로 반영한다.
export function computeGaitScore(m, orientation) {
  const pelvicDropOk = !orientation || orientation === 'back';
  const trunkLeanOk = !orientation || orientation === 'side';
  const checks = [
    [m.cadence, cadenceRangeFor(m.cadence)],
    [m.stancePct, stanceRangeFor(m.cadence)],
    [trunkLeanOk ? m.trunkLean?.avg : null, GAIT_RANGES.trunkLean],
    [pelvicDropOk ? m.pelvicDropAbs : null, GAIT_RANGES.pelvicDrop],
    [m.verticalOscillation, verticalOscRangeFor(m.cadence)],
    [m.kneeSymmetry, GAIT_RANGES.kneeSym],
    [m.strideToHeight, GAIT_RANGES.stride],
  ];
  let score = 0, n = 0;
  for (const [v, r] of checks) {
    if (v == null || Number.isNaN(v) || !r) continue;
    n++;
    if (v >= r.good[0] && v <= r.good[1]) score += 100;
    else if (v >= r.warn[0] && v <= r.warn[1]) score += 65;
    else score += 30;
  }
  // [2026-11-17] 판정 지표가 2개 미만이면 점수 없음(단일 지표가 곧 종합 점수가 되는 것 방지).
  return n >= 2 ? Math.round(score / n) : null;
}


// ── 점프 ──
export const JUMP_RANGE = {
  trunk: { good: [0, 12], warn: [0, 20], unit: '°' },
  pelvis: { good: [0, 4], warn: [0, 7], unit: '%' },
  align: { good: [80, 100], warn: [60, 100], unit: '점' },
};
const jumpBand = (value, range) => (value >= range.good[0] && value <= range.good[1] ? 100
  : value >= range.warn[0] && value <= range.warn[1] ? 65 : 35);
export function computeJumpScore(report) {
  if (report?.valid === false) return null;
  const b = report?.biomech || {};
  const values = [];
  const add = (v, r) => { if (v == null || Number.isNaN(Number(v))) return; values.push(jumpBand(Number(v), r)); };
  add(b.trunkLeanChange, JUMP_RANGE.trunk);
  add(b.pelvicImbalance, JUMP_RANGE.pelvis);
  add(b.extensionAlignment?.alignmentScore, JUMP_RANGE.align);
  if ((report?.jumpType === 'reactive' || report?.rsi) && report?.rsi?.rsi != null) {
    const rsi = Number(report.rsi.rsi);
    values.push(rsi >= 2 ? 100 : rsi >= 1.5 ? 80 : rsi >= 1 ? 60 : 35);
  }
  return values.length >= 2 ? Math.round(values.reduce((a, c) => a + c, 0) / values.length) : null;
}
