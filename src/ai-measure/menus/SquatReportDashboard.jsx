// ai-measure/menus/SquatReportDashboard.jsx
// ════════════════════════════════════════════════════════════════════════
//  [리포트 통합 2026-08-09] SquatAnalysisHub.jsx(측정 화면)에 인라인으로
//  박혀있던 결과 리포트 화면을 StanceReportDashboard.jsx와 같은 방식으로
//  독립 컴포넌트로 뽑았다 — Report.jsx(저장된 리포트 다시 보기)에서도
//  재사용하기 위함(재구현 없이 그대로 재사용).
//
//  onClose: 필수, onRemeasure: 선택("다시 측정" 버튼, 측정 화면 전용),
//  onViewInReport: 선택("결과리포트에서 보기" 버튼, 측정 화면 전용).
//  StanceReportDashboard.jsx와 완전히 같은 규약.
// ════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from 'react';
import { MetricCard, UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection } from '../../components/report/UnifiedReportPrimitives';
import { SQUAT_TUNING, extractSquatMetrics, squatMetricStatus, computeSquatScore } from '../core/squatBiomechanics';
import { buildSummaryData } from '../core/unifiedReport';
import { depthPctFromThighIncline } from '../core/squatFms';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import MomiAutoNote from '../../components/report/MomiAutoNote.jsx';
import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';
import ReportActions from '../../components/report/ReportActions';
import { aiStore } from '../../demoData';

const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' };
const BASIS_KO = {
  immediate: '즉시확정',
  reproducibility: '재현성확정',
  single_trial_only: '단일 시행(재측정 권장)',
  no_valid_trial: '측정 무효',
  front_side_combined: '정면+측면 결합',
  single_view_only: '단일 각도(재측정 권장)',
};

// [2026-08-05] 리포트 보완 — 자세/점프/보행 리포트와 동일한 수준으로 부위별
// 실측 각도·시각화·해석을 담는다. 임계값은 squatBiomechanics.js의
// SQUAT_TUNING을 그대로 가져와 리포트와 판정이 서로 다른 기준을 말하지 않게 한다.
const METRIC_RANGES = {
  depth: { good: [0, SQUAT_TUNING.depthCautionDeg], warn: [0, SQUAT_TUNING.depthRiskDeg], unit: '°', label: '패러렐까지 남은 각', flagPrefix: 'depth_' },
  torso: { good: [0, SQUAT_TUNING.torsoLeanCautionDeg], warn: [0, SQUAT_TUNING.torsoLeanRiskDeg], unit: '°', label: '상체 전방 기울기', flagPrefix: 'torso_lean_' },
  knee: { good: [0, SQUAT_TUNING.kneeValgusCautionDeg], warn: [0, SQUAT_TUNING.kneeValgusRiskDeg], unit: '°', label: '무릎 안쪽 쏠림', flagPrefix: 'knee_valgus_' },
  pelvis: { good: [0, SQUAT_TUNING.pelvicTiltCautionDeg], warn: [0, SQUAT_TUNING.pelvicTiltRiskDeg], unit: '°', label: '골반 기울기', flagPrefix: 'pelvic_tilt_' },
  arm: { good: [0, SQUAT_TUNING.armDropCautionDeg], warn: [0, SQUAT_TUNING.armDropRiskDeg], unit: '°', label: '팔(막대) 처짐', flagPrefix: 'arm_drop_' },
};

const FMS_REASON_KO = {
  depthBelowParallel: '깊이가 패러렐(허벅지 수평)에 못 미침',
  trunkParallelToTibia: '상체가 정강이와 나란한 각을 유지 못함',
  kneesAligned: '무릎이 안쪽으로 쏠림',
  armsAligned: '팔(막대)이 수직에서 벗어남',
  symmetricWeight: '좌우 체중이 고르게 분배되지 않음',
  heel_lift: '뒤꿈치가 바닥에서 들림',
  pain_reported: '통증이 보고됨',
  incomplete_views: '정면 또는 측면 촬영이 누락됨',
};

const METRIC_STATUS_TOKEN = {
  normal: { key: 'normal', label: '정상', color: 'text-emerald-700 dark:text-emerald-300', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-500/12', borderClass: 'border-emerald-400/35', bar: 'bg-emerald-400' },
  caution: { key: 'caution', label: '주의', color: 'text-amber-700 dark:text-amber-300', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-500/12', borderClass: 'border-amber-400/35', bar: 'bg-amber-400' },
  risk: { key: 'risk', label: '위험', color: 'text-red-700 dark:text-red-300', colorClass: 'text-red-700 dark:text-red-300', bgClass: 'bg-red-500/12', borderClass: 'border-red-400/35', bar: 'bg-red-400' },
  observed: { key: 'observed', label: '1회만 관찰(재현 안 됨)', color: 'text-slate-500 dark:text-slate-400', colorClass: 'text-slate-600 dark:text-slate-300', bgClass: 'bg-slate-500/12', borderClass: 'border-slate-400/35', bar: 'bg-slate-500' },
  unknown: { key: 'unknown', label: '측정 안 됨', color: 'text-slate-500', colorClass: 'text-slate-500 dark:text-slate-400', bgClass: 'bg-slate-300/12 dark:bg-slate-600/12', borderClass: 'border-slate-500/35', bar: 'bg-slate-200 dark:bg-slate-700' },
};

function MetricBar({ metricKey, value }) {
  const range = METRIC_RANGES[metricKey];
  const status = value.status;
  const token = METRIC_STATUS_TOKEN[status] || METRIC_STATUS_TOKEN.unknown;
  const max = range.warn[1] * 1.15;
  const pct = value.deg == null ? 0 : Math.max(0, Math.min(100, (value.deg / max) * 100));
  const goodW = (range.good[1] / max) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">{range.label}</span>
        <span className={`text-[12px] font-black tabular-nums ${token.color}`}>
          {value.deg == null ? '측정 안 됨' : `${value.deg}${range.unit}`} · {token.label}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/70">
        <div className="absolute top-0 left-0 h-full bg-emerald-500/20" style={{ width: `${goodW}%` }} />
        {value.deg != null && <div className={`absolute top-0 left-0 h-full rounded-full ${token.bar}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">정상 0~{range.good[1]}{range.unit}</p>
    </div>
  );
}

export default function SquatReportDashboard({ report, member, onClose, onRemeasure, onViewInReport }) {
  const [videoShareMsg, setVideoShareMsg] = useState('');
  const reportMetrics = useMemo(() => extractSquatMetrics(report), [report]);
  const reportScore = useMemo(() => computeSquatScore(report, reportMetrics), [report, reportMetrics]);

  if (!report) return null;

  const focus = report.problemFocus || {};
  const m = reportMetrics;

  return (
    <UnifiedReportCanvas>
      <div className="mx-auto w-full max-w-[794px] flex items-center justify-between pb-2">
        <button onClick={onClose} className="text-slate-600 dark:text-slate-300 font-bold text-sm">← 닫기</button>
      </div>
      <UnifiedReportPage id="squat-report-sheet" className="mx-auto">
        <UnifiedReportHeader
          eyebrow="OVERHEAD DEEP SQUAT REPORT"
          badge="SQUAT"
          title={report.member?.name || '회원'}
          subtitle={`${(report.measuredAt || '').slice(0, 10)} · 오버헤드 딥 스쿼트`}
          score={report.valid === false ? null : reportScore}
          status={report.valid === false ? 'risk' : undefined}
          member={report.member}
        />

        <div className="grid gap-3">
          <ProblemFocusPanel focus={focus} context={report.cross_measure_context} />
          {/* [Axis3 확장 2026-08-08] MomiAutoNote — PostureReport.jsx와 동일 패턴.
              스쿼트도 세션(ai) 저장 방식이라 updateSession을 쓴다. */}
          <MomiAutoNote kind="squat" report={report} member={member || report.member}
            onSaved={(patch) => aiStore.updateSession((member || report.member)?.id, report.id, patch)} />
          {/* [Axis4 확장 2026-08-08] MomiAutoNote와 별개로, 필요하면 트레이너가
              직접 물어보고 후속 질문까지 이어갈 수 있는 대화창. */}
          <MomiInsightPanel kind="squat" report={report} member={member || report.member} />

          {report.missingView && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                {report.missingView === 'side' ? '측면' : '정면'} 촬영이 없어서 일부 지표는 참고용입니다.
                {report.needsRetest && ' 재측정을 권장해요.'}
              </p>
            </div>
          )}

          <UnifiedReportSection title="① 핵심 지표" subtitle="깊이 · FMS 공식 채점">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricCard metric={{ key: 'depth', label: '패러렐 도달률', displayValue: m.depthDeg == null ? '-' : Math.round(depthPctFromThighIncline(m.depthDeg)), unit: m.depthDeg == null ? '' : '%',
                description: '0°(패러렐)에 가까울수록 100%', status: METRIC_STATUS_TOKEN[squatMetricStatus(report, 'depth_')] }} />
              <MetricCard metric={{ key: 'fms', label: 'FMS 공식 점수', displayValue: report.fmsScore ?? '-', unit: report.fmsScore != null ? '/3' : '',
                description: 'Functional Movement Screen 기준' }} />
              <MetricCard metric={{ key: 'basis', label: '판정 근거', displayValue: BASIS_KO[report.basis] || '-',
                description: '반복 재현 여부' }} />
              <MetricCard metric={{ key: 'trials', label: '수집된 시행', displayValue: (report.trials || []).filter((t) => t.valid).length, unit: `/${(report.trials || []).length || 4}`,
                description: '정면 2회 + 측면 2회' }} />
            </div>
          </UnifiedReportSection>

          <UnifiedReportSection title="② 부위별 보상 패턴" subtitle="실측 각도 · 정상 범위 대비">
            <div className="space-y-4">
              <MetricBar metricKey="depth" value={{ deg: m.depthDeg, status: squatMetricStatus(report, 'depth_') }} />
              <MetricBar metricKey="torso" value={{ deg: m.torsoLeanDeg, status: squatMetricStatus(report, 'torso_lean_') }} />
              <MetricBar metricKey="knee" value={{ deg: m.kneeValgusDeg, status: squatMetricStatus(report, 'knee_valgus_') }} />
              <MetricBar metricKey="pelvis" value={{ deg: m.pelvicTiltDeg, status: squatMetricStatus(report, 'pelvic_tilt_') }} />
              <MetricBar metricKey="arm" value={{ deg: m.armDropDeg, status: squatMetricStatus(report, 'arm_drop_') }} />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              무릎·골반은 정면, 팔 처짐은 측면에서만 신뢰할 수 있는 지표라 각각 해당 방향 시행에서만 값을 가져옵니다.
              {report.torsoLeanSource === 'front_fallback' && ' 상체 기울기는 측면 촬영이 없어 정면 값으로 대체했습니다.'}
            </p>
          </UnifiedReportSection>

          {report.fmsScore != null && report.fmsScore < 3 && report.fmsReasons?.length > 0 && (
            <UnifiedReportSection title="③ FMS 감점 사유" subtitle={`${report.fmsScore}점인 이유`}>
              <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                {report.fmsReasons.map((r, i) => <li key={i}>{FMS_REASON_KO[r] || r}</li>)}
              </ul>
            </UnifiedReportSection>
          )}

          {report.trials?.length > 0 && (
            <UnifiedReportSection title="④ 시행별 결과" subtitle="정면 2회 · 측면 2회">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {report.trials.map((t, i) => (
                  <div key={i} className="rounded-xl bg-slate-100/70 dark:bg-slate-800/70 border border-slate-300/60 dark:border-slate-700/60 p-3">
                    <p className="text-[10px] text-slate-500">{i < report.trials.length / 2 ? '정면' : '측면'} {i % (report.trials.length / 2) + 1}회</p>
                    <p className="text-white font-black text-sm">{STATUS_KO[t.status] || '-'}</p>
                    {t.thighInclineDeg != null && <p className="text-[10px] text-slate-500 mt-1">깊이 잔여 {t.thighInclineDeg}°</p>}
                    {t.torsoLeanDeg != null && <p className="text-[10px] text-slate-500">상체 {t.torsoLeanDeg}°</p>}
                    {t.kneeValgusDeg != null && <p className="text-[10px] text-slate-500">무릎 {t.kneeValgusDeg}°</p>}
                    {t.pelvicTiltDeg != null && <p className="text-[10px] text-slate-500">골반 {t.pelvicTiltDeg}°</p>}
                    {t.armDropDeg != null && <p className="text-[10px] text-slate-500">팔 {t.armDropDeg}°</p>}
                  </div>
                ))}
              </div>
            </UnifiedReportSection>
          )}

          <UnifiedReportSection title="영상 분석의 한계">
            <ul className="list-disc pl-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 space-y-1">
              <li>깊이는 정면·측면 모두에서 참고하지만, 무릎 정렬은 정면에서만, 팔 처짐·상체 기울기는 측면에서만 신뢰할 수 있습니다.</li>
              <li>같은 신호가 2회 반복돼야 주의/위험으로 확정합니다. 1회만 관찰된 항목은 "1회만 관찰(재현 안 됨)"으로 별도 표시됩니다.</li>
              <li>FMS 공식 점수는 종합 판정(정상/주의/위험)과 별개로, Functional Movement Screen 채점 기준을 그대로 적용한 보조 지표입니다.</li>
            </ul>
          </UnifiedReportSection>

          {report.hasVideo && (
            <UnifiedReportSection title="측정 영상">
              <video src={report.previewVideoUrl} controls playsInline
                className="w-full rounded-lg bg-black aspect-[3/4] object-contain" />
            </UnifiedReportSection>
          )}
        </div>
      </UnifiedReportPage>

      <div className="w-full max-w-[794px] mx-auto mt-3 space-y-2">
        <ReportActions reportNodeId="squat-report-sheet" videoBlob={report.videoBlob || null}
          baseName={`${report.member?.name || '회원'}_오버헤드스쿼트`} onMessage={setVideoShareMsg}
          simpleSummary={buildSummaryData(report, { reportType: 'squat' })} simpleMember={member} />
        {videoShareMsg && <p className="text-center text-xs text-emerald-700 dark:text-emerald-400">{videoShareMsg}</p>}
        {!member?.isVirtual && typeof onViewInReport === 'function' && (
          <button
            onClick={onViewInReport}
            className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm py-2.5"
          >
            📊 결과리포트에서 보기
          </button>
        )}
        {typeof onRemeasure === 'function' && (
          <button onClick={onRemeasure} className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 text-white font-bold text-sm py-2.5">← 다시 측정</button>
        )}
      </div>
    </UnifiedReportCanvas>
  );
}
