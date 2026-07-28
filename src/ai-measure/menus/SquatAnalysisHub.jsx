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
import React, { useState, useCallback } from 'react';
import SquatUploadAnalysis from './SquatUploadAnalysis';
import SquatLiveAnalysis from './SquatLiveAnalysis';
import { evaluateSquatBiomechanics } from '../core/squatBiomechanics';
import { buildProblemFocus } from '../core/crossMeasureContext';
import { useHardwareBack } from '../core/useHardwareBack';
import { shareReportWithVideo } from '../core/reportShare';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';

const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' };
const BASIS_KO = { immediate: '즉시확정', reproducibility: '재현성확정', single_trial_only: '단일 시행(재측정 권장)', no_valid_trial: '측정 무효' };

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
  const shareVideo = async (blob) => {
    setVideoShareMsg('');
    const res = await shareReportWithVideo(null, blob, { baseName: 'SQUAT', title: '오버헤드 딥 스쿼트 영상' });
    setVideoShareMsg(res.msg || '');
  };

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
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="max-w-md mx-auto p-4 space-y-4">
          <div className="flex items-center justify-between mt-[max(44px,calc(env(safe-area-inset-top)+44px))]">
            <h2 className="text-white font-black text-lg">오버헤드 딥 스쿼트 결과</h2>
            <button onClick={onBack} className="text-slate-300 font-bold text-sm">닫기 ✕</button>
          </div>

          <div className={`rounded-2xl border p-4 ${
            focus.severity === 'risk' ? 'border-red-500/40 bg-red-500/10'
              : focus.severity === 'caution' ? 'border-amber-500/40 bg-amber-500/10'
              : 'border-emerald-500/40 bg-emerald-500/10'}`}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">종합 판정</p>
            <p className="text-white font-black text-xl">{STATUS_KO[report.status] || '-'}</p>
            <p className="text-slate-300 text-sm mt-1">{focus.primaryFinding}</p>
          </div>

          {report.trials?.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {report.trials.map((t, i) => (
                <div key={i} className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                  <p className="text-[11px] text-slate-400">{i === 0 ? '1회차' : '2회차'}</p>
                  <p className="text-white font-black">{STATUS_KO[t.status] || '-'}</p>
                  {t.thighInclineDeg != null && (
                    <p className="text-[11px] text-slate-500 mt-1">깊이 잔여 {t.thighInclineDeg}°</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {focus.issues?.length > 0 && (
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-2">
              <p className="text-xs font-black text-slate-300">확인된 사항</p>
              {focus.issues.map((it, i) => (
                <p key={i} className={`text-sm ${it.level === 'risk' ? 'text-red-300' : 'text-amber-300'}`}>• {it.text}</p>
              ))}
            </div>
          )}
          {focus.strengths?.length > 0 && (
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-2">
              <p className="text-xs font-black text-slate-300">양호한 점</p>
              {focus.strengths.map((s, i) => <p key={i} className="text-sm text-emerald-300">• {s}</p>)}
            </div>
          )}

          {/* [녹화 통일] 실시간 모드로 측정했으면 녹화 영상을 여기서 확인·공유 */}
          {report.hasVideo && (
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-2">
              <p className="text-xs font-black text-slate-300">측정 영상</p>
              <video src={report.previewVideoUrl} controls playsInline
                className="w-full rounded-lg bg-black aspect-[3/4] object-contain" />
              <button onClick={() => shareVideo(report.videoBlob)}
                className="w-full rounded-lg bg-slate-700 text-white font-bold text-xs py-2 active:scale-95">
                📹 영상 저장/공유
              </button>
              {videoShareMsg && <p className="text-center text-xs text-emerald-400">{videoShareMsg}</p>}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 z-10 flex justify-center p-3 bg-slate-900/90 backdrop-blur border-t border-slate-800">
          <button onClick={backToMeasure} className="rounded-lg bg-slate-700 text-white font-bold text-sm px-6 py-2">← 다시 측정</button>
        </div>
      </div>
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
          onMemberHeightChange={onMemberHeightChange}
        />
      ) : (
        <SquatUploadAnalysis
          member={member}
          onBack={onBack}
          onComplete={handleComplete}
          onMemberHeightChange={onMemberHeightChange}
        />
      )}
    </div>
  );
}
