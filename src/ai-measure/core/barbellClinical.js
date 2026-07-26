// ai-measure/core/barbellClinical.js
// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅(역도/VBT/1RM) 측정 수치 → 'AI 자동 평가 엔진'.
//  romClinical.js 와 동일한 설계: 측정 정직성 원칙 — 데이터가 불충분/모호하면
//  단정적 평가 대신 "측정 보완 필요"를 명확히 안내한다. 절대 그럴듯한 가짜
//  결론을 내지 않는다.
//
//  입력: buildLiftingPayload 표준 페이로드(저장본) 또는 측정 직후 결과.
//  출력: { grade, headline, details[], flags[] }
//   grade: 'excellent' | 'good' | 'fair' | 'needs_work' | 'insufficient'
// ════════════════════════════════════════════════════════════════════════

import { vbtZonePurpose, exerciseLabel } from './lifting';
import { BARBELL_TUNING } from './barbellBiomechanics';

export const GRADE_LABEL = {
  excellent: '매우 좋음',
  good: '좋음',
  fair: '보통',
  needs_work: '개선 필요',
  insufficient: '평가 보류',
};

// ── 상대근력(1RM ÷ 체중) 등급 기준 — 일반 성인 트레이닝 표준(참고치) ──
//  경계값: [입문|초급, 초급|중급, 중급|상급, 상급|엘리트]
const RELATIVE_STRENGTH_BANDS = {
  squat:       [0.75, 1.25, 1.75, 2.25],
  deadlift:    [1.0, 1.5, 2.0, 2.5],
  bench_press: [0.5, 0.9, 1.3, 1.7],
};
const RELATIVE_LEVELS = ['입문', '초급', '중급', '상급', '엘리트'];

/** 1RM ÷ 체중 → 수준 라벨. 체중/1RM 없으면 null(정직성 — 추정하지 않음). */
export function relativeStrengthLevel(exerciseType, oneRm, bodyWeightKg) {
  const bands = RELATIVE_STRENGTH_BANDS[exerciseType];
  const rm = Number(oneRm), bw = Number(bodyWeightKg);
  if (!bands || !Number.isFinite(rm) || rm <= 0 || !Number.isFinite(bw) || bw <= 0) return null;
  const ratio = Math.round((rm / bw) * 100) / 100;
  let idx = 0;
  for (const b of bands) { if (ratio >= b) idx += 1; }
  return { ratio, level: RELATIVE_LEVELS[idx] };
}

/** 속도저하(%) 해석 — Pareja-Blanco 등 velocity-loss 자동조절 근거. */
export function velocityLossInterpretation(lossPct) {
  const v = Number(lossPct);
  if (!Number.isFinite(v) || v < 0) return null;
  const B = BARBELL_TUNING.velocityLossBands;
  if (v <= B.fresh) return { band: 'fresh', text: `속도저하 ${v}% — 피로 누적이 적어 스피드·파워 훈련에 적합한 상태입니다.` };
  if (v <= B.strength) return { band: 'strength', text: `속도저하 ${v}% — 근력 훈련 권장 범위(≤20%) 안입니다.` };
  if (v <= B.hypertrophy) return { band: 'hypertrophy', text: `속도저하 ${v}% — 근비대 자극 범위입니다. 파워 목적이면 세트를 일찍 끊으세요.` };
  return { band: 'fatigue', text: `속도저하 ${v}% — 피로 누적이 큽니다(>30%). 세트 종료 또는 무게 하향을 권장합니다.` };
}

const gradeRank = { excellent: 4, good: 3, fair: 2, needs_work: 1 };
const worse = (a, b) => (gradeRank[a] <= gradeRank[b] ? a : b);

function pickMetrics(report = {}) {
  // 표준 페이로드({metrics,metadata})와 측정 직후 결과(flat)를 모두 수용.
  const m = report.metrics || {};
  const meta = report.metadata || {};
  return {
    meanVelocity: Number(m.meanVelocity ?? report.meanVelocity),
    peakVelocity: Number(m.peakVelocity ?? report.peakVelocity),
    velocityLoss: Number(m.velocityLoss ?? report.velocityLoss ?? report.velocityLossPct),
    romCm: Number(m.rangeOfMotion ?? report.romCm),
    oneRM: Number(m.oneRM ?? report.oneRM),
    confidenceScore: Number(m.confidenceScore ?? report.confidenceScore),
    reps: Number(meta.reps ?? report.reps),
    weight: Number(meta.weight ?? report.weight),
    repVelocity: meta.repVelocity ?? report.repVelocity ?? null,
    barPath: report.barPath ?? meta.barPath ?? null,
    consistencyCvPct: Number(report.consistencyCvPct ?? meta.consistencyCvPct),
    spreadPct: Number(meta.formulaSpreadPct ?? meta.estimateStats?.spreadPct),
    velocityCheck: meta.velocityCheck ?? report.velocityCheck ?? null,
  };
}

/**
 * 리프팅 자동 평가.
 * @param {object} report 표준 페이로드 또는 측정 직후 결과
 * @param {{ mode?:string, exerciseType?:string, bodyWeightKg?:number }} ctx
 */
export function generateLiftingDiagnosis(report = {}, ctx = {}) {
  const mode = ctx.mode || report.mode || 'vbt';
  const exerciseType = ctx.exerciseType || report.exerciseType || null;
  const exLabel = exerciseLabel(exerciseType);
  const M = pickMetrics(report);
  const details = [];
  const flags = [];
  let grade = 'good';
  let headline = '';

  // ── 측정 정직성 가드: 핵심 수치가 없으면 평가를 보류 ──
  const hasCore = mode === 'onerm'
    ? Number.isFinite(M.oneRM) && M.oneRM > 0
    : Number.isFinite(M.meanVelocity) && M.meanVelocity > 0;
  if (!hasCore) {
    return {
      grade: 'insufficient',
      headline: '측정 데이터가 부족해 평가를 보류합니다.',
      details: [mode === 'onerm'
        ? '무게·반복 입력 또는 카메라 추적이 완료되지 않았습니다.'
        : '키 입력(또는 거리 보정)과 바벨 추적이 안정적으로 잡히도록 다시 측정해 주세요.'],
      flags: ['insufficient_data'],
    };
  }

  // 신뢰도 공통 주의.
  if (Number.isFinite(M.confidenceScore) && M.confidenceScore < 0.6) {
    flags.push('low_confidence');
    details.push(`측정 신뢰도 ${Math.round(M.confidenceScore * 100)}% — 조명·각도·추적점을 점검하세요.`);
    grade = worse(grade, 'fair');
  }

  if (mode === 'onerm') {
    headline = `${exLabel} 추정 1RM ${M.oneRM}kg`;
    // ① 공식 간 편차 → 추정 안정성.
    if (Number.isFinite(M.spreadPct)) {
      if (M.spreadPct <= 5) details.push(`공식 간 편차 ${M.spreadPct}% — 추정이 매우 안정적입니다.`);
      else if (M.spreadPct <= 10) details.push(`공식 간 편차 ${M.spreadPct}% — 추정이 안정적인 편입니다.`);
      else {
        details.push(`공식 간 편차 ${M.spreadPct}% — 반복수가 많아 추정이 흔들립니다. 1~6회 세트로 재측정을 권장합니다.`);
        flags.push('high_formula_spread');
        grade = worse(grade, 'fair');
      }
    }
    // ② 반복수 신뢰 구간.
    if (Number.isFinite(M.reps) && M.reps > 10) {
      details.push(`반복 ${M.reps}회 — 10회 초과 추정은 오차가 큽니다(참고용).`);
      flags.push('high_reps');
      grade = worse(grade, 'fair');
    }
    // ③ 속도 교차검증(카메라 추적 성공 시).
    const vc = M.velocityCheck;
    if (vc?.oneRm != null && Number.isFinite(M.oneRM) && M.oneRM > 0) {
      const diffPct = Math.round(Math.abs(vc.oneRm - M.oneRM) / M.oneRM * 100);
      if (diffPct <= 10) {
        details.push(`속도 기반 교차검증 ${vc.oneRm}kg — 공식 추정과 ${diffPct}% 이내로 일치합니다.`);
      } else {
        details.push(`속도 기반 추정 ${vc.oneRm}kg 가 공식 추정과 ${diffPct}% 어긋납니다. 무게 입력·추적을 확인하세요.`);
        flags.push('velocity_formula_mismatch');
        grade = worse(grade, 'fair');
      }
    }
    // ④ 상대근력 수준(체중 있을 때만 — 정직성).
    const rel = relativeStrengthLevel(exerciseType, M.oneRM, ctx.bodyWeightKg);
    if (rel) details.push(`상대근력 ${rel.ratio}×체중 — ${rel.level} 수준입니다.`);
    if (!details.length) details.push('입력 기반 추정입니다. 낮은 반복(1~6회)일수록 정확합니다.');
    return { grade, headline, details, flags };
  }

  // ── lifting(역도 궤적) / vbt(속도) ──
  const zone = vbtZonePurpose(M.meanVelocity);
  headline = `${exLabel} 평균속도 ${M.meanVelocity}m/s${zone ? ` · ${zone.label}` : ''}`;

  if (mode === 'vbt') {
    if (zone) details.push(`${zone.label} 구간 — ${zone.purpose}`);
    const loss = velocityLossInterpretation(M.velocityLoss);
    if (loss) {
      details.push(loss.text);
      if (loss.band === 'fatigue') { flags.push('high_velocity_loss'); grade = worse(grade, 'fair'); }
    }
  }

  // 렙 일관성(CV) — 두 모드 공통.
  if (Number.isFinite(M.consistencyCvPct)) {
    if (M.consistencyCvPct <= 5) {
      details.push(`렙 간 속도 편차 ${M.consistencyCvPct}% — 매우 일관된 세트입니다.`);
      if (grade === 'good') grade = 'excellent'; // 감점 이력 없을 때만 상향
    }
    else if (M.consistencyCvPct <= 12) details.push(`렙 간 속도 편차 ${M.consistencyCvPct}% — 일관성이 양호합니다.`);
    else {
      details.push(`렙 간 속도 편차 ${M.consistencyCvPct}% — 렙마다 출력이 흔들립니다. 무게·자세를 점검하세요.`);
      flags.push('inconsistent_reps');
      grade = worse(grade, 'fair');
    }
  }

  // 바 궤적(역도 중심 — VBT 에도 참고 표시).
  const drift = Number(M.barPath?.maxDriftCm);
  const eff = Number(M.barPath?.avgEfficiency);
  if (Number.isFinite(drift)) {
    if (drift <= 4) details.push(`바 수평 이탈 최대 ${drift}cm — 궤적이 수직에 가깝습니다(효율적).`);
    else if (drift <= 8) details.push(`바 수평 이탈 최대 ${drift}cm — 양호하지만 더 수직에 가깝게 유지해 보세요.`);
    else {
      details.push(`바 수평 이탈 최대 ${drift}cm — 바가 몸에서 멀어집니다. 궤적 교정이 필요합니다.`);
      flags.push('large_bar_drift');
      if (mode === 'lifting') grade = worse(grade, 'needs_work');
      else grade = worse(grade, 'fair');
    }
  }
  if (Number.isFinite(eff) && eff > 0) {
    if (eff >= 0.9) details.push(`경로 효율 ${Math.round(eff * 100)}% — 낭비 움직임이 적습니다.`);
    else if (eff < 0.75) {
      details.push(`경로 효율 ${Math.round(eff * 100)}% — 수직 이동 대비 경로가 깁니다(흔들림/우회).`);
      flags.push('low_path_efficiency');
      grade = worse(grade, 'fair');
    }
  }

  if (Number.isFinite(M.peakVelocity) && M.peakVelocity > 0) {
    details.push(`평활 최고속도 ${M.peakVelocity}m/s (실시간 추정 — 고속영상 실측보다 보수적).`);
  }

  if (!details.length) details.push('세부 지표(렙 분절·궤적)가 부족합니다. 2회 이상 반복으로 측정하면 평가가 정교해집니다.');
  return { grade, headline, details, flags };
}
