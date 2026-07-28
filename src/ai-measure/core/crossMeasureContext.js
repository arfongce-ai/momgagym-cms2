const OUTPUT_POLICY = Object.freeze({
  posture: 'photo',
  rom: 'video',
  jump: 'video',
  gait: 'video',
  stance: 'video',
  squat: 'video',
});

const KIND_KO = Object.freeze({
  posture: '자세·체형',
  rom: 'ROM',
  jump: '점프',
  gait: '보행·러닝',
  stance: '한다리서기',
  squat: '오버헤드 스쿼트',
  daily: '오늘의 컨디션',
});

// squatBiomechanics.js가 반환하는 repeatedFlags를 사람이 읽을 문장으로 매핑.
// (플래그 이름 규칙에 암묵적으로 의존하지 않도록 각 플래그를 명시적으로 나열)
const SQUAT_FLAG_KO = Object.freeze({
  depth_borderline: { level: 'caution', text: '스쿼트 깊이가 목표에 다소 못 미칩니다.' },
  depth_high: { level: 'risk', text: '스쿼트 깊이가 목표에 크게 못 미칩니다.' },
  torso_lean_borderline: { level: 'caution', text: '스쿼트 중 상체가 다소 앞으로 기울어집니다.' },
  torso_lean_high: { level: 'risk', text: '스쿼트 중 상체가 크게 앞으로 기울어집니다.' },
  knee_valgus_borderline: { level: 'caution', text: '스쿼트 중 무릎이 다소 안쪽으로 모입니다.' },
  knee_valgus_high: { level: 'risk', text: '스쿼트 중 무릎이 크게 안쪽으로 모입니다.' },
  pelvic_tilt_borderline: { level: 'caution', text: '스쿼트 중 골반이 다소 한쪽으로 기울어집니다.' },
  pelvic_tilt_high: { level: 'risk', text: '스쿼트 중 골반이 크게 한쪽으로 기울어집니다.' },
});

export function measurementOutputMode(kind) {
  return OUTPUT_POLICY[kind] || 'report';
}

export function buildProblemFocus(kind, report = {}) {
  const issues = [];
  const strengths = [];
  let severity = 'normal';

  const addIssue = (level, text) => {
    if (!text) return;
    issues.push({ level, text });
    severity = worseSeverity(severity, level);
  };
  const addStrength = (text) => {
    if (text) strengths.push(text);
  };

  if (kind === 'posture') {
    const analysis = report.analysis || {};
    const findings = analysis.rules?.findings || [];
    findings.slice(0, 4).forEach((item) => {
      addIssue(item.level === 'risk' ? 'risk' : item.level === 'caution' ? 'caution' : 'normal', item.message || item.label);
    });
    if (analysis.cog?.status && analysis.cog.status !== 'normal') addIssue(analysis.cog.status, analysis.cog.message);
    if (!issues.length) addStrength('주요 자세 위험 규칙에 해당하는 항목이 적습니다.');
    if (analysis.reliability?.validCount != null) addStrength(`랜드마크 신뢰도 ${analysis.reliability.validCount}/${analysis.reliability.requiredCount}`);
  } else if (kind === 'rom') {
    const dx = report.diagnosis || {};
    const summary = report.summary || {};
    if (dx.grade === 'focus') addIssue('risk', dx.headline || '집중 관리가 필요한 가동범위 패턴입니다.');
    else if (dx.grade === 'attention') addIssue('caution', dx.headline || '가동범위 또는 좌우차를 확인해야 합니다.');
    else if (dx.grade === 'insufficient') addIssue('caution', '측정 프레임이 부족해 보완 측정이 필요합니다.');
    else addStrength(dx.headline || '가동범위 지표가 대체로 안정적입니다.');
    if (summary.symmetry_index_score >= 15) addIssue('caution', `좌우 가동범위 차이 ${summary.symmetry_index_score}%`);
    if (dx.details?.length) dx.details.slice(0, 3).forEach((text) => addIssue(dx.grade === 'focus' ? 'risk' : 'caution', text));
  } else if (kind === 'jump') {
    if (report.valid === false) addIssue('risk', invalidReason(report.reason));
    const biomech = report.biomech || {};
    if (biomech.landingKneeAngle != null && biomech.landingKneeAngle < 110) addIssue('caution', `착지 무릎 각도가 낮습니다(${biomech.landingKneeAngle}도).`);
    if (biomech.trunkLeanChange != null && biomech.trunkLeanChange > 20) addIssue('caution', `착지 시 상체 기울기 변화가 큽니다(${biomech.trunkLeanChange}도).`);
    if (biomech.pelvicImbalance != null && biomech.pelvicImbalance > 7) addIssue('caution', `착지 골반 불균형이 큽니다(${biomech.pelvicImbalance}%).`);
    if (biomech.footLandingSymmetry?.symmetryPct != null && biomech.footLandingSymmetry.symmetryPct < 70) {
      addIssue('caution', `착지 좌우 대칭성이 낮습니다(${biomech.footLandingSymmetry.symmetryPct}%).`);
    }
    if (!issues.length && report.valid !== false) addStrength('점프 높이와 착지 기술 지표가 큰 위험 신호 없이 측정되었습니다.');
  } else if (kind === 'gait') {
    const m = report.metrics || report || {};
    if (m.cadence != null && (m.cadence < 150 || m.cadence > 190)) addIssue('caution', `케이던스가 권장 범위를 벗어납니다(${m.cadence} SPM).`);
    const pelvicDrop = m.pelvicDropAbs ?? m.pelvicDrop?.avg;
    if (pelvicDrop != null && pelvicDrop > 7) addIssue('caution', `골반 드롭이 큽니다(${pelvicDrop}%).`);
    if (m.kneeSymmetry != null && m.kneeSymmetry < 85) addIssue('caution', `무릎 움직임 좌우 대칭성이 낮습니다(${m.kneeSymmetry}%).`);
    if (m.trunkLean?.avg != null && (m.trunkLean.avg < 0 || m.trunkLean.avg > 18)) addIssue('caution', `몸통 기울기 패턴 확인이 필요합니다(${m.trunkLean.avg}도).`);
    if (!issues.length) addStrength('반복 보행/러닝 패턴에서 주요 이상 신호가 크지 않습니다.');
  } else if (kind === 'stance') {
    if (report.valid === false) {
      addIssue('caution', '한다리서기 측정 데이터가 부족합니다.');
    } else {
      const legIssue = (leg, label) => {
        if (!leg || leg.status === 'unknown') return;
        if (leg.status === 'risk') addIssue('risk', `${label} 다리 한다리서기에서 위험 신호가 확인됐습니다.`);
        else if (leg.status === 'caution') addIssue('caution', `${label} 다리 한다리서기에서 주의가 필요한 패턴이 있습니다.`);
      };
      legIssue(report.left, '왼쪽');
      legIssue(report.right, '오른쪽');
      if (report.asymmetryFlag) addIssue('caution', '좌우 균형 능력에 비대칭이 확인되어 비교가 필요합니다.');
      if (report.left?.status === 'unknown' || report.right?.status === 'unknown') {
        addIssue('caution', '일부 측정 신뢰도가 낮아 재측정이 필요합니다.');
      }
      if (!issues.length) addStrength('양쪽 다리 모두 균형 능력에 큰 위험 신호가 없습니다.');
    }
  } else if (kind === 'squat') {
    if (report.valid === false) {
      addIssue('caution', '오버헤드 딥 스쿼트 측정 데이터가 부족합니다.');
    } else if (report.status === 'unknown') {
      addIssue('caution', '측정 신뢰도가 낮아 재측정이 필요합니다.');
    } else if (report.basis === 'immediate') {
      addIssue('risk', '스쿼트 동작 중 균형 상실 또는 뒤꿈치 들림이 확인됐습니다.');
    } else {
      (report.repeatedFlags || []).forEach((flag) => {
        const info = SQUAT_FLAG_KO[flag];
        if (info) addIssue(info.level, info.text);
      });
      if (!issues.length) addStrength('오버헤드 딥 스쿼트 동작에서 큰 위험 신호가 없습니다.');
    }
  } else if (kind === 'daily') {
    // [모미 신규] 컨디션 체크인(conditionAssessment.js evaluateCondition() 결과)을 해석한다.
    // report.valid===false: 오늘 체크인이 아직 없음. 그 외엔 painNrs/fatigue 순으로 확인해
    // primaryFinding 우선순위가 통증 > 피로도 > 메모가 되도록 한다(issues[0] 사용).
    if (report.valid === false) {
      addStrength('오늘 컨디션 체크인이 아직 없습니다.');
    } else {
      if (report.painNrs != null) {
        if (report.painNrs >= 7) addIssue('risk', `통증 NRS ${report.painNrs}/10로 보고되었습니다.`);
        else if (report.painNrs >= 4) addIssue('caution', `통증 NRS ${report.painNrs}/10로 보고되었습니다.`);
      }
      if (report.fatigue != null && report.fatigue >= 4) {
        addIssue('caution', `오늘 피로도가 ${report.fatigue}/5로 높게 보고되었습니다.`);
      }
      if (report.memo) addIssue('normal', `회원 메모: ${report.memo}`);
      if (!issues.length) addStrength('오늘 컨디션에 특이 신호가 없습니다.');
    }
  }

  const primaryFinding = issues[0]?.text || strengths[0] || `${KIND_KO[kind] || '측정'} 결과에서 우선 확인할 문제를 정리했습니다.`;
  return {
    mode: 'problem_identification',
    outputMode: measurementOutputMode(kind),
    severity,
    primaryFinding,
    issues: issues.slice(0, 5),
    strengths: strengths.slice(0, 3),
    recommendedNextCheck: recommendedNextCheck(kind, severity),
  };
}

export function buildCrossMeasureIntegration({
  kind,
  report = {},
  postureReports = [],
  romReports = [],
  gaitReports = [],
} = {}) {
  if (!kind) return null;

  const jumpReports = gaitReports.filter((item) => item?.kind === 'jump');
  const runningReports = gaitReports.filter((item) => item?.kind === 'gait' || item?.metrics || item?.cadence);
  const sources = [
    kind !== 'posture' && sourceOf('posture', latestReport(postureReports), '정적 정렬과 보상 패턴을 기준점으로 사용'),
    kind !== 'rom' && sourceOf('rom', latestReport(romReports), '관절별 제한과 좌우차를 원인 후보로 사용'),
    kind !== 'jump' && sourceOf('jump', latestReport(jumpReports), '착지 대칭성과 파워 생산을 기능 검증으로 사용'),
    kind !== 'gait' && sourceOf('gait', latestReport(runningReports), '반복 동작 패턴으로 정적 결과를 재검증'),
  ].filter(Boolean);

  const problemFocus = buildProblemFocus(kind, report);
  const score = Math.min(94, 62 + sources.length * 8 + (problemFocus.severity === 'normal' ? 6 : 0));
  const notes = sources.map((source) => `${source.label} 리포트가 ${source.relation}.`);
  if (!sources.length) notes.push('연동 가능한 이전 리포트가 아직 없어 현재 탭의 측정값 중심으로 해석합니다.');

  return {
    measurement_role: {
      reportFocus: 'problem_identification',
      outputFormat: measurementOutputMode(kind),
      complementaryUse: true,
    },
    problem_focus: problemFocus,
    cross_measure_context: {
      generatedAt: new Date().toISOString(),
      currentKind: kind,
      outputPolicy: OUTPUT_POLICY,
      sources,
      notes,
    },
    integrated_assessment: {
      confidenceScore: score,
      confidenceLevel: confidenceLevel(score),
      flags: [
        'problem_first_report',
        sources.length ? 'cross_measure_context_available' : 'single_measure_context',
        `${measurementOutputMode(kind)}_output_expected`,
      ],
      notes,
      recommendations: [problemFocus.recommendedNextCheck],
      testInteractions: sources.map((source) => ({
        target: source.kind,
        relation: 'complements_reliability',
        sourceReportId: source.id,
      })),
    },
  };
}

export function mergeIntegratedAssessment(primary, secondary) {
  if (!primary) return secondary || null;
  if (!secondary) return primary;
  const score = Math.max(primary.confidenceScore || 0, secondary.confidenceScore || 0);
  return {
    ...primary,
    ...secondary,
    confidenceScore: score,
    confidenceLevel: confidenceLevel(score),
    flags: unique([...(primary.flags || []), ...(secondary.flags || [])]),
    notes: unique([...(primary.notes || []), ...(secondary.notes || [])]),
    recommendations: unique([...(primary.recommendations || []), ...(secondary.recommendations || [])]),
    testInteractions: [...(primary.testInteractions || []), ...(secondary.testInteractions || [])],
  };
}

function latestReport(list) {
  return [...(list || [])].filter(Boolean).sort((a, b) => {
    const ad = Date.parse(a.createdAt || a.measuredAt || a.recordedAt || 0) || 0;
    const bd = Date.parse(b.createdAt || b.measuredAt || b.recordedAt || 0) || 0;
    return bd - ad;
  })[0] || null;
}

function sourceOf(kind, report, relation) {
  if (!report) return null;
  return {
    kind,
    label: KIND_KO[kind] || kind,
    id: report.id || report.reportId || '',
    createdAt: report.createdAt || report.measuredAt || report.recordedAt || '',
    relation,
  };
}

function confidenceLevel(score) {
  return score >= 80 ? 'high' : score >= 65 ? 'medium' : 'low';
}

function worseSeverity(current, next) {
  const rank = { normal: 0, caution: 1, risk: 2 };
  return (rank[next] || 0) > (rank[current] || 0) ? next : current;
}

function recommendedNextCheck(kind, severity) {
  if (kind === 'posture') return severity === 'normal' ? 'ROM 또는 보행 영상으로 정적 정렬이 동작 중에도 유지되는지 확인하세요.' : 'ROM 제한과 보행/점프 보상 패턴을 이어서 확인하세요.';
  if (kind === 'rom') return severity === 'normal' ? '점프 또는 보행 영상으로 확보된 가동범위가 기능 동작에 반영되는지 확인하세요.' : '자세·체형 사진과 보행/점프 영상에서 같은 쪽 보상 패턴이 반복되는지 확인하세요.';
  if (kind === 'jump') return severity === 'normal' ? '보행/러닝 영상으로 반복 착지와 추진 패턴을 확인하세요.' : '자세·ROM 리포트에서 착지 비대칭의 정렬/가동성 원인을 함께 확인하세요.';
  if (kind === 'gait') return severity === 'normal' ? 'ROM과 자세 사진으로 반복 패턴의 구조적 원인을 추적하세요.' : 'ROM 제한, 자세 정렬, 점프 착지를 함께 비교해 반복되는 문제 축을 확인하세요.';
  if (kind === 'daily') return severity === 'normal' ? '내일도 같은 시간에 체크인해 변화 추이를 쌓아보세요.' : '다음 체크인에서 오늘의 신호가 이어지는지 확인하고, 반복되면 트레이너와 공유하세요.';
  return '다른 측정 탭과 함께 비교해 반복되는 문제 패턴을 확인하세요.';
}

function invalidReason(reason) {
  if (reason === 'no_jump') return '점프가 안정적으로 검출되지 않았습니다.';
  if (reason === 'sanity_fail') return '물리적으로 타당하지 않은 점프 값이 감지되었습니다.';
  return '점프 측정 신뢰도가 낮아 재측정이 필요합니다.';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
