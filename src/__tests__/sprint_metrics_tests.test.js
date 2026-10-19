import { describe, it, expect } from 'vitest';
import { SPRINT_TEST_TYPES, SPRINT_TEST_ORDER, DEFAULT_CAM_ANGLE } from '../ai-measure/core/sprintTests';
import { deriveSprintMetrics, intervalTable, isRunComplete } from '../ai-measure/core/sprintMetrics';
import { METRIC_DEFINITIONS, rangeToStatus } from '../ai-measure/core/unifiedReport';

// 2초 가속(0→6m/s 등가속은 12m 이동) 대신: 속도 v(t)=min(6, 3t) 로 10m 지점까지 생성
function makeRun() {
  const samples = []; let d = 0; let t = 0;
  while (d < 10) {
    const v = Math.min(6, 3 * (t / 1000));
    d += v * 0.033; t += 33;
    samples.push({ tMs: t, distanceM: d, velocityMs: v });
  }
  const splits = {};
  for (let m = 1; m <= 10; m++) { const s = samples.find((x) => x.distanceM >= m); if (s) splits[`${m}m`] = s.tMs; }
  return { samples, splits };
}

describe('스프린트 대표 종목', () => {
  it('10m 스프린트·5m 왕복·10m 왕복 3종, 기본 촬영은 가로(측면)', () => {
    expect(SPRINT_TEST_ORDER).toEqual(['sprint10', 'agility505', 'shuttle10']);
    expect(SPRINT_TEST_TYPES.agility505.label).toBe('5m 왕복 달리기');
    expect(SPRINT_TEST_TYPES.shuttle10.label).toBe('10m 왕복 달리기');
    expect(SPRINT_TEST_TYPES.shuttle10.mode).toBe('agility');
    expect(Object.keys(SPRINT_TEST_TYPES.sprint10.splitDistancesM)).toBeDefined();
    expect(DEFAULT_CAM_ANGLE).toBe('lateral');
  });
});

describe('deriveSprintMetrics', () => {
  it('10m 달리기에서 구간·최고속도·가속·유지율을 뽑는다', () => {
    const { samples, splits } = makeRun();
    const a = deriveSprintMetrics({ samples, splits, mode: 'sprint', trackDistanceM: 10 });
    expect(a.intervals.length).toBe(10);
    expect(a.peakVelocitySmoothMs).toBeGreaterThan(5);
    expect(a.peakVelocitySmoothMs).toBeLessThanOrEqual(6.1);
    expect(a.maxAccelMs2).toBeGreaterThan(2);
    expect(a.maxAccelMs2).toBeLessThan(4);
    expect(a.firstHalfMs).toBeGreaterThan(a.secondHalfMs);
    expect(a.speedMaintenancePct).toBeGreaterThan(85);
    expect(a.speedMaintenancePct).toBeLessThanOrEqual(105);
  });
  it('표본이 없으면 전부 null/빈 값', () => {
    const a = deriveSprintMetrics({});
    expect(a.peakVelocitySmoothMs).toBeNull();
    expect(a.intervals).toEqual([]);
  });
  it('5m 이하 달리기는 0~5/5~10 값을 만들지 않는다', () => {
    const { samples, splits } = makeRun();
    const a = deriveSprintMetrics({ samples, splits, mode: 'sprint', trackDistanceM: 5 });
    expect(a.firstHalfMs).toBeNull();
    expect(a.speedMaintenancePct).toBeNull();
  });
  it('왕복은 회전 사이 구간 시간을 만든다', () => {
    const { samples, splits } = makeRun();
    const a = deriveSprintMetrics({ samples, splits, turns: [{ atDistanceM: 5, tMs: 1500 }], mode: 'agility', trackDistanceM: 5 });
    expect(a.legs.length).toBe(2);
    expect(a.legs[0].timeMs).toBe(1500);
  });
  it('intervalTable 은 누적 기록을 구간 시간으로 바꾼다', () => {
    const t = intervalTable({ '5m': 1500, '10m': 2300 });
    expect(t[0]).toMatchObject({ fromM: 0, toM: 5, timeMs: 1500 });
    expect(t[1]).toMatchObject({ fromM: 5, toM: 10, timeMs: 800, avgVelocityMs: 6.25 });
  });
});

describe('isRunComplete', () => {
  it('스프린트: 끝 지점 도달+정지', () => {
    expect(isRunComplete({ mode: 'sprint', trackDistanceM: 10, lastDistanceM: 9.9, velocityMs: 0.1 })).toBe(true);
    expect(isRunComplete({ mode: 'sprint', trackDistanceM: 10, lastDistanceM: 9.9, velocityMs: 4 })).toBe(false);
  });
  it('왕복: 회전 후 출발선 복귀', () => {
    expect(isRunComplete({ mode: 'agility', trackDistanceM: 5, lastDistanceM: 0.2, velocityMs: 1, turnCount: 1 })).toBe(true);
    expect(isRunComplete({ mode: 'agility', trackDistanceM: 5, lastDistanceM: 0.2, velocityMs: 1, turnCount: 0 })).toBe(false);
    expect(isRunComplete({ mode: 'agility', trackDistanceM: 5, lastDistanceM: 4, velocityMs: 1, turnCount: 1 })).toBe(false);
  });
});

describe('출발 반응은 등급 없이 표시', () => {
  it('reactionTime 정의에 범위가 없다', () => {
    const d = METRIC_DEFINITIONS.sprint.find((x) => x.key === 'reactionTime');
    expect(d.range).toBeUndefined();
    expect(d.better).toBe('lower');
    expect(rangeToStatus(150, d.range).key).toBe('unknown');
  });
});
