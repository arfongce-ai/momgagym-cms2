// src/__tests__/comprehensive_report.test.js
// 종합리포트 — 수집·정규화 / 일·주·월 그룹핑 / 통계 / 이상 데이터 감지.
import { describe, it, expect } from 'vitest';
import {
  normalizeRecord, collectMeasureRecords,
  periodKeyOf, periodRangeOf, periodLabelOf, weekStartYMD,
  groupByPeriod, buildPeriodStats, buildComprehensiveReport,
  findAnomalies, REPORT_TYPE_LABEL,
} from '../ai-measure/core/comprehensiveReport';

// ── 테스트 픽스처: 실제 저장 형태를 모사 ──────────────────
const posture = (id, ymd, score) => ({
  id, kind: 'posture', createdAt: `${ymd}T09:00:00.000Z`,
  summary: { score },
  analysis: { frontal: {} },
});
const gait = (id, ymd, score) => ({
  id, kind: 'gait', createdAt: `${ymd}T10:00:00.000Z`,
  summary: { score },
});
const bodySession = (id, ymd, weight) => ({
  id, menu: 'body', menuTitle: '신체 정보',
  recordedAt: ymd, recordedAtFull: `${ymd}T08:30:00.000Z`,
  data: { measurements: { weight, systolic: 120, diastolic: 80 } },
});

describe('normalizeRecord — 소스별 정규화', () => {
  it('자세 리포트가 유형·날짜·점수로 정규화된다', () => {
    const r = normalizeRecord('posture_reports', posture('p1', '2026-07-06', 82));
    expect(r.reportType).toBe('posture');
    expect(r.typeLabel).toBe(REPORT_TYPE_LABEL.posture);
    expect(r.dateYMD).toBe('2026-07-06');
    expect(r.score).toBe(82);
    expect(r.source).toBe('posture_reports');
  });

  it('신체정보 세션은 점수 없이 체중·혈압 지표를 갖는다', () => {
    const r = normalizeRecord('ai', bodySession('a1', '2026-07-06', 71.5));
    expect(r.reportType).toBe('general');
    expect(r.score).toBe(null); // 점수 근거 없음 → 0점이 아니라 '없음'
    const labels = r.keyMetrics.map(k => k.label);
    expect(labels).toContain('체중');
    expect(labels).toContain('최고혈압');
    expect(r.keyMetrics.find(k => k.label === '체중').value).toBe(71.5);
  });

  it('깨진 원본도 throw 없이 최소 형태로 정규화된다', () => {
    const r = normalizeRecord('ai', null);
    expect(r.id).toBe(null);
    expect(r.dateYMD).toBe(null);
    expect(r.keyMetrics).toEqual([]);
  });
});

describe('collectMeasureRecords — 통합 수집(최신순)', () => {
  it('4개 소스를 합쳐 최신순으로 정렬한다', () => {
    const records = collectMeasureRecords({
      sessions: [bodySession('a1', '2026-07-01', 71)],
      gaitReports: [gait('g1', '2026-07-08', 75)],
      postureReports: [posture('p1', '2026-07-06', 82)],
      romReports: [],
    });
    expect(records.map(r => r.id)).toEqual(['g1', 'p1', 'a1']);
  });
});

describe('기간 키 — 일/주(일요일 시작)/월', () => {
  it('week 키는 그 주 일요일이다 (CMS 캘린더 규약과 동일)', () => {
    // 2026-07-06(월) → 그 주 일요일은 2026-07-05
    expect(weekStartYMD('2026-07-06')).toBe('2026-07-05');
    // 일요일 자신은 그대로
    expect(weekStartYMD('2026-07-05')).toBe('2026-07-05');
    // 토요일은 같은 주(앞 일요일)
    expect(weekStartYMD('2026-07-11')).toBe('2026-07-05');
    expect(periodKeyOf('2026-07-06', 'week')).toBe('2026-07-05');
  });

  it('주 범위는 일~토 7일이고 월 범위는 1일~말일이다', () => {
    expect(periodRangeOf('2026-07-05', 'week')).toEqual({ start: '2026-07-05', end: '2026-07-11' });
    expect(periodRangeOf('2026-02', 'month')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRangeOf('2024-02', 'month')).toEqual({ start: '2024-02-01', end: '2024-02-29' }); // 윤년
  });

  it('day/month 키와 라벨', () => {
    expect(periodKeyOf('2026-07-06', 'day')).toBe('2026-07-06');
    expect(periodKeyOf('2026-07-06', 'month')).toBe('2026-07');
    expect(periodLabelOf('2026-07', 'month')).toBe('2026년 7월');
    expect(periodLabelOf('2026-07-06', 'day')).toBe('2026년 7월 6일');
  });
});

describe('groupByPeriod — 같은 일/주/월 묶기', () => {
  const records = collectMeasureRecords({
    postureReports: [posture('p1', '2026-07-06', 80), posture('p2', '2026-07-06', 84)],
    gaitReports: [gait('g1', '2026-07-08', 75), gait('g2', '2026-06-30', 70)],
  });

  it('같은 일 단위: 07-06 두 건이 한 그룹', () => {
    const groups = groupByPeriod(records, 'day');
    const g0706 = groups.find(g => g.key === '2026-07-06');
    expect(g0706.records.length).toBe(2);
    expect(groups[0].key).toBe('2026-07-08'); // 최신 기간 우선
  });

  it('같은 주 단위: 07-05 주에 3건(06·06·08), 06-28 주에 1건(6/30)', () => {
    const groups = groupByPeriod(records, 'week');
    expect(groups.find(g => g.key === '2026-07-05').records.length).toBe(3);
    expect(groups.find(g => g.key === '2026-06-28').records.length).toBe(1);
  });

  it('같은 월 단위: 7월 3건, 6월 1건', () => {
    const groups = groupByPeriod(records, 'month');
    expect(groups.find(g => g.key === '2026-07').records.length).toBe(3);
    expect(groups.find(g => g.key === '2026-06').records.length).toBe(1);
  });

  it('날짜 없는 레코드는 그룹에서 제외된다', () => {
    const withBad = [...records, normalizeRecord('ai', { id: 'x', data: {} })];
    const groups = groupByPeriod(withBad, 'month');
    const total = groups.reduce((a, g) => a + g.records.length, 0);
    expect(total).toBe(4);
  });
});

describe('buildPeriodStats — 데이터 통계', () => {
  it('유형별 건수·점수 min/avg/max·기간 내 변화(delta)를 계산한다', () => {
    const records = collectMeasureRecords({
      postureReports: [posture('p1', '2026-07-06', 80), posture('p2', '2026-07-08', 86)],
    });
    const stats = buildPeriodStats(records);
    expect(stats.total).toBe(2);
    const ps = stats.typeStats.find(t => t.type === 'posture');
    expect(ps.count).toBe(2);
    expect(ps.score.min).toBe(80);
    expect(ps.score.max).toBe(86);
    expect(ps.score.avg).toBe(83);
    expect(ps.score.first).toBe(80); // 기간 내 첫 측정
    expect(ps.score.last).toBe(86);  // 기간 내 마지막 측정
    expect(ps.score.delta).toBe(6);  // 개선 +6
  });

  it('핵심지표(체중 등) 통계도 라벨 단위로 계산한다', () => {
    const records = collectMeasureRecords({
      sessions: [bodySession('a1', '2026-07-01', 72), bodySession('a2', '2026-07-08', 71)],
    });
    const stats = buildPeriodStats(records);
    const general = stats.typeStats.find(t => t.type === 'general');
    const weight = general.metrics.find(m => m.label === '체중');
    expect(weight.count).toBe(2);
    expect(weight.avg).toBe(71.5);
    expect(weight.delta).toBe(-1); // 72 → 71 감량
  });

  it('점수 없는 레코드만 있으면 score 통계는 null', () => {
    const records = collectMeasureRecords({ sessions: [bodySession('a1', '2026-07-01', 70)] });
    expect(buildPeriodStats(records).score).toBe(null);
  });
});

describe('buildComprehensiveReport — 종합', () => {
  it('기간 그룹마다 통계가 붙고 전체 요약이 함께 온다', () => {
    const records = collectMeasureRecords({
      postureReports: [posture('p1', '2026-07-06', 80)],
      gaitReports: [gait('g1', '2026-06-30', 70)],
    });
    const rep = buildComprehensiveReport(records, 'month');
    expect(rep.unit).toBe('month');
    expect(rep.periods.length).toBe(2);
    expect(rep.periods[0].stats.total).toBe(1);
    expect(rep.overall.total).toBe(2);
    expect(rep.overall.typeCount).toBe(2);
  });
});

describe('findAnomalies — 이상 데이터 감지(삭제 후보 제안)', () => {
  const today = '2026-07-12';

  it('미래 날짜·점수 범위 이탈·빈 결과를 사유와 함께 잡는다', () => {
    const records = [
      normalizeRecord('posture_reports', posture('future', '2026-08-01', 80)),
      normalizeRecord('posture_reports', posture('over', '2026-07-01', 140)),
      normalizeRecord('ai', { id: 'empty', recordedAt: '2026-07-02', recordedAtFull: '2026-07-02T09:00:00.000Z', data: {} }),
      normalizeRecord('posture_reports', posture('ok', '2026-07-03', 75)),
    ];
    const anomalies = findAnomalies(records, { today });
    const ids = anomalies.map(a => a.record.id);
    expect(ids).toContain('future');
    expect(ids).toContain('over');
    expect(ids).toContain('empty');
    expect(ids).not.toContain('ok');
    expect(anomalies.find(a => a.record.id === 'future').reasons.join()).toMatch(/미래 날짜/);
    expect(anomalies.find(a => a.record.id === 'over').reasons.join()).toMatch(/점수 범위/);
    expect(anomalies.find(a => a.record.id === 'empty').reasons.join()).toMatch(/빈 결과/);
  });

  it('동일 시각·점수의 중복 저장을 의심 표시한다', () => {
    const dup = posture('d1', '2026-07-03', 75);
    const records = [
      normalizeRecord('posture_reports', dup),
      normalizeRecord('posture_reports', { ...dup, id: 'd2' }),
    ];
    const anomalies = findAnomalies(records, { today });
    expect(anomalies.length).toBe(2);
    expect(anomalies[0].reasons.join()).toMatch(/중복 의심/);
  });

  it('같은 유형 표본 4개 이상에서 극단 점수를 통계적 특이치로 잡는다', () => {
    const records = [
      posture('n1', '2026-07-01', 80), posture('n2', '2026-07-02', 81),
      posture('n3', '2026-07-03', 79), posture('n4', '2026-07-04', 80),
      posture('outlier', '2026-07-05', 5), // 정상 무리에서 크게 벗어남
    ].map(r => normalizeRecord('posture_reports', r));
    const anomalies = findAnomalies(records, { today });
    const hit = anomalies.find(a => a.record.id === 'outlier');
    expect(hit).toBeTruthy();
    expect(hit.reasons.join()).toMatch(/특이치/);
    expect(anomalies.some(a => a.record.id === 'n1')).toBe(false);
  });

  it('정상 데이터만 있으면 빈 배열', () => {
    const records = [
      normalizeRecord('posture_reports', posture('a', '2026-07-01', 78)),
      normalizeRecord('gait_reports', gait('b', '2026-07-02', 72)),
    ];
    expect(findAnomalies(records, { today })).toEqual([]);
  });
});
