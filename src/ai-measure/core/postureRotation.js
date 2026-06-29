// ai-measure/core/postureRotation.js
// ════════════════════════════════════════════════════════════════════════
//  전신 '축 회전(axial rotation)' 종합 분석 — 4면(정면/좌/후/우) 데이터 종합.
//
//  목적: 단일 정면 2D 로는 불가능한 '몸이 카메라 축을 기준으로 비틀린 정도'를,
//        여러 면의 측정값을 교차 검증해 분절별로 추정한다. 특히 분절 간
//        '상대 비틀림'(예: 머리는 좌회전, 골반은 우회전 → 척추 비틀림)을 본다.
//
//  ⚠ 측정 정직성
//   1) BlazePose 2D + 추정 z 로는 절대 회전 각도(°)를 정밀히 낼 수 없다.
//      → 도(°)로 단정하지 않고 '방향 + 단계(none/mild/marked) + 신뢰도'로 표현.
//   2) 신뢰도는 '여러 면/신호가 같은 방향을 가리키는 일치도'로 정의한다.
//      면이 부족하거나 신호가 엇갈리면 신뢰도를 낮추거나 보류(insufficient).
//   3) 회전 방향 라벨은 '사람 기준'(왼쪽으로 돎 = left). 카메라 미러링 영향을
//      받지 않도록 어깨/골반의 yaw 부호와 폭 단축을 함께 본다.
//
//  입력: perViewAnalysis = { front?, left?, back?, right? }
//        각 면 analysis 는 analyzePostureFromLandmarks 결과(rotations 포함).
//  출력: { segments: {head,trunk,pelvis,lower}, axialTwist, confidence, available }
// ════════════════════════════════════════════════════════════════════════

const LEVELS = ['none', 'mild', 'marked'];

function levelFromDeg(absDeg, mildAt, markedAt) {
  if (absDeg == null) return null;
  if (absDeg >= markedAt) return 'marked';
  if (absDeg >= mildAt) return 'mild';
  return 'none';
}

// 여러 yaw 신호를 모아 대표 방향/크기 산출.
// 입력: [{deg, weight}] (deg 부호: +면 한쪽, −면 반대쪽)
// 반환: { signedDeg, absDeg, direction, agreement } | null
function combineYaw(samples, { mildAt, markedAt }) {
  const valid = samples.filter((s) => s && s.deg != null && Number.isFinite(s.deg));
  if (!valid.length) return null;
  const totalW = valid.reduce((a, s) => a + (s.weight || 1), 0);
  const signedDeg = valid.reduce((a, s) => a + s.deg * (s.weight || 1), 0) / totalW;
  const absDeg = Math.abs(signedDeg);
  // 일치도: 부호가 다수 방향과 같은 표본 비중
  const majoritySign = Math.sign(signedDeg) || 1;
  const agreeW = valid
    .filter((s) => Math.sign(s.deg) === majoritySign || s.deg === 0)
    .reduce((a, s) => a + (s.weight || 1), 0);
  const agreement = totalW > 0 ? agreeW / totalW : 0;
  return {
    signedDeg: round1(signedDeg),
    absDeg: round1(absDeg),
    direction: absDeg < 1.5 ? 'center' : majoritySign > 0 ? 'right' : 'left',
    level: levelFromDeg(absDeg, mildAt, markedAt),
    agreement: round2(agreement),
    n: valid.length,
  };
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// 폭 단축 기반 yaw 보조 신호: 정면에서 폭이 좁을수록 회전 큼.
// shoulder/hip 폭은 회전 시 cos(yaw) 로 단축 → 정면폭 대비 단축비로 추정.
// 단, 절대 기준폭을 모르므로 '면 간 상대' 로만 쓴다(여기선 yaw 부호 보강용).

export function analyzeAxialRotation(perViewAnalysis = {}) {
  const front = perViewAnalysis.front || null;
  const left = perViewAnalysis.left || null;
  const right = perViewAnalysis.right || null;
  const back = perViewAnalysis.back || null;
  const viewsPresent = ['front', 'left', 'back', 'right'].filter((k) => perViewAnalysis[k]);

  // 회전 추정의 1차 신호는 '정면'의 어깨/골반 yaw. 측면/후면은 교차검증용.
  const fRot = front?.rotations?.segments || {};
  const bRot = back?.rotations?.segments || {};

  // ── 체간(어깨) 회전 ──
  const trunk = combineYaw([
    { deg: fRot.shoulderYawDeg, weight: 2 },          // 정면 어깨 yaw (주신호)
    { deg: negate(bRot.shoulderYawDeg), weight: 1 },  // 후면은 부호 반대로 본다(교차검증)
  ], { mildAt: 6, markedAt: 12 });

  // ── 골반 회전 ──
  const pelvis = combineYaw([
    { deg: fRot.pelvisYawDeg, weight: 2 },
    { deg: negate(bRot.pelvisYawDeg), weight: 1 },
  ], { mildAt: 6, markedAt: 12 });

  // ── 머리 회전 ── (정면 코 치우침 기반, analysis.headYawProxy 가 있으면 사용)
  const head = combineYaw([
    { deg: front?.headYawProxyDeg, weight: 2 },
    { deg: negate(back?.headYawProxyDeg), weight: 0.5 },
  ], { mildAt: 5, markedAt: 10 });

  // ── 하체 회전 ── (무릎/발 전후 깊이차 프록시; 면별 측정이 약해 보조 취급)
  const lower = combineYaw([
    { deg: front?.lowerYawProxyDeg, weight: 1 },
  ], { mildAt: 6, markedAt: 12 });

  // ── 축 비틀림(분절 간 상대 회전): 체간 vs 골반 ──
  let axialTwist = null;
  if (trunk && pelvis && trunk.signedDeg != null && pelvis.signedDeg != null) {
    const twistDeg = round1(trunk.signedDeg - pelvis.signedDeg);
    const absTwist = Math.abs(twistDeg);
    axialTwist = {
      twistDeg,
      absTwist: round1(absTwist),
      level: levelFromDeg(absTwist, 7, 14),
      // 체간과 골반이 반대 방향이면 진짜 비틀림(척추 회전)
      opposing: Math.sign(trunk.signedDeg) !== Math.sign(pelvis.signedDeg)
        && Math.abs(trunk.signedDeg) > 1.5 && Math.abs(pelvis.signedDeg) > 1.5,
      direction: absTwist < 1.5 ? 'center' : twistDeg > 0 ? 'trunk_right_of_pelvis' : 'trunk_left_of_pelvis',
    };
  }

  // ── 전체 신뢰도: 측정 면 수 + 분절 신호 일치도 ──
  const segAgreements = [trunk, pelvis, head, lower].filter(Boolean).map((s) => s.agreement);
  const meanAgreement = segAgreements.length
    ? segAgreements.reduce((a, b) => a + b, 0) / segAgreements.length
    : 0;
  // 면 수 가중: 4면=1.0, 3면=0.8, 2면=0.6, 1면=0.4
  const viewFactor = { 1: 0.4, 2: 0.6, 3: 0.8, 4: 1.0 }[viewsPresent.length] || 0.3;
  const confidence = round2(meanAgreement * viewFactor);

  const available = !!(trunk || pelvis || head);

  return {
    available,
    viewsPresent,
    confidence,
    segments: { head, trunk, pelvis, lower },
    axialTwist,
    note: viewsPresent.length < 3
      ? '측정 면이 부족해 회전 추정 신뢰도가 낮습니다. 정면·좌·우·후면을 모두 측정하면 정확해집니다.'
      : null,
  };
}

function negate(v) {
  return v == null ? null : -v;
}

// 방향/단계 한글 라벨 (UI 표시용)
export const ROTATION_DIRECTION_KO = {
  center: '중립',
  left: '좌회전',
  right: '우회전',
};
export const ROTATION_LEVEL_KO = {
  none: '없음',
  mild: '경미',
  marked: '뚜렷',
  insufficient: '측정 부족',
};
