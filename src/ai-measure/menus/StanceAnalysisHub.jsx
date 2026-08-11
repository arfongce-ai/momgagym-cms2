// ai-measure/menus/StanceAnalysisHub.jsx
// ════════════════════════════════════════════════════════════════════════
//  한다리서기(SLST) 측정 진입점.
//   1) 눈뜨고: 왼쪽 다리 지지 측정 → 오른쪽 다리 지지 측정
//   2) (눈감아주세요 전환 화면)
//   3) 눈감고: 왼쪽 다리 지지 측정 → 오른쪽 다리 지지 측정
//   → evaluateSingleLegStanceWithEyes()로 종합 판정 → buildProblemFocus()로 요약
//   → MEASURE_FLOW.md 표준 흐름(기록 → 확인·저장 → 기록 확인)
//
//  [2026-08-02] 눈뜨고/눈감고 조건 분리 측정 도입. 기존엔 왼쪽→오른쪽 1회씩만
//  측정했으나, 이제 같은 순서를 눈뜨고/눈감고 두 조건으로 반복해 총 4회 시행을
//  모은다(다리당 시행 횟수 자체는 그대로 1회). 두 조건은 서로 다른 기준(눈감으면
//  정상인도 흔들림이 커지는 게 자연스러움)이라 재현성 신호로 섞지 않고
//  evaluateSingleLegStanceWithEyes()가 조건별로 독립 판정한 뒤 종합한다.
//  [2026-08-02] 키(신장) 입력 요구 제거 — SLST 판정은 각도·비율·유지시간 기반이라
//  cm 환산이 필수가 아니며, 흔들림 경로 cm 환산은 어차피 부가 신호였다.
//
//  JumpAnalysisHub.jsx 와 동일한 저장 책임 분리(Hub가 단일 저장 지점) +
//  동일한 mode 토글 자리(실시간/업로드). 두 방식 모두 singleLegStanceTracker.js
//  하나를 공유하므로 판정 결과는 방식과 무관하게 동일한 로직으로 나온다.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo } from 'react';
import StanceLiveAnalysis from './StanceLiveAnalysis';
import StanceUploadAnalysis from './StanceUploadAnalysis';
import StanceReportDashboard from './StanceReportDashboard';
import { evaluateSingleLegStanceWithEyes } from '../core/singleLegStance';
import { buildProblemFocus } from '../core/crossMeasureContext';
import { useHardwareBack } from '../core/useHardwareBack';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';

// [리포트 통합 2026-08-09] 결과 리포트 표시(HoldTimeBar/AngleBar/STATUS_TOKEN 등
// 포함)는 StanceReportDashboard.jsx로 옮겼다 — Report.jsx(저장된 리포트 다시
// 보기)에서도 재사용하기 위함(GaitReportDashboard.jsx 등과 동일 패턴). STATUS_KO는
// 아래 기록·확인 화면(view==='record')에서도 쓰여서 여기 그대로 남겨둔다.
const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' };

export default function StanceAnalysisHub({ member, onBack, onSave, onSaveToFirebase, onViewInReport }) {
  const save = onSaveToFirebase || onSave;

  // 요청에 따라 실시간을 기본값으로 (JumpAnalysisHub와 동일한 자리에 동일한 토글 UI)
  const [mode, setMode] = useState('live'); // live | upload
  const [eyesState, setEyesState] = useState('open'); // open | closed
  const [legStep, setLegStep] = useState('left'); // left | right
  const [openLeft, setOpenLeft] = useState(null);
  const [openRight, setOpenRight] = useState(null);
  const [closedLeft, setClosedLeft] = useState(null);
  const [closedRight, setClosedRight] = useState(null);

  const [view, setView] = useState('measure'); // measure | eyes_transition | record | report
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  const combineAndProceed = useCallback((openL, openR, closedL, closedR) => {
    const evalResult = evaluateSingleLegStanceWithEyes({
      open: { left: openL, right: openR },
      closed: { left: closedL, right: closedR },
    });
    const focus = buildProblemFocus('stance', evalResult);
    const reportData = {
      valid: evalResult.valid,
      kind: 'stance',
      ...evalResult,
      problemFocus: focus,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
      // [녹화 통일] 눈뜨고/눈감고 × 좌/우, 라이브 모드에서 녹화된 영상(있으면).
      // 업로드 모드는 영상을 새로 만들지 않으므로 null — hasVideo로 화면에서 분기한다.
      openLeftVideoBlob: openL?.videoBlob || null,
      openRightVideoBlob: openR?.videoBlob || null,
      closedLeftVideoBlob: closedL?.videoBlob || null,
      closedRightVideoBlob: closedR?.videoBlob || null,
      openLeftPreviewVideoUrl: openL?.previewVideoUrl || '',
      openRightPreviewVideoUrl: openR?.previewVideoUrl || '',
      closedLeftPreviewVideoUrl: closedL?.previewVideoUrl || '',
      closedRightPreviewVideoUrl: closedR?.previewVideoUrl || '',
      hasVideo: !!(openL?.videoBlob || openR?.videoBlob || closedL?.videoBlob || closedR?.videoBlob),
    };
    setPending(reportData);
    setSaveState('idle');
    setView('record');
  }, [member]);

  const handleLegComplete = useCallback((summary) => {
    if (eyesState === 'open') {
      if (legStep === 'left') {
        setOpenLeft(summary);
        setLegStep('right');
      } else {
        setOpenRight(summary);
        setView('eyes_transition'); // 눈뜨고 좌/우 완료 — 눈감고 단계로 넘어가는 전환 화면
      }
    } else if (legStep === 'left') {
      setClosedLeft(summary);
      setLegStep('right');
    } else {
      setClosedRight(summary);
      combineAndProceed(openLeft, openRight, closedLeft, summary);
    }
  }, [eyesState, legStep, openLeft, openRight, closedLeft, combineAndProceed]);

  const proceedToClosedPhase = () => {
    setEyesState('closed');
    setLegStep('left');
    setView('measure');
  };

  const persist = useCallback(async (reportData, record = {}) => {
    const withRecord = { ...reportData, note: record.note || '' };
    let saved = withRecord;
    setSaveState('saving');
    // 영상 Blob/blob-URL은 Firestore에 못 넣으므로 저장 페이로드에서 제외한다
    // (ROM과 동일한 패턴). 화면 표시용 report 상태에는 그대로 남긴다.
    const {
      openLeftVideoBlob, openRightVideoBlob, closedLeftVideoBlob, closedRightVideoBlob,
      openLeftPreviewVideoUrl, openRightPreviewVideoUrl, closedLeftPreviewVideoUrl, closedRightPreviewVideoUrl,
      ...persistable
    } = withRecord;
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
    setEyesState('open'); setLegStep('left');
    setOpenLeft(null); setOpenRight(null); setClosedLeft(null); setClosedRight(null);
  };
  useHardwareBack((view === 'report' && !!report) || view === 'record', backToMeasure);

  if (view === 'eyes_transition') {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-amber-500/30 rounded-2xl p-6 space-y-4 text-center">
          <p className="text-4xl">🙈</p>
          <p className="text-white font-black text-lg">눈감고 측정으로 이동</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
            눈뜨고 왼쪽 → 오른쪽 측정이 끝났습니다.<br />
            이어서 같은 순서로 <span className="text-amber-700 dark:text-amber-300 font-bold">눈을 감고</span> 진행합니다.
          </p>
          <p className="text-slate-500 text-xs">회원에게 눈을 감아달라고 안내한 뒤 계속을 눌러주세요.</p>
          <button onClick={proceedToClosedPhase}
            className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95">
            준비됐어요 — 계속
          </button>
          <button onClick={onBack} className="text-slate-500 text-xs underline">측정 중단하고 나가기</button>
        </div>
      </div>
    );
  }

  if (view === 'record' && pending) {
    const rows = [
      { label: '눈뜨고 · 왼쪽', value: STATUS_KO[pending.eyesOpen?.left?.status] || '-' },
      { label: '눈뜨고 · 오른쪽', value: STATUS_KO[pending.eyesOpen?.right?.status] || '-' },
      { label: '눈감고 · 왼쪽', value: STATUS_KO[pending.eyesClosed?.left?.status] || '-' },
      { label: '눈감고 · 오른쪽', value: STATUS_KO[pending.eyesClosed?.right?.status] || '-' },
      { label: '종합', value: STATUS_KO[pending.status] || '-' },
    ];
    return (
      <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="max-w-md mx-auto p-4">
          <MeasureRecordConfirm
            title="한다리서기 (SLST)"
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
      <StanceReportDashboard
        report={report}
        member={member}
        onClose={onBack}
        onRemeasure={backToMeasure}
        onViewInReport={onViewInReport}
      />
    );
  }

  // view === 'measure' — 눈뜨고(왼쪽→오른쪽) → 눈감고(왼쪽→오른쪽) 순서로 진행
  return (
    <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950" style={{ height: '100dvh' }}>
      <div className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex flex-col items-center gap-1.5 px-3 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/55 backdrop-blur px-3 py-1.5 border border-white/10 shadow-lg">
          <span className={`text-xs font-black ${eyesState === 'open' ? 'text-cyan-700 dark:text-cyan-300' : 'text-violet-700 dark:text-violet-300'}`}>
            {eyesState === 'open' ? '👁 눈뜨고' : '🙈 눈감고'}
          </span>
          <span className="text-slate-500 text-xs">|</span>
          <span className={`text-xs font-black ${legStep === 'left' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {legStep === 'left' ? '① 왼쪽' : '✓ 왼쪽'}
          </span>
          <span className="text-slate-500 text-xs">→</span>
          <span className={`text-xs font-black ${legStep === 'right' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
            ② 오른쪽
          </span>
        </div>
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
        <StanceLiveAnalysis
          // [2026-08-02] key 필수 — 없으면 왼발→오른발로 넘어갈 때 React가 같은
          // 컴포넌트 인스턴스를 재사용한다. 그러면 이전 다리에서 true가 된
          // recordingStartedRef 등 ref들이 그대로 남아 beginRecording()이 즉시
          // return 하고(→ 오른발 녹화 안 됨), 앞 단계에서 stop()으로 꺼진 카메라도
          // 다시 켜지지 않아 화면이 검게 나온다. 다리/눈 조건이 바뀌면 완전히
          // 새 측정이므로 통째로 remount 시킨다.
          key={`live-${eyesState}-${legStep}`}
          member={member}
          stanceLeg={legStep}
          eyesClosed={eyesState === 'closed'}
          onBack={onBack}
          onComplete={handleLegComplete}
        />
      ) : (
        <StanceUploadAnalysis
          key={`upload-${eyesState}-${legStep}`}
          member={member}
          stanceLeg={legStep}
          eyesClosed={eyesState === 'closed'}
          onBack={onBack}
          onComplete={handleLegComplete}
        />
      )}
    </div>
  );
}
