// ai-measure/menus/SprintAnalysisHub.jsx
//
// GaitAnalysisHub.jsx의 진입점 패턴(라이브/업로드 모드 전환)을 따르되,
// 1차 버전이라 SprintUploadAnalysis.jsx가 아직 없어 업로드 모드는 비활성
// 상태로만 표시한다. 완성되면 GaitAnalysisHub.jsx처럼 mode 상태로 분기하면 됨.
//
// GaitAnalysisHub.jsx와 달리 뺀 것: 결과리포트 대시보드(GaitReportDashboard
// 상당), 기록·확인(MeasureRecordConfirm) 단계, 직전 측정 비교(previousReport)
// 자동 조회. SprintLiveAnalysis.jsx가 자체 결과 화면을 갖고 있어 1차로는
// 그대로 통과시킨다 — 다른 탭과 동일한 리포트 대시보드가 필요해지면
// GaitAnalysisHub.jsx를 참고해 이 파일에 추가한다.

import React from 'react';
import SprintLiveAnalysis from './SprintLiveAnalysis';

export default function SprintAnalysisHub({ member, onBack, saveToFirebase, onSave, onSaveToFirebase }) {
  const save = saveToFirebase || onSaveToFirebase || onSave;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950" style={{ height: '100dvh' }}>
      <SprintLiveAnalysis
        member={member}
        onBack={onBack}
        onSaveToFirebase={save}
      />
    </div>
  );
}
