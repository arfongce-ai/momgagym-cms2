// ROM 결과와 자세·체형 리포트를 상호 검증하기 위한 순수 로직.
// 정적 정렬(posture)은 ROM 수치를 "대체"하지 않고, 보상/비대칭/신뢰도 맥락으로만 사용한다.

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function absNum(v) {
  const n = num(v);
  return n == null ? null : Math.abs(n);
}

function dateValue(report) {
  const raw = report?.measuredAt || report?.createdAt || report?.recordedAt || '';
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function firstAnalysisWith(perViewAnalysis, path) {
  if (!perViewAnalysis) return null;
  const entries = Object.values(perViewAnalysis).filter(Boolean);
  return entries.find((analysis) => getPath(analysis, path) != null) || null;
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function postureAnalysis(report) {
  if (!report) return null;
  if (report.analysis) return report.analysis;
  const first = firstAnalysisWith(report.perViewAnalysis, 'score');
  return first || report;
}

export function pickLinkedPostureReport(reports = [], requestedId = '') {
  const list = Array.isArray(reports) ? reports.filter(Boolean) : [];
  if (!list.length) return null;
  if (requestedId) {
    const exact = list.find((r) => r.id === requestedId);
    if (exact) return exact;
  }
  return [...list].sort((a, b) => dateValue(b) - dateValue(a))[0] || null;
}

export function extractPostureContext(report) {
  if (!report) return null;
  const analysis = postureAnalysis(report);
  if (!analysis) return null;
  const perViewAnalysis = report.perViewAnalysis || {};
  const front = analysis.frontal ? analysis : firstAnalysisWith(perViewAnalysis, 'frontal');
  const side = analysis.sagittal ? analysis : firstAnalysisWith(perViewAnalysis, 'sagittal');

  return {
    sourceReportId: report.id || '',
    measuredAt: report.measuredAt || report.createdAt || report.recordedAt || '',
    score: num(analysis.score ?? report.postureScore),
    status: analysis.status || '',
    reliability: {
      validCount: num(analysis.reliability?.validCount),
      requiredCount: num(analysis.reliability?.requiredCount),
      pelvisReliable: analysis.reliability?.pelvisReliable ?? null,
    },
    frontal: {
      shoulderHeightDiffMm: num(front?.frontal?.shoulderHeightDiffMm),
      pelvisHeightDiffMm: num(front?.frontal?.pelvisHeightDiffMm),
      pelvisHigherSide: front?.frontal?.pelvisHigherSide || '',
      pelvisPattern: front?.frontal?.pelvisPattern || '',
      qAngleProxyDeg: num(front?.frontal?.qAngleProxyDeg),
      legAlignment: front?.frontal?.legAlignment || '',
    },
    sagittal: {
      forwardHeadMm: num(side?.sagittal?.forwardHeadMm),
      kneeExtensionProxyDeg: num(side?.sagittal?.kneeExtensionProxyDeg),
      kyphosisProxyDeg: num(side?.sagittal?.kyphosisProxyDeg),
    },
    cog: {
      available: analysis.cog?.available === true,
      offsetPct: num(analysis.cog?.offsetPct),
      status: analysis.cog?.status || '',
    },
    asymmetry: {
      averageAsi: num(analysis.asymmetry?.averageAsi),
    },
    rotations: {
      rollDeg: num(analysis.rotations?.rollDeg),
      pitchDeg: num(analysis.rotations?.pitchDeg),
      yawDeg: num(analysis.rotations?.yawDeg),
    },
  };
}

export function buildRomPostureIntegration({ romReport, postureReport } = {}) {
  const postureContext = extractPostureContext(postureReport);
  if (!postureContext) return null;

  const joint = romReport?.joint;
  const poseMode = romReport?.poseMode;
  const summary = romReport?.summary || {};
  const diagnosis = romReport?.diagnosis || {};
  const flags = new Set();
  const notes = [];
  const recommendations = [];
  const testInteractions = [];
  let confidenceScore = 86;

  const reliability = postureContext.reliability;
  if (reliability.validCount != null && reliability.requiredCount) {
    const ratio = reliability.validCount / reliability.requiredCount;
    if (ratio < 0.7) {
      flags.add('posture_reliability_low');
      confidenceScore -= 15;
      notes.push('자세 리포트의 랜드마크 신뢰도가 낮아 ROM-체형 통합 해석은 보수적으로 봅니다.');
    }
  }
  if (summary.valid === false || diagnosis.flags?.includes('insufficient_data')) {
    flags.add('rom_reliability_low');
    confidenceScore -= 30;
    recommendations.push('ROM 원본 측정을 먼저 재촬영한 뒤 자세 리포트와 다시 비교하세요.');
  }

  const pelvisDiff = absNum(postureContext.frontal.pelvisHeightDiffMm);
  const shoulderDiff = absNum(postureContext.frontal.shoulderHeightDiffMm);
  const forwardHead = absNum(postureContext.sagittal.forwardHeadMm);
  const cogOffset = absNum(postureContext.cog.offsetPct);
  const postureAsi = absNum(postureContext.asymmetry.averageAsi);
  const romSym = absNum(summary.symmetry_index_score);
  const romFlags = diagnosis.flags || [];

  if (['HIP', 'KNEE', 'ANKLE'].includes(joint)) {
    if (pelvisDiff != null && pelvisDiff >= 15) {
      flags.add('pelvis_alignment_context');
      confidenceScore -= poseMode === 'STANDING' ? 8 : 2;
      notes.push(`골반 높이차 ${Math.round(pelvisDiff)}mm가 있어 ${joint} ROM의 좌우 차이를 체형 정렬과 함께 해석해야 합니다.`);
      recommendations.push('하체 ROM은 보상 동작을 줄인 자세와 체중지지 자세를 함께 비교하면 신뢰도가 올라갑니다.');
    }
    if (cogOffset != null && cogOffset >= 8) {
      flags.add('cog_shift_context');
      confidenceScore -= poseMode === 'STANDING' ? 6 : 2;
      notes.push(`무게중심 편위 ${Math.round(cogOffset)}%가 관찰되어 체중지지 ROM에서 보상 가능성을 확인합니다.`);
    }
  }

  if (joint === 'SHOULDER') {
    if (shoulderDiff != null && shoulderDiff >= 18) {
      flags.add('shoulder_alignment_context');
      confidenceScore -= 6;
      notes.push(`어깨 높이차 ${Math.round(shoulderDiff)}mm가 있어 견관절 ROM의 좌우 차이를 견갑·흉곽 정렬과 함께 봅니다.`);
    }
    if (forwardHead != null && forwardHead >= 45) {
      flags.add('forward_head_context');
      confidenceScore -= 5;
      notes.push(`거북목/전방머리 ${Math.round(forwardHead)}mm가 커서 견관절 거상 ROM에 경추·흉추 보상이 섞일 수 있습니다.`);
    }
  }

  if (romSym != null && romSym >= 15 && postureAsi != null && postureAsi >= 12) {
    flags.add('cross_validated_asymmetry');
    confidenceScore += 7;
    notes.push('정적 체형 비대칭과 동적 ROM 좌우 차이가 함께 관찰되어 비대칭 소견의 신뢰도가 높아집니다.');
    testInteractions.push({
      source: 'posture',
      target: 'rom',
      relation: 'cross_validates_asymmetry',
    });
  }

  if ((romFlags.includes('left_restricted') || romFlags.includes('right_restricted')) && postureContext.score != null && postureContext.score >= 80) {
    flags.add('rom_specific_limitation');
    notes.push('체형 점수는 양호하지만 ROM 제한이 남아 있어 국소 관절/연부조직 가동성 평가가 필요합니다.');
  }

  if (!notes.length) {
    notes.push('자세 리포트에서 ROM 해석을 크게 흔드는 정렬 위험은 뚜렷하지 않습니다.');
  }
  if (!recommendations.length) {
    recommendations.push('같은 조건에서 자세 리포트와 ROM 리포트를 반복 측정해 추세를 비교하세요.');
  }

  const clamped = Math.max(0, Math.min(100, Math.round(confidenceScore)));
  const confidenceLevel = clamped >= 80 ? 'high' : clamped >= 60 ? 'medium' : 'low';
  return {
    posture_context: postureContext,
    integrated_assessment: {
      confidenceScore: clamped,
      confidenceLevel,
      flags: [...flags],
      notes,
      recommendations,
      testInteractions,
    },
  };
}
