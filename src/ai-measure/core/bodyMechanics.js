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
  LEFT_EYE: 2, RIGHT_EYE: 5,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
});

import { getFrameAspect } from './geometry';
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
    // [2611] 고관절 벌림(서서, 정면 촬영). 교재 6장(276쪽): 벌림 45° 제한까지.
    //  교재 정상치: 굴곡 120° · 폄 30° · 벌림 45° · 모음 30° · 안/바깥 돌림 45°.
    ABDUCTION: { abduction: { normal: 45, min: 30, max: 60 } },
    // [2611] 누워서 벌림(교재 자세, 위에서 내려다보며 촬영). 같은 45° 기준.
    SUPINE_ABD: { abduction: { normal: 45, min: 30, max: 60 } },
  },
  KNEE: {
    STANDING:  { flexion: { normal: 135, min: 110, max: 150 } },
    SUPINE:    { flexion: { normal: 135, min: 110, max: 155 } },
    PRONE:     { flexion: { normal: 135, min: 110, max: 160 } },
  },
  SHOULDER: {
    STANDING:  { flexion: { normal: 170, min: 150, max: 185 } },
    SEATED:    { flexion: { normal: 170, min: 150, max: 185 } },
    // [2611] 어깨 벌림(외전, 정면 촬영). 교재 3장(92쪽): 벌림동안 어깨 올림 180°.
    //  굴곡과 같은 sanity 범위(팔 내림=0°, 머리 위=180°)를 쓴다.
    ABDUCTION: { abduction: { normal: 170, min: 150, max: 185 } },
  },
  // [2611] 목(경추) — 교재 9장(422~427쪽). 기구마다 정상치가 달라 중간값을 쓴다:
  //  굴곡 45~50 · 폄 60~65 · 가쪽 굽힘 35~45 · 돌림 60~80. 값은 "시작 자세(중립) 대비 변화량".
  NECK: {
    FLEXION:   { flexion: { normal: 50, min: 35, max: 70 } },
    EXTENSION: { extension: { normal: 60, min: 40, max: 80 } },
    LATERAL:   { lateral_flexion: { normal: 45, min: 30, max: 60 } },
    ROTATION:  { rotation: { normal: 70, min: 45, max: 95 } },
  },
  ANKLE: {
    STANDING:  { dorsiflexion: { normal: 20, min: 10, max: 30 } },
    SEATED:    { dorsiflexion: { normal: 20, min: 10, max: 30 } },
  },
  // [2026-08-02 신규] 주관절(팔꿈치). 출처: 임상 가동범위 표준치(평균, 능동 굴곡
  // 약 140~150°) — 다른 관절과 마찬가지로 절대 정답이 아닌 sanity 기준. 실제
  // 캡처 데이터 축적 후 보정 필요.
  ELBOW: {
    STANDING:  { flexion: { normal: 140, min: 120, max: 155 } },
    SEATED:    { flexion: { normal: 140, min: 120, max: 155 } },
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
  const A = getFrameAspect();
  const ab = { x: (a.x - b.x) * A, y: a.y - b.y, z: ((a.z ?? 0) - (b.z ?? 0)) * A };
  const cb = { x: (c.x - b.x) * A, y: c.y - b.y, z: ((c.z ?? 0) - (b.z ?? 0)) * A };
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
//   joint: 'HIP' | 'KNEE' | 'SHOULDER' | 'ANKLE' | 'ELBOW' | 'NECK'
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

  if (joint === 'NECK') {
    // [2611] 목 — 머리 랜드마크(귀·코)와 어깨선만으로 잰다(별도 장비 없음).
    //  · LATERAL(정면): 두 귀를 잇는 선이 어깨선에서 기운 각. 중립에서 0°라 기준 보정이 필요 없다.
    //    왼쪽 값 = 머리를 왼쪽 어깨 쪽으로 기울임, 오른쪽 값 = 오른쪽.
    //  · ROTATION(정면): 코가 두 귀 중점에서 벗어난 비율로 돌림 각을 근사(asin). 왼쪽/오른쪽은 화면 기준.
    //  · FLEXION/EXTENSION(옆모습): 귀→코 선의 수평 대비 기울기(고개 숙임 +). 중립 값은 누적기가 시작 구간에서 빼 준다.
    const lEar = get('LEFT_EAR'), rEar = get('RIGHT_EAR');
    const lSh = get('LEFT_SHOULDER'), rSh = get('RIGHT_SHOULDER');
    const nose = get('NOSE');
    const deg = (r) => (r * 180) / Math.PI;
    if (poseMode === 'LATERAL') {
      if (lEar && rEar && lSh && rSh) {
        // 화면에서 사람의 왼쪽 귀가 화면 오른쪽에 온다(정면). 각 선의 기울기를 비교.
        const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
        let d = deg(ang(rEar, lEar) - ang(rSh, lSh));
        d = ((d + 540) % 360) - 180; // -180~180
        // d>0: 사람의 왼쪽 귀가 왼쪽 어깨 쪽(아래)으로 → 왼쪽 가쪽 굽힘
        angle = round(side === 'left' ? d : -d, 1);
      }
      base = 'shoulder_line';
    } else if (poseMode === 'ROTATION') {
      if (lEar && rEar && nose) {
        const mid = { x: (lEar.x + rEar.x) / 2, y: (lEar.y + rEar.y) / 2 };
        const half = Math.hypot(lEar.x - rEar.x, lEar.y - rEar.y) / 2;
        if (half > EPS) {
          // 사람의 왼쪽 귀가 화면 오른쪽 → 코가 화면 오른쪽으로 가면 사람 왼쪽으로 돌린 것
          const off = (nose.x - mid.x) / half; // 정면=0
          const t = Math.max(-1, Math.min(1, off));
          const yaw = deg(Math.asin(t));
          angle = round(side === 'left' ? yaw : -yaw, 1);
        }
      }
      base = 'ear_midline';
    } else {
      // FLEXION / EXTENSION — 보이는 쪽 귀 하나와 코 사용(옆모습)
      const ear = side === 'left' ? lEar : rEar;
      if (ear && nose) {
        const dir = Math.sign(nose.x - ear.x) || 1; // 얼굴이 향한 방향
        const pitch = deg(Math.atan2(nose.y - ear.y, Math.abs(nose.x - ear.x))); // 코가 아래면 +
        angle = round(poseMode === 'EXTENSION' ? -pitch : pitch, 1);
        void dir;
      }
      base = 'ear_nose_line';
    }
    return { angle, compensatory, base };
  }

  if (joint === 'HIP' && poseMode === 'SUPINE_ABD') {
    // [2611] 누워서 벌림 — 카메라가 몸 바로 위에서 내려다본다(다리가 움직이는 면과 화면이 평행).
    //  몸통 축(어깨→골반)을 연장한 선과 대퇴(hip→knee) 사이각. 다리를 곧게 뻗으면 0°.
    //  화면 절대 좌표가 아니라 몸통 기준이라 머리 방향이 어느 쪽이어도 같다.
    //  벌림/모음은 반대쪽 골반과 같은 쪽이면 모음(−), 반대쪽이면 벌림(+)으로 구분한다.
    //  어깨·골반·무릎·반대쪽 골반 중 하나라도 안 보이면 각도를 내지 않는다(측정 정직성).
    const oppHip = get(`${OPP}_HIP`);
    const tk = angleBetween(shoulder, hip, knee, false);
    if (tk != null && shoulder && hip && knee && oppHip) {
      const mag = round(180 - tk, 1);
      const t = { x: hip.x - shoulder.x, y: hip.y - shoulder.y };
      const cross = (u, w) => u.x * w.y - u.y * w.x;
      const cl = cross(t, { x: knee.x - hip.x, y: knee.y - hip.y });
      const co = cross(t, { x: oppHip.x - hip.x, y: oppHip.y - hip.y });
      angle = (cl * co <= 0) ? mag : -mag; // 반대 부호 = 반대쪽 골반에서 멀어짐 = 벌림
    }
    base = 'trunk_axis_line';
  } else if (joint === 'HIP' && poseMode === 'ABDUCTION') {
    // [2611] 서서 벌림(정면): 대퇴(hip→knee)와 수직 아래선 사이각. 다리 내림=0°.
    //  모음(다리가 몸 안쪽으로)은 음수로 구분 — 반대쪽 골반 기준 '바깥쪽'이면 벌림(+).
    //  반대쪽 골반이 안 보이면 방향을 알 수 없어 각도를 내지 않는다(측정 정직성).
    const oppHip = get(`${OPP}_HIP`);
    const raw = vectorToAxisAngle(hip, knee, VERTICAL_UP, false);
    if (raw != null && hip && knee && oppHip) {
      const mag = round(180 - raw, 1);
      const out = Math.sign(hip.x - oppHip.x) || 1;
      angle = (knee.x - hip.x) * out >= 0 ? mag : -mag;
    }
    compensatory = pelvicDrop(landmarks, side); // 골반 올림(hiking)·내려앉음 보상
    base = 'vertical_gravity_line';
  } else if (joint === 'HIP') {
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
    if (poseMode === 'STANDING' || poseMode === 'SEATED' || poseMode === 'ABDUCTION') {
      // [2611] ABDUCTION(벌림)은 정면 촬영 — 같은 식(팔 내림=0°, 머리 위=180°)을 화면 면(정면)에서 잰다.
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
  } else if (joint === 'ELBOW') {
    // 주관절(팔꿈치) — 무릎과 동일한 단순 경첩 관절. 상완(shoulder→elbow)과
    // 전완(elbow→wrist) 사잇각을 그대로 쓴다(축 기준 보정 불필요). 펴면 180에
    // 가깝고, 굽힐수록 작아진다 — KNEE와 동일한 성질이라 repMax()에서도
    // KNEE와 같은 (180 - 최소각) 보정을 함께 적용한다.
    angle = angleBetween(shoulder, elbow, wrist, false);
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
  const dx = (sMid.x - hMid.x) * getFrameAspect();
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
//  [2611 ROM 안정화] 견고한 대표값(피크)·반복 검출·가시성·옆모습 정렬
//   AROM 결과가 "프레임 하나가 튄 값"이 되지 않고 반복해도 일정하게 나오도록 한다.
//   임계값(5프레임·15°·0.5·0.4)은 설계값이며 실측 데이터로 검증 전이다.
// ────────────────────────────────────────────────────────────────────────
export const ROM_CONFIDENT_VIS = 0.5;   // 이 이상 보이는 프레임을 우선 사용
export const ROM_MIN_GOOD_FRAMES = 8;   // 우선 사용할 프레임이 이보다 적으면 전체 사용 + 경고
export const ROM_REP_SPREAD_WARN = 5;   // 반복 간 최대각 편차(°) 경고 기준(교재 28쪽: 팔 5°·다리 6° 이내는 오차 범위)
export const ROM_VIEW_RATIO_MIN_FRONT = 0.5; // 정면 촬영(벌림) 판정: 어깨폭/몸통길이 비율 하한(정면≈0.8)
export const ROM_VIEW_RATIO_MAX = 0.4;  // 옆모습 판정: 어깨폭/몸통길이 비율 상한(정면≈0.8, 완전 측면≈0)

// 연속 k 프레임의 중앙값 중 최대(또는 최소). 1~2프레임 튄 값은 결과가 되지 않는다.
export function sustainedExtreme(values, kind = 'max', k = 5) {
  const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  const pick = kind === 'min' ? Math.min : Math.max;
  if (v.length < k) return pick(...v);
  let best = null;
  for (let i = 0; i + k <= v.length; i++) {
    const m = median(v.slice(i, i + k));
    if (best == null || (kind === 'min' ? m < best : m > best)) best = m;
  }
  return best;
}

// 굴곡 지표(클수록 많이 움직임) 시계열에서 반복(rep)별 피크를 찾는다.
//  기준선 = 하위 10% 값, 진입 = 범위의 60%, 이탈 = 40%(히스테리시스로 떨림 분리 방지).
//  범위가 minRangeDeg 미만이면 "움직임 없음"으로 보고 반복 0.
export function detectRepPeaks(flex, { minRangeDeg = 15, minFrames = 3 } = {}) {
  const v = (flex || []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length < minFrames * 2) return { peaks: [], count: 0, rangeDeg: 0 };
  const sorted = [...v].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sustainedExtreme(v, 'max');
  const rangeDeg = hi - lo;
  if (!(rangeDeg >= minRangeDeg)) return { peaks: [], count: 0, rangeDeg };
  const up = lo + 0.6 * rangeDeg;
  const down = lo + 0.4 * rangeDeg;
  const peaks = [];
  let run = null;
  const close = () => {
    if (run && run.length >= minFrames) peaks.push(sustainedExtreme(run, 'max', Math.min(5, run.length)));
    run = null;
  };
  for (const x of v) {
    if (run == null) { if (x >= up) run = [x]; }
    else if (x < down) close();
    else run.push(x);
  }
  close();
  return { peaks, count: peaks.length, rangeDeg };
}

// 관절각 산출에 실제로 쓰이는 랜드마크 중 가장 낮은 visibility(없으면 null).
export function jointMinVisibility(landmarks, joint, side, poseMode) {
  const S = side === 'left' ? 'LEFT' : 'RIGHT';
  let names;
  if (joint === 'HIP') names = (poseMode === 'STANDING' || poseMode === 'ABDUCTION') ? ['HIP', 'KNEE'] : ['SHOULDER', 'HIP', 'KNEE'];
  else if (joint === 'KNEE') names = ['HIP', 'KNEE', 'ANKLE'];
  else if (joint === 'SHOULDER') names = (poseMode === 'STANDING' || poseMode === 'SEATED' || poseMode === 'ABDUCTION') ? ['SHOULDER', 'ELBOW'] : ['HIP', 'SHOULDER', 'ELBOW'];
  else if (joint === 'ANKLE') names = ['KNEE', 'ANKLE', 'FOOT_INDEX'];
  else if (joint === 'ELBOW') names = ['SHOULDER', 'ELBOW', 'WRIST'];
  else if (joint === 'NECK') {
    names = (poseMode === 'LATERAL') ? ['EAR', 'SHOULDER'] : ['EAR'];
    const g = (n) => landmarks?.[LM[`${S}_${n}`]];
    const other = side === 'left' ? 'RIGHT' : 'LEFT';
    const vals = [];
    for (const n of names) {
      const a = g(n); const b = landmarks?.[LM[`${other}_${n}`]];
      if (!a || (poseMode === 'LATERAL' && !b)) return null;
      vals.push(a.visibility == null ? 1 : a.visibility);
      if (poseMode === 'LATERAL') vals.push(b.visibility == null ? 1 : b.visibility);
    }
    const nz = landmarks?.[LM.NOSE];
    if (!nz) return null;
    vals.push(nz.visibility == null ? 1 : nz.visibility);
    return Math.min(...vals);
  }
  else return null;
  let min = 1;
  for (const n of names) {
    const p = landmarks?.[LM[`${S}_${n}`]];
    if (!p) return null;
    min = Math.min(min, p.visibility == null ? 1 : p.visibility);
  }
  return min;
}

// 옆모습 정렬 신호: 어깨폭 / 몸통길이(어깨중점↔골반중점). 완전 측면이면 두 어깨가 겹쳐
// 0에 가깝고 정면이면 약 0.8. 2D 각도는 카메라가 동작면과 수직일 때만 정확하므로
// 이 값이 크면(몸이 정면 쪽으로 돌아감) 각도가 실제보다 작게 나온다. 계산 불가면 null.
// ※ 어깨폭≈몸통길이×0.8 은 평균 체형 가정이다.
export function viewSeparationRatio(landmarks) {
  const ls = getLandmark(landmarks, LM.LEFT_SHOULDER, 0.3);
  const rs = getLandmark(landmarks, LM.RIGHT_SHOULDER, 0.3);
  const lh = getLandmark(landmarks, LM.LEFT_HIP, 0.3);
  const rh = getLandmark(landmarks, LM.RIGHT_HIP, 0.3);
  if (!ls || !rs || !lh || !rh) return null;
  const A = getFrameAspect();
  const sMid = midpoint(ls, rs);
  const hMid = midpoint(lh, rh);
  const trunk = Math.hypot((sMid.x - hMid.x) * A, sMid.y - hMid.y);
  if (trunk < EPS) return null;
  return Math.hypot((ls.x - rs.x) * A, ls.y - rs.y) / trunk;
}

// ────────────────────────────────────────────────────────────────────────
//  시계열 누적기 — 비동기 프레임이 들어올 때마다 push, 끝나면 summary().
//  좌/우 각도, 보상값, 타임스탬프를 시간순으로 쌓고, 스무딩 후 대표값을 낸다.
// ────────────────────────────────────────────────────────────────────────
export const NECK_NEUTRAL_N = 10; // 목 굽힘·폄 0점 산출에 쓰는 시작 프레임 수

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
    // [2611] 목 굽힘·폄은 귀→코 선의 절대 기울기라 중립에서도 0이 아니다 — 시작 구간(처음 10프레임) 중앙값을 0점으로 삼는다.
    //  (그래서 녹화는 목을 중립(정면 응시)으로 1초 두고 시작)
    if (this.joint === 'NECK' && (this.poseMode === 'FLEXION' || this.poseMode === 'EXTENSION')) {
      const nb = this._nb || (this._nb = { left: [], right: [] });
      for (const k of ['left', 'right']) {
        const o = k === 'left' ? L : R;
        if (o.angle == null) continue;
        if (nb[k].length < NECK_NEUTRAL_N) nb[k].push(o.angle);
        o.angle = round(o.angle - median(nb[k]), 1);
      }
    }
    const lean = trunkLeanCompensation(norm);
    const sep = torsoSeparationSignal(norm);
    this.samples.push({
      t: tMs,
      visL: jointMinVisibility(norm, this.joint, 'left', this.poseMode),
      visR: jointMinVisibility(norm, this.joint, 'right', this.poseMode),
      viewRatio: viewSeparationRatio(norm),
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
  // [2026-08-02 버그 수정] KNEE·ELBOW는 raw 내각이 굴곡할수록 "작아지고"
  // repMax()에서 (180 - raw)로 뒤집어 flexion 지표를 만든다. 그런데 이 필터가
  // ROM_NORMS의 min/max(=flexion 공간 값)를 raw 값에 그대로 적용하고 있었다 —
  // 즉 가장 깊이 굽힌(=raw가 가장 작은, 임상적으로 가장 중요한) 표본이
  // "비정상치"로 걸러져 최대 굴곡각이 실제보다 작게 보고되는 버그였다.
  // 두 관절은 min/max를 raw 공간으로 변환(180-x, 대소 반전)해서 필터링한다.
  _sanityRange() {
    const spec = ROM_NORMS[this.joint]?.[this.poseMode] || null;
    if (!spec) return { lo: -30, hi: 200 };
    const first = Object.values(spec)[0];
    if (this.joint === 'KNEE' || this.joint === 'ELBOW') {
      return { lo: Math.max(-30, 180 - first.max - 40), hi: 180 - first.min + 40 };
    }
    return { lo: Math.max(-30, first.min - 40), hi: first.max + 40 };
  }

  summary() {
    const { lo, hi } = this._sanityRange();
    const rawL = this.samples.map((s) => s.left);
    const rawR = this.samples.map((s) => s.right);
    const smL = movingAverage(rawL, this.smoothWindow).filter((v) => v != null && v >= lo && v <= hi);
    const smR = movingAverage(rawR, this.smoothWindow).filter((v) => v != null && v >= lo && v <= hi);

    // 굴곡 ROM 은 '최대 굴곡각'이 핵심 지표. HIP/SHOULDER 기준벡터각은 클수록 굴곡↑.
    // KNEE·ELBOW 내각은 굴곡 시 작아지므로(폄=180), maxFlexion = 180 - min(내각).
    // [2611] 전체 프레임의 단순 최댓값 대신 ① 잘 보이는 프레임(visibility≥0.5) 우선,
    //  ② 연속 5프레임 중앙값 기준 피크(순간 튐 제거), ③ 반복이 3회 이상 검출되면
    //  반복별 피크의 중앙값을 대표값으로 쓴다.
    const inner = this.joint === 'KNEE' || this.joint === 'ELBOW';
    const prep = (raw, vis) => {
      const sm = movingAverage(raw, this.smoothWindow);
      const all = [];
      sm.forEach((a, i) => { if (a != null) all.push({ a, v: vis[i], ok: a >= lo && a <= hi }); });
      const good = all.filter((it) => it.v != null && it.v >= ROM_CONFIDENT_VIS);
      const useGood = good.length >= ROM_MIN_GOOD_FRAMES;
      const src = useGood ? good : all;
      return {
        values: src.filter((it) => it.ok).map((it) => it.a), // 정상 범위 안 프레임(대표값용)
        series: src.map((it) => it.a),                        // 범위 필터 전 전체(반복 검출용 — 골짜기 필요)
        lowVisibility: all.length > 0 && !useGood,
        goodFramePct: all.length ? Math.round((good.length / all.length) * 100) : null,
      };
    };
    const repStats = (p) => {
      if (!p.values.length) return { max: null, sustained: null, reps: { peaks: [], count: 0, rangeDeg: 0 } };
      const ext = sustainedExtreme(p.values, inner ? 'min' : 'max');
      const sustained = round(inner ? 180 - ext : ext, 1);
      // 반복 검출은 범위 필터 전 시계열로(굽힘/폄 골짜기가 있어야 반복이 분리된다).
      const flex = inner ? p.series.map((x) => 180 - x) : p.series;
      const det = detectRepPeaks(flex);
      const peaks = det.peaks.filter((pk) => { const raw = inner ? 180 - pk : pk; return raw >= lo && raw <= hi; });
      const reps = { peaks, count: peaks.length, rangeDeg: det.rangeDeg };
      const max = reps.count >= 3 ? round(median(reps.peaks), 1) : sustained;
      return { max, sustained, reps };
    };
    const pickL = prep(rawL, this.samples.map((x) => x.visL));
    const pickR = prep(rawR, this.samples.map((x) => x.visR));
    const statL = repStats(pickL);
    const statR = repStats(pickR);
    const leftMax = statL.max;
    const rightMax = statR.max;

    // 안정성 요약(반복 일관성·가시성·옆모습 정렬) — 리포트에서 재측정 권고에 사용.
    const spreadOf = (peaks) => (peaks.length >= 2 ? round(Math.max(...peaks) - Math.min(...peaks), 1) : null);
    const sideStab = (pick, st) => ({
      rep_count: st.reps.count,
      rep_peaks: st.reps.peaks.map((x) => round(x, 1)),
      rep_spread_deg: spreadOf(st.reps.peaks),
      moved: st.reps.rangeDeg >= 15,
      sustained_peak_deg: st.sustained,
      peak_method: st.reps.count >= 3 ? 'rep_median' : 'sustained_peak',
      low_visibility: pick.lowVisibility,
      good_frame_pct: pick.goodFramePct,
    });
    const viewRatios = this.samples.map((x) => x.viewRatio).filter((x) => x != null);
    // 벌림(ABDUCTION)은 정면 촬영이라 판정 방향이 반대(비율이 작으면 몸이 옆으로 돌아선 것).
    const frontView = this.poseMode === 'ABDUCTION' || this.poseMode === 'SUPINE_ABD' || this.poseMode === 'LATERAL' || this.poseMode === 'ROTATION'; // 정면/위에서 내려다보는 촬영
    const viewBad = (x) => (frontView ? x < ROM_VIEW_RATIO_MIN_FRONT : x > ROM_VIEW_RATIO_MAX);
    const viewBadPct = viewRatios.length
      ? Math.round((viewRatios.filter(viewBad).length / viewRatios.length) * 100) : null;
    const stability = {
      left: sideStab(pickL, statL),
      right: sideStab(pickR, statR),
      view: {
        shoulder_ratio_median: viewRatios.length ? round(median(viewRatios), 2) : null,
        bad_frame_pct: viewBadPct,
        ok: viewRatios.length >= 10 ? (!viewBad(median(viewRatios)) && viewBadPct <= 30) : null,
      },
      warnings: [],
    };
    for (const [k, st] of [['left', stability.left], ['right', stability.right]]) {
      if (!st.moved) continue; // 움직이지 않은 쪽(편측 측정)은 평가하지 않는다
      if (st.rep_count < 3) stability.warnings.push(`${k}_few_reps`);
      if (st.rep_spread_deg != null && st.rep_spread_deg >= ROM_REP_SPREAD_WARN) stability.warnings.push(`${k}_rep_spread`);
      if (st.low_visibility) stability.warnings.push(`${k}_low_visibility`);
    }
    if (stability.view.ok === false) stability.warnings.push(frontView ? 'view_not_front' : 'view_not_side');

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
      pelvic_drop_pct: (this.poseMode === 'STANDING' || (this.poseMode === 'ABDUCTION' && this.joint === 'HIP')) ? (compL ?? compR ?? null) : null,
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
      stability,
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
