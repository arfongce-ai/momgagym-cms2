// ai-measure/core/jumpBiomechanics.js
// ════════════════════════════════════════════════════════════════════════
//  점프 분석 핵심 로직 (순수 함수/클래스 — 단위 테스트 가능)
//  gaitBiomechanics.js 와 동일한 설계 철학:
//   · 현장 튜닝 상수를 JUMP_TUNING 한 곳에 모음 (데이터 쌓이면 이 값만 조정)
//   · 1-Euro 평활 재사용 (검출 떨림 제거)
//   · valid 플래그로 무효 측정 원천 차단 (gait 의 validMinAmp/validMinSteps 와 동형)
//
//  측정 원리 — "비행시간(flight time) 기반" + "골반 변위 교차검증":
//   (1) 주측정: 발(발목 27/28)이 '서 있는 기준선(baseline)'을 떠난 시각(takeoff)과
//       다시 돌아온 시각(landing)의 *실측 타임스탬프 차이* t 로
//         h = g·t²/8   (이륙·착지 높이 동일 가정의 표준식)
//       → 프레임 '개수'가 아니라 ms 타임스탬프로 계산하므로 VFR/드롭/실제 fps
//         오차를 자동 흡수한다. (videoAnalyzer 가 슬로모 보정한 tMs 를 그대로 받음)
//   (2) 교차검증: 같은 구간 골반(23/24) 중점의 수직 변위(정점-기준선)를
//       '서 있는 자세에서 측정한 px↔cm 스케일'로 환산해 독립적으로 높이를 추정.
//       두 값이 JUMP_TUNING.crossTolPct 이상 어긋나면 측정 신뢰도를 떨어뜨린다.
//   (3) sanity: 회원 키(cm) 기준으로 물리적으로 말이 되는 범위인지 점검.
// ════════════════════════════════════════════════════════════════════════

import { OneEuroFilter, angleAt, detectOrientation } from './gaitBiomechanics';

const G = 9.81;

// ───────── 현장 튜닝 설정 (한 곳에 모음) ─────────
// "정상인데 무효" → minVisibility/standStillTolY/minFlightMs 낮추기
// "이상한데 통과" → 위 값 + crossTolPct 조이기
// "이륙/착지 시점이 튐" → filterMinCutoff/Beta, liftoffBandFrac 조정
export const JUMP_TUNING = {
  minVisibility: 0.3,        // 관절 가시성 하한 (이하면 캘리브레이션/검출 제외)
  filterMinCutoff: 1.2,      // 1-Euro 평활 강도 (낮을수록 더 부드럽게)
  filterBeta: 0.02,          // 1-Euro 반응성

  // ── 캘리브레이션(서 있는 자세) ──
  calibMinFrames: 8,         // 기준선 확정에 필요한 최소 안정 프레임 수
  calibMaxStdY: 0.012,       // 서 있는 동안 발 y 표준편차 상한(정규화). 넘으면 불안정
  calibMinVisRatio: 0.8,     // 캘리브레이션 프레임 중 관절 가시 비율 하한

  // ── 이륙/착지 검출 ──
  // 발 신호는 살짝만 평활(이륙·착지 전환을 날카롭게 유지). 과평활 시 체공이 짧게 측정됨.
  feetFilterMinCutoff: 6.0,  // 발 검출용 1-Euro (gait 보다 높게 = 덜 평활)
  feetFilterBeta: 0.05,
  liftoffBandFrac: 0.04,     // 기준선에서 이만큼(정규화 y) 위로 뜨면 '공중'으로 판정
  minFlightMs: 120,          // 이보다 짧은 체공은 노이즈로 간주(무효)
  maxFlightMs: 1500,         // 이보다 길면 검출 오류로 간주(무효)

  // ── 교차검증 ──
  crossTolPct: 25,           // 비행시간 높이 vs 골반변위 높이 허용 불일치(%)
  // ── 물리적 sanity (회원 키 대비) ──
  maxHeightToBodyRatio: 0.85,// 점프 높이가 키의 이 비율을 넘으면 비현실적(검출 오류)

  // ── Triple Extension 신전 임계(도) ── 이지 직전 세 관절이 거의 펴졌는지
  //   고관절/무릎은 신뢰, 발목은 참고. 현장 데이터로 조정 대상.
  tripleExtension: {
    hipMinDeg: 160,   // 고관절 신전 임계 (작을수록 관대)
    kneeMinDeg: 160,  // 무릎 신전 임계
    ankleMinDeg: 140, // 발목(plantarflexion) — BlazePose 한계로 관대하게
  },
};

// 두 발(발목)의 평균 y. 화면 좌표는 아래로 갈수록 y 증가 → 점프하면 y 감소.
// 발목(27/28)은 모션블러에 강해 gait 와 동일하게 1순위로 쓴다.
export const feetCenterY = (lm) => {
  if (!lm || !lm[27] || !lm[28]) return null;
  const v = JUMP_TUNING.minVisibility;
  const okL = lm[27].visibility == null || lm[27].visibility >= v;
  const okR = lm[28].visibility == null || lm[28].visibility >= v;
  if (!okL && !okR) return null;
  if (okL && okR) return (lm[27].y + lm[28].y) / 2;
  return okL ? lm[27].y : lm[28].y; // 한쪽만 보이면 그쪽 사용 (blur 관용)
};

// 골반(23/24) 중점 y — 교차검증용 수직 변위 신호.
export const pelvisCenterY = (lm) => {
  if (!lm || !lm[23] || !lm[24]) return null;
  const v = JUMP_TUNING.minVisibility;
  const okL = lm[23].visibility == null || lm[23].visibility >= v;
  const okR = lm[24].visibility == null || lm[24].visibility >= v;
  if (!okL && !okR) return null;
  return (lm[23].y + lm[24].y) / 2;
};

// 서 있는 자세 전신 픽셀 높이(정규화): 정수리(0) ~ 발목 중점.
// 요구사항대로 '정수리(0)와 발끝(27/28)'을 쓰되, 발끝(31/32)은 blur 로 자주
// 소실되므로 발목(27/28)을 기준으로 둔다(없으면 발끝 보조).
export const bodyPixelHeight = (lm) => {
  if (!lm || !lm[0] || !lm[27] || !lm[28]) return null;
  const v = JUMP_TUNING.minVisibility;
  if (lm[0].visibility != null && lm[0].visibility < v) return null;
  const headY = lm[0].y;
  const ankY = feetCenterY(lm);
  if (ankY == null) return null;
  const h = Math.abs(ankY - headY);
  return h > 0.05 ? h : null; // 너무 작으면(전신 미포함) 무효
};

// ════════════════════════════════════════════════════════════════════════
//  StandingCalibrator — 첫 N프레임의 '서 있는 자세'로 기준선 + 스케일 확정
//   요구사항 1: 측정 시작 시 키(height) 데이터로 px↔cm 스케일 자동 산출
//   요구사항 3: 자세 불안정(가시성↓ / 흔들림↑)이면 ok=false → "올바르게 서 주세요"
// ════════════════════════════════════════════════════════════════════════
export class StandingCalibrator {
  constructor({ heightCm = null } = {}) {
    this.heightCm = heightCm && heightCm > 0 ? Number(heightCm) : null;
    this._feetY = [];
    this._pelvisY = [];
    this._bodyPx = [];
    this._frames = 0;
    this._visFrames = 0;
    this.locked = false;
    this.result = null;
  }

  // 프레임마다 호출. 충분히 안정되면 lock() 되어 result 를 채운다.
  push(lm) {
    if (this.locked) return;
    this._frames++;
    const fY = feetCenterY(lm);
    const pY = pelvisCenterY(lm);
    const bPx = bodyPixelHeight(lm);
    if (fY != null && pY != null && bPx != null) {
      this._visFrames++;
      this._feetY.push(fY);
      this._pelvisY.push(pY);
      this._bodyPx.push(bPx);
    }
    if (this._feetY.length >= JUMP_TUNING.calibMinFrames) this._tryLock();
  }

  _tryLock() {
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const std = (a) => {
      const m = mean(a);
      return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
    };
    const visRatio = this._frames ? this._visFrames / this._frames : 0;
    const feetStd = std(this._feetY);
    // 불안정 판정: 가시 비율 부족 OR 발 흔들림 과다
    const stable = visRatio >= JUMP_TUNING.calibMinVisRatio
      && feetStd <= JUMP_TUNING.calibMaxStdY;
    if (!stable) {
      // 슬라이딩 윈도우: 오래된 샘플을 버리고 계속 재시도(자세 교정 시간 부여)
      this._feetY.shift(); this._pelvisY.shift(); this._bodyPx.shift();
      return;
    }
    const baselineFeetY = mean(this._feetY);
    const baselinePelvisY = mean(this._pelvisY);
    const bodyPx = mean(this._bodyPx);
    // px↔cm 스케일: 실제 키(cm) / 화면상 픽셀 높이(정규화). 키 없으면 null.
    const scaleCmPerY = this.heightCm ? this.heightCm / bodyPx : null;
    this.result = { baselineFeetY, baselinePelvisY, bodyPx, scaleCmPerY, feetStd, visRatio };
    this.locked = true;
  }

  // 진행 상태(UI 표시용). reason 으로 경고 문구를 분기한다.
  status() {
    if (this.locked) return { ready: true, progress: 1, reason: 'ok' };
    const visRatio = this._frames ? this._visFrames / this._frames : 0;
    const progress = Math.min(0.99, this._feetY.length / JUMP_TUNING.calibMinFrames);
    let reason = 'arming';
    if (this._frames > JUMP_TUNING.calibMinFrames && visRatio < JUMP_TUNING.calibMinVisRatio) {
      reason = 'low_visibility'; // 관절이 잘 안 잡힘 → "올바르게 서 주세요"
    }
    return { ready: false, progress, reason };
  }
}

// ════════════════════════════════════════════════════════════════════════
//  JumpFlightTracker — 캘리브레이션 후 프레임을 흘려보내며 점프 1회를 검출
//   · 발이 baseline 보다 liftoffBand 만큼 뜨면 takeoff, 다시 내려오면 landing
//   · takeoff/landing 의 *실측 ms 타임스탬프* 차이로 비행시간 → 높이
//   · 같은 구간 골반 변위로 교차검증
// ════════════════════════════════════════════════════════════════════════
export class JumpFlightTracker {
  constructor(calib, {
    minCutoff = JUMP_TUNING.feetFilterMinCutoff,
    beta = JUMP_TUNING.feetFilterBeta,
  } = {}) {
    this.calib = calib;                 // StandingCalibrator.result
    this.band = JUMP_TUNING.liftoffBandFrac;
    this._filtFeet = new OneEuroFilter({ minCutoff, beta, dCutoff: 1.0 });
    this.inAir = false;
    this.takeoffMs = null;
    this.landingMs = null;
    // 공중 구간 골반 최고점(가장 작은 y = 가장 높이) 추적 → 변위 교차검증
    this._pelvisPeakY = Infinity;
    this._pelvisBaseY = calib?.baselinePelvisY ?? null;
    this.flights = []; // [{ takeoffMs, landingMs, flightMs, pelvisRiseY }]
  }

  push(lm, tMs) {
    if (!this.calib) return;
    const fYraw = feetCenterY(lm);
    if (fYraw == null) return;
    const fY = this._filtFeet.filter(fYraw, tMs / 1000);
    const liftThreshold = this.calib.baselineFeetY - this.band; // 위로 뜨면 y 감소

    if (!this.inAir) {
      // 지면 → 공중 전환 (발이 기준선보다 band 이상 위로)
      if (fY < liftThreshold) {
        this.inAir = true;
        this.takeoffMs = tMs;
        this._pelvisPeakY = Infinity;
      }
    } else {
      // 공중 중: 골반 최고점 추적
      const pY = pelvisCenterY(lm);
      if (pY != null) this._pelvisPeakY = Math.min(this._pelvisPeakY, pY);
      // 공중 → 지면 전환 (발이 기준선 band 안으로 복귀).
      // 이륙과 동일한 band 임계를 써서 1-Euro 평활의 상승/하강 지연을
      // 대칭으로 만든다(체공시간 편향 최소화).
      if (fY >= this.calib.baselineFeetY - this.band) {
        this.landingMs = tMs;
        const flightMs = this.landingMs - this.takeoffMs;
        const pelvisRiseY = (this._pelvisBaseY != null && this._pelvisPeakY < Infinity)
          ? Math.max(0, this._pelvisBaseY - this._pelvisPeakY) : null;
        if (flightMs >= JUMP_TUNING.minFlightMs && flightMs <= JUMP_TUNING.maxFlightMs) {
          this.flights.push({ takeoffMs: this.takeoffMs, landingMs: this.landingMs, flightMs, pelvisRiseY });
        }
        this.inAir = false;
        this.takeoffMs = null;
      }
    }
  }

  // 최고 점프 1회를 골라 결과 산출. 무효면 valid:false.
  summary({ heightCm = null } = {}) {
    const calib = this.calib;
    if (!this.flights.length) {
      return { valid: false, reason: 'no_jump', jumps: 0 };
    }
    // 가장 긴 체공(=가장 높은 점프) 채택
    const best = this.flights.reduce((a, b) => (b.flightMs > a.flightMs ? b : a));
    const t = best.flightMs / 1000;
    const heightFlight = (G * t * t) / 8;          // m (주측정)
    const heightFlightCm = Math.round(heightFlight * 1000) / 10;
    const takeoffVel = (G * t) / 2;

    // 교차검증: 골반 변위(정규화 y) × px↔cm 스케일
    let heightCrossCm = null, crossDeltaPct = null, crossOk = null;
    if (best.pelvisRiseY != null && calib?.scaleCmPerY) {
      heightCrossCm = Math.round(best.pelvisRiseY * calib.scaleCmPerY * 10) / 10;
      if (heightFlightCm > 0) {
        crossDeltaPct = Math.round(Math.abs(heightCrossCm - heightFlightCm) / heightFlightCm * 1000) / 10;
        crossOk = crossDeltaPct <= JUMP_TUNING.crossTolPct;
      }
    }

    // 물리적 sanity (회원 키 대비)
    const bodyCm = heightCm || this.calibHeightCm || null;
    let sanityOk = true;
    if (bodyCm) sanityOk = heightFlightCm <= bodyCm * JUMP_TUNING.maxHeightToBodyRatio;

    // 유효 판정: 체공시간(주측정) + 물리적 sanity 만으로 결정.
    // 골반변위 교차검증은 카메라 거리/각도/원근 왜곡으로 구조적 오차가 커
    //  (정규화 픽셀 변위에 전신 스케일을 적용 → 1:1 전이 불가),
    //  pass/fail 게이트가 아니라 '참고 표시값'으로만 둔다.
    //  (front-view / 픽셀스케일 높이를 신뢰하지 않는 기존 결론과 동일 철학)
    const valid = sanityOk;

    return {
      valid,
      reason: !sanityOk ? 'sanity_fail' : 'ok',
      jumps: this.flights.length,
      flightTimeMs: Math.round(best.flightMs),
      flightTimeSec: Math.round(t * 1000) / 1000,
      heightCm: heightFlightCm,              // 주 결과(비행시간 기반)
      takeoffVelocity: Math.round(takeoffVel * 100) / 100,
      crossCheck: {
        heightCrossCm,                       // 골반 변위 기반 추정
        deltaPct: crossDeltaPct,             // 두 방식 불일치(%)
        agree: crossOk,                      // null=검증 불가, true/false
      },
      sanityOk,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════
//  [고도화] JumpBiomechAccumulator — 프레임마다 push, 끝에 summary()
//   보행의 BiomechAccumulator 와 같은 인터페이스(push/summary).
//   위상(phase)별로 지표를 잡는다: 'stand'(준비) | 'air'(공중) | 'land'(착지 직후).
//   위상은 JumpFlightTracker 가 inAir 상태로 알려주므로, 측정 루프에서
//   tracker.inAir 를 보고 phase 를 넘겨 주면 된다(아래 buildJumpReport 참고).
//
//  ⚠ 신뢰 등급(리포트에 그대로 노출):
//    'core'   = 비교적 신뢰(측면뷰 기준). 점프높이/체공/무릎각도/상체기울기/골반.
//    'ref'    = 참고용. Triple Extension(발목 신전 BlazePose 정확도 한계).
//    'limit'  = 제약 큼. 좌우 '체중' 분산은 카메라로 불가 → 기하학적 대칭으로 대체.
// ════════════════════════════════════════════════════════════════════════

const _v = (p) => p && (p.visibility == null || p.visibility >= JUMP_TUNING.minVisibility);
const _dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

// 상체 전방 기울기(도): 어깨중점→골반중점 벡터와 수직선의 각. 0=직립.
const _trunkLean = (lm) => {
  if (!lm || !_v(lm[11]) || !_v(lm[12]) || !_v(lm[23]) || !_v(lm[24])) return null;
  const sh = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
  const hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
  const vx = sh.x - hip.x, vy = sh.y - hip.y;
  if (Math.sqrt(vx * vx + vy * vy) < 1e-6) return null;
  return Math.round(Math.atan2(Math.abs(vx), Math.abs(vy)) * (180 / Math.PI) * 10) / 10;
};

// 좌우 무릎 굽힘 각도(고관절-무릎-발목). 180=완전 신전, 작을수록 깊게 굽힘.
const _knees = (lm) => ({
  left: angleAt(lm[23], lm[25], lm[27]),
  right: angleAt(lm[24], lm[26], lm[28]),
});

// 좌우 발목(plantarflexion) 각도(무릎-발목-발끝). 참고용(BlazePose 발끝 정확도 낮음).
const _ankles = (lm) => ({
  left: angleAt(lm[25], lm[27], lm[31]),
  right: angleAt(lm[26], lm[28], lm[32]),
});

// 좌우 고관절 각도(어깨-고관절-무릎).
const _hips = (lm) => ({
  left: angleAt(lm[11], lm[23], lm[25]),
  right: angleAt(lm[12], lm[24], lm[26]),
});

// 골반 좌우 높이차(정규화 y, 부호 좌-우). 신장으로 정규화해 % 로.
const _pelvicTilt = (lm, scale) => {
  if (!lm || !_v(lm[23]) || !_v(lm[24]) || !scale) return null;
  return Math.round(((lm[23].y - lm[24].y) / scale) * 1000) / 10;
};

export class JumpBiomechAccumulator {
  constructor({ heightCm = null } = {}) {
    this.heightCm = heightCm;
    this.stand = { trunkLean: [], pelvicTilt: [] };
    this.air = { trunkLean: [] };
    this.land = { kneeL: [], kneeR: [], trunkLean: [], footL: [], footR: [] };
    // 이지 접근(takeoff approach) 구간: 신전 '궤적'을 보기 위한 시퀀스(시간순)
    this.approach = { hip: [], knee: [], ankle: [] };
    this._scaleSum = 0; this._scaleN = 0;
    // 촬영 방향 투표 (프레임마다 detectOrientation → 다수결)
    this._viewVotes = { side: 0, back: 0, unknown: 0 };
  }

  get bodyScale() { return this._scaleN ? this._scaleSum / this._scaleN : null; }

  // phase: 'stand' | 'air' | 'land'. justTookOff: 이지 직후 프레임이면 true.
  push(lm, tMs, phase, justTookOff = false) {
    if (!lm) return;
    // 신장 스케일(어깨~발목 y거리)
    if (lm[11] && lm[12] && lm[27] && lm[28]) {
      const s = Math.abs(((lm[27].y + lm[28].y) / 2) - ((lm[11].y + lm[12].y) / 2));
      if (s > 0.05) { this._scaleSum += s; this._scaleN++; }
    }
    const scale = this.bodyScale;

    // 촬영 방향 투표 (준비/착지 등 안정 구간에서만 — 공중은 자세 왜곡)
    if (phase !== 'air') {
      const o = detectOrientation(lm);
      this._viewVotes[o.view] = (this._viewVotes[o.view] || 0) + 1;
    }

    if (phase === 'stand') {
      const tl = _trunkLean(lm); if (tl != null) this.stand.trunkLean.push(tl);
      const pt = _pelvicTilt(lm, scale); if (pt != null) this.stand.pelvicTilt.push(pt);
      // 이지 접근 시퀀스: 준비 후반(앉았다 펴는 구간)의 각도 추이를 모은다
      const hp = _hips(lm), kn = _knees(lm), an = _ankles(lm);
      const hipAvg = _avg2(hp.left, hp.right);
      const kneeAvg = _avg2(kn.left, kn.right);
      const ankAvg = _avg2(an.left, an.right);
      if (hipAvg != null) this.approach.hip.push(hipAvg);
      if (kneeAvg != null) this.approach.knee.push(kneeAvg);
      if (ankAvg != null) this.approach.ankle.push(ankAvg);
    } else if (phase === 'air') {
      const tl = _trunkLean(lm); if (tl != null) this.air.trunkLean.push(tl);
    } else if (phase === 'land') {
      const kn = _knees(lm);
      if (kn.left != null) this.land.kneeL.push(kn.left);
      if (kn.right != null) this.land.kneeR.push(kn.right);
      const tl = _trunkLean(lm); if (tl != null) this.land.trunkLean.push(tl);
      // 착지 발 위치 (좌/우) — blur 대비 여러 프레임 모아 중앙값 사용
      const fl = _footPos(lm, 27, 31);
      const fr = _footPos(lm, 28, 32);
      if (fl) this.land.footL.push(fl);
      if (fr) this.land.footR.push(fr);
    }
  }

  detectedView() {
    const { side, back } = this._viewVotes;
    if (side === 0 && back === 0) return 'unknown';
    return side >= back ? 'side' : 'back';
  }

  summary() {
    const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    const r1 = (n) => n == null ? null : Math.round(n * 10) / 10;
    const minOf = (a) => a.length ? Math.min(...a) : null;
    const maxOf = (a) => a.length ? Math.max(...a) : null;
    const view = this.detectedView();
    const scale = this.bodyScale;

    // ── 자세 및 기술 (측면뷰 전용) ──
    const landKneeL = minOf(this.land.kneeL);
    const landKneeR = minOf(this.land.kneeR);
    const landKnee = (landKneeL != null && landKneeR != null)
      ? r1((landKneeL + landKneeR) / 2) : (r1(landKneeL) ?? r1(landKneeR));

    const standLean = mean(this.stand.trunkLean);
    const landLean = mean(this.land.trunkLean);
    const trunkLeanChange = (standLean != null && landLean != null)
      ? r1(Math.abs(landLean - standLean)) : null;

    // 신전 궤적 정렬도 (Extension Alignment) — 절대 발목각 대신 궤적 정렬에 초점
    const alignment = computeExtensionAlignment(
      this.approach.hip, this.approach.knee, this.approach.ankle
    );

    // ── 대칭성 및 안정성 ──
    // 골반 불균형(정면뷰에서 신뢰)
    const pelvicVals = this.stand.pelvicTilt;
    const pelvicImbalance = pelvicVals.length
      ? r1(Math.abs((maxOf(pelvicVals) ?? 0) - (minOf(pelvicVals) ?? 0))) : null;

    // 착지 발끝 대칭성 (force plate 대체) — 양쪽 뷰 모두 의미
    const footSym = computeFootLandingSymmetry(this.land.footL, this.land.footR, scale, view);

    // 뷰별 지표 활성 여부 (리포트 가이드라인 표시에 사용)
    const enabled = {
      view,
      posture: view === 'side',          // 자세/기술 = 측면 전용
      pelvicDrop: view === 'back',       // 골반 불균형 = 정면 전용
      footSymmetry: footSym.available,   // 발끝 대칭 = 양쪽 가능
    };

    return {
      view,
      enabled,
      // 자세 및 기술 (측면 전용)
      landingKneeAngle: landKnee,
      landingKneeLeft: r1(landKneeL),
      landingKneeRight: r1(landKneeR),
      trunkLeanStand: r1(standLean),
      trunkLeanChange,
      extensionAlignment: alignment,      // 신전 궤적 정렬도
      // 대칭성 및 안정성
      pelvicImbalance,                    // 정면 전용
      footLandingSymmetry: footSym,       // 착지 발끝 대칭 (force plate 대체)
    };
  }
}

// 두 값 평균 (null 안전)
const _avg2 = (a, b) => {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
};

// 측정 루프에서 위상 판정을 쉽게 하기 위한 헬퍼.
// 직전 inAir 와 현재 inAir 를 비교해 phase 와 justTookOff/justLanded 를 만든다.
export function jumpPhaseOf(prevInAir, curInAir, landWindowActive) {
  const justTookOff = !prevInAir && curInAir;
  const justLanded = prevInAir && !curInAir;
  let phase = 'stand';
  if (curInAir) phase = 'air';
  else if (landWindowActive) phase = 'land'; // 착지 직후 N프레임
  return { phase, justTookOff, justLanded };
}

// ════════════════════════════════════════════════════════════════════════
//  [재설계] 측정 가능한 지표로 교체
// ════════════════════════════════════════════════════════════════════════

// 발 위치(발목+발끝 평균). 발끝(31/32)이 blur 로 소실되면 발목만 사용.
const _footPos = (lm, ankleIdx, toeIdx) => {
  const ank = lm[ankleIdx], toe = lm[toeIdx];
  const okA = ank && (ank.visibility == null || ank.visibility >= JUMP_TUNING.minVisibility);
  const okT = toe && (toe.visibility == null || toe.visibility >= JUMP_TUNING.minVisibility);
  if (!okA && !okT) return null;
  if (okA && okT) return { x: (ank.x + toe.x) / 2, y: (ank.y + toe.y) / 2 };
  return okA ? { x: ank.x, y: ank.y } : { x: toe.x, y: toe.y };
};

// 중앙값 (blur 이상치 제거 — gait 의 median outlier rejection 과 동일 철학)
const _median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 착지 발끝 대칭성 (Foot Landing Symmetry) — force plate 대체 지표.
 * 착지 직후 안정된 N프레임에서 좌/우 발 위치의 중앙값을 구해,
 * 두 발의 좌우(x)·앞뒤(y) 위치 차이를 화면 픽셀(정규화) 거리로 평가한다.
 *  · 측면뷰: y(앞뒤) 차이가 핵심 — 한 발이 앞서 착지하는 비대칭
 *  · 정면뷰: x(좌우) 차이가 핵심 — 좌우 착지 폭 비대칭
 * 신장 스케일로 정규화해 % 로 환산(0%=완전 대칭).
 *
 * @param {Array} leftFrames  [{x,y}] 착지 구간 좌측 발 위치들
 * @param {Array} rightFrames [{x,y}] 착지 구간 우측 발 위치들
 * @param {number} bodyScale  신장 정규화 스케일(어깨~발목 y거리)
 * @param {'side'|'back'} view 촬영 방향
 */
export function computeFootLandingSymmetry(leftFrames, rightFrames, bodyScale, view) {
  if (!leftFrames?.length || !rightFrames?.length || !bodyScale) {
    return { available: false };
  }
  const lx = _median(leftFrames.map(p => p.x));
  const ly = _median(leftFrames.map(p => p.y));
  const rx = _median(rightFrames.map(p => p.x));
  const ry = _median(rightFrames.map(p => p.y));
  if (lx == null || rx == null) return { available: false };

  // 정규화 차이 (신장 대비 %)
  const dxPct = Math.round(Math.abs(lx - rx) / bodyScale * 1000) / 10; // 좌우
  const dyPct = Math.round(Math.abs(ly - ry) / bodyScale * 1000) / 10; // 앞뒤
  // 뷰별 '핵심 축' 차이 — 측면=앞뒤(y), 정면=좌우(x)
  const primaryAxis = view === 'side' ? 'anteroposterior' : 'mediolateral';
  const primaryDiffPct = view === 'side' ? dyPct : dxPct;
  // 대칭도 점수: 차이가 작을수록 100 에 가깝게 (10% 차이 → 0점 스케일)
  const symmetryPct = Math.max(0, Math.round((1 - Math.min(primaryDiffPct, 10) / 10) * 1000) / 10);
  // 어느 발이 앞/바깥인지 (참고)
  let leadFoot = null;
  if (view === 'side' && Math.abs(ly - ry) > 0.01) leadFoot = ly < ry ? 'left' : 'right'; // y작음=화면위=앞
  if (view !== 'side' && Math.abs(lx - rx) > 0.01) leadFoot = 'asym';

  return {
    available: true,
    view,
    primaryAxis,                 // 어느 축을 핵심으로 봤는지
    primaryDiffPct,              // 핵심 축 차이(%)
    lateralDiffPct: dxPct,       // 좌우 차이(%)
    anteroposteriorDiffPct: dyPct, // 앞뒤 차이(%)
    symmetryPct,                 // 0~100 (100=완전 대칭)
    leadFoot,                    // 'left'|'right'|'asym'|null
  };
}

/**
 * 신전 궤적 정렬도 (Extension Alignment) — 기존 Triple Extension 대체.
 * 절대 발목각의 부정확성을 피하고, '이지 구간 동안 고관절·무릎이 함께
 * 매끄럽게 펴지는가(정렬된 궤적)'에 초점을 둔다.
 *  · 이지 직전 여러 프레임의 고관절/무릎 각도 추이를 받아,
 *    (1) 두 관절이 함께 증가(신전)했는지 방향 일치도
 *    (2) 최종 신전 도달도
 *  를 결합해 0~100 정렬 점수를 낸다. 발목은 참고로만 같이 보고한다.
 *
 * @param {Array} hipSeq   이지 구간 고관절 각도 시퀀스(시간순)
 * @param {Array} kneeSeq  이지 구간 무릎 각도 시퀀스(시간순)
 * @param {Array} ankleSeq 발목(참고)
 */
export function computeExtensionAlignment(hipSeq, kneeSeq, ankleSeq = []) {
  const clean = (a) => a.filter(v => v != null && !Number.isNaN(v));
  const h = clean(hipSeq), k = clean(kneeSeq);
  if (h.length < 2 || k.length < 2) {
    return { available: false };
  }
  // (1) 방향 일치도: 인접 프레임 변화의 부호가 같은 비율(둘 다 펴지는 중인가)
  const n = Math.min(h.length, k.length);
  let agree = 0, total = 0;
  for (let i = 1; i < n; i++) {
    const dh = h[i] - h[i - 1], dk = k[i] - k[i - 1];
    if (Math.abs(dh) < 0.3 && Math.abs(dk) < 0.3) continue; // 정지 구간 무시
    total++;
    if ((dh >= 0 && dk >= 0) || (dh < 0 && dk < 0)) agree++;
  }
  const directionConsistency = total ? agree / total : 1;
  // (2) 최종 신전 도달도: 마지막 구간 평균이 신전 임계에 얼마나 근접
  const tail = (a) => a.slice(-Math.max(1, Math.round(a.length * 0.3)));
  const T = JUMP_TUNING.tripleExtension;
  const hipReach = Math.min(1, (tail(h).reduce((s, x) => s + x, 0) / tail(h).length) / T.hipMinDeg);
  const kneeReach = Math.min(1, (tail(k).reduce((s, x) => s + x, 0) / tail(k).length) / T.kneeMinDeg);
  const reach = (hipReach + kneeReach) / 2;
  // 결합 점수 (궤적 정렬 60% + 도달도 40%) — 궤적에 더 비중
  const alignmentScore = Math.round((directionConsistency * 0.6 + reach * 0.4) * 1000) / 10;

  const a = clean(ankleSeq);
  const ankleNote = a.length
    ? { finalDeg: Math.round((a.slice(-1)[0]) * 10) / 10, note: 'ref' }
    : null;

  return {
    available: true,
    alignmentScore,               // 0~100 (궤적 정렬도)
    directionConsistency: Math.round(directionConsistency * 1000) / 10, // %
    hipFinalDeg: Math.round((h.slice(-1)[0]) * 10) / 10,
    kneeFinalDeg: Math.round((k.slice(-1)[0]) * 10) / 10,
    ankle: ankleNote,             // 참고(발목 신전 도달 각, 정확도 낮음)
    quality: alignmentScore >= 80 ? 'good' : alignmentScore >= 60 ? 'fair' : 'poor',
  };
}
