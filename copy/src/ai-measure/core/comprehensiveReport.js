// ai-measure/core/comprehensiveReport.js
// ════════════════════════════════════════════════════════════════════════
//  종합리포트 — 각 측정 결과 리포트(자세·ROM·보행·점프·바벨·신체정보)를
//  하나로 모아 일/주/월 단위로 통합 분석한다.
//
//  · 순수 함수만 둔다(카메라·Firestore 무관) → 단위 테스트 가능.
//  · 레코드 정규화는 unifiedReport.buildSummaryData 를 재사용해
//    측정 유형별 점수·핵심지표 추출 규칙을 한 곳(단일 진실)으로 유지한다.
//  · 주(week)는 CMS 캘린더 규약과 동일하게 "일요일 시작" 이다.
//    (calendar_weekstart 가드 참조 — 월요일 시작 금지)
//  · 이상 데이터 감지(findAnomalies)는 "삭제 후보 제안"일 뿐, 실제 삭제는
//    사용자가 화면에서 확인 후 수행한다(측정 정직성 — 자동 삭제 금지).
// ════════════════════════════════════════════════════════════════════════
import { buildSummaryData } from './unifiedReport';
import { toYMD, todayYMD } from '../../utils/dates';

// ── 측정 유형 라벨(표시용) ─────────────────────────────────
export const REPORT_TYPE_LABEL = {
  posture: '자세·체형',
  rom: 'ROM',
  gait: '보행·러닝',
  jump: '점프·RSI',
  vbt: '바벨 VBT',
  one_rm: '1RM 추정',
  general: '신체 정보·기타',
};
export const SOURCE_LABEL = {
  ai: '측정 세션',
  gait_reports: '보행 리포트',
  posture_reports: '자세 리포트',
  rom_reports: 'ROM 리포트',
};

const round1 = (v) => Math.round(v * 10) / 10;

// ── 날짜 유틸(기간 키) ─────────────────────────────────────
function parseYMD(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function isValidYMD(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd).slice(0, 10))
    && !Number.isNaN(parseYMD(ymd).getTime());
}
// 일요일 시작 주의 첫날(일요일) YMD. getDay(): 일=0..토=6 — 오프셋 = getDay() 그대로.
export function weekStartYMD(ymd) {
  const d = parseYMD(ymd);
  d.setDate(d.getDate() - d.getDay());
  return toYMD(d);
}
export function weekEndYMD(ymd) {
  const d = parseYMD(weekStartYMD(ymd));
  d.setDate(d.getDate() + 6);
  return toYMD(d);
}
export function monthStartYMD(ymd) { return `${String(ymd).slice(0, 7)}-01`; }
export function monthEndYMD(ymd) {
  const [y, m] = String(ymd).slice(0, 7).split('-').map(Number);
  return toYMD(new Date(y, m, 0)); // 다음 달 0일 = 이번 달 말일
}

// 기간 키: day → 'YYYY-MM-DD' / week → 'YYYY-MM-DD'(그 주 일요일) / month → 'YYYY-MM'
export function periodKeyOf(ymd, unit) {
  const day = String(ymd).slice(0, 10);
  if (unit === 'week') return weekStartYMD(day);
  if (unit === 'month') return day.slice(0, 7);
  return day;
}
export function periodRangeOf(key, unit) {
  if (unit === 'week') return { start: key, end: weekEndYMD(key) };
  if (unit === 'month') return { start: `${key}-01`, end: monthEndYMD(`${key}-01`) };
  return { start: key, end: key };
}
export function periodLabelOf(key, unit) {
  if (unit === 'week') {
    const { start, end } = periodRangeOf(key, unit);
    const [, m1, d1] = start.split('-');
    const [, m2, d2] = end.split('-');
    return `${start.slice(0, 4)}년 ${Number(m1)}/${Number(d1)} ~ ${Number(m2)}/${Number(d2)} 주`;
  }
  if (unit === 'month') {
    const [y, m] = key.split('-');
    return `${y}년 ${Number(m)}월`;
  }
  const [y, m, d] = key.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

// ── 레코드 정규화 ──────────────────────────────────────────
// ai 세션은 { menu, data: payload } 래퍼 — 신체정보(body 메뉴)면 measurements 로 지표 보강.
function bodyInfoMetrics(raw) {
  const m = raw?.data?.measurements || raw?.measurements || null;
  if (!m) return [];
  const out = [];
  if (m.weight != null)    out.push({ label: '체중', value: Number(m.weight), unit: 'kg' });
  if (m.height != null)    out.push({ label: '키', value: Number(m.height), unit: 'cm' });
  if (m.systolic != null)  out.push({ label: '최고혈압', value: Number(m.systolic), unit: 'mmHg' });
  if (m.diastolic != null) out.push({ label: '최저혈압', value: Number(m.diastolic), unit: 'mmHg' });
  return out;
}

/** 원본 1건 → 종합리포트 공통 레코드. 실패해도 throw 하지 않고 최소 형태를 반환. */
export function normalizeRecord(source, raw) {
  let summary;
  try { summary = buildSummaryData(raw || {}); }
  catch (e) { summary = { reportType: 'general', title: '', measuredAt: null, overallScore: null, keyMetrics: [] }; }

  // 측정일은 '원본 필드'에서만 취한다. buildSummaryData 의 measuredAt 은 값이 없을 때
  // 현재 시각으로 채워지므로(저장용 기본값), 여기서 쓰면 날짜 없는 레코드가
  // 오늘 날짜로 위장되어 이상 감지(날짜 없음)를 통과해 버린다.
  const measuredAt = raw?.measuredAt || raw?.createdAt || raw?.recordedAtFull
    || raw?.recordedAt || raw?.basic_info?.createdAt || null;
  const dateYMD = measuredAt ? toYMD(measuredAt) : null;

  // 점수: 원본에 점수 근거가 전혀 없으면 null 로 둔다(0점과 '점수 없음' 구분).
  const hasScoreSource = summary.overallScore != null && (
    summary.status !== 'unknown' || Number(summary.overallScore) > 0
  );
  const score = hasScoreSource ? Number(summary.overallScore) : null;
  // 원시 점수(정규화·클램프 전): 이상 감지(0~100 범위 이탈)는 이 값으로 판단한다.
  // buildSummaryData 는 저장용으로 점수를 0~100 에 맞추므로 140 같은 오염값이 감춰진다.
  const rawScoreCandidate = raw?.summary?.score ?? raw?.summary?.overallScore
    ?? raw?.overallScore ?? raw?.totalScore ?? raw?.score
    ?? raw?.analysis?.score ?? raw?.postureScore ?? null;
  const rawScore = Number.isFinite(Number(rawScoreCandidate)) ? Number(rawScoreCandidate) : null;

  let keyMetrics = Array.isArray(summary.keyMetrics) ? summary.keyMetrics.slice() : [];
  if (source === 'ai' && summary.reportType === 'general') {
    const extra = bodyInfoMetrics(raw);
    const seen = new Set(keyMetrics.map(k => k.label));
    extra.forEach(k => { if (!seen.has(k.label)) keyMetrics.push(k); });
  }
  keyMetrics = keyMetrics.filter(k => k && k.label != null && Number.isFinite(Number(k.value)))
    .map(k => ({ label: String(k.label), value: Number(k.value), unit: k.unit || '' }));

  return {
    id: raw?.id || null,
    source,                                   // 'ai' | 'gait_reports' | 'posture_reports' | 'rom_reports'
    sourceLabel: SOURCE_LABEL[source] || source,
    reportType: summary.reportType || 'general',
    typeLabel: REPORT_TYPE_LABEL[summary.reportType] || REPORT_TYPE_LABEL.general,
    title: raw?.menuTitle || summary.title || '',
    measuredAt,
    dateYMD,
    score,
    rawScore,
    statusKey: summary.status || 'unknown',
    statusLabel: summary.statusLabel || '',
    keyMetrics,
    raw: raw || {},
  };
}

/** 회원 1명의 모든 측정 소스 → 정규화 레코드 목록(최신순). */
export function collectMeasureRecords({ sessions = [], gaitReports = [], postureReports = [], romReports = [] } = {}) {
  const records = [
    ...sessions.map(r => normalizeRecord('ai', r)),
    ...gaitReports.map(r => normalizeRecord('gait_reports', r)),
    ...postureReports.map(r => normalizeRecord('posture_reports', r)),
    ...romReports.map(r => normalizeRecord('rom_reports', r)),
  ];
  return records.sort((a, b) => String(b.measuredAt || '').localeCompare(String(a.measuredAt || '')));
}

// ── 기간 그룹핑 ────────────────────────────────────────────
/** 레코드 → [{ key, unit, label, range, records }] 최신 기간 우선. 날짜 없는 레코드는 제외. */
export function groupByPeriod(records = [], unit = 'day') {
  const map = new Map();
  records.forEach(r => {
    if (!r.dateYMD || !isValidYMD(r.dateYMD)) return;
    const key = periodKeyOf(r.dateYMD, unit);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({
      key, unit,
      label: periodLabelOf(key, unit),
      range: periodRangeOf(key, unit),
      records: list,
    }));
}

// ── 통계 ───────────────────────────────────────────────────
function numStats(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return {
    count: v.length,
    avg: round1(sum / v.length),
    min: round1(Math.min(...v)),
    max: round1(Math.max(...v)),
    first: round1(v[v.length - 1]), // 레코드가 최신순이므로 마지막이 기간 내 첫 측정
    last: round1(v[0]),
    delta: round1(v[0] - v[v.length - 1]),
  };
}

/** 한 기간의 레코드 묶음 → 통계. */
export function buildPeriodStats(records = []) {
  const byType = {};
  const statusCounts = {};
  records.forEach(r => {
    (byType[r.reportType] ||= []).push(r);
    statusCounts[r.statusKey] = (statusCounts[r.statusKey] || 0) + 1;
  });

  const typeStats = Object.entries(byType).map(([type, list]) => {
    // 유형 안에서 핵심지표(라벨 단위) 통계 — 같은 지표의 회차 간 변화를 본다.
    const metricMap = new Map();
    list.forEach(r => r.keyMetrics.forEach(k => {
      if (!metricMap.has(k.label)) metricMap.set(k.label, { unit: k.unit, values: [] });
      metricMap.get(k.label).values.push(k.value);
    }));
    const metrics = [...metricMap.entries()]
      .map(([label, { unit, values }]) => ({ label, unit, ...numStats(values) }))
      .filter(m => m.count > 0);

    return {
      type,
      typeLabel: REPORT_TYPE_LABEL[type] || type,
      count: list.length,
      score: numStats(list.map(r => r.score)),
      metrics,
    };
  }).sort((a, b) => b.count - a.count);

  return {
    total: records.length,
    typeCount: typeStats.length,
    score: numStats(records.map(r => r.score)),
    statusCounts,
    typeStats,
  };
}

/** 종합리포트 본체: 기간 그룹 전체 + 각 기간 통계 + 전체 요약. */
export function buildComprehensiveReport(records = [], unit = 'day') {
  const periods = groupByPeriod(records, unit).map(p => ({ ...p, stats: buildPeriodStats(p.records) }));
  return {
    unit,
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    datedRecords: periods.reduce((a, p) => a + p.records.length, 0),
    overall: buildPeriodStats(records.filter(r => r.dateYMD && isValidYMD(r.dateYMD))),
    periods,
  };
}

// ── 이상 데이터 감지 ───────────────────────────────────────
//  삭제 "후보"를 사유와 함께 제안한다. 규칙:
//   ① 날짜 없음/형식 오류  ② 미래 날짜  ③ 원시 점수 범위 이탈(0~100 밖)
//      — 표시 점수는 저장 시 0~100 으로 클램프되므로 '원시 점수(rawScore)'로 판단
//   ④ 지표값 비정상(비유한수)  ⑤ 빈 결과(점수도 지표도 없음)
//   ⑥ 중복 의심(같은 소스·유형·시각(분)·점수)
//   ⑦ 통계적 특이치: 같은 유형 점수 표본 4개 이상에서 로버스트 z(중앙값·MAD) |M| > 3.5
//      — 평균·표준편차 방식은 특이치 자신이 편차를 부풀려 극단값을 놓친다
export function findAnomalies(records = [], { today = todayYMD() } = {}) {
  const out = [];
  const add = (record, reason) => {
    const hit = out.find(a => a.record === record);
    if (hit) { if (!hit.reasons.includes(reason)) hit.reasons.push(reason); }
    else out.push({ record, reasons: [reason] });
  };

  // ⑥ 중복 키 수집
  const dupKey = (r) => `${r.source}|${r.reportType}|${String(r.measuredAt || '').slice(0, 16)}|${r.score}`;
  const dupCount = new Map();
  records.forEach(r => dupCount.set(dupKey(r), (dupCount.get(dupKey(r)) || 0) + 1));

  // ⑦ 유형별 점수 z-score
  const byType = new Map();
  records.forEach(r => {
    if (!Number.isFinite(r.score)) return;
    if (!byType.has(r.reportType)) byType.set(r.reportType, []);
    byType.get(r.reportType).push(r.score);
  });
  const median = (arr) => {
    const v = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  };
  const zParams = new Map();
  byType.forEach((vals, type) => {
    if (vals.length < 4) return;
    const med = median(vals);
    const mad = median(vals.map(v => Math.abs(v - med)));
    if (mad > 0) zParams.set(type, { med, mad });
  });

  records.forEach(r => {
    if (!r.dateYMD || !isValidYMD(r.dateYMD)) add(r, '측정일 없음/형식 오류');
    else if (r.dateYMD > today) add(r, `미래 날짜(${r.dateYMD})`);
    const scoreForRange = r.rawScore != null ? r.rawScore : r.score;
    if (scoreForRange != null && (scoreForRange < 0 || scoreForRange > 100)) add(r, `점수 범위 이탈(${scoreForRange})`);
    if (r.keyMetrics.some(k => !Number.isFinite(k.value))) add(r, '지표값 비정상');
    if (r.score == null && r.keyMetrics.length === 0) add(r, '빈 결과(점수·지표 없음)');
    if (dupCount.get(dupKey(r)) > 1) add(r, '중복 의심(동일 시각·점수)');
    const zp = zParams.get(r.reportType);
    if (zp && Number.isFinite(r.score)) {
      const m = 0.6745 * (r.score - zp.med) / zp.mad; // modified z-score (Iglewicz–Hoaglin)
      if (Math.abs(m) > 3.5) add(r, `통계적 특이치(z=${round1(m)})`);
    }
  });

  return out;
}
