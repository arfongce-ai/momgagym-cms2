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
//   2) 들리는 쪽 발목이 "자기 기준선"보다 liftBand(다리 길이 비례) 이상 뜨면
//      → 유지(holding) 시작. 내려놓음 판정은 releaseBand(더 낮은 문턱)로 —
//      히스테리시스를 둬 경계에서 유지/종료가 번갈아 튀지 않게 한다.
//   3) 유지 중: 좌우 골반 라인 기울기의 최대값(골반 기울기)을 추적하고, 골반
//      중점의 프레임간 이동 속도가 급격히 튀면 균형 상실로 "추정"한다(휴리스틱,
//      아래 한계 참고). [2026-08-02] 흔들림 누적 경로(sway path) 자체는 더는
//      추적하지 않는다 — 핵심 측정 대상은 발을 든(lift) 순간부터 다시 딛는
//      (touch) 순간까지의 유지시간이고, 흔들림은 판정에 반영하지 않기로 함.
//      [2026-09-22] 시행 시작 대비 골반 yaw(제자리 회전) 변화도 함께 추적한다 —
//      힙 이동 속도만으로는 몸을 축으로 도는 동작을 못 잡기 때문(3-2 참고).
//   4) 시행 종료 3가지 경로:
//      4-1) 들었던 발이 기준선 근처로 releaseHysteresisMs 이상 연속 유지되며
//           내려오면 → 조기 종료(stepOut:true, endReason:'foot_down').
//      4-2) 균형 상실(속도 휴리스틱 또는 markBalanceLoss() 수동 호출) 또는
//           rotationYawDeltaDeg 이상 회전이 rotationHysteresisMs 이상 지속되면
//           → 즉시 종료(balanceLoss:true, endReason:'balance_loss'|'rotation').
//           [2026-09-22 수정] 예전엔 balanceLoss가 플래그만 세우고 유지시간을
//           계속 누적해 "흔들리고 돌아도 계속 됨"으로 보였다 — 이제 감지 즉시 종료.
//      4-3) 목표 시간 도달 등으로 stopManually()가 먼저 호출되면 조기 종료 아님
//           (stepOut:false, endReason:'manual_stop').
//      종료 후 다음 시행을 위해 자동으로 대기 상태로 복귀한다(최대 maxTrials회까지).
//   5) minHoldForValidMs 보다 짧은 시행(순간적인 흔들림 등 오검출)은 조용히
//      버리고 계속 다음 시행을 기다린다 — 잡음으로 판정 자체를 막지 않는다.
//
//  ⚠ 측정 한계(결과에 그대로 노출):
//   · balanceLoss는 "골반 이동 속도 급변" 휴리스틱으로 추정한 값이며, 실제
//     넘어짐·휘청임 여부를 진단하지 않는다. 라이브 측정 화면에서는 트레이너가
//     육안으로 보고 markBalanceLoss()를 직접 호출해 보완할 수 있다.
//   · 회전(rotation) 감지는 골반 좌우 랜드마크의 z(카메라 기준 깊이) 차이를 쓰는
//     휴리스틱이다 — BlazePose z는 x/y보다 노이즈가 커서, 카메라 각도·조명에
//     따라 민감도가 달라질 수 있다.
//   · 무릎 외반(kneeValgusDeg)은 이 추적기에서 계산하지 않는다(선택 신호이며
//     singleLegStance.js는 이 필드가 없어도 정상 동작한다).
// ════════════════════════════════════════════════════════════════════════

import { OneEuroFilter } from './gaitBiomechanics';
import { StandingCalibrator } from './jumpBiomechanics';

// 화면(UI)에서 캘리브레이션도 이 파일 하나만 import 하도록 재노출.
export { StandingCalibrator };

export const SLST_TRACK_TUNING = {
  // [2026-08-02] "발을 들어도 초시계가 안 돈다"는 현장 피드백 반영.
  //  기존에는 liftBandFrac(=화면 높이의 5%)이라는 고정값을 썼는데, 이 값은
  //  사람이 화면에 얼마나 크게 잡히는지에 따라 요구되는 실제 들어올림 높이가
  //  완전히 달라진다(전신이 작게 잡히면 20cm를 들어도 미달). 임상 SLST는
  //  발을 바닥에서 살짝만 떼는 검사라 더 쉽게 미달됐다.
  //  → 화면 기준이 아니라 "그 사람의 다리 길이(골반~발목)" 대비 비율로 바꾼다.
  //    다리 길이의 6%면 다리 90cm 기준 약 5cm — 의도적으로 든 것은 잡고,
  //    서 있을 때의 미세 흔들림은 걸러지는 수준.
  //  ⚠ 실제 캡처 데이터로 보정이 필요한 출발 기본값이다.
  liftBandOfLegFrac: 0.06,
  liftBandMin: 0.012,                 // 정규화 y 최소 문턱(다리 길이 추정 실패 대비)
  liftBandMax: 0.05,                  // 정규화 y 최대 문턱(기존 고정값이 상한 역할)
  // 히스테리시스: 발을 내렸다고 볼 때는 문턱을 더 낮게(기준선에 가깝게) 쓴다.
  // 올릴 때와 내릴 때 같은 문턱을 쓰면 경계에서 유지/종료가 계속 번갈아 튄다.
  releaseBandRatio: 0.5,
  minHoldForValidMs: 500,             // 이보다 짧게 들었다 내리면 오검출로 간주(조용히 폐기)
  filterMinCutoff: 1.0,
  filterBeta: 0.01,
  balanceLossVelocityThreshold: 0.35, // 골반(정규화좌표) 속도(단위/초) 이 이상이면 균형상실 추정
  // [측정 기준 일관성 수정 2026-09-22] "어쩔때는 조금만 움직여도 끝나고, 어쩔때는
  // 흔들리고 돌아도 계속 됨" 현장 피드백 대응 — 원인은 종료 판정 두 경로가 서로
  // 비대칭이었기 때문: 발내림(foot_down)은 필터링 없는 단일 프레임 잡음에도 즉시
  // 종료됐고(과민), 균형상실(balanceLoss)은 감지는 해도 플래그만 세울 뿐 시행을
  // 끝내지 않았으며(둔감), 회전/제자리돌기를 감지하는 신호 자체가 없었다.
  releaseHysteresisMs: 150,   // 발내림 판정도 이 시간만큼 연속으로 문턱 아래여야 확정(단일 프레임 잡음 방지)
  rotationYawDeltaDeg: 18,    // 시행 시작 시점 대비 이만큼 회전하면 "돌았다"로 간주
  rotationHysteresisMs: 200,  // 회전 판정도 이 시간만큼 연속 유지돼야 확정
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
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
// [회전/제자리돌기 감지 2026-09-22] 힙 중점의 프레임간 이동(위 balanceLoss 판정)만으로는
// 몸을 축으로 제자리에서 도는 동작을 못 잡는다 — 회전 중에는 골반 중심 자체는 거의
// 안 움직인다. 좌우 골반의 카메라 기준 깊이(z) 차이를 각도로 환산해 "몸이 카메라를
// 얼마나 비스듬히 보고 있는지"를 추적한다(postureMath.js의 estimateLowerYawProxy와
// 동일한 공식, 이 모듈은 독립성을 위해 postureMath를 import하지 않고 자체 계산한다).
function hipYawProxyDeg(lm) {
  const l = lm?.[HIP_L];
  const r = lm?.[HIP_R];
  if (!l || !r || l.z == null || r.z == null) return null;
  return clamp((r.z - l.z) * 120, -90, 90);
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

    // ── 들어올림 문턱값(정규화 y) ──
    // 다리 길이(골반~발목)에 비례시켜, 사람이 화면에 크게 잡히든 작게 잡히든
    // "실제로 몇 cm 들었는가"가 비슷하게 요구되도록 한다.
    const legLen = (calib && calib.baselineFeetY != null && calib.baselinePelvisY != null)
      ? Math.abs(calib.baselineFeetY - calib.baselinePelvisY)
      : null;
    const t = this.tuning;
    this.liftBand = legLen && legLen > 0
      ? Math.min(t.liftBandMax, Math.max(t.liftBandMin, legLen * t.liftBandOfLegFrac))
      : t.liftBandMax;
    this.releaseBand = this.liftBand * t.releaseBandRatio;

    // 발목별 "자기 자신" 기준선 — 양발 평균과 비교하면 두 발목의 높이차가
    // 그대로 문턱에 더해져 검출이 어려워진다. 예전 calib 객체(구 버전 저장본
    // 등)에는 이 필드가 없을 수 있어 병합값으로 폴백한다.
    this._baseL = calib?.baselineAnkleYL ?? calib?.baselineFeetY ?? null;
    this._baseR = calib?.baselineAnkleYR ?? calib?.baselineFeetY ?? null;

    this._resetHold();
  }

  // 이 발목이 자기 기준선보다 얼마나 떠 있는지(정규화 y, 클수록 높이 들림).
  // 화면 좌표는 아래로 갈수록 y가 커지므로 (기준선 - 현재값)이 들린 양이다.
  // [과민 종료 수정 2026-09-22] 여기서 OneEuroFilter로 스무딩하는 방법도 시도했지만,
  // releaseBand 자체가 아주 작은 값이라 큰 낙하(발을 훅 내리는 정상 동작)일수록
  // 필터가 그 문턱 아래로 수렴하는 데 오히려 더 오래 걸려(관찰상 최대 0.5초 이상)
  // "정상적으로 내려도 안 끝난다"는 반대 방향 버그를 만들었다. 대신 원본값은 그대로
  // 쓰고, push()의 releaseHysteresisMs(연속 프레임 요구)만으로 단일 프레임 잡음을
  // 거른다 — 지연이 프레임 수에 비례해 예측 가능하고, 낙폭 크기와 무관하다.
  _liftAmount(lm, side) {
    const y = ankleY(lm, side);
    const base = side === 'left' ? this._baseL : this._baseR;
    if (y == null || base == null) return null;
    return base - y;
  }

  _resetHold() {
    this._filtHipX = new OneEuroFilter({ minCutoff: this.tuning.filterMinCutoff, beta: this.tuning.filterBeta, dCutoff: 1.0 });
    this._filtHipY = new OneEuroFilter({ minCutoff: this.tuning.filterMinCutoff, beta: this.tuning.filterBeta, dCutoff: 1.0 });
    this._liftStartMs = null;
    this._maxPelvicTiltDeg = 0;
    this._balanceLoss = false;
    this._prevHip = null;
    this._prevT = null;
    // [측정 기준 일관성 수정 2026-09-22] 발내림·회전 판정용 디바운스 상태.
    this._belowReleaseSinceMs = null;
    this._rotatedSinceMs = null;
    this._baselineYawDeg = null;
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
    // [2026-09-22] minHoldForValidMs는 "발을 든 게 잡음성 블립이었는지"를 걸러내기
    // 위한 문턱이다 — balance_loss/rotation은 반대로 "짧게라도 정말 불안정했다"는
    // 확정적 신호라, 발을 들자마자 곧바로 휘청였다면 그 자체가 유효한(그리고
    // 중요한) 실패 결과다. 이 두 사유는 길이와 무관하게 항상 기록한다.
    const isDecisiveFailure = endReason === 'balance_loss' || endReason === 'rotation';
    if (holdTimeMs >= this.tuning.minHoldForValidMs || isDecisiveFailure) {
      this.trials.push({
        holdTimeMs: Math.round(holdTimeMs),
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

    // 들린 양 = 그 발목 "자기 자신"의 기준선 대비 떠오른 정규화 y 거리.
    // (양발 평균이 아니라 발목별 기준선을 쓰므로 좌우 발목 높이차가 문턱에
    //  더해지지 않는다.)
    const lift = this._liftAmount(lm, this.liftedSide);
    if (lift == null) return;

    if (this.phase === 'waiting') {
      if (lift >= this.liftBand) {
        this.phase = 'holding';
        this._liftStartMs = tMs;
        // 회전 감지 기준선 — 시행 시작 시점의 골반 yaw를 "정면"으로 삼는다.
        this._baselineYawDeg = hipYawProxyDeg(lm);
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
        // [2026-08-02] 흔들림 누적 경로는 더는 판정에 안 쓰므로 저장하지 않는다.
        // 순간 이동 속도(dist/dt)만 균형 상실 추정에 계속 쓴다.
        if (dt > 0 && dist / dt >= this.tuning.balanceLossVelocityThreshold) {
          this._balanceLoss = true;
        }
      }
      this._prevHip = { x: fx, y: fy };
      this._prevT = tMs;
    }

    const tilt = pelvicTiltDegOf(lm);
    if (tilt != null) this._maxPelvicTiltDeg = Math.max(this._maxPelvicTiltDeg, tilt);

    // [측정 기준 일관성 수정 2026-09-22] 균형 상실이 감지되면(위 속도 휴리스틱 또는
    // markBalanceLoss() 수동 호출) 그 자리에서 시행을 종료한다. 예전엔 플래그만
    // 세우고 유지시간을 계속 누적해 "흔들려도 계속 됨"으로 보였다 — 시행 자체는
    // 여전히 balanceLoss:true로 저장되어 singleLegStance.js가 즉시확정 RISK로 판정한다.
    if (this._balanceLoss) {
      this._closeHold(tMs, 'balance_loss');
      return;
    }

    // 제자리 회전/돌기 감지 — 힙 이동 속도(위)만으로는 몸을 축으로 도는 동작을 못
    // 잡는다(회전 중엔 골반 중심 자체는 거의 안 움직인다). 시행 시작 대비 골반
    // yaw 변화가 rotationYawDeltaDeg 이상 rotationHysteresisMs 이상 지속되면 종료.
    const yawNow = hipYawProxyDeg(lm);
    if (yawNow != null && this._baselineYawDeg != null) {
      const yawDelta = Math.abs(yawNow - this._baselineYawDeg);
      if (yawDelta >= this.tuning.rotationYawDeltaDeg) {
        if (this._rotatedSinceMs == null) this._rotatedSinceMs = tMs;
        if (tMs - this._rotatedSinceMs >= this.tuning.rotationHysteresisMs) {
          this._balanceLoss = true; // 회전도 정적 자세 유지 실패 — 즉시확정 RISK로 남긴다.
          this._closeHold(tMs, 'rotation');
          return;
        }
      } else {
        this._rotatedSinceMs = null;
      }
    }

    // 히스테리시스: 내려놓음 판정은 더 낮은 문턱(releaseBand)으로 — 올릴 때와
    // 같은 문턱을 쓰면 경계 근처에서 유지/종료가 매 프레임 번갈아 튄다.
    // [과민 종료 수정 2026-09-22] 문턱 아래로 내려간 순간 바로 끝내지 않고,
    // releaseHysteresisMs 동안 연속으로 아래에 머물러야 확정한다 — 단일 잡음
    // 프레임(또는 필터가 못 따라간 튐) 하나로 "조금만 움직여도 끝나는" 것을 막는다.
    if (lift < this.releaseBand) {
      if (this._belowReleaseSinceMs == null) this._belowReleaseSinceMs = tMs;
      if (tMs - this._belowReleaseSinceMs >= this.tuning.releaseHysteresisMs) {
        this._closeHold(tMs, 'foot_down');
      }
    } else {
      this._belowReleaseSinceMs = null;
    }
  }

  /**
   * singleLegStance.js의 evaluateSingleLegStance({ left/right: { trial1, trial2 } })
   * 가 그대로 받을 수 있는 { trial1, trial2 } 형태로 변환.
   */
  summary() {
    const toTrial = (t) => {
      if (!t) return undefined;
      return {
        valid: true,
        holdTimeMs: t.holdTimeMs,
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
