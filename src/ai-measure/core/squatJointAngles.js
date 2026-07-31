// ai-measure/core/squatJointAngles.js
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트 실시간 화면에 표시할 관절 각도 계산(2026-07-30 신규).
//  운영자 요청 스펙:
//   · 측면 — 발목(복숭아뼈) 기준 CoG, 어깨관절 굽힘, 고관절 굽힘, 무릎관절 굽힘,
//     발목관절 굽힘
//   · 정면 — CoG 기울기(좌/우), 무릎 내반슬·외반슬(=기존 kneeValgusDegOf 재사용),
//     골반 기울기(=기존 pelvicTiltDegOf 재사용), 팔꿈치 폄(양쪽), 머리-어깨 간격·기울기
//
//  ※ 이 파일은 "화면에 뭘 보여줄지"만 다룬다 — 정상/주의/위험 판정(점수화)은
//  squatBiomechanics.js의 몫이고, 여기 계산값을 그대로 판정에 자동 연결하지
//  않는다(운영자가 표시부터 확인한 뒤 다음 단계로 점수화 여부를 정하기로 함).
//  기존 kneeValgusDegOf·pelvicTiltDegOf(squatBiomechanicsTracker.js)와 계산
//  방식을 통일하기 위해 각도 계산 패턴(벡터 내적 → acos)을 그대로 따른다.
// ════════════════════════════════════════════════════════════════════════

const NOSE = 0, L_EYE = 2, R_EYE = 5, L_EAR = 7, R_EAR = 8;
const L_SHO = 11, R_SHO = 12, L_ELB = 13, R_ELB = 14, L_WRI = 15, R_WRI = 16;
const L_HIP = 23, R_HIP = 24, L_KNEE = 25, R_KNEE = 26, L_ANK = 27, R_ANK = 28;
const L_FOOT = 31, R_FOOT = 32;

const IDX = {
  shoulder: { left: L_SHO, right: R_SHO },
  elbow: { left: L_ELB, right: R_ELB },
  wrist: { left: L_WRI, right: R_WRI },
  hip: { left: L_HIP, right: R_HIP },
  knee: { left: L_KNEE, right: R_KNEE },
  ankle: { left: L_ANK, right: R_ANK },
  foot: { left: L_FOOT, right: R_FOOT },
};

function pt(lm, i) {
  const p = lm?.[i];
  return p && p.x != null && p.y != null ? { x: p.x, y: p.y } : null;
}

// 세 점(a-b-c)이 이룰 때 꼭짓점 b에서의 각도(0~180°). 벡터 내적 → acos.
function angleAtVertex(a, b, c) {
  if (!a || !b || !c) return null;
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!mag) return null;
  const dot = v1.x * v2.x + v1.y * v2.y;
  return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}

// 벡터가 수직(위 방향)에서 벗어난 각도. dx>0 이면 오른쪽으로 기움.
function angleFromVertical(dx, dy) {
  if (!dx && !dy) return 0;
  return (Math.atan2(dx, -dy) * 180) / Math.PI; // -dy: 위로 갈수록 y 작아짐 보정
}

function pickSide(lm, sideKey, side) {
  const i = side === 'left' ? IDX[sideKey].left : IDX[sideKey].right;
  return pt(lm, i);
}

// ────────────────────────────── 측면(side) ──────────────────────────────

/** 어깨관절 굽힘: 몸통(엉덩이→어깨) 대비 위팔(어깨→팔꿈치)이 이루는 각. */
export function shoulderFlexionDeg(lm, side) {
  const hip = pickSide(lm, 'hip', side);
  const sho = pickSide(lm, 'shoulder', side);
  const elb = pickSide(lm, 'elbow', side);
  return angleAtVertex(hip, sho, elb);
}

/** 고관절 굽힘: 몸통(어깨→엉덩이) 대비 허벅지(엉덩이→무릎)가 이루는 각. */
export function hipFlexionDeg(lm, side) {
  const sho = pickSide(lm, 'shoulder', side);
  const hip = pickSide(lm, 'hip', side);
  const knee = pickSide(lm, 'knee', side);
  return angleAtVertex(sho, hip, knee);
}

/** 무릎관절 굽힘(시상면): 허벅지(무릎→엉덩이) 대비 정강이(무릎→발목)가 이루는 각. */
export function kneeFlexionDeg(lm, side) {
  const hip = pickSide(lm, 'hip', side);
  const knee = pickSide(lm, 'knee', side);
  const ank = pickSide(lm, 'ankle', side);
  return angleAtVertex(hip, knee, ank);
}

/** 발목관절 굽힘(배측굴곡): 정강이(발목→무릎) 대비 발(발목→발끝)이 이루는 각. */
export function ankleFlexionDeg(lm, side) {
  const knee = pickSide(lm, 'knee', side);
  const ank = pickSide(lm, 'ankle', side);
  const foot = pickSide(lm, 'foot', side);
  return angleAtVertex(knee, ank, foot);
}

/**
 * 발목(복숭아뼈) 기준 CoG 편차각 — 무게중심 근사치(어깨-엉덩이 평균 중점)가
 * 발목 수직선(플럼라인)에서 앞/뒤로 얼마나 벗어났는지. 몸통이 앞으로 쏠리면
 * 양수(측면 카메라가 오른쪽을 바라본다고 가정 — 화면상 부호는 카메라 방향에
 * 따라 달라질 수 있어 절대값 위주로 표시에 쓴다).
 */
export function cogOverAnkleDeg(lm, side) {
  const sho = pickSide(lm, 'shoulder', side);
  const hip = pickSide(lm, 'hip', side);
  const ank = pickSide(lm, 'ankle', side);
  if (!sho || !hip || !ank) return null;
  // CoG 근사: 어깨·엉덩이 중점(상체 비중을 더 준 단순 근사 — 정밀 인체분절 모델 아님)
  const cog = { x: (sho.x + hip.x) / 2, y: (sho.y + hip.y) / 2 };
  const dx = cog.x - ank.x;
  const dy = cog.y - ank.y;
  return angleFromVertical(dx, dy);
}

// ────────────────────────────── 정면(front) ──────────────────────────────

/** 팔꿈치 폄: 위팔(팔꿈치→어깨) 대비 아래팔(팔꿈치→손목)이 이루는 각. 180°=완전히 폄. */
export function elbowExtensionDeg(lm, side) {
  const sho = pickSide(lm, 'shoulder', side);
  const elb = pickSide(lm, 'elbow', side);
  const wri = pickSide(lm, 'wrist', side);
  return angleAtVertex(sho, elb, wri);
}

/**
 * 머리-어깨 기울기: 양쪽 귀를 잇는 선이 수평에서 벗어난 각도(고개 좌우 기울임).
 * 양수 = 화면 기준 시계방향(사람이 보기엔 반대일 수 있음 — 절대값 위주로 표시).
 */
export function headTiltDeg(lm) {
  const lEar = pt(lm, L_EAR), rEar = pt(lm, R_EAR);
  if (!lEar || !rEar) return null;
  // 미러링 없는 카메라 정면 기준 L.x > R.x 가 "수평(안 기움)" 상태이므로
  // L→R이 아니라 R→L 방향을 기준(양의 dx)으로 잡는다.
  const dx = lEar.x - rEar.x, dy = lEar.y - rEar.y;
  if (!dx && !dy) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** 머리-어깨 간격(정규화): 귀와 같은 쪽 어깨 사이 거리 — 좌우 비대칭이면 어깨 한쪽이 솟은 신호. */
export function earShoulderGap(lm, side) {
  const ear = pt(lm, side === 'left' ? L_EAR : R_EAR);
  const sho = pickSide(lm, 'shoulder', side);
  if (!ear || !sho) return null;
  return Math.hypot(ear.x - sho.x, ear.y - sho.y);
}

/**
 * 정면 CoG 기울기(좌/우): 무게중심 근사치(어깨-엉덩이 평균 중점)가 발목
 * 중점 수직선에서 좌/우로 얼마나 벗어났는지. 양수=화면 오른쪽으로 쏠림.
 */
export function cogTiltFrontDeg(lm) {
  const lSho = pt(lm, L_SHO), rSho = pt(lm, R_SHO);
  const lHip = pt(lm, L_HIP), rHip = pt(lm, R_HIP);
  const lAnk = pt(lm, L_ANK), rAnk = pt(lm, R_ANK);
  if (!lSho || !rSho || !lHip || !rHip || !lAnk || !rAnk) return null;
  const shoMid = { x: (lSho.x + rSho.x) / 2, y: (lSho.y + rSho.y) / 2 };
  const hipMid = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
  const ankMid = { x: (lAnk.x + rAnk.x) / 2, y: (lAnk.y + rAnk.y) / 2 };
  const cog = { x: (shoMid.x + hipMid.x) / 2, y: (shoMid.y + hipMid.y) / 2 };
  const dx = cog.x - ankMid.x;
  const dy = cog.y - ankMid.y;
  return angleFromVertical(dx, dy);
}

/** 한 프레임의 모든 표시용 각도를 한 번에 계산(라이브 오버레이용). */
export function computeDisplayAngles(lm, view) {
  if (!lm) return null;
  if (view === 'side') {
    return {
      shoulderFlexion: shoulderFlexionDeg(lm, 'left') ?? shoulderFlexionDeg(lm, 'right'),
      hipFlexion: hipFlexionDeg(lm, 'left') ?? hipFlexionDeg(lm, 'right'),
      kneeFlexion: kneeFlexionDeg(lm, 'left') ?? kneeFlexionDeg(lm, 'right'),
      ankleFlexion: ankleFlexionDeg(lm, 'left') ?? ankleFlexionDeg(lm, 'right'),
      cogOverAnkle: cogOverAnkleDeg(lm, 'left') ?? cogOverAnkleDeg(lm, 'right'),
    };
  }
  return {
    cogTilt: cogTiltFrontDeg(lm),
    elbowExtL: elbowExtensionDeg(lm, 'left'),
    elbowExtR: elbowExtensionDeg(lm, 'right'),
    headTilt: headTiltDeg(lm),
    earShoulderGapL: earShoulderGap(lm, 'left'),
    earShoulderGapR: earShoulderGap(lm, 'right'),
  };
}
