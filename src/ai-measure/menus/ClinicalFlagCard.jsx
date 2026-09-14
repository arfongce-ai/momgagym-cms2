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
