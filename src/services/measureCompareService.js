// measureCompareService.js — 회원별 회차 비교 + 센터 익명 집계 (2026-10, 2단계)
//
// 1단계(measureHistoryService)가 합친 기록 목록을 받아
//  - 측정 종류별·지표별 "회차 추이"와 이전/처음 대비 변화를 만들고
//  - 여러 회원의 기록을 개인 식별 없이 집계한다(최소 인원 미만이면 숨김).
// 판정은 하지 않는다: 방향(개선/주의)은 METRIC_DEFINITIONS 의 기준범위로만 정하고,
// 기준이 없는 지표는 변화량만 보여준다. 모두 순수 함수.

import { METRIC_DEFINITIONS, extractKeyMetrics } from '../ai-measure/core/unifiedReport';
import { computeChangeRow } from '../ai-measure/core/measurementComparison';
import { TYPE_LABEL, isInvalidPayload } from './measureHistoryService';
import { cadenceRangeFor, classifyGaitMode } from '../ai-measure/core/gaitMode';

export const MIN_AGGREGATE_MEMBERS = 5;

/** 기준범위(range.good)로 "좋은 방향"을 정한다. 기준이 없으면 neutral. */
export function modeForDefinition(def) {
  const good = def?.range?.good;
  if (!Array.isArray(good) || good.length !== 2) return { mode: 'neutral' };
  const [lo, hi] = good;
  if (lo === 0) return { mode: 'lowerBetter' };
  if (hi === 100 || hi / lo >= 4) return { mode: 'higherBetter' };
  return { mode: 'closerTargetBetter', target: (lo + hi) / 2 };
}

function numericValue(m) {
  return typeof m?.value === 'number' && Number.isFinite(m.value) ? m.value : null;
}

function changeRow(label, prev, cur, unit, def) {
  // [2026-10] 걷기/달리기가 섞인 케이던스 비교는 의미가 없어 제외, 목표는 현재 모드 기준.
  if (def?.key === 'cadence') {
    if (classifyGaitMode(prev) !== classifyGaitMode(cur)) return null;
    const g = cadenceRangeFor(cur).good;
    return computeChangeRow(label, prev, cur, unit, 'closerTargetBetter', (g[0] + g[1]) / 2);
  }
  // 입각기: 걷기/달리기 기준이 달라 값만으로 좋고 나쁨을 정할 수 없어 방향 판정 없이 변화량만 보여준다.
  if (def?.key === 'stancePct') {
    const row = computeChangeRow(label, prev, cur, unit, 'higherBetter');
    if (row) row.direction = row.diff === 0 ? 'same' : 'neutral';
    return row;
  }
  const { mode, target } = modeForDefinition(def);
  const row = computeChangeRow(label, prev, cur, unit, mode === 'neutral' ? 'higherBetter' : mode, target);
  if (row && mode === 'neutral') row.direction = row.diff === 0 ? 'same' : 'neutral';
  return row;
}

/**
 * 한 회원의 기록(entries, 최신순 가능)을 종류별·지표별 추이로 만든다.
 * 반환: [{ type, title, count, metrics: [{ key, label, unit, points:[{date,value}], latest, vsPrev, vsFirst }] }]
 * 신체정보(body)는 별도 화면이 있어 제외. 회차가 2개 이상인 지표만 비교 행이 생긴다.
 */
export function buildMemberTimelines(entries = []) {
  const byType = new Map();
  for (const e of entries) {
    if (!e || e.type === 'body') continue;
    // 무효 측정은 회차 비교·추이에서 뺀다(잘못된 변화량이 나오는 것 방지). 이력 목록에는 그대로 남는다.
    if (isInvalidPayload(e.payload)) continue;
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push(e);
  }
  const out = [];
  for (const [type, list] of byType) {
    const asc = [...list].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const defs = METRIC_DEFINITIONS[type] || [];
    const series = new Map(); // key -> {label, unit, points}
    for (const e of asc) {
      let metrics = [];
      try { metrics = extractKeyMetrics(e.payload || {}, type); } catch { metrics = []; }
      for (const m of metrics) {
        const v = numericValue(m);
        if (v == null) continue;
        if (!series.has(m.key)) series.set(m.key, { key: m.key, label: m.label, unit: m.unit, points: [] });
        series.get(m.key).points.push({ date: e.date, value: v });
      }
    }
    const metrics = [...series.values()].map((s) => {
      const def = defs.find((d) => d.key === s.key);
      const pts = s.points;
      const latest = pts[pts.length - 1];
      return {
        ...s,
        latest,
        vsPrev: pts.length >= 2 ? changeRow(s.label, pts[pts.length - 2].value, latest.value, s.unit, def) : null,
        vsFirst: pts.length >= 3 ? changeRow(s.label, pts[0].value, latest.value, s.unit, def) : null,
      };
    });
    if (metrics.length) out.push({ type, title: TYPE_LABEL[type] || '측정', count: asc.length, metrics });
  }
  // 회차가 많은 종류 먼저
  return out.sort((a, b) => b.count - a.count);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 여러 회원의 기록을 익명 집계한다. 입력은 회원별 entries 배열의 배열(회원 id 불필요).
 * minMembers 미만인 종류/지표는 결과에서 빼서 소수 회원이 드러나지 않게 한다.
 * 반환에는 회원 id·이름·날짜가 들어가지 않는다.
 */
export function aggregateAnonymous(entriesPerMember = [], minMembers = MIN_AGGREGATE_MEMBERS) {
  const types = new Map(); // type -> { members, sessions, metrics: Map(key -> {label,unit,latestPerMember[]}) }
  for (const entries of entriesPerMember) {
    const seenTypes = new Set();
    const grouped = new Map();
    for (const e of entries || []) {
      if (!e || e.type === 'body') continue;
      if (isInvalidPayload(e.payload)) continue;
      if (!grouped.has(e.type)) grouped.set(e.type, []);
      grouped.get(e.type).push(e);
    }
    for (const [type, list] of grouped) {
      if (!types.has(type)) types.set(type, { members: 0, sessions: 0, metrics: new Map() });
      const t = types.get(type);
      if (!seenTypes.has(type)) { t.members += 1; seenTypes.add(type); }
      t.sessions += list.length;
      const latest = [...list].sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
      let metrics = [];
      try { metrics = extractKeyMetrics(latest.payload || {}, type); } catch { metrics = []; }
      for (const m of metrics) {
        const v = numericValue(m);
        if (v == null) continue;
        if (!t.metrics.has(m.key)) t.metrics.set(m.key, { key: m.key, label: m.label, unit: m.unit, values: [] });
        t.metrics.get(m.key).values.push(v);
      }
    }
  }
  const result = [];
  for (const [type, t] of types) {
    if (t.members < minMembers) continue;
    const metrics = [...t.metrics.values()]
      .filter((m) => m.values.length >= minMembers)
      .map((m) => ({ key: m.key, label: m.label, unit: m.unit, n: m.values.length, median: Math.round(median(m.values) * 10) / 10 }));
    result.push({ type, title: TYPE_LABEL[type] || '측정', members: t.members, sessions: t.sessions, metrics });
  }
  return result.sort((a, b) => b.members - a.members);
}
