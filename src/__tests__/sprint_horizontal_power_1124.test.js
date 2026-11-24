import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { sprintHorizontalPower } from '../ai-measure/core/sprintMetrics';

describe('스프린트 수평 파워(책 p.307: 체중×거리÷시간)', () => {
  const splits = { '5m': 1000, '10m': 2000 };
  it('70kg, 10m 2.0초 = 350, 5m 1.0초 = 350', () => {
    const r = sprintHorizontalPower({ mode: 'sprint', splits, massKg: 70 });
    expect(r.p10).toBe(350);
    expect(r.p5).toBe(350);
    expect(r.unit).toBe('kg·m/s');
  });
  it('가속이 더 빠르면 5m 값이 더 크다', () => {
    const r = sprintHorizontalPower({ mode: 'sprint', splits: { '5m': 800, '10m': 2000 }, massKg: 80 });
    expect(r.p5).toBe(500);
    expect(r.p10).toBe(400);
  });
  it('체중 없음·왕복·분할 없음은 null', () => {
    expect(sprintHorizontalPower({ mode: 'sprint', splits, massKg: null })).toBeNull();
    expect(sprintHorizontalPower({ mode: 'agility', splits, massKg: 70 })).toBeNull();
    expect(sprintHorizontalPower({ mode: 'sprint', splits: {}, massKg: 70 })).toBeNull();
  });
  it('5m 구간만 있어도 계산(5m 스프린트)', () => {
    const r = sprintHorizontalPower({ mode: 'sprint', splits: { '5m': 1000 }, massKg: 60 });
    expect(r.p5).toBe(300);
    expect(r.p10).toBeNull();
  });
  it('라이브·업로드 모두 신체기록 체중(resolveBodyMetrics)을 쓰고 리포트에 표시한다', () => {
    for (const f of ['SprintLiveAnalysis', 'SprintUploadAnalysis']) {
      const s = fs.readFileSync(`src/ai-measure/menus/${f}.jsx`, 'utf8');
      expect(s).toContain('resolveBodyMetrics(member).weight');
      expect(s).toContain('sprintHorizontalPower(');
    }
    expect(fs.readFileSync('src/ai-measure/menus/SprintReportDashboard.jsx', 'utf8')).toContain('수평 파워 0~5m / 0~10m');
  });
});
