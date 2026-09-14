// ai-measure/menus/ClinicalFlagCard.jsx
//
// [임상 플래그 카드 2026-09-14] GaitReportDashboard.jsx에서 처음 만들었다가,
// SprintLiveAnalysis.jsx(필드 스프린트 측정)에도 같은 후면/정면 전용 지표
// (pelvicDropAssessment · kneeAlignment)가 생기면서 화면 로직을 여기로 뽑아
// 공유한다 — ProblemFocusPanel.jsx가 Gait/Sprint 리포트에서 공유되는 것과
// 동일한 패턴(이 폴더의 다른 파일 import 관례 참고).
//
// 사용법: normalizeMetrics(report)로 얻은 m 객체와 report.orientation을 넘기면
// 정상 범위일 땐 null(카드 미표시), 벗어났을 때만 카드에 쓸 flag 객체를 만든다.
//   const clinicalFlag = useMemo(() => buildClinicalFlag(m, report?.orientation), [m, report?.orientation]);
//   {clinicalFlag && <ClinicalFlagCard flag={clinicalFlag} />}

export const CLINICAL_LEVEL = {
  normal: { color: '#34d399', label: '정상' },
  caution: { color: '#fbbf24', label: '주의' },
  risk: { color: '#f87171', label: '유의미' },
};

export const SIDE_LABEL = { left: '왼쪽', right: '오른쪽' };

// m: normalizeMetrics()가 만든 지표 객체(pelvicDropAssessment/kneeAlignment 포함).
// orientation: 'back' | 'front' | 'side' | null — 촬영 뷰. 해당 뷰 전용 지표만 본다.
export function buildClinicalFlag(m, orientation) {
  if (orientation === 'back' && m.pelvicDropAssessment && m.pelvicDropAssessment.level !== 'normal') {
    const a = m.pelvicDropAssessment;
    const side = SIDE_LABEL[a.side] || '';
    return {
      title: '골반 낙하 (Trendelenburg 의심)',
      level: a.level,
      message: a.level === 'risk'
        ? `${side} 골반이 측정 중 최대 ${a.amplitudePct}% 처졌습니다(신장 대비, 임계 ${a.flagPct}%). 반대측 고관절 외전근(중둔근) 평가를 권장합니다.`
        : `${side} 골반이 경미하게 처지는 경향이 관찰됩니다(최대 ${a.amplitudePct}%). 추적 관찰을 권장합니다.`,
    };
  }
  if (orientation === 'front' && m.kneeAlignment && m.kneeAlignment.status !== 'normal') {
    const k = m.kneeAlignment;
    const isValgus = k.key === 'genu_valgum';
    const label = isValgus ? '무릎 외반(X다리 경향)' : '무릎 내반(O다리 경향)';
    const idx = isValgus ? k.maxValgusIndex : k.maxVarusIndex;
    return {
      title: `동적 ${label}`,
      level: k.status,
      message: k.status === 'risk'
        ? `측정 중 순간적으로 뚜렷한 ${label} 정렬이 관찰됐습니다(전체 프레임의 ${k.flaggedFramePct}%, 지수 ${idx}). 입각기 무릎 정렬 조절력을 확인해 보세요.`
        : `측정 중 경미한 ${label} 경향이 관찰됐습니다(전체 프레임의 ${k.flaggedFramePct}%). 추적 관찰을 권장합니다.`,
    };
  }
  return null;
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
