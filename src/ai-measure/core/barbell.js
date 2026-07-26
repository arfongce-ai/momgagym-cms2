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

// 추적 안정화 상수 (민감도 낮춤)
//  - EMA_ALPHA: 작을수록 부드러움↑(떨림↓). 0.25 = 강한 떨림 완화.
//  - DEADZONE:  이보다 작은 프레임 간 이동은 "정지"로 보고 무시(미세 흔들림 컷).
const EMA_ALPHA = 0.25;
const DEADZONE = 0.004; // 화면비율(0~1) 기준 약 0.4% — 미세 떨림 흡수

/**
 * 한 세트(reps) 동안 바벨 궤적을 누적해 ROM·반복을 추정하는 트래커.
 * createBarbellTracker() → tracker.push(point, ts) 반복 → tracker.summary().
 *
 * 안정화 처리:
 *  1) EMA 평활 — 들어온 좌표를 부드럽게 만들어 떨림 제거.
 *  2) 데드존 — 직전 평활값과의 이동이 미세하면 위치를 갱신하지 않음(정지로 간주).
 *  이 두 가지로 "가만히 있어도 ROM이 커지는" 문제와 "선이 튀는" 문제를 함께 잡는다.
 */
export function createBarbellTracker() {
  const samples = [];     // { x, y, ts } — 평활·데드존 적용된 안정 좌표
  let minY = Infinity, maxY = -Infinity;
  let sx = null, sy = null; // EMA 상태(평활 좌표)

  return {
    reset() {
      samples.length = 0; minY = Infinity; maxY = -Infinity; sx = null; sy = null;
    },
    push(point, ts) {
      if (!point) return;
      // 1) EMA 평활
      if (sx == null) { sx = point.x; sy = point.y; }
      else {
        sx = sx + (point.x - sx) * EMA_ALPHA;
        sy = sy + (point.y - sy) * EMA_ALPHA;
      }
      // 2) 데드존 — 직전 안정 좌표와 거의 같으면 정지로 보고 새 점 추가 안 함
      const last = samples[samples.length - 1];
      if (last) {
        const dx = sx - last.x, dy = sy - last.y;
        if (Math.hypot(dx, dy) < DEADZONE) {
          // 시간만 갱신(정지 구간도 시간엔 포함되도록)
          last.ts = ts;
          return;
        }
      }
      samples.push({ x: sx, y: sy, ts });
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    },
    /** 화면에 그릴 안정 좌표(궤적) 반환 */
    path() { return samples; },
    /** 현재 안정(평활) 좌표 — 점 표시용 */
    current() { return sx == null ? null : { x: sx, y: sy }; },
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

export function romToCmScaled(romRatio, cmPerRatio) {
  const ratio = Number(romRatio);
  const scale = Number(cmPerRatio);
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(scale) || scale <= 0) return null;
  return Math.round(ratio * scale * 10) / 10;
}

export function trimPathToRange(samples, startMs, endMs) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Array.isArray(samples) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const picked = samples.filter((s) => {
    const ts = Number(s?.ts);
    return Number.isFinite(ts) && ts >= start && ts <= end;
  });
  if (picked.length < 2) return null;
  const ys = picked.map(s => Number(s.y)).filter(Number.isFinite);
  if (ys.length < 2) return null;
  return {
    samples: picked.length,
    durationMs: Math.round(Number(picked[picked.length - 1].ts) - Number(picked[0].ts)),
    romRatio: Math.max(...ys) - Math.min(...ys),
    path: picked,
  };
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
