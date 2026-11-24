import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildSummaryData } from '../ai-measure/core/unifiedReport';
import { buildProblemFocus, buildCombinedAssessment } from '../ai-measure/core/crossMeasureContext';
import { normalizeRecord, REPORT_TYPE_LABEL } from '../ai-measure/core/comprehensiveReport';

const labels = (s) => s.keyMetrics.map((k) => k.label);

describe('종합 연결 — 요약 지표(keyMetrics)', () => {
  it('스프린트 수평 파워가 지표로 잡힌다', () => {
    const s = buildSummaryData({ kind: 'sprint', testKey: 'sprint10', totalTimeMs: 2000, totalDistanceM: 10, peakVelocityMs: 7, horizontalPower: { p5: 400, p10: 350, massKg: 70 } });
    expect(s.reportType).toBe('sprint');
    expect(s.keyMetrics.map((k) => k.value)).toEqual(expect.arrayContaining([400, 350]));
  });
  it('VBT 의 역도 구간 분석(스내치)이 지표로 잡힌다', () => {
    const s = buildSummaryData({ mode: 'vbt', exerciseType: 'snatch', metrics: { meanVelocity: 1.1, peakVelocity: 1.8 }, oly: { kind: 'olympic', lifts: [{ name: '스내치', peakVelocity: 1.9, barTopHeightCm: 120, catchDepthCm: 45 }], confidence: { level: 'ok', reasons: [] } } });
    const vals = s.keyMetrics.map((k) => k.value);
    expect(vals).toEqual(expect.arrayContaining([1.9, 120, 45]));
  });
  it('새 지표 해설(GUIDE)이 있다', () => {
    for (const k of ['horizontalPower5', 'horizontalPower10', 'olyPeakVelocity', 'olyBarTop', 'olyCatchDepth']) {
      expect(fs.readFileSync('src/ai-measure/core/interpretation.js', 'utf8')).toContain(`${k}:`);
    }
  });
});

describe('종합 연결 — 종합 해설(buildProblemFocus)', () => {
  it('점프: EUR·연속점프 사실을 옮기고, 신뢰 낮은 영상 이륙속도는 normal 안내', () => {
    const f = buildProblemFocus('jump', { valid: true, eur: 1.12, comTakeoff: { confidence: 'low' }, bosco: { complete: true, powerWPerKg: 18.2, jumps: 40, percentile: 60 } });
    expect(f.strengths.join(' ')).toContain('EUR');
    expect(f.strengths.join(' ')).toContain('연속점프 60초 파워 18.2');
    expect(f.issues.some((i) => i.level === 'normal' && i.text.includes('신뢰가 낮'))).toBe(true);
    expect(f.severity).toBe('normal');
  });
  it('점프: 60초를 못 채우면 주의', () => {
    const f = buildProblemFocus('jump', { valid: true, bosco: { complete: false } });
    expect(f.severity).toBe('caution');
  });
  it('스프린트: 수평 파워를 사실로 옮긴다', () => {
    const f = buildProblemFocus('sprint', { totalDistanceM: 10, splits: { '10m': 2000 }, horizontalPower: { p5: 400, p10: 350 } });
    expect(f.strengths.join(' ')).toContain('수평 파워(0~10m) 350');
  });
  it('리프팅: 역도 구간 분석 신뢰 낮음은 normal 안내, 값은 사실로', () => {
    const f = buildProblemFocus('lifting', { metrics: { meanVelocity: 1.0 }, oly: { kind: 'olympic', confidence: { level: 'low', reasons: ['frontal_view'] }, lifts: [{ name: '스내치', peakVelocity: 1.9, catchDepthCm: 40 }] } });
    expect(f.issues.some((i) => i.text.includes('동작 구간·자세 각도는 신뢰가 낮'))).toBe(true);
    expect(f.strengths.join(' ')).toContain('스내치 바 최고속도 1.9');
  });
  it('심폐지구력: VO2max 값·회복을 옮기고 판정하지 않는다', () => {
    const f = buildProblemFocus('cardio', { kind: 'cardio_test', estimates: { vo2max: { value: 42 } }, recovery: { drop60: 25 } });
    expect(f.severity).toBe('normal');
    expect(f.strengths.join(' ')).toContain('VO2max');
    expect(f.primaryFinding).toContain('VO2max');
  });
  it('여러 종류를 동등하게 묶어 한 종합 평가를 만든다(스프린트·심폐 포함)', () => {
    const c = buildCombinedAssessment([
      { kind: 'jump', report: { valid: true, eur: 1.1 } },
      { kind: 'sprint', report: { totalDistanceM: 10, splits: { '10m': 2000 }, horizontalPower: { p10: 350 } } },
      { kind: 'cardio', report: { estimates: { vo2max: { value: 42 } } } },
    ]);
    expect(c.combinedKinds).toEqual(['jump', 'sprint', 'cardio']);
    expect(c.strengths.join(' ')).toContain('[심폐지구력]');
  });
});

describe('종합 연결 — 기간 종합·불러오기', () => {
  it('기간 종합 유형 이름에 스프린트·심폐지구력이 있다', () => {
    expect(REPORT_TYPE_LABEL.sprint).toBe('스프린트');
    expect(REPORT_TYPE_LABEL.cardio).toBe('심폐지구력');
    const r = normalizeRecord('gait_reports', { kind: 'sprint', totalTimeMs: 2000, totalDistanceM: 10, createdAt: '2026-11-24T10:00:00Z' });
    expect(r.typeLabel).toBe('스프린트');
  });
});
