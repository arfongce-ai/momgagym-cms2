// ai-measure/core/reactiveJump.js
// ════════════════════════════════════════════════════════════════════════
//  반응 탄성 점프(드롭점프 · 연속 포고) RSI 분석 — 순수 함수/상수.
//  jumpBiomechanics.js / gaitBiomechanics.js 와 동일한 설계 철학:
//   · 현장 튜닝 상수를 RSI_TUNING 한 곳에 모음
//   · valid 플래그로 무효 측정 원천 차단
//   · 측정 원리/단위/한계를 결과에 그대로 노출(측정 정직성)
//
//  ── RSI(Reactive Strength Index) 정의 (Haff & Dumke, Lab Manual) ──
//   RSI 는 "드롭점프에서 체공 시간 대 지면 접촉 시간의 비율"이 표준 정의.
//     RSI       = 체공시간(s) / 접지시간(s)         ← 무단위, 본 모듈의 주 지표
//     RSI(높이) = 점프높이(m) / 접지시간(s)         ← m/s, 보조 표기
//   두 방식은 단위·정상범위가 완전히 다르므로 반드시 함께 어떤 방식인지 표기한다.
//
//  ── 핵심: 지면 접촉 시간(Ground Contact Time, GCT) 측정 ──
//   JumpFlightTracker.flights[] 에는 각 점프 사이클의
//     { takeoffMs, landingMs, flightMs } 가 시간순으로 쌓인다.
//   연속 점프에서 '착지(landing) → 다음 이지(takeoff)' 구간이 곧 접지 국면이다:
//     GCT_i = flights[i+1].takeoffMs - flights[i].landingMs
//   별도 force plate/스위치매트 없이 기존 타임스탬프 파이프라인만으로 산출한다.
//
//  ⚠ 측정 한계(결과에 그대로 노출):
//   · GCT 는 보통 150~250ms 로 매우 짧다. 30fps(1프레임≈33ms)에서는 접지 시간
//     오차가 커진다 → 240fps 슬로우 모션 권장. fps 가 낮으면 lowFps 경고를 단다.
//   · 단일 점프(사이클 1회)는 사이클 간 간격이 없어 GCT 측정 불가 → 무효.
// ════════════════════════════════════════════════════════════════════════

export const RSI_TUNING = {
  // ── 접지 시간(GCT) sanity 범위(ms) ──
  // 너무 짧으면(프레임 한계 이하) 노이즈, 너무 길면 드롭점프가 아닌 '멈춤'.
  minContactMs: 80,
  maxContactMs: 800,

  // ── 프레임레이트 경고 ──
  // 이보다 프레임 간격이 길면(=fps 낮음) GCT 정확도 경고를 단다.
  // 30fps≈33.3ms. 슬로모(120/240fps)는 8.3/4.2ms 라 통과.
  contactFrameWarnMs: 20,    // 프레임 간격이 이보다 크면 lowFps 경고

  // ── 유효 사이클 수 ──
  minCycles: 2,              // 최소 2회 이상 떠야 사이클 사이 GCT 1개 이상 확보

  // ── 사이클 변동(CV) 임계 ──
  // 사이클 간 RSI 변동이 이보다 크면 최고값 대신 평균을 대표값으로 쓴다(과대평가 방지).
  cvUnstablePct: 15,

  // ── RSI 등급(체공/접지 비율, 무단위) — 일반 참고 기준 ──
  // 종목·연령에 따라 다름. 절대 기준 아님(리포트에 디스클레이머 표기).
  grades: [
    { min: 3.0, label: '엘리트',   tone: 'blue'    },
    { min: 2.5, label: '우수',     tone: 'emerald' },
    { min: 2.0, label: '양호',     tone: 'green'   },
    { min: 1.5, label: '보통',     tone: 'amber'   },
    { min: 0,   label: '개선 필요', tone: 'red'     },
  ],
};

const G = 9.81;

/** 체공시간(s) → 점프 높이(m). h = g·t²/8 (이륙·착지 높이 동일 가정) */
export function flightToHeightM(flightSec) {
  if (!flightSec || flightSec <= 0) return null;
  return (G * flightSec * flightSec) / 8;
}

/** 체공/접지 비율 RSI → 등급 객체 */
export function rsiGrade(rsiRatio) {
  if (rsiRatio == null || !isFinite(rsiRatio)) return null;
  return RSI_TUNING.grades.find((g) => rsiRatio >= g.min) || null;
}

/**
 * flights 배열(JumpFlightTracker.flights)에서 반응 점프 RSI 산출.
 *
 * @param {Array<{takeoffMs:number, landingMs:number, flightMs:number}>} flights
 * @param {object} [opts]
 * @param {number} [opts.frameIntervalMs]  대표 프레임 간격(ms). 있으면 lowFps 판정.
 * @param {'side'|'back'|'front'|'unknown'} [opts.view]  촬영 방향. 'side'가 아니면
 *        접지 시작/종료 판정(골반 수직 속도)이 무너지므로 RSI 측정을 거부한다.
 *        (점프 모듈의 측면뷰 강제 원칙과 동일 — 정면뷰는 교차검증 불일치가 큼.)
 * @returns {object} 결과(valid 플래그 포함)
 */
export function computeRSIFromFlights(flights, opts = {}) {
  const list = Array.isArray(flights) ? flights : [];

  // ── 측면 뷰 강제 ──
  // view 가 주어졌고 'side'가 아니면(정면/후면/미상) 무효 처리.
  // 'unknown'은 뷰 검출 자체가 안 된 것이므로 신뢰할 수 없어 함께 거부한다.
  // view 미전달(undefined) 시에는 하위호환을 위해 가드를 건너뛴다(수동/테스트 경로).
  if (opts.view != null && opts.view !== 'side') {
    return {
      valid: false,
      reason: 'not_side_view',
      view: opts.view,
      message: 'RSI 측정은 측면(옆) 촬영에서만 정확합니다. 정면·후면 영상은 접지 시간을 신뢰할 수 없어 측정하지 않았습니다.',
    };
  }

  if (list.length < RSI_TUNING.minCycles) {
    return {
      valid: false,
      reason: 'need_more_cycles',
      cycles: list.length,
      message: `반응 점프는 연속 ${RSI_TUNING.minCycles}회 이상 뛰어야 접지 시간을 측정할 수 있습니다.`,
    };
  }

  // 시간순 정렬(혹시 모를 순서 흔들림 방지)
  const f = [...list].sort((a, b) => a.takeoffMs - b.takeoffMs);

  // 사이클 사이 접지 국면: landing[i] → takeoff[i+1]
  const cycles = [];
  for (let i = 0; i < f.length - 1; i++) {
    const contactMs = f[i + 1].takeoffMs - f[i].landingMs;
    // 이지 이후의 '체공'은 다음(i+1) 점프의 flightMs (접지 직후 솟구친 점프)
    const flightMs = f[i + 1].flightMs;
    const inRange = contactMs >= RSI_TUNING.minContactMs && contactMs <= RSI_TUNING.maxContactMs;
    if (!inRange || !(flightMs > 0)) continue;
    const flightSec = flightMs / 1000;
    const contactSec = contactMs / 1000;
    const heightM = flightToHeightM(flightSec);
    cycles.push({
      contactMs: Math.round(contactMs),
      flightMs: Math.round(flightMs),
      heightCm: Math.round(heightM * 1000) / 10,
      rsi: round2(flightSec / contactSec),          // 체공/접지 (무단위) — 주 지표
      rsiHeight: round2(heightM / contactSec),      // 높이/접지 (m/s) — 보조
    });
  }

  if (!cycles.length) {
    return {
      valid: false,
      reason: 'no_valid_contact',
      cycles: f.length,
      message: `유효한 접지 구간을 찾지 못했습니다(접지 시간 ${RSI_TUNING.minContactMs}~${RSI_TUNING.maxContactMs}ms 범위 밖).`,
    };
  }

  // 대표값: 최고 RSI(최고 반응성 사이클) + 평균 + 변동계수(CV)
  const rsis = cycles.map((c) => c.rsi);
  const best = cycles.reduce((a, b) => (b.rsi > a.rsi ? b : a));
  const meanRsi = mean(rsis);
  const sd = stddev(rsis, meanRsi);
  const cvPct = meanRsi > 0 ? Math.round((sd / meanRsi) * 1000) / 10 : null;

  const meanContact = mean(cycles.map((c) => c.contactMs));
  const meanFlight = mean(cycles.map((c) => c.flightMs));

  // 프레임레이트 경고: 접지 시간이 짧은데 프레임 간격이 굵으면 정확도 저하.
  const fi = Number(opts.frameIntervalMs) || null;
  const lowFps = fi != null && fi > RSI_TUNING.contactFrameWarnMs;
  // 최소 접지 시간 대비 프레임 몇 개로 측정됐는지(신뢰도 참고)
  const framesPerContact = fi != null ? Math.round((meanContact / fi) * 10) / 10 : null;

  // ── 대표 RSI 선택(통계적 안전) ──
  // 최고값(best)은 사이클이 적고 노이즈가 있으면 측정 오차(우연히 GCT 가 한 프레임
  // 짧게 잡힌 사이클)를 그대로 집어 올린다. 사이클 간 변동(CV)이 크면 최고값 대신
  // 평균을 대표값으로 노출해 과대평가를 막는다.
  const unstable = cvPct != null && cvPct > RSI_TUNING.cvUnstablePct;
  const repRsi = unstable ? round2(meanRsi) : round2(best.rsi);
  const repBasis = unstable ? 'mean' : 'best';

  return {
    valid: true,
    reason: 'ok',
    mode: 'reactive',
    method: 'flight_over_contact',   // RSI = 체공/접지 (무단위)
    view: opts.view ?? null,         // 측정에 사용된 촬영 방향(가드 통과 = 'side' 또는 미전달)
    cycles: cycles.length,
    rsi: repRsi,                     // 주 결과 — CV 안정 시 최고, 불안정 시 평균
    rsiBasis: repBasis,              // 'best'(최고 반응 사이클) | 'mean'(변동 큰 경우 평균)
    rsiBest: round2(best.rsi),       // 참고: 최고 반응 사이클 값
    rsiMean: round2(meanRsi),
    rsiHeight: best.rsiHeight,       // 보조(m/s)
    contactTimeMs: Math.round(best.contactMs),
    contactTimeMeanMs: Math.round(meanContact),
    flightTimeMs: Math.round(best.flightMs),
    flightTimeMeanMs: Math.round(meanFlight),
    heightCm: best.heightCm,
    cvPct,                           // 사이클 간 변동(%) — 높으면 측정 신뢰 ↓
    grade: rsiGrade(repRsi),         // 등급도 대표값 기준으로 매김
    lowFps,
    frameIntervalMs: fi,
    framesPerContact,
    perCycle: cycles,                // 사이클별 상세(차트용)
  };
}

// ───────── 작은 통계 헬퍼 ─────────
function round2(x) { return Math.round(x * 100) / 100; }
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function stddev(arr, m) {
  if (arr.length < 2) return 0;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}
