// ai-measure/core/compareAngles.js
// 전/후 비교 '동작 분석'의 각도 계산(순수 함수). 한쪽 옆면의 7점만 쓴다.
//  · 점 좌표는 0~1, 각도는 장면의 실제 픽셀 비율(w,h)로 계산한 2D 화면 각도(참고값).

export const POINT_KEYS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'foot'];
export const POINT_NAMES = { shoulder: '어깨', elbow: '팔꿈치', wrist: '손목', hip: '골반', knee: '무릎', ankle: '발목', foot: '발끝' };
export const BONES = [['shoulder', 'elbow'], ['elbow', 'wrist'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'foot']];
const IDS = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, foot: 31 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, foot: 32 },
};

/** 더 잘 보이는 쪽(가까운 쪽 옆면). */
export function pickSide(landmarks) {
  const sum = (s) => Object.values(IDS[s]).reduce((a, i) => a + (landmarks?.[i]?.visibility ?? 0), 0);
  return sum('right') > sum('left') ? 'right' : 'left';
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 랜드마크 → 7점. low 는 가시성이 낮아 확인이 필요한 점. */
export function pointsFromLandmarks(landmarks, side) {
  const points = {};
  const low = [];
  POINT_KEYS.forEach((k) => {
    const p = landmarks[IDS[side][k]];
    points[k] = { x: clamp01(p?.x ?? 0.5), y: clamp01(p?.y ?? 0.5) };
    if (!p || (p.visibility ?? 1) < 0.5) low.push(k);
  });
  return { points, low };
}

/** 인식 실패 시 직접 끌어 맞추는 기본 점. */
export function templatePoints() {
  const y = { shoulder: 0.28, elbow: 0.40, wrist: 0.50, hip: 0.50, knee: 0.68, ankle: 0.86, foot: 0.89 };
  return Object.fromEntries(POINT_KEYS.map((k) => [k, { x: k === 'foot' ? 0.58 : k === 'elbow' || k === 'wrist' ? 0.56 : 0.5, y: y[k] }]));
}

function between(a, b, c, w, h) {
  const v1 = { x: (a.x - b.x) * w, y: (a.y - b.y) * h };
  const v2 = { x: (c.x - b.x) * w, y: (c.y - b.y) * h };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!m) return null;
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / m))) * 180) / Math.PI;
}

export const METRICS = [
  { key: 'trunk', label: '상체 기울기', help: '수직선에서 기운 각', needs: ['shoulder', 'hip'] },
  { key: 'shoulder', label: '어깨', help: '몸통에서 팔이 벌어진 각', needs: ['hip', 'shoulder', 'elbow'] },
  { key: 'elbow', label: '팔꿈치 굽힘', help: '편 상태 0°', needs: ['shoulder', 'elbow', 'wrist'] },
  { key: 'hip', label: '고관절 굽힘', help: '편 상태 0°', needs: ['shoulder', 'hip', 'knee'] },
  { key: 'knee', label: '무릎 굽힘', help: '편 상태 0°', needs: ['hip', 'knee', 'ankle'] },
  { key: 'ankle', label: '발목', help: '정강이와 발이 이루는 각', needs: ['knee', 'ankle', 'foot'] },
];

export function computeMetrics(p, w, h) {
  if (!p || !w || !h) return {};
  const r = (v) => (v == null ? null : Math.round(v));
  const inner = (a, b, c) => between(p[a], p[b], p[c], w, h);
  const bend = (a, b, c) => { const v = inner(a, b, c); return v == null ? null : 180 - v; };
  const dx = Math.abs(p.shoulder.x - p.hip.x) * w;
  const dy = (p.hip.y - p.shoulder.y) * h;
  return {
    trunk: dx || dy ? r((Math.atan2(dx, dy) * 180) / Math.PI) : null,
    shoulder: r(inner('hip', 'shoulder', 'elbow')),
    elbow: r(bend('shoulder', 'elbow', 'wrist')),
    hip: r(bend('shoulder', 'hip', 'knee')),
    knee: r(bend('hip', 'knee', 'ankle')),
    ankle: r(inner('knee', 'ankle', 'foot')),
  };
}
