// ai-measure/core/gaitBiomechanics.js
// 보행 & 러닝 분석용 순수 생체역학 헬퍼.
//
// 프레임워크 비의존 → 단위테스트 및 어떤 포즈 백엔드(MediaPipe Tasks Vision,
// MoveNet 등)와도 재사용 가능. landmark 규약: { x, y, z?, visibility? },
// x·y 는 0~1 정규화 이미지 좌표(좌상단 0,0).
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

/** 2D 투영 평면 벡터 내적 기반 관절 각도(도). 정점 b, 광선 b→a / b→c. */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return null;
  let cos = dot / (magAb * magCb);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

const vis = (lm, min = 0.4) => lm && (lm.visibility == null || lm.visibility >= min);

/**
 * 한 프레임의 landmark 배열에서 좌우 고관절·무릎·발목 각도 계산.
 * - hip:   shoulder–hip–knee (몸통-허벅지)
 * - knee:  hip–knee–ankle    (허벅지-정강이, 180°≈완전신전)
 * - ankle: knee–ankle–footIndex (배측/저측 굴곡 대용)
 */
export function jointAnglesFromPose(landmarks) {
  if (!Array.isArray(landmarks)) return emptyAngles();
  const L = POSE_LANDMARKS;
  const get = (i) => (vis(landmarks[i]) ? landmarks[i] : null);
  const side = (sh, hp, kn, an, ft) => ({
    hip: angleAt(get(sh), get(hp), get(kn)),
    knee: angleAt(get(hp), get(kn), get(an)),
    ankle: angleAt(get(kn), get(an), get(ft)),
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

/**
 * 이동 평균 필터(Moving Average Filter).
 * landmark 흔들림(jitter)을 잡아 각도·주기 계산을 안정화한다.
 * 윈도우 크기만큼의 최근 표본을 평균. null 입력은 무시.
 */
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

/** 좌우 한 쌍의 landmark에 이동평균을 적용해 부드러운 점을 만든다. */
export class PointSmoother {
  constructor(windowSize = 5) {
    this.fx = new MovingAverageFilter(windowSize);
    this.fy = new MovingAverageFilter(windowSize);
  }
  reset() { this.fx.reset(); this.fy.reset(); }
  push(pt) {
    if (!pt) return null;
    const x = this.fx.push(pt.x);
    const y = this.fy.push(pt.y);
    return x == null || y == null ? null : { x, y, visibility: pt.visibility };
  }
}

/**
 * GaitCycleTracker — 발뒤꿈치/발끝 Y축 + 프레임 타임스탬프로
 * 입각기(Stance)·유각기(Swing)를 자동 판별하고 케이던스(SPM)를 추정.
 *
 * 가변 FPS 대응: 매 push 에 실제 timestamp(ms)를 받아 dt 로 위상 시간을
 * 누적하므로 프레임 레이트가 흔들려도 비율이 왜곡되지 않는다.
 *
 * 판별 원리(측면/후면 공용):
 *  - 지지발(두 발목 중 화면 아래쪽=y 큰 쪽)의 발끝 y 를 이동평균으로 평활.
 *  - 적응형 밴드(최근 상·하단)로 접지 임계선을 만들고, 발끝이 임계선 근처면
 *    stance, 위로 들리면 swing.
 *  - y 의 국소 최대(발이 가장 낮은 순간 = heel/foot strike)에서 1 step 카운트.
 */
export class GaitCycleTracker {
  constructor({ windowSize = 5, minStepIntervalMs = 220 } = {}) {
    this.smoother = new MovingAverageFilter(windowSize);
    this.minStepIntervalMs = minStepIntervalMs;
    this.reset();
  }

  reset() {
    this.smoother.reset();
    this.prevY = null;
    this.prevSlope = 0;
    this.lastStepTs = 0;
    this.stepTimestamps = [];
    this.band = { lo: Infinity, hi: -Infinity };
    this.phase = 'unknown';
    this.lastTs = null;
    this.stanceMs = 0;
    this.swingMs = 0;
    // 리포트용 누적 통계
    this.stepCountTotal = 0;
    this.firstTs = null;
  }

  /**
   * @param {number} footY  지지발 발끝 y (정규화, 0=상단 1=하단)
   * @param {number} ts     프레임 타임스탬프(ms)
   */
  push(footY, ts) {
    if (footY == null || Number.isNaN(footY)) return this.snapshot();
    if (this.firstTs == null) this.firstTs = ts;

    // 위상 시간 누적 (가변 FPS 대응)
    if (this.lastTs != null) {
      const dt = ts - this.lastTs;
      if (dt > 0 && dt < 500) {
        if (this.phase === 'stance') this.stanceMs += dt;
        else if (this.phase === 'swing') this.swingMs += dt;
      }
    }
    this.lastTs = ts;

    const y = this.smoother.push(footY);
    if (y == null) return this.snapshot();

    // 적응형 밴드: 아주 느리게 감쇠시켜 보행 진폭을 안정적으로 추적.
    // (감쇠가 빠르면 깨끗한 사인파에서도 range 가 줄어 스텝을 놓친다.)
    this.band.lo = Math.min(this.band.lo === Infinity ? y : this.band.lo + (y - this.band.lo) * 0.0008, y);
    this.band.hi = Math.max(this.band.hi === -Infinity ? y : this.band.hi - (this.band.hi - y) * 0.0008, y);
    const range = this.band.hi - this.band.lo;
    const contactLine = this.band.hi - range * 0.30;

    // 위상 판별: 발끝이 낮으면(접지) stance, 높으면 swing
    this.phase = range > 0.012 ? (y >= contactLine ? 'stance' : 'swing') : 'unknown';

    // 스텝 검출: 평활된 y 의 국소 최대(발 최저점 = foot-strike).
    // contact line 직접 비교 대신 '봉우리 자체'를 잡고, 진폭(prominence)으로 노이즈 제거.
    if (this.prevY != null) {
      const slope = y - this.prevY;
      const wasDescending = this.prevSlope > 0; // y 증가 = 발 하강
      const nowLifting = slope <= 0;            // y 감소/정점 = 발 상승 시작
      const prominentEnough = range > 0.012 && this.prevY >= this.band.lo + range * 0.45;
      const isStrike = wasDescending && nowLifting && prominentEnough;
      if (isStrike && ts - this.lastStepTs >= this.minStepIntervalMs) {
        this.lastStepTs = ts;
        this.stepTimestamps.push(ts);
        this.stepCountTotal += 1;
        const cutoff = ts - 6000;
        this.stepTimestamps = this.stepTimestamps.filter((t) => t >= cutoff);
      }
      if (slope !== 0) this.prevSlope = slope; // 평탄 구간이 기울기 부호를 지우지 않도록
    }
    this.prevY = y;
    return this.snapshot();
  }

  /** 최근 구간 순간 케이던스(SPM). */
  cadenceSpm() {
    const t = this.stepTimestamps;
    if (t.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
    const mean = sum / (t.length - 1);
    return mean > 0 ? Math.round(60000 / mean) : 0;
  }

  /** 전체 평균 케이던스(SPM) — 리포트용. */
  averageCadenceSpm() {
    if (this.stepCountTotal < 2 || this.firstTs == null || this.lastTs == null) return 0;
    const mins = (this.lastTs - this.firstTs) / 60000;
    return mins > 0 ? Math.round(this.stepCountTotal / mins) : 0;
  }

  stancePct() {
    const total = this.stanceMs + this.swingMs;
    return total > 0 ? Math.round((this.stanceMs / total) * 100) : 0;
  }

  /** 1주기(stance+swing) 평균 시간(ms) 추정 — 스텝 간 간격의 평균. */
  cycleMs() {
    const t = this.stepTimestamps;
    if (t.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
    return Math.round((sum / (t.length - 1)) * 2); // 한 다리 주기 ≈ 스텝 간격×2
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
    };
  }

  /** 회차 기록 저장용 정량 요약. */
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

/** 지지발(두 발목 중 화면 아래쪽)의 발끝 y. */
export function supportFootY(landmarks) {
  if (!Array.isArray(landmarks)) return null;
  const L = POSE_LANDMARKS;
  const la = vis(landmarks[L.LEFT_ANKLE]) ? landmarks[L.LEFT_ANKLE].y : null;
  const ra = vis(landmarks[L.RIGHT_ANKLE]) ? landmarks[L.RIGHT_ANKLE].y : null;
  const lf = vis(landmarks[L.LEFT_FOOT_INDEX]) ? landmarks[L.LEFT_FOOT_INDEX].y : la;
  const rf = vis(landmarks[L.RIGHT_FOOT_INDEX]) ? landmarks[L.RIGHT_FOOT_INDEX].y : ra;
  if (la == null && ra == null) return null;
  if (la == null) return rf;
  if (ra == null) return lf;
  return la >= ra ? lf : rf; // 낮은(y 큰) 발의 발끝
}

export function fmtAngle(deg) {
  return deg == null ? '—' : `${Math.round(deg)}°`;
}

/** 각도 누적기 — 구간별 평균 각도 요약(리포트). */
export class AngleAccumulator {
  constructor() { this.reset(); }
  reset() {
    this.acc = { hip: 0, knee: 0, ankle: 0 };
    this.cnt = { hip: 0, knee: 0, ankle: 0 };
    this.min = { hip: Infinity, knee: Infinity, ankle: Infinity };
    this.max = { hip: -Infinity, knee: -Infinity, ankle: -Infinity };
  }
  push(angles) {
    for (const side of ['left', 'right']) {
      const s = angles?.[side];
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
