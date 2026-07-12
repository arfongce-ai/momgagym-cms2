import { describe, it, expect } from 'vitest';
import { groupResultsByDate } from '../services/reportService.js';

const item = (date, score) => ({ date, summary: { overallScore: score } });

describe('groupResultsByDate — 측정 캘린더용 날짜별 그룹핑', () => {
  it('같은 날짜의 결과를 하나로 묶고 평균 점수를 계산한다', () => {
    const results = [
      item('2026-07-01T09:00:00.000Z', 80),
      item('2026-07-01T10:30:00.000Z', 60),
      item('2026-07-03', 90),
    ];
    const groups = groupResultsByDate(results, []);
    // 최신 날짜순
    expect(groups.map(g => g.date)).toEqual(['2026-07-03', '2026-07-01']);

    const d1 = groups.find(g => g.date === '2026-07-01');
    expect(d1.items.length).toBe(2);
    expect(d1.avgScore).toBe(70); // (80+60)/2
    expect(d1.count).toBe(2);

    const d3 = groups.find(g => g.date === '2026-07-03');
    expect(d3.avgScore).toBe(90);
    expect(d3.count).toBe(1);
  });

  it('점수가 없는 항목은 평균 계산에서 제외한다(측정 정직성 — 값 없으면 평균에 넣지 않음)', () => {
    const results = [item('2026-07-05', null), item('2026-07-05', 100)];
    const groups = groupResultsByDate(results, []);
    expect(groups[0].avgScore).toBe(100);
    expect(groups[0].count).toBe(2);
  });

  it('점수 있는 항목이 하나도 없으면 avgScore는 null이다(0으로 위장하지 않음)', () => {
    const results = [item('2026-07-06', null), item('2026-07-06', undefined)];
    const groups = groupResultsByDate(results, []);
    expect(groups[0].avgScore).toBeNull();
  });

  it('신체정보 기록만 있는 날짜도 그룹에 포함한다', () => {
    const bodyRecords = [{ recordedAt: '2026-07-02', weight: 60, systolic: 118, diastolic: 76 }];
    const groups = groupResultsByDate([], bodyRecords);
    expect(groups.length).toBe(1);
    expect(groups[0].date).toBe('2026-07-02');
    expect(groups[0].bodyEntry.weight).toBe(60);
    expect(groups[0].avgScore).toBeNull();
    expect(groups[0].count).toBe(1);
  });

  it('같은 날 여러 신체정보 기록이 있으면 그날의 마지막(최신) 값을 채택한다', () => {
    const bodyRecords = [
      { recordedAt: '2026-07-04T08:00:00.000Z', weight: 59 },
      { recordedAt: '2026-07-04T20:00:00.000Z', weight: 58.5 },
    ];
    const groups = groupResultsByDate([], bodyRecords);
    expect(groups[0].bodyEntry.weight).toBe(58.5);
  });

  it('같은 날 AI 측정 + 신체정보 기록이 함께 있으면 count에 둘 다 반영한다', () => {
    const results = [item('2026-07-07', 75)];
    const bodyRecords = [{ recordedAt: '2026-07-07', weight: 60 }];
    const groups = groupResultsByDate(results, bodyRecords);
    expect(groups[0].count).toBe(2);
    expect(groups[0].bodyEntry.weight).toBe(60);
    expect(groups[0].items.length).toBe(1);
  });

  it('날짜 형식이 없거나 잘못된 항목은 건너뛴다', () => {
    const groups = groupResultsByDate([item('', 50), item(undefined, 50)], [{ recordedAt: '', weight: 1 }]);
    expect(groups.length).toBe(0);
  });

  it('입력이 비어 있으면 빈 배열을 반환한다', () => {
    expect(groupResultsByDate([], [])).toEqual([]);
    expect(groupResultsByDate()).toEqual([]);
  });
});
