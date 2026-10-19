// sprintMetrics.js — 스프린트/왕복 달리기 파생 지표 (2026-10)
//
// SprintTracker 가 모은 원자료(samples·splits·turns)에서 10m 구간으로 뽑을 수 있는 값을 계산한다.
// 순수 함수 — 카메라/브라우저 의존 없음.
//
// 정확성 메모(코드 근거):
//  · 순간 속도는 1프레임(약 33ms) 위치 차이라 노이즈가 커서, 최고속도·가속은 0.2초 창으로 평균낸 값을 따로 쓴다.
//  · 시간은 영상 프레임 시각 기준이라 한 프레임(약 33ms) 단위로 양자화된다.

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

const WINDOW_MS = 200;

/** 0.2초 이상 떨어진 두 표본으로 평균 속도를 낸다(부호 있음). */
function windowedVelocities(samples, windowMs = WINDOW_MS) {
  const out = [];
  let j = 0;
  for (let i = 0; i < samples.length; i++) {
    if (j < i) j = i;
    while (j < samples.length && samples[j].tMs - samples[i].tMs < windowMs) j++;
    if (j >= samples.length) break;
    const dt = (samples[j].tMs - samples[i].tMs) / 1000;
    if (dt <= 0) continue;
    out.push({
      tMs: Math.round((samples[i].tMs + samples[j].tMs) / 2),
      distanceM: (samples[i].distanceM + samples[j].distanceM) / 2,
      v: (samples[j].distanceM - samples[i].distanceM) / dt,
    });
  }
  return out;
}

/** 구간 기록(누적) → 구간별 시간·평균속도. splits: { '1m': ms, '2m': ms, ... } */
export function intervalTable(splits = {}) {
  const pts = Object.entries(splits)
    .map(([k, ms]) => ({ d: Number(String(k).replace('m', '')), ms: Number(ms) }))
    .filter((p) => Number.isFinite(p.d) && Number.isFinite(p.ms))
    .sort((a, b) => a.d - b.d);
  const rows = [];
  let prev = { d: 0, ms: 0 };
  for (const p of pts) {
    const dt = p.ms - prev.ms;
    const dd = p.d - prev.d;
    rows.push({
      fromM: prev.d, toM: p.d, timeMs: Math.round(dt),
      avgVelocityMs: dt > 0 ? r2(dd / (dt / 1000)) : null,
    });
    prev = p;
  }
  return rows;
}

function timeBetween(splits, fromM, toM) {
  const t = (d) => (d === 0 ? 0 : splits?.[`${d}m`]);
  const a = t(fromM), b = t(toM);
  return a == null || b == null ? null : Math.round(b - a);
}

/**
 * @param {object} p
 * @param {Array}  p.samples   [{tMs,distanceM,velocityMs}]
 * @param {object} p.splits    { '5m': ms, '10m': ms, ... }  (finalize 의 splitsOut)
 * @param {Array}  p.turns     [{atDistanceM,tMs}]  (왕복)
 * @param {'sprint'|'agility'} p.mode
 * @param {number} p.trackDistanceM 편도 거리
 */
export function deriveSprintMetrics({ samples = [], splits = {}, turns = [], mode = 'sprint', trackDistanceM = 0 } = {}) {
  const out = {
    intervals: intervalTable(splits),
    peakVelocitySmoothMs: null,
    peakVelocitySmoothAtM: null,
    timeToPeakMs: null,
    maxAccelMs2: null,
    speedMaintenancePct: null,
    firstHalfMs: null,
    secondHalfMs: null,
    legs: [],
  };
  if (!samples.length) return out;

  const win = windowedVelocities(samples);
  const fwd = win.map((w) => ({ ...w, v: Math.abs(w.v) }));
  if (fwd.length) {
    const pk = fwd.reduce((m, w) => (w.v > m.v ? w : m), fwd[0]);
    out.peakVelocitySmoothMs = r2(pk.v);
    out.peakVelocitySmoothAtM = r1(Math.abs(pk.distanceM));
    out.timeToPeakMs = pk.tMs;

    // 최대 가속: 최고속도에 이르기까지 0.2초 간격 속도 변화의 최댓값
    let best = null;
    const upTo = win.filter((w) => w.tMs <= pk.tMs);
    for (let i = 1; i < upTo.length; i++) {
      const dt = (upTo[i].tMs - upTo[i - 1].tMs) / 1000;
      if (dt <= 0) continue;
      const a = (Math.abs(upTo[i].v) - Math.abs(upTo[i - 1].v)) / dt;
      if (best == null || a > best) best = a;
    }
    out.maxAccelMs2 = best == null ? null : r1(best);
  }

  if (mode === 'sprint' && trackDistanceM >= 10) {
    // 10m 스프린트: 0~5m(가속) / 5~10m(최고속도 구간) 비교
    out.firstHalfMs = timeBetween(splits, 0, 5);
    out.secondHalfMs = timeBetween(splits, 5, 10);
    // 속도 유지율: 마지막 2m 평균속도 ÷ 최고속도(평활) × 100
    const last = timeBetween(splits, 8, 10);
    if (last && last > 0 && out.peakVelocitySmoothMs) {
      out.speedMaintenancePct = Math.round(((2 / (last / 1000)) / out.peakVelocitySmoothMs) * 100);
    }
  }

  if (mode === 'agility' && turns.length) {
    // 왕복: 출발→1회전 / 회전 사이 / 마지막 구간 시간
    const last = samples[samples.length - 1].tMs;
    const marks = [0, ...turns.map((t) => t.tMs), last];
    for (let i = 1; i < marks.length; i++) {
      out.legs.push({ index: i, timeMs: Math.round(marks[i] - marks[i - 1]) });
    }
  }
  return out;
}

/**
 * 측정 자동 종료 판단 (라이브).
 *  · 스프린트: 목표 거리(편도) 근처에 도달해 거의 멈췄을 때.
 *  · 왕복: 회전을 1회 이상 한 뒤 출발선(0m) 근처로 되돌아왔을 때.
 *    (예전 코드는 왕복도 '편도×2 지점'을 기준으로 삼았는데, 위치는 출발선 기준 축 거리라 되돌아오면 값이
 *     다시 줄어 그 지점에 닿지 못했다 → 자동 종료가 동작하지 않았다.)
 */
export function isRunComplete({ mode, trackDistanceM, lastDistanceM, velocityMs, turnCount = 0 }) {
  if (lastDistanceM == null) return false;
  if (mode === 'agility') {
    return turnCount >= 1 && lastDistanceM <= 0.3;
  }
  return Math.abs(lastDistanceM) >= trackDistanceM - 0.3 && Math.abs(velocityMs || 0) < 0.3;
}
