import { describe, it, expect } from 'vitest';
import { PATTERN_LIBRARY, buildPatternInsights } from '../ai-measure/core/patternInsights';
import { METRIC_DEFINITIONS } from '../ai-measure/core/unifiedReport';

const m = (key, status) => ({ key, label: key, value: 1, unit: 'mm', status: { key: status } });

describe('patternInsights', () => {
  it('모든 패턴의 지표 키가 실제 측정 정의에 존재한다', () => {
    for (const p of PATTERN_LIBRARY) {
      for (const [measure, key] of Object.entries(p.measures)) {
        expect((METRIC_DEFINITIONS[measure] || []).some((d) => d.key === key), `${measure}.${key}`).toBe(true);
      }
    }
  });
  it('모든 패턴에 출처와 근거 수준이 있다', () => {
    for (const p of PATTERN_LIBRARY) {
      expect(p.sources.length).toBeGreaterThan(0);
      expect(['textbook', 'concept', 'data']).toContain(p.evidence);
    }
  });
  it('주의/위험일 때만 나온다', () => {
    expect(buildPatternInsights('posture', [m('forwardHead', 'normal')])).toEqual([]);
    expect(buildPatternInsights('posture', [m('forwardHead', 'unknown')])).toEqual([]);
    expect(buildPatternInsights('posture', [m('forwardHead', 'caution')])[0].key).toBe('forward_head_upper_crossed');
    expect(buildPatternInsights('gait', [m('pelvicDrop', 'risk')])[0].key).toBe('pelvic_drop_gait');
  });
  it('문구에 진단·AI 표현이 없다', () => {
    const text = JSON.stringify(PATTERN_LIBRARY);
    expect(text).not.toMatch(/AI|진단합니다|질환입니다|치료합니다/);
  });
});
