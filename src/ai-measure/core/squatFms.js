// ai-measure/core/squatFms.js
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트 — FMS 방식 점수화 + 보상패턴별 색상 오버레이 근거.
//
//  ── 왜 만들었나 ──
//  기존 라이브 화면은 "깊이 120%" 같은 숫자와 관절각 라벨만 띄웠는데,
//  (1) 숫자의 의미를 알기 어렵고 (2) 어느 부위가 문제인지 한눈에 안 보였다.
//  현장 요청: "정상이면 파란색, 이상이면 붉은색으로 부위별 표시해 달라 —
//  그게 신뢰도가 높다."  이 파일은 그 판단 근거만 담당한다(그리기는 화면 몫).
//
//  ── 채점 기준(FMS Deep Squat, 3/2/1/0) ──
//   3점: 대퇴골이 수평 이하, 상체가 경골과 평행(또는 더 수직), 무릎이 안쪽으로
//        무너지지 않음, 팔(막대)이 발 위 수직선에 정렬.
//   2점: 위 기준을 뒤꿈치를 받친 상태에서 충족(= 뒤꿈치 들림/발목 제한 보상).
//   1점: 위 항목 중 하나라도 미충족.
//   0점: 통증 — 영상으로 판별 불가라 자동 채점 대상에서 제외하고,
//        트레이너가 수동으로 표시하는 값으로 남긴다(painReported).
//
//  ── 한계(중요) ──
//  카메라 한 대의 2D 랜드마크로는 발의 회외/편평발, 실제 뒤꿈치 접지압 같은
//  항목을 신뢰성 있게 볼 수 없다. 여기서는 2D로 재현 가능한 항목만 판정하고,
//  나머지는 'unknown'으로 남겨 화면에서 회색 처리한다 — 못 보는 것을 본 척
//  하지 않는 것이 이 프로젝트의 원칙이다.
//
//  각 지표의 임계값은 squatBiomechanics.js의 SQUAT_TUNING을 그대로 재사용해
//  라이브 오버레이와 최종 리포트가 서로 다른 기준으로 말하지 않게 한다.
// ════════════════════════════════════════════════════════════════════════
import { SQUAT_TUNING } from './squatBiomechanics';

// 오버레이 색상 — 요청대로 정상은 푸른색 계열, 이상은 붉은색.
// 판정 불가는 회색으로 두어 "정상"과 혼동되지 않게 한다.
export const FMS_SEGMENT_COLORS = {
  normal: 'rgba(56,189,248,0.95)',   // sky-400 — 정상
  caution: 'rgba(251,191,36,0.95)',  // amber-400 — 경계
  risk: 'rgba(248,113,113,0.95)',    // red-400 — 이상
  unknown: 'rgba(148,163,184,0.75)', // slate-400 — 판정 불가
};

const RANK = { normal: 0, caution: 1, risk: 2, unknown: -1 };

// 팔이 수직에서 앞으로 떨어진 각 — FMS의 "팔이 앞쪽으로 떨어짐" 보상패턴.
// 광배근/흉추 신전 제한에서 흔하다. 임상 합의 수치가 따로 없어 상체 기울기
// 임계값에 준해 잡은 출발값이며, 실제 캡처 데이터로 보정이 필요하다.
export const ARM_DROP_CAUTION_DEG = 20;
export const ARM_DROP_RISK_DEG = 35;


/**
 * 두 상태 중 더 나쁜 쪽을 고른다. unknown은 "정보 없음"이라 다른 값이 있으면 밀린다.
 */
export function worseStatus(a, b) {
  if (a == null || a === 'unknown') return b ?? 'unknown';
  if (b == null || b === 'unknown') return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * 값 하나를 caution/risk 임계값으로 3단계 판정. 값이 없으면 unknown.
 * 모든 지표가 "클수록 나쁨" 방향이라 부호 처리는 호출부에서 절댓값으로 넘긴다.
 */
function grade(value, cautionAt, riskAt) {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  if (value >= riskAt) return 'risk';
  if (value >= cautionAt) return 'caution';
  return 'normal';
}

/**
 * 대퇴 경사각(0°=패러렐 도달, 90°=선 자세)을 "패러렐까지의 진행도 %"로 바꾼다.
 * 라이브 게이지가 100%를 넘지 않게 해, 예전의 "깊이 120%" 같은 해석 불가능한
 * 숫자가 다시 나오지 않도록 한다.
 */
export function depthPctFromThighIncline(thighInclineDeg) {
  if (thighInclineDeg == null || !Number.isFinite(thighInclineDeg)) return 0;
  const clamped = Math.max(0, Math.min(90, thighInclineDeg));
  return Math.round(((90 - clamped) / 90) * 100);
}

/**
 * 한 프레임(또는 한 반복의 최악값)의 측정치로 부위별 상태를 판정한다.
 *
 * @param {object} m 측정치
 *   thighInclineDeg  대퇴 경사각(0=패러렐, 클수록 얕음)   — 측면에서 신뢰도 높음
 *   torsoLeanDeg     상체 전방 기울기                      — 측면
 *   kneeValgusDeg    동적 무릎 외반(안쪽 무너짐)           — 정면
 *   pelvicTiltDeg    골반 좌우 기울기(비대칭 체중이동)     — 정면
 *   armDropDeg       팔이 수직에서 앞으로 떨어진 각        — 측면
 *   heelLift         뒤꿈치 들림(불리언)                   — 측면
 * @param {'front'|'side'} view 현재 촬영 방향 — 그 방향에서 볼 수 없는 지표는
 *   판정하지 않고 unknown으로 남긴다(정면에서 상체 기울기를 재는 식의 오판 방지).
 * @returns {object} 부위별 상태 + 보상패턴 플래그
 */
export function evaluateSquatFrame(m = {}, view = 'front') {
  const isSide = view === 'side';
  const isFront = view === 'front';

  // 측면에서만 신뢰할 수 있는 지표들
  const depth = isSide
    ? grade(m.thighInclineDeg, SQUAT_TUNING.depthCautionDeg, SQUAT_TUNING.depthRiskDeg)
    : 'unknown';
  const torso = isSide
    ? grade(m.torsoLeanDeg, SQUAT_TUNING.torsoLeanCautionDeg, SQUAT_TUNING.torsoLeanRiskDeg)
    : 'unknown';
  const arms = isSide
    ? grade(m.armDropDeg, ARM_DROP_CAUTION_DEG, ARM_DROP_RISK_DEG)
    : 'unknown';
  // 뒤꿈치 들림은 불리언이라 등급이 아니라 즉시 이상으로 본다(FMS에서도 2점 강등 사유).
  const heel = isSide ? (m.heelLift ? 'risk' : 'normal') : 'unknown';

  // 정면에서만 신뢰할 수 있는 지표들
  const knee = isFront
    ? grade(m.kneeValgusDeg, SQUAT_TUNING.kneeValgusCautionDeg, SQUAT_TUNING.kneeValgusRiskDeg)
    : 'unknown';
  const pelvis = isFront
    ? grade(m.pelvicTiltDeg, SQUAT_TUNING.pelvicTiltCautionDeg, SQUAT_TUNING.pelvicTiltRiskDeg)
    : 'unknown';

  const compensations = [];
  if (depth === 'caution' || depth === 'risk') compensations.push('depth_insufficient');
  if (torso === 'caution' || torso === 'risk') compensations.push('excessive_trunk_flexion');
  if (arms === 'caution' || arms === 'risk') compensations.push('arms_fall_forward');
  if (heel === 'risk') compensations.push('heel_lift');
  if (knee === 'caution' || knee === 'risk') compensations.push('knee_valgus');
  if (pelvis === 'caution' || pelvis === 'risk') compensations.push('asymmetric_weight_shift');

  return {
    view,
    parts: { depth, torso, arms, heel, knee, pelvis },
    compensations,
    overall: [depth, torso, arms, heel, knee, pelvis].reduce(worseStatus, 'unknown'),
  };
}

/**
 * 정면/측면 판정을 합쳐 FMS 딥 스쿼트 점수(1~3)를 낸다.
 * 통증(0점)은 영상으로 알 수 없으므로 painReported로 명시적으로 받는다.
 *
 * @param {object} front evaluateSquatFrame(view:'front') 결과
 * @param {object} side  evaluateSquatFrame(view:'side') 결과
 * @param {boolean} painReported 트레이너가 통증을 표시했는지
 * @returns {{score:number|null, reasons:string[], criteria:object}}
 */
export function scoreDeepSquatFms(front, side, painReported = false) {
  if (painReported) {
    return { score: 0, reasons: ['pain_reported'], criteria: {} };
  }
  if (!front || !side) {
    // 한쪽 방향만으로는 FMS 점수를 확정하지 않는다 — 못 본 항목을 통과로
    // 처리하면 점수가 실제보다 후해진다.
    return { score: null, reasons: ['incomplete_views'], criteria: {} };
  }

  const ok = (s) => s === 'normal';
  const criteria = {
    depthBelowParallel: ok(side.parts.depth),
    trunkParallelToTibia: ok(side.parts.torso),
    kneesAligned: ok(front.parts.knee),
    armsAligned: ok(side.parts.arms),
    symmetricWeight: ok(front.parts.pelvis),
  };

  const failed = Object.entries(criteria)
    .filter(([, pass]) => !pass)
    .map(([k]) => k);

  const heelLifted = side.parts.heel === 'risk';

  // 3점: 모든 기준 충족 + 뒤꿈치 유지.
  if (failed.length === 0 && !heelLifted) {
    return { score: 3, reasons: [], criteria };
  }
  // 2점: 기준 자체는 충족했지만 뒤꿈치가 들림(= 받침을 대야 가능한 수준).
  if (failed.length === 0 && heelLifted) {
    return { score: 2, reasons: ['heel_lift'], criteria };
  }
  // 1점: 기준 중 하나라도 미충족.
  return { score: 1, reasons: failed.concat(heelLifted ? ['heel_lift'] : []), criteria };
}

// 보상패턴 → 화면에 띄울 한글 문구(현장 용어 기준).
export const COMPENSATION_KO = {
  depth_insufficient: '대퇴골이 수평까지 내려가지 않음',
  excessive_trunk_flexion: '지나친 상체 굽힘',
  arms_fall_forward: '팔이 앞쪽으로 떨어짐',
  heel_lift: '뒤꿈치 들림',
  knee_valgus: '무릎 안쪽 무너짐(내반슬)',
  asymmetric_weight_shift: '비대칭 체중 이동',
};

export const FMS_SCORE_KO = {
  3: '3점 — 보상 없이 기준 충족',
  2: '2점 — 뒤꿈치 받침이 필요한 수준',
  1: '1점 — 기준 미충족(보상 동반)',
  0: '0점 — 통증 있음',
};

// 스켈레톤 뼈대를 어느 부위 판정에 연결할지. 화면은 이 표를 보고 각 선의
// 색을 정한다. (MediaPipe 랜드마크 인덱스 쌍)
export const BONE_PART_MAP = [
  // 상체(몸통) — 상체 기울기
  [[11, 23], 'torso'], [[12, 24], 'torso'], [[11, 12], 'torso'],
  // 팔 — 팔 떨어짐
  [[11, 13], 'arms'], [[13, 15], 'arms'], [[12, 14], 'arms'], [[14, 16], 'arms'],
  // 골반 — 좌우 기울기/체중이동
  [[23, 24], 'pelvis'],
  // 대퇴 — 깊이
  [[23, 25], 'depth'], [[24, 26], 'depth'],
  // 정강이 — 무릎 정렬
  [[25, 27], 'knee'], [[26, 28], 'knee'],
  // 발 — 뒤꿈치 들림
  [[27, 29], 'heel'], [[27, 31], 'heel'], [[29, 31], 'heel'],
  [[28, 30], 'heel'], [[28, 32], 'heel'], [[30, 32], 'heel'],
];

/**
 * 뼈대 한 쌍이 어느 부위에 속하는지 조회. 매핑에 없으면 null.
 */
export function partForBone(a, b) {
  for (const [[x, y], part] of BONE_PART_MAP) {
    if ((x === a && y === b) || (x === b && y === a)) return part;
  }
  return null;
}

/**
 * 부위별 상태 → 그 뼈대에 쓸 색.
 */
export function colorForBone(a, b, parts) {
  const part = partForBone(a, b);
  if (!part || !parts) return FMS_SEGMENT_COLORS.unknown;
  return FMS_SEGMENT_COLORS[parts[part] ?? 'unknown'] ?? FMS_SEGMENT_COLORS.unknown;
}
