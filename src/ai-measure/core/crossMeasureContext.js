// [Axis3/4 확장 2026-08-11] 리프팅 문제요약이 core/barbellClinical.js의 기존
// 정교한 자동평가(등급·flags)를 그대로 재사용하도록 — 계산 로직을 여기 새로
// 만들지 않는다(squat이 squatBiomechanics.js의 repeatedFlags를 재사용하는
// 것과 동일한 원칙 — "판단 로직은 한 곳에만").
import { generateLiftingDiagnosis } from './barbellClinical';

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
  lifting: '바벨 리프팅(VBT)',
  body: '신체 정보',
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
  arm_drop_borderline: { level: 'caution', text: '스쿼트 중 팔(막대)이 다소 앞으로 떨어집니다.' },
  arm_drop_high: { level: 'risk', text: '스쿼트 중 팔(막대)이 크게 앞으로 떨어집니다.' },
  cog_over_ankle_borderline: { level: 'caution', text: '스쿼트 중 무게중심이 발목 기준선에서 다소 벗어납니다.' },
  cog_over_ankle_high: { level: 'risk', text: '스쿼트 중 무게중심이 발목 기준선에서 크게 벗어납니다.' },
  cog_tilt_borderline: { level: 'caution', text: '스쿼트 중 무게중심이 좌우로 다소 쏠립니다.' },
  cog_tilt_high: { level: 'risk', text: '스쿼트 중 무게중심이 좌우로 크게 쏠립니다.' },
  head_tilt_borderline: { level: 'caution', text: '스쿼트 중 머리가 한쪽으로 다소 기울어집니다.' },
  head_tilt_high: { level: 'risk', text: '스쿼트 중 머리가 한쪽으로 크게 기울어집니다.' },
  elbow_bend_borderline: { level: 'caution', text: '스쿼트 중 팔꿈치가 다소 굽습니다(완전히 펴지지 않음).' },
  elbow_bend_high: { level: 'risk', text: '스쿼트 중 팔꿈치가 크게 굽습니다(완전히 펴지지 않음).' },
  elbow_asym_borderline: { level: 'caution', text: '스쿼트 중 양쪽 팔꿈치 펴짐 정도가 다소 다릅니다.' },
  elbow_asym_high: { level: 'risk', text: '스쿼트 중 양쪽 팔꿈치 펴짐 정도가 크게 다릅니다.' },
});

// barbellClinical.js generateLiftingDiagnosis()가 반환하는 flags를 사람이 읽을
// 문장으로 매핑. level 판정 기준은 barbellClinical.js 자체의 등급 강등 폭을
// 그대로 따른다 — 'needs_work'까지 떨어뜨리는 large_bar_drift만 risk, 나머지
// (모두 'fair'까지만 떨어뜨림)는 caution. 새 판단 기준을 여기서 새로 만들지
// 않고, 이미 있는 판단 결과를 그대로 옮겨 적는 것뿐이다.
const LIFTING_FLAG_KO = Object.freeze({
  low_confidence: { level: 'caution', text: '측정 신뢰도가 낮습니다 — 조명·각도·추적점을 점검하세요.' },
  high_formula_spread: { level: 'caution', text: '1RM 추정 공식 간 편차가 커서 추정이 불안정합니다 — 1~6회 세트로 재측정을 권장합니다.' },
  high_reps: { level: 'caution', text: '10회 초과 반복으로 추정해 1RM 오차가 큽니다(참고용 수치입니다).' },
  velocity_formula_mismatch: { level: 'caution', text: '속도 기반 추정치가 공식 추정치와 크게 어긋납니다 — 무게 입력·추적을 확인하세요.' },
  high_velocity_loss: { level: 'caution', text: '세트 내 속도저하가 30%를 넘어 피로가 많이 누적됐습니다.' },
  inconsistent_reps: { level: 'caution', text: '렙마다 속도 편차가 커서 출력이 일관되지 않습니다 — 무게·자세를 점검하세요.' },
  large_bar_drift: { level: 'risk', text: '바 궤적이 몸에서 크게 멀어집니다(수평 이탈 큼) — 궤적 교정이 필요합니다.' },
  low_path_efficiency: { level: 'caution', text: '바 이동 경로 효율이 낮습니다 — 수직 이동 대비 경로가 길어 흔들림/우회가 의심됩니다.' },
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
    } else if (report.eyesOpen || report.eyesClosed) {
      // 2026-08-02: 눈뜨고/눈감고 조건 분리 측정 지원 — 각 조건의 좌우 이슈를
      // 조건 라벨을 붙여 노출한다(눈감고 흔들림 증가는 그 자체로는 정상적인
      // 패턴이라, 두 조건을 하나로 뭉개지 않고 각각 명시해야 오독을 막는다).
      const condIssue = (cond, condLabel) => {
        if (!cond || cond.valid === false) return;
        const labeled = (leg, legLabel) => {
          if (!leg || leg.status === 'unknown') return;
          if (leg.status === 'risk') addIssue('risk', `${legLabel} 다리(${condLabel}) 한다리서기에서 위험 신호가 확인됐습니다.`);
          else if (leg.status === 'caution') addIssue('caution', `${legLabel} 다리(${condLabel}) 한다리서기에서 주의가 필요한 패턴이 있습니다.`);
        };
        labeled(cond.left, '왼쪽');
        labeled(cond.right, '오른쪽');
        if (cond.asymmetryFlag) addIssue('caution', `${condLabel} 조건에서 좌우 균형 능력 비대칭이 확인됐습니다.`);
      };
      condIssue(report.eyesOpen, '눈뜨고');
      condIssue(report.eyesClosed, '눈감고');
      if (!issues.length) addStrength('눈뜨고·눈감고 조건 모두 균형 능력에 큰 위험 신호가 없습니다.');
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
  } else if (kind === 'lifting') {
    // [Axis3/4 확장 2026-08-11] 예전엔 이 분기가 아예 없어서(else 없이 통과)
    // 리프팅은 issues/strengths가 항상 빈 채로 넘어가고, primaryFinding도
    // "바벨 리프팅(VBT) 결과에서 우선 확인할 문제를 정리했습니다." 같은
    // 속 빈 문구만 나왔다 — MomiAutoNote/MomiInsightPanel은 붙어있어도
    // 실제 근거가 텅 빈 상태였던 것. generateLiftingDiagnosis()가 이미
    // 만들어둔 정교한 판정(등급·flags)을 그대로 재사용해서 채운다.
    const diag = generateLiftingDiagnosis(report, {});
    if (diag.grade === 'insufficient') {
      addIssue('caution', diag.headline || '바벨 리프팅 측정 데이터가 부족해 평가를 보류합니다.');
    } else {
      (diag.flags || []).forEach((flag) => {
        const info = LIFTING_FLAG_KO[flag];
        if (info) addIssue(info.level, info.text);
      });
      if (!issues.length) addStrength('바벨 리프팅(VBT) 지표에서 큰 문제 신호가 없습니다.');
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
  } else if (kind === 'body') {
    // [Axis3/4 확장 2026-08-11] 신체정보(BodyInfoMeasure.jsx analyzeBody() 결과) —
    // items[].grade는 'good'|'warn'|'bad' 셋뿐(BMI·혈압 등, src/services/aiService.js
    // 참고). bad→risk, warn→caution으로 그대로 옮기고, 각 항목의 description을
    // 그대로 활용한다(이미 사람이 읽을 문장으로 만들어져 있어 별도 가공 불필요).
    const items = report.items || [];
    items.forEach((item) => {
      const label = `${item.label} ${item.value ?? ''}${item.unit || ''}`.trim();
      if (item.grade === 'bad') addIssue('risk', item.description ? `${label} — ${item.description}` : `${label}이(가) 위험 범위입니다.`);
      else if (item.grade === 'warn') addIssue('caution', item.description ? `${label} — ${item.description}` : `${label}이(가) 경계 범위입니다.`);
    });
    if (!issues.length && items.length) addStrength('체중·혈압 등 신체 정보 지표가 정상 범위입니다.');
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
  liftingReports = [],
  stanceReports = [],
  squatReports = [],
} = {}) {
  if (!kind) return null;

  const jumpReports = gaitReports.filter((item) => item?.kind === 'jump');
  const runningReports = gaitReports.filter((item) => item?.kind === 'gait' || item?.metrics || item?.cadence);
  const sources = [
    kind !== 'posture' && sourceOf('posture', latestReport(postureReports), '정적 정렬과 보상 패턴을 기준점으로 사용'),
    kind !== 'rom' && sourceOf('rom', latestReport(romReports), '관절별 제한과 좌우차를 원인 후보로 사용'),
    kind !== 'jump' && sourceOf('jump', latestReport(jumpReports), '착지 대칭성과 파워 생산을 기능 검증으로 사용'),
    kind !== 'gait' && sourceOf('gait', latestReport(runningReports), '반복 동작 패턴으로 정적 결과를 재검증'),
    kind !== 'lifting' && sourceOf('lifting', latestReport(liftingReports), '근력·운동 속도 데이터를 기능적 배경으로 사용'),
    kind !== 'stance' && sourceOf('stance', latestReport(stanceReports), '좌우 균형 능력을 안정성 배경으로 사용'),
    kind !== 'squat' && sourceOf('squat', latestReport(squatReports), '동적 정렬·보상 패턴을 기능 검증으로 사용'),
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

/**
 * 여러 측정을 "동등하게" 묶어 하나의 통합 분석·평가를 만든다.
 * buildCrossMeasureIntegration은 주 측정 1개 + 나머지를 참고자료로 취급하는
 * 비대칭 구조이지만, 이 함수는 입력된 모든 항목을 같은 비중으로 다룬다 —
 * 7종 측정 중 1개만 넣어도, 7개를 전부 넣어도 동일한 방식으로 동작한다.
 * @param {Array<{kind:string, report:object}>} items 결합할 측정들(1~7개, 임의 조합)
 * @returns {object|null} valid 항목이 하나도 없으면 null
 */
export function buildCombinedAssessment(items = []) {
  const valid = (items || []).filter((it) => it?.kind && it?.report);
  if (!valid.length) return null;

  const perKind = valid.map(({ kind, report }) => ({
    kind,
    label: KIND_KO[kind] || kind,
    focus: buildProblemFocus(kind, report),
  }));

  const severity = perKind.reduce((acc, p) => worseSeverity(acc, p.focus.severity), 'normal');
  const severityRank = { normal: 0, caution: 1, risk: 2 };

  const issues = perKind
    .flatMap((p) => p.focus.issues.map((issue) => ({ ...issue, kind: p.kind, kindLabel: p.label, text: `[${p.label}] ${issue.text}` })))
    .sort((a, b) => (severityRank[b.level] || 0) - (severityRank[a.level] || 0))
    .slice(0, 10);

  const strengths = unique(perKind.flatMap((p) => p.focus.strengths.map((s) => `[${p.label}] ${s}`))).slice(0, 6);

  const coverageScore = Math.min(96, 55 + valid.length * 7);

  const evaluationText = severity === 'risk'
    ? `${valid.length}개 측정(${perKind.map((p) => p.label).join('·')})을 종합했을 때 우선 확인이 필요한 위험 신호가 있습니다.`
    : severity === 'caution'
      ? `${valid.length}개 측정(${perKind.map((p) => p.label).join('·')})을 종합했을 때 주의가 필요한 패턴이 있습니다.`
      : `${valid.length}개 측정(${perKind.map((p) => p.label).join('·')})을 종합한 결과 큰 위험 신호는 확인되지 않았습니다.`;

  return {
    combinedKinds: valid.map((v) => v.kind),
    generatedAt: new Date().toISOString(),
    coverageScore,
    coverageLevel: confidenceLevel(coverageScore),
    severity,
    analysis: {
      perKind: perKind.map((p) => ({ kind: p.kind, label: p.label, severity: p.focus.severity, primaryFinding: p.focus.primaryFinding })),
    },
    evaluation: { severity, text: evaluationText },
    issues,
    strengths,
    recommendations: unique(perKind.map((p) => p.focus.recommendedNextCheck)),
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
