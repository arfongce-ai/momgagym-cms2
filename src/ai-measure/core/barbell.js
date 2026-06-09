// ai-measure/core/barbell.js
// 바벨 위치/이동 추적 — MediaPipe 손목(LEFT/RIGHT_WRIST) 중점을 바벨 손잡이 위치로 본다.
// 별도 객체검출 없이 사람 관절만으로 바벨 궤적을 근사(역도/1RM 보조용).
//
//  - 바벨 중심 = 양 손목 중점 (둘 중 하나만 보이면 그 손목)
//  - 수직 변위(ROM): 한 세트 동안의 y 최저점~최고점 폭
//  - 화면비율 → cm 변환은 사람 키 스케일 사용(geometry.offsetToCm 와 동일 원리)

import { LM } from './geometry';

/** 양 손목 중점(정규화 0~1). 손목이 안 보이면 null. */
export function barbellPoint(lms) {
  if (!lms) return null;
  const lw = lms[LM.LEFT_WRIST], rw = lms[LM.RIGHT_WRIST];
  const vis = (p) => p && (p.visibility == null || p.visibility >= 0.3);
  if (vis(lw) && vis(rw)) return { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 };
  if (vis(lw)) return { x: lw.x, y: lw.y };
  if (vis(rw)) return { x: rw.x, y: rw.y };
  return null;
}

/**
 * 한 세트(reps) 동안 바벨 궤적을 누적해 ROM·반복을 추정하는 트래커.
 * createBarbellTracker() → tracker.push(point, ts) 반복 → tracker.summary().
 */
export function createBarbellTracker() {
  const samples = [];     // { y, ts }
  let minY = Infinity, maxY = -Infinity;

  return {
    reset() { samples.length = 0; minY = Infinity; maxY = -Infinity; },
    push(point, ts) {
      if (!point) return;
      samples.push({ y: point.y, x: point.x, ts });
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    },
    /** @returns {{ romRatio:number, samples:number, durationMs:number }|null} */
    summary() {
      if (samples.length < 5) return null;
      const romRatio = maxY - minY;            // 화면비율(0~1) 수직 변위
      const durationMs = samples[samples.length - 1].ts - samples[0].ts;
      return {
        romRatio: Math.round(romRatio * 1000) / 1000,
        samples: samples.length,
        durationMs: Math.round(durationMs),
      };
    },
  };
}

/**
 * 화면비율 변위 → cm. personHeightRatio(머리~발목 y폭)와 실제 키로 스케일.
 */
export function romToCm(romRatio, personHeightRatio, heightCm) {
  if (!romRatio || !personHeightRatio || !heightCm) return null;
  return Math.round((romRatio / personHeightRatio) * heightCm * 10) / 10;
}

/** 사람 화면상 신장(머리~발목 y폭, 0~1) */
export function personHeightRatio(lms) {
  if (!lms) return null;
  const top = lms[LM.NOSE] || lms[LM.LEFT_EAR] || lms[LM.RIGHT_EAR];
  const ankles = [lms[LM.LEFT_ANKLE], lms[LM.RIGHT_ANKLE]].filter(Boolean);
  if (!top || !ankles.length) return null;
  const botY = Math.max(...ankles.map(a => a.y));
  return Math.abs(botY - top.y);
}
