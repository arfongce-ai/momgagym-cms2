// ai-measure/core/oneRmRepAdjust.js
// ════════════════════════════════════════════════════════════════════════
//  [1RM 반복 횟수 수동 보정 2026-11-25] 카메라 자동 카운트가 마지막 횟수를 틀리게 셌을 때,
//  기록 확인 단계에서 측정자가 횟수를 고치면 1RM 추정치를 다시 계산한다.
//  · 처음 자동으로 센 횟수(repsAuto)는 지우지 않고 남긴다(원본 + 보정값 둘 다 저장).
//  · 무게·원판·영상은 그대로. 속도 기반 교차검증값(velocityCheck)은 자동 추적 기준이라 그대로 두고,
//    횟수가 달라졌음을 repsAdjusted 로 표시한다.
// ════════════════════════════════════════════════════════════════════════
import { estimate1RM } from './strength';
import { clampReps, summarizeAttempts } from './lifting';

/**
 * @param {object} raw  OneRMEstimate.onSave 가 넘기는 원본(weight, reps, oneRM, attempts …)
 * @param {number} newReps 보정할 횟수(1~100)
 * @returns {object} 보정된 raw (입력은 바꾸지 않는다)
 */
export function adjustOneRmReps(raw, newReps) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const weight = Number(base.weight);
  const reps = clampReps(newReps);
  if (!Number.isFinite(weight) || weight <= 0) return { ...base };
  const originalAuto = Number.isFinite(Number(base.repsAuto)) ? Number(base.repsAuto) : clampReps(base.reps);
  const est = estimate1RM(weight, reps);

  // 마지막 도전(이번 기록)의 횟수·1RM 도 같이 고쳐 누적 최고값이 어긋나지 않게 한다.
  let attempts = Array.isArray(base.attempts) ? base.attempts.map((a) => ({ ...a })) : null;
  if (attempts && attempts.length) {
    const last = attempts[attempts.length - 1];
    attempts[attempts.length - 1] = { ...last, reps, oneRM: est.average };
  }
  const summary = attempts ? summarizeAttempts(attempts) : null;

  return {
    ...base,
    reps,
    oneRM: est.average,
    epley: est.epley,
    brzycki: est.brzycki,
    formulas: est.formulas,
    estimateStats: est.stats,
    confidenceInterval: est.confidenceInterval,
    formulaSpreadKg: est.formulaSpreadKg,
    formulaSpreadPct: est.formulaSpreadPct,
    attempts: attempts || base.attempts,
    attemptNo: summary ? summary.count : base.attemptNo,
    bestOneRM: summary ? summary.bestOneRM : base.bestOneRM,
    bestAttemptNo: summary ? summary.bestAttemptNo : base.bestAttemptNo,
    repsAuto: originalAuto,
    repsAdjusted: reps !== originalAuto,
  };
}
