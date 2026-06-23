// ai-measure/menus/JumpAnalysisHub.jsx
// ════════════════════════════════════════════════════════════════════════
//  점프 정밀 측정 진입점 — 보행(GaitAnalysisHub)과 동일 구조.
//   mode='live'   → JumpPrecisionAnalysis (실시간 카메라, 자체 리포트 화면 보유)
//   mode='upload' → JumpUploadAnalysis    (고속영상, 완료 시 Hub 리포트로 이동)
//  저장은 Hub 가 단일 책임으로 처리(중복 저장 방지) — gait 와 동일.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useCallback } from 'react';
import JumpPrecisionAnalysis from './JumpPrecisionAnalysis';
import JumpUploadAnalysis from './JumpUploadAnalysis';

export default function JumpAnalysisHub({ member, onBack, onSave, onSaveToFirebase }) {
  const save = onSaveToFirebase || onSave;
  const [mode, setMode] = useState('live');
  const [view, setView] = useState('measure'); // measure | report
  const [report, setReport] = useState(null);

  // 업로드 완료 → 저장(유효 측정만) + 리포트
  const handleComplete = useCallback(async (reportData) => {
    let saved = reportData;
    if (reportData.valid === true && typeof save === 'function') {
      try {
        const res = await save(reportData);
        if (res && typeof res === 'object') saved = { ...reportData, ...res };
      } catch (e) { /* 저장 실패해도 리포트는 표시 */ }
    }
    setReport(saved);
    setView('report');
  }, [save]);

  const backToMeasure = () => { setView('measure'); setReport(null); };

  if (view === 'report' && report) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-slate-900/90 backdrop-blur border-b border-slate-800">
          <button onClick={backToMeasure} className="text-slate-300 font-bold text-sm">← 다시 측정</button>
          <span className="text-white font-black text-sm">점프 리포트</span>
          <button onClick={onBack} className="text-slate-400 text-sm font-bold">닫기</button>
        </div>
        <UploadReport report={report} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      {view === 'measure' && (
        <div className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
            {[['live', '🔴 실시간'], ['upload', '📁 고속영상']].map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                  mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'live' ? (
        <JumpPrecisionAnalysis member={member} onBack={onBack} onSaveToFirebase={save} />
      ) : (
        <JumpUploadAnalysis member={member} onBack={onBack} onComplete={handleComplete} />
      )}
    </div>
  );
}

// 업로드 전용 리포트 (정밀도 리포트 포함)
function UploadReport({ report }) {
  const p = report.precision || {};
  const cc = report.crossCheck || {};
  const grade = report.valid
    ? report.heightCm >= 50 ? { label: '매우 우수', color: 'text-blue-400' }
    : report.heightCm >= 40 ? { label: '우수', color: 'text-emerald-400' }
    : report.heightCm >= 30 ? { label: '보통', color: 'text-amber-400' }
    : { label: '개선 필요', color: 'text-red-400' }
    : null;

  return (
    <div className="p-5 space-y-4">
      {report.valid !== true ? (
        <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-5 text-center space-y-2">
          <p className="text-3xl">⚠</p>
          <p className="text-red-400 font-black">측정 무효</p>
          <p className="text-slate-300 text-sm">
            {report.reason === 'no_jump' ? '점프 동작이 감지되지 않았습니다.'
              : report.reason === 'cross_mismatch' ? `두 측정 방식 차이가 큽니다(${cc.deltaPct}%). 카메라를 골반 높이로 고정하고 제자리 수직 점프 영상으로 다시 시도하세요.`
              : report.reason === 'sanity_fail' ? '측정값이 키 대비 비현실적입니다. 카메라 각도를 확인하세요.'
              : '다시 시도해 주세요.'}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">점프 높이</p>
              <p className={`text-sm font-bold ${grade.color}`}>{grade.label}</p>
            </div>
            <p className="text-center font-mono font-black text-6xl text-slate-100">
              {report.heightCm}<span className="text-xl text-slate-500"> cm</span>
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="체공시간" value={`${report.flightTimeMs}ms`} />
              <Stat label="이륙속도" value={`${report.takeoffVelocity} m/s`} />
              <Stat label="최고파워" value={report.peakPower != null ? `${report.peakPower}W` : '체중 미입력'} />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-bold text-slate-300">측정 신뢰도 (교차검증)</p>
            <div className="grid grid-cols-2 gap-2 text-center text-sm">
              <div className="bg-slate-800 rounded-xl py-2">
                <p className="text-[10px] text-slate-500">비행시간 기반</p>
                <p className="font-mono font-bold text-slate-100">{report.heightCm} cm</p>
              </div>
              <div className="bg-slate-800 rounded-xl py-2">
                <p className="text-[10px] text-slate-500">골반변위 기반</p>
                <p className="font-mono font-bold text-slate-100">{cc.heightCrossCm != null ? `${cc.heightCrossCm} cm` : '—'}</p>
              </div>
            </div>
            {cc.agree != null && (
              <p className={`text-center text-xs font-bold ${cc.agree ? 'text-emerald-400' : 'text-red-400'}`}>
                {cc.agree ? `✓ 두 방식 일치 (오차 ${cc.deltaPct}%)` : `✗ 불일치 (오차 ${cc.deltaPct}%)`}
              </p>
            )}
          </div>
        </>
      )}

      {/* 정밀도 리포트 (요구사항 3) — 무효여도 표시 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-slate-300">분석 정밀도</p>
        <div className="grid grid-cols-2 gap-2 text-center text-sm">
          <Stat label="분석 프레임 수" value={`${p.analyzedFrames ?? 0}`} />
          <Stat label="샘플링 레이트" value={`${p.samplingFps ?? '-'}fps`} />
          <Stat label="실측 평균 fps" value={p.measuredAvgFps != null ? `${p.measuredAvgFps}fps` : '-'} />
          <Stat label="주의 구간" value={`${p.lowConfFrames ?? 0}프레임 (${p.lowConfPct ?? 0}%)`} />
        </div>
        {p.fpsJitterPct != null && p.fpsJitterPct > 30 && (
          <p className="text-[11px] text-amber-400 text-center">
            ⚠ 프레임 간격 변동이 큽니다({p.fpsJitterPct}%). 가변 프레임레이트(VFR) 영상일 수 있어 체공시간 오차가 늘 수 있습니다.
          </p>
        )}
        <p className="text-[10px] text-slate-500 text-center">
          {p.captureMode === 'slowmo240' ? '240fps' : p.captureMode === 'slowmo120' ? '120fps' : '일반'} 고해상도 분석 완료 ·
          회원 키({report.calibHeightCm}cm) 기준 보정 · 감지 점프 {report.jumps}회
        </p>
        {Array.isArray(p.cautionWindows) && p.cautionWindows.length > 0 && (
          <p className="text-[10px] text-slate-500 text-center">
            저신뢰(모션블러 추정) 시점: {p.cautionWindows.slice(0, 6).map(ms => `${(ms / 1000).toFixed(2)}s`).join(', ')}
            {p.cautionWindows.length > 6 ? ' …' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-800 rounded-xl py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="font-mono font-bold text-slate-200 text-sm">{value}</p>
    </div>
  );
}
