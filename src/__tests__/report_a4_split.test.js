import { describe, it, expect } from 'vitest';
import { computeA4Breaks, A4_RATIO } from '../ai-measure/core/reportShare';

describe('computeA4Breaks', () => {
  const W = 1588; const P = Math.round(W * A4_RATIO);
  it('A4 한 장 이내면 분할하지 않는다', () => {
    expect(computeA4Breaks(P, P)).toEqual([]);
    expect(computeA4Breaks(P * 1.02, P)).toEqual([]);
  });
  it('섹션 경계가 있으면 그 위치에서 자른다', () => {
    const b = computeA4Breaks(P * 1.6, P, [P * 0.4, P * 0.9, P * 1.3]);
    expect(b).toEqual([Math.round(P * 0.9)]);
  });
  it('경계 후보가 없으면 A4 높이에서 자른다', () => {
    expect(computeA4Breaks(P * 2.5, P, [])).toEqual([P, P * 2]);
  });
  it('모든 조각이 A4 높이 이하다', () => {
    const h = P * 3.4;
    const edges = [0, ...computeA4Breaks(h, P, [P * 0.8, P * 1.7, P * 2.6]), h];
    for (let i = 0; i < edges.length - 1; i += 1) expect(edges[i + 1] - edges[i]).toBeLessThanOrEqual(P * 1.03);
  });
});
