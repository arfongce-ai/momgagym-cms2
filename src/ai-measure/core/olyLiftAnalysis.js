// ai-measure/core/olyLiftAnalysis.js
// ════════════════════════════════════════════════════════════════════════
//  스내치·클린·클린&저크 구간 분할 + 자세 각도(참고값) — 순수 함수 모듈.
//
//  입력: 측정 중 프레임마다 쌓은 샘플
//    { ts(ms), bar:{x,y}, j:{ s,h,k,a } }   (모두 0~1 정규화, y 는 아래로 증가)
//    j.s/h/k/a = 어깨·고관절·무릎·발목 {x,y,v}. 좌/우 중 인식이 좋은 한쪽만 쓴다.
//  옵션: { exerciseType, cmPerRatio, aspect(영상 가로/세로), side }
//
//  설계 원칙(프로젝트 지침): 판정을 확정하지 않는다. "참고값 + 신뢰도"로만 낸다.
//   · 2D 한 대 카메라라 각도는 측면 촬영일 때만 의미가 있다 → 정면이면 신뢰 낮음.
//   · 구간은 바 높이·속도로 나눈다(바벨 위치는 양 손목 중점 근사).
//   · 구간을 못 나누면 억지로 만들지 않고 reason 코드를 남긴다.
// ════════════════════════════════════════════════════════════════════════

export const OLY_TYPES = ['snatch', 'clean', 'clean_jerk'];
export const isOlyType = (t) => OLY_TYPES.includes(t);

export const OLY_TUNING = {
  smoothHalf: 2,          // 이동평균 반폭(샘플)
  minRiseCm: 40,          // 이 이상 올라가야 "들어올림"으로 본다
  departCm: 3,            // 출발 판정: 시작 높이 대비 이 이상 올라간 첫 순간
  restSpeedMs: 0.2,       // 정지 판정 속도
  restMinMs: 350,         // 정지 최소 지속(랙 자세)
  restMinHeightCm: 40,    // 정지가 이 높이 이상일 때만 랙으로 본다
  catchWindowMs: 1500,    // 최고속도 이후 캐치(고관절 최저) 탐색 창
  minSamples: 12,
  minFps: 25,
  minVisibility: 0.6,
  frontalRatio: 0.5,      // 어깨너비/몸통길이가 이 이상이면 정면 촬영으로 본다
};

export const OLY_REASON_KO = {
  too_few_samples: '측정 샘플이 부족합니다.',
  no_scale: '거리 보정값이 없어 cm·m/s 를 계산하지 못했습니다.',
  no_lift_found: '바가 충분히 올라간 구간을 찾지 못했습니다.',
  jerk_not_split: '클린과 저크 사이 정지(랙) 구간을 찾지 못해 한 동작으로 처리했습니다.',
  low_visibility: '관절 인식이 낮아 각도 참고값 신뢰가 낮습니다.',
  frontal_view: '정면에 가까운 촬영입니다. 각도는 측면 촬영에서만 의미가 있습니다.',
  low_fps: '촬영 프레임이 낮아 최고속도·구간 시점 오차가 큽니다.',
};

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

function median(arr) {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function smooth(values, half) {
  return values.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(values.length - 1, i + half); k++) { s += values[k]; n++; }
    return s / n;
  });
}

/** 세 점 사이 각도(deg). b 가 꼭짓점. a·c 는 {x,y}. x 는 aspect 로 보정. */
export function angleAt(a, b, c, aspect = 1) {
  if (!a || !b || !c) return null;
  const v1 = { x: (a.x - b.x) * aspect, y: a.y - b.y };
  const v2 = { x: (c.x - b.x) * aspect, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
  if (!m1 || !m2) return null;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 몸통(고관절→어깨)이 수직선과 이루는 각(deg). 0=곧게 섬, 클수록 숙임. */
export function trunkLeanDeg(hip, shoulder, aspect = 1) {
  if (!hip || !shoulder) return null;
  const dx = (shoulder.x - hip.x) * aspect;
  const dy = hip.y - shoulder.y; // 위로 +
  if (!dx && !dy) return null;
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

/** 샘플 하나의 자세 각도 묶음. */
export function postureAt(sample, aspect = 1) {
  const j = sample?.j;
  if (!j) return null;
  return {
    kneeDeg: r1(angleAt(j.h, j.k, j.a, aspect)),   // 고관절-무릎-발목 (180=펴짐)
    hipDeg: r1(angleAt(j.s, j.h, j.k, aspect)),    // 어깨-고관절-무릎 (180=펴짐)
    trunkLeanDeg: r1(trunkLeanDeg(j.h, j.s, aspect)),
  };
}

function medianPosture(samples, idxs, aspect) {
  const ps = idxs.map((i) => postureAt(samples[i], aspect)).filter(Boolean);
  if (!ps.length) return null;
  return {
    kneeDeg: r1(median(ps.map((p) => p.kneeDeg))),
    hipDeg: r1(median(ps.map((p) => p.hipDeg))),
    trunkLeanDeg: r1(median(ps.map((p) => p.trunkLeanDeg))),
  };
}

function idxRange(a, b) {
  const out = [];
  for (let i = Math.max(0, a); i <= b; i++) out.push(i);
  return out;
}

/** 샘플 열에서 좌/우 중 인식이 좋은 쪽을 고를 때 쓰는 보조: 평균 visibility. */
export function jointVisibility(j) {
  if (!j) return 0;
  const vs = [j.s, j.h, j.k, j.a].map((p) => (Number.isFinite(p?.v) ? p.v : 0));
  return vs.reduce((a, b) => a + b, 0) / vs.length;
}

/**
 * 한 동작(구간)을 분석한다.
 * @returns lift 객체 (name, 시점·지표·각도)
 */
function analyzeSegment({ name, samples, h, vy, i0, i1, kneeIdxOf, aspect, cmPerRatio, t0 }) {
  const T = OLY_TUNING;
  // 출발: 구간 시작 높이 대비 departCm 이상 올라간 첫 순간(그 직전을 출발로).
  const base = median(h.slice(i0, i0 + 4));
  let iStart = i0;
  for (let i = i0; i <= i1; i++) { if (h[i] - base >= T.departCm) { iStart = Math.max(i0, i - 1); break; } }

  // 바 최고점 / 최고속도(구간 안)
  let iTop = iStart, iPeakV = iStart;
  for (let i = iStart; i <= i1; i++) {
    if (h[i] > h[iTop]) iTop = i;
    if (vy[i] > vy[iPeakV]) iPeakV = i;
  }
  // 무릎 통과: 바가 무릎 높이보다 높아진 첫 순간
  let iKnee = null;
  for (let i = iStart; i <= iPeakV; i++) {
    const k = samples[i]?.j?.k;
    if (k && samples[i].bar.y <= k.y) { iKnee = i; break; }
  }
  // 캐치: 최고속도 이후 고관절이 가장 낮은(y 최대) 순간
  const catchEnd = (() => {
    let e = iPeakV;
    while (e < i1 && samples[e].ts - samples[iPeakV].ts <= T.catchWindowMs) e++;
    return e;
  })();
  let iCatch = iPeakV;
  for (let i = iPeakV; i <= catchEnd; i++) {
    const hy = samples[i]?.j?.h?.y;
    const cy = samples[iCatch]?.j?.h?.y;
    if (hy != null && cy != null && hy > cy) iCatch = i;
  }
  // 캐치 깊이: 캐치 때 고관절 높이 vs 그 뒤 일어섰을 때(고관절 최고) 높이
  let standY = null;
  for (let i = iCatch; i <= i1; i++) {
    const hy = samples[i]?.j?.h?.y;
    if (hy != null && (standY == null || hy < standY)) standY = hy;
  }
  const catchY = samples[iCatch]?.j?.h?.y ?? null;
  const catchDepthCm = (standY != null && catchY != null && cmPerRatio) ? (catchY - standY) * cmPerRatio : null;

  // 수평 이탈(출발 대비, cm). x 비율은 aspect 로 y 단위로 환산.
  const x0 = median(samples.slice(iStart, iStart + 4).map((s) => s.bar.x));
  const driftAt = (i) => (i == null || x0 == null ? null : (samples[i].bar.x - x0) * aspect * cmPerRatio);

  const ms = (i) => (i == null ? null : Math.round(samples[i].ts - t0));
  const lift = {
    name,
    startMs: ms(iStart),
    kneePassMs: ms(iKnee),
    peakVelocityMs: ms(iPeakV),
    barTopMs: ms(iTop),
    catchMs: ms(iCatch),
    endMs: ms(i1),
    peakVelocity: r2(vy[iPeakV]),
    barTopHeightCm: r1(h[iTop] - base),
    peakVelocityHeightCm: r1(h[iPeakV] - base),
    firstPullMs: iKnee != null ? Math.round(samples[iKnee].ts - samples[iStart].ts) : null,
    secondPullMs: iKnee != null ? Math.round(samples[iPeakV].ts - samples[iKnee].ts) : null,
    underBarMs: Math.round(samples[iCatch].ts - samples[iPeakV].ts),
    catchDepthCm: r1(catchDepthCm),
    driftAtKneeCm: r1(driftAt(iKnee)),
    driftAtPeakCm: r1(driftAt(iPeakV)),
    driftAtTopCm: r1(driftAt(iTop)),
    angles: {
      set: medianPosture(samples, idxRange(i0, Math.min(i1, i0 + 3)), aspect),
      kneePass: iKnee != null ? medianPosture(samples, idxRange(iKnee - 1, iKnee + 1), aspect) : null,
      extension: medianPosture(samples, idxRange(iPeakV - 1, iPeakV + 1), aspect),
      catch: medianPosture(samples, idxRange(iCatch - 1, iCatch + 1), aspect),
    },
  };
  void kneeIdxOf;
  return lift;
}

/**
 * 메인 진입점.
 * @param {Array} rawSamples
 * @param {{exerciseType:string, cmPerRatio:number, aspect?:number}} opt
 * @returns {null | {kind, exerciseType, lifts, confidence:{level,reasons}, basis}}
 */
export function analyzeOlyLift(rawSamples, { exerciseType, cmPerRatio, aspect = 1 } = {}) {
  const T = OLY_TUNING;
  if (!isOlyType(exerciseType)) return null;
  const reasons = [];
  const samples = (rawSamples || []).filter((s) => s && Number.isFinite(s.ts) && s.bar && Number.isFinite(s.bar.y));
  if (samples.length < T.minSamples) return { kind: 'olympic', exerciseType, lifts: [], confidence: { level: 'low', reasons: ['too_few_samples'] }, basis: '2d-landmark' };
  if (!(cmPerRatio > 0)) return { kind: 'olympic', exerciseType, lifts: [], confidence: { level: 'low', reasons: ['no_scale'] }, basis: '2d-landmark' };

  const t0 = samples[0].ts;
  // 바 높이(cm, 위로 +). 출발 높이를 0 기준으로 쓰되 절대 비교는 상대값만 쓴다.
  const yS = smooth(samples.map((s) => s.bar.y), T.smoothHalf);
  const yBase = median(yS.slice(0, 4));
  const h = yS.map((y) => (yBase - y) * cmPerRatio);
  // 속도(m/s, 위로 +): 중심차분
  const vy = h.map((_, i) => {
    const a = Math.max(0, i - 2), b = Math.min(h.length - 1, i + 2);
    const dt = (samples[b].ts - samples[a].ts) / 1000;
    return dt > 0 ? (h[b] - h[a]) / 100 / dt : 0;
  });

  const dts = samples.slice(1).map((s, i) => s.ts - samples[i].ts).filter((d) => d > 0);
  const fps = dts.length ? 1000 / median(dts) : null;
  if (fps != null && fps < T.minFps) reasons.push('low_fps');

  // 인식·촬영 방향 신뢰
  const vis = median(samples.map((s) => jointVisibility(s.j)));
  if (vis != null && vis < T.minVisibility) reasons.push('low_visibility');
  const frontalVals = samples.slice(0, Math.min(samples.length, 12)).map((s) => s.frontal).filter(Number.isFinite);
  const frontal = frontalVals.length ? median(frontalVals) : null;
  if (frontal != null && frontal >= T.frontalRatio) reasons.push('frontal_view');

  // 들어올림(상승) 구간 찾기: 최고점까지의 전체 상승이 minRiseCm 이상이어야 한다.
  let iMax = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > h[iMax]) iMax = i;
  if (h[iMax] < T.minRiseCm) {
    return { kind: 'olympic', exerciseType, lifts: [], confidence: { level: 'low', reasons: [...reasons, 'no_lift_found'] }, basis: '2d-landmark' };
  }

  const lifts = [];
  if (exerciseType === 'clean_jerk') {
    // 첫 상승 최고점 이후, 높이 restMinHeightCm 이상에서 속도가 낮게 restMinMs 이상 유지되는 구간 = 랙(일어선 자세)
    let rest = null;
    for (let i = 0; i < h.length && !rest; i++) {
      if (h[i] < T.restMinHeightCm || Math.abs(vy[i]) > T.restSpeedMs) continue;
      let j = i;
      while (j + 1 < h.length && h[j + 1] >= T.restMinHeightCm && Math.abs(vy[j + 1]) <= T.restSpeedMs) j++;
      if (samples[j].ts - samples[i].ts >= T.restMinMs && i > 3) rest = [i, j];
      i = j;
    }
    if (rest && rest[1] < h.length - 4) {
      lifts.push(analyzeSegment({ name: '클린', samples, h, vy, i0: 0, i1: rest[0], aspect, cmPerRatio, t0 }));
      lifts.push(analyzeJerk({ samples, h, vy, i0: rest[1], i1: h.length - 1, aspect, cmPerRatio, t0 }));
    } else {
      reasons.push('jerk_not_split');
      lifts.push(analyzeSegment({ name: '클린&저크', samples, h, vy, i0: 0, i1: h.length - 1, aspect, cmPerRatio, t0 }));
    }
  } else {
    lifts.push(analyzeSegment({
      name: exerciseType === 'snatch' ? '스내치' : '클린',
      samples, h, vy, i0: 0, i1: h.length - 1, aspect, cmPerRatio, t0,
    }));
  }

  const level = reasons.some((r) => r === 'low_visibility' || r === 'frontal_view' || r === 'low_fps') ? 'low' : 'ok';
  return { kind: 'olympic', exerciseType, lifts, confidence: { level, reasons: [...new Set(reasons)] }, fps: fps ? Math.round(fps) : null, basis: '2d-landmark' };
}

/** 저크: 랙 이후 딥(고관절 하강)→드라이브→바 최고점. 무릎·고관절 각도와 바 상승만 낸다. */
function analyzeJerk({ samples, h, vy, i0, i1, aspect, cmPerRatio, t0 }) {
  const base = median(h.slice(i0, i0 + 4));
  let iTop = i0, iPeakV = i0;
  for (let i = i0; i <= i1; i++) {
    if (h[i] > h[iTop]) iTop = i;
    if (vy[i] > vy[iPeakV]) iPeakV = i;
  }
  // 딥: 드라이브 시작 전 고관절이 가장 낮은 순간(최고속도 이전)
  let iDip = i0;
  for (let i = i0; i <= iPeakV; i++) {
    const hy = samples[i]?.j?.h?.y, dy = samples[iDip]?.j?.h?.y;
    if (hy != null && dy != null && hy > dy) iDip = i;
  }
  const ms = (i) => Math.round(samples[i].ts - t0);
  return {
    name: '저크',
    startMs: ms(i0),
    dipMs: ms(iDip),
    peakVelocityMs: ms(iPeakV),
    barTopMs: ms(iTop),
    endMs: ms(i1),
    peakVelocity: r2(vy[iPeakV]),
    barRiseCm: r1(h[iTop] - base),
    driveMs: Math.round(samples[iPeakV].ts - samples[iDip].ts),
    angles: {
      set: medianPosture(samples, idxRange(i0, Math.min(i1, i0 + 3)), aspect),
      dip: medianPosture(samples, idxRange(iDip - 1, iDip + 1), aspect),
      extension: medianPosture(samples, idxRange(iPeakV - 1, iPeakV + 1), aspect),
    },
  };
}

/** 한쪽(좌/우) 관절 묶음을 landmarks 에서 뽑는다. side: 'left'|'right' */
export function pickSideJoints(lms, side) {
  if (!Array.isArray(lms)) return null;
  const idx = side === 'right' ? { s: 12, h: 24, k: 26, a: 28 } : { s: 11, h: 23, k: 25, a: 27 };
  const pt = (i) => {
    const p = lms[i];
    return p ? { x: p.x, y: p.y, v: p.visibility ?? 0 } : null;
  };
  const j = { s: pt(idx.s), h: pt(idx.h), k: pt(idx.k), a: pt(idx.a) };
  return j.s && j.h && j.k && j.a ? j : null;
}

/** 좌/우 중 인식이 더 좋은 쪽. */
export function betterSide(lms) {
  const L = jointVisibility(pickSideJoints(lms, 'left'));
  const R = jointVisibility(pickSideJoints(lms, 'right'));
  return R > L ? 'right' : 'left';
}

/** 정면 촬영 정도: 어깨너비(가로) ÷ 몸통길이. 측면이면 작고 정면이면 크다. */
export function frontalRatio(lms, aspect = 1) {
  if (!Array.isArray(lms)) return null;
  const ls = lms[11], rs = lms[12], lh = lms[23], rh = lms[24];
  if (!ls || !rs || !lh || !rh) return null;
  const shoulderW = Math.abs(ls.x - rs.x) * aspect;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const sm = mid(ls, rs), hm = mid(lh, rh);
  const torso = Math.hypot((sm.x - hm.x) * aspect, sm.y - hm.y);
  return torso > 0 ? shoulderW / torso : null;
}
