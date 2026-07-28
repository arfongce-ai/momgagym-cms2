// ai-measure/menus/SquatUploadAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트 업로드 분석 — 정면에서 촬영한 영상 하나로 연속된 최대
//  2회 반복(rep)을 자동으로 잡아낸다. StanceUploadAnalysis.jsx와 동일한
//  엔진(analyzeUploadedVideo)·구조를 쓰되, 다리 구분(좌/우) 없이 한 번에 끝난다
//  (squatBiomechanicsTracker.js가 반복 자체를 시행 단위로 다루므로).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { StandingCalibrator, SquatBiomechanicsTracker } from '../core/squatBiomechanicsTracker';
import { analyzeUploadedVideo, CAPTURE_PRESETS } from '../core/videoAnalyzer';

/**
 * @param {(trialSummary: {trial1, trial2, trialsFound}) => void} onComplete
 */
export default function SquatUploadAnalysis({ member, onBack, onComplete, onMemberHeightChange }) {
  const [phase, setPhase] = useState('idle'); // idle | ready | analyzing | done | error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [capture, setCapture] = useState('normal');
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [needHeight, setNeedHeight] = useState(!member?.height);
  const [heightInput, setHeightInput] = useState('');

  const videoRef = useRef(null);
  const fileUrlRef = useRef(null);
  const abortRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) { setErrorMsg('영상 파일을 선택해 주세요.'); return; }
    setErrorMsg(''); setFileName(file.name);
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    const v = videoRef.current;
    if (v) { v.src = url; v.onloadedmetadata = () => setPhase('ready'); }
  };

  const runAnalysis = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setPhase('analyzing'); setProgress(0); setErrorMsg('');

    const calib = new StandingCalibrator({ heightCm });
    let tracker = null;

    const abort = new AbortController();
    abortRef.current = abort;
    const preset = CAPTURE_PRESETS[capture] || CAPTURE_PRESETS.normal;

    try {
      const result = await analyzeUploadedVideo({
        video, signal: abort.signal,
        targetFps: preset.targetFps, playbackRate: preset.playbackRate,
        onProgress: setProgress,
        onFrame: ({ landmarks, tMs }) => {
          if (!calib.locked) {
            calib.push(landmarks);
            if (calib.locked) tracker = new SquatBiomechanicsTracker(calib.result);
          } else if (tracker) {
            tracker.push(landmarks, tMs);
          }
        },
      });

      if (result.aborted) { setPhase('ready'); return; }

      if (!calib.locked) {
        setErrorMsg('영상 앞부분에서 안정적으로 서 있는 자세를 찾지 못했습니다. 촬영 시작 시 1초 이상 정면을 보고 똑바로 서 있는 영상을 사용하세요.');
        setPhase('error'); return;
      }
      if (!tracker) {
        setErrorMsg('스쿼트 동작을 찾지 못했습니다. 전신이 프레임에 들어오는지 확인해 주세요.');
        setPhase('error'); return;
      }

      tracker.finalize(result.durationSec * 1000);

      const summary = tracker.summary();
      if (!summary.trial1) {
        setErrorMsg('유효한 반복(스쿼트)을 찾지 못했습니다(충분히 깊게 앉지 않았을 수 있어요). 다시 촬영해 주세요.');
        setPhase('error'); return;
      }

      setPhase('done');
      if (typeof onComplete === 'function') await onComplete(summary);
    } catch (e) {
      setErrorMsg(e?.message || '분석 중 오류가 발생했습니다.');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [heightCm, capture, onComplete]);

  const cancelAnalysis = () => { abortRef.current?.abort(); };

  useEffect(() => () => {
    abortRef.current?.abort();
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
  }, []);

  const applyHeight = () => {
    const h = Number(heightInput);
    if (!h || h < 80 || h > 250) { setErrorMsg('키를 80~250cm로 입력하세요.'); return; }
    setHeightCm(h); setNeedHeight(false); setErrorMsg('');
    onMemberHeightChange?.(h);
  };

  const pct = Math.round(progress * 100);

  if (needHeight) {
    return (
      <div className="absolute inset-0 bg-slate-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
          <h2 className="text-white font-black">오버헤드 딥 스쿼트</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키가 필요합니다</p>
              <p className="text-slate-400 text-xs">동작 스케일 환산에 사용됩니다.</p>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold text-slate-500">키</span>
              <div className="flex items-center gap-2">
                <input type="number" inputMode="numeric" value={heightInput}
                  onChange={e => setHeightInput(e.target.value)} placeholder="170"
                  className="min-w-0 flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                <span className="text-slate-400 text-xs font-bold">cm</span>
              </div>
            </label>
            <button onClick={applyHeight} className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95">
              입력하고 계속
            </button>
            {errorMsg && <p className="text-center text-xs text-red-400">{errorMsg}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
        <h2 className="text-white font-black">오버헤드 딥 스쿼트</h2>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col items-center justify-center gap-5">
        <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-black aspect-[3/4]">
          <video ref={videoRef} className="h-full w-full object-contain"
            playsInline muted controls={phase === 'ready' || phase === 'done'} />
          {phase === 'analyzing' && (
            <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-xs font-black text-amber-300 backdrop-blur">
              분석 중
            </div>
          )}
        </div>

        {heightCm && <p className="text-[11px] text-emerald-400">회원 키 {heightCm}cm로 동작을 환산합니다</p>}

        {phase === 'idle' && (
          <label className="cursor-pointer rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-6 py-3 transition-colors">
            스쿼트 영상 선택
            <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
          </label>
        )}

        {fileName && phase !== 'idle' && <p className="text-xs text-slate-400 truncate max-w-md">📁 {fileName}</p>}

        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <p className="text-sm text-slate-300 text-center">
              정면에서, 양팔을 위로 든 채 2회 이상 스쿼트하는 모습을 촬영하세요.
              연속 동작이면 자동으로 각 반복을 구분합니다(최대 2회 사용).
            </p>
            <div className="w-full">
              <p className="text-[11px] font-bold text-slate-400 mb-1.5">촬영 모드</p>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(CAPTURE_PRESETS).map(([k, p]) => (
                  <button key={k} onClick={() => setCapture(k)}
                    className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors ${
                      capture === k ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
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
            <button onClick={cancelAnalysis} className="text-xs text-slate-400 underline">취소</button>
          </div>
        )}

        {phase === 'done' && <p className="text-sm font-bold text-emerald-400">✓ 분석 완료</p>}

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
