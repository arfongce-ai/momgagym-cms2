// ai-measure/menus/StanceLiveAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  한다리서기(SLST) 실시간 카메라 측정 — usePoseEngine.js + CameraStage.jsx를
//  자세·ROM·VBT·1RM·리프팅과 동일하게 쓴다(풀스크린 비디오+스켈레톤 오버레이,
//  "✕ 닫기", 로딩/오류 처리는 CameraStage가 전담). 캘리브레이션·시행 추적
//  로직은 업로드 모드(StanceUploadAnalysis)와 완전히 동일한
//  singleLegStanceTracker.js를 공유 — 화면(측정 방식)만 다르고 "카메라가 본
//  것을 숫자로 바꾸는" 두뇌는 하나다.
//
//  [녹화 파이프라인 — ROM/보행과 동일 구조로 통일]
//  캘리브레이션이 잠기는 순간부터(대기~2차 시행 완료까지) 화면 전체를 연속
//  녹화한다 — 스켈레톤+GaugeHud를 캔버스에 합성(drawVideoCover+drawSkeleton+
//  drawGaugeHud) → captureStream → MediaRecorder. 측정 완료 시 blob을
//  summary와 함께 Hub로 넘겨, 판정 리포트 화면에서 ReportActions로 영상까지
//  저장/공유할 수 있게 한다(ROM의 previewVideoUrl/hasVideo와 동일 패턴).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { StandingCalibrator, SingleLegStanceTracker } from '../core/singleLegStanceTracker';
import { DEFAULT_ASPECT, outputSize, drawVideoCover, coverTransform } from '../core/recordAspect';
import { drawGaugeHud } from '../core/recordingOverlay';
import CameraStage from './CameraStage.jsx';
import GaugeHud from './GaugeHud.jsx';

const LEG_KO = { left: '왼쪽', right: '오른쪽' };
const MAX_RECORD_MS = 60000;

// 자세·보행 모듈과 동일한 본(bone) 목록 — 상체 코어 + 양다리.
const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

function vis(p, threshold = 0.3) {
  return !!p && (p.visibility == null || p.visibility >= threshold);
}

// CameraStage 화면(라이브 미리보기)은 object-contain 레터박스라, 화면용
// 스켈레톤은 이 매퍼로 그린다(RomMeasure.jsx의 objectContainMapper와 동일).
function objectContainMapper(video, width, height) {
  const vw = video?.videoWidth || width;
  const vh = video?.videoHeight || height;
  const scale = Math.min(width / vw, height / vh);
  const drawW = vw * scale, drawH = vh * scale;
  const ox = (width - drawW) / 2, oy = (height - drawH) / 2;
  return { x: (p) => ox + p.x * drawW, y: (p) => oy + p.y * drawH };
}

function drawSkeleton(canvas, video, landmarks, locked, mapper) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  if (!landmarks) return;
  const { x: X, y: Y } = mapper || objectContainMapper(video, cw, ch);
  const col = locked ? 'rgba(52,211,153,0.95)' : 'rgba(34,211,238,0.95)';
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    const pa = landmarks[a], pb = landmarks[b];
    if (!vis(pa) || !vis(pb)) return;
    ctx.beginPath(); ctx.moveTo(X(pa), Y(pa)); ctx.lineTo(X(pb), Y(pb)); ctx.stroke();
  });
  ctx.fillStyle = locked ? 'rgba(52,211,153,1)' : 'rgba(255,255,255,0.95)';
  [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach((i) => {
    const p = landmarks[i];
    if (!vis(p)) return;
    ctx.beginPath(); ctx.arc(X(p), Y(p), 5, 0, Math.PI * 2); ctx.fill();
  });
}

export default function StanceLiveAnalysis({ member, stanceLeg, onBack, onComplete, onMemberHeightChange }) {
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [needHeight, setNeedHeight] = useState(!member?.height);
  const [heightInput, setHeightInput] = useState('');

  // calibrating | low_visibility | ready | holding | trial_done | finished
  const [uiPhase, setUiPhase] = useState('calibrating');
  const [calibProgress, setCalibProgress] = useState(0);
  const [holdMs, setHoldMs] = useState(0);
  const [trialsFound, setTrialsFound] = useState(0);
  const [lastTrialNote, setLastTrialNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [finishing, setFinishing] = useState(false);

  const calibRef = useRef(null);
  const trackerRef = useRef(null);
  const lastTsRef = useRef(0);
  const canvasRef = useRef(null);
  const startedRef = useRef(false);

  // ── 녹화 ──
  const latestVideoElRef = useRef(null);
  const latestLandmarksRef = useRef(null);
  const recordCanvasRef = useRef(null);
  const composeRafRef = useRef(null);
  const composeIntervalRef = useRef(null);
  const recordStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordStartTsRef = useRef(0);
  const maxRecordTimerRef = useRef(null);
  const recordingStartedRef = useRef(false);
  const pendingSummaryRef = useRef(null);

  const legLabel = LEG_KO[stanceLeg] || stanceLeg;

  const createRecordedStream = () => {
    const video = latestVideoElRef.current;
    const size = outputSize(DEFAULT_ASPECT);
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      if (!video) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!drawVideoCover(ctx, video, canvas.width, canvas.height)) return;
      const cover = coverTransform(video, canvas.width, canvas.height);
      drawSkeleton(canvas, video, latestLandmarksRef.current, !!calibRef.current?.locked, { x: cover.X, y: cover.Y });
      const tracker = trackerRef.current;
      const elapsedSec = recordingStartedRef.current ? (performance.now() - recordStartTsRef.current) / 1000 : 0;
      drawGaugeHud(ctx, canvas.width, canvas.height, {
        title: 'SLST',
        recording: true,
        elapsedSec,
        accent: '#22d3ee',
        gauge: tracker?.phase === 'holding'
          ? { label: '유지시간', value: (tracker.elapsedHoldMs(lastTsRef.current) / 1000).toFixed(1), unit: 's' }
          : { label: legLabel + ' 지지', value: trialsFound, unit: '/2' },
        stats: [{ label: '시행', value: trialsFound, unit: '/2' }],
      });
    };
    const rafLoop = () => { draw(); composeRafRef.current = requestAnimationFrame(rafLoop); };
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    rafLoop();
    if (composeIntervalRef.current) clearInterval(composeIntervalRef.current);
    composeIntervalRef.current = setInterval(draw, 66);
    const stream = canvas.captureStream ? canvas.captureStream(30) : null;
    if (!stream) return null;
    recordStreamRef.current = stream;
    return stream;
  };

  const stopComposeLoop = () => {
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (composeIntervalRef.current) { clearInterval(composeIntervalRef.current); composeIntervalRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  // 캘리브레이션이 잠기는 순간(uiPhase → 'ready') 녹화 시작 — 대기~2차 시행
  // 완료까지 전체를 하나의 클립으로 담는다(ROM처럼 단발 동작이 아니라 여러
  // 시행을 잇는 흐름이라, 트레이너가 나중에 돌려볼 때 전체 맥락이 보이게).
  const beginRecording = () => {
    if (recordingStartedRef.current) return;
    try {
      const mimeTypes = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
      const selectedMime = mimeTypes.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
      const stream = createRecordedStream();
      if (stream) {
        const mr = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = () => {
          stopComposeLoop();
          const type = mr.mimeType || 'video/webm';
          const blob = new Blob(chunksRef.current, { type });
          finishWithBlob(blob);
        };
        mr.start();
        recordStartTsRef.current = performance.now();
        recordingStartedRef.current = true;
        maxRecordTimerRef.current = setTimeout(() => { if (recordingStartedRef.current) finishAndSubmit(); }, MAX_RECORD_MS);
      }
    } catch (e) { mediaRecorderRef.current = null; }
  };

  const handleResult = useCallback((landmarks, ts, video) => {
    lastTsRef.current = ts;
    latestVideoElRef.current = video || latestVideoElRef.current;
    latestLandmarksRef.current = landmarks;
    if (!calibRef.current) calibRef.current = new StandingCalibrator({ heightCm });
    const calib = calibRef.current;

    drawSkeleton(canvasRef.current, video, landmarks, calib.locked);
    if (!landmarks) return;

    if (!calib.locked) {
      calib.push(landmarks);
      const st = calib.status();
      if (st.ready) {
        trackerRef.current = new SingleLegStanceTracker(calib.result, stanceLeg);
        setUiPhase('ready');
        beginRecording();
      } else if (st.reason === 'low_visibility') {
        setUiPhase('low_visibility');
      } else {
        setUiPhase('calibrating');
        setCalibProgress(st.progress);
      }
      return;
    }

    const tracker = trackerRef.current;
    if (!tracker || tracker.trials.length >= tracker.maxTrials) return;

    const beforeCount = tracker.trials.length;
    tracker.push(landmarks, ts);

    if (tracker.phase === 'holding') {
      setUiPhase('holding');
      setHoldMs(tracker.elapsedHoldMs(ts));
    } else if (tracker.trials.length > beforeCount) {
      const t = tracker.trials[tracker.trials.length - 1];
      setLastTrialNote(t.stepOut ? '조기 종료(스텝아웃)로 기록됨' : '정상 종료로 기록됨');
      setTrialsFound(tracker.trials.length);
      setUiPhase(tracker.trials.length >= tracker.maxTrials ? 'finished' : 'trial_done');
    } else {
      setUiPhase('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightCm, stanceLeg]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  useEffect(() => {
    if (!needHeight && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    return () => {
      stop();
      stopComposeLoop();
      if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needHeight]);

  useEffect(() => {
    if (status === 'error' && error) setErrorMsg(error);
  }, [status, error]);

  const markBalanceLoss = () => trackerRef.current?.markBalanceLoss();

  const stopCurrentHold = () => {
    trackerRef.current?.stopManually(lastTsRef.current);
    const tracker = trackerRef.current;
    if (tracker) {
      const t = tracker.trials[tracker.trials.length - 1];
      setLastTrialNote(t?.stepOut ? '조기 종료(스텝아웃)로 기록됨' : '정상 종료로 기록됨');
      setTrialsFound(tracker.trials.length);
      setUiPhase(tracker.trials.length >= tracker.maxTrials ? 'finished' : 'trial_done');
    }
  };

  // MediaRecorder.onstop에서 blob이 준비되면 최종적으로 onComplete 호출.
  const finishWithBlob = async (blob) => {
    const summary = pendingSummaryRef.current;
    if (!summary) return;
    const previewVideoUrl = blob ? URL.createObjectURL(blob) : '';
    if (typeof onComplete === 'function') {
      await onComplete({ ...summary, videoBlob: blob || null, previewVideoUrl, hasVideo: !!blob });
    }
    setFinishing(false);
  };

  const finishAndSubmit = async () => {
    const tracker = trackerRef.current;
    const calib = calibRef.current;
    if (!tracker) return;
    tracker.finalize(lastTsRef.current);
    const summary = tracker.summary({ cmPerNormUnit: calib?.result?.scaleCmPerY ?? null });
    stop();
    if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
    if (!summary.trial1) {
      setErrorMsg('유효한 유지 시행이 없습니다. 발을 드는 동작이 카메라에 잘 보이는지 확인하고 다시 시도해 주세요.');
      stopComposeLoop();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
      return;
    }
    pendingSummaryRef.current = summary;
    setFinishing(true);
    // MediaRecorder가 있으면 onstop(→finishWithBlob)에서 완료, 없으면 즉시 완료.
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) { finishWithBlob(null); }
    } else {
      finishWithBlob(null);
    }
  };

  const applyHeight = () => {
    const h = Number(heightInput);
    if (!h || h < 80 || h > 250) { setErrorMsg('키를 80~250cm로 입력하세요.'); return; }
    setHeightCm(h); setNeedHeight(false); setErrorMsg('');
    onMemberHeightChange?.(h);
  };

  if (needHeight) {
    return (
      <div className="absolute inset-0 bg-slate-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
          <h2 className="text-white font-black">한다리서기 · {legLabel} 지지</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키가 필요합니다</p>
              <p className="text-slate-400 text-xs">흔들림 거리(cm) 환산에 사용됩니다.</p>
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

  const secs = (holdMs / 1000).toFixed(1);

  const topBar = (
    <>
      <p className="text-sm font-black text-white">{legLabel} 지지</p>
      {uiPhase === 'calibrating' && <p className="text-xs font-bold text-amber-300">자세 보정 중… {Math.round(calibProgress * 100)}%</p>}
      {uiPhase === 'low_visibility' && <p className="text-xs font-bold text-red-300">전신이 보이도록 서 주세요</p>}
      {uiPhase === 'ready' && <p className="text-xs font-bold text-emerald-300">반대쪽 발을 들어 시작</p>}
      {uiPhase === 'trial_done' && <p className="text-xs font-bold text-emerald-300">{trialsFound}차 완료 — {lastTrialNote}</p>}
      {uiPhase === 'finished' && <p className="text-xs font-bold text-emerald-300">2회 모두 완료 — {lastTrialNote}</p>}
      {finishing && <p className="text-xs font-bold text-amber-300">영상 정리 중…</p>}
      {errorMsg && <p className="text-xs font-bold text-red-300">{errorMsg}</p>}
    </>
  );

  const controls = (
    <>
      {uiPhase === 'holding' && (
        <>
          <button onClick={markBalanceLoss}
            className="rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-black text-xs px-4 py-2.5 active:scale-95">
            ⚠ 균형 상실
          </button>
          <button onClick={stopCurrentHold}
            className="rounded-full bg-emerald-500 text-slate-950 font-black text-xs px-4 py-2.5 active:scale-95">
            ✓ 목표 도달, 종료
          </button>
        </>
      )}
      {uiPhase === 'trial_done' && !finishing && (
        <button onClick={finishAndSubmit}
          className="rounded-full bg-slate-700 text-white font-bold text-xs px-4 py-2.5 active:scale-95">
          1차만으로 측정 마치기
        </button>
      )}
      {uiPhase === 'finished' && !finishing && (
        <button onClick={finishAndSubmit}
          className="rounded-full bg-emerald-500 text-slate-950 font-black text-xs px-5 py-2.5 active:scale-95">
          측정 완료 →
        </button>
      )}
      {finishing && (
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          저장 중…
        </div>
      )}
    </>
  );

  return (
    <CameraStage
      videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
      onClose={onBack} tappable={false} showSkeletonToggle
      topBar={topBar} controls={controls}
      recording={uiPhase === 'holding'} recordingLabel={`유지 중 · ${secs}초`}
    >
      {uiPhase === 'holding' && (
        <GaugeHud label="유지시간" value={secs} unit="s" accent="#22d3ee"
          stats={[{ label: '시행', value: `${trialsFound}/2` }]} />
      )}
    </CameraStage>
  );
}
