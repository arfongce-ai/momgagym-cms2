// [축 글자 잘림 수정 2026-11-12] 매출 그래프 축 금액이 좁은 여백에 들어가도록 짧게 표시.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wonShort } from '../utils/dashboardRollup';

describe('wonShort', () => {
  it('만 원 이상은 "만" 단위, 그 아래는 그대로', () => {
    expect(wonShort(1075200)).toBe('107.5만');
    expect(wonShort(537600)).toBe('53.8만');
    expect(wonShort(9000)).toBe('9,000');
    expect(wonShort(0)).toBe('0');
    expect(wonShort(250000000)).toBe('2.5억');
  });
  it('대시보드 매출 그래프 두 곳이 짧은 축 글자를 쓴다', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/Dashboard.jsx'), 'utf8');
    expect(src.match(/formatY=\{\(v\) => wonShort\(v\)\}/g)).toHaveLength(2);
  });
});
