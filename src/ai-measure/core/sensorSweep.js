// ai-measure/core/sensorSweep.js
// 고니오메타 "쓸기 모드" — 폰을 척추 위로 천천히 쓸어 올리며 지점마다 기울기를 기록하고,
// 지점 간 차이(위쪽 − 아래쪽)로 구간 각도를 낸다. 교재의 경사계 두 개 방식(위쪽 − 아래쪽)을
// 한 대의 폰으로 연속해서 하는 것이다. 0점 보정이 필요 없다(차이라서 시작값이 상쇄).
//  · 순수 계산만 둔다(센서·화면 없음) — 테스트 대상.
//  · 정확도는 실기기 검증 전이다. 지점은 사람이 '표시' 버튼으로 정한다(거리는 재지 않음).

import { median } from './sensorTilt';
import { accDeviation, CHECK_ACC_WARN, CHECK_JITTER_WARN } from './sensorPlacementCheck';

// 지점·구간 프리셋(교재 9장 몸통 457~470쪽의 경사계 위치에 맞춤).
//  · 교재 경사계법: 등허리 = C7 − S2, 허리 = (S2 위 15cm) − S2, 가쪽 굽힘 = T1 − S2(여기선 C7로 대신 표시).
//  · 근사 구간(요추부 T12−S2, 흉추부 C7−T12)은 같은 방식으로 나눈 참고값이다(교재 구분 아님).
const TRUNK_BEND = {
  points: [
    { key: 'S2', label: 'S2(양쪽 뒤엉덩뼈가시 중간)' },
    { key: 'L15', label: 'S2 위 15cm' },
    { key: 'T12', label: 'T12(갈비뼈 맨 아래 높이)' },
    { key: 'C7', label: 'C7(목 아래 튀어나온 뼈)' },
  ],
  segments: [
    { key: 'thoracolumbar', label: '등허리 전체 (C7 − S2)', upper: 'C7', lower: 'S2', textbook: true },
    { key: 'lumbar', label: '허리 (S2 위 15cm − S2)', upper: 'L15', lower: 'S2', textbook: true },
    { key: 'lumbar_t12', label: '요추부 근사 (T12 − S2)', upper: 'T12', lower: 'S2', textbook: false },
    { key: 'thoracic', label: '흉추부 근사 (C7 − T12)', upper: 'C7', lower: 'T12', textbook: false },
  ],
};
// 돌림(교재 470쪽 경사계법): 앉아 몸통을 바닥과 평행하게 숙인 자세, 경사계 T1·T12 → 두 측정값의 차이.
const TRUNK_ROT = {
  points: [
    { key: 'T12', label: 'T12(갈비뼈 맨 아래 높이)' },
    { key: 'T1', label: 'T1(C7 바로 아래)' },
  ],
  segments: [
    { key: 'thoracic_rotation', label: '등뼈 돌림 (T1 − T12)', upper: 'T1', lower: 'T12', textbook: true },
  ],
};
export const SWEEP_PRESETS = {
  TRUNK: { yz: TRUNK_BEND, yx: TRUNK_BEND, xz: TRUNK_ROT },
};

export function getSweepPreset(jointKey, plane = 'yz') {
  return SWEEP_PRESETS[jointKey]?.[plane] || null;
}

// −180..180 으로 접기
export function wrapDeg(d) {
  if (d == null || !Number.isFinite(d)) return null;
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

// 기록기: 최근 샘플을 링버퍼로 보관, mark() 때 마지막 windowMs 구간의 중앙값을 그 지점 각도로 삼는다.
//  흔들림(최대−최소)·가속도(움직임)가 크면 quality='shaky' 로 표시해 재측정을 권한다.
export function createSweepRecorder({ maxSamples = 900, windowMs = 500, minSamples = 5 } = {}) {
  let buf = []; // { t, deg, accDev }
  return {
    push(deg, accMag, tMs) {
      if (deg == null || !Number.isFinite(deg)) return;
      buf.push({ t: tMs, deg, accDev: accDeviation(accMag) });
      if (buf.length > maxSamples) buf.shift();
    },
    mark(key, nowMs) {
      const win = buf.filter((s) => nowMs - s.t <= windowMs);
      if (win.length < minSamples) return null;
      const degs = win.map((s) => s.deg);
      const range = Math.max(...degs) - Math.min(...degs);
      const devs = win.map((s) => s.accDev).filter((v) => v != null);
      const accDev = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : null;
      const shaky = range > CHECK_JITTER_WARN || (accDev != null && accDev > CHECK_ACC_WARN);
      return {
        key,
        angle: Math.round(median(degs) * 10) / 10,
        range: Math.round(range * 10) / 10,
        accDev: accDev == null ? null : Math.round(accDev * 1000) / 1000,
        quality: shaky ? 'shaky' : 'ok',
        t: nowMs,
      };
    },
    // 곡선용 시계열(전체) — 화면 표시 전용
    series() { return buf.map((s) => ({ t: s.t, deg: s.deg })); },
    reset() { buf = []; },
    size() { return buf.length; },
  };
}

// 구간 각도: 위쪽 지점 − 아래쪽 지점(−180..180). flip=true 면 부호 반전(폰 방향·기기 차이 보정용).
//  marks: [{key, angle, quality}] (같은 key 가 여러 번이면 마지막 것)
export function computeSegments(marks, segments, { flip = false } = {}) {
  const byKey = {};
  for (const m of marks || []) byKey[m.key] = m;
  return (segments || []).map((sg) => {
    const u = byKey[sg.upper], l = byKey[sg.lower];
    if (!u || !l) return { ...sg, value: null, ok: false, reason: 'missing' };
    const raw = wrapDeg(u.angle - l.angle);
    const value = Math.round((flip ? -raw : raw) * 10) / 10;
    const shaky = u.quality === 'shaky' || l.quality === 'shaky';
    return { ...sg, value, ok: !shaky, reason: shaky ? 'shaky' : null };
  });
}

// 곡선 그리기용 점(0~1 정규화). 시계열이 짧으면 null.
export function profilePoints(series, { flip = false, width = 1, height = 1 } = {}) {
  if (!Array.isArray(series) || series.length < 5) return null;
  const degs = series.map((s) => (flip ? -s.deg : s.deg));
  const lo = Math.min(...degs), hi = Math.max(...degs);
  const span = Math.max(5, hi - lo); // 너무 평평해도 눈금이 폭주하지 않게
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const dt = Math.max(1, t1 - t0);
  return series.map((s, i) => ({
    x: ((s.t - t0) / dt) * width,
    y: height - ((degs[i] - lo) / span) * height,
  }));
}

// 자동 표시기 — 폰을 지점에 대고 holdMs 동안 멈추면 한 번 발화한다(버튼을 안 눌러도 되게).
//  · 시작·발화 직후에는 '움직임'(가속 또는 각도 변화)이 감지돼야 다음 지점을 받는다(같은 지점 중복·손에 든 채 멈춤 방지).
//  · 멈춤 판정: 최근 holdMs 동안 각도 범위 ≤ stillRange 이고 평균 가속 편차 ≤ stillAcc.
//  push() → { fire, progress(0~1), angle } — progress 는 '멈춘 채 유지한 시간 / holdMs'.
export function createAutoMarker({
  holdMs = 1000, stillRange = 1.5, stillAcc = 0.05, moveAcc = 0.08, moveRange = 2.5, moveWinMs = 300,
} = {}) {
  let buf = []; // { t, deg, acc }
  let armed = false; // 시작은 '해제' — 폰을 집어 등에 대는 움직임이 먼저 있어야 첫 지점이 잡힌다(손에 든 채 멈춘 것은 무시)
  return {
    push(deg, accMag, tMs) {
      if (deg == null || !Number.isFinite(deg)) { buf = []; return { fire: false, progress: 0, angle: null }; }
      buf.push({ t: tMs, deg, acc: accDeviation(accMag) });
      while (buf.length && tMs - buf[0].t > holdMs * 2.5) buf.shift();

      // 최근 moveWinMs 의 움직임 → 재무장
      if (!armed) {
        const rec = buf.filter((s) => tMs - s.t <= moveWinMs);
        if (rec.length >= 3) {
          const ds = rec.map((s) => s.deg);
          const accMax = Math.max(...rec.map((s) => (s.acc == null ? 0 : s.acc)));
          if (Math.max(...ds) - Math.min(...ds) > moveRange || accMax > moveAcc) armed = true;
        }
        return { fire: false, progress: 0, angle: null };
      }

      // 뒤에서부터 '각도 범위가 stillRange 이내'인 가장 긴 꼬리 구간을 찾는다.
      let lo = Infinity, hi = -Infinity, accSum = 0, n = 0, startT = tMs;
      for (let i = buf.length - 1; i >= 0; i--) {
        const s = buf[i];
        const nlo = Math.min(lo, s.deg), nhi = Math.max(hi, s.deg);
        if (nhi - nlo > stillRange) break;
        lo = nlo; hi = nhi; startT = s.t; n++;
        if (s.acc != null) accSum += s.acc;
      }
      const heldMs = tMs - startT;
      const meanAcc = n ? accSum / n : 0;
      const stillOk = meanAcc <= stillAcc;
      const progress = stillOk ? Math.min(1, heldMs / holdMs) : 0;
      if (stillOk && heldMs >= holdMs && n >= 5) {
        armed = false;
        const tail = buf.slice(buf.length - n).map((s) => s.deg);
        return { fire: true, progress: 1, angle: median(tail) };
      }
      return { fire: false, progress, angle: null };
    },
    rearm() { armed = true; },
    disarm() { armed = false; },
    reset() { buf = []; armed = false; },
    isArmed() { return armed; },
  };
}
