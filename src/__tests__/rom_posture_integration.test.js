import { describe, expect, it } from 'vitest';
import {
  buildRomPostureIntegration,
  extractPostureContext,
  pickLinkedPostureReport,
} from '../ai-measure/core/romPostureIntegration';

function postureReport(overrides = {}) {
  return {
    id: 'posture_1',
    measuredAt: '2026-06-01T00:00:00.000Z',
    analysis: {
      score: 72,
      status: 'caution',
      reliability: { validCount: 8, requiredCount: 8, pelvisReliable: true },
      frontal: {
        shoulderHeightDiffMm: 6,
        pelvisHeightDiffMm: 18,
        pelvisHigherSide: 'right',
        pelvisPattern: 'functional_lumbopelvic_pattern',
      },
      sagittal: {
        forwardHeadMm: 22,
        kneeExtensionProxyDeg: 4,
      },
      cog: { available: true, offsetPct: 9, status: 'caution' },
      asymmetry: { averageAsi: 14 },
      rotations: { rollDeg: 3, pitchDeg: 4, yawDeg: 2 },
      ...overrides.analysis,
    },
    ...overrides,
  };
}

function romReport(overrides = {}) {
  return {
    kind: 'rom',
    joint: 'HIP',
    poseMode: 'STANDING',
    summary: {
      valid: true,
      left_max_rom: 88,
      right_max_rom: 120,
      symmetry_index_score: 31,
      ...overrides.summary,
    },
    diagnosis: {
      grade: 'attention',
      flags: ['asymmetry', 'left_restricted'],
      ...overrides.diagnosis,
    },
    ...overrides,
  };
}

describe('ROM x 자세·체형 통합 해석', () => {
  it('최신 자세 리포트를 기본 연결하고 요청 ID가 있으면 우선한다', () => {
    const oldReport = postureReport({ id: 'old', measuredAt: '2026-01-01T00:00:00.000Z' });
    const latestReport = postureReport({ id: 'latest', measuredAt: '2026-03-01T00:00:00.000Z' });
    expect(pickLinkedPostureReport([oldReport, latestReport])?.id).toBe('latest');
    expect(pickLinkedPostureReport([oldReport, latestReport], 'old')?.id).toBe('old');
  });

  it('자세 리포트에서 ROM 해석용 핵심 맥락을 추출한다', () => {
    const ctx = extractPostureContext(postureReport());
    expect(ctx.sourceReportId).toBe('posture_1');
    expect(ctx.frontal.pelvisHeightDiffMm).toBe(18);
    expect(ctx.cog.offsetPct).toBe(9);
    expect(ctx.asymmetry.averageAsi).toBe(14);
  });

  it('하체 ROM 비대칭과 자세 비대칭이 함께 있으면 상호 검증 플래그를 낸다', () => {
    const integration = buildRomPostureIntegration({
      romReport: romReport(),
      postureReport: postureReport(),
    });
    expect(integration.integrated_assessment.flags).toContain('pelvis_alignment_context');
    expect(integration.integrated_assessment.flags).toContain('cog_shift_context');
    expect(integration.integrated_assessment.flags).toContain('cross_validated_asymmetry');
    expect(integration.integrated_assessment.testInteractions[0].relation).toBe('cross_validates_asymmetry');
  });

  it('낮은 자세 측정 신뢰도는 통합 신뢰도를 낮춘다', () => {
    const integration = buildRomPostureIntegration({
      romReport: romReport(),
      postureReport: postureReport({
        analysis: { reliability: { validCount: 3, requiredCount: 8, pelvisReliable: false } },
      }),
    });
    expect(integration.integrated_assessment.flags).toContain('posture_reliability_low');
    expect(integration.integrated_assessment.confidenceLevel).not.toBe('high');
  });

  it('견관절 ROM은 어깨 높이차와 전방머리 맥락을 함께 반영한다', () => {
    const integration = buildRomPostureIntegration({
      romReport: romReport({ joint: 'SHOULDER', poseMode: 'STANDING' }),
      postureReport: postureReport({
        analysis: {
          frontal: { shoulderHeightDiffMm: 22, pelvisHeightDiffMm: 4 },
          sagittal: { forwardHeadMm: 52 },
        },
      }),
    });
    expect(integration.integrated_assessment.flags).toContain('shoulder_alignment_context');
    expect(integration.integrated_assessment.flags).toContain('forward_head_context');
  });
});
