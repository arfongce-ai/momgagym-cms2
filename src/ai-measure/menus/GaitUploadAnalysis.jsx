import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  GaitCycleTracker, jointAnglesFromPose, AngleAccumulator,
  pelvisRelativeFeet, BiomechAccumulator,
} from '../core/gaitBiomechanics';
import { analyzeUploadedVideo, CAPTURE_PRESETS } from '../core/videoAnalyzer';

/*
 * GaitUploadAnalysis — 고속 촬영 영상 업로드 → 보행 분석
 * ──────────────────────────────────────────────────────────────
 * 라이브 모드(GaitRunningAnalysis)와 동일한 누적기/저장 페이로드를 사용한다.
 * 분석이 끝나면 onComplete(reportData) 로 결과를 올려 보내고,
 * 상위(GaitAnalysisHub)가 저장 + 대시보드 이동을 처리한다.
 *
 * props:
 *   member            회원 객체
 *   onBack            () => void
 *   onComplete        (reportData) => void   분석 완료 → 상위(Hub)가 저장/이동
 */
export default function GaitUploadAnalysis({ member, onBack, onComplete }) {
  const [phase, setPhase] = useState('idle'); // idle | ready | analyzing | done | error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [capture, setCapture] = useState('normal'); // normal | slowmo120 | slowmo240

  const videoRef = useRef(null);
  const fileUrlRef = useRef(null);
  const abortRef = useRef(null);

  // 파일 선택 → 비디오 로드 (metadata 준비되면 ready)
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setErrorMsg('영상 파일을 선택해 주세요.');
      return;
    }
    setErrorMsg('');
    setFileName(file.name);
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    const v = videoRef.current;
    if (v) {
      v.src = url;
      v.onloadedmetadata = () => setPhase('ready');
    }
  };

  const runAnalysis = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setPhase('analyzing');
    setProgress(0);
    setErrorMsg('');

    // 라이브 모드와 동일한 누적기 3종
    const tracker = new GaitCycleTracker();
    const angleAcc = new AngleAccumulator();
    const biomechAcc = new BiomechAccumulator();

    const abort = new AbortController();
    abortRef.current = abort;

    const preset = CAPTURE_PRESETS[capture] || CAPTURE_PRESETS.normal;

    try {
      const result = await analyzeUploadedVideo({
        video,
        signal: abort.signal,
        targetFps: preset.targetFps,
        playbackRate: preset.playbackRate,
        onProgress: setProgress,
        onFrame: ({ landmarks, tMs }) => {
          tracker.push(pelvisRelativeFeet(landmarks), tMs);
          angleAcc.push(jointAnglesFromPose(landmarks));
          biomechAcc.push(landmarks);
        },
      });

      if (result.aborted) { setPhase('ready'); return; }

      // ── 라이브 모드 onstop 과 100% 동일한 페이로드 구성 ──
      const cycleSummary = tracker.summary();
      const angleSummary = angleAcc.summary();
      const biomech = biomechAcc.summary();

      const metrics = {
        cadence: cycleSummary.averageCadenceSpm,
        stancePct: cycleSummary.stancePct,
        swingPct: cycleSummary.swingPct,
        totalSteps: cycleSummary.totalSteps,
        signalAmp: cycleSummary.signalAmp,
        valid: cycleSummary.valid,
        angles: angleSummary,
        trunkLean: biomech.trunkLean,
        kneeFlexion: biomech.kneeFlexion,
        pelvicDrop: biomech.pelvicDrop,
        pelvicDropAbs: biomech.pelvicDropAbs,
        verticalOscillation: biomech.verticalOscillation,
        kneeSymmetry: biomech.kneeSymmetry,
        strideToHeight: biomech.strideToHeight,
      };

      const reportData = {
        cadence: cycleSummary.averageCadenceSpm,
        stancePct: cycleSummary.stancePct,
        swingPct: cycleSummary.swingPct,
        totalSteps: cycleSummary.totalSteps,
        valid: cycleSummary.valid,
        signalAmp: cycleSummary.signalAmp,
        angles: angleSummary,
        aspect: '3/4',
        source: 'upload', // 라이브 vs 업로드 구분 (분석 출처 기록)
        captureMode: capture, // normal | slowmo120 | slowmo240
        playbackRate: result.playbackRate,
        member: { id: member?.id || null, name: member?.name || null },
        measuredAt: new Date().toISOString(),
        metrics,
      };

      setPhase('done');

      // 저장은 상위(Hub)가 단일 책임으로 처리한다 → 중복 저장 방지.
      // 여기서는 결과만 올려 보낸다. (saveToFirebase 직접 호출 안 함)
      if (typeof onComplete === 'function') await onComplete(reportData);
    } catch (e) {
      setErrorMsg(e?.message || '분석 중 오류가 발생했습니다.');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [member, onComplete, capture]);

  const cancelAnalysis = () => { abortRef.current?.abort(); };

  useEffect(() => () => {
    abortRef.current?.abort();
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
  }, []);

  const pct = Math.round(progress * 100);

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
        <h2 className="text-white font-black">영상 업로드 분석</h2>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col items-center justify-center gap-5">
        {/* 미리보기 비디오 (분석 대상) */}
        <video
          ref={videoRef}
          className="w-full max-w-md rounded-xl bg-black aspect-[3/4] object-contain"
          playsInline muted controls={phase === 'ready' || phase === 'done'}
        />

        {phase === 'idle' && (
          <label className="cursor-pointer rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-6 py-3 transition-colors">
            영상 파일 선택
            <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
          </label>
        )}

        {fileName && phase !== 'idle' && (
          <p className="text-xs text-slate-400 truncate max-w-md">📁 {fileName}</p>
        )}

        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <p className="text-sm text-slate-300 text-center">
              영상이 준비됐습니다. 분석을 시작하면 프레임을 빠르게 건너뛰며 자세를 추출합니다.
            </p>
            {/* 촬영 모드 선택 — 슬로모면 시간축을 보정해 케이던스가 정확해진다 */}
            <div className="w-full">
              <p className="text-[11px] font-bold text-slate-400 mb-1.5">촬영 모드</p>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(CAPTURE_PRESETS).map(([k, p]) => (
                  <button key={k} onClick={() => setCapture(k)}
                    className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors ${
                      capture === k ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                폰 슬로모로 찍었다면 해당 배속을 선택하세요. 케이던스·속도가 실제 시간 기준으로 보정됩니다.
              </p>
            </div>
            <button onClick={runAnalysis}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 transition-colors">
              ▶ 분석 시작
            </button>
            <label className="text-xs text-slate-400 underline cursor-pointer">
              다른 영상 선택
              <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="w-full max-w-md flex flex-col items-center gap-3">
            <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-amber-500 transition-all duration-150" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm font-bold text-amber-400">{pct}% 분석 중…</p>
            <p className="text-[11px] text-slate-500">1280×720으로 다운스케일하여 처리 중입니다</p>
            <button onClick={cancelAnalysis} className="text-xs text-slate-400 underline">취소</button>
          </div>
        )}

        {phase === 'done' && (
          <p className="text-sm font-bold text-emerald-400">✓ 분석 완료 — 리포트로 이동합니다…</p>
        )}

        {(phase === 'error' || errorMsg) && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-400 text-center max-w-md">{errorMsg}</p>
            <label className="text-xs text-amber-400 underline cursor-pointer">
              다시 시도
              <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
