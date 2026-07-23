// ai-measure/menus/LiftingUploadAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  역도 / VBT 고속영상(슬로모) 업로드 분석.
//   · 점프 업로드와 동일한 엔진(analyzeUploadedVideo)·프리셋(CAPTURE_PRESETS).
//   · 바벨 추적은 실시간 모듈과 동일한 엔드캡 색추적(createMultiTracker):
//       1) 영상 첫 프레임을 멈춰 세우고, 사용자가 바벨 끝/원판을 1~3곳 탭(seed).
//       2) seek 루프에서 매 프레임 video 로 endcap.update → 궤적 누적.
//   · 슬로모 배수(playbackRate)로 tMs 를 실제 시간축으로 보정 → 속도 정확.
//   · 고속영상이므로 peakVelocity 게이트 통과(실측). 실시간(30fps)에선 못 내던 값.
//   · 추적 데이터(궤적·속도)를 평가의 1차 근거로 삼는다(요구사항 7).
//
//  결과는 onComplete(report) 로 상위(Hub)에 전달 → 통합 리포트로 저장·표시.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback } from 'react';
import { analyzeUploadedVideo, CAPTURE_PRESETS } from '../core/videoAnalyzer';
import { createMultiTracker } from '../core/endcapTracker';
import { personHeightRatio } from '../core/barbell';
import { calcVBT } from '../core/performance';
import {
  computeBarVelocities, estimateMeanPower, vbtConfidence,
  buildLiftingPayload, exerciseLabel,
} from '../core/lifting';
import { countRepsFromSeries } from '../core/repCounter';
import {
  CALIBRATION_PRESETS, buildReferenceScale, ratioToCm,
  resolveDistanceScale, serializeDistanceScale,
} from '../core/calibration';
import { buildRepVelocityMetrics } from '../core/repVelocity';
import { buildLoadVelocityPoint } from '../core/loadVelocityProfile';
import { plateCmPerRatio, PLATE_CALIBRATION_TAGS } from '../core/plates';

export default function LiftingUploadAnalysis({
  member, onBack, onComplete, mode = 'lifting', exerciseType,
}) {
  const [phase, setPhase] = useState('idle'); // idle | seeding | ready | analyzing | done | error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [capture, setCapture] = useState('slowmo240');
  const [seedCount, setSeedCount] = useState(0);
  const [referenceLengthCm, setReferenceLengthCm] = useState(CALIBRATION_PRESETS[0].lengthCm);
  const [referenceScale, setReferenceScale] = useState(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationPointCount, setCalibrationPointCount] = useState(0);

  const videoRef = useRef(null);
  const trackerRef = useRef(createMultiTracker());
  const calibrationPointsRef = useRef([]);
  const abortRef = useRef(null);
  const heightCm = member?.height ? Number(member.height) : null;
  const weightKg = member?.weight ? Number(member.weight) : null;

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setErrorMsg('');
    trackerRef.current = createMultiTracker();
    setSeedCount(0);
    calibrationPointsRef.current = [];
    setCalibrationPointCount(0);
    setCalibrating(false);
    setReferenceScale(null);
    const v = videoRef.current;
    if (v) {
      v.src = URL.createObjectURL(f);
      v.onloadeddata = () => {
        // 첫 프레임에 멈춰 세워 바벨 끝 탭(seed) 단계로.
        try { v.currentTime = 0.001; } catch (err) { /* noop */ }
        setPhase('seeding');
      };
    }
  };

  // 영상 첫 프레임에서 바벨 끝/원판 탭 → 색 학습(seed).
  const addCalibrationPoint = useCallback((point) => {
    const next = [...calibrationPointsRef.current, point].slice(-2);
    calibrationPointsRef.current = next;
    setCalibrationPointCount(next.length);
    if (next.length < 2) return;

    const scale = buildReferenceScale(next, referenceLengthCm);
    if (!scale) {
      setErrorMsg('거리 보정 기준 길이를 다시 확인해 주세요.');
      calibrationPointsRef.current = [];
      setCalibrationPointCount(0);
      return;
    }
    setReferenceScale(scale);
    setCalibrating(false);
    setErrorMsg('');
  }, [referenceLengthCm]);

  const onTapVideo = (e) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || phase !== 'seeding') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const clientY = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    const vAR = v.videoWidth / v.videoHeight;
    const bAR = rect.width / rect.height;
    let drawW = rect.width, drawH = rect.height, offX = 0, offY = 0;
    if (vAR > bAR) { drawH = rect.width / vAR; offY = (rect.height - drawH) / 2; }
    else { drawW = rect.height * vAR; offX = (rect.width - drawW) / 2; }
    const nx = (clientX - offX) / drawW;
    const ny = (clientY - offY) / drawH;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    if (calibrating) {
      addCalibrationPoint({ x: nx, y: ny });
      return;
    }
    if (trackerRef.current.pointCount() >= 3) return; // 이미 최대 추적점(3) 지정됨
    const ok = trackerRef.current.seed(v, nx, ny);
    if (ok) { setSeedCount(trackerRef.current.pointCount()); setErrorMsg(''); }
    else setErrorMsg('이 지점에서 추적점을 인식하지 못했습니다. 바벨 끝/원판이 더 잘 보이는 위치를 눌러보세요.');
  };

  const startAnalyze = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (trackerRef.current.pointCount() < 1) {
      setErrorMsg('먼저 영상에서 바벨 끝이나 원판을 1곳 이상 눌러 추적점을 지정하세요.');
      return;
    }
    setPhase('analyzing'); setProgress(0); setErrorMsg('');

    const tracker = trackerRef.current;
    tracker.reset();
    const phSamples = [];
    const barSamples = [];   // { yCm 임시 보류 → 후처리 } 대신 ratio+tMs 누적
    const rawPath = [];      // { y(ratio), ts(ms 실시간축) }
    let analyzedFrames = 0, lostFrames = 0;
    const tsList = [];

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
          // 신장 정규화용 인체 비율(중앙값 후처리).
          const ph = personHeightRatio(landmarks);
          if (ph) phSamples.push(ph);
          // 엔드캡 추적(같은 시점으로 seek된 video 프레임에서).
          const p = tracker.update(video);
          if (p) { tracker.push(p, tMs); rawPath.push({ y: p.y, ts: tMs }); }
          else lostFrames++;
        },
      });

      if (result.aborted) { setPhase('ready'); return; }

      const sum = tracker.summary();
      if (!sum) {
        setErrorMsg('바벨 움직임을 충분히 추적하지 못했습니다. 바벨 끝이 잘 보이는 영상으로, 추적점을 2~3곳 지정해 다시 시도하세요.');
        setPhase('error'); return;
      }

      // 신장 기준 cm 환산(중앙값 인체비율).
      const phs = phSamples.filter(Boolean).sort((a, b) => a - b);
      const phMed = phs.length ? phs[Math.floor(phs.length / 2)] : null;
      const scale = resolveDistanceScale({ referenceScale, personHeightRatio: phMed, heightCm });
      const romCm = ratioToCm(sum.romRatio, scale.cmPerRatio);

      // 실측 평균 fps(슬로모 보정 후 실제 시간축).
      let avgFps = null, fpsJitter = null;
      if (tsList.length > 2) {
        const sorted = [...tsList].sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
        const meanGap = gaps.reduce((s, x) => s + x, 0) / gaps.length;
        // realMs 는 컨테이너축. 실제 fps = 슬로모배수 / 컨테이너간격.
        avgFps = meanGap > 0 ? Math.round((1000 / meanGap) * preset.playbackRate) : null;
        const gStd = Math.sqrt(gaps.reduce((s, x) => s + (x - meanGap) ** 2, 0) / gaps.length);
        fpsJitter = meanGap > 0 ? Math.round((gStd / meanGap) * 100) : null;
      }

      // 속도 계산용 시계열(cm·실시간 ms). ratio→cm 환산 후 computeBarVelocities.
      const cmPerRatio = scale.cmPerRatio;
      let velo = { meanVelocity: null, peakVelocity: null, peakReason: 'no_data', romCm, durationSec: sum.durationMs / 1000 };
      if (cmPerRatio && rawPath.length >= 2) {
        const series = rawPath.map(s => ({ yCm: s.y * cmPerRatio, ts: s.ts }));
        // 고속영상이므로 source='upload' → peakVelocity 게이트 통과(실측).
        velo = computeBarVelocities(series, { source: 'upload', fps: avgFps || undefined });
        if (velo.romCm == null) velo.romCm = romCm;
      } else {
        // cm 환산 불가(키 없음 등) → 평균속도만 ratio 기반 근사, peak 는 미산출.
        const sec = sum.durationMs / 1000;
        velo.meanVelocity = romCm && sec ? Math.round((romCm / 100 / sec) * 100) / 100 : null;
      }

      const lostRatio = analyzedFrames ? lostFrames / analyzedFrames : null;
      const conf = vbtConfidence({
        isCalibrated: scale.isCalibrated, lostRatio,
        durationSec: velo.durationSec, source: 'upload', romCm: velo.romCm,
      });

      // VBT 모드면 존 판정 추가.
      let zone = null;
      if (mode === 'vbt' && velo.meanVelocity != null) {
        const vbt = calcVBT((velo.romCm || 0) / 100, velo.durationSec || 0);
        zone = vbt?.zone?.label || null;
      }

      // 렙 자동 카운트(추적 경로의 수직 위치 왕복).
      const reps = countRepsFromSeries(rawPath, { withPending: true });
      const repVelocity = buildRepVelocityMetrics(rawPath, {
        cmPerRatio,
        source: 'upload',
        fps: avgFps || undefined,
      });
      const loadVelocityPoint = buildLoadVelocityPoint({
        exerciseType,
        weight: weightKg,
        meanVelocity: repVelocity.summary.averageMeanVelocity ?? velo.meanVelocity,
        repVelocity,
        reps: repVelocity.summary.repCount || reps,
        source: 'upload',
      });

      const report = buildLiftingPayload({
        mode,
        exerciseType,
        source: 'upload',
        metrics: {
          meanVelocity: velo.meanVelocity,
          peakVelocity: velo.peakVelocity,
          peakReason: velo.peakReason,
          rangeOfMotion: velo.romCm,
          meanPower: estimateMeanPower(weightKg, velo.meanVelocity),
          velocityLoss: repVelocity.summary.velocityLossPct,
          confidenceScore: conf.score,
        },
        metadata: {
          weight: weightKg,
          isCalibrated: scale.isCalibrated,
          heightCm,
          calibration: serializeDistanceScale(scale),
          calibrationSource: scale.source,
          zone,
          reps: repVelocity.summary.repCount || reps,
          repVelocity,
          loadVelocityPoint,
          confidenceReasons: conf.reasons,
          lostRatio: lostRatio != null ? Math.round(lostRatio * 100) / 100 : null,
        },
        extra: {
          durationSec: velo.durationSec,
          precision: {
            analyzedFrames,
            lostFrames,
            captureMode: capture,
            playbackRate: result.playbackRate,
            measuredAvgFps: avgFps,
            fpsJitterPct: fpsJitter,
            durationSec: Math.round((result.realDurationSec || 0) * 100) / 100,
            calibration: serializeDistanceScale(scale),
            calibrationSource: scale.source,
          },
          valid: !!sum,
        },
      });

      setPhase('done');
      if (typeof onComplete === 'function') await onComplete(report);
    } catch (err) {
      setErrorMsg('분석 중 오류가 발생했습니다: ' + (err?.message || err));
      setPhase('error');
    }
  }, [member, onComplete, capture, heightCm, weightKg, mode, exerciseType, referenceScale]);

  const cancel = () => { abortRef.current?.abort(); };

  const modeLabel = mode === 'vbt' ? 'VBT' : '역도';
  const exLabel = exerciseType ? exerciseLabel(exerciseType) : '';

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col" style={{ paddingTop: 'max(176px, calc(env(safe-area-inset-top) + 176px))' }}>
      <div className="flex-1 overflow-y-auto px-5 pb-6 flex flex-col items-center gap-4">
        {/* 미리보기/탭 영역 */}
        <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-black aspect-[3/4]"
          onPointerDown={onTapVideo}>
          <video ref={videoRef} className="h-full w-full object-contain"
            playsInline muted controls={false} />
          {phase === 'seeding' && (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-[11px] font-black text-slate-950">
              바벨 끝/원판을 눌러 추적점 지정 ({seedCount}/3)
            </div>
          )}
          {phase === 'seeding' && (calibrating || referenceScale) && (
            <div className="absolute inset-x-0 top-10 mx-auto w-fit rounded-full bg-cyan-400/90 px-3 py-1 text-[11px] font-black text-slate-950">
              {calibrating ? `거리 보정 ${calibrationPointCount}/2` : '기준물 보정 완료'}
            </div>
          )}
          {phase === 'analyzing' && (
            <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-xs font-black text-amber-300 backdrop-blur">
              추적 분석 중 {progress}%
            </div>
          )}
        </div>

        {heightCm
          ? <p className="text-[11px] text-emerald-400">회원 키 {heightCm}cm로 cm 환산·속도 보정</p>
          : <p className="text-[11px] text-amber-400">키 미입력 — 속도는 상대값으로만 표시됩니다</p>}

        {phase === 'idle' && (
          <>
            <p className="text-center text-sm text-slate-300 max-w-md">
              {modeLabel} {exLabel} · 옆에서 촬영한 고속영상(120/240fps)을 올리면 바벨 궤적과
              속도를 분석합니다. 슬로모 영상일수록 최고속도까지 정확합니다.
            </p>
            <label className="cursor-pointer rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-6 py-3 transition-colors">
              영상 파일 선택
              <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
            </label>
          </>
        )}

        {fileName && phase !== 'idle' && <p className="text-xs text-slate-400 truncate max-w-md">📁 {fileName}</p>}

        {phase === 'seeding' && (
          <div className="w-full max-w-md space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">촬영 모드(슬로모 배수)</label>
              <select value={capture} onChange={e => setCapture(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm">
                {Object.entries(CAPTURE_PRESETS).map(([k, p]) => (
                  <option key={k} value={k}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="rounded-xl bg-slate-900/70 border border-slate-700 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-slate-400">기준 길이(cm)</label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  step="0.5"
                  value={referenceLengthCm}
                  onChange={e => setReferenceLengthCm(Number(e.target.value) || 0)}
                  className="w-20 rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-center text-sm font-mono text-white"
                />
              </div>
              <button
                onClick={() => {
                  calibrationPointsRef.current = [];
                  setCalibrationPointCount(0);
                  setCalibrating(v => !v);
                }}
                className={`w-full rounded-lg py-2 text-xs font-black ${calibrating ? 'bg-cyan-400 text-slate-950' : referenceScale ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-white'}`}>
                {calibrating ? '영상에서 기준물 양끝 2점 터치' : referenceScale ? '기준물 보정 다시 하기' : '기준물 거리 보정'}
              </button>
            </div>
            <button onClick={startAnalyze} disabled={seedCount < 1}
              className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95 disabled:opacity-50">
              추적 분석 시작
            </button>
            <label className="block text-center cursor-pointer text-[11px] text-slate-400 underline">
              다른 영상 선택
              <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="w-full max-w-md space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <button onClick={cancel} className="w-full rounded-lg bg-slate-700 text-slate-200 font-bold py-2 text-sm">취소</button>
          </div>
        )}

        {phase === 'done' && <p className="text-sm font-bold text-emerald-400">✓ 분석 완료 — 리포트로 이동합니다…</p>}

        {(phase === 'error' || errorMsg) && (
          <div className="w-full max-w-md space-y-2">
            <p className="text-center text-xs text-red-400">{errorMsg}</p>
            <label className="block text-center cursor-pointer rounded-lg bg-slate-700 text-slate-200 font-bold py-2 text-sm">
              다른 영상 선택
              <input type="file" accept="video/*" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
