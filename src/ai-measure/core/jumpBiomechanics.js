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

import { OneEuroFilter } from './gaitBiomechanics';

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

    // 유효 판정: 체공 범위 OK + (교차검증이 가능했다면 통과) + sanity OK
    const valid = sanityOk && (crossOk == null || crossOk === true);

    return {
      valid,
      reason: !sanityOk ? 'sanity_fail' : (crossOk === false ? 'cross_mismatch' : 'ok'),
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
