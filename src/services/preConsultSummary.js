// preConsultSummary.js — 상담 전 요약 (2026-10, 3단계)
//
// 회원 한 명의 기록(measureHistoryService.loadMeasureEntries 결과)에서 상담 직전에 볼 것만 뽑는다.
//  1) 지난 회차 대비 변화(개선/주의)  2) 트레이너 확인 전 항목  3) 인식률·충족도가 낮은 기록  4) 측정 공백
// 판정을 새로 만들지 않는다: 방향은 buildMemberTimelines(기준범위 기반)가 이미 정한 값을 그대로 쓴다.
// 순수 함수. now 를 받아 테스트할 수 있게 했다.

import { buildMemberTimelines } from './measureCompareService';
import { describeEntry, TYPE_LABEL } from './measureHistoryService';

export const LOW_CONFIDENCE_PCT = 60;
export const STALE_DAYS = 60;

function daysBetween(fromIso, now) {
  const t = Date.parse(fromIso || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

export function buildPreConsultSummary(entries = [], { now = Date.now(), maxChanges = 5 } = {}) {
  const measured = (entries || []).filter((e) => e && e.type !== 'body');
  if (!measured.length) return { empty: true, total: 0 };

  // 1) 변화: 종류별 최신 대비 이전 변화 중 개선/주의만, 변화폭 큰 순
  const rows = [];
  for (const t of buildMemberTimelines(entries)) {
    for (const m of t.metrics) {
      const r = m.vsPrev;
      if (r && (r.direction === 'improved' || r.direction === 'worsened')) {
        rows.push({ type: t.type, typeLabel: t.title, label: m.label, diff: r.diff, unit: r.unit, direction: r.direction, date: m.latest?.date });
      }
    }
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const improved = rows.filter((r) => r.direction === 'improved').slice(0, maxChanges);
  const worsened = rows.filter((r) => r.direction === 'worsened').slice(0, maxChanges);

  // 2) 트레이너 확인 전
  const unreviewed = measured.filter((e) => !e.trainerReview).map((e) => ({ id: e.id, title: e.title, date: e.date }));

  // 3) 인식률·충족도 낮은 기록
  const lowQuality = [];
  for (const e of measured) {
    const { confidence } = describeEntry(e);
    if (confidence.pct != null && confidence.pct < LOW_CONFIDENCE_PCT) {
      lowQuality.push({ id: e.id, title: e.title, date: e.date, pct: confidence.pct, source: confidence.source });
    }
  }

  // 4) 종류별 마지막 측정이 오래됨
  const lastByType = new Map();
  for (const e of measured) {
    const cur = lastByType.get(e.type);
    if (!cur || String(e.at) > String(cur.at)) lastByType.set(e.type, e);
  }
  const stale = [];
  for (const [type, e] of lastByType) {
    const days = daysBetween(e.at, now);
    if (days != null && days >= STALE_DAYS) stale.push({ type, title: TYPE_LABEL[type] || '측정', date: e.date, days });
  }
  stale.sort((a, b) => b.days - a.days);

  const latest = measured.reduce((a, b) => (String(a.at) >= String(b.at) ? a : b));
  return {
    empty: false,
    total: measured.length,
    latestDate: latest.date,
    daysSinceLatest: daysBetween(latest.at, now),
    improved, worsened, unreviewed, lowQuality, stale,
  };
}
