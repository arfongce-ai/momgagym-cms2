// ai-measure/core/lifting.js
// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅 통합 코어 — 역도 / VBT / 1RM 세 모드의 공통 규약(순수 함수).
//
//  설계 원칙 (측정 정직성 · 근거기반):
//   1) exerciseType 표준화: squat | deadlift | bench_press | weightlifting
//      → 향후 medicine_ball 등 확장도 같은 레지스트리에 항목만 추가하면 됨(모듈형).
//   2) peakVelocity 정직성 게이트: 순간 최고속도는 고속영상(120/240fps) 업로드
//      에서만 신뢰 가능. 실시간(30fps) 모드에선 산출하지 않고 reason code 로 거부.
//      (근거: 30fps는 한 프레임 33ms — 0.2s 추진 구간을 6프레임으로밖에 못 나눠
//       순간 피크가 구조적으로 과소/과대 추정됨. performance.js 주석과 동일 입장.)
//   3) 통합 저장: 별도 컬렉션을 신설하지 않고 기존 'ai' + unifiedReport 흐름에
//      exerciseType 을 실어 일관성·읽기효율을 유지(점프/보행/자세/ROM과 동일).
// ════════════════════════════════════════════════════════════════════════

/**
 * 운동 종목 표준 레지스트리.
 *  - key:   Firestore 저장·집계용 표준 값(영문 snake). 절대 변경 금지(과거 데이터 호환).
 *  - label: 화면 표기(한글).
 *  - modes: 이 종목이 의미 있는 측정 모드.
 *      · lifting(역도 궤적): 올림픽 리프트 — 스내치 / 클린&저크 / 클린.
 *      · vbt(속도): 파워리프트 3종 + 스내치·클린(속도 의미 있는 올림픽 리프트).
 *      · onerm(1RM 추정): 스쿼트/데드/벤치만. 올림픽 리프트는 제외(아래 근거).
 *  - lift1rm: 1RM 추정용 내부 lift 키(없으면 null → 1RM 비대상).
 *
 *  [근거 — 올림픽 리프트를 1RM 추정에서 제외]
 *   스내치·클린은 기술·스피드 의존도가 매우 높아 reps→1RM 회귀식(Epley/Brzycki 등)의
 *   표준오차가 파워리프트 대비 크게 벌어진다. 이 공식들은 스쿼트/벤치/데드 같은
 *   grind 가능한 종목에서 검증됐다(Haff & Dumke). 정직성 원칙상 부정확한 추정을
 *   내놓기보다 1RM 대상에서 제외하고, 올림픽 리프트는 궤적·속도(lifting/vbt)로 평가한다.
 *
 *  - 확장: 메디신볼 등은 { key:'medicine_ball', modes:['lifting','vbt'] } 식으로 추가.
 */
export const EXERCISE_TYPES = [
  // 파워리프트 — 1RM 추정 대상.
  { key: 'squat',         label: '스쿼트',     modes: ['vbt', 'onerm'], lift1rm: 'squat' },
  { key: 'deadlift',      label: '데드리프트', modes: ['vbt', 'onerm'], lift1rm: 'deadlift' },
  { key: 'bench_press',   label: '벤치프레스', modes: ['vbt', 'onerm'], lift1rm: 'bench' },
  // 올림픽 리프트 — 궤적/속도 평가용(1RM 추정 제외).
  { key: 'snatch',        label: '스내치',      modes: ['lifting', 'vbt'], lift1rm: null },
  { key: 'clean_jerk',    label: '클린&저크',   modes: ['lifting'],        lift1rm: null },
  { key: 'clean',         label: '클린',        modes: ['lifting', 'vbt'], lift1rm: null },
];

const EXERCISE_KEYS = EXERCISE_TYPES.map(e => e.key);

// 과거 데이터 호환 — 구버전에서 저장된 'weightlifting'(통합 역도) 키를 대표 종목으로 매핑.
const LEGACY_EXERCISE_ALIASES = { weightlifting: 'clean' };

/** 레거시 별칭을 표준 키로 정규화. */
export function normalizeExerciseType(key) {
  if (EXERCISE_KEYS.includes(key)) return key;
  if (LEGACY_EXERCISE_ALIASES[key]) return LEGACY_EXERCISE_ALIASES[key];
  return key;
}

/** 유효한 표준 exerciseType 인지 검사(레거시 별칭 포함). */
export function isValidExerciseType(key) {
  return EXERCISE_KEYS.includes(key) || LEGACY_EXERCISE_ALIASES[key] != null;
}

/** exerciseType → 한글 라벨(레거시 별칭/없으면 폴백). */
export function exerciseLabel(key) {
  const norm = normalizeExerciseType(key);
  return EXERCISE_TYPES.find(e => e.key === norm)?.label || key || '';
}

/** 특정 모드에서 선택 가능한 종목 목록. */
export function exercisesForMode(mode) {
  return EXERCISE_TYPES.filter(e => e.modes.includes(mode));
}

/**
 * strength.js 의 1RM lift 키(bench/squat/deadlift) ↔ 표준 exerciseType 매핑.
 *  1RM 모듈은 내부적으로 'bench' 를 쓰지만 저장은 'bench_press' 로 표준화한다.
 */
export function exerciseToLift1rm(exerciseType) {
  return EXERCISE_TYPES.find(e => e.key === exerciseType)?.lift1rm || null;
}
export function lift1rmToExercise(liftKey) {
  if (liftKey === 'bench') return 'bench_press';
  return EXERCISE_TYPES.find(e => e.lift1rm === liftKey)?.key || liftKey;
}

// ───────── peakVelocity 정직성 게이트 ─────────

/**
 * 측정 소스별 신뢰 프레임레이트 기준.
 *  - 'live'(실시간 카메라): 보통 30fps → peakVelocity 거부.
 *  - 'upload'(고속영상): 120/240fps → peakVelocity 허용.
 *  실제 fps 를 알면 그 값으로 판정(>=120 허용). 모르면 source 로 판정.
 */
export const PEAK_VELOCITY_MIN_FPS = 120;

/**
 * peakVelocity 산출 가능 여부 판정.
 * @param {{ source?:string, fps?:number }} ctx
 * @returns {{ allowed:boolean, reason:string }}
 *   reason 코드: 'ok' | 'live_fps_too_low' | 'fps_too_low' | 'unknown_source'
 */
export function canComputePeakVelocity({ source, fps } = {}) {
  if (typeof fps === 'number' && fps > 0) {
    return fps >= PEAK_VELOCITY_MIN_FPS
      ? { allowed: true, reason: 'ok' }
      : { allowed: false, reason: 'fps_too_low' };
  }
  if (source === 'upload') return { allowed: true, reason: 'ok' };
  if (source === 'live') return { allowed: false, reason: 'live_fps_too_low' };
  return { allowed: false, reason: 'unknown_source' };
}

/**
 * 시계열 변위 샘플에서 최고 순간속도(m/s)를 계산.
 *  - samples: [{ yCm:number, ts:number(ms) }, ...]  (yCm = 수직 위치 cm)
 *  - 정직성: source/fps 가 고속영상 기준을 못 넘으면 peakVelocity=null + reason.
 *  - 평균속도(meanVelocity)는 항상 산출(총 변위 ÷ 총 시간) — 이건 fps 영향이 작음.
 *
 * @param {Array<{yCm:number, ts:number}>} samples
 * @param {{ source?:string, fps?:number }} ctx
 * @returns {{ meanVelocity:number|null, peakVelocity:number|null,
 *             peakReason:string, romCm:number|null, durationSec:number|null }}
 */
export function computeBarVelocities(samples, ctx = {}) {
  const out = {
    meanVelocity: null, peakVelocity: null,
    peakReason: 'no_data', romCm: null, durationSec: null,
  };
  if (!Array.isArray(samples) || samples.length < 2) return out;

  const ys = samples.map(s => Number(s.yCm)).filter(v => Number.isFinite(v));
  const ts = samples.map(s => Number(s.ts)).filter(v => Number.isFinite(v));
  if (ys.length < 2 || ts.length < 2) return out;

  const romCm = Math.max(...ys) - Math.min(...ys);
  const durationSec = (ts[ts.length - 1] - ts[0]) / 1000;
  out.romCm = Math.round(romCm * 10) / 10;
  out.durationSec = Math.round(durationSec * 100) / 100;

  // 평균 속도 — 총 수직 변위(m) ÷ 시간(s). fps 의존성 낮아 항상 산출.
  if (durationSec > 0) {
    out.meanVelocity = Math.round((romCm / 100 / durationSec) * 100) / 100;
  }

  // 최고 순간속도 — 고속영상 기준 통과 시에만.
  const gate = canComputePeakVelocity(ctx);
  out.peakReason = gate.reason;
  if (!gate.allowed) {
    out.peakVelocity = null;
    return out;
  }
  let peak = 0;
  for (let i = 1; i < samples.length; i++) {
    const dyM = (Number(samples[i].yCm) - Number(samples[i - 1].yCm)) / 100;
    const dtS = (Number(samples[i].ts) - Number(samples[i - 1].ts)) / 1000;
    if (!Number.isFinite(dyM) || !Number.isFinite(dtS) || dtS <= 0) continue;
    const v = Math.abs(dyM / dtS);
    if (v > peak) peak = v;
  }
  out.peakVelocity = peak > 0 ? Math.round(peak * 100) / 100 : null;
  return out;
}

/**
 * 평균파워(W) 추정 — VBT 보조 지표. P = F·v = (m·g)·v_mean.
 *  근거: 바벨 무게(kg)에 대한 평균 수직 속도 기준의 근사 평균파워.
 *  (정밀 순간파워는 force plate / encoder 필요. 추세 파악용 근사임을 명시.)
 * @returns {number|null} W
 */
export function estimateMeanPower(weightKg, meanVelocity) {
  const w = Number(weightKg), v = Number(meanVelocity);
  if (!w || w <= 0 || !v || v <= 0) return null;
  return Math.round(w * 9.81 * v);
}

// ───────── 1RM 입력 보조: 무게 다이얼 / 반복 카운터 / 도전 차수 ─────────

/** 무게 다이얼 1스텝(kg). 0.5kg 단위(요구사항). */
export const WEIGHT_STEP_KG = 0.5;
/** 다이얼 허용 범위(kg). 봉만(0)부터 상한까지. */
export const WEIGHT_MIN_KG = 0;
export const WEIGHT_MAX_KG = 500;

/** 무게를 0.5kg 격자에 스냅하고 범위로 클램프. */
export function snapWeight(kg, step = WEIGHT_STEP_KG) {
  const v = Number(kg);
  if (!Number.isFinite(v)) return WEIGHT_MIN_KG;
  const snapped = Math.round(v / step) * step;
  const clamped = Math.min(WEIGHT_MAX_KG, Math.max(WEIGHT_MIN_KG, snapped));
  // 0.5 단위 부동소수 오차 정리.
  return Math.round(clamped * 2) / 2;
}

/** 다이얼 증감(delta 스텝 수만큼). */
export function stepWeight(kg, deltaSteps, step = WEIGHT_STEP_KG) {
  return snapWeight(snapWeight(kg, step) + deltaSteps * step, step);
}

/** 반복 카운터 클램프(1 이상 정수, 제한 없음 → 상한은 안전상 100). */
export function clampReps(reps) {
  const r = Math.round(Number(reps));
  if (!Number.isFinite(r) || r < 1) return 1;
  return Math.min(100, r);
}

/**
 * 반복수 기반 1RM 추정 신뢰도(근거기반).
 *  공식들은 저반복(≈1~10회)에서 정확. 고반복일수록 표준오차 급증.
 *  차단하지 않고 신뢰도/사유만 반환해 호출부가 안내하도록 한다(정직성).
 * @returns {{ level:'high'|'medium'|'low', note:string }}
 */
export function repEstimateConfidence(reps) {
  const r = clampReps(reps);
  if (r <= 6) return { level: 'high', note: '1~6회 — 추정 신뢰도 높음' };
  if (r <= 10) return { level: 'medium', note: '7~10회 — 신뢰도 보통' };
  return { level: 'low', note: '10회 초과 — 오차 큼(참고용)' };
}

/**
 * 도전 차수(attempt) 누적 기록 헬퍼.
 *  같은 세션에서 1·2·3차 시도를 배열로 쌓는다. 각 attempt 는
 *  { attemptNo, weight, reps, oneRM, success, at }.
 * @param {Array} attempts 기존 배열
 * @param {object} entry { weight, reps, oneRM, success? }
 * @returns {Array} 새 배열(불변)
 */
export function appendAttempt(attempts, entry) {
  const list = Array.isArray(attempts) ? attempts : [];
  const attemptNo = list.length + 1;
  return [...list, {
    attemptNo,
    weight: entry?.weight ?? null,
    reps: entry?.reps ?? null,
    oneRM: entry?.oneRM ?? null,
    success: entry?.success ?? null,
    at: new Date().toISOString(),
  }];
}

/** 도전 기록 중 성공(또는 전체)의 최고 1RM·최고 무게 요약. */
export function summarizeAttempts(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  if (!list.length) return { count: 0, bestOneRM: null, bestWeight: null, bestAttemptNo: null };
  let best = null;
  for (const a of list) {
    const v = Number(a.oneRM);
    if (Number.isFinite(v) && (!best || v > Number(best.oneRM))) best = a;
  }
  const bestWeight = list.reduce((m, a) => {
    const w = Number(a.weight);
    return Number.isFinite(w) && w > m ? w : m;
  }, 0);
  return {
    count: list.length,
    bestOneRM: best ? Number(best.oneRM) : null,
    bestWeight: bestWeight || null,
    bestAttemptNo: best ? best.attemptNo : null,
  };
}

// ───────── 종목별 리포트 해석(요구사항 6 · 근거기반) ─────────

/** VBT 속도 트레이닝 존(Mann 기준)별 훈련 목적. */
export const VBT_ZONE_PURPOSE = [
  { min: 1.3, max: Infinity, label: '스피드·파워',  purpose: '폭발적 스피드 개발 구간. 가볍고 빠르게.' },
  { min: 1.0, max: 1.3,      label: '근파워',        purpose: '파워 출력 극대화 구간.' },
  { min: 0.75, max: 1.0,     label: '근력·파워',     purpose: '근력과 파워의 균형 구간.' },
  { min: 0.5, max: 0.75,     label: '근비대·근력',   purpose: '근비대·기초근력 구간.' },
  { min: 0,   max: 0.5,      label: '최대근력',      purpose: '최대근력(고중량) 구간.' },
];

export function vbtZonePurpose(meanVelocity) {
  const v = Number(meanVelocity);
  if (!Number.isFinite(v) || v <= 0) return null;
  return VBT_ZONE_PURPOSE.find(z => v >= z.min && v < z.max) || null;
}

/**
 * 측정 페이로드 → 목적별 리포트 해석 묶음.
 *  반환: { headline, lines[], cautions[] }
 *   - headline: 한 줄 요약
 *   - lines:    무게/구간/자세 관점의 설명 항목
 *   - cautions: 신뢰도·데이터 관련 주의(정직성)
 *  모든 수치는 측정값에서만 도출(추적 데이터 우선). 값 없으면 해당 줄 생략.
 */
export function buildLiftingInterpretation(report = {}) {
  const mode = report.mode || (report.metrics?.oneRM != null ? 'onerm' : 'vbt');
  const m = report.metrics || {};
  const meta = report.metadata || {};
  const exLabel = exerciseLabel(report.exerciseType);
  const lines = [];
  const cautions = [];
  let headline = '';

  // 신뢰도 주의(공통).
  const conf = Number(m.confidenceScore);
  if (Number.isFinite(conf) && conf < 0.6) {
    cautions.push(`측정 신뢰도 ${Math.round(conf * 100)}% — 조명·각도·키 입력·추적점을 점검하세요.`);
  }
  if (Array.isArray(meta.confidenceReasons) && meta.confidenceReasons.includes('no_calibration')) {
    cautions.push('키 미입력 — 속도·cm는 상대값일 수 있습니다.');
  }

  if (mode === 'onerm') {
    const oneRM = Number(m.oneRM);
    const w = Number(meta.weight), reps = Number(meta.reps);
    headline = oneRM ? `${exLabel} 추정 1RM ${oneRM}kg` : `${exLabel} 1RM 측정`;
    if (oneRM && w) {
      const pct = Math.round((w / oneRM) * 100);
      lines.push({ label: '강도', text: `이번 세트 ${w}kg×${reps || '?'}회는 추정 1RM의 약 ${pct}% 강도입니다.` });
    }
    if (oneRM) {
      lines.push({ label: '훈련 무게(참고)', text: `근비대 75~80%(${Math.round(oneRM * 0.77 / 2.5) * 2.5}kg), 근력 85~90%(${Math.round(oneRM * 0.87 / 2.5) * 2.5}kg) 부근.` });
    }
    if (meta.attemptNo) {
      const best = meta.bestOneRM;
      lines.push({ label: '도전 차수', text: `${meta.attemptNo}차 도전${best ? ` · 세션 최고 ${best}kg` : ''}.` });
    }
    const repConf = repEstimateConfidence(reps);
    if (repConf.level !== 'high') cautions.push(`반복 ${reps}회 — ${repConf.note}.`);
    return { headline, lines, cautions };
  }

  // lifting(역도) / vbt 공통 — 속도·궤적 중심.
  const mv = Number(m.meanVelocity);
  const pv = Number(m.peakVelocity);
  const rom = Number(m.rangeOfMotion);
  headline = `${exLabel} ${mode === 'vbt' ? '속도' : '궤적'} 분석`;

  if (Number.isFinite(mv) && mv > 0) {
    const zone = vbtZonePurpose(mv);
    headline = `${exLabel} 평균속도 ${mv}m/s`;
    lines.push({ label: '구간', text: zone ? `${zone.label} 구간 — ${zone.purpose}` : `평균속도 ${mv}m/s.` });
  }
  if (Number.isFinite(pv) && pv > 0) {
    lines.push({ label: '최고속도', text: `순간 최고 ${pv}m/s (고속영상 실측).` });
  } else if (m.peakReason === 'live_fps_too_low') {
    cautions.push('실시간(30fps)에서는 최고속도를 산출하지 않습니다. 고속영상으로 측정하면 표시됩니다.');
  }
  if (Number.isFinite(rom) && rom > 0) {
    lines.push({ label: '가동범위', text: `바벨 수직 이동 ${rom}cm.` });
  }
  const reps = Number(meta.reps);
  if (Number.isFinite(reps) && reps > 0) {
    lines.push({ label: '반복', text: `자동 카운트 ${reps}회.` });
  }
  if (meta.zone && !lines.some(l => l.label === '구간')) {
    lines.push({ label: '구간', text: `${meta.zone} 구간.` });
  }
  const power = Number(m.meanPower ?? m.peakPower);
  if (Number.isFinite(power) && power > 0) {
    lines.push({ label: '파워(근사)', text: `평균 파워 약 ${power}W.` });
  }
  return { headline, lines, cautions };
}

/**
 * VBT confidenceScore(0~1) — 측정 신뢰도 종합 점수(근거기반 감점식).
 *  시작 1.0 에서 다음 요인으로 감점:
 *   - 캘리브레이션(키 입력) 없음        −0.30
 *   - 추적점 손실률(lostRatio)          −0.40 * lostRatio
 *   - 추진시간 비현실(너무 짧/긺)       −0.20
 *   - 실시간(저fps) 소스                 −0.15  (peakVelocity 미산출 반영)
 *  honesty: 점수가 낮으면 호출부가 경고/거부할 수 있게 reasons 도 함께 반환.
 *
 * @param {{ isCalibrated?:boolean, lostRatio?:number, durationSec?:number,
 *           source?:string, romCm?:number }} ctx
 * @returns {{ score:number, reasons:string[] }}
 */
export function vbtConfidence(ctx = {}) {
  const reasons = [];
  let score = 1.0;

  if (!ctx.isCalibrated) { score -= 0.30; reasons.push('no_calibration'); }

  const lost = Number(ctx.lostRatio);
  if (Number.isFinite(lost) && lost > 0) {
    score -= 0.40 * Math.min(1, lost);
    if (lost >= 0.3) reasons.push('high_tracking_loss');
  }

  const dur = Number(ctx.durationSec);
  if (Number.isFinite(dur) && dur > 0 && (dur < 0.3 || dur > 8)) {
    score -= 0.20; reasons.push('implausible_duration');
  }

  if (ctx.source === 'live') { score -= 0.15; reasons.push('live_low_fps'); }

  const rom = Number(ctx.romCm);
  if (Number.isFinite(rom) && rom > 0 && rom < 5) {
    score -= 0.20; reasons.push('rom_too_small');
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { score, reasons };
}

/**
 * 통합 저장 페이로드 빌더 — 세 모드가 공통으로 이 함수를 통해 저장 규약을 맞춘다.
 *  Hub 의 onSave 로 넘기는 표준 객체. type='lifting' 로 통일하고 mode 로 세부 구분.
 *
 * @param {object} p
 * @param {'lifting'|'vbt'|'onerm'} p.mode
 * @param {string} p.exerciseType  표준 종목 키
 * @param {string} p.source        'live' | 'upload' | 'manual'
 * @param {object} p.metrics       { peakVelocity, meanVelocity, peakPower, rangeOfMotion, confidenceScore }
 * @param {object} p.metadata      { weight, isCalibrated, ... }
 * @param {object} [p.extra]       모드별 추가 필드(공식별 1RM 등)
 * @returns {object} onSave 페이로드
 */
export function buildLiftingPayload({ mode, exerciseType, source, metrics = {}, metadata = {}, extra = {} }) {
  // 표준 키로 정규화(레거시 별칭 흡수). 유효하지 않으면 모드별 안전 기본값.
  let exType = normalizeExerciseType(exerciseType);
  if (!EXERCISE_KEYS.includes(exType)) {
    exType = mode === 'lifting' ? 'clean' : 'squat';
  }
  return {
    type: 'lifting',          // 통합 측정 유형(점프=jump 처럼 하나로 묶음)
    mode,                     // 'lifting' | 'vbt' | 'onerm'
    exerciseType: exType,     // 표준 종목 — 집계·필터의 1차 키
    exerciseLabel: exerciseLabel(exType),
    source: source || 'live',
    recordedAt: new Date().toISOString(),
    metrics: {
      peakVelocity: metrics.peakVelocity ?? null,
      meanVelocity: metrics.meanVelocity ?? null,
      peakPower: metrics.peakPower ?? null,
      meanPower: metrics.meanPower ?? null,
      rangeOfMotion: metrics.rangeOfMotion ?? null, // cm
      oneRM: metrics.oneRM ?? null,
      confidenceScore: metrics.confidenceScore ?? null,
      peakReason: metrics.peakReason ?? null,
    },
    metadata: {
      weight: metadata.weight ?? null,
      isCalibrated: metadata.isCalibrated === true,
      ...metadata,
    },
    ...extra,
  };
}
