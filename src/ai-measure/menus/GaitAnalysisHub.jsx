import React, { useState, useCallback } from 'react';
import GaitRunningAnalysis from './GaitRunningAnalysis';
import GaitUploadAnalysis from './GaitUploadAnalysis';
import GaitReportDashboard from './GaitReportDashboard';

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
export default function GaitAnalysisHub({ member, onBack, saveToFirebase, onSave, onSaveToFirebase, onCommentSave }) {
  const save = saveToFirebase || onSaveToFirebase || onSave;

  const [mode, setMode] = useState('live');     // live | upload
  const [view, setView] = useState('measure');  // measure | report
  const [report, setReport] = useState(null);

  // 업로드 분석 완료 → 저장(단일 책임) + 대시보드 자동 이동 (요구사항 3)
  const handleComplete = useCallback(async (reportData) => {
    let saved = reportData;
    if (reportData.valid === true && typeof save === 'function') {
      try {
        const res = await save(reportData);
        if (res && typeof res === 'object') saved = { ...reportData, ...res };
      } catch (e) {
        // 저장 실패해도 분석 결과는 보여준다(코멘트 저장만 비활성)
      }
    }
    setReport(saved);
    setView('report');
  }, [save]);

  // 라이브 모드 저장 콜백 래퍼: 저장 후 저장본(서버가 부여한 id 포함)을 잡아둬
  // 대시보드 코멘트가 정확한 문서를 갱신하게 한다.
  const liveSave = useCallback(async (reportData) => {
    let saved = reportData;
    if (typeof save === 'function') {
      try {
        const res = await save(reportData);
        // addGaitReport 가 저장본을 반환하면(id 포함) 그것을 사용
        if (res && typeof res === 'object') saved = { ...reportData, ...res };
      } catch (e) {
        setReport(reportData); // 저장 실패해도 리포트는 볼 수 있게
        throw e;               // 라이브 컴포넌트가 error 상태 표시하도록 전파
      }
    }
    setReport(saved);
    return saved;
  }, [save]);

  const openLiveReport = useCallback((reportData) => {
    if (reportData) setReport(reportData);
    setView('report');
  }, []);

  // 대시보드에서 측정 화면으로 복귀
  const backToMeasure = () => { setView('measure'); setReport(null); };

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
          onComment={(onCommentSave && report.id) ? (text) => onCommentSave(report.id, text) : undefined}
          onClose={onBack}
        />
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
