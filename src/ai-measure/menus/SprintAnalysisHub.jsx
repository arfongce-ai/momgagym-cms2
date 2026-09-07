// ai-measure/menus/SprintAnalysisHub.jsx
//
// GaitAnalysisHub.jsx의 진입점 패턴(라이브/업로드 모드 전환)을 따른다.
// SprintUploadAnalysis.jsx(고속촬영 업로드 모드) 연결 완료 — 라이브·업로드 모두
// 자체 측정→기록·확인(MeasureRecordConfirm)→결과 화면을 갖고 있어(SprintLiveAnalysis.jsx와
// 동일 패턴) Hub는 모드 전환만 담당한다.
//
// [직전 측정 비교 2026-09-07] SprintLiveAnalysis.jsx/SprintUploadAnalysis.jsx가
// 각자 결과 화면을 자체 소유하는 구조라 Hub가 아니라 두 컴포넌트 안에 각각
// GaitAnalysisHub.jsx:38-54와 동일 패턴으로 previousReport를 이식했다.
// [기록·확인 단계 2026-09-07] 마찬가지로 두 컴포넌트 안에 각각 GaitAnalysisHub.jsx의
// view==='record' 화면(MeasureRecordConfirm)과 동일한 패턴을 이식 — 측정 직후
// 바로 저장하지 않고 메모를 남기고 확인해야 실제 저장된다.
// [결과리포트 대시보드·영상 다시보기 2026-09-07] SprintReportDashboard.jsx가
// GaitReportDashboard.jsx 상당의 전용 대시보드다(같은 컴포넌트 조합: 문제 포커스·
// 모미 자동노트/대화·전후 변화·영상 비교·트레이너 코멘트). 라이브 모드는 큐~종료
// 구간을 MediaRecorder로 녹화(GaitRunningAnalysis.jsx 참고, 캔버스 합성 없이 원본
// 그대로), 업로드 모드는 업로드된 원본 파일을 그대로 videoBlob으로 넘긴다 — 둘 다
// 화면 전용(Firestore/Storage 미저장, storagePolicy.videoStored:false와 동일 정책).

import React, { useState } from 'react';
import SprintLiveAnalysis from './SprintLiveAnalysis';
import SprintUploadAnalysis from './SprintUploadAnalysis';

export default function SprintAnalysisHub({ member, onBack, saveToFirebase, onSave, onSaveToFirebase }) {
  const save = saveToFirebase || onSaveToFirebase || onSave;
  const [mode, setMode] = useState('live'); // live | upload

  return (
    <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950" style={{ height: '100dvh' }}>
      {/* 모드 전환 UI — GaitAnalysisHub.jsx와 동일한 위치·스타일 규약 */}
      <div className="absolute top-[max(64px,calc(env(safe-area-inset-top)+64px))] inset-x-0 z-[86] flex justify-center pointer-events-none">
        <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
          {[['live', '🔴 실시간'], ['upload', '📁 업로드']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-600 dark:text-slate-300'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'live' ? (
        <SprintLiveAnalysis
          member={member}
          onBack={onBack}
          onSaveToFirebase={save}
        />
      ) : (
        <SprintUploadAnalysis
          member={member}
          onBack={onBack}
          onSaveToFirebase={save}
        />
      )}
    </div>
  );
}
