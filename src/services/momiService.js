// src/services/momiService.js
// 리포트 화면의 "🤖 모미에게 물어보기" 버튼이 사용하는 서비스.
// 기존 crossMeasureContext.js의 buildProblemFocus()로 요청 데이터를 만들어 /api/momi를 호출한다.

import { buildProblemFocus, buildCrossMeasureIntegration } from '../ai-measure/core/crossMeasureContext.js';

export async function askMomi({ kind, report, member, question } = {}) {
  if (!report || !member) {
    throw new Error('report와 member 정보가 필요합니다.');
  }

  const problemFocus = buildProblemFocus(kind, report);
  const crossContext = buildCrossMeasureIntegration
    ? buildCrossMeasureIntegration(member, kind)
    : null;

  const res = await fetch('/api/momi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      report: problemFocus || report,
      member: { name: member.name, category: member.category || null },
      crossContext,
      question: question || null,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `모미 호출 실패 (status ${res.status})`);
  }

  const data = await res.json();
  return data.text;
}
