import { describe, it, expect } from 'vitest';
import { buildSummaryData } from '../ai-measure/core/unifiedReport';
import { buildResearchRows } from '../ai-measure/core/researchData';

const report = {
  kind: 'jump', jumpSubType: 'cmj', heightCm: 40, takeoffVelocity: 2.8,
  eur: 1.1, eurRef: { eur: 1.1, sjReportId: 'sj1', basis: 'height' },
  comTakeoff: { velocity: 2.9, gapPct: 3.6, confidence: 'ok', fps: 60 },
  bosco: { powerWPerKg: 20.62, jumps: 50, flightTotalSec: 25, percentile: 75 },
  horizontalPower: { value: 909.09 },
  measuredAt: '2026-11-24T07:00:00.000Z',
};

describe('점프 신규 지표 — 저장·통합 분석 연결(2026-11-24)', () => {
  it('요약 keyMetrics 에 신규 지표가 들어온다', () => {
    const keys = buildSummaryData(report).keyMetrics.map((m) => m.key);
    for (const k of ['eur', 'comTakeoffVelocity', 'comVelocityGap', 'boscoPower', 'boscoJumps', 'boscoPercentile', 'horizontalPower']) {
      expect(keys).toContain(k);
    }
  });
  it('연구 내보내기 행에 신규 지표가 원값으로 남는다', () => {
    const rows = buildResearchRows({ member: { id: 'm1', sex: 'male' }, record: report, source: 'saved-report', id: 'r1' });
    const byKey = Object.fromEntries(rows.map((r) => [r.metric_key, r.metric_value]));
    expect(Number(byKey.eur)).toBe(1.1);
    expect(Number(byKey.comTakeoffVelocity)).toBe(2.9);
    expect(Number(byKey.boscoPower)).toBe(20.62);
  });
  it('신규 지표가 없는 예전 기록은 그대로 동작한다', () => {
    const old = { kind: 'jump', heightCm: 35, measuredAt: '2026-10-01T00:00:00.000Z' };
    const keys = buildSummaryData(old).keyMetrics.map((m) => m.key);
    expect(keys).not.toContain('eur');
    expect(keys).toContain('jumpHeight');
  });
});
