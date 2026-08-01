// ai-measure/core/bodyMechanics.js
// ════════════════════════════════════════════════════════════════════════
//  관절 가동범위(ROM, Range of Motion) 정밀 측정·평가 핵심 역학 엔진.
//
//  설계 대원칙(측정 정직성):
//   1) 비동기 고속 프레임: 타임스탬프(ms) 기반으로 각도 시계열을 누적한다.
//      120/240fps 슬로모는 videoAnalyzer 가 tMs 를 실제 시간축으로 보정해 넘긴다.
//   2) 자세 분류(Position): 같은 관절이라도 STANDING(체중지지·기능적)과
//      SUPINE/PRONE(지면지지·순수구조)에서 기준 벡터(Origin Vector)를 분리한다.
//   3) 노이즈 필터링: 각도 시계열에 이동평균(Moving Average) 스무딩을 적용하고,
//      해부학적 한계를 벗어난 값(예: 음수·과대)은 대표값 산출에서 제외한다.
//   4) 좌표 정규화: 양 골반 중점(mid-hip)을 원점(0,0,0)으로 평행이동하고,
//      어깨너비(없으면 골반너비)를 1.0 으로 하는 크기(scale) 정규화를 적용해
//      카메라 거리·위치가 회차마다 달라도 비교 가능하게 만든다.
//
//  ※ 이 파일은 React/DOM 의존성이 전혀 없는 순수 함수 모듈이다(테스트 용이).
//    BlazePose 33 랜드마크 배열 [{x,y,z?,visibility?}, …] 을 입력으로 받는다.
// ════════════════════════════════════════════════════════════════════════

export const LM = Object.freeze({
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
});

const EPS = 1e-7;
const MIN_VIS = 0.4;

// 관절·자세 조합별 해부학적 정상 가동범위(평균 성인, 도). 평가·정직성 가드용.
// 출처: 임상 가동범위 표준치(평균). 측정 정직성: 이 범위를 크게 벗어난 값은
// "신뢰 불가"로 표시하기 위한 sanity 기준이다(절대 정답이 아님).
export const ROM_NORMS = Object.freeze({
  HIP: {
    STANDING:  { flexion: { normal: 120, min: 90,  max: 145 } }, // 기능적 굴곡
    SUPINE:    { flexion: { normal: 120, min: 90,  max: 150 } }, // SLR 포함 구조적
    PRONE:     { extension: { normal: 20, min: 10, max: 35 } },
  },
  KNEE: {
    STANDING:  { flexion: { normal: 135, min: 110, max: 150 } },
    SUPINE:    { flexion: { normal: 135, min: 110, max: 155 } },
    PRONE:     { flexion: { normal: 135, min: 110, max: 160 } },
  },
  SHOULDER: {
    STANDING:  { flexion: { normal: 170, min: 150, max: 185 } },
    SEATED:    { flexion: { normal: 170, min: 150, max: 185 } },
  },
  ANKLE: {
    STANDING:  { dorsiflexion: { normal: 20, min: 10, max: 30 } },
    SEATED:    { dorsiflexion: { normal: 20, min: 10, max: 30 } },
  },
});

export function round(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const u = 10 ** digits;
  return Math.round(value * u) / u;
}

export function isVisible(p, threshold = MIN_VIS) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility == null || p.visibility >= threshold);
}

export function getLandmark(landmarks, index, threshold = MIN_VIS) {
  const p = landmarks?.[index];
  return isVisible(p, threshold) ? p : null;
}

export function midpoint(a, b) {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

// ────────────────────────────────────────────────────────────────────────
//  [출력 요구 2-①] 세 점(x,y,z)의 사잇각(도). b 가 꼭짓점.
//  use3d=true 면 z 축까지 포함(공간 각도), false 면 화면 평면(2D) 각도.
// ────────────────────────────────────────────────────────────────────────
export function angleBetween(a, b, c, use3d = true) {
  if (!a || !b || !c) return null;
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  const dot = ab.x * cb.x + ab.y * cb.y + (use3d ? ab.z * cb.z : 0);
  const magA = Math.hypot(ab.x, ab.y, use3d ? ab.z : 0);
  const magC = Math.hypot(cb.x, cb.y, use3d ? cb.z : 0);
  if (magA < EPS || magC < EPS) return null;
  const cos = Math.max(-1, Math.min(1, dot / (magA * magC)));
  return round((Math.acos(cos) * 180) / Math.PI, 1);
}

// 한 벡터(from→to)와 기준 단위벡터(axis) 사이 각도(도). 기준선 기반 ROM 연산용.
export function vectorToAxisAngle(from, to, axis, use3d = false) {
  if (!from || !to || !axis) return null;
  const v = { x: to.x - from.x, y: to.y - from.y, z: (to.z ?? 0) - (from.z ?? 0) };
  const dot = v.x * axis.x + v.y * axis.y + (use3d ? v.z * (axis.z ?? 0) : 0);
  const magV = Math.hypot(v.x, v.y, use3d ? v.z : 0);
  const magA = Math.hypot(axis.x, axis.y, use3d ? (axis.z ?? 0) : 0);
  if (magV < EPS || magA < EPS) return null;
  const cos = Math.max(-1, Math.min(1, dot / (magV * magA)));
  return round((Math.acos(cos) * 180) / Math.PI, 1);
}

// ────────────────────────────────────────────────────────────────────────
//  [대원칙 4] 좌표 정규화:
//   · 평행이동: 양 골반 중점을 원점(0,0,0)으로.
//   · 크기정규화: 어깨너비(없으면 골반너비)를 1.0 으로 스케일.
//  회차/카메라 거리 차이를 제거해 1회차 vs N회차 비교의 일관성을 보장.
// ────────────────────────────────────────────────────────────────────────
export function normalizePose(landmarks) {
  if (!Array.isArray(landmarks)) return null;
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  if (!isVisible(lh, 0.3) || !isVisible(rh, 0.3)) return null;
  const origin = midpoint(lh, rh);

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  let scale = null;
  if (isVisible(ls, 0.3) && isVisible(rs, 0.3)) {
    scale = Math.hypot(rs.x - ls.x, rs.y - ls.y);
  }
  if (!scale || scale < 0.02) {
    scale = Math.hypot(rh.x - lh.x, rh.y - lh.y); // 폴백: 골반너비
  }
  if (!scale || scale < 0.01) return null;

  return landmarks.map((p) => {
    if (!p) return p;
    return {
      x: (p.x - origin.x) / scale,
      y: (p.y - origin.y) / scale,
      z: ((p.z ?? 0) - (origin.z ?? 0)) / scale,
      visibility: p.visibility,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────
//  [대원칙 3 / 출력 요구 2-③] 노이즈 필터링: 1D 시계열 이동평균(Moving Average).
//   BlazePose 의 z축 튐·미세 떨림을 완화한다. window 는 홀수 권장(중심 정렬).
//   null/비유한값은 건너뛰되 위치는 유지(시간축 보존).
// ────────────────────────────────────────────────────────────────────────
export function movingAverage(series, window = 5) {
  if (!Array.isArray(series) || !series.length) return [];
  const half = Math.floor(window / 2);
  return series.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = i - half; k <= i + half; k++) {
      const v = series[k];
      if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n++; }
    }
    return n ? round(sum / n, 1) : (Number.isFinite(series[i]) ? series[i] : null);
  });
}

// 중앙값(이상치 내성) — 대표 각도/안정성 산출 보조.
export function median(values) {
  const arr = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdDev(values) {
  const arr = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// ────────────────────────────────────────────────────────────────────────
//  [출력 요구 2-②] PoseMode(STANDING vs SUPINE/PRONE)에 따라 기준 벡터를
//  다르게 세팅하여 최종 관절 각도를 반환.
//
//   · STANDING: 기준선 = 수직 중력선(척추 축). 체중지지 상태의 '기능적 가동성'.
//       반대쪽 골반이 내려앉는 골반 불균형(pelvicDrop)을 보상값으로 함께 추적.
//   · SUPINE/PRONE: 기준선 = 피험자 본인의 몸통 축(어깨↔고관절, 화면 절대좌표가
//       아닌 몸 기준). 카메라에 대해 어느 방향으로 눕든 결과가 같다. 보상을
//       통제한 '순수 구조적 ROM'. 동작 끝범위의 잔떨림(등척성 안정성)을 별도로 추출.
//
//   joint: 'HIP' | 'KNEE' | 'SHOULDER' | 'ANKLE'
//   side:  'left' | 'right'
//   poseMode: 'STANDING' | 'SUPINE' | 'PRONE' | 'SEATED'
//  반환: { angle, compensatory, base } — angle=관절각, compensatory=보상값(STANDING).
// ────────────────────────────────────────────────────────────────────────
export function jointAngleByMode(landmarks, joint, side, poseMode) {
  const S = side === 'left' ? 'LEFT' : 'RIGHT';
  const OPP = side === 'left' ? 'RIGHT' : 'LEFT';
  const get = (name) => getLandmark(landmarks, LM[name], 0.35);

  const hip = get(`${S}_HIP`);
  const knee = get(`${S}_KNEE`);
  const ankle = get(`${S}_ANKLE`);
  const shoulder = get(`${S}_SHOULDER`);
  const elbow = get(`${S}_ELBOW`);
  const wrist = get(`${S}_WRIST`);
  const foot = get(`${S}_FOOT_INDEX`);

  // 기준 벡터: STANDING 계열은 수직(중력)을 기준으로 삼는다.
  // 화면 좌표계에서 y는 아래로 갈수록 커진다.
  const VERTICAL_UP = { x: 0, y: -1, z: 0 };   // 위쪽(척추 축 근사)

  let angle = null;
  let compensatory = null;
  let base = poseMode === 'STANDING' ? 'vertical_gravity_line' : 'trunk_axis_line';

  if (joint === 'HIP') {
    if (poseMode === 'STANDING') {
      // 대퇴골(hip→knee) 벡터와 수직선 사이각. 굴곡각 정의는 '다리 내림=0°,
      // 다리 위로 들어올림=180°'. vectorToAxisAngle 은 위쪽축 기준이라 내릴수록 180°가
      // 되므로 (180 - 각도)로 보정해 올바른 굴곡각으로 만든다.
      const raw = vectorToAxisAngle(hip, knee, VERTICAL_UP, false);
      angle = raw == null ? null : round(180 - raw, 1);
      // 보상: 반대쪽 골반이 내려앉는 정도(pelvicDrop) — 양 골반 y차를 어깨너비로 정규화.
      compensatory = pelvicDrop(landmarks, side);
    } else {
      // SUPINE/PRONE: 대퇴골과 '몸통 축(어깨→고관절)' 사이각 = 순수 고관절 굴곡/신전.
      // 예전엔 화면 고정 수평축(HORIZONTAL, +x 방향)을 기준으로 삼았는데, 카메라에
      // 대해 피험자 머리가 왼쪽/오른쪽 중 어느 쪽을 향하는지에 따라 같은 자세도
      // 0°로도 180°로도 잡히고, 굴곡할수록 각도가 거꾸로 줄어드는 경우까지 있었다
      // (2026-08-01 수정 — "포지션 바꿔도 각도가 그대로/이상하게 나온다" 회귀).
      // 무릎각(hip-knee-ankle)과 같은 원리로, 화면 절대 좌표가 아니라 몸통 자체를
      // 기준선으로 삼으면 카메라·피험자 방향과 무관하게 항상 같은 결과가 나온다.
      const trunkKneeAngle = angleBetween(shoulder, hip, knee, false);
      angle = trunkKneeAngle == null ? null : round(180 - trunkKneeAngle, 1);
    }
  } else if (joint === 'KNEE') {
    // 무릎각은 자세와 무관하게 hip-knee-ankle 내각(굴곡). 펴면 180에 가까움.
    angle = angleBetween(hip, knee, ankle, false);
    if (poseMode === 'STANDING') compensatory = pelvicDrop(landmarks, side);
  } else if (joint === 'SHOULDER') {
    if (poseMode === 'STANDING' || poseMode === 'SEATED') {
      // 상완(shoulder→elbow)과 수직축 사이각. 견관절 굴곡 정의는 '팔 내림=0°,
      // 팔 위로 들어올림=180°'. 위쪽축 기준 각도를 (180 - 각도)로 보정한다.
      const raw = vectorToAxisAngle(shoulder, elbow, VERTICAL_UP, false);
      angle = raw == null ? null : round(180 - raw, 1);
      // 보상: 몸통 측면 기울기(체간 보상). 양 어깨-골반 라인 기울기.
      compensatory = trunkLeanCompensation(landmarks);
    } else {
      // (현재 UI에서는 SHOULDER에 STANDING/SEATED만 노출되어 도달하지 않지만,
      // HIP과 동일한 이유로 화면 고정축 대신 몸통 축(고관절→어깨) 기준으로 통일.)
      const trunkElbowAngle = angleBetween(hip, shoulder, elbow, false);
      angle = trunkElbowAngle == null ? null : round(180 - trunkElbowAngle, 1);
    }
  } else if (joint === 'ANKLE') {
    // 발목 배측굴곡 근사: 정강이(knee→ankle) 와 발(ankle→foot) 사잇각.
    angle = angleBetween(knee, ankle, foot, false);
  }

  return { angle, compensatory, base };
}

// 보상값: 골반 불균형(pelvicDrop). 측정쪽 반대 골반이 내려앉는 양을
// 어깨너비(없으면 1) 기준으로 정규화한 % (양수=반대쪽 골반 하강).
export function pelvicDrop(landmarks, movingSide) {
  const lh = getLandmark(landmarks, LM.LEFT_HIP, 0.3);
  const rh = getLandmark(landmarks, LM.RIGHT_HIP, 0.3);
  if (!lh || !rh) return null;
  const ls = getLandmark(landmarks, LM.LEFT_SHOULDER, 0.3);
  const rs = getLandmark(landmarks, LM.RIGHT_SHOULDER, 0.3);
  const norm = (ls && rs) ? Math.hypot(rs.x - ls.x, rs.y - ls.y) : 1;
  if (norm < EPS) return null;
  // 움직이는 다리쪽 골반 대비 지지쪽(반대) 골반의 y 차. y 큼=화면 아래.
  const moving = movingSide === 'left' ? lh : rh;
  const stance = movingSide === 'left' ? rh : lh;
  const dropRatio = (stance.y - moving.y) / norm; // 지지쪽이 더 아래면 양수
  return round(dropRatio * 100, 1);
}

// 보상값: 체간 측방 기울기(어깨선-골반선 중점 연결의 수직 대비 기울기, 도).
export function trunkLeanCompensation(landmarks) {
  const sMid = midpoint(getLandmark(landmarks, LM.LEFT_SHOULDER, 0.3), getLandmark(landmarks, LM.RIGHT_SHOULDER, 0.3));
  const hMid = midpoint(getLandmark(landmarks, LM.LEFT_HIP, 0.3), getLandmark(landmarks, LM.RIGHT_HIP, 0.3));
  if (!sMid || !hMid) return null;
  const dx = sMid.x - hMid.x;
  const dy = hMid.y - sMid.y; // 위로 갈수록 작아지므로 보정
  if (Math.abs(dy) < EPS) return null;
  return round((Math.atan2(dx, dy) * 180) / Math.PI, 1);
}

// ── [보상 프로파일] 몸통 회전(비틀기) 신호 ──
//  측면 촬영에서 몸통이 측정면을 유지하면 양 어깨(양 골반)가 화면상 거의 겹친다.
//  동작 중 몸통을 돌리는(비트는) 보상이 나오면 겹쳐 있던 두 점이 수평(x)으로
//  벌어진다. 이 x-분리를 몸통높이로 정규화해 회전 보상 신호로 쓴다.
//  · z-깊이(단안 추정, 노이즈 큼)를 쓰지 않는 2D 신호라 안정적.
//  · 단안으로 정확한 회전각(도)은 알 수 없으므로 '비율'로만 보고한다(측정 정직성).
export function torsoSeparationSignal(landmarks) {
  const ls = getLandmark(landmarks, LM.LEFT_SHOULDER, 0.3);
  const rs = getLandmark(landmarks, LM.RIGHT_SHOULDER, 0.3);
  const lh = getLandmark(landmarks, LM.LEFT_HIP, 0.3);
  const rh = getLandmark(landmarks, LM.RIGHT_HIP, 0.3);
  const sMid = midpoint(ls, rs);
  const hMid = midpoint(lh, rh);
  if (!sMid || !hMid) return null;
  const trunkH = Math.hypot(sMid.x - hMid.x, sMid.y - hMid.y);
  if (trunkH < EPS) return null;
  const shoulderSep = (ls && rs) ? Math.abs(ls.x - rs.x) / trunkH : null;
  const hipSep = (lh && rh) ? Math.abs(lh.x - rh.x) / trunkH : null;
  return { shoulderSep, hipSep };
}

// ────────────────────────────────────────────────────────────────────────
//  시계열 누적기 — 비동기 프레임이 들어올 때마다 push, 끝나면 summary().
//  좌/우 각도, 보상값, 타임스탬프를 시간순으로 쌓고, 스무딩 후 대표값을 낸다.
// ────────────────────────────────────────────────────────────────────────
export class RomAccumulator {
  constructor({ joint = 'HIP', poseMode = 'STANDING', smoothWindow = 5 } = {}) {
    this.joint = joint;
    this.poseMode = poseMode;
    this.smoothWindow = smoothWindow;
    this.samples = []; // [{ t, left, right, compL, compR }]
  }

  push(landmarks, tMs) {
    if (!Array.isArray(landmarks)) return;
    const norm = normalizePose(landmarks) || landmarks; // 정규화 실패 시 원본
    const L = jointAngleByMode(norm, this.joint, 'left', this.poseMode);
    const R = jointAngleByMode(norm, this.joint, 'right', this.poseMode);
    // [보상 프로파일] 모든 자세모드에서 체간 기울기·몸통 회전 신호를 함께 수집.
    const lean = trunkLeanCompensation(norm);
    const sep = torsoSeparationSignal(norm);
    this.samples.push({
      t: tMs,
      left: L.angle,
      right: R.angle,
      compL: L.compensatory,
      compR: R.compensatory,
      lean,
      shoulderSep: sep?.shoulderSep ?? null,
      hipSep: sep?.hipSep ?? null,
    });
  }

  // 자세·관절 정상 범위를 벗어나는 값은 대표값 산출에서 제외(측정 정직성).
  _sanityRange() {
    const spec = ROM_NORMS[this.joint]?.[this.poseMode] || null;
    if (!spec) return { lo: -30, hi: 200 };
    const first = Object.values(spec)[0];
    return { lo: Math.max(-30, first.min - 40), hi: first.max + 40 };
  }

  summary() {
    const { lo, hi } = this._sanityRange();
    const rawL = this.samples.map((s) => s.left);
    const rawR = this.samples.map((s) => s.right);
    const smL = movingAverage(rawL, this.smoothWindow).filter((v) => v != null && v >= lo && v <= hi);
    const smR = movingAverage(rawR, this.smoothWindow).filter((v) => v != null && v >= lo && v <= hi);

    // 굴곡 ROM 은 '최대 굴곡각'이 핵심 지표. HIP/SHOULDER 기준벡터각은 클수록 굴곡↑.
    // KNEE 내각은 굴곡 시 작아지므로(폄=180), maxFlexion = 180 - min(내각).
    const repMax = (arr) => {
      if (!arr.length) return null;
      if (this.joint === 'KNEE') {
        const minInner = Math.min(...arr);
        return round(180 - minInner, 1);
      }
      return round(Math.max(...arr), 1);
    };
    const leftMax = repMax(smL);
    const rightMax = repMax(smR);

    // 끝범위 안정성: 최대각 근처(상위 15%) 구간의 표준편차가 작을수록 안정(점수↑).
    const endRangeStability = (arr, side) => {
      if (arr.length < 4) return null;
      const sorted = [...arr].sort((a, b) => b - a);
      const topN = Math.max(3, Math.round(arr.length * 0.15));
      const top = sorted.slice(0, topN);
      const sd = stdDev(top);
      // 표준편차 0도=100점, 6도 이상=0점 (선형). 잔떨림이 클수록 감점.
      return round(Math.max(0, Math.min(100, 100 - (sd / 6) * 100)), 0);
    };

    const symmetry = symmetryIndex(leftMax, rightMax);
    const compL = median(this.samples.map((s) => s.compL));
    const compR = median(this.samples.map((s) => s.compR));

    // ── [보상 프로파일] 3축: 체간 기울기(도) · 회전/비틀기(%) · 골반 하강(%) ──
    //  기준선 = 녹화 초반(중립 자세로 가정) 표본의 중앙값. 이탈 = 기준선 대비
    //  최대 편차. 기준선 표본이 부족하면 해당 축은 null (측정 정직성 — 추측 금지).
    const BASELINE_N = 8;
    const MIN_BASELINE = 5;
    const baselineOf = (arr) => {
      const head = arr.filter((v) => v != null).slice(0, BASELINE_N);
      return head.length >= MIN_BASELINE ? median(head) : null;
    };
    const maxDevInfo = (arr, base) => {
      if (base == null) return { dev: null, signed: null };
      let dev = 0, signed = null;
      for (const v of arr) {
        if (v == null) continue;
        const d = v - base;
        if (Math.abs(d) > dev) { dev = Math.abs(d); signed = d; }
      }
      return { dev, signed };
    };
    const leans = this.samples.map((s) => s.lean);
    const shSeps = this.samples.map((s) => s.shoulderSep);
    const hipSeps = this.samples.map((s) => s.hipSep);
    const leanBase = baselineOf(leans);
    const shBase = baselineOf(shSeps);
    const hipBase = baselineOf(hipSeps);
    const leanDev = maxDevInfo(leans, leanBase);
    const shDev = maxDevInfo(shSeps, shBase);
    const hipDev = maxDevInfo(hipSeps, hipBase);
    // 회전(비틀기): 분리 '증가'만 보상(측정면 이탈)으로 본다(감소는 정렬 개선).
    const rotShoulderPct = shDev.signed != null && shDev.signed > 0 ? round(shDev.signed * 100, 1) : (shBase != null ? 0 : null);
    const rotHipPct = hipDev.signed != null && hipDev.signed > 0 ? round(hipDev.signed * 100, 1) : (hipBase != null ? 0 : null);
    const rotationMaxPct = (rotShoulderPct == null && rotHipPct == null)
      ? null
      : Math.max(rotShoulderPct ?? 0, rotHipPct ?? 0);
    const compensation_profile = {
      // 축 1: 체간 기울기 — 기준선 대비 최대 이탈(도, 부호=이탈 방향)
      lean_baseline_deg: leanBase != null ? round(leanBase, 1) : null,
      lean_max_dev_deg: leanDev.dev != null && leanBase != null ? round(leanDev.dev, 1) : null,
      lean_dev_signed_deg: leanDev.signed != null ? round(leanDev.signed, 1) : null,
      // 축 2: 회전/비틀기 — 어깨·골반 x-분리 증가량(몸통높이 대비 %)
      rotation_shoulder_pct: rotShoulderPct,
      rotation_hip_pct: rotHipPct,
      rotation_max_pct: rotationMaxPct,
      // 축 3: 골반 하강 — 기존 STANDING 전용 보상값(%)을 그대로 노출
      pelvic_drop_pct: this.poseMode === 'STANDING' ? (compL ?? compR ?? null) : null,
      baseline_samples: Math.min(BASELINE_N, this.samples.length),
    };

    return {
      joint: this.joint,
      poseMode: this.poseMode,
      sampleCount: this.samples.length,
      validCount: smL.length + smR.length,
      left_max_rom: leftMax,
      right_max_rom: rightMax,
      symmetry_index_score: symmetry,
      end_range_stability_score: {
        left: endRangeStability(smL, 'left'),
        right: endRangeStability(smR, 'right'),
      },
      compensation: { left: compL, right: compR },
      compensation_profile,
      // 정제된 시계열(저장·차트용). 슬로모 보정된 t(ms) 포함.
      timeSeries: this.samples.map((s, i) => ({
        timestamp: round(s.t, 0),
        left_angle: smL[i] ?? s.left,
        right_angle: smR[i] ?? s.right,
        compensatory_value: s.compL ?? s.compR ?? null,
      })),
      valid: (leftMax != null || rightMax != null) && this.samples.length >= 5,
    };
  }
}

// 좌우 대칭성 지수: 차이 / 큰값 → % (0%=완전대칭). 작은 값일수록 대칭.
export function symmetryIndex(left, right) {
  if (left == null || right == null) return null;
  const big = Math.max(Math.abs(left), Math.abs(right));
  if (big < EPS) return 0;
  return round((Math.abs(left - right) / big) * 100, 1);
}
