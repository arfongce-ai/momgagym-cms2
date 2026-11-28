// ai-measure/core/sensorPlacementCheck.js
// 고니오메타 "위치·민감도 확인" — 대략적인 점검용(정확한 측정 아님).
//  · 폰을 관절 부위에 대고 가만히 있을 때: 떨림(±°), 폰 비틀림 예상 오차, 움직임 정도를 보고
//    "대략 괜찮음 / 조금 흔들림 / 위치 조정 필요" 로 알려준다.
//  · 측정 수학·임계값(sensorTilt.js)은 건드리지 않는다. 표시 전용.

export const G = 9.81;
export const CHECK_JITTER_OK = 1.0;    // 정지 시 각도 흔들림 폭(최대-최소) 이내면 양호
export const CHECK_JITTER_WARN = 2.5;  // 이를 넘으면 위치/고정 조정 필요
export const CHECK_TILT_OK = 2.5;      // estimateTiltErrorDeg 기준(sensorTilt 의 CLEAR 와 동일)
export const CHECK_TILT_WARN = 4;      // 측정 경고 기준(TILT_ERR_WARN 과 동일)
export const CHECK_ACC_OK = 0.04;
export const CHECK_ACC_WARN = 0.08;    // ACC_DEV_MAX 와 동일

const lvl = (v, ok, warn) => (v == null ? null : v <= ok ? 0 : v <= warn ? 1 : 2);

export function jitterRange(recentDegs) {
  const a = (recentDegs || []).filter((v) => Number.isFinite(v));
  if (a.length < 5) return null;
  return Math.round((Math.max(...a) - Math.min(...a)) * 10) / 10;
}

export function accDeviation(accMag) {
  return Number.isFinite(accMag) ? Math.abs(accMag - G) / G : null;
}

// → { level: 'good'|'warn'|'bad'|'wait', jitter, tiltErrDeg, accDev, hints[] }
export function assessPlacement({ recentDegs, tiltErrDeg, accDev } = {}) {
  const jitter = jitterRange(recentDegs);
  if (jitter == null) return { level: 'wait', jitter: null, tiltErrDeg: tiltErrDeg ?? null, accDev: accDev ?? null, hints: ['센서 신호를 모으는 중입니다…'] };
  const lv = [lvl(jitter, CHECK_JITTER_OK, CHECK_JITTER_WARN), lvl(tiltErrDeg, CHECK_TILT_OK, CHECK_TILT_WARN), lvl(accDev, CHECK_ACC_OK, CHECK_ACC_WARN)]
    .filter((x) => x != null);
  const worst = Math.max(...lv);
  const hints = [];
  if (accDev != null && accDev > CHECK_ACC_OK) hints.push('폰이 움직이고 있습니다 — 몸에 밀착해 가만히 고정하세요.');
  if (tiltErrDeg != null && tiltErrDeg > CHECK_TILT_OK) hints.push('폰이 비틀려 있습니다 — 폰 긴 쪽을 뼈 방향에 맞추고 화면을 평평하게 대세요.');
  if (jitter > CHECK_JITTER_OK) hints.push('각도가 흔들립니다 — 밴드/손으로 단단히 고정하고 근육 위가 아닌 뼈에 가까운 곳에 대세요.');
  if (!hints.length) hints.push('대략 괜찮은 위치입니다. 이 상태에서 0점 잡기를 하세요. (정확도 보증은 아님)');
  return { level: worst === 0 ? 'good' : worst === 1 ? 'warn' : 'bad', jitter, tiltErrDeg: tiltErrDeg ?? null, accDev: accDev ?? null, hints };
}
