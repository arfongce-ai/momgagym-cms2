// measureHistoryService.js — 회원 측정 이력 통합 (2026-10)
//
// 배경: 신규 측정은 `ai`(세션) + 전용 컬렉션(gait/posture/rom_reports)에 이중 저장되고,
// 과거 기록은 전용 컬렉션에만 있는 경우가 있다. 이력 탭이 `ai` 만 읽으면 그런 회원은 비어 보인다.
// 이 모듈은 네 컬렉션을 한 목록으로 합치고, 메뉴마다 제각각인 신뢰도 표기를 0~100 으로 맞춘다.
// 순수 함수(mergeMeasureEntries, normalizeConfidence)는 테스트 가능하게 분리했다.

import { aiStore } from '../demoData';
import { extractKeyMetrics, inferReportType, METRIC_DEFINITIONS } from '../ai-measure/core/unifiedReport';

export const TYPE_LABEL = Object.freeze({
  body: '신체정보',
  posture: '자세측정',
  rom: '관절가동범위(ROM)',
  gait: '보행',
  jump: '점프',
  sprint: '스프린트',
  agility: '민첩성',
  stance: '한다리서기',
  squat: '스쿼트',
  vbt: '바벨 속도(VBT)',
  one_rm: '1RM',
  general: '측정',
});

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(v) {
  return String(v || '').slice(0, 10);
}

function isoOf(item) {
  return String(item?.recordedAtFull || item?.createdAt || item?.measuredAt || item?.recordedAt || '');
}

/**
 * 신뢰도를 0~100 정수로 맞춘다. 값이 없으면 { pct: null, source: '' }.
 * 메뉴별 현황(2026-10 점검):
 *  - VBT·1RM·ROM(센서): confidenceScore 0~1
 *  - ROM 통합평가: integrated_assessment.confidenceScore 0~100
 *  - 자세: analysis.reliability (검출된 주요 관절 수 / 필요 수)
 *  - 2026-10 이후 모든 카메라 측정: recognition.ratio(주요 관절이 또렷이 인식된 프레임 비율, 0~1)
 *  - 그 이전 보행·점프·스프린트·한다리서기·스쿼트: 저장된 값 없음 → describeEntry 가 데이터 충족도로 대신함
 */
export function normalizeConfidence(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const d = p.data && typeof p.data === 'object' ? p.data : {};
  const candidates = [
    ['confidenceScore', p.confidenceScore], ['metrics.confidenceScore', p.metrics?.confidenceScore],
    ['data.confidenceScore', d.confidenceScore], ['data.metrics.confidenceScore', d.metrics?.confidenceScore],
    ['integrated_assessment.confidenceScore', p.integrated_assessment?.confidenceScore],
    ['data.integrated_assessment.confidenceScore', d.integrated_assessment?.confidenceScore],
    // 측정 인식률(2026-10~): 저장 시 recognitionStats 가 계산한 0~1 비율
    ['recognition.ratio', p.recognition?.ratio],
    ['data.recognition.ratio', d.recognition?.ratio],
  ];
  for (const [source, raw] of candidates) {
    const n = asNumber(raw);
    if (n == null) continue;
    const pct = n <= 1 ? n * 100 : n; // 0~1 이면 백분율로
    return { pct: Math.max(0, Math.min(100, Math.round(pct))), source };
  }
  const rel = p.analysis?.reliability || d.analysis?.reliability;
  const valid = asNumber(rel?.validCount);
  const need = asNumber(rel?.requiredCount);
  if (valid != null && need) {
    return { pct: Math.max(0, Math.min(100, Math.round((valid / need) * 100))), source: 'analysis.reliability' };
  }
  return { pct: null, source: '' };
}

/**
 * 데이터 충족도(0~100): 측정 엔진이 신뢰도를 저장하지 않는 메뉴(보행·점프·스프린트·한다리서기·스쿼트 등)용.
 * 그 종류의 핵심 지표 중 실제 값이 들어 있는 비율이다. 카메라 인식 품질이 아니라
 * "기록이 얼마나 빠짐없이 저장됐는지"이므로 화면에서 신뢰도와 다른 이름으로 표시한다.
 * 무효 측정(valid === false)은 0.
 */
/** 무효 측정 여부. 보행은 metrics.valid, 점프 등은 valid 에 담는다. */
export function isInvalidPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const d = p.data && typeof p.data === 'object' ? p.data : {};
  return p.valid === false || d.valid === false || p.metrics?.valid === false || d.metrics?.valid === false;
}

export function deriveCoverage(payload, type, metrics) {
  const defs = METRIC_DEFINITIONS[type];
  if (!defs || !defs.length) return { pct: null, source: '' };
  if (isInvalidPayload(payload)) return { pct: 0, source: 'derived.coverage' };
  const found = Array.isArray(metrics) ? metrics.length : 0;
  return { pct: Math.max(0, Math.min(100, Math.round((found / defs.length) * 100))), source: 'derived.coverage' };
}

/**
 * 네 컬렉션을 한 목록으로 합친다(최신순).
 *  - 세션(ai)과 linkedSessionId 로 연결된 전용 리포트는 한 항목으로 묶는다(정량값은 전용 리포트 우선).
 *  - 세션 없이 전용 리포트만 있는 과거 기록은 독립 항목으로 남긴다.
 *  - 신체정보 세션(measurements 보유)은 type 'body'.
 */
export function mergeMeasureEntries({ sessions = [], gait = [], posture = [], rom = [] } = {}) {
  const reports = [
    ...gait.map(r => ({ r, col: 'gait_reports' })),
    ...posture.map(r => ({ r, col: 'posture_reports' })),
    ...rom.map(r => ({ r, col: 'rom_reports' })),
  ].filter(x => x.r && x.r.id);

  const bySession = new Map();
  const orphans = [];
  for (const x of reports) {
    const sid = x.r.linkedSessionId;
    if (sid && sessions.some(s => s?.id === sid)) {
      if (!bySession.has(sid)) bySession.set(sid, []);
      bySession.get(sid).push(x);
    } else {
      orphans.push(x);
    }
  }

  const entries = [];
  for (const s of sessions) {
    if (!s || !s.id) continue;
    const linked = bySession.get(s.id) || [];
    const main = linked[0]?.r || null;
    const payload = main || (s.data && typeof s.data === 'object' ? { ...s.data, kind: s.data.kind || s.menu } : s);
    let type = s.measurements ? 'body' : inferReportType(main ? main : { ...s });
    if (type === 'general' && s.menu) type = String(s.menu);
    entries.push({
      id: s.id,
      sessionId: s.id,
      reportId: main?.id || '',
      reportCollection: linked[0]?.col || '',
      source: main ? 'session+report' : 'session',
      type,
      title: s.menuTitle || TYPE_LABEL[type] || '측정',
      date: s.recordedAt || dateOnly(isoOf(s)),
      at: isoOf(s) || isoOf(main),
      memo: s.memo || '',
      session: s,
      payload,
      trainerReview: s.trainerReview || main?.trainerReview || null,
    });
  }
  for (const { r, col } of orphans) {
    const type = inferReportType(r);
    entries.push({
      id: r.id,
      sessionId: '',
      reportId: r.id,
      reportCollection: col,
      source: 'report',
      type,
      title: TYPE_LABEL[type] || '측정',
      date: dateOnly(isoOf(r)),
      at: isoOf(r),
      memo: r.memo || '',
      session: null,
      payload: r,
      trainerReview: r.trainerReview || null,
    });
  }

  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return entries;
}

/** 항목의 대표 지표(최대 limit개)와 신뢰도. 신체정보는 별도 카드가 처리하므로 빈 배열. */
export function describeEntry(entry, limit = 4) {
  if (!entry || entry.type === 'body') return { metrics: [], confidence: { pct: null, source: '' } };
  let metrics = [];
  let all = [];
  try {
    all = extractKeyMetrics(entry.payload || {}, entry.type);
    metrics = all.slice(0, limit);
  } catch (e) {
    console.warn('[describeEntry] 지표 추출 실패:', e?.message);
  }
  const confidence = normalizeConfidence(entry.payload);
  // 저장된 신뢰도가 없으면 데이터 충족도로 대신한다(source 가 'derived.coverage').
  return { metrics, confidence: confidence.pct != null ? confidence : deriveCoverage(entry.payload, entry.type, all) };
}

/** 회원 한 명의 모든 측정 기록을 읽어 합친 목록을 돌려준다. */
export async function loadMeasureEntries(mid) {
  if (!mid) return [];
  const [sessions, gait, posture, rom] = await Promise.all([
    aiStore.ensureSessions(mid),
    aiStore.ensureGaitReports(mid),
    aiStore.ensurePostureReports(mid),
    aiStore.ensureRomReports(mid),
  ]);
  return mergeMeasureEntries({ sessions, gait, posture, rom });
}
