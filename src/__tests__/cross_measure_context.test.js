import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildCombinedAssessment,
  buildCrossMeasureIntegration,
  buildProblemFocus,
  measurementOutputMode,
  mergeIntegratedAssessment,
} from '../ai-measure/core/crossMeasureContext';
import { evaluateSingleLegStance, evaluateSingleLegStanceWithEyes } from '../ai-measure/core/singleLegStance';
import { evaluateSquatBiomechanics } from '../ai-measure/core/squatBiomechanics';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

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

  // [Axis3/4 확장 2026-08-11] 신체정보(BodyInfoReport.jsx MomiInsightPanel 연결용).
  describe("buildProblemFocus('body', ...) — 신체정보", () => {
    it('전부 good 등급이면 이슈 없이 강점 문구만 남는다', () => {
      const focus = buildProblemFocus('body', {
        items: [
          { key: 'bmi', label: 'BMI', value: 22, unit: '', grade: 'good', description: '정상 체중입니다.' },
          { key: 'bp', label: '혈압', value: 118, unit: 'mmHg', grade: 'good', description: '정상 혈압입니다.' },
        ],
      });
      expect(focus.severity).toBe('normal');
      expect(focus.issues).toEqual([]);
      expect(focus.strengths.length).toBeGreaterThan(0);
    });

    it('warn 등급 항목은 caution 이슈로, description을 그대로 살려 담는다', () => {
      const focus = buildProblemFocus('body', {
        items: [{ key: 'bmi', label: 'BMI', value: 24, unit: '', grade: 'warn', description: '과체중 경계입니다.' }],
      });
      expect(focus.severity).toBe('caution');
      expect(focus.issues[0].level).toBe('caution');
      expect(focus.issues[0].text).toContain('과체중 경계입니다');
      expect(focus.issues[0].text).toContain('BMI');
    });

    it('bad 등급 항목은 risk 이슈로 올라가고 전체 severity도 risk가 된다', () => {
      const focus = buildProblemFocus('body', {
        items: [
          { key: 'bmi', label: 'BMI', value: 22, unit: '', grade: 'good', description: '정상입니다.' },
          { key: 'bp', label: '혈압', value: 145, unit: 'mmHg', grade: 'bad', description: '고혈압입니다.' },
        ],
      });
      expect(focus.severity).toBe('risk');
      expect(focus.issues.some((i) => i.level === 'risk' && i.text.includes('고혈압입니다'))).toBe(true);
    });

    it('description이 없어도(누락) 라벨·수치로 자연스러운 문구를 만든다(에러 없음)', () => {
      const focus = buildProblemFocus('body', {
        items: [{ key: 'bmi', label: 'BMI', value: 27, unit: '', grade: 'bad' }],
      });
      expect(focus.issues[0].text).toContain('BMI');
      expect(focus.issues[0].text).toContain('위험');
    });

    it('items가 비어있으면 강점 문구도 안 만든다(측정 자체가 없다는 뜻이라 억지로 "정상"이라 말하지 않음)', () => {
      const focus = buildProblemFocus('body', {});
      expect(focus.issues).toEqual([]);
      expect(focus.strengths).toEqual([]);
    });
  });

  // [Axis3/4 확장 2026-08-11] 바벨 리프팅 — 예전엔 이 kind 자체가 buildProblemFocus에
  // 없어서 issues/strengths가 항상 비어있었다("바벨 리프팅(VBT) 결과에서 우선
  // 확인할 문제를 정리했습니다."라는 속 빈 문구만 나옴). core/barbellClinical.js
  // generateLiftingDiagnosis()의 기존 정교한 판정을 재사용해서 채운 뒤의 동작을
  // 실제 5가지 시나리오로 검증(사전에 Node 프로브 스크립트로 직접 실행 확인 완료).
  describe("buildProblemFocus('lifting', ...) — 바벨 리프팅(VBT)", () => {
    it('핵심 수치가 아예 없으면(측정 실패) insufficient로 caution 이슈 하나만', () => {
      const focus = buildProblemFocus('lifting', { mode: 'vbt', metrics: {} });
      expect(focus.severity).toBe('caution');
      expect(focus.issues).toHaveLength(1);
      expect(focus.issues[0].text).toContain('평가를 보류');
    });

    it('깨끗한 측정(문제 플래그 없음)은 이슈 없이 강점 문구', () => {
      const focus = buildProblemFocus('lifting', {
        mode: 'vbt', exerciseType: 'squat',
        metrics: { meanVelocity: 0.75, velocityLoss: 8, confidenceScore: 0.9 },
        metadata: { reps: 3 },
        barPath: { maxDriftCm: 2, avgEfficiency: 0.95 },
      });
      expect(focus.severity).toBe('normal');
      expect(focus.issues).toEqual([]);
      expect(focus.strengths.length).toBeGreaterThan(0);
    });

    it('바 궤적 이탈이 크면(large_bar_drift) risk 이슈 — 유일하게 needs_work까지 강등되는 플래그라 다른 것과 다르게 risk', () => {
      const focus = buildProblemFocus('lifting', {
        mode: 'lifting', exerciseType: 'deadlift',
        metrics: { meanVelocity: 0.5, confidenceScore: 0.9 },
        barPath: { maxDriftCm: 12, avgEfficiency: 0.7 },
      });
      expect(focus.severity).toBe('risk');
      expect(focus.issues.some((i) => i.level === 'risk' && i.text.includes('궤적 교정이 필요'))).toBe(true);
      // 경로 효율 저하도 같이 잡히지만 그건 caution(needs_work까지는 안 떨어뜨림).
      expect(focus.issues.some((i) => i.level === 'caution' && i.text.includes('경로 효율'))).toBe(true);
    });

    it('속도저하·렙 불일치 둘 다 있으면 caution 이슈 2개(둘 다 fair까지만 강등)', () => {
      const focus = buildProblemFocus('lifting', {
        mode: 'vbt', exerciseType: 'bench_press',
        metrics: { meanVelocity: 0.4, velocityLoss: 35, confidenceScore: 0.9 },
        consistencyCvPct: 18,
      });
      expect(focus.severity).toBe('caution');
      expect(focus.issues).toHaveLength(2);
      expect(focus.issues.every((i) => i.level === 'caution')).toBe(true);
    });

    it('1RM 모드에서 공식 간 편차가 크면 caution 이슈로 재측정을 권장한다', () => {
      const focus = buildProblemFocus('lifting', {
        mode: 'onerm', exerciseType: 'squat',
        metrics: { oneRM: 120, confidenceScore: 0.9 },
        metadata: { reps: 5, weight: 100, formulaSpreadPct: 15 },
      });
      expect(focus.severity).toBe('caution');
      expect(focus.issues[0].text).toContain('재측정을 권장');
    });

    it('새 로직이 계산을 새로 만들지 않고 barbellClinical.js의 기존 판정을 그대로 재사용한다(중복 로직 방지 회귀 테스트)', () => {
      const src = readSrc('src', 'ai-measure', 'core', 'crossMeasureContext.js');
      expect(src).toContain("import { generateLiftingDiagnosis } from './barbellClinical';");
      const start = src.indexOf("} else if (kind === 'lifting') {");
      const end = src.indexOf("} else if (kind === 'daily')", start);
      const body = src.slice(start, end);
      expect(body).toContain('generateLiftingDiagnosis(report, {})');
    });
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
        trial1: { valid: true, holdTimeMs: 30000 },
        trial2: { valid: true, holdTimeMs: 30000 },
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

  it('한다리서기 눈뜨고/눈감고 조건별 리포트(evaluateSingleLegStanceWithEyes)는 조건 라벨을 붙여 이슈를 노출한다', () => {
    const stanceReport = evaluateSingleLegStanceWithEyes({
      open: {
        left: { trial1: { valid: true, holdTimeMs: 30000 } },
        right: { trial1: { valid: true, holdTimeMs: 30000 } },
      },
      closed: {
        left: { trial1: { valid: true, holdTimeMs: 15000 } },
        right: { trial1: { valid: true, balanceLoss: true, holdTimeMs: 4000 } },
      },
    });
    const focus = buildProblemFocus('stance', stanceReport);
    expect(focus.severity).toBe('risk');
    expect(focus.issues.some((item) => item.text.includes('오른쪽') && item.text.includes('눈감고'))).toBe(true);
    // 눈뜨고 조건은 정상이므로 눈뜨고 관련 위험/주의 이슈는 없어야 한다.
    expect(focus.issues.some((item) => item.text.includes('눈뜨고'))).toBe(false);
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

  it('바벨 리프팅(VBT)도 다른 측정을 참고 소스로 받는다(예: VBT+점프+ROM)', () => {
    const integration = buildCrossMeasureIntegration({
      kind: 'lifting',
      report: { mode: 'vbt', metrics: { meanVelocity: 0.6 } },
      romReports: [{ id: 'rom1', createdAt: '2026-07-20', summary: { max_rom: 120 } }],
      gaitReports: [{ id: 'jump1', kind: 'jump', createdAt: '2026-07-21', heightCm: 45 }],
    });
    const kinds = integration.cross_measure_context.sources.map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['rom', 'jump']));
  });

  it('점프가 자세+러닝을 참고 소스로 받는다(예: 자세+점프+러닝)', () => {
    const integration = buildCrossMeasureIntegration({
      kind: 'jump',
      report: { valid: true, heightCm: 40 },
      postureReports: [{ id: 'p1', createdAt: '2026-07-20', analysis: { frontal: {} } }],
      gaitReports: [{ id: 'g1', kind: 'gait', createdAt: '2026-07-21', metrics: { cadence: 170 } }],
    });
    const kinds = integration.cross_measure_context.sources.map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['posture', 'gait']));
  });

  it('한다리서기·스쿼트도 서로를, 그리고 다른 측정도 참고 소스로 받는다', () => {
    const integration = buildCrossMeasureIntegration({
      kind: 'stance',
      report: { valid: true, status: 'normal' },
      squatReports: [{ id: 'sq1', createdAt: '2026-07-20', status: 'caution' }],
      liftingReports: [{ id: 'l1', createdAt: '2026-07-19', mode: 'onerm' }],
    });
    const kinds = integration.cross_measure_context.sources.map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['squat', 'lifting']));
  });

  it('새 소스를 안 넘겨도(기존 4종만) 이전과 동일하게 동작한다(회귀 방지)', () => {
    const integration = buildCrossMeasureIntegration({
      kind: 'posture',
      report: { analysis: { frontal: {} } },
      romReports: [{ id: 'r1', createdAt: '2026-07-20' }],
    });
    expect(integration.cross_measure_context.sources.map((s) => s.kind)).toEqual(['rom']);
  });

  it('buildCombinedAssessment: 1개 조합(최소 케이스)도 정상 동작한다', () => {
    const combined = buildCombinedAssessment([{ kind: 'posture', report: { analysis: { frontal: {} } } }]);
    expect(combined.combinedKinds).toEqual(['posture']);
    expect(combined.severity).toBe('normal');
  });

  it('buildCombinedAssessment: 자세+점프+러닝 3종 조합', () => {
    const combined = buildCombinedAssessment([
      { kind: 'posture', report: { analysis: { frontal: {} } } },
      { kind: 'jump', report: { valid: true, heightCm: 40 } },
      { kind: 'gait', report: { valid: true, metrics: {} } },
    ]);
    expect(combined.combinedKinds).toEqual(['posture', 'jump', 'gait']);
    expect(combined.analysis.perKind).toHaveLength(3);
    expect(combined.evaluation.text).toContain('3개 측정');
  });

  it('buildCombinedAssessment: 하나라도 risk면 종합 severity도 risk(최악 기준)', () => {
    const combined = buildCombinedAssessment([
      { kind: 'posture', report: { analysis: { frontal: {} } } },
      { kind: 'jump', report: { valid: false, reason: 'sanity_fail' } },
    ]);
    expect(combined.severity).toBe('risk');
    expect(combined.issues.some((i) => i.kind === 'jump')).toBe(true);
  });

  it('buildCombinedAssessment: 7종 전부 결합해도 하드코딩 없이 동작한다(최대 케이스)', () => {
    const combined = buildCombinedAssessment([
      { kind: 'posture', report: { analysis: { frontal: {} } } },
      { kind: 'rom', report: { summary: { max_rom: 100 } } },
      { kind: 'gait', report: { valid: true, metrics: {} } },
      { kind: 'jump', report: { valid: true, heightCm: 35 } },
      { kind: 'stance', report: evaluateSingleLegStance({ left: { trial1: { valid: true, holdTimeMs: 25000 }, trial2: { valid: true, holdTimeMs: 24000 } } }) },
      { kind: 'squat', report: evaluateSquatBiomechanics({ trial1: { valid: true, thighInclineDeg: 5 }, trial2: { valid: true, thighInclineDeg: 6 } }) },
      { kind: 'lifting', report: { mode: 'vbt', metrics: { meanVelocity: 0.6 } } },
    ]);
    expect(combined.combinedKinds).toHaveLength(7);
    expect(combined.coverageScore).toBeGreaterThan(90);
  });

  it('buildCombinedAssessment: 빈 배열이면 null', () => {
    expect(buildCombinedAssessment([])).toBeNull();
    expect(buildCombinedAssessment()).toBeNull();
  });
});
