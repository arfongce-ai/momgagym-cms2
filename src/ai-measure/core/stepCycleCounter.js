// ai-measure/core/stepCycleCounter.js
// ════════════════════════════════════════════════════════════════════════
//  [스텝테스트 카메라 카운트 2026-11-25] 퀸스칼리지 스텝(올-올-내-내 4박) 1사이클을 카메라(옆모습)로 센다.
//  · 신호: 골반(엉덩이) 높이 ÷ 몸통 길이. 두 발이 단 위에 올라가면 높아지고 내려오면 낮아진다 → 사이클당 한 번 오르내림.
//  · 최근 4초의 최소~최대 폭이 충분할 때만(minRange) 중간선 ±20% 문턱으로 "낮음→높음" 전환을 1사이클로 센다.
//  · 문턱·폭은 시작값이다(실기기에서 조정). 몸이 안 잡히면 세지 않는다. 자동값은 참고용 — 측정자가 확인한다.
//  · 기준 사이클 수: 남 24회/분·여 22회/분(core/cardioTest.js 의 QUEENS 박자와 같은 값은 호출자가 넘긴다).
// ════════════════════════════════════════════════════════════════════════
const MIN_VIS = 0.5;
const ok = (p) => p && (p.visibility ?? 1) >= MIN_VIS && Number.isFinite(p.x) && Number.isFinite(p.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 골반 높이/몸통 길이(위로 갈수록 큼). 어깨·엉덩이가 안 잡히면 null. */
export function hipHeightSignal(lm) {
  if (!lm || !lm.length) return null;
  const hips = [lm[23], lm[24]].filter(ok);
  const shs = [lm[11], lm[12]].filter(ok);
  if (!hips.length || !shs.length) return null;
  const hip = hips.length === 2 ? mid(hips[0], hips[1]) : hips[0];
  const sh = shs.length === 2 ? mid(shs[0], shs[1]) : shs[0];
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  if (torso < 0.05) return null;
  return -hip.y / torso;
}

export function createStepCycleCounter({ minRange = 0.12, windowMs = 4000, minGapMs = 1200, smoothing = 0.4 } = {}) {
  let ema = null; let samples = []; let state = 'unknown'; let count = 0; let lastAt = -Infinity; let lastRange = 0;
  const events = [];
  let t0 = null;
  function push(lm, tMs) {
    const sig = hipHeightSignal(lm);
    if (sig == null) return snapshot(false);
    if (t0 == null) t0 = tMs;
    ema = ema == null ? sig : ema + smoothing * (sig - ema);
    samples.push({ t: tMs, s: ema });
    while (samples.length && tMs - samples[0].t > windowMs) samples.shift();
    const lo = Math.min(...samples.map((x) => x.s)); const hi = Math.max(...samples.map((x) => x.s));
    lastRange = hi - lo;
    if (lastRange >= minRange) {
      const midV = (hi + lo) / 2; const band = lastRange * 0.2;
      const next = ema >= midV + band ? 'high' : ema <= midV - band ? 'low' : null;
      if (next && next !== state) {
        if (state === 'low' && next === 'high' && tMs - lastAt >= minGapMs) { count += 1; lastAt = tMs; events.push(Math.round((tMs - t0) / 100) / 10); }
        state = next;
      }
    }
    return snapshot(true);
  }
  function snapshot(tracked) {
    return { tracked, count, state, range: Math.round(lastRange * 1000) / 1000, events: events.slice() };
  }
  return {
    push, snapshot: () => snapshot(ema != null),
    reset() { ema = null; samples = []; state = 'unknown'; count = 0; lastAt = -Infinity; lastRange = 0; events.length = 0; t0 = null; },
  };
}
