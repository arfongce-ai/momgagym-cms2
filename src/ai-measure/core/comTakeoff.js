// ai-measure/core/comTakeoff.js
// [2026-11-24] CMJ 이륙 속도 "참고값" — 이륙 직전 골반(몸 중심에 가까운 점)의 위쪽 속도를 영상으로 구한다. 순수 함수.
//  · 주 측정은 여전히 체공시간(h = g·t²/8, v = g·t/2)이다. 이 값은 그 옆에 놓는 교차 확인용 참고값이다.
//  · 근거와 한계: 단일 스마트폰 영상으로 CMJ 몸 중심 수직속도를 모션캡처와 비교한 연구에서 ICC 0.91 초과였지만
//    약간 과대평가하는 경향이 보고되었다(Sensors 2024;24:6624). 힘판 실측이 아니다.
//  · 한계: 30fps에서는 이륙 직전 0.15초 구간에 샘플이 4~5개뿐이라 흔들림에 민감하다. 두 방식이 많이 어긋나면 '신뢰 낮음'으로 표시한다.
//  · 골반 변위 교차검증이 구조적 오차가 커서 판정 게이트로 쓰지 않는다는 기존 결론(jumpBiomechanics.js summary 주석)을 그대로 따른다 → 이 값도 저장·표시만 하고 유효 판정에는 관여하지 않는다.
export const COM_TUNING = {
  windowMs: 150,      // 이륙 직전 이 시간 안의 골반 위치로 기울기를 구한다
  minSamples: 4,      // 샘플이 이보다 적으면 계산하지 않는다
  minSpanMs: 90,      // 샘플이 걸친 시간이 이보다 짧으면 계산하지 않는다
  gapOkPct: 25,       // 체공시간 속도와의 허용 차이(%) — 기존 골반변위 교차검증 허용치(JUMP_TUNING.crossTolPct)와 같은 값
  minFps: 50,         // 이보다 낮은 프레임이면 '신뢰 낮음'(임시 기준 — 대표님 실측 데이터가 쌓이면 조정)
};

const r2 = (x) => Math.round(x * 100) / 100;

// samples: [{ tMs, y }] (y = 정규화 골반 높이, 위로 갈수록 작아진다). scaleCmPerY: 정규화 y 1 = 몇 cm.
// 반환: { velocity(m/s, 위쪽이 +), n, spanMs, fps } | null
export function pelvisTakeoffVelocity(samples, scaleCmPerY, takeoffMs, tuning = COM_TUNING) {
  if (!Array.isArray(samples) || !(scaleCmPerY > 0) || !Number.isFinite(takeoffMs)) return null;
  const win = samples
    .filter((s) => s && Number.isFinite(s.tMs) && Number.isFinite(s.y) && s.tMs <= takeoffMs && s.tMs >= takeoffMs - tuning.windowMs)
    .sort((a, b) => a.tMs - b.tMs);
  if (win.length < tuning.minSamples) return null;
  const spanMs = win[win.length - 1].tMs - win[0].tMs;
  if (spanMs < tuning.minSpanMs) return null;
  // 최소제곱 직선 기울기(y/초)
  const t = win.map((s) => (s.tMs - win[0].tMs) / 1000);
  const n = win.length;
  const mt = t.reduce((a, b) => a + b, 0) / n;
  const my = win.reduce((a, s) => a + s.y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i += 1) { num += (t[i] - mt) * (win[i].y - my); den += (t[i] - mt) ** 2; }
  if (den <= 0) return null;
  const slopeYPerSec = num / den;
  const velocity = (-slopeYPerSec * scaleCmPerY) / 100; // 위로 갈수록 y 감소 → 부호 반전, cm→m
  const dts = [];
  for (let i = 1; i < n; i += 1) dts.push(win[i].tMs - win[i - 1].tMs);
  dts.sort((a, b) => a - b);
  const medDt = dts[Math.floor(dts.length / 2)] || null;
  return { velocity, n, spanMs, fps: medDt ? Math.round(1000 / medDt) : null };
}

// 체공시간 이륙속도(flightVelocity, m/s)와 비교해 저장용 참고값을 만든다. 계산 불가면 null.
export function buildComTakeoff(samples, scaleCmPerY, flightVelocity, takeoffMs, tuning = COM_TUNING) {
  const est = pelvisTakeoffVelocity(samples, scaleCmPerY, takeoffMs, tuning);
  if (!est || !(flightVelocity > 0)) return null;
  const gapPct = Math.round((Math.abs(est.velocity - flightVelocity) / flightVelocity) * 1000) / 10;
  const reasons = [];
  if (!(est.velocity > 0)) reasons.push('upward_velocity_missing');
  if (gapPct > tuning.gapOkPct) reasons.push('gap_large');
  if (est.fps != null && est.fps < tuning.minFps) reasons.push('low_fps');
  return {
    velocity: r2(est.velocity),
    flightVelocity: r2(flightVelocity),
    gapPct,
    confidence: reasons.length ? 'low' : 'ok',
    reasons,
    fps: est.fps,
    samples: est.n,
    basis: 'pelvis',
  };
}

export const COM_REASON_KO = {
  upward_velocity_missing: '이륙 직전 위로 올라가는 움직임이 잡히지 않았어요.',
  gap_large: '체공 시간으로 구한 속도와 차이가 커요.',
  low_fps: '프레임이 낮아(50fps 미만) 이륙 직전 샘플이 적어요. 60fps 이상 촬영을 권장합니다.',
};
