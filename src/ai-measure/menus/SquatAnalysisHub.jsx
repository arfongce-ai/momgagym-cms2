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
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import SquatUploadAnalysis from './SquatUploadAnalysis';
import SquatLiveAnalysis from './SquatLiveAnalysis';
import SquatReportDashboard from './SquatReportDashboard';
import { evaluateSquatBiomechanics } from '../core/squatBiomechanics';
import { buildProblemFocus } from '../core/crossMeasureContext';
import { useHardwareBack } from '../core/useHardwareBack';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';
import { aiStore } from '../../demoData';

// [리포트 통합 2026-08-09] 결과 리포트 표시(MetricBar/METRIC_RANGES 등 포함)는
// SquatReportDashboard.jsx로 옮겼다 — Report.jsx(저장된 리포트 다시 보기)에서도
// 재사용하기 위함(StanceAnalysisHub.jsx/StanceReportDashboard.jsx와 동일 패턴).
// extractSquatMetrics/squatMetricStatus/computeSquatScore도 순환참조를 피해
// core/squatBiomechanics.js로 이동했다. STATUS_KO는 아래 기록·확인 화면
// (view==='record')에서도 쓰여서 여기 그대로 남겨둔다.
const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' };
const BASIS_KO = {
  immediate: '즉시확정',
  reproducibility: '재현성확정',
  single_trial_only: '단일 시행(재측정 권장)',
  no_valid_trial: '측정 무효',
  front_side_combined: '정면+측면 결합',
  single_view_only: '단일 각도(재측정 권장)',
};
export default function SquatAnalysisHub({ member, onBack, onSave, onSaveToFirebase, onMemberHeightChange, onViewInReport }) {
  const save = onSaveToFirebase || onSave;

  const [view, setView] = useState('measure'); // measure | record | report
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  // 요청에 따라 실시간을 기본값으로 (StanceAnalysisHub·JumpAnalysisHub와 동일한 자리에 동일한 토글 UI)
  const [mode, setMode] = useState('live'); // live | upload
  // [전/후 변화 요약 2026-08-31] 스쿼트도 SLST와 동일하게 전용 컬렉션 없이
  // 세션(menu:'squat')에 저장 — StanceAnalysisHub.jsx와 완전히 같은 패턴.
  const [previousReport, setPreviousReport] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!report || !member?.id || member?.isVirtual) { setPreviousReport(null); return undefined; }
    (async () => {
      try {
        const list = await aiStore.ensureSessions(member.id);
        if (cancelled) return;
        const matching = (list || []).filter((s) => s.menu === 'squat' && s.id !== report.id);
        const sorted = matching.sort((a, b) => String(b.recordedAtFull || b.recordedAt || '')
          .localeCompare(String(a.recordedAtFull || a.recordedAt || '')));
        setPreviousReport(sorted[0]?.data || null);
      } catch (e) {
        if (!cancelled) setPreviousReport(null);
      }
    })();
    return () => { cancelled = true; };
  }, [report, member?.id, member?.isVirtual]);

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
      } catch (e) {
        // 저장 실패 — report로 넘어가면 사용자는 성공한 걸로 착각하고 이 기록은
        // Firestore id 없이 유실된다("기록이 안 됨" 버그). record 화면에 남아
        // MeasureRecordConfirm 의 에러 배너 + 재시도 버튼을 그대로 보여준다.
        setSaveState('error');
        return;
      }
      setSaveState('saved');
    } else {
      setSaveState('saved');
    }
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

  if (view === 'record' && pending) {
    const rows = [
      { label: '판정 근거', value: BASIS_KO[pending.basis] || '-' },
      { label: '종합', value: STATUS_KO[pending.status] || '-' },
    ];
    return (
      <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
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
    return (
      <SquatReportDashboard
        report={report}
        member={member}
        onClose={onBack}
        onRemeasure={backToMeasure}
        onViewInReport={onViewInReport}
        previousReport={previousReport}
      />
    );
  }

  // view === 'measure'
  return (
    <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950" style={{ height: '100dvh' }}>
      <div className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex justify-center px-3 pointer-events-none">
        <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
          {[['live', '🔴 실시간'], ['upload', '📁 영상 업로드']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-600 dark:text-slate-300'}`}>
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
