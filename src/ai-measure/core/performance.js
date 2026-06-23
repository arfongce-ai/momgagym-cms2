// ai-measure/core/performance.js
// RSI(반응강도지수) · VBT(속도기반훈련) 계산 공식. 순수 함수, 단위 테스트 가능.

/* ───────── RSI (Reactive Strength Index) ─────────
 * 반응강도지수: 점프 능력과 신경근 반응성을 나타내는 지표.
 *
 * 두 가지 정의:
 *  1) RSI       = 점프 높이(m) / 접지 시간(s)        ← 드롭점프 표준
 *  2) RSI-mod   = 점프 높이(m) / 추진 시간(s)
 *
 * 점프 높이는 체공시간(flight time)으로 추정:
 *   h = g * t_flight^2 / 8   (g=9.81)
 *   (이륙·착지 높이가 같다는 가정의 표준 추정식)
 */
const G = 9.81;

/** 체공시간(s) → 점프 높이(m) */
export function flightToHeight(flightTimeSec) {
  if (!flightTimeSec || flightTimeSec <= 0) return null;
  return (G * flightTimeSec * flightTimeSec) / 8;
}

/** 체공시간(s) → 이륙 속도(m/s). v = g * t_flight / 2 */
export function flightToTakeoffVelocity(flightTimeSec) {
  if (!flightTimeSec || flightTimeSec <= 0) return null;
  return (G * flightTimeSec) / 2;
}

// 수동 입력 sanity 범위 — 카메라 모드(RSI_TUNING)와 동일 기준(ms→s).
// 접지시간이 80ms 미만이면 물리적으로 불가능(프레임/입력 오류), 800ms 초과면
// 드롭점프가 아닌 '멈춤'. 체공시간도 비현실적 값(>2s ≈ 4.9m 점프)을 막는다.
export const RSI_INPUT_RANGE = {
  minContactSec: 0.08,
  maxContactSec: 0.80,
  minFlightSec: 0.10,
  maxFlightSec: 2.00,
};

/**
 * RSI 계산.
 *  표준 정의는 체공/접지 비율(무단위). 높이/접지(m/s)는 보조로 함께 제공.
 *  입력값이 물리적으로 불가능한 범위면 { error, message } 를 반환한다.
 * @param {number} flightTimeSec 체공 시간(초)
 * @param {number} contactTimeSec 접지 시간(초)
 * @returns {{ rsi:number, rsiHeight:number, height:number, heightCm:number, takeoffVelocity:number }
 *          | { error:string, message:string } | null}
 */
export function calcRSI(flightTimeSec, contactTimeSec) {
  const ft = Number(flightTimeSec), ct = Number(contactTimeSec);
  if (!ft || ft <= 0 || !ct || ct <= 0) return null;

  const R = RSI_INPUT_RANGE;
  if (ct < R.minContactSec || ct > R.maxContactSec) {
    return {
      error: 'contact_out_of_range',
      message: `접지 시간이 비현실적입니다(${R.minContactSec}~${R.maxContactSec}초 범위). 단위가 초(s)가 맞는지 확인하세요.`,
    };
  }
  if (ft < R.minFlightSec || ft > R.maxFlightSec) {
    return {
      error: 'flight_out_of_range',
      message: `체공 시간이 비현실적입니다(${R.minFlightSec}~${R.maxFlightSec}초 범위). 단위가 초(s)가 맞는지 확인하세요.`,
    };
  }

  const height = flightToHeight(ft);
  const v = flightToTakeoffVelocity(ft);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    height: r3(height),                       // m
    heightCm: Math.round(height * 1000) / 10, // cm
    rsi: r2(ft / ct),              // 체공/접지 (무단위) — RSI 표준 정의
    rsiHeight: r2(height / ct),    // 높이/접지 (m/s) — 보조 지표
    takeoffVelocity: r2(v),        // m/s
  };
}

/* ───────── VBT (Velocity Based Training) ─────────
 * 바벨 이동거리(m)와 추진 시간(s)으로 속도 산출.
 *  - 평균 속도(Mean Velocity) = 거리 / 시간
 *  - 최고 속도(Peak)는 별도 센서 필요하므로, 입력 시에만 사용.
 *
 * 속도 구간(존)별 훈련 목적 (일반적 가이드, 벤치/스쿼트 기준):
 */
export const VBT_ZONES = [
  { min: 1.3, max: Infinity, label: '스피드·파워', color: 'blue'   },
  { min: 1.0, max: 1.3,      label: '근파워',      color: 'green'  },
  { min: 0.75, max: 1.0,     label: '근력·파워',   color: 'yellow' },
  { min: 0.5, max: 0.75,     label: '근비대·근력', color: 'orange' },
  { min: 0,   max: 0.5,      label: '최대근력',    color: 'red'    },
];

/** 평균 속도(m/s) → 훈련 존 판정 */
export function velocityZone(meanVelocity) {
  return VBT_ZONES.find(z => meanVelocity >= z.min && meanVelocity < z.max) || null;
}

/**
 * VBT 계산.
 * @param {number} distanceM 바벨 이동 거리(m)
 * @param {number} timeSec 추진 시간(s)
 * @returns {{ meanVelocity:number, zone:object }|null}
 */
export function calcVBT(distanceM, timeSec) {
  const d = Number(distanceM), t = Number(timeSec);
  if (!d || d <= 0 || !t || t <= 0) return null;
  const mv = d / t;
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    meanVelocity: r2(mv),
    zone: velocityZone(mv),
  };
}

/* ───────── 반동점프 (Countermovement Jump) ─────────
 * 체공시간으로 점프 높이·이륙속도·평균 파워를 추정.
 *  - 높이 h = g·t²/8
 *  - 이륙속도 v = g·t/2
 *  - 평균 파워(Sayers 공식, 체중 필요):
 *      P_peak(W) = 60.7 · 높이(cm) + 45.3 · 체중(kg) − 2055
 *    (Sayers et al. 1999, CMJ peak power 추정 표준식)
 */
export function calcJump(flightTimeSec, bodyWeightKg) {
  const ft = Number(flightTimeSec);
  if (!ft || ft <= 0) return null;
  const height = flightToHeight(ft);          // m
  const heightCm = Math.round(height * 1000) / 10;
  const v = flightToTakeoffVelocity(ft);
  const r2 = (x) => Math.round(x * 100) / 100;

  let peakPower = null;
  const bw = Number(bodyWeightKg);
  if (bw && bw > 0) {
    peakPower = Math.round(60.7 * heightCm + 45.3 * bw - 2055);
  }

  return {
    heightCm,
    takeoffVelocity: r2(v),
    peakPower, // W (체중 입력 시에만)
  };
}
