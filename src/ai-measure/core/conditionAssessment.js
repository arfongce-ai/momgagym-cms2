// ai-measure/core/conditionAssessment.js
// ════════════════════════════════════════════════════════════════════════
//  오늘의 컨디션(자가 체크인) 판정 — 순수 함수/상수.
//  singleLegStance.js 와 동일한 설계 철학:
//   · 현장 튜닝 상수를 CONDITION_TUNING 한 곳에 모음
//   · valid 플래그로 무효(미입력) 체크인 원천 차단
//   · 판정 근거를 결과에 그대로 노출(측정 정직성)
//   · status 는 카메라 측정 모듈들과 동일하게 소문자 문자열 리터럴
//     ('normal'|'caution'|'risk'|'unknown')을 그대로 쓴다(별도 enum import 없음).
//
//  ── 입력 계약 ──
//   이 모듈은 카메라 측정이 아니라 회원의 자가 보고(self-report) 값을 받는다.
//   fatigue(피로도, 1~5)와 painNrs(통증, NRS 0~10)는 독립 신호이며, 더 나쁜 쪽이
//   최종 상태를 결정한다(singleLegStance.js의 worse() 와 동일한 상태 병합 방식).
//
//  ⚠ 판정 한계:
//   · 자가 보고 값은 "질환" 진단이 아니다. 여기서는 측정된 패턴만 노출하고,
//     임상적 해석은 Momi/전문가 몫이다.
//   · 아래 임계값은 2026-07-28 설계 확정치(통증 NRS 구간은 사용자 확정,
//     피로도는 참고용 시작 기본값)이며, 실측 데이터가 쌓이면 조정될 수 있다.
// ════════════════════════════════════════════════════════════════════════

export const CONDITION_TUNING = {
  // ── 통증 NRS(Numeric Rating Scale, 0~10) — 임상 경도/중등도/심도 구간과 정렬 ──
  painCautionAt: 4,   // 4~6 중등도 → 주의
  painRiskAt: 7,       // 7~10 심도 → 위험

  // ── 피로도(1~5, 자가 보고) ──
  // 단독으로는 risk 를 확정하지 않는다(운동 후 흔한 경미한 피로와 구분하기 위함).
  // 통증과 동반될 때만 worse() 로 risk 까지 올라갈 수 있다.
  fatigueCautionAt: 4,
};

const STATUS_RANK = { normal: 0, caution: 1, risk: 2, unknown: 3 };
function worse(a, b) {
  return (STATUS_RANK[b] ?? 0) > (STATUS_RANK[a] ?? 0) ? b : a;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 자가 보고 컨디션 체크인 판정.
 * @param {object} input
 * @param {number|string} [input.fatigue]  피로도 1~5
 * @param {number|string} [input.painNrs]  통증 NRS 0~10
 * @param {string} [input.memo]            한줄메모
 * @returns {object} 결과(valid 플래그 포함)
 */
export function evaluateCondition(input = {}) {
  const fatigue = numOrNull(input.fatigue);
  const painNrs = numOrNull(input.painNrs);
  const memo = typeof input.memo === 'string' ? input.memo.trim() : '';

  if (fatigue == null && painNrs == null && !memo) {
    return {
      valid: false,
      status: 'unknown',
      reason: 'no_entry',
      message: '오늘 컨디션이 아직 기록되지 않았습니다.',
      fatigue: null,
      painNrs: null,
      memo: null,
      flags: [],
      painFlag: false,
    };
  }

  let status = 'normal';
  const flags = [];

  if (painNrs != null) {
    if (painNrs >= CONDITION_TUNING.painRiskAt) {
      flags.push('pain_high');
      status = worse(status, 'risk');
    } else if (painNrs >= CONDITION_TUNING.painCautionAt) {
      flags.push('pain_moderate');
      status = worse(status, 'caution');
    }
  }

  if (fatigue != null && fatigue >= CONDITION_TUNING.fatigueCautionAt) {
    flags.push('fatigue_elevated');
    status = worse(status, 'caution');
  }

  return {
    valid: true,
    status,
    reason: 'ok',
    flags,
    fatigue,
    painNrs,
    memo: memo || null,
    // 통증이 주의 이상이면 true — Momi 시스템 프롬프트의 기존 안전 홀드(레드플래그)
    // 워크플로우로 그대로 흘려보내는 트리거 플래그(momiPrompt.js PART A 섹션 2/5-1 참고).
    painFlag: painNrs != null && painNrs >= CONDITION_TUNING.painCautionAt,
  };
}
