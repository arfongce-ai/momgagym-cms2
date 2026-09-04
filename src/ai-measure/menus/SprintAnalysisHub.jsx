// ai-measure/menus/SprintAnalysisHub.jsx
//
// GaitAnalysisHub.jsx의 진입점 패턴(라이브/업로드 모드 전환)을 따른다.
// SprintUploadAnalysis.jsx(고속촬영 업로드 모드) 연결 완료 — 라이브·업로드 모두
// 자체 결과 화면 + 저장 버튼을 갖고 있어(SprintLiveAnalysis.jsx와 동일 패턴)
// Hub는 모드 전환만 담당한다.
//
// GaitAnalysisHub.jsx와 달리 아직 없는 것: 결과리포트 대시보드(GaitReportDashboard
// 상당), 기록·확인(MeasureRecordConfirm) 단계, 직전 측정 비교(previousReport)
// 자동 조회. 다른 탭과 동일한 리포트 대시보드가 필요해지면 GaitAnalysisHub.jsx를
// 참고해 이 파일에 추가한다.

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
