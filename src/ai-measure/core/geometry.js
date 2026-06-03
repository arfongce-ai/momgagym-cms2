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

/** 좌우 대칭 두 점(예: 양 어깨)의 기울기. 절대값과 방향(left_low/right_low) 반환. */
export function symmetryTilt(left, right) {
  if (!left || !right) return null;
  const deg = tiltAngleDeg(left, right); // left→right 방향
  const abs = Math.abs(deg);
  // deg>0 이면 right 가 화면 아래(y 큼) = 오른쪽이 처짐
  const dir = Math.abs(deg) < 0.5 ? 'level' : deg > 0 ? 'right_low' : 'left_low';
  return { deg: Number(abs.toFixed(1)), direction: dir, raw: Number(deg.toFixed(1)) };
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
