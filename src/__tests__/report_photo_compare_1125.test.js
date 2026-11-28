import { describe, it, expect } from 'vitest';
import { atlasByItem } from '../ai-measure/core/muscleAtlas';
import { sameCaptureDevice } from '../components/report/QuickResultSheet.jsx';

describe('2026-11-25 결과리포트 사진 비교·근육 항목별', () => {
  it('근육 경향을 항목(부위·자세)별로 따로 묶는다', () => {
    const g = atlasByItem([
      { key: 'shoulder_height', label: '어깨 높이 차이', value: 10.8, unit: 'mm', level: 'caution' },
      { key: 'forward_head', label: '거북목', value: 30, unit: '°', level: 'risk' },
      { key: 'kyphosis', label: '굽은 등', value: 60, unit: '°', level: null },
    ]);
    expect(g.map((x) => x.key)).toEqual(['forward_head', 'shoulder_height']);
    expect(g[1].region).toBe('어깨');
    expect(g[1].tight).toEqual([1, 4]);
    expect(g[1].weak).toEqual([5]);
  });
  it('촬영 기기가 같을 때만 true, 기록이 없으면 null', () => {
    expect(sameCaptureDevice({ capture: { deviceKey: 'a|1x1' } }, { capture: { deviceKey: 'a|1x1' } })).toBe(true);
    expect(sameCaptureDevice({ capture: { deviceKey: 'a|1x1' } }, { capture: { deviceKey: 'b|1x1' } })).toBe(false);
    expect(sameCaptureDevice({ capture: { deviceKey: 'a|1x1' } }, {})).toBe(null);
  });
});
