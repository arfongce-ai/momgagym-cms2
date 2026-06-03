// services/reportService.js
// 리포트용 데이터 가공. 카메라와 무관하게 순수 함수 → 단위 테스트 가능.
//
// 명세:
//  - 실제 측정된 데이터만 필터링 (값이 없는 항목 제외)
//  - 측정값은 최대값(Max) 기준 표시
//  - 회차별 누적(시계열) 데이터 생성
//  - 키/몸무게/혈압 포함

/** 숫자로 유효한 값만 추출 (null/undefined/'' 제외) */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 신체정보 기록 배열 → 시계열 + 최신/최대값 요약.
 * @param {Array} bodyRecords [{recordedAt, height, weight, systolic, diastolic}, ...]
 */
export function buildBodyReport(bodyRecords = []) {
  // 날짜 오름차순 정렬
  const sorted = [...bodyRecords].sort((a, b) =>
    String(a.recordedAt).localeCompare(String(b.recordedAt))
  );

  const FIELDS = [
    { key: 'height',    label: '키',       unit: 'cm'   },
    { key: 'weight',    label: '몸무게',   unit: 'kg'   },
    { key: 'systolic',  label: '최고혈압', unit: 'mmHg' },
    { key: 'diastolic', label: '최저혈압', unit: 'mmHg' },
  ];

  const series = {};   // key → [{date, value}]
  const summary = [];  // 실측 항목만

  for (const f of FIELDS) {
    const points = sorted
      .map(r => ({ date: r.recordedAt, value: num(r[f.key]) }))
      .filter(p => p.value != null);

    if (points.length === 0) continue; // 실측 없는 항목 제외(명세)

    series[f.key] = points;
    const values = points.map(p => p.value);
    const latest = points[points.length - 1];
    const first  = points[0];

    summary.push({
      key: f.key,
      label: f.label,
      unit: f.unit,
      max: Math.max(...values),                 // 최대값 기준(명세)
      min: Math.min(...values),
      latest: latest.value,
      latestDate: latest.date,
      change: points.length > 1 ? Number((latest.value - first.value).toFixed(1)) : null,
      count: points.length,
    });
  }

  return { fields: FIELDS, series, summary, recordCount: sorted.length };
}

/**
 * AI 측정 세션 배열 → 메뉴별 그룹 + 각 측정의 핵심 수치 추출.
 * @param {Array} aiSessions
 */
export function buildAiReport(aiSessions = []) {
  const sorted = [...aiSessions].sort((a, b) =>
    String(a.recordedAtFull || a.recordedAt).localeCompare(String(b.recordedAtFull || b.recordedAt))
  );

  // 메뉴별 그룹
  const byMenu = {};
  for (const s of sorted) {
    const menu = s.menuTitle || s.menu || '기타';
    if (!byMenu[menu]) byMenu[menu] = [];
    byMenu[menu].push(s);
  }

  // 자세 측정(posture)은 어깨/골반/중심선 각도를 시계열로
  const postureSeries = {};
  const postureRows = sorted.filter(s => s.menu === 'posture' && s.data);
  if (postureRows.length) {
    postureSeries.shoulder = postureRows
      .map(s => ({ date: s.recordedAt, value: s.data.shoulderTilt?.deg }))
      .filter(p => p.value != null);
    postureSeries.hip = postureRows
      .map(s => ({ date: s.recordedAt, value: s.data.hipTilt?.deg }))
      .filter(p => p.value != null);
    postureSeries.centerline = postureRows
      .map(s => ({ date: s.recordedAt, value: s.data.centerlineDeg != null ? Math.abs(s.data.centerlineDeg) : null }))
      .filter(p => p.value != null);
  }

  // 메뉴별 측정 요약 (리포트 표시용) — 각 메뉴의 핵심 수치 1줄
  const menuSummaries = [];
  for (const [menuTitle, rows] of Object.entries(byMenu)) {
    const latest = rows[rows.length - 1];
    const d = latest.data || {};
    let metric = '';
    switch (latest.menu) {
      case 'onerm':   metric = `1RM ${d.oneRM ?? '-'}kg (${d.liftLabel ?? ''} ${d.weight}kg×${d.reps})`; break;
      case 'rsi':     metric = `RSI ${d.rsi ?? '-'} · 높이 ${d.heightCm ?? '-'}cm`; break;
      case 'vbt':     metric = `평균속도 ${d.meanVelocity ?? '-'}m/s (${d.zone ?? ''})`; break;
      case 'jump':    metric = `높이 ${d.heightCm ?? '-'}cm${d.peakPower ? ` · ${d.peakPower}W` : ''}`; break;
      case 'posture': metric = `어깨 ${d.shoulderTilt?.deg ?? '-'}° · 골반 ${d.hipTilt?.deg ?? '-'}°`; break;
      case 'body':    metric = `${d.weight ?? '-'}kg${d.systolic ? ` · ${d.systolic}/${d.diastolic}` : ''}`; break;
      default:        metric = `${rows.length}회 측정`;
    }
    menuSummaries.push({
      menu: latest.menu,
      title: menuTitle,
      count: rows.length,
      latestDate: latest.recordedAt,
      metric,
    });
  }

  return { byMenu, postureSeries, menuSummaries, sessionCount: sorted.length };
}

/**
 * 종합 리포트 — 실측 데이터만 모아 텍스트 설명 포함.
 */
export function buildFullReport({ member, bodyRecords, aiSessions }) {
  const body = buildBodyReport(bodyRecords);
  const ai = buildAiReport(aiSessions);

  // 텍스트 설명 자동 생성 (실측 항목 기반)
  const notes = [];
  for (const s of body.summary) {
    if (s.change == null) {
      notes.push(`${s.label}: ${s.latest}${s.unit} (최초 측정)`);
    } else {
      const dir = s.change > 0 ? '증가' : s.change < 0 ? '감소' : '변화 없음';
      const arrow = s.change > 0 ? '▲' : s.change < 0 ? '▼' : '–';
      notes.push(`${s.label}: ${s.latest}${s.unit} (최초 대비 ${arrow}${Math.abs(s.change)}${s.unit} ${dir}, 최대 ${s.max}${s.unit})`);
    }
  }
  if (ai.postureSeries.shoulder?.length) {
    const last = ai.postureSeries.shoulder.at(-1);
    notes.push(`어깨 기울기 최근값 ${last.value}° (낮을수록 균형)`);
  }

  const hasData = body.summary.length > 0 || ai.sessionCount > 0;

  return {
    member,
    generatedAt: new Date().toISOString(),
    body,
    ai,
    notes,
    hasData,
  };
}
