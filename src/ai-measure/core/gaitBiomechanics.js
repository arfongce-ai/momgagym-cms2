// ai-measure/core/gaitBiomechanics.js

// [동적 무릎 정렬 2026-09-14] 자세측정(postureMath.js)이 이미 검증해둔 X다리/
// O다리 판정을 그대로 재사용한다 — postureMath.js는 의존성이 없는 leaf 모듈이라
// 순환참조 위험 없이 가져다 쓸 수 있다. 새로 만들지 않고 재사용(사용자 확인).
import { classifyLegAlignment, POSTURE_STATUS } from './postureMath.js';

// ───────── 현장 튜닝 설정 (한 곳에 모음) ─────────
// 측정 데이터가 쌓이면 이 값들만 조정해 정확도를 올릴 수 있다.
// "정상인데 무효 처리됨" → validMinAmp/validMinSteps 낮추기
// "이상한데 통과됨" → validMinAmp/validMinSteps 높이기
// "스텝을 너무 많이/적게 셈" → stepProminence, minStepIntervalMs 조정
export const GAIT_TUNING = {
  minVisibility: 0.2,       // 관절 가시성 하한 (이하면 각도 계산 제외)
  filterMinCutoff: 1.5,     // 1-Euro 평활 강도 (낮을수록 더 부드럽게)
  filterBeta: 0.02,         // 1-Euro 반응성 (빠른 움직임 추종)
  minStepIntervalMs: 200,   // 스텝 간 최소 간격 (중복 카운트 방지)
  stepProminence: 0.25,     // 봉우리로 인정할 최소 진폭 (노이즈 컷)
  validMinAmp: 1.2,         // 유효 측정 최소 신호 진폭 (정지/누움 차단)
  validMinSteps: 3,         // 유효 측정 최소 스텝 수
  // 측면/후면 구분 — 단일 임계는 경계에서 떨림. 히스테리시스 밴드 사용.
  orientationSideRatio: 0.35, // 호환용(중앙값)
  orientationSideMax: 0.30,   // 이하 → 측면 확정
  orientationBackMin: 0.42,   // 이상 → 후면/전면 확정 (그 사이는 직전 판정 유지)
  // [골반 낙하 판정 2026-09-14] 실측 데이터 없이 정한 보수적 시작값 — 문헌상
  // 명확한 합의치가 없어(Trendelenburg는 통상 육안 관찰 기준) 기존 pelvicDropAbs
  // (좌우 진폭, % 신장 대비)에 대해 "주의"/"유의미" 2단계로만 우선 나눈다.
  // 실측 쌓이면 이 값들만 조정.
  pelvicDropWarnPct: 3,  // 이상 → 주의(경미한 비대칭)
  pelvicDropFlagPct: 6,  // 이상 → 유의미(뚜렷한 비대칭 — Trendelenburg 의심)
  // [광각/실조성 보행 판정 추가 2026-09-14] ankleSpread(발목 간 거리, 기존
  // strideToHeight 계산에 쓰이던 값)를 후면·정면뷰에서는 "보폭 너비(step width)"로
  // 재해석해 광각(wide-based)/실조성(ataxic) 보행 — 임상평가 가이드 문서 낙상위험
  // 스크리닝 항목 — 을 스크리닝한다. 문헌상 정상 보폭너비는 신장 대비 매우 작은
  // 비율이라 신장 대비 10%/16%를 보수적 시작값으로 둔다. 실측 쌓이면 조정.
  stepWidthWarnPct: 10,
  stepWidthFlagPct: 16,
  // [가위걸음(Scissoring) 판정 추가 2026-09-14] 무릎이 정중선을 넘어 교차하는
  // 프레임의 비율. 순간적 교차(노이즈·보행 중 다리가 스쳐 지나가는 정상 프레임)와
  // 지속적 교차(내전근 과활성/경직 의심)를 구분하기 위해 낮은 문턱을 쓴다.
  // 실측 쌓이면 조정.
  scissorWarnPct: 3,
  scissorFlagPct: 10,
  // [교차보행(Crossover gait) 판정 추가 2026-09-14] 러닝 시 발이 신체 정중선을
  // 넘어 착지하는 프레임의 비율. 가위걸음과 같은 원리(정중선 교차)지만 판정
  // 관절이 무릎이 아니라 발목이라는 점이 다르다 — 골반 안정성 부족/과도한
  // 고관절 내전 지표. 가위걸음과 동일한 보수적 시작값 사용, 실측 쌓이면 조정.
  crossoverWarnPct: 3,
  crossoverFlagPct: 10,
  // [팔 크로스바디 스윙(Contralateral arm swing) 판정 추가 2026-09-14] 러닝 시
  // 팔이 몸통 정중선을 넘어 반대편으로 스윙하는 프레임의 비율. 가위걸음·교차보행과
  // 같은 원리(정중선 교차)를 손목-어깨 관절에 적용 — 체간 회전 보상 지표.
  // 가위걸음과 동일한 보수적 시작값 사용, 실측 쌓이면 조정.
  armCrossWarnPct: 3,
  armCrossFlagPct: 10,
  // [발 진행각(Toe-out/Toe-in) 판정 추가 2026-09-14] 문헌상 정상 기준은 3D
  // 보행분석 기준 "외측 8~10도" 같은 각도(deg)지만, 단일 2D 카메라(후면/정면)
  // 로는 발의 실제 진행각(주로 깊이축 회전)을 정확히 복원할 수 없다 — 여기서는
  // 발목→발끝 벡터가 몸 중심선에서 얼마나 더/덜 벌어지는지를 신장 대비 %로
  // 근사하는 "투영 비율 지표"다(실제 각도 아님, 참고용 스크리닝). 실측 쌓이면 조정.
  toeAngleWarnPct: 4,
  toeAngleFlagPct: 8,
};

export const angleAt = (a, b, c) => {
  const v = GAIT_TUNING.minVisibility;
  if (!a || !b || !c || a.visibility < v || b.visibility < v || c.visibility < v) return null;
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

// 촬영 방향 판별: 측면(side) vs 후면/전면(back).
// 측면뷰는 어깨·골반이 앞뒤로 겹쳐 좌우 너비가 좁고, 후면/전면은 넓게 펼쳐진다.
// 어깨너비 / 몸통높이 비율로 구분 (측면 ~0.1, 후면/전면 ~0.5).
//
// prevView(직전 판정)를 주면 히스테리시스로 경계 떨림을 막는다:
//   ratio ≤ sideMax  → side 확정
//   ratio ≥ backMin  → back 확정
//   그 사이          → 직전 판정 유지 (없으면 중앙 임계로 결정)
// 가시성이 낮은 관절이 많으면 unknown 으로 둬 오판을 막는다.
export const detectOrientation = (lm, prevView = null) => {
  if (!lm || !lm[11] || !lm[12] || !lm[23] || !lm[24]) return { view: 'unknown', ratio: 0, confidence: 0 };
  // 핵심 관절 가시성 확인 (낮으면 신뢰 불가 → unknown)
  const vis = [11, 12, 23, 24].map(i => lm[i].visibility == null ? 1 : lm[i].visibility);
  const minVis = Math.min(...vis);
  if (minVis < 0.5) return { view: 'unknown', ratio: 0, confidence: minVis };

  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const shoulderW = dist(lm[11], lm[12]);
  const hipW = dist(lm[23], lm[24]);
  const torsoH = (dist(lm[11], lm[23]) + dist(lm[12], lm[24])) / 2;
  if (torsoH < 0.001) return { view: 'unknown', ratio: 0, confidence: 0 };
  // 어깨너비와 골반너비를 함께 봐서 한쪽 관절 흔들림에 덜 민감하게.
  const ratio = ((shoulderW + hipW) / 2) / torsoH;

  const T = GAIT_TUNING;
  let view;
  if (ratio <= T.orientationSideMax) view = 'side';
  else if (ratio >= T.orientationBackMin) view = 'back';
  else if (prevView === 'side' || prevView === 'back') view = prevView; // 밴드 내 → 유지
  else view = ratio < T.orientationSideRatio ? 'side' : 'back';

  // 신뢰도: 경계에서 멀수록 높음
  const mid = (T.orientationSideMax + T.orientationBackMin) / 2;
  const confidence = Math.min(1, Math.abs(ratio - mid) / mid);
  return { view, ratio: Math.round(ratio * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 };
};

// 여러 프레임의 방향 판정을 다수결로 누적하는 작은 헬퍼 (UI 떨림 방지).
export class OrientationVoter {
  constructor() { this.votes = { side: 0, back: 0, unknown: 0 }; this.last = null; }
  push(lm) {
    const o = detectOrientation(lm, this.last);
    if (o.view !== 'unknown') this.last = o.view;
    this.votes[o.view] = (this.votes[o.view] || 0) + 1;
    return o;
  }
  // 누적 다수결 (side vs back). 둘 다 0이면 unknown.
  decide() {
    const { side, back } = this.votes;
    if (side === 0 && back === 0) return 'unknown';
    return side >= back ? 'side' : 'back';
  }
}

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
  constructor({
    minStepIntervalMs = GAIT_TUNING.minStepIntervalMs,
    minCutoff = GAIT_TUNING.filterMinCutoff,
    beta = GAIT_TUNING.filterBeta,
  } = {}) {
    this.steps = 0;
    this.minStepIntervalMs = minStepIntervalMs;
    this.minCutoff = minCutoff;
    this.beta = beta;
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
    // 노이즈를 보행으로 오판하지 않도록 1-Euro 평활 적용(차분 신호 — stance/유효판정용)
    this._filt = new OneEuroFilter({ minCutoff, beta, dCutoff: 1.0 });
    // 전체 신호의 절대 진폭(최댓값-최솟값) 추적 → 유효 측정 판정용
    this._absLo = Infinity;
    this._absHi = -Infinity;
    // ── 스텝 카운트: 발별 독립 봉우리 감지 ──
    //  차분(L−R) 신호의 봉우리만 세면 '보폭(stride)'만 잡혀 실제 스텝의 절반이 된다.
    //  대신 각 발의 골반상대 전후위치에서 '전방 최대(봉우리)'를 발마다 세면
    //  한 스텝당 1회로 좌우 스텝이 모두 잡혀 실제 스텝 수와 일치한다.
    this._foot = {
      left: this._makeFootPeak(),
      right: this._makeFootPeak(),
    };
  }

  _makeFootPeak() {
    return {
      filt: new OneEuroFilter({ minCutoff: this.minCutoff, beta: this.beta, dCutoff: 1.0 }),
      lo: Infinity, hi: -Infinity, prevV: null, prevSlope: 0, lastStepTime: -this.minStepIntervalMs,
    };
  }

  // 한 발의 전후 신호를 받아 '전방 봉우리(초기 접지 IC)'를 1회씩 카운트.
  // 스텝 = 그 발이 가장 앞으로 나갔다가 접지하는 순간(전방 봉우리) 1회.
  // 골(뒤로 빠지는 지점)은 같은 발의 '몸이 지나가는' 국면이라 스텝이 아니다.
  _pushFoot(foot, x, ts) {
    if (x == null || !Number.isFinite(x)) return;
    const v = foot.filt.filter(x, ts / 1000);
    foot.lo = Math.min(foot.lo === Infinity ? v : foot.lo + (v - foot.lo) * 0.002, v);
    foot.hi = Math.max(foot.hi === -Infinity ? v : foot.hi - (foot.hi - v) * 0.002, v);
    const range = foot.hi - foot.lo;
    if (foot.prevV !== null) {
      const slope = v - foot.prevV;
      const wasRising = foot.prevSlope > 0;
      const turnsDown = wasRising && slope < 0; // 전방 봉우리(초기 접지)
      const enough = range > GAIT_TUNING.stepProminence;
      // 봉우리가 진폭 상위 절반에 있을 때만 스텝으로 인정(노이즈 컷).
      const nearHi = foot.prevV >= foot.lo + range * 0.5;
      const spaced = ts - foot.lastStepTime >= this.minStepIntervalMs;
      if (enough && spaced && turnsDown && nearHi) {
        this.steps++;
        foot.lastStepTime = ts;
      }
      if (slope !== 0) foot.prevSlope = slope;
    }
    foot.prevV = v;
  }

  push(relFeet, ts) {
    if (!relFeet) return;
    if (this.firstTime === null) this.firstTime = ts;
    this.lastTime = ts;
    this.totalFrames++;

    // 전후(A-P) 상대 위치. 부호 있는 값 → 보폭당 봉우리 1회.
    // 발목(blur에 강함)과 발끝 중 '진폭이 큰' 신호를 자동 선택한다.
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
    let vRaw;
    let useToe = false;
    if (toeV != null && toeAmp > ankleAmp * 1.2) { vRaw = toeV; useToe = true; }
    else if (ankleV != null) vRaw = ankleV;
    else if (toeV != null) { vRaw = toeV; useToe = true; }
    else return;

    // 1-Euro 평활: 검출 떨림(노이즈) 제거. 보행 같은 큰 저주파 움직임은 보존.
    const v = this._filt.filter(vRaw, ts / 1000);

    // 절대 진폭 추적 (전체 측정 구간의 흔들림 크기)
    this._absLo = Math.min(this._absLo, v);
    this._absHi = Math.max(this._absHi, v);

    // 적응형 진폭 밴드 (느린 감쇠로 패닝/줌 후에도 안정)
    this.lo = Math.min(this.lo === Infinity ? v : this.lo + (v - this.lo) * 0.002, v);
    this.hi = Math.max(this.hi === -Infinity ? v : this.hi - (this.hi - v) * 0.002, v);

    // ── 스텝 카운트: 각 발의 골반상대 전후 위치로 발별 봉우리를 센다 ──
    //  (차분 신호 대신 발별로 세어 좌/우 스텝을 모두 포착 → 실제 스텝 수와 일치)
    const lx = useToe ? relFeet.leftToe?.x : relFeet.leftAnkle?.x;
    const rx = useToe ? relFeet.rightToe?.x : relFeet.rightAnkle?.x;
    this._pushFoot(this._foot.left, lx, ts);
    this._pushFoot(this._foot.right, rx, ts);
    // 전체 최소 간격 갱신(발 무관 마지막 스텝 시각) — cadence 안정화 참고용
    if (this.steps > 0) this.lastStepTime = ts;

    if (this.prevV !== null) {
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

    // 전체 신호의 절대 진폭. 실제 보행은 정규화 기준 2~4, 정지/노이즈는 보통 0.5 미만.
    const signalAmp = (this._absHi > this._absLo) ? (this._absHi - this._absLo) : 0;
    // 유효 측정: 충분한 움직임 + 최소 스텝 수. 누워있거나 가만히 있으면 false.
    const valid = signalAmp >= GAIT_TUNING.validMinAmp && this.steps >= GAIT_TUNING.validMinSteps;

    return {
      totalSteps: this.steps,
      stancePct: stance,
      swingPct: 100 - stance,
      averageCadenceSpm: Math.round(spm),
      signalAmp: Math.round(signalAmp * 100) / 100,
      valid,
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

// [2026-08-27] "보행·러닝 관절 각도가 리포트에 제대로 반영되는지" 확인 과정에서
// 발견: push()가 angles.left.* 만 누적하고 있었다 — jointAnglesFromPose()는
// 좌/우 모두 계산해 넘겨주는데, 오른쪽 고관절·발목 데이터가 전부 조용히
// 유실되고 있었음(무릎은 별도의 BiomechAccumulator가 좌우를 정확히 추적해서
// 문제 없었지만, 고관절·발목은 이 클래스가 유일한 경로였음). 그 결과
// GaitReportDashboard.jsx의 "관절 각도 비교(좌·우 비교)" 레이더 차트에서
// 고관절 ROM·발목 ROM 두 축은 좌/우에 같은 값을 그대로 복제해 보여주고
// 있었다(실제 좌우 비대칭이 있어도 항상 대칭으로 보임). 좌/우를 각각
// 누적하도록 수정하고, 기존 소비처(단일 rom/avg를 읽던 곳)가 깨지지 않도록
// 좌우 통합값은 그대로 avg/rom에 유지하면서 left/right를 추가로 반환한다.
export class AngleAccumulator {
  constructor() {
    this.data = {
      hip: { left: [], right: [] },
      knee: { left: [], right: [] },
      ankle: { left: [], right: [] },
    };
  }
  push(angles) {
    ['hip', 'knee', 'ankle'].forEach((joint) => {
      const l = angles?.left?.[joint];
      const r = angles?.right?.[joint];
      if (l != null) this.data[joint].left.push(l);
      if (r != null) this.data[joint].right.push(r);
    });
  }
  summary() {
    const calc = (arr) => {
      if (!arr.length) return { avg: 0, rom: 0 };
      const max = Math.max(...arr);
      const min = Math.min(...arr);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return { avg: Math.round(avg), rom: Math.round(max - min) };
    };
    const bySide = (joint) => {
      const left = calc(this.data[joint].left);
      const right = calc(this.data[joint].right);
      // 기존 형태(avg/rom 단일값) 호환 — 좌우 데이터를 합쳐 계산.
      const combined = calc([...this.data[joint].left, ...this.data[joint].right]);
      return { ...combined, left, right };
    };
    return {
      hip: bySide('hip'),
      knee: bySide('knee'),
      ankle: bySide('ankle'),
    };
  }
}
// ════════════════════════════════════════════════════════════════════════
//  [요구사항 1] 고급 생체역학 지표 — gaitBiomechanics.js 추가분
//  기존 파일(angleAt, OneEuroFilter, GaitCycleTracker, AngleAccumulator 등)은
//  그대로 두고, 아래 블록을 파일 "맨 끝"에 추가하면 됩니다.
//  - 기존 테스트/동작 불변(기존 export 미수정).
//  - 결과는 BiomechAccumulator 에 "축적"만 하고 화면에는 반환/표시하지 않습니다.
// ════════════════════════════════════════════════════════════════════════

// 두 점 거리 (정규화 좌표)
const _dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

// 가시성 가드 (GAIT_TUNING.minVisibility 재사용)
const _vis = (p) => p && (p.visibility == null || p.visibility >= GAIT_TUNING.minVisibility);

// 신장(픽셀) 추정: 어깨 중점 ~ 발목 중점 수직거리. 정규화 좌표 기준 스케일러로 사용.
// 줌/거리 변화에 따른 절대 픽셀 편차를 흡수하기 위해 모든 공간지표를 이 값으로 정규화한다.
const _bodyScale = (lm) => {
  if (!lm || !lm[11] || !lm[12] || !lm[27] || !lm[28]) return null;
  const shY = (lm[11].y + lm[12].y) / 2;
  const ankY = (lm[27].y + lm[28].y) / 2;
  const h = Math.abs(ankY - shY);
  return h > 0.01 ? h : null;
};

// ───────── Kinematic ─────────

// 몸통 전방 기울기(Trunk Forward Lean): 어깨중점→골반중점 벡터와 수직선의 각도(도).
// 0°=완전 직립, 양수=전방 기울기. 어깨가 골반보다 앞(달리는 방향)으로 나갈수록 커짐.
const trunkForwardLean = (lm) => {
  if (!lm || !lm[11] || !lm[12] || !lm[23] || !lm[24]) return null;
  if (!_vis(lm[11]) || !_vis(lm[12]) || !_vis(lm[23]) || !_vis(lm[24])) return null;
  const sh = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
  const hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
  // 몸통 벡터 (골반→어깨). 수직(0,-1) 기준 각.
  const vx = sh.x - hip.x;
  const vy = sh.y - hip.y; // 위로 갈수록 음수
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len < 1e-6) return null;
  // 수직선과의 각도: atan2(수평성분, 수직성분)
  const deg = Math.atan2(Math.abs(vx), Math.abs(vy)) * (180 / Math.PI);
  return Math.round(deg * 10) / 10;
};

// 무릎 굽힘 각도(좌/우): 180°=완전 신전, 작을수록 깊게 굽힘.
// 기존 jointAnglesFromPose 와 동일 정의(고관절-무릎-발목)지만 좌우 모두 반환.
const kneeFlexion = (lm) => ({
  left: angleAt(lm[23], lm[25], lm[27]),
  right: angleAt(lm[24], lm[26], lm[28]),
});

// ───────── Symmetry ─────────

// 골반 드롭(Pelvic Drop): 좌우 골반(23,24) y좌표 차이를 신장으로 정규화(%).
// 한쪽 지지기에 반대쪽 골반이 내려가는 정도(중둔근 약화 지표). 부호: 좌-우.
const pelvicDrop = (lm, scale) => {
  if (!lm || !lm[23] || !lm[24]) return null;
  if (!_vis(lm[23]) || !_vis(lm[24])) return null;
  const s = scale || _bodyScale(lm);
  if (!s) return null;
  return Math.round(((lm[23].y - lm[24].y) / s) * 1000) / 10; // % (신장 대비), ×0.1 해상도
};

// 골반 중점 y (수직 진폭 계산용 raw). 누적기에서 max-min 으로 진폭을 구한다.
const pelvisCenterY = (lm) => {
  if (!lm || !lm[23] || !lm[24]) return null;
  if (!_vis(lm[23]) || !_vis(lm[24])) return null;
  return (lm[23].y + lm[24].y) / 2;
};

// ───────── Spatial ─────────

// 발목 간 거리(좌우 발목 27,28). 보폭 추정의 raw — 누적기에서 max 를 신장으로 정규화.
const ankleSpread = (lm) => {
  if (!lm || !lm[27] || !lm[28]) return null;
  if (!_vis(lm[27]) || !_vis(lm[28])) return null;
  return _dist(lm[27], lm[28]);
};

// ════════════════════════════════════════════════════════════════════════
//  BiomechAccumulator — 프레임마다 push, 끝에 summary()
//  GaitCycleTracker / AngleAccumulator 와 같은 인터페이스(push/summary).
//  GaitRunningAnalysis 의 녹화 루프에서 trackerRef.push 옆에 한 줄 추가해 쓴다.
// ════════════════════════════════════════════════════════════════════════
export class BiomechAccumulator {
  constructor() {
    this.trunkLean = [];
    this.kneeL = [];
    this.kneeR = [];
    this.pelvicDrop = [];
    this.pelvisY = [];        // 수직 진폭용 (min/max)
    this.ankleSpread = [];    // 보폭용 (max)
    this._scaleSum = 0;
    this._scaleN = 0;
    // [가위걸음 판정 2026-09-14] 무릎(25,26)이 골반(23,24) 순서와 반대로 뒤집히는
    // (=정중선을 넘어 교차하는) 프레임 비율. 부호 비교만 쓰므로 정면/후면 어느
    // 쪽에서 찍었든(좌우가 화면상 어느 쪽이든) 그대로 맞는다 — 측면뷰에서는 이
    // 부호 관계가 좌우 교차가 아니라 보폭(전후) 잡음이라 의미가 없으니 호출부에서
    // orientation==='back'|'front'일 때만 노출할 것(stepWidthAssessment와 동일 원칙).
    this._scissorFrames = 0;
    this._scissorCheckFrames = 0;
    // [교차보행(Crossover gait) 판정 2026-09-14] 발목(27,28)이 골반(23,24) 순서와
    // 반대로 뒤집히는(=정중선을 넘어 착지하는) 프레임 비율. 가위걸음과 동일한
    // 부호비교 방식 — 관절만 무릎→발목으로 바꿔 재사용(촬영 방향 무관, 측면뷰
    // 제외는 호출부에서 동일 원칙 적용).
    this._crossoverFrames = 0;
    this._crossoverCheckFrames = 0;
    // [팔 크로스바디 스윙 판정 2026-09-14] 손목(15,16)이 어깨(11,12) 순서와
    // 반대로 뒤집히는(=팔이 몸통 정중선을 넘어가는) 프레임 비율. 가위걸음·
    // 교차보행과 동일한 부호비교 방식 — 관절만 손목/어깨로 재사용(촬영 방향
    // 무관, 측면뷰 제외는 호출부에서 동일 원칙 적용).
    this._armCrossFrames = 0;
    this._armCrossCheckFrames = 0;
    // [발 진행각(Toe-out/Toe-in) 판정 2026-09-14] 발목(27/28)→발끝(31/32) 벡터가
    // 그 발의 몸 중심선 기준 바깥쪽(양수=toe-out)/안쪽(음수=toe-in)으로 벌어지는
    // 정도. 좌우 어느 쪽이 화면상 어디에 있든(전면/후면 무관) 부호가 그대로
    // 맞도록 "그 발의 중심선 기준 방향"을 곱해 정규화한다(가위걸음의 부호비교와
    // 같은 원리를 연속값에 적용).
    this.toeAngleL = [];
    this.toeAngleR = [];
  }

  push(lm) {
    if (!lm) return;
    const scale = _bodyScale(lm);
    if (scale) { this._scaleSum += scale; this._scaleN += 1; }

    const tl = trunkForwardLean(lm);
    if (tl != null) this.trunkLean.push(tl);

    const kf = kneeFlexion(lm);
    if (kf.left != null) this.kneeL.push(kf.left);
    if (kf.right != null) this.kneeR.push(kf.right);

    const pd = pelvicDrop(lm, scale);
    if (pd != null) this.pelvicDrop.push(pd);

    const py = pelvisCenterY(lm);
    if (py != null) this.pelvisY.push(py);

    const as = ankleSpread(lm);
    if (as != null) this.ankleSpread.push(as);

    if (_vis(lm[23]) && _vis(lm[24]) && _vis(lm[25]) && _vis(lm[26])) {
      const hipSign = Math.sign(lm[23].x - lm[24].x);
      const kneeSign = Math.sign(lm[25].x - lm[26].x);
      if (hipSign !== 0 && kneeSign !== 0) {
        this._scissorCheckFrames += 1;
        if (kneeSign !== hipSign) this._scissorFrames += 1;
      }
    }

    if (_vis(lm[23]) && _vis(lm[24]) && _vis(lm[27]) && _vis(lm[28])) {
      const hipSign = Math.sign(lm[23].x - lm[24].x);
      const ankleSign = Math.sign(lm[27].x - lm[28].x);
      if (hipSign !== 0 && ankleSign !== 0) {
        this._crossoverCheckFrames += 1;
        if (ankleSign !== hipSign) this._crossoverFrames += 1;
      }
    }

    if (_vis(lm[11]) && _vis(lm[12]) && _vis(lm[15]) && _vis(lm[16])) {
      const shoulderSign = Math.sign(lm[11].x - lm[12].x);
      const wristSign = Math.sign(lm[15].x - lm[16].x);
      if (shoulderSign !== 0 && wristSign !== 0) {
        this._armCrossCheckFrames += 1;
        if (wristSign !== shoulderSign) this._armCrossFrames += 1;
      }
    }

    if (_vis(lm[23]) && _vis(lm[24])) {
      const hipMidX = (lm[23].x + lm[24].x) / 2;
      if (_vis(lm[27]) && _vis(lm[31])) {
        const sideL = Math.sign(lm[27].x - hipMidX);
        if (sideL !== 0) this.toeAngleL.push((lm[31].x - lm[27].x) * sideL);
      }
      if (_vis(lm[28]) && _vis(lm[32])) {
        const sideR = Math.sign(lm[28].x - hipMidX);
        if (sideR !== 0) this.toeAngleR.push((lm[32].x - lm[28].x) * sideR);
      }
    }
  }

  summary() {
    const stat = (arr) => {
      if (!arr.length) return { avg: 0, max: 0, min: 0 };
      const max = Math.max(...arr), min = Math.min(...arr);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return { avg: Math.round(avg * 10) / 10, max: Math.round(max * 10) / 10, min: Math.round(min * 10) / 10 };
    };
    const round1 = (n) => Math.round(n * 10) / 10;

    const meanScale = this._scaleN ? this._scaleSum / this._scaleN : null;

    // 수직 진폭(Vertical Oscillation): 골반 y 이동량(max-min)을 신장으로 정규화(%).
    let verticalOscillation = 0;
    if (this.pelvisY.length && meanScale) {
      const amp = Math.max(...this.pelvisY) - Math.min(...this.pelvisY);
      verticalOscillation = round1((amp / meanScale) * 100);
    }

    // 추정 보폭 비율(Stride to Height Ratio): 발목 최대 거리 / 신장.
    let strideToHeight = 0;
    if (this.ankleSpread.length && meanScale) {
      strideToHeight = round1((Math.max(...this.ankleSpread) / meanScale) * 100) / 100; // 0~ (배수)
    }

    const kL = stat(this.kneeL);
    const kR = stat(this.kneeR);
    const pd = stat(this.pelvicDrop);

    // [골반 낙하 판정 2026-09-14] pelvicDropAbs(좌우 진폭)를 GAIT_TUNING 임계값과
    // 비교해 후면뷰 Trendelenburg 의심 여부를 플래그한다. 어느 쪽이 더 처졌는지는
    // pd.max(왼쪽이 낮음 쪽 극값, 부호 +)와 pd.min(오른쪽이 낮음 쪽 극값, 부호 -)
    // 중 절대값이 큰 쪽으로 판정 — pelvicDrop 정의(lm[23].y - lm[24].y, 부호 좌-우)
    // 그대로 재사용. side는 "더 처진 쪽"을 가리킬 뿐, 어느 근육이 약한지는 임상
    // 해석 몫으로 남겨둔다(반대측 지지기 abductor 약화가 통상적 해석).
    const T = GAIT_TUNING;
    const pelvicDropAbs = round1(Math.abs(pd.max - pd.min));
    const dropLeftMag = Math.max(0, pd.max);
    const dropRightMag = Math.max(0, -pd.min);
    const pelvicDropSide = (dropLeftMag === 0 && dropRightMag === 0)
      ? null
      : (dropLeftMag >= dropRightMag ? 'left' : 'right');
    // [자세측정과 표기 통일 2026-09-14] postureMath.js의 POSTURE_STATUS와 같은
    // 3단계 문자열('normal'/'caution'/'risk')을 쓴다 — 앱 전체에서 같은 의미의
    // 값이 화면마다 다른 이름(warn/flag 등)으로 나오지 않게.
    const pelvicDropLevel = pelvicDropAbs >= T.pelvicDropFlagPct ? POSTURE_STATUS.RISK
      : pelvicDropAbs >= T.pelvicDropWarnPct ? POSTURE_STATUS.CAUTION
      : POSTURE_STATUS.NORMAL;

    // [광각/실조성 보행 판정 2026-09-14] ankleSpread 최대값(위 strideToHeight와
    // 같은 원시값)을 신장 대비 %로 환산 — 후면·정면뷰에서만 "보폭 너비" 의미를
    // 갖는다(측면뷰에서는 보폭 길이라 stepWidthWarnPct 기준을 적용하면 안 된다.
    // 호출부에서 orientation별로 골라 쓸 것).
    const stepWidthPct = (this.ankleSpread.length && meanScale)
      ? round1((Math.max(...this.ankleSpread) / meanScale) * 100)
      : null;
    const stepWidthLevel = stepWidthPct == null ? POSTURE_STATUS.NORMAL
      : stepWidthPct >= T.stepWidthFlagPct ? POSTURE_STATUS.RISK
      : stepWidthPct >= T.stepWidthWarnPct ? POSTURE_STATUS.CAUTION
      : POSTURE_STATUS.NORMAL;

    // [가위걸음 판정 2026-09-14] 무릎-골반 좌우 순서가 뒤집힌(교차) 프레임의 비율.
    const scissorPct = this._scissorCheckFrames
      ? round1((this._scissorFrames / this._scissorCheckFrames) * 100)
      : null;
    const scissorLevel = scissorPct == null ? POSTURE_STATUS.NORMAL
      : scissorPct >= T.scissorFlagPct ? POSTURE_STATUS.RISK
      : scissorPct >= T.scissorWarnPct ? POSTURE_STATUS.CAUTION
      : POSTURE_STATUS.NORMAL;

    // [교차보행(Crossover gait) 판정 2026-09-14] 발목-골반 좌우 순서가 뒤집힌
    // (교차 착지) 프레임의 비율.
    const crossoverPct = this._crossoverCheckFrames
      ? round1((this._crossoverFrames / this._crossoverCheckFrames) * 100)
      : null;
    const crossoverLevel = crossoverPct == null ? POSTURE_STATUS.NORMAL
      : crossoverPct >= T.crossoverFlagPct ? POSTURE_STATUS.RISK
      : crossoverPct >= T.crossoverWarnPct ? POSTURE_STATUS.CAUTION
      : POSTURE_STATUS.NORMAL;

    // [팔 크로스바디 스윙 판정 2026-09-14] 손목-어깨 좌우 순서가 뒤집힌
    // (팔이 정중선을 넘어감) 프레임의 비율.
    const armCrossPct = this._armCrossCheckFrames
      ? round1((this._armCrossFrames / this._armCrossCheckFrames) * 100)
      : null;
    const armCrossLevel = armCrossPct == null ? POSTURE_STATUS.NORMAL
      : armCrossPct >= T.armCrossFlagPct ? POSTURE_STATUS.RISK
      : armCrossPct >= T.armCrossWarnPct ? POSTURE_STATUS.CAUTION
      : POSTURE_STATUS.NORMAL;

    // [발 진행각(Toe-out/Toe-in) 판정 2026-09-14] 좌/우 각각 평균을 신장 대비
    // %로 정규화 — 양수=toe-out(바깥으로 벌어짐), 음수=toe-in(안쪽으로 모임).
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const toeAvgL = avg(this.toeAngleL);
    const toeAvgR = avg(this.toeAngleR);
    const toeOutPctL = (toeAvgL != null && meanScale) ? round1((toeAvgL / meanScale) * 100) : null;
    const toeOutPctR = (toeAvgR != null && meanScale) ? round1((toeAvgR / meanScale) * 100) : null;
    let toeSide = null, toeDirection = null, toeWorstPct = null;
    const magL = toeOutPctL != null ? Math.abs(toeOutPctL) : -1;
    const magR = toeOutPctR != null ? Math.abs(toeOutPctR) : -1;
    if (magL >= 0 || magR >= 0) {
      if (magL >= magR && magL >= 0) { toeSide = 'left'; toeWorstPct = toeOutPctL; }
      else if (magR >= 0) { toeSide = 'right'; toeWorstPct = toeOutPctR; }
      if (toeWorstPct != null) toeDirection = toeWorstPct >= 0 ? 'out' : 'in';
    }
    const toeWorstMag = toeWorstPct != null ? Math.abs(toeWorstPct) : null;
    const toeAngleLevel = toeWorstMag == null ? POSTURE_STATUS.NORMAL
      : toeWorstMag >= T.toeAngleFlagPct ? POSTURE_STATUS.RISK
      : toeWorstMag >= T.toeAngleWarnPct ? POSTURE_STATUS.CAUTION
      : POSTURE_STATUS.NORMAL;

    return {
      // Kinematic
      trunkLean: stat(this.trunkLean),                 // 몸통 전방 기울기(도)
      kneeFlexion: {                                   // 무릎 굽힘(도) 좌/우
        left: kL, right: kR,
        // 최대 굽힘 = 측정 중 가장 작은 각(가장 깊게 굽힌 순간)
        leftMaxFlex: kL.min, rightMaxFlex: kR.min,
        // 착지 각도 추정 = 측정 중 가장 큰 각(가장 펴진 = 접지 직전)
        leftStrike: kL.max, rightStrike: kR.max,
      },
      // Symmetry
      pelvicDrop: pd,                                  // 골반 드롭(% 신장 대비, 부호 좌-우)
      pelvicDropAbs,                                   // 좌우 진폭(비대칭 크기) — 기존 필드 유지
      // [골반 낙하 판정 2026-09-14] 후면뷰 전용 — 정면/측면 촬영에서는 이 골반
      // y좌표 차이가 지지기와 무관한 노이즈라 side/level 해석에 의미가 없다.
      // 호출부(리포트 화면)에서 orientation==='back'일 때만 노출할 것.
      pelvicDropAssessment: {
        side: pelvicDropSide,        // 'left' | 'right' | null — 더 많이 처진 쪽
        amplitudePct: pelvicDropAbs,
        level: pelvicDropLevel,      // 'normal' | 'caution' | 'risk' (POSTURE_STATUS)
        warnPct: T.pelvicDropWarnPct,
        flagPct: T.pelvicDropFlagPct,
      },
      // [광각/실조성 보행 판정 2026-09-14] 후면·정면뷰 전용 — 측면 촬영에서는
      // strideToHeight(보폭 길이) 의미이므로 호출부에서 orientation==='back'|'front'
      // 일 때만 노출할 것.
      stepWidthAssessment: {
        widthPct: stepWidthPct,
        level: stepWidthLevel,       // 'normal' | 'caution' | 'risk'
        warnPct: T.stepWidthWarnPct,
        flagPct: T.stepWidthFlagPct,
      },
      // [가위걸음 판정 2026-09-14] 후면·정면뷰 전용 — 측면 촬영에서는 무릎-골반
      // 좌우 순서 관계가 교차가 아니라 보폭(전후) 잡음이라 의미가 없다.
      scissoringAssessment: {
        crossedPct: scissorPct,
        level: scissorLevel,         // 'normal' | 'caution' | 'risk'
        warnPct: T.scissorWarnPct,
        flagPct: T.scissorFlagPct,
      },
      // [교차보행(Crossover gait) 판정 2026-09-14] 후면·정면뷰 전용 — 측면
      // 촬영에서는 발목-골반 좌우 순서 관계가 교차가 아니라 보폭(전후) 잡음이라
      // 의미가 없다(scissoringAssessment와 동일 원칙).
      crossoverAssessment: {
        crossedPct: crossoverPct,
        level: crossoverLevel,       // 'normal' | 'caution' | 'risk'
        warnPct: T.crossoverWarnPct,
        flagPct: T.crossoverFlagPct,
      },
      // [팔 크로스바디 스윙 판정 2026-09-14] 후면·정면뷰 전용 — 측면 촬영에서는
      // 손목-어깨 좌우 순서 관계가 크로스바디 스윙이 아니라 팔 전후 스윙(잡음)이라
      // 의미가 없다(scissoringAssessment/crossoverAssessment와 동일 원칙).
      armCrossAssessment: {
        crossedPct: armCrossPct,
        level: armCrossLevel,        // 'normal' | 'caution' | 'risk'
        warnPct: T.armCrossWarnPct,
        flagPct: T.armCrossFlagPct,
      },
      // [발 진행각(Toe-out/Toe-in) 판정 2026-09-14] 후면·정면뷰 전용 — 측면
      // 촬영에서는 발목→발끝 벡터의 x성분이 진행각이 아니라 발 길이(깊이) 잡음이라
      // 의미가 없다. leftPct/rightPct: 양수=toe-out, 음수=toe-in(신장 대비 %,
      // 실제 3D 진행각(도)이 아닌 2D 투영 근사치 — 참고용).
      toeAngleAssessment: {
        leftPct: toeOutPctL,
        rightPct: toeOutPctR,
        side: toeSide,                // 'left' | 'right' | null — 더 뚜렷한 쪽
        direction: toeDirection,      // 'out' | 'in' | null
        level: toeAngleLevel,         // 'normal' | 'caution' | 'risk'
        warnPct: T.toeAngleWarnPct,
        flagPct: T.toeAngleFlagPct,
      },
      verticalOscillation,                             // 수직 진폭 비율(%)
      // 좌우 무릎 대칭(%): 100 = 완전 대칭
      kneeSymmetry: (kL.avg && kR.avg)
        ? Math.round((1 - Math.abs(kL.avg - kR.avg) / ((kL.avg + kR.avg) / 2)) * 1000) / 10
        : 0,
      // Spatial
      strideToHeight,                                  // 보폭/신장 비율
    };
  }
}

const round1 = (n) => Math.round(n * 10) / 10;

// ════════════════════════════════════════════════════════════════════════
//  DynamicKneeAlignmentTracker — 정면뷰 동적 무릎 정렬(외반/내반) 추적
//  [2026-09-14] 새로 만들지 않고 postureMath.js의 classifyLegAlignment()를
//  그대로 재사용한다 — 정적 자세측정에서 이미 검증된 임계값(X다리 valgusIndex
//  0.22/0.35, O다리 varusIndex 0.2/0.32)과 한국어 메시지를 보행/러닝에도 동일
//  적용. 자세측정과 다른 점은 "정지 자세 1회 판정"이 아니라 "녹화 전체 프레임
//  중 가장 심한 순간(peak)"을 잡는다는 것 — 동적 외반은 입각기 순간에만 짧게
//  나타나므로 평균을 내면 씻겨 나간다.
//  정면뷰 촬영에서만 의미 있다 — 측면/후면에서는 좌우 무릎이 겹쳐 보여
//  kneeWidth/ankleWidth 자체가 신뢰할 수 없다(호출부에서 orientation==='front'
//  일 때만 쓸 것).
// ════════════════════════════════════════════════════════════════════════
export class DynamicKneeAlignmentTracker {
  constructor() {
    this.maxValgusIndex = 0;
    this.maxVarusIndex = 0;
    this.worstStatus = POSTURE_STATUS.NORMAL;
    this.worstKey = null;
    this.frames = 0;
    this.flaggedFrames = 0; // caution 이상이었던 프레임 수(대략적 지속 비율 참고용)
  }

  push(lm) {
    const result = classifyLegAlignment(lm);
    if (!result) return null;
    this.frames += 1;

    if (result.key === 'genu_valgum' && result.value != null) {
      this.maxValgusIndex = Math.max(this.maxValgusIndex, result.value);
    }
    if (result.key === 'genu_varum' && result.value != null) {
      this.maxVarusIndex = Math.max(this.maxVarusIndex, result.value);
    }

    if (result.status !== POSTURE_STATUS.NORMAL) {
      this.flaggedFrames += 1;
      const rank = { [POSTURE_STATUS.NORMAL]: 0, [POSTURE_STATUS.CAUTION]: 1, [POSTURE_STATUS.RISK]: 2 };
      if (rank[result.status] > rank[this.worstStatus]) {
        this.worstStatus = result.status;
        this.worstKey = result.key;
      }
    }
    return result;
  }

  summary() {
    return {
      status: this.worstStatus,                 // 'normal' | 'caution' | 'risk'
      key: this.worstKey,                       // 'genu_valgum' | 'genu_varum' | null
      maxValgusIndex: round1(this.maxValgusIndex),
      maxVarusIndex: round1(this.maxVarusIndex),
      flaggedFramePct: this.frames ? round1((this.flaggedFrames / this.frames) * 100) : 0,
      frames: this.frames,
    };
  }
}
