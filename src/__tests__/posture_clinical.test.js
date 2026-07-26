import { describe, expect, it } from 'vitest';
import {
  buildRegionDiagnoses,
  buildMuscleMap,
  buildRiskTop3,
  buildClinicalInterpretation,
  CLINICAL_LEVEL,
} from '../ai-measure/core/postureClinical';

// 측정값이 충분히 큰(위험) 자세 패턴
const severeperView = {
  front: {
    frontal: { shoulderHeightDiffMm: 24, pelvisHeightDiffMm: 16, pelvisPattern: 'functional_lumbopelvic_pattern', legAlignment: { status: 'caution', message: 'X다리 경향' } },
    cog: { available: true, balanceOffsetPct: 40, offsetPct: 40 },
    sagittal: {},
  },
  left: {
    sagittal: { forwardHeadMm: 50, kyphosisProxyDeg: 150, kneeExtensionProxyDeg: 187 },
  },
};

// 정상 범위
const normalPerView = {
  front: {
    frontal: { shoulderHeightDiffMm: 3, pelvisHeightDiffMm: 2, pelvisPattern: 'within_error', legAlignment: { status: 'normal' } },
    cog: { available: true, balanceOffsetPct: 2, offsetPct: 2 },
    sagittal: {},
  },
  left: { sagittal: { forwardHeadMm: 10, kyphosisProxyDeg: 178, kneeExtensionProxyDeg: 178 } },
};

describe('buildRegionDiagnoses', () => {
  it('심각한 패턴에서 4개 부위를 risk/caution 으로 진단한다', () => {
    const regions = buildRegionDiagnoses(severeperView);
    expect(regions).toHaveLength(4);
    const head = regions.find((r) => r.key === 'head_neck');
    expect(head.level).toBe(CLINICAL_LEVEL.risk); // 50mm >= 45
    expect(head.measured[0].value).toBe(50);
    expect(head.problem).toContain('거북목');
  });

  it('정상 패턴에서는 normal 로 판정하고 권고를 비운다', () => {
    const regions = buildRegionDiagnoses(normalPerView);
    const head = regions.find((r) => r.key === 'head_neck');
    expect(head.level).toBe(CLINICAL_LEVEL.normal);
    expect(head.recommendation).toBeNull();
  });

  it('측면 측정이 없으면 머리·목은 insufficient', () => {
    const regions = buildRegionDiagnoses({ front: normalPerView.front });
    const head = regions.find((r) => r.key === 'head_neck');
    expect(head.level).toBe(CLINICAL_LEVEL.insufficient);
    expect(head.measured).toHaveLength(0);
  });
});

describe('buildMuscleMap', () => {
  it('활성 부위에서 긴장/약화 근육을 추정하고 estimated=true 를 명시한다', () => {
    const regions = buildRegionDiagnoses(severeperView);
    const map = buildMuscleMap(regions);
    expect(map.estimated).toBe(true);
    expect(map.tight.length).toBeGreaterThan(0);
    expect(map.weak.length).toBeGreaterThan(0);
    expect(map.note).toContain('직접 측정되지 않');
  });

  it('정상 패턴에서는 근육 추정이 비어 있다', () => {
    const regions = buildRegionDiagnoses(normalPerView);
    const map = buildMuscleMap(regions);
    expect(map.tight).toHaveLength(0);
    expect(map.weak).toHaveLength(0);
  });
});

describe('buildRiskTop3', () => {
  it('최대 3개, 심각도 높은 순으로 정렬한다', () => {
    const regions = buildRegionDiagnoses(severeperView);
    const top = buildRiskTop3(regions);
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top[0].rank).toBe(1);
    // risk 가 caution 보다 앞서야 함
    const levels = top.map((t) => t.level);
    const firstCautionIdx = levels.indexOf('caution');
    const lastRiskIdx = levels.lastIndexOf('risk');
    if (firstCautionIdx !== -1 && lastRiskIdx !== -1) {
      expect(lastRiskIdx).toBeLessThan(firstCautionIdx);
    }
  });

  it('정상 패턴에서는 위험 항목이 없다', () => {
    const regions = buildRegionDiagnoses(normalPerView);
    expect(buildRiskTop3(regions)).toHaveLength(0);
  });
});

describe('buildClinicalInterpretation', () => {
  it('메타데이터/지역/근육맵/위험/면책을 모두 포함한다', () => {
    const out = buildClinicalInterpretation({
      perViewAnalysis: severeperView,
      bodyInfo: { heightCm: 170, actualAge: 40, sex: 'M' },
    });
    expect(out.metadata.heightCm).toBe(170);
    expect(out.metadata.captureDistanceM).toBe(2.5);
    expect(out.regions).toHaveLength(4);
    expect(out.muscleMap.estimated).toBe(true);
    expect(out.riskTop3.length).toBeGreaterThan(0);
    expect(out.disclaimers.length).toBeGreaterThan(0);
  });
});

describe('성별 기준 적용', () => {
  const borderlinePelvis = {
    front: {
      frontal: { pelvisHeightDiffMm: 8.5, pelvisPattern: 'functional_lumbopelvic_pattern', shoulderHeightDiffMm: 2, legAlignment: { status: 'normal' } },
      cog: { available: true, balanceOffsetPct: 2, offsetPct: 2 },
      sagittal: {},
    },
    left: { sagittal: { forwardHeadMm: 10, kyphosisProxyDeg: 178, kneeExtensionProxyDeg: 178 } },
  };
  const pelvisRegion = (regions) => regions.find((r) => r.key === 'pelvis_spine');

  it('골반 경계값(8.5mm): 남성=주의, 여성=정상', () => {
    expect(pelvisRegion(buildRegionDiagnoses(borderlinePelvis, { sex: 'male' })).level).toBe(CLINICAL_LEVEL.caution);
    expect(pelvisRegion(buildRegionDiagnoses(borderlinePelvis, { sex: 'female' })).level).toBe(CLINICAL_LEVEL.normal);
  });
  it('성별 미입력 시 성중립(=남성 8mm) 기준', () => {
    expect(pelvisRegion(buildRegionDiagnoses(borderlinePelvis, {})).level).toBe(CLINICAL_LEVEL.caution);
  });
  it('Q각 프록시 편위 8°: 남성=주의, 여성=정상', () => {
    const pv = {
      front: {
        frontal: { pelvisHeightDiffMm: 2, shoulderHeightDiffMm: 2, pelvisPattern: 'within_error', legAlignment: { status: 'normal' }, qAngleProxyDeg: { left: 172, right: 178 } },
        cog: { available: true, balanceOffsetPct: 2, offsetPct: 2 }, sagittal: { kneeExtensionProxyDeg: 178 },
      },
      left: { sagittal: { forwardHeadMm: 10, kyphosisProxyDeg: 178, kneeExtensionProxyDeg: 178 } },
    };
    const leg = (r) => r.find((x) => x.key === 'foot_leg');
    expect(leg(buildRegionDiagnoses(pv, { sex: 'male' })).level).toBe(CLINICAL_LEVEL.caution);
    expect(leg(buildRegionDiagnoses(pv, { sex: 'female' })).level).toBe(CLINICAL_LEVEL.normal);
    expect(leg(buildRegionDiagnoses(pv, { sex: 'male' })).measured.some((m) => m.label.includes('Q각'))).toBe(true);
  });
  it('한글 성별(여)도 정규화 적용', () => {
    expect(pelvisRegion(buildRegionDiagnoses(borderlinePelvis, { sex: '여' })).level).toBe(CLINICAL_LEVEL.normal);
  });
  it('buildClinicalInterpretation: 성별 보정 플래그·디스클레이머', () => {
    const withSex = buildClinicalInterpretation({ perViewAnalysis: borderlinePelvis, bodyInfo: { sex: 'female' } });
    expect(withSex.metadata.genderCalibrated).toBe(true);
    expect(withSex.disclaimers.some((d) => d.includes('여성 기준'))).toBe(true);
    const noSex = buildClinicalInterpretation({ perViewAnalysis: borderlinePelvis, bodyInfo: {} });
    expect(noSex.metadata.genderCalibrated).toBe(false);
    expect(noSex.disclaimers.some((d) => d.includes('성중립') || d.includes('성별 입력'))).toBe(true);
  });
});
