import { describe, expect, it } from 'vitest';
import {
  buildCrossMeasureIntegration,
  buildProblemFocus,
  measurementOutputMode,
  mergeIntegratedAssessment,
} from '../ai-measure/core/crossMeasureContext';
import { evaluateSingleLegStance } from '../ai-measure/core/singleLegStance';
import { evaluateSquatBiomechanics } from '../ai-measure/core/squatBiomechanics';

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

  it('한다리서기·스쿼트도 영상 출력 정책을 갖는다', () => {
    expect(measurementOutputMode('stance')).toBe('video');
    expect(measurementOutputMode('squat')).toBe('video');
  });

  it('한다리서기 좌우 비대칭이 있으면 문제 중심 요약에 반영된다(실제 판정 모듈 연동)', () => {
    const stanceReport = evaluateSingleLegStance({
      left: {
        trial1: { valid: true, holdTimeMs: 30000, swayPathCm: 2 },
        trial2: { valid: true, holdTimeMs: 30000, swayPathCm: 2 },
      },
      right: {
        trial1: { valid: true, balanceLoss: true, holdTimeMs: 4000 },
        trial2: { valid: true, holdTimeMs: 29000 },
      },
    });
    const focus = buildProblemFocus('stance', stanceReport);
    expect(focus.outputMode).toBe('video');
    expect(focus.severity).toBe('risk');
    expect(focus.issues.some((item) => item.text.includes('오른쪽'))).toBe(true);
    expect(focus.issues.some((item) => item.text.includes('비대칭'))).toBe(true);
  });

  it('한다리서기 양쪽 정상이면 강점으로 기록되고 위험 문제가 없다', () => {
    const stanceReport = evaluateSingleLegStance({
      left: { trial1: { valid: true, holdTimeMs: 30000 }, trial2: { valid: true, holdTimeMs: 30000 } },
      right: { trial1: { valid: true, holdTimeMs: 30000 }, trial2: { valid: true, holdTimeMs: 30000 } },
    });
    const focus = buildProblemFocus('stance', stanceReport);
    expect(focus.severity).toBe('normal');
    expect(focus.issues.length).toBe(0);
    expect(focus.strengths.length).toBeGreaterThan(0);
  });

  it('스쿼트 즉시확정 실패(뒤꿈치 들림)가 위험으로 반영된다(실제 판정 모듈 연동)', () => {
    const squatReport = evaluateSquatBiomechanics({
      trial1: { valid: true, heelLift: true, thighInclineDeg: 0 },
      trial2: { valid: true, thighInclineDeg: 0 },
    });
    const focus = buildProblemFocus('squat', squatReport);
    expect(focus.severity).toBe('risk');
    expect(focus.issues.some((item) => item.text.includes('뒤꿈치'))).toBe(true);
  });

  it('스쿼트 상체 기울기가 양쪽 시행에서 반복되면 주의로 반영된다(실제 판정 모듈 연동)', () => {
    const squatReport = evaluateSquatBiomechanics({
      trial1: { valid: true, thighInclineDeg: 0, torsoLeanDeg: 28 },
      trial2: { valid: true, thighInclineDeg: 0, torsoLeanDeg: 30 },
    });
    const focus = buildProblemFocus('squat', squatReport);
    expect(focus.severity).toBe('caution');
    expect(focus.issues.some((item) => item.text.includes('상체'))).toBe(true);
  });

  it('스쿼트 측정 데이터가 없으면 valid:false를 문제로 표시한다', () => {
    const squatReport = evaluateSquatBiomechanics({});
    const focus = buildProblemFocus('squat', squatReport);
    expect(focus.severity).toBe('caution');
    expect(focus.issues[0].text).toContain('부족');
  });
});
