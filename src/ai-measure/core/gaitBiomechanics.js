// ai-measure/core/gaitBiomechanics.js

export const angleAt = (a, b, c) => {
  if (!a || !b || !c || a.visibility < 0.2 || b.visibility < 0.2 || c.visibility < 0.2) return null;
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBA * magBC === 0) return null;

  let angle = Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
  return angle * (180 / Math.PI);
};

const getAlpha = (rate, cutoff) => {
  const tau = 1.0 / (2.0 * Math.PI * cutoff);
  return 1.0 / (1.0 + tau * rate);
};

export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x, t) {
    if (this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = t - this.tPrev;
    if (dt <= 0) return x;

    const rate = 1.0 / dt;
    const dx = (x - this.xPrev) * rate;
    const edx = getAlpha(rate, this.dCutoff) * dx + (1 - getAlpha(rate, this.dCutoff)) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const alpha = getAlpha(rate, cutoff);

    const res = alpha * x + (1 - alpha) * this.xPrev;
    this.xPrev = res;
    this.tPrev = t;
    this.dxPrev = edx;
    return res;
  }
}

// 수정됨: 인자 순서를 테스트에 맞게 (tMs, v) 즉 (시간, 값)으로 변경
export class Resampler {
  constructor(targetIntervalMs = 1000 / 60) {
    this.targetInterval = targetIntervalMs;
    this.lastT = null;
    this.lastV = null;
    this.accumulatedMs = 0;
  }

  push(tMs, v) {
    if (this.lastT === null) {
      this.lastT = tMs;
      this.lastV = v;
      return [];
    }
    const dt = tMs - this.lastT;
    this.accumulatedMs += dt;
    const out = [];

    while (this.accumulatedMs >= this.targetInterval) {
      out.push(v);
      this.accumulatedMs -= this.targetInterval;
    }

    this.lastT = tMs;
    this.lastV = v;
    return out;
  }
}

export const cameraAngleQuality = (lm) => {
  if (!lm || !lm[11] || !lm[23] || !lm[25]) return { ok: true };
  const dist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
  const shoulderW = dist(lm[11], lm[12]);
  const thighL = (dist(lm[23], lm[25]) + dist(lm[24], lm[26])) / 2;

  if (thighL < shoulderW * 0.5) return { ok: false, reason: 'high_angle' };
  return { ok: true };
};

export const pelvisRelativeFeet = (lm) => {
  // 발목(27,28)을 필수로 사용 — 발끝(31,32)/발뒤꿈치(29,30)는 모션블러로
  // 자주 소실되므로 선택값으로 두고, 없으면 발목 좌표로 대체해 에러를 막는다.
  if (!lm || !lm[23] || !lm[24] || !lm[27] || !lm[28]) return null;
  const pelvisX = (lm[23].x + lm[24].x) / 2;
  const pelvisY = (lm[23].y + lm[24].y) / 2;
  const pelvisWidth = Math.max(0.01, Math.sqrt((lm[23].x - lm[24].x) ** 2 + (lm[23].y - lm[24].y) ** 2));

  const norm = (p) => ({ x: (p.x - pelvisX) / pelvisWidth, y: (p.y - pelvisY) / pelvisWidth });
  return {
    leftAnkle: norm(lm[27]), rightAnkle: norm(lm[28]),
    leftHeel: lm[29] ? norm(lm[29]) : norm(lm[27]), rightHeel: lm[30] ? norm(lm[30]) : norm(lm[28]),
    leftToe: lm[31] ? norm(lm[31]) : norm(lm[27]), rightToe: lm[32] ? norm(lm[32]) : norm(lm[28])
  };
};

// 수정됨: 하드코딩 제거 + 평탄정점(flat-top) 대응 피크 감지. 동적 SPM/위상 계산.
// IC(Initial Contact) = 발 전후 상대위치가 최대(가장 앞으로 뻗음)인 봉우리.
// 이산 신호의 정점이 두 샘플에 걸쳐 같은 값이 되는 경우를 위해
// '상승 후 하강' 전환(기울기 부호 +→-)을 추적해 평탄 정점도 1회만 카운트한다.
export class GaitCycleTracker {
  constructor({ minStepIntervalMs = 200 } = {}) {
    this.steps = 0;
    this.minStepIntervalMs = minStepIntervalMs;
    this.lastStepTime = -minStepIntervalMs;
    this.firstTime = null;
    this.lastTime = null;
    this.stanceFrames = 0;
    this.totalFrames = 0;
    // 신호 진폭(적응형)으로 상대 임계값을 잡아 줌/패닝 불변 유지
    this.lo = Infinity;
    this.hi = -Infinity;
    this.prevV = null;
    this.prevSlope = 0; // 직전 기울기 부호 유지(평탄구간 0은 무시)
    this._ankleBand = { lo: Infinity, hi: -Infinity };
    this._toeBand = { lo: Infinity, hi: -Infinity };
  }

  push(relFeet, ts) {
    if (!relFeet) return;
    if (this.firstTime === null) this.firstTime = ts;
    this.lastTime = ts;
    this.totalFrames++;

    // 전후(A-P) 상대 위치. 부호 있는 값 → 보폭당 봉우리 1회.
    // 발목(blur에 강함)과 발끝 중 '진폭이 큰' 신호를 자동 선택한다.
    // 현장에선 발목이 안정적이고, 발끝이 잘 보이는 환경에선 발끝이 더 민감하다.
    const ankleV = (relFeet.leftAnkle && relFeet.rightAnkle)
      ? relFeet.leftAnkle.x - relFeet.rightAnkle.x : null;
    const toeV = (relFeet.leftToe && relFeet.rightToe)
      ? relFeet.leftToe.x - relFeet.rightToe.x : null;
    if (this._ankleBand == null) this._ankleBand = { lo: Infinity, hi: -Infinity };
    if (this._toeBand == null) this._toeBand = { lo: Infinity, hi: -Infinity };
    if (ankleV != null) { this._ankleBand.lo = Math.min(this._ankleBand.lo, ankleV); this._ankleBand.hi = Math.max(this._ankleBand.hi, ankleV); }
    if (toeV != null) { this._toeBand.lo = Math.min(this._toeBand.lo, toeV); this._toeBand.hi = Math.max(this._toeBand.hi, toeV); }
    const ankleAmp = this._ankleBand.hi - this._ankleBand.lo;
    const toeAmp = this._toeBand.hi - this._toeBand.lo;
    // 더 큰 진폭(움직임이 뚜렷한) 신호 선택. 동률/초기엔 발목 우선.
    let v;
    if (toeV != null && toeAmp > ankleAmp * 1.2) v = toeV;
    else if (ankleV != null) v = ankleV;
    else if (toeV != null) v = toeV;
    else return;

    // 적응형 진폭 밴드 (느린 감쇠로 패닝/줌 후에도 안정)
    this.lo = Math.min(this.lo === Infinity ? v : this.lo + (v - this.lo) * 0.002, v);
    this.hi = Math.max(this.hi === -Infinity ? v : this.hi - (this.hi - v) * 0.002, v);
    const range = this.hi - this.lo;

    if (this.prevV !== null) {
      const slope = v - this.prevV;
      const wasRising = this.prevSlope > 0;
      const turnsDown = wasRising && slope < 0;
      // prominence: 봉우리가 진폭의 상위 절반에 있어야 IC로 인정 (노이즈 컷)
      const prominent = range > 0.02 && this.prevV >= this.lo + range * 0.5;
      if (turnsDown && prominent && ts - this.lastStepTime >= this.minStepIntervalMs) {
        this.steps++;
        this.lastStepTime = ts;
      }
      if (slope !== 0) this.prevSlope = slope; // 평탄(0)은 직전 부호 유지

      // 동적 Stance/Swing: 발이 몸쪽으로/접지로 향하면(전후 위치 절대값 감소) stance
      if (Math.abs(v) < Math.abs(this.prevV)) this.stanceFrames++;
    }
    this.prevV = v;
  }

  summary() {
    const durationMinutes = (this.lastTime - this.firstTime) / 60000 || 1;
    const spm = this.steps > 0 ? (this.steps / durationMinutes) : 0;

    let stance = this.totalFrames > 0 ? Math.round((this.stanceFrames / this.totalFrames) * 100) : 60;
    if (stance < 40) stance = 40; // 생체역학적 최소/최대 안전장치
    if (stance > 70) stance = 70;

    return {
      totalSteps: this.steps,
      stancePct: stance,
      swingPct: 100 - stance,
      averageCadenceSpm: Math.round(spm)
    };
  }
}

export const jointAnglesFromPose = (lm) => {
  return {
    left: {
      hip: angleAt(lm[11], lm[23], lm[25]),
      knee: angleAt(lm[23], lm[25], lm[27]),
      ankle: angleAt(lm[25], lm[27], lm[31])
    },
    right: {
      hip: angleAt(lm[12], lm[24], lm[26]),
      knee: angleAt(lm[24], lm[26], lm[28]),
      ankle: angleAt(lm[26], lm[28], lm[32])
    }
  };
};

export class AngleAccumulator {
  constructor() {
    this.data = { hip: [], knee: [], ankle: [] };
  }
  push(angles) {
    if (angles?.left?.hip) this.data.hip.push(angles.left.hip);
    if (angles?.left?.knee) this.data.knee.push(angles.left.knee);
    if (angles?.left?.ankle) this.data.ankle.push(angles.left.ankle);
  }
  summary() {
    const calc = (arr) => {
      if (!arr.length) return { avg: 0, rom: 0 };
      const max = Math.max(...arr);
      const min = Math.min(...arr);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return { avg: Math.round(avg), rom: Math.round(max - min) };
    };
    return {
      hip: calc(this.data.hip),
      knee: calc(this.data.knee),
      ankle: calc(this.data.ankle)
    };
  }
}
