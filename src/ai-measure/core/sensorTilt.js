// ai-measure/core/sensorTilt.js
// ════════════════════════════════════════════════════════════════════════
//  센서(자이로/가속도계) 기반 전자 각도기 — 코어 수학 + 트래커
//
//  용도: 카메라 세팅이 어려운 현장에서 폰을 관절 부위(사지)에 밀착해
//  기울기(Tilt)로 관절 가동범위를 측정한다. (임상 경사계 inclinometer 방식)
//
//  ── 센서 접근 방식 ──
//   · 주 경로: devicemotion 의 accelerationIncludingGravity (중력벡터).
//     저역통과(EMA)로 동작 가속 성분을 걷어내 순수 중력 방향만 추정한다.
//   · 폴백: deviceorientation 의 beta (x축 회전각). 기기별 지원 차이 대응.
//   · 외부 라이브러리 불필요 — 네이티브 API 로 충분하며, iOS 13+ 권한
//     게이트(requestPermission, 사용자 제스처 필수)를 직접 다루는 편이 안전.
//
//  ── 각도 산출 ──
//   폰을 화면이 바깥을 향하게 사지에 밀착하면, 관절 굴곡/신전 회전축은
//   기기의 x축과 나란하다. 이때 중력벡터를 기기 y–z 평면에 투영한
//     θ_raw = atan2(gz, gy)  (도 단위, −180..180)
//   가 그 회전축 기준의 연속 각도가 된다. acos(gy/|g|) 방식과 달리
//   수직 통과 시 접힘(fold)이 없고, 위상 언랩으로 ±180 경계도 잇는다.
//
//  ── 기기 환경 보정 ──
//   · 0점 조절(Calibration): 측정 시작 자세에서 현재 각을 0으로 설정.
//     iOS/Android 의 가속도 부호 규약 차이(중력 부호 반전)는 전체 각도의
//     부호 반전으로 나타나는데, '0점 대비 상대각의 크기'는 반전에 불변이라
//     0점 보정만으로 기기별 차이가 자동 상쇄된다.
//   · 측정면 이탈 감지: |gx|/|g| 가 크면 회전이 y–z 평면을 벗어난 것
//     (폰이 비틀림). offPlaneRatio 로 노출해 UI 가 경고한다(측정 정직성).
//   · 정지 감지: 최근 표본의 흔들림(범위)이 작으면 '멈춤'으로 판정 —
//     끝자세에서 안정 캡처를 돕는다.
// ════════════════════════════════════════════════════════════════════════

const RAD2DEG = 180 / Math.PI;

// ── 순수 수학 (테스트 대상) ──────────────────────────────────────────────

// 중력벡터의 y–z 평면 투영각(도, −180..180). gy·gz 가 모두 미약하면(기기
// x축이 수직 = 측정면이 중력과 직교) 각을 정의할 수 없어 null (정직성).
export function gravityPlaneAngleDeg(gy, gz, gx = 0) {
  const mag = Math.hypot(gx, gy, gz);
  if (!Number.isFinite(mag) || mag < 0.5) return null; // 자유낙하/무효 표본
  const planeMag = Math.hypot(gy, gz);
  if (planeMag / mag < 0.25) return null; // 투영 성분이 너무 작음 — 각도 부정확
  return Math.atan2(gz, gy) * RAD2DEG;
}

// 측정면 이탈 비율(0~1): 중력의 x축 성분 비중. 클수록 폰이 비틀려
// 회전이 측정면(y–z)을 벗어난 상태.
export function offPlaneRatio(gx, gy, gz) {
  const mag = Math.hypot(gx, gy, gz);
  if (!Number.isFinite(mag) || mag < 0.5) return 1;
  return Math.abs(gx) / mag;
}

// 위상 언랩: 직전 언랩각(prevUnwrapped)과 새 원시각(rawDeg, −180..180)을
// 받아 ±180 경계를 잇는 연속각을 반환. (경계 통과 시 ±360 보정)
export function unwrapDeg(prevUnwrapped, rawDeg) {
  if (prevUnwrapped == null || rawDeg == null) return rawDeg;
  let delta = rawDeg - (((prevUnwrapped % 360) + 540) % 360 - 180);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return prevUnwrapped + delta;
}

// 0점 보정 적용: 언랩각 − 0점. (표시각)
export function applyZero(unwrappedDeg, zeroDeg) {
  if (unwrappedDeg == null) return null;
  return unwrappedDeg - (zeroDeg ?? 0);
}

// 정지 판정: 최근 표본(도)의 최대−최소 범위가 임계 이하면 멈춤.
export function isStill(recentDegs, { maxRange = 1.5, minSamples = 8 } = {}) {
  if (!Array.isArray(recentDegs) || recentDegs.length < minSamples) return false;
  let lo = Infinity, hi = -Infinity;
  for (const v of recentDegs) {
    if (v == null) return false;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo <= maxRange;
}

// ── 센서 지원/권한 ───────────────────────────────────────────────────────

export function isSensorSupported() {
  if (typeof window === 'undefined') return false;
  return 'DeviceMotionEvent' in window || 'DeviceOrientationEvent' in window;
}

// iOS 13+ 는 사용자 제스처(버튼 클릭) 안에서 requestPermission 을 호출해야
// 한다. Android/데스크톱은 함수가 없으므로 곧바로 'granted' 로 간주.
export async function requestSensorPermission() {
  if (typeof window === 'undefined') return 'unsupported';
  try {
    const DM = window.DeviceMotionEvent;
    const DO = window.DeviceOrientationEvent;
    if (DM && typeof DM.requestPermission === 'function') {
      const res = await DM.requestPermission();
      if (res !== 'granted') return res; // 'denied'
    } else if (DO && typeof DO.requestPermission === 'function') {
      const res = await DO.requestPermission();
      if (res !== 'granted') return res;
    }
    return isSensorSupported() ? 'granted' : 'unsupported';
  } catch (e) {
    // 제스처 밖 호출 등 — 거부로 처리해 UI 가 재시도 버튼을 보여주게 한다.
    return 'denied';
  }
}

// 각도 EMA(2차 평활): 언랩각에 적용해 손떨림을 걷어낸다. prev 가 없으면 next.
export function smoothAngle(prev, next, alpha = 0.3) {
  if (next == null) return prev ?? null;
  if (prev == null) return next;
  return prev + alpha * (next - prev);
}

// 표시 스텝 반올림(예: 0.5° 단위) — 미세 잔떨림이 숫자로 보이지 않게.
export function roundToStep(v, step = 0.5) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v / step) * step;
}

// 평균(0점 캘리브레이션용). 언랩각은 연속값이라 단순 산술평균이 안전하다.
export function meanDeg(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let sum = 0, n = 0;
  for (const v of arr) { if (v != null && Number.isFinite(v)) { sum += v; n += 1; } }
  return n ? sum / n : null;
}

// ── 실시간 트래커 ────────────────────────────────────────────────────────
//  start() 후 onSample({ angleDeg(평활·언랩, 0점 전), rawDeg(비평활 언랩),
//  offPlane, source }) 콜백. 0점/최대각 관리는 UI(컴포넌트) 책임.
//  · gravityAlpha: 중력벡터 EMA(1차 평활). 낮을수록 둔감·안정.
//  · angleAlpha:   각도 EMA(2차 평활). 손떨림 제거용.
export function createTiltTracker({ onSample, gravityAlpha = 0.08, angleAlpha = 0.3 } = {}) {
  let g = null;              // EMA 중력벡터 {x,y,z}
  let unwrapped = null;      // 언랩 누적각(비평활)
  let smoothed = null;       // 언랩 누적각(평활)
  let motionSeen = false;    // devicemotion 수신 여부(폴백 판단)
  let running = false;

  const emit = (rawDeg, offPlane, source) => {
    if (rawDeg == null) { onSample?.({ angleDeg: null, rawDeg: null, offPlane, source }); return; }
    unwrapped = unwrapDeg(unwrapped, rawDeg);
    smoothed = smoothAngle(smoothed, unwrapped, angleAlpha);
    onSample?.({ angleDeg: smoothed, rawDeg: unwrapped, offPlane, source });
  };

  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    motionSeen = true;
    // EMA 저역통과 — 손동작 가속 제거, 중력 방향만 추출
    g = g
      ? { x: g.x + gravityAlpha * (a.x - g.x), y: g.y + gravityAlpha * (a.y - g.y), z: g.z + gravityAlpha * (a.z - g.z) }
      : { x: a.x, y: a.y, z: a.z };
    emit(gravityPlaneAngleDeg(g.y, g.z, g.x), offPlaneRatio(g.x, g.y, g.z), 'motion');
  };

  const onOrientation = (e) => {
    if (motionSeen) return; // devicemotion 이 살아 있으면 폴백 무시
    if (e.beta == null) return;
    // beta = x축 회전각(−180..180) — 같은 축의 폴백 신호.
    const off = e.gamma == null ? 0 : Math.min(1, Math.abs(e.gamma) / 90);
    emit(e.beta, off, 'orientation');
  };

  return {
    start() {
      if (running || typeof window === 'undefined') return;
      running = true;
      g = null; unwrapped = null; smoothed = null; motionSeen = false;
      window.addEventListener('devicemotion', onMotion);
      window.addEventListener('deviceorientation', onOrientation);
    },
    stop() {
      if (!running || typeof window === 'undefined') return;
      running = false;
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('deviceorientation', onOrientation);
    },
    isRunning: () => running,
  };
}

// 햅틱 피드백(측정 완료 알림). iOS Safari 는 vibrate 미지원 — 조용히 무시.
export function hapticFeedback(pattern = [60, 40, 60]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
      return true;
    }
  } catch (e) { /* noop */ }
  return false;
}
