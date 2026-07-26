// ai-measure/core/geometry.js
// 자세·관절 측정 공통 기하 계산. 모든 측정 메뉴가 공유한다.
// MediaPipe Pose 랜드마크는 {x, y, z, visibility} (x,y는 0~1 정규화 좌표).

/** 두 점을 잇는 선의 '수평 대비 기울기'(도). 0=완전 수평. 양수=오른쪽이 내려감. */
export function tiltAngleDeg(a, b) {
  if (!a || !b) return null;
  // 화면 y는 아래로 갈수록 커지므로 부호 보정
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * 좌우 대칭 두 점(예: 양 어깨)의 수평 기울기.
 * 입력 순서와 무관하게 '화면 기준'으로 판정한다.
 *  - 두 점을 화면 x좌표로 정렬(왼쪽→오른쪽) 후 기울기 계산
 *  - direction: 'level' | 'right_low'(화면 오른쪽이 낮음) | 'left_low'(화면 왼쪽이 낮음)
 *  - deg: 수평선 대비 절대 기울기(0~90)
 */
export function symmetryTilt(p1, p2) {
  if (!p1 || !p2) return null;
  // 화면 왼쪽 점(L), 오른쪽 점(R)으로 정렬
  const L = p1.x <= p2.x ? p1 : p2;
  const R = p1.x <= p2.x ? p2 : p1;
  const dx = R.x - L.x;
  const dy = R.y - L.y;          // y는 아래로 갈수록 큼
  if (dx === 0 && dy === 0) return null;
  // 수평선 대비 기울기(절대). dx가 0에 가까우면(거의 수직) 큰 각.
  const deg = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  const abs = deg > 90 ? 180 - deg : deg;   // 0~90 범위로
  // dy>0 → 오른쪽 점이 더 아래(화면 오른쪽이 낮음)
  const dir = abs < 0.5 ? 'level' : dy > 0 ? 'right_low' : 'left_low';
  return { deg: Number(abs.toFixed(1)), direction: dir, raw: Number(dy.toFixed(4)) };
}

/** 세 점 a-b-c 의 b 꼭짓점 내각(도). 관절 각도용. */
export function jointAngleDeg(a, b, c) {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (mag === 0) return null;
  const cos = Math.max(-1, Math.min(1, dot / mag));
  return Number(((Math.acos(cos) * 180) / Math.PI).toFixed(1));
}

/** 한 점이 수직선(중심선)에서 벗어난 기울기(도). top 기준 bottom 의 좌우 치우침. */
export function verticalDeviationDeg(top, bottom) {
  if (!top || !bottom) return null;
  const dx = bottom.x - top.x;
  const dy = bottom.y - top.y;
  if (dy === 0) return null;
  // 수직(dy축) 대비 좌우(dx) 기울기
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return Number(deg.toFixed(1));
}

/** 두 점의 중점. */
export function midpoint(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 };
}

/** 랜드마크 신뢰도가 충분한지(가시성). 기본 0.5 이상. */
export function isVisible(lm, threshold = 0.5) {
  return !!lm && (lm.visibility == null || lm.visibility >= threshold);
}

// MediaPipe Pose 33 랜드마크 인덱스 (자주 쓰는 것만 명명)
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
  LEFT_FOOT: 31, RIGHT_FOOT: 32,
});

// ───────── 옆면(시상면) 자세 분석용 ─────────

/**
 * 수직 기준선(발목 통과)으로부터의 수평 편차를 화면비율로 반환.
 * point.x, refX 모두 0~1 정규화 좌표. 양수=기준선보다 화면 오른쪽.
 */
export function horizontalOffset(point, refX) {
  if (!point || refX == null) return null;
  return point.x - refX; // 0~1 비율
}

/**
 * 화면비율 편차 → cm 추정.
 * 사람 키(heightCm)와 화면상 신장(머리~발목 y범위, 0~1)을 이용해
 * "화면비율 1.0 = 몇 cm"인지 스케일을 구해 변환.
 * @param offsetRatio horizontalOffset 결과(0~1)
 * @param pxHeightRatio 화면상 신장 비율(0~1)
 * @param heightCm 실제 키(cm)
 */
export function offsetToCm(offsetRatio, pxHeightRatio, heightCm) {
  if (offsetRatio == null || !pxHeightRatio || !heightCm) return null;
  const cmPerRatio = heightCm / pxHeightRatio; // 화면비율 1당 cm
  return Math.round(offsetRatio * cmPerRatio * 10) / 10;
}

/**
 * 골반 전/후방 경사 추정(옆면).
 * 장골능 중앙(추정점)과 고관절을 잇는 선의 수직 대비 기울기 방향.
 * anterior(전방경사): 골반 윗부분이 앞으로 → 허리 과전만 경향
 * @returns {{ deg:number, type:'anterior'|'posterior'|'neutral' }}
 */
export function pelvicTilt(iliac, hip, facingRight) {
  if (!iliac || !hip) return null;
  const dx = iliac.x - hip.x;
  const dy = iliac.y - hip.y; // 위가 작음
  const deg = Math.round(Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI) * 10) / 10;
  // facingRight: 피험자가 화면 오른쪽을 보는가
  // 장골능이 고관절보다 앞(바라보는 방향)이면 전방경사
  const iliacForward = facingRight ? (iliac.x > hip.x) : (iliac.x < hip.x);
  let type = 'neutral';
  if (deg >= 7) type = iliacForward ? 'anterior' : 'posterior';
  return { deg, type };
}

/**
 * 장골능 중앙 추정점. MediaPipe에 직접 랜드마크가 없어
 * 고관절에서 어깨 방향으로 약 15% 올라간 지점으로 근사.
 */
export function estimateIliac(hipMid, shoulderMid) {
  if (!hipMid || !shoulderMid) return null;
  return {
    x: hipMid.x + (shoulderMid.x - hipMid.x) * 0.15,
    y: hipMid.y + (shoulderMid.y - hipMid.y) * 0.15,
  };
}

// ───────── 임상 정렬 판정 (Kendall plumb line 기준) ─────────
// 측면 이상 정렬: 기준선(외측복사 약간 앞)을 통과할 때
//   - 귀(외이도): 기준선 통과(0)
//   - 어깨(견봉): 기준선 통과(0)
//   - 고관절: 약간 뒤(-)
//   - 무릎: 약간 앞(+)
// 임상 유의 편차: 10mm(1cm) 이상 (연구 기준)
// 부호: + = 기준선보다 앞(전방), - = 뒤(후방)

const CLINICAL_THRESHOLD_CM = 1.0; // 10mm

/**
 * 측면 랜드마크 cm 편차 → 임상 해석.
 * @param part 'ear'|'shoulder'|'hip'|'knee'
 * @param cm 기준선 대비 cm (앞 +, 뒤 -)
 * @returns {{ status:'normal'|'anterior'|'posterior', note:string }|null}
 */
export function classifyAlignment(part, cm) {
  if (cm == null) return null;
  // 이상 위치 보정값(기준선 대비): 고관절은 약간 뒤, 무릎은 약간 앞이 정상
  const ideal = { ear: 0, shoulder: 0, hip: -0.5, knee: 0.5 };
  const dev = cm - (ideal[part] ?? 0);   // 이상 위치로부터의 편차
  if (Math.abs(dev) < CLINICAL_THRESHOLD_CM) {
    return { status: 'normal', note: '정상 범위' };
  }
  if (dev > 0) {
    const labels = { ear: '전방머리(forward head)', shoulder: '둥근어깨(rounded)', hip: '전방', knee: '과신전 경향' };
    return { status: 'anterior', note: labels[part] || '전방 편위' };
  }
  const labels = { ear: '후방', shoulder: '후방', hip: '후방', knee: '굴곡 경향' };
  return { status: 'posterior', note: labels[part] || '후방 편위' };
}
