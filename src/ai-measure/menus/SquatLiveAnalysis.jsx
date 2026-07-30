// ai-measure/menus/SquatLiveAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트 실시간 카메라 측정 — StanceLiveAnalysis.jsx와 거의 동일한
//  구조(usePoseEngine + CameraStage + 녹화 파이프라인). 캘리브레이션·반복(rep)
//  추적 로직은 squatBiomechanicsTracker.js를 공유.
//
//  [정면+측면 2단계 촬영 — 2026-07-30 추가]
//  기존엔 정면에서만 2회 반복을 잡았는데, 무릎외반·골반기울기는 정면이 정확하고
//  상체 전방 기울기는 측면이 정확하다는 한계(파일 하단 squatBiomechanics.js 참고)
//  때문에, 이제 "정면 1회 → 전환 화면 → 측면 1회"로 나눠 촬영하고 두 결과를
//  합쳐 판정한다(view 상태: 'front' | 'side'). 카메라 각도가 바뀌므로 측면으로
//  넘어갈 때 캘리브레이션(서기 기준선)을 새로 잡는다 — 녹화는 정면 시작 시점부터
//  측면 완료까지 끊기지 않고 하나로 이어간다.
//
//  [녹화 파이프라인 — ROM/보행/SLST와 동일 구조로 통일]
//  캘리브레이션이 잠기는 순간부터 화면 전체를 연속 녹화한다 — 스켈레톤+GaugeHud를
//  캔버스에 합성 → captureStream → MediaRecorder. 측정 완료 시 blob을 summary와
//  함께 Hub로 넘겨, 판정 리포트 화면에서 ReportActions로 영상까지 저장/공유.
//
//  SLST(유지 시간 기반)와 달리 스쿼트는 반복(내려갔다 올라오는 사이클) 기반이라
//  실시간 피드백도 "몇 초째"가 아니라 "지금 이 반복이 얼마나 깊이 내려갔는지"를
//  보여준다(liveDepthState()).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { StandingCalibrator, SquatBiomechanicsTracker } from '../core/squatBiomechanicsTracker';
import { DEFAULT_ASPECT, outputSize, drawVideoCover, coverTransform } from '../core/recordAspect';
import { useCameraRotation } from '../core/useCameraRotation';
import { drawGaugeHud } from '../core/recordingOverlay';
import CameraStage from './CameraStage.jsx';
import GaugeHud from './GaugeHud.jsx';

const MAX_RECORD_MS = 60000;

// 자세·보행·SLST 모듈과 동일한 본(bone) 목록 — 상체 코어 + 양다리 + (오버헤드
// 자세 확인용) 어깨-팔꿈치-손목. 판정 로직(squatBiomechanics.js)은 팔꿈치·손목을
// 쓰지 않는다 — 이건 순수 시각 표시용 추가라 측정 결과에는 영향이 없다.
const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

function vis(p, threshold = 0.3) {
  return !!p && (p.visibility == null || p.visibility >= threshold);
}

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
  ctx.clearRect(0, 0, cw, ch); // 매 프레임 지우고 다시 그린다 — 안 지우면 이전 프레임 스켈레톤이 계속 쌓여 잔상(뒤엉킨 그물망)으로 남는다.
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
  [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach((i) => {
    const p = landmarks[i];
    if (!vis(p)) return;
    ctx.beginPath(); ctx.arc(X(p), Y(p), 5, 0, Math.PI * 2); ctx.fill();
  });
}

export default function SquatLiveAnalysis({ member, onBack, onComplete, onMemberHeightChange }) {
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [needHeight, setNeedHeight] = useState(!member?.height);
  const [heightInput, setHeightInput] = useState('');

  // calibrating | low_visibility | ready | active | front_done | finished
  const [uiPhase, setUiPhase] = useState('calibrating');
  const [view, setView] = useState('front'); // 'front' | 'side' — 오늘부터 정면 1회 + 측면 1회
  const [calibProgress, setCalibProgress] = useState(0);
  const [depthPct, setDepthPct] = useState(0);
  const [trialsFound, setTrialsFound] = useState(0); // 현재 단계(view) 트래커 안에서의 완료 수(0 또는 1)
  const [lastTrialNote, setLastTrialNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [finishing, setFinishing] = useState(false);

  const calibRef = useRef(null);
  const trackerRef = useRef(null);
  const frontTrialRef = useRef(null); // 정면 시행 결과 보관(측면 진행 중에도 유지)
  const lastTsRef = useRef(0);
  const canvasRef = useRef(null);
  const startedRef = useRef(false);
  const countdownTimerRef = useRef(null);
  const measureStartedRef = useRef(false); // 캘리브레이션 완료 후 "촬영 시작" 버튼+카운트다운을 거쳤는지
  const [countdown, setCountdown] = useState(null);
  const [started, setStarted] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false); // MediaRecorder 실제 동작 여부(정면→측면 전환 중에도 계속 true)

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
  const depthPctRef = useRef(0);
  const viewRef = useRef('front');
  const trialsFoundRef = useRef(0);

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
      drawSkeleton(canvas, video, latestLandmarksRef.current, !!calibRef.current?.locked, { x: cover.X, y: cover.Y });
      const elapsedSec = recordingStartedRef.current ? (performance.now() - recordStartTsRef.current) / 1000 : 0;
      drawGaugeHud(ctx, canvas.width, canvas.height, {
        title: 'SQUAT',
        recording: true,
        elapsedSec,
        accent: '#f59e0b',
        gauge: { label: '깊이', value: depthPctRef.current, unit: '%', arc: true, min: 0, max: 100 },
        stats: [{ label: viewRef.current === 'front' ? '정면' : '측면', value: (viewRef.current === 'side' ? 1 : 0) + trialsFoundRef.current, unit: '/2' }],
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
        setRecordingActive(true);
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

  // [2026-07-30] 버튼이 캘리브레이션 완료를 기다리지 않고 언제든 눌리게 변경 —
  // 촬영 대상자가 카메라 앞이 아니라 노트북 앞에서(또는 트레이너가 미리) 버튼을
  // 누르는 경우를 지원한다. 트래커 생성은 실제로 캘리브레이션이 끝나는 시점에
  // handleResult에서 한다(버튼이 먼저 눌렸든 캘리브레이션이 먼저 끝났든 동일하게
  // 처리됨). maxTrials:1 — 정면/측면 각 단계는 1회씩만 잡고 넘어간다.
  const startMeasurement = () => {
    if (measureStartedRef.current) return;
    measureStartedRef.current = true;
    setStarted(true);
    beginRecording();
  };

  // 정면 시행을 마치고 측면으로 넘어간다 — 카메라 각도가 바뀌므로 캘리브레이션을
  // 새로 잡아야 한다(기준선 재확보). 녹화는 이미 켜져 있으면 계속 이어간다
  // (beginRecording 은 recordingStartedRef 가드로 두 번째 호출을 무시함).
  const proceedToSide = () => {
    calibRef.current = null;
    trackerRef.current = null;
    measureStartedRef.current = false;
    setStarted(false);
    setTrialsFound(0);
    trialsFoundRef.current = 0;
    setCalibProgress(0);
    setView('side');
    viewRef.current = 'side';
    setUiPhase('calibrating');
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
        setUiPhase('ready'); // 캘리브레이션 완료
        if (measureStartedRef.current && !trackerRef.current) {
          // 버튼을 캘리브레이션보다 먼저 눌러둔 경우 — 지금 트래커 생성.
          trackerRef.current = new SquatBiomechanicsTracker(calib.result, { maxTrials: 1 });
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
      trackerRef.current = new SquatBiomechanicsTracker(calib.result, { maxTrials: 1 });
    }
    const tracker = trackerRef.current;
    if (!tracker || tracker.trials.length >= tracker.maxTrials) return;

    const beforeCount = tracker.trials.length;
    tracker.push(landmarks, ts);

    if (tracker.phase === 'active') {
      setUiPhase('active');
      const live = tracker.liveDepthState();
      const pct = live ? Math.round(live.depthFrac * 100) : 0;
      setDepthPct(pct);
      depthPctRef.current = pct;
    } else if (tracker.trials.length > beforeCount) {
      const t = tracker.trials[tracker.trials.length - 1];
      setLastTrialNote(t.heelLift ? '뒤꿈치 들림이 감지됐어요' : '정상 종료로 기록됨');
      setTrialsFound(tracker.trials.length);
      trialsFoundRef.current = tracker.trials.length;
      setDepthPct(0);
      depthPctRef.current = 0;
      if (view === 'front') {
        frontTrialRef.current = t;
        setUiPhase('front_done'); // 정면 완료 — 측면으로 넘어가는 전환 화면 표시
      } else {
        setUiPhase('finished'); // 측면까지 완료 — 종합 제출 가능
      }
    } else {
      setUiPhase('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightCm, view]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });
  const [rotationDeg] = useCameraRotation();

  useEffect(() => {
    if (!needHeight && !startedRef.current) {
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
  }, [needHeight]);

  useEffect(() => {
    if (status === 'error' && error) setErrorMsg(error);
  }, [status, error]);

  const markBalanceLoss = () => trackerRef.current?.markBalanceLoss();

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
    // view가 'side'이고 측면 트래커가 있으면 그 시행을 포함, 아니면 정면만으로 종료
    // ("측면 생략하고 마치기" 경로 — view는 아직 'front'인 상태로 호출됨).
    let sideTrial = null;
    if (view === 'side' && trackerRef.current) {
      trackerRef.current.finalize(lastTsRef.current);
      sideTrial = trackerRef.current.trials[0] || null;
    }
    const frontTrial = frontTrialRef.current;
    stop();
    if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
    if (!frontTrial && !sideTrial) {
      setErrorMsg('유효한 반복(스쿼트)이 없습니다. 무릎 높이까지 충분히 앉는 동작이 카메라에 잘 보이는지 확인하고 다시 시도해 주세요.');
      stopComposeLoop();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
      return;
    }
    const summary = {
      front: frontTrial ? { valid: true, ...frontTrial } : undefined,
      side: sideTrial ? { valid: true, ...sideTrial } : undefined,
      trialsFound: (frontTrial ? 1 : 0) + (sideTrial ? 1 : 0),
    };
    pendingSummaryRef.current = summary;
    setFinishing(true);
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

  const totalDone = view === 'front' ? trialsFound : (frontTrialRef.current ? 1 : 0) + trialsFound;

  const topBar = (
    <>
      <p className="text-sm font-black text-white">오버헤드 딥 스쿼트 · {view === 'front' ? '정면' : '측면'}</p>
      {!['calibrating', 'low_visibility'].includes(uiPhase) && (
        <p className="text-[11px] font-bold text-slate-300">회차 {totalDone}/2</p>
      )}
      {uiPhase === 'calibrating' && <p className="text-xs font-bold text-amber-300">자세 보정 중… {Math.round(calibProgress * 100)}%</p>}
      {uiPhase === 'low_visibility' && <p className="text-xs font-bold text-red-300">전신이 보이도록 서 주세요</p>}
      {!started && !['calibrating', 'low_visibility', 'front_done', 'finished'].includes(uiPhase) && (
        <p className="text-xs font-bold text-emerald-300">준비됐어요 — 녹화 시작을 눌러주세요</p>
      )}
      {started && uiPhase === 'ready' && <p className="text-xs font-bold text-emerald-300">양팔 들고 스쿼트 시작</p>}
      {uiPhase === 'front_done' && <p className="text-xs font-bold text-emerald-300">정면 촬영 완료! 이제 옆으로 돌아서 주세요</p>}
      {uiPhase === 'finished' && <p className="text-xs font-bold text-emerald-300">정면·측면 모두 완료 — {lastTrialNote}</p>}
      {finishing && <p className="text-xs font-bold text-amber-300">영상 정리 중…</p>}
      {errorMsg && <p className="text-xs font-bold text-red-300">{errorMsg}</p>}
    </>
  );

  const controls = (
    <>
      {!started && !['front_done', 'finished'].includes(uiPhase) && (
        <button onClick={startMeasurement} disabled={status !== 'running'}
          className="h-20 w-20 rounded-full border-4 border-white bg-red-500 text-xs font-black text-white shadow-lg disabled:bg-slate-600 disabled:text-slate-300 active:scale-95">
          녹화<br />시작
        </button>
      )}
      {uiPhase === 'active' && (
        <button onClick={markBalanceLoss}
          className="rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-black text-xs px-4 py-2.5 active:scale-95">
          ⚠ 균형 상실 표시
        </button>
      )}
      {uiPhase === 'front_done' && !finishing && (
        <div className="flex flex-col items-center gap-2">
          <button onClick={proceedToSide}
            className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-sm px-6 py-3 active:scale-95">
            다음: 측면 촬영 →
          </button>
          <button onClick={finishAndSubmit}
            className="rounded-full bg-slate-700 text-white font-bold text-xs px-4 py-2 active:scale-95">
            측면 생략하고 정면만으로 마치기
          </button>
        </div>
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
      recording={recordingActive} recordingLabel={uiPhase === 'active' ? `진행 중 · 깊이 ${depthPct}%` : '녹화 중'}
    >
      {uiPhase === 'active' && (
        <GaugeHud label="깊이" value={depthPct} unit="%" arc min={0} max={100} accent="#f59e0b"
          stats={[{ label: '회차', value: `${totalDone}/2` }]} />
      )}
    </CameraStage>
    {/* 임시 디버그 표시 — 문제 확인되면 제거 예정 */}
    <div className="pointer-events-none fixed bottom-1 left-1 z-[999] rounded bg-black/80 px-2 py-1 font-mono text-[9px] text-lime-300">
      view={view} · phase={uiPhase} · locked={String(!!calibRef.current?.locked)} · prog={Math.round(calibProgress * 100)}% · started={String(started)} · cd={String(countdown)}
    </div>
    </>
  );
}
