// src/services/momiService.js
// 리포트 화면의 "🤖 모미에게 물어보기" 버튼이 사용하는 서비스.
// 기존 crossMeasureContext.js의 buildProblemFocus()로 요청 데이터를 만들어 /api/momi를 호출한다.

import { buildProblemFocus, buildCrossMeasureIntegration } from '../ai-measure/core/crossMeasureContext.js';
import { store, aiStore } from '../demoData';

// [모미 버그 수정 — 2026-07-28] 예전엔 buildCrossMeasureIntegration(member, kind)를 위치인자로
// 호출했는데, 실제 함수는 { kind, report, postureReports, romReports, gaitReports } 객체
// 하나를 받는다. 위치인자로 넘기면 첫 인자(member 객체)가 구조분해되면서 kind가 항상
// undefined가 되어 buildCrossMeasureIntegration이 매번 null을 반환했다 — 즉 자세·ROM·점프·
// 보행 리포트의 교차 컨텍스트가 라이브에서 한 번도 채워진 적이 없었다(SLST·스쿼트는 이
// 함수 자체가 애초에 다루지 않아 이번 수정 범위 밖 — 별도 확장이 필요하다).
async function loadCrossReports(memberId) {
  if (!memberId) return { postureReports: [], romReports: [], gaitReports: [] };
  // posture/rom/gait는 각각 지연 로딩이라, 리포트 화면에 진입할 때 그 화면 자신의 kind는
  // 이미 로드돼 있어도 나머지 종류는 비어 있을 수 있다 — ensureXReports로 먼저 채운다.
  const [postureReports, romReports, gaitReports] = await Promise.all([
    aiStore.ensurePostureReports(memberId),
    aiStore.ensureRomReports(memberId),
    aiStore.ensureGaitReports(memberId),
  ]);
  return { postureReports, romReports, gaitReports };
}

export async function askMomi({ kind, report, member, question } = {}) {
  if (!report || !member) {
    throw new Error('report와 member 정보가 필요합니다.');
  }

  const problemFocus = buildProblemFocus(kind, report);
  const { postureReports, romReports, gaitReports } = await loadCrossReports(member.id);
  const crossContext = buildCrossMeasureIntegration
    ? buildCrossMeasureIntegration({ kind, report, postureReports, romReports, gaitReports })
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

// [모미 신규] 최근 N일 컨디션 추이 — body 기록(store.getBodyRecords)에서 fatigue/painNrs가
// 있는 항목만 뽑아 날짜 역순으로 최근 며칠치를 요약한다. buildCrossMeasureIntegration은
// posture/rom/gait만 다루고 body(컨디션)는 대상에 없어 여기서 별도로 만든다.
export function buildConditionTrend(member, { days = 7 } = {}) {
  if (!member?.id) return { entries: [], summary: '최근 컨디션 기록 없음' };
  const records = store.getBodyRecords(member.id) || [];
  const entries = records
    .filter((r) => r && (r.fatigue != null || r.painNrs != null))
    .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
    .slice(0, days)
    .map((r) => ({
      date: r.recordedAt,
      fatigue: r.fatigue ?? null,
      painNrs: r.painNrs ?? null,
      status: r.conditionStatus ?? null,
    }));
  const flagged = entries.filter((e) => e.status === 'caution' || e.status === 'risk').length;
  const summary = entries.length
    ? `최근 ${entries.length}일 기록 중 ${flagged}일 주의 이상`
    : '최근 컨디션 기록 없음';
  return { entries, summary };
}

// [모미 신규] "오늘의 운동가이드" — 컨디션 체크인 저장 직후 호출. 기존 askMomi()와 같은
// /api/momi 엔드포인트를 kind:'daily'로 재사용한다(백엔드 momi.js는 kind에 관계없이
// 그대로 forwarding하므로 수정 불필요 — momiPrompt.js PART A 섹션 5-1에서 해석 규칙만 추가).
export async function askMomiDaily({ member, condition, question } = {}) {
  if (!member || !condition) {
    throw new Error('member와 condition 정보가 필요합니다.');
  }

  const problemFocus = buildProblemFocus('daily', condition);
  const trend = buildConditionTrend(member);

  const res = await fetch('/api/momi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'daily',
      report: problemFocus,
      member: { name: member.name, category: member.category || null },
      crossContext: { conditionTrend: trend },
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
