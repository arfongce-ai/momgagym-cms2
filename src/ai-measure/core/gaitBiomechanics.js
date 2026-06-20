// ai-measure/core/gaitBiomechanics.js
// 보행 & 러닝 분석용 순수 생체역학 헬퍼 (v2 — 환경 무의존 · 손떨림 대응).
//
// 설계 원칙:
//  1) 회전 불변(Rotation Invariant) 각도: 관절 벡터 내적만 사용 → 카메라가
//     기울어져도(핸드헬드 패닝) 각도값이 변하지 않는다. 화면 축에 의존하지 않음.
//  2) 환경 무의존(Environment-Agnostic) 주기: 절대 좌표(지면선/벨트 위치)를
//     쓰지 않는다. 고관절(Hip)을 원점으로 한 발목·발끝의 '상대 거리'와
//     '상대 속도'로 보행 주기(입각/유각)와 스텝을 판별 → 트레드밀/바닥 구분 불필요.
//  3) 핸드헬드 보정: 골반(좌우 고관절) 폭으로 거리를 정규화해 피사체가
//     화면에서 가까워지거나 멀어져도(패닝 줌) 스케일 영향이 상쇄된다.
//
// landmark 규약: { x, y, z?, visibility? }, x·y 는 0~1 정규화 좌표(좌상단 0,0).
//
// BlazePose(MediaPipe Pose) landmark 인덱스:
//   11 L_shoulder 12 R_shoulder  23 L_hip 24 R_hip
//   25 L_knee 26 R_knee  27 L_ankle 28 R_ankle
//   29 L_heel 30 R_heel  31 L_foot_index 32 R_foot_index

export const POSE_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

const vis = (lm, min = 0.4) => lm && (lm.visibility == null || lm.visibility >= min);

/* ─────────────────────────────────────────────────────────────
 * 1) 회전 불변 각도 (Rotation-Invariant Joint Angle)
 *    정점 b 에서 b→a, b→c 두 벡터의 내적으로 사잇각을 구한다.
 *    좌표계 회전(카메라 기울기)에 대해 내적은 불변이므로 각도도 불변.
 * ───────────────────────────────────────────────────────────── */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;       // 내적 (회전 불변)
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return null;
  let cos = dot / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 한 프레임 landmark 배열 → 좌우 고관절·무릎·발목 각도(회전 불변). */
export function jointAnglesFromPose(landmarks) {
  if (!Array.isArray(landmarks)) return emptyAngles();
  const L = POSE_LANDMARKS;
  const get = (i) => (vis(landmarks[i]) ? landmarks[i] : null);
  const side = (sh, hp, kn, an, ft) => ({
    hip: angleAt(get(sh), get(hp), get(kn)),    // 몸통–허벅지
    knee: angleAt(get(hp), get(kn), get(an)),   // 허벅지–정강이 (180°≈신전)
    ankle: angleAt(get(kn), get(an), get(ft)),  // 정강이–발 (배측/저측 굴곡)
  });
  return {
    left: side(L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE, L.LEFT_FOOT_INDEX),
    right: side(L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE, L.RIGHT_FOOT_INDEX),
  };
}

export function emptyAngles() {
  const blank = { hip: null, knee: null, ankle: null };
  return { left: { ...blank }, right: { ...blank } };
}

/* ─────────────────────────────────────────────────────────────
 * 2) 이동 평균 필터 (Moving Average) — landmark jitter 평활
 * ───────────────────────────────────────────────────────────── */
export class MovingAverageFilter {
  constructor(windowSize = 5) {
    this.size = Math.max(1, windowSize);
    this.buf = [];
  }
  reset() { this.buf = []; }
  push(value) {
    if (value == null || Number.isNaN(value)) return this.value();
    this.buf.push(value);
    if (this.buf.length > this.size) this.buf.shift();
    return this.value();
  }
  value() {
    if (!this.buf.length) return null;
    return this.buf.reduce((s, v) => s + v, 0) / this.buf.length;
  }
}

/* ─────────────────────────────────────────────────────────────
 * 3) 고관절 원점 상대 좌표 추출 (Environment-Agnostic)
 *    - 원점: 좌우 고관절의 중점(pelvis center)
 *    - 스케일: 골반 폭(좌우 고관절 거리)으로 정규화 → 줌/거리 변화 상쇄
 *    - 반환: 지지발(더 아래쪽 발)의 발끝이 고관절 원점에서 떨어진
 *      상대 벡터와 거리. 보행 주기에서 이 거리가 진동한다.
 *
 *    절대 화면 좌표(지면 y 위치)에 의존하지 않으므로 트레드밀/바닥
 *    어디서든 동일하게 동작한다.
 * ───────────────────────────────────────────────────────────── */
export function hipRelativeFootMetric(landmarks) {
  if (!Array.isArray(landmarks)) return null;
  const L = POSE_LANDMARKS;
  const lh = vis(landmarks[L.LEFT_HIP]) ? landmarks[L.LEFT_HIP] : null;
  const rh = vis(landmarks[L.RIGHT_HIP]) ? landmarks[L.RIGHT_HIP] : null;
  if (!lh && !rh) return null;

  // 골반 중점(원점)과 폭(정규화 스케일)
  const hip = lh && rh
    ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
    : (lh || rh);
  const pelvisWidth = lh && rh ? Math.hypot(lh.x - rh.x, lh.y - rh.y) : null;
  // 골반 폭이 0 에 가까우면(정면/소실) 어깨 폭으로 폴백, 그것도 없으면 1
  let scale = pelvisWidth && pelvisWidth > 1e-3 ? pelvisWidth : null;
  if (!scale) {
    const ls = vis(landmarks[L.LEFT_SHOULDER]) ? landmarks[L.LEFT_SHOULDER] : null;
    const rs = vis(landmarks[L.RIGHT_SHOULDER]) ? landmarks[L.RIGHT_SHOULDER] : null;
    const sw = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : null;
    scale = sw && sw > 1e-3 ? sw : 1;
  }

  // 지지발 선택: 두 발끝 중 화면에서 더 아래(y 큰) 쪽
  const lf = vis(landmarks[L.LEFT_FOOT_INDEX]) ? landmarks[L.LEFT_FOOT_INDEX]
    : (vis(landmarks[L.LEFT_ANKLE]) ? landmarks[L.LEFT_ANKLE] : null);
  const rf = vis(landmarks[L.RIGHT_FOOT_INDEX]) ? landmarks[L.RIGHT_FOOT_INDEX]
    : (vis(landmarks[L.RIGHT_ANKLE]) ? landmarks[L.RIGHT_ANKLE] : null);
  let foot = null;
  if (lf && rf) foot = lf.y >= rf.y ? lf : rf;
  else foot = lf || rf;
  if (!foot) return null;

  // 고관절 원점 기준 상대 벡터 (정규화)
  const dx = (foot.x - hip.x) / scale;
  const dy = (foot.y - hip.y) / scale;
  // 전후 스윙 성분(anterior-posterior): 보행 주기당 1회 진동하는 핵심 신호.
  // 부호 있는 dx 를 쓰면 한 보폭에 최대/최소 각 1회 → 스텝 이중 카운트 방지.
  // (unsigned dist 는 골반 중심 대칭이라 보폭당 2회 진동 → 사용하지 않음)
  const dist = Math.hypot(dx, dy);   // 참고용 절대 거리(스텝 판별엔 미사용)
  return { dx, dy, dist, swing: dx, scale };
}

/* ─────────────────────────────────────────────────────────────
 * 4) GaitCycleTracker (v2)
 *    고관절 원점 상대 거리의 '상대 속도'(시간 미분) 부호 전환으로
 *    foot-strike(스텝)와 입각/유각을 판별한다. 절대 좌표·환경 무관.
 *
 *    원리:
 *     - rel.dist 는 발이 몸 뒤(짧음)→앞(김)으로 흔들리며 진동.
 *     - dist 가 국소 최대(가장 앞/뻗음) 직후 줄어드는 순간을 1 스텝으로 카운트.
 *     - 상대 속도(d(dist)/dt)가 음수(발이 몸쪽으로/접지 후 끌림)면 stance,
 *       양수(발이 앞으로 뻗음)면 swing 으로 분류.
 *     - 모든 시간 계산은 프레임 타임스탬프(ms) 기반 → 가변 FPS 대응.
 * ───────────────────────────────────────────────────────────── */
export class GaitCycleTracker {
  constructor({ windowSize = 5, minStepIntervalMs = 220 } = {}) {
    this.smoother = new MovingAverageFilter(windowSize);
    this.minStepIntervalMs = minStepIntervalMs;
    this.reset();
  }

  reset() {
    this.smoother.reset();
    this.prevDist = null;
    this.prevSlope = 0;
    this.lastStepTs = 0;
    this.stepTimestamps = [];
    this.band = { lo: Infinity, hi: -Infinity };
    this.phase = 'unknown';        // 'stance' | 'swing'
    this.lastTs = null;
    this.stanceMs = 0;
    this.swingMs = 0;
    this.stepCountTotal = 0;
    this.firstTs = null;
    this.lastVelocity = 0;          // 상대 속도(정규화 거리/초)
  }

  /**
   * @param {{swing?:number,dist?:number}|number|null} metric  hipRelativeFootMetric() 결과
   *        또는 신호 숫자. swing(전후 성분, 부호 있음)을 우선 사용한다.
   * @param {number} ts  프레임 타임스탬프(ms)
   */
  push(metric, ts) {
    let raw = null;
    if (metric != null) {
      if (typeof metric === 'number') raw = metric;
      else if (metric.swing != null) raw = metric.swing;     // 부호 있는 전후 성분(권장)
      else if (metric.dist != null) raw = metric.dist;
    }
    if (raw == null || Number.isNaN(raw)) return this.snapshot();
    if (this.firstTs == null) this.firstTs = ts;

    const sig = this.smoother.push(raw);
    if (sig == null) { this.lastTs = ts; return this.snapshot(); }

    // 상대 속도 (정규화 신호 / 초) — 가변 FPS 대응
    let velocity = 0;
    if (this.lastTs != null && this.prevDist != null) {
      const dt = ts - this.lastTs;
      if (dt > 0 && dt < 500) {
        velocity = (sig - this.prevDist) / (dt / 1000);
        // 위상 시간 누적: 발이 앞으로 뻗음(+)=swing, 몸쪽/뒤로(−)=stance
        if (velocity > 0) this.swingMs += dt;
        else this.stanceMs += dt;
      }
    }
    this.lastVelocity = velocity;

    // 적응형 진폭 밴드 (아주 느린 감쇠)
    this.band.lo = Math.min(this.band.lo === Infinity ? sig : this.band.lo + (sig - this.band.lo) * 0.0008, sig);
    this.band.hi = Math.max(this.band.hi === -Infinity ? sig : this.band.hi - (this.band.hi - sig) * 0.0008, sig);
    const range = this.band.hi - this.band.lo;

    // 위상 판별: 상대 속도 부호 기반 (절대 좌표 불필요)
    this.phase = range > 0.02 ? (velocity > 0 ? 'swing' : 'stance') : 'unknown';

    // 스텝 검출: 전후 신호의 국소 최대(발이 가장 앞 = foot-strike) 직후 하강 전환.
    // 부호 있는 신호라 보폭당 최대 1회만 발생 → 이중 카운트 없음.
    if (this.prevDist != null) {
      const slope = sig - this.prevDist;
      const wasRising = this.prevSlope > 0;
      const nowFalling = slope <= 0;
      const prominent = range > 0.02 && this.prevDist >= this.band.lo + range * 0.5;
      const isStrike = wasRising && nowFalling && prominent;
      if (isStrike && ts - this.lastStepTs >= this.minStepIntervalMs) {
        this.lastStepTs = ts;
        this.stepTimestamps.push(ts);
        this.stepCountTotal += 1;
        const cutoff = ts - 6000;
        this.stepTimestamps = this.stepTimestamps.filter((t) => t >= cutoff);
      }
      if (slope !== 0) this.prevSlope = slope;
    }

    this.prevDist = sig;
    this.lastTs = ts;
    return this.snapshot();
  }

  cadenceSpm() {
    const t = this.stepTimestamps;
    if (t.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
    const mean = sum / (t.length - 1);
    return mean > 0 ? Math.round(60000 / mean) : 0;
  }

  averageCadenceSpm() {
    if (this.stepCountTotal < 2 || this.firstTs == null || this.lastTs == null) return 0;
    const mins = (this.lastTs - this.firstTs) / 60000;
    return mins > 0 ? Math.round(this.stepCountTotal / mins) : 0;
  }

  stancePct() {
    const total = this.stanceMs + this.swingMs;
    return total > 0 ? Math.round((this.stanceMs / total) * 100) : 0;
  }

  cycleMs() {
    const t = this.stepTimestamps;
    if (t.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
    return Math.round((sum / (t.length - 1)) * 2);
  }

  snapshot() {
    const stance = this.stancePct();
    return {
      phase: this.phase,
      cadenceSpm: this.cadenceSpm(),
      stancePct: stance,
      swingPct: stance > 0 ? 100 - stance : 0,
      stepCount: this.stepCountTotal,
      cycleMs: this.cycleMs(),
      relVelocity: Math.round(this.lastVelocity * 100) / 100,
    };
  }

  summary() {
    const stance = this.stancePct();
    return {
      averageCadenceSpm: this.averageCadenceSpm(),
      stancePct: stance,
      swingPct: stance > 0 ? 100 - stance : 0,
      cycleMs: this.cycleMs(),
      totalSteps: this.stepCountTotal,
    };
  }
}

/* ─────────────────────────────────────────────────────────────
 * 5) 각도 누적기 — 구간별 평균/ROM 요약(리포트)
 * ───────────────────────────────────────────────────────────── */
export class AngleAccumulator {
  constructor() { this.reset(); }
  reset() {
    this.acc = { hip: 0, knee: 0, ankle: 0 };
    this.cnt = { hip: 0, knee: 0, ankle: 0 };
    this.min = { hip: Infinity, knee: Infinity, ankle: Infinity };
    this.max = { hip: -Infinity, knee: -Infinity, ankle: -Infinity };
  }
  push(angles) {
    for (const sideKey of ['left', 'right']) {
      const s = angles?.[sideKey];
      if (!s) continue;
      for (const j of ['hip', 'knee', 'ankle']) {
        const v = s[j];
        if (v == null) continue;
        this.acc[j] += v; this.cnt[j] += 1;
        if (v < this.min[j]) this.min[j] = v;
        if (v > this.max[j]) this.max[j] = v;
      }
    }
  }
  summary() {
    const out = {};
    for (const j of ['hip', 'knee', 'ankle']) {
      out[j] = this.cnt[j]
        ? {
            avg: Math.round(this.acc[j] / this.cnt[j]),
            min: Math.round(this.min[j]),
            max: Math.round(this.max[j]),
            rom: Math.round(this.max[j] - this.min[j]),
          }
        : null;
    }
    return out;
  }
}

export function fmtAngle(deg) {
  return deg == null ? '—' : `${Math.round(deg)}°`;
}
