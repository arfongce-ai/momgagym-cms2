// ai-measure/menus/JumpUploadAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  점프 정밀 측정 (업로드) — 고속촬영(120/240fps) 영상 분석
//   GaitUploadAnalysis 와 동일한 엔진(analyzeUploadedVideo)·프리셋 사용.
//   · 슬로모 배수(playbackRate)로 tMs 를 실제 시간축으로 보정 → 비행시간 정확
//   · 캘리브레이션은 영상 앞부분의 '서 있는 프레임'에서 자동 수행
//   · 비행시간 높이 + 골반변위 교차검증 + 키 sanity → valid
//   · 분석 프레임 수 / 평균 fps / 저신뢰 구간 수를 정밀도 리포트로 표시
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  StandingCalibrator, JumpFlightTracker,
} from '../core/jumpBiomechanics';
import { calcJump } from '../core/performance';
import { analyzeUploadedVideo, CAPTURE_PRESETS } from '../core/videoAnalyzer';

// 프레임 신뢰도(가시성) 하한 — 이하 구간은 '주의 구간'으로 집계
const FRAME_CONF_MIN = 0.8;

export default function JumpUploadAnalysis({ member, onBack, onComplete }) {
  const [phase, setPhase] = useState('idle'); // idle | ready | analyzing | done | error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [capture, setCapture] = useState('slowmo240');
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
    let analyzedFrames = 0, lowConfFrames = 0;
    const lowConfTimes = []; // 주의 구간(저신뢰) realMs 목록
    const tsList = [];       // 실측 평균 fps 계산용 (realMs)

    const abort = new AbortController();
    abortRef.current = abort;
    const preset = CAPTURE_PRESETS[capture] || CAPTURE_PRESETS.normal;

    try {
      const result = await analyzeUploadedVideo({
        video, signal: abort.signal,
        targetFps: preset.targetFps, playbackRate: preset.playbackRate,
        onProgress: setProgress,
        onFrame: ({ landmarks, tMs, realMs }) => {
          analyzedFrames++;
          tsList.push(realMs);
          // 프레임 신뢰도: 발/골반 핵심 관절 가시성 평균
          const key = [23, 24, 27, 28].map(i => landmarks[i]?.visibility ?? 0);
          const conf = key.reduce((s, x) => s + x, 0) / key.length;
          if (conf < FRAME_CONF_MIN) { lowConfFrames++; lowConfTimes.push(realMs); }

          // 앞부분: 캘리브레이션. 락되면 트래커 생성 후 점프 검출.
          if (!calib.locked) {
            calib.push(landmarks);
            if (calib.locked) {
              tracker = new JumpFlightTracker(calib.result);
              tracker.calibHeightCm = heightCm;
            }
          } else if (tracker) {
            tracker.push(landmarks, tMs); // tMs = 슬로모 보정된 실제 시간축
          }
        },
      });

      if (result.aborted) { setPhase('ready'); return; }

      if (!calib.locked) {
        setErrorMsg('영상 앞부분에서 안정적으로 서 있는 자세를 찾지 못했습니다. 점프 전 1초 이상 똑바로 서 있는 영상을 사용하세요.');
        setPhase('error'); return;
      }

      const sum = tracker ? tracker.summary({ heightCm })
        : { valid: false, reason: 'no_jump', jumps: 0 };
      const power = calcJump(sum.flightTimeSec, member?.weight);

      // ── 정밀도 리포트 (요구사항 3) ──
      // 실측 평균 fps: 분석한 프레임의 realMs 간격으로 역산. 컨테이너 기준.
      let avgFps = null, fpsJitter = null;
      if (tsList.length > 2) {
        const sorted = [...tsList].sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
        const meanGap = gaps.reduce((s, x) => s + x, 0) / gaps.length;
        avgFps = meanGap > 0 ? Math.round(1000 / meanGap) : null;
        const gStd = Math.sqrt(gaps.reduce((s, x) => s + (x - meanGap) ** 2, 0) / gaps.length);
        fpsJitter = meanGap > 0 ? Math.round((gStd / meanGap) * 100) : null; // 변동계수(%)
      }

      const precision = {
        analyzedFrames,
        lowConfFrames,
        lowConfPct: analyzedFrames ? Math.round(lowConfFrames / analyzedFrames * 1000) / 10 : 0,
        cautionWindows: lowConfTimes.slice(0, 20), // 주의 구간 타임스탬프(ms, 상위 20)
        captureMode: capture,
        playbackRate: result.playbackRate,
        samplingFps: preset.targetFps,        // 분석 샘플링 레이트(목표)
        measuredAvgFps: avgFps,               // 실측 평균 fps(컨테이너)
        fpsJitterPct: fpsJitter,              // fps 변동(%) — VFR 경고용
        durationSec: Math.round((result.realDurationSec || 0) * 100) / 100,
      };

      const report = {
        ...sum,
        peakPower: power?.peakPower ?? null,
        calibHeightCm: heightCm,
        source: 'upload',
        precision,
        member: { id: member?.id || null, name: member?.name || null },
        measuredAt: new Date().toISOString(),
      };

      setPhase('done');
      if (typeof onComplete === 'function') await onComplete(report);
    } catch (e) {
      setErrorMsg(e?.message || '분석 중 오류가 발생했습니다.');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [member, onComplete, capture, heightCm]);

  const cancelAnalysis = () => { abortRef.current?.abort(); };

  useEffect(() => () => {
    abortRef.current?.abort();
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
  }, []);

  const applyHeight = () => {
    const n = Number(heightInput);
    if (!n || n < 80 || n > 250) { setErrorMsg('키를 80~250cm로 입력하세요.'); return; }
    setHeightCm(n); setNeedHeight(false); setErrorMsg('');
  };

  const pct = Math.round(progress * 100);

  // 키 입력 팝업 (요구사항 2)
  if (needHeight) {
    return (
      <div className="absolute inset-0 bg-slate-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
          <h2 className="text-white font-black">점프 정밀 측정</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키 정보가 필요합니다</p>
              <p className="text-slate-400 text-xs">cm 환산(자동 보정)에 필요합니다.</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" inputMode="numeric" value={heightInput}
                onChange={e => setHeightInput(e.target.value)} placeholder="예: 170"
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
              <span className="text-slate-400 text-sm font-bold">cm</span>
            </div>
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
        <h2 className="text-white font-black">고속영상 점프 분석</h2>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col items-center justify-center gap-5">
        <video ref={videoRef} className="w-full max-w-md rounded-xl bg-black aspect-[3/4] object-contain"
          playsInline muted controls={phase === 'ready' || phase === 'done'} />

        {heightCm && (
          <p className="text-[11px] text-emerald-400">회원 키 {heightCm}cm로 자동 보정합니다</p>
        )}

        {phase === 'idle' && (
          <label className="cursor-pointer rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-6 py-3 transition-colors">
            고속촬영 영상 선택
            <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
          </label>
        )}

        {fileName && phase !== 'idle' && <p className="text-xs text-slate-400 truncate max-w-md">📁 {fileName}</p>}

        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <p className="text-sm text-slate-300 text-center">
              점프 전 1초 이상 똑바로 서 있는 고속촬영(120/240fps) 영상을 사용하세요. 프레임을 빠짐없이 분석합니다.
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
              <p className="text-[10px] text-slate-500 mt-1.5">
                폰 슬로모로 찍었다면 해당 배속을 선택하세요. 체공시간이 실제 시간 기준으로 보정됩니다.
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
            <p className="text-[11px] text-slate-500">모든 프레임을 순차 분석하고 있습니다</p>
            <button onClick={cancelAnalysis} className="text-xs text-slate-400 underline">취소</button>
          </div>
        )}

        {phase === 'done' && <p className="text-sm font-bold text-emerald-400">✓ 분석 완료 — 리포트로 이동합니다…</p>}

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
