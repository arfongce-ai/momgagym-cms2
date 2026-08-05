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
<<<<<<< HEAD
import { pickRecorderMime } from '../core/recordSink';
=======
>>>>>>> 95d9ba96c50e9625d37d312a9237be872fd4d2a7
import { DEFAULT_ASPECT, outputSize, drawVideoCover, coverTransform, rotateLandmarksNormalized } from '../core/recordAspect';
import { useCameraRotation } from '../core/useCameraRotation';
import { drawGaugeHud } from '../core/recordingOverlay';
import CameraStage from './CameraStage.jsx';
import GaugeHud from './GaugeHud.jsx';

const LEG_KO = { left: '왼쪽', right: '오른쪽' };
const MAX_RECORD_MS = 60000;
// [2026-07-31] 운영 방식 확정: 다리당 1회 지지(왼발 1회 → 오른발 1회)로 측정한다.
// 판정(singleLegStance.js)은 원래 2회 재현성 확인용으로 설계됐지만, trial2가
// 없을 때를 위한 "single_trial_only" 경로가 이미 있어 그대로 재사용된다 —
// 그 경로에서는 재현성 확정 없이 단일 시행 결과를 쓰고 needsRetest만 남긴다.
const SLST_LIVE_MAX_TRIALS = 1;

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

// clearFirst: 미리보기 캔버스는 매 프레임 지워야 잔상(뒤엉킨 그물망)이 안 남는다.
// 반대로 녹화 합성 캔버스는 바로 앞에서 영상 프레임을 그려둔 상태라 지우면
// 영상이 사라지고 스켈레톤만 남는다([2026-08-02] 저장 영상에 스켈레톤만
// 나오던 버그의 원인) — 합성 루프에서는 clearFirst=false 로 호출한다.
function drawSkeleton(canvas, video, landmarks, locked, mapper, clearFirst = true) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
  if (clearFirst && (canvas.width !== cw || canvas.height !== ch)) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  if (clearFirst) ctx.clearRect(0, 0, cw, ch);
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

export default function StanceLiveAnalysis({ member, stanceLeg, eyesClosed, onBack, onComplete }) {
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
  const countdownTimerRef = useRef(null);
  const measureStartedRef = useRef(false); // 캘리브레이션 완료 후 "촬영 시작" 버튼+카운트다운을 거쳤는지
  const [countdown, setCountdown] = useState(null);
  const [started, setStarted] = useState(false);

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
      if (!drawVideoCover(ctx, video, canvas.width, canvas.height, rotationDeg)) return;
      const cover = coverTransform(video, canvas.width, canvas.height, rotationDeg);
      drawSkeleton(canvas, video, latestLandmarksRef.current, !!calibRef.current?.locked, { x: cover.X, y: cover.Y }, false);
      const tracker = trackerRef.current;
      const elapsedSec = recordingStartedRef.current ? (performance.now() - recordStartTsRef.current) / 1000 : 0;
      drawGaugeHud(ctx, canvas.width, canvas.height, {
        title: 'SLST',
        recording: true,
        elapsedSec,
        accent: '#22d3ee',
        gauge: tracker?.phase === 'holding'
          ? { label: '유지시간', value: (tracker.elapsedHoldMs(lastTsRef.current) / 1000).toFixed(1), unit: 's' }
          : { label: legLabel + ' 지지', value: trialsFound, unit: `/${SLST_LIVE_MAX_TRIALS}` },
        stats: [{ label: '시행', value: trialsFound, unit: `/${SLST_LIVE_MAX_TRIALS}` }],
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
      // [2026-08-03] 로컬 mp4-우선 배열 대신 공용 pickRecorderMime()을 쓴다 —
      // 코덱까지 명시해야 크로미움에서 mp4가 실제로 잡힌다(recordSink.js 참고).
      const selectedMime = pickRecorderMime();
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

  // VBT/점프와 동일한 "버튼 → 3-2-1 → 시작" 패턴(UI 통일성).
  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    setCountdown(null);
  }, []);

  const runStartCountdown = useCallback((onDone) => {
    if (countdownTimerRef.current) return;
    let next = 3;
    setCountdown(next);
    countdownTimerRef.current = setInterval(() => {
      next -= 1;
      if (next <= 0) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdown(null);
        onDone?.();
      } else {
        setCountdown(next);
      }
    }, 1000);
  }, []);

  // 캘리브레이션은 이미 끝난 상태(calib.locked)에서만 호출됨 — 버튼을 눌러야
  // 비로소 트래커 생성 + 녹화 시작 + 시행 판정이 시작된다.
  // [2026-08-02] 3-2-1 카운트다운 복원. runStartCountdown 은 정의만 되어 있고
  // 아무 데서도 호출되지 않아(2026-07-30에 "바로 시작"으로 바꾸면서 호출부만
  // 빠짐) 화면에 카운트다운이 전혀 뜨지 않았다. 버튼을 누른 사람이 카메라
  // 앞으로 이동할 시간이 필요하므로 VBT/점프와 동일하게 되돌린다.
  // [2026-07-30] 버튼이 캘리브레이션 완료를 기다리지 않고 언제든 눌리게 변경 —
  // 촬영 대상자가 카메라 앞이 아니라 노트북 앞에서(또는 트레이너가 미리) 버튼을
  // 누르는 경우를 지원한다. 트래커 생성은 실제로 캘리브레이션이 끝나는 시점에
  // handleResult에서 한다.
  const startMeasurement = () => {
    if (measureStartedRef.current) return;
    if (countdownTimerRef.current) return; // 이미 카운트다운 중이면 중복 실행 방지
    runStartCountdown(() => {
      if (measureStartedRef.current) return;
      measureStartedRef.current = true;
      setStarted(true);
      beginRecording();
    });
  };

  const [rotationDeg] = useCameraRotation();

  const handleResult = useCallback((landmarks, ts, video) => {
    lastTsRef.current = ts;
    latestVideoElRef.current = video || latestVideoElRef.current;
    // 원본(raw) 그대로 보관 — 녹화 합성 루프(composeLoop)가 이 값을 coverTransform(
    // rotationDeg)에 직접 넘겨 자체적으로 회전 보정하므로 여기서 미리 보정하면
    // 이중 회전이 된다.
    latestLandmarksRef.current = landmarks;
    if (!calibRef.current) calibRef.current = new StandingCalibrator({});
    const calib = calibRef.current;

    // 라이브 스켈레톤 오버레이도 CameraStage와 같은 CSS 회전 래퍼를 공유하므로
    // 원본(raw) 좌표를 그대로 쓴다(이중 회전 방지).
    drawSkeleton(canvasRef.current, video, landmarks, calib.locked);
    if (!landmarks) return;

    // [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크) 보정 —
    // SLST 판정(기준선·유지시간·균형상실·골반기울기)은 전부 "수직/좌우" 축을
    // 가정하는 계산이라 회전 보정된 좌표가 필요하다.
    const corrected = rotateLandmarksNormalized(landmarks, rotationDeg);

    if (!calib.locked) {
      calib.push(corrected);
      const st = calib.status();
      if (st.ready) {
        setUiPhase('ready'); // 캘리브레이션 완료
        if (measureStartedRef.current && !trackerRef.current) {
          // 버튼을 캘리브레이션보다 먼저 눌러둔 경우 — 지금 트래커 생성.
          trackerRef.current = new SingleLegStanceTracker(calib.result, stanceLeg, { maxTrials: SLST_LIVE_MAX_TRIALS });
        }
      } else if (st.reason === 'low_visibility') {
        setUiPhase('low_visibility');
      } else {
        setUiPhase('calibrating');
        setCalibProgress(st.progress);
      }
      return;
    }

    if (!measureStartedRef.current) return; // 캘리브레이션 완료, 아직 촬영 시작 버튼 대기 중

    if (!trackerRef.current) {
      // 캘리브레이션이 버튼보다 먼저 끝난 일반적인 경우 — 여기서 트래커 생성.
      trackerRef.current = new SingleLegStanceTracker(calib.result, stanceLeg, { maxTrials: SLST_LIVE_MAX_TRIALS });
    }
    const tracker = trackerRef.current;
    if (!tracker || tracker.trials.length >= tracker.maxTrials) return;

    const beforeCount = tracker.trials.length;
    tracker.push(corrected, ts);

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
  }, [stanceLeg, rotationDeg]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      start();
    }
    return () => {
      stop();
      stopComposeLoop();
      clearCountdown();
      if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const summary = tracker.summary();
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

  const secs = (holdMs / 1000).toFixed(1);

  const topBar = (
    <>
      <p className="text-sm font-black text-white">
        {legLabel} 지지 <span className={eyesClosed ? 'text-violet-300' : 'text-cyan-300'}>· {eyesClosed ? '눈감고' : '눈뜨고'}</span>
      </p>
      {uiPhase === 'calibrating' && <p className="text-xs font-bold text-amber-300">자세 보정 중… {Math.round(calibProgress * 100)}%</p>}
      {uiPhase === 'low_visibility' && <p className="text-xs font-bold text-red-300">전신이 보이도록 서 주세요</p>}
      {!started && !['calibrating', 'low_visibility', 'trial_done', 'finished'].includes(uiPhase) && (
        <p className="text-xs font-bold text-emerald-300">준비됐어요 — 녹화 시작을 눌러주세요</p>
      )}
      {started && uiPhase === 'ready' && <p className="text-xs font-bold text-emerald-300">반대쪽 발을 들어 시작</p>}
      {uiPhase === 'trial_done' && <p className="text-xs font-bold text-emerald-300">{trialsFound}차 완료 — {lastTrialNote}</p>}
      {uiPhase === 'finished' && <p className="text-xs font-bold text-emerald-300">측정 완료 — {lastTrialNote}</p>}
      {finishing && <p className="text-xs font-bold text-amber-300">영상 정리 중…</p>}
      {errorMsg && <p className="text-xs font-bold text-red-300">{errorMsg}</p>}
    </>
  );

  const controls = (
    <>
      {!started && !['trial_done', 'finished'].includes(uiPhase) && (
        <button onClick={startMeasurement} disabled={status !== 'running'}
          className="h-20 w-20 rounded-full border-4 border-white bg-red-500 text-xs font-black text-white shadow-lg disabled:bg-slate-600 disabled:text-slate-300 active:scale-95">
          녹화<br />시작
        </button>
      )}
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
    <>
    <CameraStage
      videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
      onClose={onBack} tappable={false} showSkeletonToggle
      topBar={topBar} controls={controls} countdown={countdown}
      recording={started} recordingLabel={uiPhase === 'holding' ? `유지 중 · ${secs}초` : '녹화 중'}
    >
      {uiPhase === 'holding' && (
        <GaugeHud label="유지시간" value={secs} unit="s" accent="#22d3ee"
          stats={[{ label: '시행', value: `${trialsFound}/${SLST_LIVE_MAX_TRIALS}` }]} />
      )}
    </CameraStage>
    {status === 'running' && (
      <div className="pointer-events-none fixed top-3 right-3 z-40 rounded-2xl bg-black/70 border border-white/20 px-4 py-2 text-center backdrop-blur">
        <div className="text-[10px] font-bold text-slate-300 tracking-wide">시행</div>
        <div className="text-2xl font-black text-white leading-none">{trialsFound}<span className="text-sm text-slate-400">/{SLST_LIVE_MAX_TRIALS}</span></div>
      </div>
    )}
    </>
  );
}
