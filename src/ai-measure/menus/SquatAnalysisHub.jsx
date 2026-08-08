// ai-measure/menus/SquatAnalysisHub.jsx
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트 측정 진입점.
//   영상 분석(SquatUploadAnalysis/SquatLiveAnalysis) → evaluateSquatBiomechanics()로
//   종합 판정 → buildProblemFocus()로 요약 → MEASURE_FLOW.md 표준 흐름
//   (기록 → 확인·저장 → 기록 확인).
//
//  StanceAnalysisHub.jsx와 동일한 저장 책임 분리(Hub가 단일 저장 지점) + 동일한
//  mode 토글 자리(실시간/업로드). 두 방식 모두 squatBiomechanicsTracker.js 하나를
//  공유하므로 판정 결과는 방식과 무관하게 동일한 로직으로 나온다. 다리 좌/우
//  구분이 없어 좌/우 2단계 대신 단일 측정 1단계로 끝난다(반복 2회 모두 트래커가
//  한 번에 잡아낸다).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo } from 'react';
import SquatUploadAnalysis from './SquatUploadAnalysis';
import SquatLiveAnalysis from './SquatLiveAnalysis';
import { evaluateSquatBiomechanics, SQUAT_TUNING } from '../core/squatBiomechanics';
import { depthPctFromThighIncline } from '../core/squatFms';
import { buildProblemFocus } from '../core/crossMeasureContext';
import { useHardwareBack } from '../core/useHardwareBack';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import MomiAutoNote from '../../components/report/MomiAutoNote.jsx';
import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';
import { aiStore } from '../../demoData';
import ReportActions from '../../components/report/ReportActions';
import { MetricCard, UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection } from '../../components/report/UnifiedReportPrimitives';

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
// 실측 각도·시각화·해석을 담는다(이전엔 종합 판정 한 줄 + 시행별 상태 단어만
// 있어서 "부실하다"는 피드백을 받았다). 임계값은 squatBiomechanics.js의
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
  normal: { key: 'normal', label: '정상', color: 'text-emerald-300', colorClass: 'text-emerald-300', bgClass: 'bg-emerald-500/12', borderClass: 'border-emerald-400/35', bar: 'bg-emerald-400' },
  caution: { key: 'caution', label: '주의', color: 'text-amber-300', colorClass: 'text-amber-300', bgClass: 'bg-amber-500/12', borderClass: 'border-amber-400/35', bar: 'bg-amber-400' },
  risk: { key: 'risk', label: '위험', color: 'text-red-300', colorClass: 'text-red-300', bgClass: 'bg-red-500/12', borderClass: 'border-red-400/35', bar: 'bg-red-400' },
  observed: { key: 'observed', label: '1회만 관찰(재현 안 됨)', color: 'text-slate-400', colorClass: 'text-slate-300', bgClass: 'bg-slate-500/12', borderClass: 'border-slate-400/35', bar: 'bg-slate-500' },
  unknown: { key: 'unknown', label: '측정 안 됨', color: 'text-slate-500', colorClass: 'text-slate-400', bgClass: 'bg-slate-600/12', borderClass: 'border-slate-500/35', bar: 'bg-slate-700' },
};

// trials=[front1,front2,side1,side2](또는 구버전 [front,side])에서 지표별
// 권위 소스(무릎·골반=정면, 팔=측면, 상체=torsoLeanSource, 깊이=양쪽)만 골라
// "더 나쁜 값"을 대표값으로 삼는다(더 좋은 값을 고르지 않는다는 측정 정직성
// 원칙 — squatBiomechanics.js·squatFms.js와 동일).
export function extractSquatMetrics(report) {
  const trials = report?.trials || [];
  const half = Math.ceil(trials.length / 2) || 1;
  const front = trials.slice(0, half);
  const side = trials.slice(half);
  const worstOf = (arr, key) => {
    const vals = arr.map((t) => t?.[key]).filter((v) => v != null);
    return vals.length ? Math.round(Math.max(...vals) * 10) / 10 : null;
  };
  return {
    depthDeg: worstOf(trials, 'thighInclineDeg'),
    kneeValgusDeg: worstOf(front, 'kneeValgusDeg'),
    pelvicTiltDeg: worstOf(front, 'pelvicTiltDeg'),
    armDropDeg: worstOf(side, 'armDropDeg'),
    torsoLeanDeg: report?.torsoLeanSource === 'side' ? worstOf(side, 'torsoLeanDeg') : worstOf(front, 'torsoLeanDeg'),
  };
}

// 재현성 2단계 판정을 그대로 반영 — 같은 신호가 반복돼야 확정(caution/risk)이고,
// 한 번만 나오면 "observed"(관찰됨·미확정)로 정상과 구분해 보여준다. 일반
// range 재계산이 아니라 evaluateSquatBiomechanics()가 이미 낸 결론을 그대로 쓴다.
export function squatMetricStatus(report, flagPrefix) {
  const confirmed = (report?.confirmedFlags || []).find((f) => f.startsWith(flagPrefix));
  if (confirmed) return confirmed.endsWith('_high') ? 'risk' : 'caution';
  const unconfirmed = (report?.unconfirmedFlags || []).some((f) => f.startsWith(flagPrefix));
  return unconfirmed ? 'observed' : 'normal';
}

export function computeSquatScore(report, m) {
  if (report?.valid === false) return 0;
  const entries = [
    [METRIC_RANGES.depth.flagPrefix, m.depthDeg],
    [METRIC_RANGES.torso.flagPrefix, m.torsoLeanDeg],
    [METRIC_RANGES.knee.flagPrefix, m.kneeValgusDeg],
    [METRIC_RANGES.pelvis.flagPrefix, m.pelvicTiltDeg],
    [METRIC_RANGES.arm.flagPrefix, m.armDropDeg],
  ];
  const scores = [];
  entries.forEach(([prefix, val]) => {
    if (val == null) return;
    const st = squatMetricStatus(report, prefix);
    scores.push(st === 'normal' ? 100 : st === 'risk' ? 35 : 65);
  });
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}

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
        <span className="text-[12px] font-bold text-slate-300">{range.label}</span>
        <span className={`text-[12px] font-black tabular-nums ${token.color}`}>
          {value.deg == null ? '측정 안 됨' : `${value.deg}${range.unit}`} · {token.label}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-700/70">
        <div className="absolute top-0 left-0 h-full bg-emerald-500/20" style={{ width: `${goodW}%` }} />
        {value.deg != null && <div className={`absolute top-0 left-0 h-full rounded-full ${token.bar}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">정상 0~{range.good[1]}{range.unit}</p>
    </div>
  );
}

export default function SquatAnalysisHub({ member, onBack, onSave, onSaveToFirebase, onMemberHeightChange }) {
  const save = onSaveToFirebase || onSave;

  const [view, setView] = useState('measure'); // measure | record | report
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  // 요청에 따라 실시간을 기본값으로 (StanceAnalysisHub·JumpAnalysisHub와 동일한 자리에 동일한 토글 UI)
  const [mode, setMode] = useState('live'); // live | upload

  const handleComplete = useCallback((summary) => {
    const evalResult = evaluateSquatBiomechanics(summary);
    const focus = buildProblemFocus('squat', evalResult);
    const reportData = {
      ...evalResult,
      kind: 'squat',
      problemFocus: focus,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
      // [2026-08-03] FMS(Functional Movement Screen) 딥 스쿼트 공식 채점(3/2/1/0).
      // 종합 판정(정상/주의/위험)과는 별개의 보조 지표라 report.status를 덮어쓰지
      // 않고 나란히 노출한다.
      fmsScore: summary?.fmsScore ?? null,
      fmsReasons: summary?.fmsReasons || [],
      // [녹화 통일] 라이브 모드에서 녹화된 영상(있으면). 업로드 모드는 새로 안 만듦.
      videoBlob: summary?.videoBlob || null,
      previewVideoUrl: summary?.previewVideoUrl || '',
      hasVideo: !!summary?.videoBlob,
    };
    setPending(reportData);
    setSaveState('idle');
    setView('record');
  }, [member]);

  const persist = useCallback(async (reportData, record = {}) => {
    const withRecord = { ...reportData, note: record.note || '' };
    let saved = withRecord;
    setSaveState('saving');
    // 영상 Blob/blob-URL은 Firestore에 못 넣으므로 저장 페이로드에서 제외(ROM과 동일 패턴).
    const { videoBlob, previewVideoUrl, ...persistable } = withRecord;
    if (withRecord.valid === true && typeof save === 'function') {
      try {
        const res = await save(persistable);
        if (res && typeof res === 'object') saved = { ...withRecord, ...res };
        setSaveState('saved');
      } catch (e) { setSaveState('error'); }
    } else { setSaveState('saved'); }
    setReport(saved);
    setView('report');
  }, [save]);

  const confirmRecord = useCallback((record) => {
    if (pending) persist(pending, record);
  }, [pending, persist]);

  const backToMeasure = () => {
    setView('measure'); setReport(null); setPending(null); setSaveState('idle');
  };
  useHardwareBack((view === 'report' && !!report) || view === 'record', backToMeasure);

  const [videoShareMsg, setVideoShareMsg] = useState('');

  const reportMetrics = useMemo(() => extractSquatMetrics(report), [report]);
  const reportScore = useMemo(() => computeSquatScore(report, reportMetrics), [report, reportMetrics]);

  if (view === 'record' && pending) {
    const rows = [
      { label: '판정 근거', value: BASIS_KO[pending.basis] || '-' },
      { label: '종합', value: STATUS_KO[pending.status] || '-' },
    ];
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="max-w-md mx-auto p-4">
          <MeasureRecordConfirm
            title="오버헤드 딥 스쿼트"
            summaryRows={rows}
            noteMode
            onConfirm={confirmRecord}
            onBack={backToMeasure}
            saving={saveState === 'saving'}
            saved={saveState === 'saved'}
            error={saveState === 'error'}
          />
        </div>
      </div>
    );
  }

  if (view === 'report' && report) {
    const focus = report.problemFocus || {};
    const m = reportMetrics;
    return (
      <UnifiedReportCanvas>
        <div className="mx-auto w-full max-w-[794px] flex items-center justify-between pb-2">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 닫기</button>
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
                <p className="text-xs font-bold text-amber-300">
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
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                무릎·골반은 정면, 팔 처짐은 측면에서만 신뢰할 수 있는 지표라 각각 해당 방향 시행에서만 값을 가져옵니다.
                {report.torsoLeanSource === 'front_fallback' && ' 상체 기울기는 측면 촬영이 없어 정면 값으로 대체했습니다.'}
              </p>
            </UnifiedReportSection>

            {report.fmsScore != null && report.fmsScore < 3 && report.fmsReasons?.length > 0 && (
              <UnifiedReportSection title="③ FMS 감점 사유" subtitle={`${report.fmsScore}점인 이유`}>
                <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-slate-300">
                  {report.fmsReasons.map((r, i) => <li key={i}>{FMS_REASON_KO[r] || r}</li>)}
                </ul>
              </UnifiedReportSection>
            )}

            {report.trials?.length > 0 && (
              <UnifiedReportSection title="④ 시행별 결과" subtitle="정면 2회 · 측면 2회">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {report.trials.map((t, i) => (
                    <div key={i} className="rounded-xl bg-slate-800/70 border border-slate-700/60 p-3">
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
              <ul className="list-disc pl-4 text-[11px] leading-relaxed text-slate-400 space-y-1">
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
            baseName={`${report.member?.name || '회원'}_오버헤드스쿼트`} onMessage={setVideoShareMsg} />
          {videoShareMsg && <p className="text-center text-xs text-emerald-400">{videoShareMsg}</p>}
          <button onClick={backToMeasure} className="w-full rounded-lg bg-slate-800 text-white font-bold text-sm py-2.5">← 다시 측정</button>
        </div>
      </UnifiedReportCanvas>
    );
  }

  // view === 'measure'
  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      <div className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex justify-center px-3 pointer-events-none">
        <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
          {[['live', '🔴 실시간'], ['upload', '📁 영상 업로드']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'live' ? (
        <SquatLiveAnalysis
          member={member}
          onBack={onBack}
          onComplete={handleComplete}
        />
      ) : (
        <SquatUploadAnalysis
          member={member}
          onBack={onBack}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}
