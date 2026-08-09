import React, { useState, useCallback } from 'react';
import { useHardwareBack } from '../core/useHardwareBack';
import GaitRunningAnalysis from './GaitRunningAnalysis';
import GaitUploadAnalysis from './GaitUploadAnalysis';
import GaitReportDashboard from './GaitReportDashboard';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';

/*
 * GaitAnalysisHub — 보행/러닝 분석 진입점
 * ──────────────────────────────────────────────────────────────
 * mode 상태로 라이브/업로드 분기, 분석 완료 시 대시보드로 자동 이동.
 *
 *   mode='live'   → GaitRunningAnalysis (기존 실시간 측정, 그대로 렌더)
 *   mode='upload' → GaitUploadAnalysis  (영상 업로드 후 seek 분석)
 *   view='report' → GaitReportDashboard (분석 완료 후 자동 표시)
 *
 * props:
 *   member          회원 객체
 *   onBack          () => void                상위(AiMeasureHub)로 복귀
 *   saveToFirebase  (reportData) => Promise   gait_reports 저장 (기존 함수 그대로)
 *   onCommentSave   (reportId, text) => void  (선택) 대시보드 코멘트 저장
 */
export default function GaitAnalysisHub({ member, onBack, saveToFirebase, onSave, onSaveToFirebase, onCommentSave, onViewInReport }) {
  const save = saveToFirebase || onSaveToFirebase || onSave;

  const [mode, setMode] = useState('live');     // live | upload
  const [view, setView] = useState('measure');  // measure | record | report
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(null); // 측정완료~확인 사이 데이터
  const [pendingVideo, setPendingVideo] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [reportVideoBlob, setReportVideoBlob] = useState(null); // 결과 리포트 동영상 저장용(화면 전용)

  // 확인 시 실제 저장(유효 측정만) → 리포트 확인
  const persist = useCallback(async (reportData, record = {}, videoBlob) => {
    const withRecord = { ...reportData, note: record.note || reportData.note || '' };
    let saved = withRecord;
    setSaveState('saving');
    if (withRecord.valid === true && typeof save === 'function') {
      try {
        const res = await save(withRecord);
        if (res && typeof res === 'object') saved = { ...withRecord, ...res };
        setSaveState('saved');
      } catch (e) { setSaveState('error'); }
    } else { setSaveState('saved'); }
    setReport(saved);
    if (videoBlob !== undefined) setReportVideoBlob(videoBlob || null);
    setView('report');
  }, [save]);

  // 업로드 분석 완료 → 기록·확인 단계 (즉시 저장하지 않음)
  const handleComplete = useCallback((reportData) => {
    setPending(reportData); setPendingVideo(undefined); setSaveState('idle'); setView('record');
  }, []);

  // 라이브 저장 래퍼: 라이브 컴포넌트가 측정 중 저장(id 확보)에 사용 — 그대로 유지.
  const liveSave = useCallback(async (reportData) => {
    let saved = reportData;
    if (typeof save === 'function') {
      try {
        const res = await save(reportData);
        if (res && typeof res === 'object') saved = { ...reportData, ...res };
      } catch (e) {
        setReport(reportData);
        throw e;
      }
    }
    setReport(saved);
    return saved;
  }, [save]);

  const openLiveReport = useCallback((reportData, videoBlob) => {
    // 통일 흐름: 측정완료 → 기록·확인 → (라이브는 이미 저장됨) → 리포트
    setPending(reportData); setPendingVideo(videoBlob || null); setSaveState('idle'); setView('record');
  }, []);

  const confirmRecord = useCallback((record) => {
    if (pending) persist(pending, record, pendingVideo);
  }, [pending, pendingVideo, persist]);

  // 대시보드에서 측정 화면으로 복귀
  const backToMeasure = () => { setView('measure'); setReport(null); setReportVideoBlob(null); setPending(null); setSaveState('idle'); };
  // [항목 2] 폰 뒤로가기: 리포트/기록 화면이면 측정 화면으로 한 단계만 복귀.
  useHardwareBack((view === 'report' && !!report) || view === 'record', backToMeasure);

  if (view === 'record' && pending) {
    const g = pending.metrics || pending;
    const rows = [];
    if (g.cadence != null) rows.push({ label: '케이던스', value: `${g.cadence}spm` });
    if (g.speed != null) rows.push({ label: '속도', value: `${g.speed}` });
    if (g.symmetry != null) rows.push({ label: '대칭성', value: `${g.symmetry}%` });
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="max-w-md mx-auto p-4">
          <MeasureRecordConfirm
            title="보행·러닝"
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
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-slate-900/90 backdrop-blur border-b border-slate-800">
          <button onClick={backToMeasure} className="text-slate-300 font-bold text-sm">← 다시 측정</button>
          <span className="text-white font-black text-sm">종합 리포트</span>
          <button onClick={onBack} className="text-slate-400 text-sm font-bold">닫기</button>
        </div>
        <GaitReportDashboard
          report={report}
          videoBlob={reportVideoBlob}
          onComment={(onCommentSave && report.id) ? (text) => onCommentSave(report.id, text) : undefined}
          onClose={onBack}
          member={member}
        />
        {/* [리포트 통합 2026-08-09] PostureMeasure.jsx/RomMeasure.jsx와 동일 패턴 —
            강제 이동 아님. 이 화면 자체가 이미 결과 리포트를 보여주고 있어서(인라인),
            "결과리포트에서 보기"는 정확히는 "이 리포트를 전체 결과리포트 화면(다른
            회차와 함께 넘겨보기·회원 종합 섹션까지) 안에서 다시 보기"라는 의미다.
            미등록회원은 지원 안 함(AiMeasureHub.viewInReport가 걸러줌). */}
        {!member?.isVirtual && typeof onViewInReport === 'function' && (
          <div className="mx-auto w-full max-w-[794px] px-4 pb-6">
            <button
              onClick={onViewInReport}
              className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-sm py-2.5"
            >
              📊 결과리포트에서 보기
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      {/* 모드 전환 UI — 상단 중앙, 라이브 타이틀 아래로 오프셋해 헤더와 겹치지 않게.
          z 는 라이브 헤더(기본)보다 위, 측정 컨트롤보다 아래. */}
      {view === 'measure' && (
        <div className="absolute top-[max(64px,calc(env(safe-area-inset-top)+64px))] inset-x-0 z-[86] flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
            {[['live', '🔴 실시간'], ['upload', '📁 업로드']].map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                  mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 리포트 준비 시(라이브 저장 직후 등) 종합 대시보드 진입 버튼.
          자동 이동을 강제하지 않아 라이브의 영상 미리보기/재촬영 흐름을 보존한다.
          상단 우측에 띄워 하단 측정 컨트롤(셔터·도구)과 겹치지 않게 한다. */}
      {report && view === 'measure' && (
        <button onClick={() => setView('report')}
          className="absolute top-[max(64px,calc(env(safe-area-inset-top)+64px))] right-3 z-[87] rounded-full bg-emerald-500 text-slate-950 text-xs font-black px-3.5 py-1.5 shadow-lg">
          📊 리포트
        </button>
      )}

      {mode === 'live' ? (
        // 기존 실시간 컴포넌트 — UI 변경 없음. 저장은 liveSave 로 위임받아 리포트도 캡처.
        <GaitRunningAnalysis
          member={member}
          onBack={onBack}
          onSaveToFirebase={liveSave}
          onOpenSavedReport={openLiveReport}
        />
      ) : (
        <GaitUploadAnalysis
          member={member}
          onBack={onBack}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}
