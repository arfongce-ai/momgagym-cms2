import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

vi.mock('../demoData', () => ({
  aiStore: {
    ensurePostureReports: vi.fn(async () => []),
    ensureRomReports: vi.fn(async () => []),
    ensureGaitReports: vi.fn(async () => []),
    ensureSessions: vi.fn(async () => []),
  },
  store: {},
}));

import { aiStore } from '../demoData';
import { subtypeOf, subtypeEntryKey, kindOfEntryKey, latestPerSubtype, sameSubtype } from '../ai-measure/core/measureSubtype';
import { buildCombinedAssessment, buildCrossMeasureIntegration } from '../ai-measure/core/crossMeasureContext';
import { normalizeRecord, buildPeriodStats } from '../ai-measure/core/comprehensiveReport';
import { loadLatestReportsByKind, buildMemberCombinedAssessment } from '../services/momiService';

describe('세부 테스트 구분(subtypeOf)', () => {
  it('바벨: 1RM 벤치와 VBT 스내치는 다른 세부 테스트', () => {
    const a = subtypeOf('lifting', { mode: 'onerm', exerciseType: 'bench_press' });
    const b = subtypeOf('lifting', { mode: 'vbt', exerciseType: 'snatch' });
    expect(a.label).toBe('1RM · 벤치프레스');
    expect(b.label).toBe('VBT · 스내치');
    expect(a.key).not.toBe(b.key);
    expect(subtypeOf('lifting', { mode: 'vbt', exerciseType: 'bench_press' }).key).not.toBe(a.key);
  });
  it('점프·스프린트·ROM·보행·심폐도 나눈다', () => {
    expect(subtypeOf('jump', { jumpSubType: 'sj' }).key).toBe('sj');
    expect(subtypeOf('jump', { jumpSubType: 'slj', leg: 'left' }).label).toContain('왼발');
    expect(subtypeOf('sprint', { testKey: 'agility505' }).label).toBe('5m 왕복 달리기');
    expect(subtypeOf('rom', { joint: 'SHOULDER', poseMode: 'STANDING' }).label).toBe('견관절 · 서서');
    expect(subtypeOf('gait', { metrics: { cadence: 110 }, orientation: 'side' }).label).toBe('걷기 · 측면');
    expect(subtypeOf('gait', { metrics: { cadence: 170 }, orientation: 'side' }).key).not.toBe(subtypeOf('gait', { metrics: { cadence: 110 }, orientation: 'side' }).key);
    expect(subtypeOf('cardio', { machineId: 'rower', protocolId: 'rower_2k' }).label).toBe('로잉머신 · 2000m 기록 테스트');
    expect(subtypeOf('stance', { status: 'normal' }).key).toBe('');
  });
  it('세션 래퍼({data})도 펼쳐서 본다', () => {
    expect(subtypeOf('lifting', { data: { mode: 'vbt', exerciseType: 'clean_jerk' } }).label).toBe('VBT · 클린&저크');
  });
  it('키 도우미·세부 테스트별 최신', () => {
    expect(subtypeEntryKey('stance', {})).toBe('stance');
    expect(kindOfEntryKey('lifting|vbt:snatch')).toBe('lifting');
    const list = [
      { mode: 'onerm', exerciseType: 'squat', createdAt: '2026-11-01', v: 1 },
      { mode: 'onerm', exerciseType: 'squat', createdAt: '2026-11-20', v: 2 },
      { mode: 'vbt', exerciseType: 'snatch', createdAt: '2026-11-10', v: 3 },
    ];
    const l = latestPerSubtype('lifting', list);
    expect(l.map((x) => x.v).sort()).toEqual([2, 3]);
    expect(sameSubtype('lifting', list[0], list[1])).toBe(true);
  });
});

describe('종합 해설: 세부 테스트마다 따로 평가', () => {
  it('같은 바벨 리프팅이라도 테스트별로 따로 묶이고 라벨이 붙는다', () => {
    const c = buildCombinedAssessment([
      { kind: 'lifting', report: { mode: 'onerm', exerciseType: 'bench_press', metrics: { oneRM: 80 } } },
      { kind: 'lifting', report: { mode: 'vbt', exerciseType: 'snatch', metrics: { meanVelocity: 1.2 } } },
      { kind: 'jump', report: { valid: true, jumpSubType: 'cmj', eur: 1.1 } },
      { kind: 'jump', report: { valid: true, jumpSubType: 'sj' } },
    ]);
    expect(c.combinedKinds).toEqual(['lifting', 'jump']);
    expect(c.combinedItems.map((i) => i.label)).toEqual([
      '바벨 리프팅 · 1RM · 벤치프레스', '바벨 리프팅 · VBT · 스내치', '점프 · CMJ (반동점프)', '점프 · SJ (스쿼트점프)',
    ]);
    expect(c.evaluation.text).toContain('4개 측정');
  });
  it('교차 참고: 같은 종류의 다른 세부 테스트는 넣고, 같은 세부 테스트만 뺀다', () => {
    const cur = { mode: 'vbt', exerciseType: 'snatch', createdAt: '2026-11-24' };
    const res = buildCrossMeasureIntegration({
      kind: 'lifting', report: cur,
      liftingReports: [cur, { mode: 'onerm', exerciseType: 'squat', createdAt: '2026-11-20' }, { mode: 'onerm', exerciseType: 'bench_press', createdAt: '2026-11-21' }],
    });
    const labels = res.cross_measure_context.sources.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['바벨 리프팅 · 1RM · 스쿼트', '바벨 리프팅 · 1RM · 벤치프레스']));
    expect(labels).not.toContain('바벨 리프팅 · VBT · 스내치');
  });
});

describe('기간 종합: 세부 테스트끼리만 통계', () => {
  it('1RM 벤치와 1RM 스쿼트 값이 한 묶음에 섞이지 않는다', () => {
    const recs = [
      normalizeRecord('ai', { menu: 'lifting', data: { mode: 'onerm', exerciseType: 'bench_press', metrics: { oneRM: 80 } }, createdAt: '2026-11-20T10:00:00Z' }),
      normalizeRecord('ai', { menu: 'lifting', data: { mode: 'onerm', exerciseType: 'squat', metrics: { oneRM: 140 } }, createdAt: '2026-11-21T10:00:00Z' }),
    ];
    expect(recs[0].typeLabel).toContain('벤치프레스');
    const st = buildPeriodStats(recs);
    expect(st.typeStats).toHaveLength(2);
    expect(st.typeStats.map((t) => t.typeLabel).join(' ')).toContain('스쿼트');
  });
});

describe('종합 분석 불러오기: 세부 테스트별 최신 1건씩', () => {
  beforeEach(() => vi.clearAllMocks());
  it('바벨 세부 테스트·스프린트 종목·심폐가 각각 나오고 스프린트가 보행에 섞이지 않는다', async () => {
    aiStore.ensureGaitReports.mockResolvedValue([
      { kind: 'sprint', testKey: 'sprint10', totalDistanceM: 10, createdAt: '2026-11-20', metrics: {} },
      { kind: 'agility', testKey: 'agility505', totalDistanceM: 5, createdAt: '2026-11-21' },
      { kind: 'jump', jumpSubType: 'cmj', createdAt: '2026-11-22' },
      { kind: 'jump', jumpSubType: 'sj', createdAt: '2026-11-22' },
    ]);
    aiStore.ensureSessions.mockResolvedValue([
      { menu: 'lifting', data: { mode: 'onerm', exerciseType: 'bench_press' }, recordedAtFull: '2026-11-20' },
      { menu: 'lifting', data: { mode: 'vbt', exerciseType: 'snatch' }, recordedAtFull: '2026-11-21' },
      { menu: 'cardio', data: { kind: 'cardio_test', machineId: 'bike', protocolId: 'bike_astrand' }, recordedAtFull: '2026-11-21' },
    ]);
    const m = await loadLatestReportsByKind('m1');
    const keys = Object.keys(m);
    expect(keys).toEqual(expect.arrayContaining(['lifting|onerm:bench_press', 'lifting|vbt:snatch', 'sprint|sprint10', 'sprint|agility505', 'jump|cmj', 'jump|sj', 'cardio|bike:bike_astrand']));
    expect(keys.some((k) => k.startsWith('gait'))).toBe(false);
    const c = buildMemberCombinedAssessment(m, ['lifting|onerm:bench_press', 'lifting|vbt:snatch']);
    expect(c.combinedItems).toHaveLength(2);
  });
});

describe('화면 연결', () => {
  it('종합 분석 화면이 세부 테스트 라벨과 테스트별 평가를 보여준다', () => {
    const s = fs.readFileSync('src/components/report/CombinedAssessmentPanel.jsx', 'utf8');
    expect(s).toContain('entryLabel(kind)');
    expect(s).toContain('테스트별 평가');
  });
  it('보행 직전 비교는 걷기/달리기·방향이 같은 기록만', () => {
    expect(fs.readFileSync('src/ai-measure/menus/GaitAnalysisHub.jsx', 'utf8')).toContain("sameSubtype('gait', r, report)");
  });
});
