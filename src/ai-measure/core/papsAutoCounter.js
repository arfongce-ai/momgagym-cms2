// ai-measure/core/papsAutoCounter.js
// ════════════════════════════════════════════════════════════════════════
//  [PAPS 자동 카운트 2026-11-25] 카메라 자세(33점)로 PAPS 계열 반복 횟수를 세는 순수 로직.
//  seniorAutoCounter.js 와 같은 방식: 신호 1개 + 문턱 2개(히스테리시스) + 최소 반복 간격.
//  · 팔굽혀펴기·턱걸이: 팔꿈치 각도(어깨-팔꿈치-손목). 접힘(≤ bendAt)에 들어갈 때 1회, 다시 펴져야(≥ extendAt) 다음 회.
//  · 윗몸일으키기·윗몸말아올리기: 몸통 기울기(엉덩이→어깨가 수평과 이루는 각, 0~90°). 올라옴(≥ upAt)에서 1회, 다시 눕혀야 다음 회.
//  · 사이드스텝: 골반 좌우 위치(처음 1초 평균을 중심으로, 골반 너비 단위). 반대편 끝에 닿을 때마다 1회.
//  · 값은 "자동 추정"이다. 문턱값은 시작값(참고용)이며 실기기에서 조정한다. 몸이 안 잡히면 세지 않는다.
//  · 측정자가 확인·수정한 값을 저장하고, 자동값은 원본으로 함께 남긴다(시니어 탭과 동일).
// ════════════════════════════════════════════════════════════════════════
const MIN_VIS = 0.5;
const MIN_REP_GAP_MS = { pushup: 500, pullup: 900, situp1m: 700, curlup: 700, sidestep20: 250 };

const L = { sh: [11, 12], el: [13, 14], wr: [15, 16], hip: [23, 24], knee: [25, 26] };

// 테스트별 문턱(시작값). 사람·카메라 위치에 따라 달라질 수 있어 실기기에서 조정한다.
export const PAPS_AUTO_CONFIG = {
  pushup:     { signal: 'elbow',   rest: 150, active: 100, activeIs: 'low'  },
  pullup:     { signal: 'elbow',   rest: 150, active: 75,  activeIs: 'low'  },
  situp1m:    { signal: 'incline', rest: 20,  active: 55,  activeIs: 'high' },
  curlup:     { signal: 'incline', rest: 8,   active: 20,  activeIs: 'high' },
  sidestep20: { signal: 'lateral', amp: 1.0 },
};

export function supportsPapsAuto(testId) {
  return Boolean(PAPS_AUTO_CONFIG[testId]);
}

const ok = (p) => p && (p.visibility ?? 1) >= MIN_VIS && Number.isFinite(p.x) && Number.isFinite(p.y);
const avg = (lm, idxs) => {
  const pts = idxs.map((i) => lm?.[i]).filter(ok);
  if (!pts.length) return null;
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
};

function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (d < 1e-6) return null;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / d));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 팔꿈치 각도(도). 어깨·팔꿈치·손목이 더 잘 보이는 쪽 팔을 쓴다. 안 잡히면 null. */
export function elbowAngleSignal(lm) {
  if (!Array.isArray(lm) && !lm?.length) return null;
  let best = null;
  [0, 1].forEach((i) => {
    const s = lm[L.sh[i]]; const e = lm[L.el[i]]; const w = lm[L.wr[i]];
    if (!ok(s) || !ok(e) || !ok(w)) return;
    const vis = (s.visibility ?? 1) + (e.visibility ?? 1) + (w.visibility ?? 1);
    if (!best || vis > best.vis) best = { vis, ang: angleAt(s, e, w) };
  });
  return best && best.ang != null ? best.ang : null;
}

/** 몸통 기울기(도, 0=수평·90=수직). 어깨·엉덩이가 안 잡히면 null. */
export function trunkInclineSignal(lm) {
  if (!Array.isArray(lm) && !lm?.length) return null;
  const sh = avg(lm, L.sh); const hip = avg(lm, L.hip);
  if (!sh || !hip) return null;
  const dx = Math.abs(sh.x - hip.x); const dy = Math.abs(sh.y - hip.y);
  if (Math.hypot(dx, dy) < 0.04) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** 골반 x 위치와 골반 너비(정규화 좌표). */
export function lateralSignal(lm) {
  if (!Array.isArray(lm) && !lm?.length) return null;
  const a = lm[23]; const b = lm[24];
  if (!ok(a) || !ok(b)) return null;
  const width = Math.hypot(a.x - b.x, a.y - b.y);
  if (width < 0.02) return null;
  return { x: (a.x + b.x) / 2, width };
}

export function createPapsAutoCounter({ testId = 'pushup', smoothing = 0.5, calibrateMs = 1000 } = {}) {
  const cfg = PAPS_AUTO_CONFIG[testId];
  const gap = MIN_REP_GAP_MS[testId] || 600;
  let ema = null;
  let state = 'unknown'; // unknown | rest | active  (sidestep: unknown | left | right)
  let reps = 0;
  let lastRepAt = -Infinity;
  let startedAtMs = null;
  let lastSignalAt = null;
  let centerSum = 0; let centerN = 0; let center = null; let calibStart = null;
  const events = [];

  function countRep(tMs) {
    if (tMs - lastRepAt < gap) return;
    lastRepAt = tMs;
    if (startedAtMs == null) startedAtMs = tMs;
    reps += 1;
    events.push(Math.round((tMs - startedAtMs) / 100) / 10);
  }

  function pushAngle(sig, tMs) {
    if (sig == null) return false;
    ema = ema == null ? sig : ema + smoothing * (sig - ema);
    const isActive = cfg.activeIs === 'low' ? ema <= cfg.active : ema >= cfg.active;
    const isRest = cfg.activeIs === 'low' ? ema >= cfg.rest : ema <= cfg.rest;
    if (state === 'unknown') { if (isRest) state = 'rest'; return true; } // 쉬는 자세에서 시작해야 센다
    if (state === 'rest' && isActive) { state = 'active'; countRep(tMs); }
    else if (state === 'active' && isRest) state = 'rest';
    return true;
  }

  function pushLateral(sig, tMs) {
    if (!sig) return false;
    if (calibStart == null) calibStart = tMs;
    if (center == null) {
      centerSum += sig.x; centerN += 1;
      if (tMs - calibStart >= calibrateMs && centerN >= 3) center = centerSum / centerN;
      return true;
    }
    const s = (sig.x - center) / sig.width;
    ema = ema == null ? s : ema + smoothing * (s - ema);
    const side = ema >= cfg.amp ? 'right' : ema <= -cfg.amp ? 'left' : null;
    if (side && side !== state) {
      const was = state;
      state = side;
      if (was === 'left' || was === 'right') countRep(tMs); // 반대편 끝에 닿을 때마다 1회
      else if (was === 'unknown') lastRepAt = tMs; // 첫 끝 도달은 기준만 잡는다
    }
    return true;
  }

  function push(landmarks, tMs) {
    let tracked = false;
    if (cfg.signal === 'elbow') tracked = pushAngle(elbowAngleSignal(landmarks), tMs);
    else if (cfg.signal === 'incline') tracked = pushAngle(trunkInclineSignal(landmarks), tMs);
    else if (cfg.signal === 'lateral') tracked = pushLateral(lateralSignal(landmarks), tMs);
    if (tracked) lastSignalAt = tMs;
    return snapshot(tracked);
  }

  function snapshot(tracked) {
    return {
      tracked, state, signal: ema, count: reps, started: startedAtMs != null, startedAtMs,
      events: events.slice(), lastSignalAt,
      calibrating: cfg.signal === 'lateral' && center == null,
    };
  }

  return {
    push,
    snapshot: () => snapshot(ema != null),
    reset() {
      ema = null; state = 'unknown'; reps = 0; lastRepAt = -Infinity; startedAtMs = null; lastSignalAt = null;
      centerSum = 0; centerN = 0; center = null; calibStart = null; events.length = 0;
    },
  };
}
