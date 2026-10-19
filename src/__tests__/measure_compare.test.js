import { describe, it, expect } from 'vitest';
import { buildMemberTimelines, aggregateAnonymous, modeForDefinition } from '../services/measureCompareService.js';

const gait = (id, at, cadence) => ({ id, type: 'gait', date: at.slice(0, 10), at, payload: { metrics: { cadence } } });
const sprint = (id, at, rt) => ({ id, type: 'sprint', date: at.slice(0, 10), at, payload: { reactionTimeMs: rt } });

describe('modeForDefinition', () => {
  it('기준범위로 좋은 방향을 정한다', () => {
    expect(modeForDefinition({ range: { good: [0, 20] } }).mode).toBe('lowerBetter');
    expect(modeForDefinition({ range: { good: [40, 100] } }).mode).toBe('higherBetter');
    expect(modeForDefinition({ range: { good: [160, 180] } })).toEqual({ mode: 'closerTargetBetter', target: 170 });
    expect(modeForDefinition({}).mode).toBe('neutral');
  });
});

describe('buildMemberTimelines', () => {
  it('회차 2개면 이전 대비, 3개면 처음 대비도 계산한다', () => {
    const t = buildMemberTimelines([
      gait('c', '2026-10-03T00:00:00Z', 170), gait('b', '2026-09-03T00:00:00Z', 160), gait('a', '2026-08-03T00:00:00Z', 150),
    ]);
    const m = t[0].metrics.find((x) => x.key === 'cadence');
    expect(m.points.map((p) => p.value)).toEqual([150, 160, 170]);
    expect(m.vsPrev.direction).toBe('improved');
    expect(m.vsFirst.diff).toBe(20);
  });
  it('회차가 1개면 비교 행이 없다', () => {
    const t = buildMemberTimelines([gait('a', '2026-08-03T00:00:00Z', 150)]);
    expect(t[0].metrics[0].vsPrev).toBeNull();
  });
  it('신체정보는 제외한다', () => {
    expect(buildMemberTimelines([{ id: 'x', type: 'body', at: '2026-01-01', payload: {} }])).toEqual([]);
  });
  it('낮을수록 좋은 지표가 줄면 개선', () => {
    const t = buildMemberTimelines([sprint('b', '2026-10-01', 200), sprint('a', '2026-09-01', 280)]);
    expect(t[0].metrics.find((x) => x.key === 'reactionTime').vsPrev.direction).toBe('improved');
  });
});

describe('무효 측정 제외', () => {
  it('보행 metrics.valid=false 기록은 회차 비교에서 뺀다', () => {
    const bad = { id: 'x', type: 'gait', date: '2026-10-05', at: '2026-10-05T00:00:00Z', payload: { metrics: { cadence: 60, valid: false } } };
    const t = buildMemberTimelines([bad, gait('b', '2026-09-03T00:00:00Z', 170), gait('a', '2026-08-03T00:00:00Z', 160)]);
    const m = t[0].metrics.find((x) => x.key === 'cadence');
    expect(m.points.map((p) => p.value)).toEqual([160, 170]);
  });
});

describe('aggregateAnonymous', () => {
  const member = (rt) => [sprint('s', '2026-10-01', rt)];
  it('최소 인원 미만이면 결과에서 뺀다', () => {
    expect(aggregateAnonymous([member(200), member(210)], 5)).toEqual([]);
  });
  it('최소 인원 이상이면 중앙값만 돌려주고 개인 정보는 없다', () => {
    const r = aggregateAnonymous([200, 210, 220, 230, 240].map(member), 5);
    expect(r[0].members).toBe(5);
    expect(r[0].metrics.find((m) => m.key === 'reactionTime').median).toBe(220);
    expect(JSON.stringify(r)).not.toMatch(/2026|"s"/);
  });
});
