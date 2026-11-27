// ai-measure/core/poseRobust.js
// 정지 장면 인식 재시도 — 한 번에 못 잡으면 여백을 두른 화면, 가운데 확대 화면으로 다시 본다.
//  · 반환 좌표는 항상 '원본 장면' 기준 0~1 이다.
import { detectPoseImage } from './poseImageBackend';

const CORE = [11, 12, 23, 24, 25, 26, 27, 28];

/** 몸통·다리 8점의 평균 가시성(0~1). */
export function poseScore(landmarks) {
  if (!landmarks?.length) return 0;
  return CORE.reduce((s, i) => s + (landmarks[i]?.visibility ?? 0), 0) / CORE.length;
}

// 원본에서 (sx,sy,sw,sh) 영역이 변형 화면 전체에 어떻게 놓이는지로 좌표를 되돌린다.
export const VARIANTS = [
  { name: 'full' },
  { name: 'padded', pad: 0.25 },   // 몸이 화면에 꽉 차거나 잘린 경우
  { name: 'center', crop: 0.7 },   // 사람이 작게 찍힌 경우
];

export function mapBack(landmarks, { pad = 0, crop = 1 }) {
  return landmarks.map((p) => {
    if (pad) return { ...p, x: p.x * (1 + 2 * pad) - pad, y: p.y * (1 + 2 * pad) - pad };
    return { ...p, x: (1 - crop) / 2 + p.x * crop, y: (1 - crop) / 2 + p.y * crop };
  });
}

function makeVariant(src, { pad = 0, crop }) {
  const w = src.width; const h = src.height;
  const c = document.createElement('canvas');
  if (pad) {
    c.width = Math.round(w * (1 + 2 * pad)); c.height = Math.round(h * (1 + 2 * pad));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, w * pad, h * pad, w, h);
  } else {
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, (w * (1 - crop)) / 2, (h * (1 - crop)) / 2, w * crop, h * crop, 0, 0, w, h);
  }
  return c;
}

/** @returns {{ landmarks, score, variant } | null} */
export function detectPoseRobust(canvas, goodScore = 0.7) {
  let best = null;
  for (const v of VARIANTS) {
    const res = detectPoseImage(v.name === 'full' ? canvas : makeVariant(canvas, v));
    if (!res) continue;
    const landmarks = v.name === 'full' ? res.landmarks : mapBack(res.landmarks, v);
    const score = poseScore(landmarks);
    if (!best || score > best.score) best = { landmarks, score, variant: v.name };
    if (best.score >= goodScore) break;
  }
  return best;
}
