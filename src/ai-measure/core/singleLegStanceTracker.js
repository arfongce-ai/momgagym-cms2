// ai-measure/core/singleLegStanceTracker.js
// ════════════════════════════════════════════════════════════════════════
//  한다리서기(SLST) 프레임 추적기 — jumpBiomechanics.js의 StandingCalibrator /
//  JumpFlightTracker와 동일한 패턴(캘리브레이션 → push(lm,tMs) → summary()).
//  JumpFlightTracker가 한 영상 안에서 여러 번의 점프(flights[])를 추적하는 것과
//  동일하게, 이 추적기도 한 영상 안에서 연속된 여러 번의 시행(왼쪽 또는 오른쪽
//  다리 기준으로 최대 maxTrials회)을 자동으로 구분해 추적한다.
//
//  역할: "카메라가 본 것"(landmarks 스트림)을 singleLegStance.js가 받는
//  {trial1, trial2} 입력 형태로 바꾸기만 한다 — 정상/주의/위험 판정은 하지
//  않는다(역할 분리, singleLegStance.js의 설계 노트와 동일한 원칙).
//
//  ── 흐름(시행 1회당) ──
//   1) StandingCalibrator(jumpBiomechanics.js, 재사용)로 양발 서기 기준선 확보.
//   2) 들리는 쪽 발목이 기준선보다 liftBandFrac 이상 뜨면 → 유지(holding) 시작.
//   3) 유지 중: 지지 다리 쪽 골반 중점의 프레임간 이동을 누적(흔들림 경로),
//      좌우 골반 라인 기울기의 최대값(골반 기울기)을 추적. 골반 이동 속도가
//      급격히 튀면 균형 상실로 "추정"한다(휴리스틱, 아래 한계 참고).
//   4) 들었던 발이 기준선 근처로 다시 내려오면 → 그 시행 종료(정의상 조기
//      종료=stepOut:true). 목표 시간 도달 등으로 stopManually()가 먼저
//      호출되면 stepOut:false. 종료 후 다음 시행을 위해 자동으로 대기 상태로
//      복귀한다(최대 maxTrials회까지).
//   5) minHoldForValidMs 보다 짧은 시행(순간적인 흔들림 등 오검출)은 조용히
//      버리고 계속 다음 시행을 기다린다 — 잡음으로 판정 자체를 막지 않는다.
//
//  ⚠ 측정 한계(결과에 그대로 노출):
//   · balanceLoss는 "골반 이동 속도 급변" 휴리스틱으로 추정한 값이며, 실제
//     넘어짐·휘청임 여부를 진단하지 않는다. 라이브 측정 화면에서는 트레이너가
//     육안으로 보고 markBalanceLoss()를 직접 호출해 보완할 수 있다.
//   · 무릎 외반(kneeValgusDeg)은 이 추적기에서 계산하지 않는다(선택 신호이며
//     singleLegStance.js는 이 필드가 없어도 정상 동작한다).
// ════════════════════════════════════════════════════════════════════════

import { OneEuroFilter } from './gaitBiomechanics';
import { StandingCalibrator } from './jumpBiomechanics';

// 화면(UI)에서 캘리브레이션도 이 파일 하나만 import 하도록 재노출.
export { StandingCalibrator };

export const SLST_TRACK_TUNING = {
  liftBandFrac: 0.05,                 // 기준선 대비 이만큼(정규화 y) 뜨면 '들었다'로 판정
  minHoldForValidMs: 500,             // 이보다 짧게 들었다 내리면 오검출로 간주(조용히 폐기)
  filterMinCutoff: 1.0,
  filterBeta: 0.01,
  balanceLossVelocityThreshold: 0.35, // 골반(정규화좌표) 속도(단위/초) 이 이상이면 균형상실 추정
};

const HIP_L = 23;
const HIP_R = 24;
const ANK_L = 27;
const ANK_R = 28;

function hipMid(lm) {
  if (!lm || !lm[HIP_L] || !lm[HIP_R]) return null;
  return { x: (lm[HIP_L].x + lm[HIP_R].x) / 2, y: (lm[HIP_L].y + lm[HIP_R].y) / 2 };
}
function ankleY(lm, side) {
  const idx = side === 'left' ? ANK_L : ANK_R;
  return lm?.[idx]?.y ?? null;
}
function pelvicTiltDegOf(lm) {
  if (!lm || !lm[HIP_L] || !lm[HIP_R]) return null;
  const dy = lm[HIP_R].y - lm[HIP_L].y;
  const dx = lm[HIP_R].x - lm[HIP_L].x;
  if (!dx && !dy) return 0;
  return Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * SLST 추적기 — 한 영상(라이브 스트림 또는 업로드 영상) 안에서 한쪽 다리의
 * 연속된 여러 시행을 자동으로 구분해 최대 maxTrials개까지 모은다.
 * @param {object} calib StandingCalibrator.result (locked 이후의 result 객체)
 * @param {'left'|'right'} stanceLeg 지지(버티는) 다리 — 반대쪽 발이 들린다.
 */
export class SingleLegStanceTracker {
  constructor(calib, stanceLeg, opts = {}) {
    this.calib = calib;
    this.stanceLeg = stanceLeg;
    this.liftedSide = stanceLeg === 'left' ? 'right' : 'left';
    this.tuning = { ...SLST_TRACK_TUNING, ...opts };
    this.maxTrials = opts.maxTrials ?? 2;

    this.trials = []; // 완료된 시행 요약(내부 표현). 최대 maxTrials개.
    this.phase = 'waiting'; // waiting | holding
    this._lastMs = null;
    this._resetHold();
  }

  _resetHold() {
    this._filtHipX = new OneEuroFilter({ minCutoff: this.tuning.filterMinCutoff, beta: this.tuning.filterBeta, dCutoff: 1.0 });
    this._filtHipY = new OneEuroFilter({ minCutoff: this.tuning.filterMinCutoff, beta: this.tuning.filterBeta, dCutoff: 1.0 });
    this._liftStartMs = null;
    this._swayPathNorm = 0;
    this._maxPelvicTiltDeg = 0;
    this._balanceLoss = false;
    this._prevHip = null;
    this._prevT = null;
  }

  // 라이브 측정에서 트레이너가 육안으로 균형 상실을 봤을 때 직접 호출 가능.
  markBalanceLoss() {
    if (this.phase === 'holding') this._balanceLoss = true;
  }

  // 라이브 화면에서 "지금 몇 초째 유지 중"을 표시하기 위한 조회용(상태 변경 없음).
  elapsedHoldMs(nowMs) {
    if (this.phase !== 'holding' || this._liftStartMs == null) return 0;
    return Math.max(0, nowMs - this._liftStartMs);
  }

  // 목표 시간 도달 등으로 "정상 종료"(조기 발내림이 아님을 명시적으로 기록).
  stopManually(tMs) {
    if (this.phase !== 'holding') return;
    this._closeHold(tMs, 'manual_stop');
  }

  // 영상/스트림이 끝났는데 아직 holding 중이면 호출(업로드 분석 종료 시 등).
  // 발이 내려오는 걸 보지 못했으므로 실패로 단정하지 않고(stepOut:false),
  // 그때까지의 유지시간으로 마감한다.
  finalize(tMs) {
    if (this.phase === 'holding') this._closeHold(tMs ?? this._lastMs, 'stream_ended');
  }

  _closeHold(endMs, endReason) {
    const holdTimeMs = Math.max(0, endMs - this._liftStartMs);
    if (holdTimeMs >= this.tuning.minHoldForValidMs) {
      this.trials.push({
        holdTimeMs: Math.round(holdTimeMs),
        swayPathNorm: this._swayPathNorm,
        pelvicTiltDeg: Math.round(this._maxPelvicTiltDeg * 10) / 10,
        balanceLoss: this._balanceLoss,
        stepOut: endReason === 'foot_down',
      });
    }
    // minHoldForValidMs 미만이면 잡음으로 간주해 조용히 버리고 계속 대기.
    this.phase = 'waiting';
    this._resetHold();
  }

  push(lm, tMs) {
    if (!this.calib) return;
    this._lastMs = tMs;
    if (this.trials.length >= this.maxTrials) return; // 이미 필요한 만큼 모음

    const liftedY = ankleY(lm, this.liftedSide);
    if (liftedY == null) return;
    const liftThreshold = this.calib.baselineFeetY - this.tuning.liftBandFrac;

    if (this.phase === 'waiting') {
      if (liftedY < liftThreshold) {
        this.phase = 'holding';
        this._liftStartMs = tMs;
      }
      return;
    }

    // phase === 'holding'
    const hip = hipMid(lm);
    if (hip) {
      const fx = this._filtHipX.filter(hip.x, tMs / 1000);
      const fy = this._filtHipY.filter(hip.y, tMs / 1000);
      if (this._prevHip) {
        const dt = (tMs - this._prevT) / 1000;
        const dist = Math.hypot(fx - this._prevHip.x, fy - this._prevHip.y);
        this._swayPathNorm += dist;
        if (dt > 0 && dist / dt >= this.tuning.balanceLossVelocityThreshold) {
          this._balanceLoss = true;
        }
      }
      this._prevHip = { x: fx, y: fy };
      this._prevT = tMs;
    }

    const tilt = pelvicTiltDegOf(lm);
    if (tilt != null) this._maxPelvicTiltDeg = Math.max(this._maxPelvicTiltDeg, tilt);

    if (liftedY >= liftThreshold) {
      this._closeHold(tMs, 'foot_down');
    }
  }

  /**
   * singleLegStance.js의 evaluateSingleLegStance({ left/right: { trial1, trial2 } })
   * 가 그대로 받을 수 있는 { trial1, trial2 } 형태로 변환.
   * @param {object} opts
   * @param {number} [opts.cmPerNormUnit] px(정규화)↔cm 환산 계수
   *   (StandingCalibrator.result.scaleCmPerY — 키 입력이 있어야 값이 채워짐)
   */
  summary({ cmPerNormUnit = null } = {}) {
    const toTrial = (t) => {
      if (!t) return undefined;
      return {
        valid: true,
        holdTimeMs: t.holdTimeMs,
        swayPathCm: cmPerNormUnit != null ? Math.round(t.swayPathNorm * cmPerNormUnit * 10) / 10 : null,
        pelvicTiltDeg: t.pelvicTiltDeg,
        balanceLoss: t.balanceLoss,
        stepOut: t.stepOut,
      };
    };
    return {
      trial1: toTrial(this.trials[0]),
      trial2: toTrial(this.trials[1]),
      trialsFound: this.trials.length,
    };
  }
}
