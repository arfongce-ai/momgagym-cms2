// src/services/momiService.js
// 리포트 화면의 "🤖 모미에게 물어보기" 버튼이 사용하는 서비스.
// 기존 crossMeasureContext.js의 buildProblemFocus()로 요청 데이터를 만들어 /api/momi를 호출한다.

import { buildProblemFocus, buildCombinedAssessment, buildCrossMeasureIntegration } from '../ai-measure/core/crossMeasureContext.js';
import { buildMemberBusinessContext } from '../ai-measure/core/memberBusinessContext.js';
import { store, aiStore } from '../demoData';
import { auth } from '../firebase.js';

export const MOMI_PROMPT_VERSION = '2.2';
const MOMI_TIMEOUT_MS = 30000;
const OMIT_REPORT_KEYS = /^(?:video|videoBlob|blob|image|imageData|photo|base64|frames|rawFrames|landmarks|poseLandmarks|samples|chunks|member)$/i;

// [역할별 응답 범위 2026-08-08] "관리자·트레이너 접근 구분을 모미에도 적용" 요청 대응.
// voiceCommandService.js와 동일 패턴 — 서버(functions/api/momi.js)가 이 토큰으로
// role을 직접 검증해서, 관리자만 비즈니스 인사이트를 받을 수 있게 한다.
async function getAuthHeader() {
  try {
    if (!auth.currentUser) throw new Error('로그인이 필요합니다.');
    const idToken = await auth.currentUser.getIdToken();
    if (!idToken) throw new Error('로그인이 만료되었습니다. 다시 로그인해주세요.');
    return { Authorization: `Bearer ${idToken}` };
  } catch (e) {
    console.warn('[momiService] ID 토큰 발급 실패:', e?.message || e);
    throw new Error(e?.message || '로그인 정보를 확인하지 못했습니다.');
  }
}

/** 미디어·프레임 원본은 빼고 질문에 필요한 정량값과 판정만 제한된 크기로 남긴다. */
export function compactReportForMomi(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 1000);
  if (depth >= 5) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => compactReportForMomi(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  const result = {};
  Object.entries(value).slice(0, 80).forEach(([key, item]) => {
    if (OMIT_REPORT_KEYS.test(key) || /(?:url|uri)$/i.test(key)) return;
    const compacted = compactReportForMomi(item, depth + 1);
    if (compacted !== undefined) result[key] = compacted;
  });
  return result;
}

async function postMomi(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MOMI_TIMEOUT_MS);
  try {
    const res = await fetch('/api/momi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `모미 호출 실패 (status ${res.status})`);
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('모미가 빈 응답을 반환했습니다.');
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('모미 응답 시간이 초과되었습니다. 다시 시도해주세요.');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// [모미 버그 수정 — 2026-07-28] 예전엔 buildCrossMeasureIntegration(member, kind)를 위치인자로
// 호출했는데, 실제 함수는 { kind, report, postureReports, romReports, gaitReports } 객체
// 하나를 받는다. 위치인자로 넘기면 첫 인자(member 객체)가 구조분해되면서 kind가 항상
// undefined가 되어 buildCrossMeasureIntegration이 매번 null을 반환했다 — 즉 자세·ROM·점프·
// 보행 리포트의 교차 컨텍스트가 라이브에서 한 번도 채워진 적이 없었다.
// [추가 확장 — 다음 세션] 위 수정 당시 SLST·스쿼트·VBT는 범위 밖으로 남겨뒀었다(전용
// 컬렉션이 없어 posture/rom/gait와 같은 방식으로 못 불러왔기 때문). stance/squat/lifting은
// 전용 컬렉션 없이 세션 목록(aiStore.getSessions)에서 menu 필드로 걸러 쓰는 게 이 프로젝트의
// 공식 설계이므로, 그 패턴을 그대로 따라 세 종류를 마저 채운다.
async function loadCrossReports(memberId) {
  if (!memberId) return { postureReports: [], romReports: [], gaitReports: [], liftingReports: [], stanceReports: [], squatReports: [] };
  const [postureReports, romReports, gaitReports, sessions] = await Promise.all([
    aiStore.ensurePostureReports(memberId),
    aiStore.ensureRomReports(memberId),
    aiStore.ensureGaitReports(memberId),
    aiStore.ensureSessions(memberId),
  ]);
  const byMenu = (menu) => (sessions || [])
    .filter((s) => s?.menu === menu && s?.data)
    .map((s) => ({ createdAt: s.recordedAtFull || s.recordedAt, ...s.data }));
  return {
    postureReports,
    romReports,
    gaitReports,
    liftingReports: byMenu('lifting'),
    stanceReports: byMenu('stance'),
    squatReports: byMenu('squat'),
  };
}

export async function askMomi({ kind, report, member, question, history } = {}) {
  if (!report || !member) {
    throw new Error('report와 member 정보가 필요합니다.');
  }

  // 후속 질문에도 현재 측정 근거를 다시 붙인다. ensure* 호출은 첫 로드 뒤 캐시를
  // 사용하므로 네트워크 중복보다 "두 번째 질문부터 원본 수치를 잃는 문제"를 막는
  // 편이 중요하다.
  const isFollowUp = Array.isArray(history) && history.length > 0;
  const problemFocus = buildProblemFocus(kind, report);
  const reportPayload = {
    summary: problemFocus,
    measurements: compactReportForMomi(report),
  };
  const { postureReports, romReports, gaitReports, liftingReports, stanceReports, squatReports } = await loadCrossReports(member.id);
  const crossContext = buildCrossMeasureIntegration
    ? buildCrossMeasureIntegration({ kind, report, postureReports, romReports, gaitReports, liftingReports, stanceReports, squatReports })
    : null;
  const businessContext = buildMemberBusinessContext(member);

  const data = await postMomi({
    kind,
    report: reportPayload,
    member: { name: member.name, category: member.category || null },
    crossContext,
    businessContext,
    question: question || null,
    history: isFollowUp ? history : null,
  });
  return data.text;
}

// [모미 신규] 여러 측정을 트레이너가 직접 골라 하나로 묶어 보는 "측정 종합 분석" 화면
// (CombinedAssessmentPanel.jsx)이 쓰는 데이터 로더. loadCrossReports와 같은 소스를 쓰되,
// kind 하나로 좁히지 않고 종류별 최신 1건씩만 뽑아 트레이너가 선택할 수 있게 돌려준다.
export async function loadLatestReportsByKind(memberId) {
  if (!memberId) return {};
  const { postureReports, romReports, gaitReports, liftingReports, stanceReports, squatReports } = await loadCrossReports(memberId);
  const latest = (list, filter) => {
    const f = filter ? (list || []).filter(filter) : (list || []);
    return [...f].sort((a, b) => Date.parse(b.createdAt || b.measuredAt || 0) - Date.parse(a.createdAt || a.measuredAt || 0))[0] || null;
  };
  const byKind = {
    posture: latest(postureReports),
    rom: latest(romReports),
    jump: latest(gaitReports, (r) => r?.kind === 'jump'),
    gait: latest(gaitReports, (r) => r?.kind === 'gait' || r?.metrics || r?.cadence),
    lifting: latest(liftingReports),
    stance: latest(stanceReports),
    squat: latest(squatReports),
  };
  return Object.fromEntries(Object.entries(byKind).filter(([, v]) => v));
}

// [모미 신규] 여러 측정을 트레이너가 고른 대로 결합해 종합 분석·평가를 만든다.
// buildCombinedAssessment(1~7개 임의 조합, 대칭 결합)를 그대로 감싼 얇은 래퍼.
export function buildMemberCombinedAssessment(byKind, selectedKinds) {
  const items = (selectedKinds || Object.keys(byKind || {}))
    .filter((k) => byKind?.[k])
    .map((kind) => ({ kind, report: byKind[kind] }));
  return buildCombinedAssessment(items);
}

// [모미 신규] "측정 종합 분석" 패널(CombinedAssessmentPanel.jsx)의 룰 기반 결과
// (buildMemberCombinedAssessment)를 모미에게 넘겨 자연어 통합 가이드를 받는다 —
// 자비스 로드맵 축1(트레이너 요청 기반 통합 분석)의 실제 구현.
// buildProblemFocus를 거치지 않는다: buildCombinedAssessment의 출력이 이미
// { severity, issues[], strengths[] } 로 problemFocus와 같은 모양이고, buildProblemFocus는
// kind별 raw report 해석용이라 'combined'에 대응하는 분기가 없다 — 그대로 넣으면
// 빈 결과가 나와 이미 계산된 통합 결과가 사라진다. momiPrompt.js 섹션 5-2 참고.
export async function askMomiCombined({ member, result, question } = {}) {
  if (!member?.id || !result) {
    throw new Error('member와 종합 분석 결과가 필요합니다.');
  }

  const data = await postMomi({
      kind: 'combined',
      report: {
        mode: 'problem_identification',
        severity: result.severity,
        primaryFinding: result.issues?.[0]?.text || result.strengths?.[0] || result.evaluation?.text || null,
        issues: result.issues || [],
        strengths: result.strengths || [],
        evaluationText: result.evaluation?.text || null,
        combinedKinds: result.combinedKinds || [],
        coverageScore: result.coverageScore ?? null,
      },
      member: { name: member.name, category: member.category || null },
      crossContext: null,
      question: question || null,
      history: null,
  });
  return data.text;
}

// [모미 신규] 최근 N일 컨디션 추이 — body 기록(store.getBodyRecords)에서 fatigue/painNrs가
// 있는 항목만 뽑아 날짜 역순으로 최근 며칠치를 요약한다. buildCrossMeasureIntegration은
// posture/rom/gait만 다루고 body(컨디션)는 대상에 없어 여기서 별도로 만든다.
export function buildConditionTrend(member, { days = 7, now = new Date() } = {}) {
  if (!member?.id) return { entries: [], summary: '최근 컨디션 기록 없음' };
  const records = store.getBodyRecords(member.id) || [];
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - Math.max(0, days - 1));
  const entries = records
    .filter((r) => r && (r.fatigue != null || r.painNrs != null))
    .filter((r) => {
      const date = new Date(r.recordedAt);
      return !Number.isNaN(date.getTime()) && date >= cutoff && date <= now;
    })
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
    .map((r) => ({
      date: r.recordedAt,
      fatigue: r.fatigue ?? null,
      painNrs: r.painNrs ?? null,
      status: r.conditionStatus ?? null,
    }));
  const flagged = entries.filter((e) => e.status === 'caution' || e.status === 'risk').length;
  const recordedDays = new Set(entries.map((entry) => String(entry.date).slice(0, 10))).size;
  const summary = entries.length
    ? `최근 ${days}일 중 ${recordedDays}일 기록 · 주의 이상 ${flagged}건`
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

  const data = await postMomi({
      kind: 'daily',
      report: { summary: problemFocus, measurements: compactReportForMomi(condition) },
      member: { name: member.name, category: member.category || null },
      crossContext: { conditionTrend: trend },
      question: question || null,
      history: null,
  });
  return data.text;
}
