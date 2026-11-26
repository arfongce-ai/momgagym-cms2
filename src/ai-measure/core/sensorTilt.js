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

// 중앙값(홀수/짝수 모두). 빈 배열이면 null.
export function median(arr) {
  if (!Array.isArray(arr)) return null;
  const v = arr.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// 폰 비틀림으로 예상되는 각도 오차(°). 폰이 측정면(회전축=기기 x축)에서 틀어지면
// 측정각이 실제보다 작거나 크게 나온다.
//  · 폰이 굴러 x축이 들린 경우(y축 회전 φ): g=(sinθ·sinφ, cosθ, sinθ·cosφ)
//      → 측정 tanθm = tanθ·cosφ (과소). 실제각 = atan2(√(gx²+gz²), gy).
//  · 폰이 화면 평면에서 돈 경우(z축 회전 φ): g=(−sinφ·cosθ, cosφ·cosθ, sinθ)
//      → 측정 tanθm = tanθ/cosφ (과대). 실제각 = atan2(gz, √(gx²+gy²)).
//  gx 는 두 경우를 구분하지 못하므로 둘 중 큰 오차를 돌려준다(보수적).
//  y축 가설은 gz 가 충분할 때만 쓴다 — 시작 자세(θ≈0)에선 gx 만으로 구르는지
//  알 수 없어 오경보가 나기 때문. 입력은 평활한 중력벡터. 계산 불가면 null.
// ※ 위 기하식은 이 코드의 이론 계산이며 실기기 검증 전이다.
export function estimateTiltErrorDeg(gx, gy, gz) {
  const mag = Math.hypot(gx, gy, gz);
  if (!Number.isFinite(mag) || mag < 0.5) return null;
  const thetaM = Math.atan2(gz, gy);
  const diff = (theta) => {
    let d = Math.abs((theta - thetaM) * RAD2DEG);
    if (d > 180) d = 360 - d;
    return d;
  };
  const gyzSigned = Math.hypot(gx, gy) * (gy < 0 ? -1 : 1);
  let err = diff(Math.atan2(gz, gyzSigned));
  if (Math.abs(gz) / mag >= 0.3) {
    const gxzSigned = Math.hypot(gx, gz) * (gz < 0 ? -1 : 1);
    err = Math.max(err, diff(Math.atan2(gxzSigned, gy)));
  }
  return err;
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

// ── 측정 방향(평면) 선택 ────────────────────────────────────────────────
//  폰을 세로로(긴 변=y축이 척추·뼈 방향) 몸에 대면, 움직임마다 회전축이 다르다.
//   · 'yz' : 짧은 변(x축)이 회전축 — 앞뒤로 숙임·젖힘(굽힘·폄). 기본값(기존 동작).
//   · 'yx' : 화면에 수직인 z축이 회전축 — 옆으로 기울임(가쪽 굽힘). 폰 긴 변이 화면 평면에서 기운다.
//   · 'xz' : 긴 변(y축)이 회전축 — 몸통을 바닥과 평행하게 숙인 자세의 돌림(폰 긴 변이 척추 방향).
//  기존 함수(gravityPlaneAngleDeg(gy, gz, gx) 등)는 그대로 쓰고, 중력벡터 성분의 자리만 바꿔 넣는다.
export const SENSOR_PLANES = ['yz', 'yx', 'xz'];
// 선택한 움직임으로 측정 방향을 자동 결정(사용자가 따로 고르지 않아도 되게).
//  몸통: 옆으로→'yx', 돌리기→'xz', 그 외(숙이기·젖히기)→'yz'. 목: 옆으로→'yx', 그 외→'yz'.
export function defaultPlaneFor(jointKey, poseMode) {
  if (jointKey === 'TRUNK') return poseMode === 'T_LATERAL' ? 'yx' : poseMode === 'T_ROTATION' ? 'xz' : 'yz';
  if (jointKey === 'NECK') return poseMode === 'LATERAL' ? 'yx' : 'yz';
  return 'yz';
}
export function planeComponents(plane, g) {
  if (plane === 'yx') return { gy: g.y, gz: g.x, gx: g.z };
  if (plane === 'xz') return { gy: g.z, gz: g.x, gx: g.y };
  return { gy: g.y, gz: g.z, gx: g.x };
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

// ── 자동 측정(끝범위 유지 감지) ─────────────────────────────────────────
//  끝범위에서 "각도 변화 없이 holdMs 동안 유지"되면 자동으로 확정하기 위한
//  안정 감지기.
//
//  createHoldDetector({ band, holdMs, minAbsDeg, minSamples })
//   · push(deg, nowMs) 를 매 표본마다 호출(시간은 ms, 표본 수와 무관).
//   · 최근 표본 창의 (최대−최소) 가 2×band 를 넘으면 가장 오래된 표본부터 버려
//     창을 줄인다. 기준점이 값을 따라 움직이지 않으므로 천천히 움직이는 중에는
//     창이 길어지지 않는다(이전 구현은 기준점이 따라가 느린 동작에서 오발화).
//   · 창 길이 ≥ holdMs, 표본 ≥ minSamples, 앞/뒤 절반 평균 차(드리프트) ≤ 0.6×band,
//     |중앙값| ≥ minAbsDeg 이면 { fired:true, angle: 창 중앙값 } 을 한 번 반환.
//     확정값은 "움직이다 찍힌 최고값"이 아니라 "유지한 구간의 중앙값"이다.
//   · deg 가 null 이면 창을 비운다(측정면 이탈·신호 끊김).
export function createHoldDetector({ band = 2.5, holdMs = 800, minAbsDeg = 5, minSamples = 6 } = {}) {
  let win = [];          // { t, deg }
  let firedOnce = false;
  const maxRange = band * 2;
  const driftMax = band * 0.6;
  const keepMs = holdMs * 1.5;

  const rangeOf = () => {
    let lo = Infinity, hi = -Infinity;
    for (const w of win) { if (w.deg < lo) lo = w.deg; if (w.deg > hi) hi = w.deg; }
    return hi - lo;
  };
  const meanOf = (a) => a.reduce((s, w) => s + w.deg, 0) / a.length;
  const driftOf = () => {
    const n = win.length;
    if (n < 4) return Infinity;
    const h = n >> 1;
    return Math.abs(meanOf(win.slice(n - h)) - meanOf(win.slice(0, h)));
  };

  return {
    push(deg, nowMs) {
      if (deg == null || !Number.isFinite(deg)) {
        win = [];
        return { fired: false, heldMs: 0, angle: null, spread: 0 };
      }
      win.push({ t: nowMs, deg });
      while (win.length && nowMs - win[0].t > keepMs) win.shift();
      while (win.length > 1 && rangeOf() > maxRange) win.shift();
      const heldMs = win.length ? nowMs - win[0].t : 0;
      const angle = median(win.map((w) => w.deg));
      const spread = win.length ? rangeOf() : 0;
      if (!firedOnce && heldMs >= holdMs && win.length >= minSamples
        && driftOf() <= driftMax && Math.abs(angle) >= minAbsDeg) {
        firedOnce = true;
        return { fired: true, heldMs, angle, spread };
      }
      return { fired: false, heldMs, angle, spread };
    },
    heldMs(nowMs) { return win.length ? Math.max(0, nowMs - win[0].t) : 0; },
    hasFired() { return firedOnce; },
    reset() { win = []; firedOnce = false; },
    // 자동 발화 후에도 사용자가 계속 움직이면 다시 무장할 수 있게 한다.
    rearm() { firedOnce = false; win = win.slice(-1); },
  };
}

// ── 최대각(피크) 추적 ───────────────────────────────────────────────────
//  최근 windowMs 구간의 중앙값을 최대각 후보로 쓴다. 순간 튐(창의 절반 미만)은
//  중앙값이 걸러 낸다. 표본이 minSamples 미만이면 갱신하지 않는다. null 표본은
//  창을 비운다(신뢰할 수 없는 구간은 최대각에 반영하지 않는다).
export function createPeakTracker({ windowMs = 300, minSamples = 5 } = {}) {
  let win = [];
  let peak = 0;
  return {
    push(deg, nowMs) {
      if (deg == null || !Number.isFinite(deg)) { win = []; return peak; }
      win.push({ t: nowMs, deg });
      while (win.length && nowMs - win[0].t > windowMs) win.shift();
      if (win.length >= minSamples) {
        const m = Math.abs(median(win.map((w) => w.deg)));
        if (m > peak) peak = m;
      }
      return peak;
    },
    peak() { return peak; },
    reset() { win = []; peak = 0; },
  };
}

// 센서 측정 신뢰도(0.3~0.95). 하드웨어 기울기라도 0점 흔들림·유지 구간 편차·폰 비틀림·
// 수동 확정(유지 확인 없음)이면 낮춘다. 가중치는 경험적 설정값이며 실측 검증 전이다.
export function sensorConfidence({ zeroRange = 0, spread = 0, tiltErr = 0, manual = false, zeroMax = 2 } = {}) {
  const pz = Math.min(0.1, (Math.max(0, zeroRange) / zeroMax) * 0.1);
  const ps = Math.min(0.2, Math.max(0, spread) * 0.04);
  const pt = Math.min(0.3, Math.max(0, tiltErr) * 0.06);
  const pm = manual ? 0.1 : 0;
  const c = 0.95 - pz - ps - pt - pm;
  return Math.round(Math.min(0.95, Math.max(0.3, c)) * 100) / 100;
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
//  offPlane, tiltErrDeg(폰 비틀림 예상 오차°, motion 경로만), accMag(순간 가속도
//  크기), source }) 콜백. 0점/최대각 관리는 UI(컴포넌트) 책임.
//  · gravityAlpha: 중력벡터 EMA(1차 평활). 낮을수록 둔감·안정.
//  · angleAlpha:   각도 EMA(2차 평활). 손떨림 제거용.
//  두 알파는 표본 간격 NOMINAL_DT_MS(≈60Hz)일 때의 값이다. 센서 속도가 기기마다
//  달라도 같은 시간상수가 되도록 실제 간격(dt)에 맞춰 환산해 적용한다.
const NOMINAL_DT_MS = 16.7;
export function alphaForDt(nominalAlpha, dtMs, nominalDtMs = NOMINAL_DT_MS) {
  const dt = Math.min(100, Math.max(1, Number.isFinite(dtMs) ? dtMs : nominalDtMs));
  return 1 - Math.pow(1 - nominalAlpha, dt / nominalDtMs);
}

export function createTiltTracker({ onSample, gravityAlpha = 0.08, angleAlpha = 0.3, plane = 'yz' } = {}) {
  let g = null;              // EMA 중력벡터 {x,y,z}
  let unwrapped = null;      // 언랩 누적각(비평활)
  let smoothed = null;       // 언랩 누적각(평활)
  let motionSeen = false;    // devicemotion 수신 여부(폴백 판단)
  let running = false;
  let lastT = null;          // 직전 표본 시각(ms) — 간격 환산용
  let dtMs = NOMINAL_DT_MS;

  const nowOf = (e) => (typeof e?.timeStamp === 'number' && e.timeStamp > 0
    ? e.timeStamp
    : (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const tick = (e) => {
    const t = nowOf(e);
    dtMs = lastT == null ? NOMINAL_DT_MS : t - lastT;
    lastT = t;
  };

  const emit = (rawDeg, offPlane, source, extra = {}) => {
    if (rawDeg == null) { onSample?.({ angleDeg: null, rawDeg: null, offPlane, source, ...extra }); return; }
    unwrapped = unwrapDeg(unwrapped, rawDeg);
    smoothed = smoothAngle(smoothed, unwrapped, alphaForDt(angleAlpha, dtMs));
    onSample?.({ angleDeg: smoothed, rawDeg: unwrapped, offPlane, source, ...extra });
  };

  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    motionSeen = true;
    tick(e);
    const ga = alphaForDt(gravityAlpha, dtMs);
    // EMA 저역통과 — 손동작 가속 제거, 중력 방향만 추출
    g = g
      ? { x: g.x + ga * (a.x - g.x), y: g.y + ga * (a.y - g.y), z: g.z + ga * (a.z - g.z) }
      : { x: a.x, y: a.y, z: a.z };
    const c = planeComponents(plane, g); // 측정 방향에 맞게 성분 자리를 바꿔 같은 수학을 쓴다
    emit(gravityPlaneAngleDeg(c.gy, c.gz, c.gx), offPlaneRatio(c.gx, c.gy, c.gz), 'motion', {
      tiltErrDeg: estimateTiltErrorDeg(c.gx, c.gy, c.gz),
      accMag: Math.hypot(a.x, a.y, a.z),
    });
  };

  const onOrientation = (e) => {
    if (motionSeen) return; // devicemotion 이 살아 있으면 폴백 무시
    if (plane !== 'yz') return; // 방향센서 폴백(beta)은 짧은 변 회전축 전용 — 다른 방향은 중력 센서만 쓴다
    if (e.beta == null) return;
    tick(e);
    // beta = x축 회전각(−180..180) — 같은 축의 폴백 신호.
    const off = e.gamma == null ? 0 : Math.min(1, Math.abs(e.gamma) / 90);
    emit(e.beta, off, 'orientation');
  };

  return {
    start() {
      if (running || typeof window === 'undefined') return;
      running = true;
      g = null; unwrapped = null; smoothed = null; motionSeen = false; lastT = null;
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
