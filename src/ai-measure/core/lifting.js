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
 *  - modes: 이 종목이 의미 있는 측정 모드. 1RM은 3대 운동, 역도(바벨추적)는 전 종목.
 *  - 확장: 메디신볼 등은 여기에 { key:'medicine_ball', modes:['lifting','vbt'] } 식으로 추가.
 */
export const EXERCISE_TYPES = [
  { key: 'squat',         label: '스쿼트',     modes: ['lifting', 'vbt', 'onerm'], lift1rm: 'squat' },
  { key: 'deadlift',      label: '데드리프트', modes: ['lifting', 'vbt', 'onerm'], lift1rm: 'deadlift' },
  { key: 'bench_press',   label: '벤치프레스', modes: ['lifting', 'vbt', 'onerm'], lift1rm: 'bench' },
  { key: 'weightlifting', label: '역도(스내치·클린)', modes: ['lifting', 'vbt'], lift1rm: null },
];

const EXERCISE_KEYS = EXERCISE_TYPES.map(e => e.key);

/** 유효한 표준 exerciseType 인지 검사. */
export function isValidExerciseType(key) {
  return EXERCISE_KEYS.includes(key);
}

/** exerciseType → 한글 라벨(없으면 key 그대로). */
export function exerciseLabel(key) {
  return EXERCISE_TYPES.find(e => e.key === key)?.label || key || '';
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
  const exType = isValidExerciseType(exerciseType) ? exerciseType : 'weightlifting';
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
