// ai-measure/menus/ClinicalFlagCard.jsx
//
// [임상 플래그 카드 2026-09-14] GaitReportDashboard.jsx에서 처음 만들었다가,
// SprintLiveAnalysis.jsx(필드 스프린트 측정)에도 같은 후면/정면 전용 지표
// (pelvicDropAssessment · kneeAlignment · stepWidthAssessment)가 생기면서 화면
// 로직을 여기로 뽑아 공유한다 — ProblemFocusPanel.jsx가 Gait/Sprint 리포트에서
// 공유되는 것과 동일한 패턴(이 폴더의 다른 파일 import 관례 참고).
//
// [다중 플래그 2026-09-14] 골반 낙하와 광각보행은 둘 다 후면뷰 지표라 동시에
// 이상일 수 있다 — 하나만 보여주던 buildClinicalFlag를 배열을 돌려주는
// buildClinicalFlags로 바꿨다(정상 범위 항목은 배열에서 빠진다).
//
// 사용법: normalizeMetrics(report)로 얻은 m 객체와 report.orientation을 넘기면
// 정상 범위인 항목은 빠지고, 벗어난 항목만 배열로 돌아온다.
//   const clinicalFlags = useMemo(() => buildClinicalFlags(m, report?.orientation), [m, report?.orientation]);
//   {clinicalFlags.map((f) => <ClinicalFlagCard key={f.key} flag={f} />)}

export const CLINICAL_LEVEL = {
  normal: { color: '#34d399', label: '정상' },
  caution: { color: '#fbbf24', label: '주의' },
  risk: { color: '#f87171', label: '유의미' },
};

export const SIDE_LABEL = { left: '왼쪽', right: '오른쪽' };

// m: normalizeMetrics()가 만든 지표 객체(pelvicDropAssessment/kneeAlignment/
//    stepWidthAssessment 포함). orientation: 'back' | 'front' | 'side' | null.
export function buildClinicalFlags(m, orientation) {
  const flags = [];

  if (orientation === 'back' && m.pelvicDropAssessment && m.pelvicDropAssessment.level !== 'normal') {
    const a = m.pelvicDropAssessment;
    const side = SIDE_LABEL[a.side] || '';
    flags.push({
      key: 'pelvicDrop',
      title: '골반 낙하 (Trendelenburg 의심)',
      level: a.level,
      message: a.level === 'risk'
        ? `${side} 골반이 측정 중 최대 ${a.amplitudePct}% 처졌습니다(신장 대비, 임계 ${a.flagPct}%). 반대측 고관절 외전근(중둔근) 평가를 권장합니다.`
        : `${side} 골반이 경미하게 처지는 경향이 관찰됩니다(최대 ${a.amplitudePct}%). 추적 관찰을 권장합니다.`,
    });
  }

  if (orientation === 'front' && m.kneeAlignment && m.kneeAlignment.status !== 'normal') {
    const k = m.kneeAlignment;
    const isValgus = k.key === 'genu_valgum';
    const label = isValgus ? '무릎 외반(X다리 경향)' : '무릎 내반(O다리 경향)';
    const idx = isValgus ? k.maxValgusIndex : k.maxVarusIndex;
    flags.push({
      key: 'kneeAlignment',
      title: `동적 ${label}`,
      level: k.status,
      message: k.status === 'risk'
        ? `측정 중 순간적으로 뚜렷한 ${label} 정렬이 관찰됐습니다(전체 프레임의 ${k.flaggedFramePct}%, 지수 ${idx}). 입각기 무릎 정렬 조절력을 확인해 보세요.`
        : `측정 중 경미한 ${label} 경향이 관찰됐습니다(전체 프레임의 ${k.flaggedFramePct}%). 추적 관찰을 권장합니다.`,
    });
  }

  // [광각/실조성 보행 2026-09-14] 후면·정면 둘 다에서 관찰 가능(좌우 보폭너비라
  // 촬영 방향에 상관없이 같은 의미) — gaitBiomechanics.js의 stepWidthAssessment
  // 재사용. 측면뷰에서는 같은 원시값이 "보폭 길이" 의미가 되므로 절대 노출하지
  // 않는다(orientation==='side'일 때는 애초에 m.stepWidthAssessment 자체를 null로
  // 채워서 넘기도록 GaitRunningAnalysis.jsx/SprintLiveAnalysis.jsx에서 처리).
  if ((orientation === 'back' || orientation === 'front') && m.stepWidthAssessment && m.stepWidthAssessment.level !== 'normal') {
    const w = m.stepWidthAssessment;
    flags.push({
      key: 'stepWidth',
      title: '광각 보행(Wide-based) 경향',
      level: w.level,
      message: w.level === 'risk'
        ? `보폭 너비가 측정 중 최대 신장 대비 ${w.widthPct}%로 넓게 관찰됩니다(임계 ${w.flagPct}%). 낙상 위험 신호일 수 있어 균형·고유수용성 감각 스크리닝을 권장합니다.`
        : `보폭 너비가 다소 넓은 경향이 있습니다(최대 ${w.widthPct}%). 추적 관찰을 권장합니다.`,
    });
  }

  // [가위걸음 2026-09-14] 후면·정면 둘 다에서 관찰 가능(좌우 무릎 교차라 촬영
  // 방향에 상관없이 같은 의미) — gaitBiomechanics.js의 scissoringAssessment 재사용.
  if ((orientation === 'back' || orientation === 'front') && m.scissoringAssessment && m.scissoringAssessment.level !== 'normal') {
    const s = m.scissoringAssessment;
    flags.push({
      key: 'scissoring',
      title: '가위걸음(Scissoring) 경향',
      level: s.level,
      message: s.level === 'risk'
        ? `측정 중 무릎이 정중선을 넘어 교차하는 프레임이 전체의 ${s.crossedPct}%로 뚜렷합니다(임계 ${s.flagPct}%). 내전근 과활성·경직 가능성을 확인해 보세요.`
        : `무릎이 정중선을 넘어 교차하는 경향이 경미하게 관찰됩니다(${s.crossedPct}%). 추적 관찰을 권장합니다.`,
    });
  }

  // [교차보행(Crossover gait) 2026-09-14] 후면·정면 둘 다에서 관찰 가능(좌우
  // 발목 교차라 촬영 방향에 상관없이 같은 의미) — gaitBiomechanics.js의
  // crossoverAssessment 재사용. 가위걸음(무릎)과 별개 지표라 동시에 뜰 수 있다.
  if ((orientation === 'back' || orientation === 'front') && m.crossoverAssessment && m.crossoverAssessment.level !== 'normal') {
    const c = m.crossoverAssessment;
    flags.push({
      key: 'crossover',
      title: '교차보행(Crossover gait) 경향',
      level: c.level,
      message: c.level === 'risk'
        ? `측정 중 발이 정중선을 넘어 착지하는 프레임이 전체의 ${c.crossedPct}%로 뚜렷합니다(임계 ${c.flagPct}%). 골반 안정성·과도한 고관절 내전 가능성을 확인해 보세요(ITB 증후군·경골 스트레스 반응 위험 신호).`
        : `발이 정중선을 넘어 착지하는 경향이 경미하게 관찰됩니다(${c.crossedPct}%). 추적 관찰을 권장합니다.`,
    });
  }

  // [팔 크로스바디 스윙 2026-09-14] 후면·정면 둘 다에서 관찰 가능(좌우 손목 교차라
  // 촬영 방향에 상관없이 같은 의미) — gaitBiomechanics.js의 armCrossAssessment 재사용.
  if ((orientation === 'back' || orientation === 'front') && m.armCrossAssessment && m.armCrossAssessment.level !== 'normal') {
    const a = m.armCrossAssessment;
    flags.push({
      key: 'armCross',
      title: '팔 크로스바디 스윙 경향',
      level: a.level,
      message: a.level === 'risk'
        ? `측정 중 팔이 몸통 정중선을 넘어 반대편으로 스윙하는 프레임이 전체의 ${a.crossedPct}%로 뚜렷합니다(임계 ${a.flagPct}%). 체간 회전 보상·에너지 효율 저하 가능성이 있어 골반 회전 이상과 함께 확인해 보세요.`
        : `팔이 몸통 정중선을 넘어 스윙하는 경향이 경미하게 관찰됩니다(${a.crossedPct}%). 추적 관찰을 권장합니다.`,
    });
  }

  // [발 진행각(Toe-out/Toe-in) 2026-09-14] 후면·정면 둘 다에서 관찰 가능 —
  // gaitBiomechanics.js의 toeAngleAssessment 재사용. 2D 투영 근사치라 실제 도(deg)
  // 단위가 아니라 %로 표기(문구에서도 "각도"라 단정하지 않는다).
  if ((orientation === 'back' || orientation === 'front') && m.toeAngleAssessment && m.toeAngleAssessment.level !== 'normal') {
    const t = m.toeAngleAssessment;
    const side = SIDE_LABEL[t.side] || '';
    const dirLabel = t.direction === 'out' ? '외측(toe-out)' : '내측(toe-in)';
    flags.push({
      key: 'toeAngle',
      title: `발 진행각 이상 경향 (${dirLabel})`,
      level: t.level,
      message: t.level === 'risk'
        ? `${side} 발끝이 측정 중 ${dirLabel}으로 뚜렷하게 벌어지는 경향이 관찰됩니다(참고 지표 ${Math.abs(t[t.side === 'left' ? 'leftPct' : 'rightPct'])}%). 고관절 회전 프로파일·추진 효율을 함께 확인해 보세요(2D 촬영 기반 참고치이며 실제 진행각(도) 측정값은 아닙니다).`
        : `${side} 발끝이 ${dirLabel}으로 다소 벌어지는 경향이 있습니다. 추적 관찰을 권장합니다.`,
    });
  }

  // [체간 시상면 기울기 2026-09-14] 측면뷰 전용 — gaitBiomechanics.js의
  // trunkLeanAssessment 재사용. 전방경사(Excessive forward trunk lean)와
  // 대상성 후굴(Compensatory trunk extension)은 방향이 반대지만, trunkLean이
  // 방향을 구분하지 못해(위 정의부 참고) 하나의 플래그로 합쳐 표시한다.
  if (orientation === 'side' && m.trunkLeanAssessment && m.trunkLeanAssessment.level !== 'normal') {
    const tl = m.trunkLeanAssessment;
    flags.push({
      key: 'trunkLean',
      title: '체간 시상면 기울기 이상 경향',
      level: tl.level,
      message: tl.level === 'risk'
        ? `측정 중 체간이 수직에서 평균 ${tl.avgDeg}° 벗어나 있습니다(임계 ${tl.flagDeg}°). 전방경사 과다(고관절 굴곡근 단축·둔근 약화) 또는 대상성 후굴(고관절 신전 제한 보상, 요추 과전만 위험)일 수 있어 영상을 육안으로 확인해 방향을 판별하고 고관절 가동성을 함께 평가해 보세요.`
        : `체간이 수직에서 다소 벗어나는 경향이 있습니다(평균 ${tl.avgDeg}°). 추적 관찰을 권장합니다.`,
    });
  }

  // [보폭 비대칭(Stride length asymmetry) 2026-09-14] 측면뷰 전용 —
  // gaitBiomechanics.js의 strideLengthAssessment(GaitCycleTracker) 재사용.
  if (orientation === 'side' && m.strideLengthAssessment && m.strideLengthAssessment.level !== 'normal') {
    const sl = m.strideLengthAssessment;
    const side = SIDE_LABEL[sl.shorterSide] || '';
    flags.push({
      key: 'strideLength',
      title: '보폭 비대칭 경향',
      level: sl.level,
      message: sl.level === 'risk'
        ? `좌우 보폭 길이 차이가 ${sl.asymmetryPct}%로 뚜렷합니다(임계 ${sl.flagPct}%, ${side} 다리가 더 짧게 나옴). 편측 근력·유연성 결손 가능성을 확인해 보세요.`
        : `좌우 보폭 길이가 다소 비대칭적입니다(${sl.asymmetryPct}%, ${side} 다리가 더 짧게 나옴). 추적 관찰을 권장합니다.`,
    });
  }

  return flags;
}

export default function ClinicalFlagCard({ flag }) {
  const { color, label } = CLINICAL_LEVEL[flag.level] || CLINICAL_LEVEL.caution;
  return (
    <div className="rounded-xl px-4 py-3 border" style={{ background: `${color}1a`, borderColor: color }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-slate-700 dark:text-slate-200">⚠ {flag.title}</span>
        <span className="text-[11px] font-black" style={{ color }}>{label}</span>
      </div>
      <p className="text-[11px] mt-1 text-slate-600 dark:text-slate-300 leading-relaxed">{flag.message}</p>
    </div>
  );
}
