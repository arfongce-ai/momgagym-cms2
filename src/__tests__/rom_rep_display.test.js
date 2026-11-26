import { describe, it, expect } from 'vitest';
import { repSummary, repCards, GRADE_RULES } from '../ai-measure/core/romMovementGuide';
describe('횟수별 각도 요약', () => {
  it('평균·최고·최저와 위치', () => {
    const s = repSummary([100, 110, 95, 105]);
    expect(s.avg).toBe(102.5); expect(s.max).toBe(110); expect(s.min).toBe(95);
    expect(s.maxIdx).toBe(1); expect(s.minIdx).toBe(2); expect(s.hasRange).toBe(true);
  });
  it('1회이거나 모두 같으면 강조하지 않는다', () => {
    expect(repSummary([90]).hasRange).toBe(false);
    expect(repCards([90, 90]).every((c) => c.tone === '')).toBe(true);
    expect(repSummary([])).toBeNull();
  });
  it('영상 카드: 최고 max, 최저 min, 마지막 latest, 최근 6회만', () => {
    const c = repCards([100, 120, 90, 100, 101, 102, 103]);
    expect(c.length).toBe(6);
    expect(repCards([100, 120, 90]).map((x) => x.tone)).toEqual(['', 'max', 'min']);
    expect(c[5].latest).toBe(true);
  });
  it('종합 기준 3단계(90/65/35)', () => { expect(GRADE_RULES.map((g) => g.score)).toEqual([90, 65, 35]); });
});
