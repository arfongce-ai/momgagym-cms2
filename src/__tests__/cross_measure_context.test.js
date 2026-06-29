import { describe, expect, it } from 'vitest';
import {
  buildCrossMeasureIntegration,
  buildProblemFocus,
  measurementOutputMode,
  mergeIntegratedAssessment,
} from '../ai-measure/core/crossMeasureContext';

describe('crossMeasureContext', () => {
  it('측정별 출력 매체 정책을 고정한다', () => {
    expect(measurementOutputMode('posture')).toBe('photo');
    expect(measurementOutputMode('rom')).toBe('video');
    expect(measurementOutputMode('jump')).toBe('video');
    expect(measurementOutputMode('gait')).toBe('video');
  });

  it('ROM 문제 중심 요약은 비대칭을 우선 문제로 올린다', () => {
    const focus = buildProblemFocus('rom', {
      diagnosis: { grade: 'attention', headline: '좌우 가동범위 차이 확인' },
      summary: { symmetry_index_score: 22 },
    });
    expect(focus.mode).toBe('problem_identification');
    expect(focus.outputMode).toBe('video');
    expect(focus.severity).toBe('caution');
    expect(focus.issues.some((item) => item.text.includes('좌우'))).toBe(true);
  });

  it('다른 탭의 최신 리포트를 신뢰도 보강 근거로 연결한다', () => {
    const integration = buildCrossMeasureIntegration({
      kind: 'jump',
      report: { valid: true, biomech: { landingKneeAngle: 100 } },
      postureReports: [{ id: 'p1', createdAt: '2026-06-01T00:00:00.000Z' }],
      romReports: [{ id: 'r1', createdAt: '2026-06-02T00:00:00.000Z' }],
      gaitReports: [{ id: 'g1', kind: 'gait', createdAt: '2026-06-03T00:00:00.000Z' }],
    });
    expect(integration.measurement_role.reportFocus).toBe('problem_identification');
    expect(integration.measurement_role.outputFormat).toBe('video');
    expect(integration.cross_measure_context.sources.map((s) => s.kind)).toEqual(['posture', 'rom', 'gait']);
    expect(integration.integrated_assessment.flags).toContain('cross_measure_context_available');
  });

  it('기존 통합 해석과 새 상호보완 해석을 합친다', () => {
    const merged = mergeIntegratedAssessment(
      { confidenceScore: 70, flags: ['posture_context'], notes: ['A'], recommendations: ['R1'] },
      { confidenceScore: 86, flags: ['cross_measure_context_available'], notes: ['B'], recommendations: ['R2'] },
    );
    expect(merged.confidenceScore).toBe(86);
    expect(merged.confidenceLevel).toBe('high');
    expect(merged.flags).toEqual(['posture_context', 'cross_measure_context_available']);
    expect(merged.notes).toEqual(['A', 'B']);
  });
});
