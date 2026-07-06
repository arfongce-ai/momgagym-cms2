// ai-measure/menus/RecordMeasure.jsx
// General video recording. Preview and saved video use the selected frame
// ratio at full quality (high resolution + bitrate).
import { useRef, useState, useEffect, useCallback } from 'react';
import { buildRecordingFileName } from '../../utils/recordingName';
import { boostedGain } from '../core/audioCue';
import { openMainCameraStream, refocusCameraStream } from '../core/cameraSelect';
import { formatStopwatch } from '../core/recordingOverlay';
import { nextPhase, firstPhase, phaseDurationSec } from '../core/intervalTimer';

const RECORD_FPS = 30;
const MAX_RECORD_SECONDS = 30;

// ── 화질 프리셋 ──
//  카톡 전송이 주 용도(짧은 영상 여러 개 즉시 전송)이므로 '표준'이 기본값.
//  카톡은 어차피 전송 시 720p급으로 재압축하므로, 그 이상 비트레이트는
//  용량만 커지고 수신 화질은 같다. 표준 10초 ≈ 4~5MB (기존 12Mbps ≈ 15MB).
const QUALITY_PRESETS = {
  standard: {
    label: '표준', hint: '카톡 전송 최적 · 10초 ≈ 4MB',
    videoBps: 3_500_000, audioBps: 96_000,
    size: { '3/4': { width: 720, height: 960 }, '1/1': { width: 720, height: 720 } },
  },
  high: {
    label: '고화질', hint: '세밀 확인용 · 10초 ≈ 10MB',
    videoBps: 8_000_000, audioBps: 128_000,
    size: { '3/4': { width: 1080, height: 1440 }, '1/1': { width: 1080, height: 1080 } },
  },
};
const QUALITY_STORAGE_KEY = 'momgagym.recordQuality';

function loadSavedQuality() {
  try {
    const v = localStorage.getItem(QUALITY_STORAGE_KEY);
    return QUALITY_PRESETS[v] ? v : 'standard';
  } catch { return 'standard'; }
}

function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const choices = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function waitForVideoReady(video, timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!video) {
      resolve(false);
      return;
    }
    if (video.videoWidth > 0 && video.readyState >= 2) {
      resolve(true);
      return;
    }

    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
      resolve(ok);
    };
    const onReady = () => {
      if (video.videoWidth > 0 && video.readyState >= 2) finish(true);
    };
    const timer = setTimeout(() => finish(video.videoWidth > 0), timeoutMs);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    video.play().then(onReady).catch(() => {});
  });
}

function drawCover(ctx, video, width, height) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return false;

  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return true;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)}MB`;
}

function triggerDownload(url, fileName) {
  if (!url || typeof document === 'undefined') return false;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch (e) {
    return false;
  }
}

export default function RecordMeasure({ member: _member, onBack }) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const guideCanvasRef = useRef(null);
  const recordCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const recordStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const mimeRef = useRef('video/webm');
  const rafRef = useRef(null);
  const composeRafRef = useRef(null);
  const startTsRef = useRef(0);
  const timerRef = useRef(null);
  const autoStopTimerRef = useRef(null);
  const focusTimerRef = useRef(null);
  const overlayStateRef = useRef({});

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [aspect, setAspect] = useState('3/4');
  const [quality, setQuality] = useState(loadSavedQuality); // 'standard' | 'high'
  const selectQuality = (q) => {
    setQuality(q);
    try { localStorage.setItem(QUALITY_STORAGE_KEY, q); } catch { /* noop */ }
  };
  const [toolTab, setToolTab] = useState('stopwatch');
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [metronomeBpm, setMetronomeBpm] = useState(100);
  const [metronomePlaying, setMetronomePlaying] = useState(false);
  // 인터벌 타이머 설정/진행 상태 (탭 전환해도 유지되도록 부모가 보관)
  const intervalStateRef = useRef({
    workSec: 30, restSec: 15, rounds: 8, prepSec: 5,
    phase: 'idle', round: 1, endAt: 0, running: false,
  });
  const [intervalView, setIntervalView] = useState(0); // 리렌더 트리거용
  const [videoReady, setVideoReady] = useState(false);
  const [cameraNote, setCameraNote] = useState('');
  const [savedSize, setSavedSize] = useState('');
  const [savedFileName, setSavedFileName] = useState(''); // 촬영별 고유 파일명(카톡 전송용)
  const [autoSaveState, setAutoSaveState] = useState('idle');
  const [focusPoint, setFocusPoint] = useState(null);

  const drawLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = guideCanvasRef.current;
    if (video && canvas && video.videoWidth) {
      const box = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width || 720));
      const height = Math.max(1, Math.round(box.height || 960));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const attachPreview = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    await video.play().catch(() => {});
  }, []);

  const stopPreviewLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const stopComposeLoop = () => {
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    composeRafRef.current = null;
  };

  const stopRecordStream = () => {
    if (recordStreamRef.current) recordStreamRef.current.getTracks().forEach((track) => track.stop());
    recordStreamRef.current = null;
  };

  const clearRecordTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    autoStopTimerRef.current = null;
  };

  const stopRecorder = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  useEffect(() => {
    overlayStateRef.current = {
      toolTab,
      stopwatchElapsed,
      stopwatchRunning,
      metronomeBpm,
      metronomePlaying,
      recordingElapsed: elapsed,
    };
  }, [toolTab, stopwatchElapsed, stopwatchRunning, metronomeBpm, metronomePlaying, elapsed]);

  const stopStream = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const handlePreviewFocus = (event) => {
    if (!streamRef.current || status === 'done') return;
    const frame = frameRef.current;
    const rect = frame ? frame.getBoundingClientRect() : event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // 비율 프레임 바깥(검은 여백)을 탭하면 무시한다.
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) return;

    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    setFocusPoint({ x: point.x * 100, y: point.y * 100 });
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusPoint(null), 700);
    refocusCameraStream(streamRef.current, point).catch(() => {});
  };

  const startCamera = async () => {
    setError(null);
    setVideoReady(false);
    setCameraNote('카메라 연결 중입니다...');
    setStatus('idle');
    try {
      stopPreviewLoop();
      stopStream();
      const stream = await openMainCameraStream({ audio: true, preferExactDevice: true });
      streamRef.current = stream;
      await attachPreview();
      const ready = await waitForVideoReady(videoRef.current);
      setVideoReady(ready);
      setCameraNote(ready ? '' : '카메라 영상 준비가 늦습니다. 녹화 시작을 누르면 한 번 더 확인합니다.');
      setStatus('ready');
      rafRef.current = requestAnimationFrame(drawLoop);
    } catch (e) {
      setError(e?.message || '카메라를 열 수 없습니다. 권한을 허용했는지 확인하세요.');
      setCameraNote('');
      setStatus('idle');
    }
  };

  const ensureVideoReady = async () => {
    await attachPreview();
    let ready = await waitForVideoReady(videoRef.current, 5000);
    if (ready) return true;

    stopStream();
    const stream = await openMainCameraStream({ audio: false, preferExactDevice: true });
    streamRef.current = stream;
    await attachPreview();
    ready = await waitForVideoReady(videoRef.current, 7000);
    return ready;
  };

  const createRecordedStream = () => {
    const video = videoRef.current;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.standard;
    const size = preset.size[aspect] || preset.size['3/4'];
    canvas.width = size.width;
    canvas.height = size.height;
    recordCanvasRef.current = canvas;

    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCover(ctx, video, canvas.width, canvas.height);
      composeRafRef.current = requestAnimationFrame(draw);
    };
    stopComposeLoop();
    draw();

    const canvasStream = canvas.captureStream ? canvas.captureStream(RECORD_FPS) : null;
    if (!canvasStream) return streamRef.current;

    const mixed = new MediaStream();
    canvasStream.getVideoTracks().forEach((track) => mixed.addTrack(track));
    streamRef.current?.getAudioTracks().forEach((track) => mixed.addTrack(track));
    recordStreamRef.current = mixed;
    return mixed;
  };

  const startRec = async () => {
    if (!streamRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('이 브라우저에서는 영상 녹화를 지원하지 않습니다.');
      return;
    }

    try {
      setError(null);
      setSavedSize('');
      setSavedFileName('');
      setAutoSaveState('idle');
      setCameraNote('카메라 영상을 확인하는 중입니다...');
      const ready = await ensureVideoReady();
      setVideoReady(ready);
      if (!ready) {
        setCameraNote('');
        setError('카메라 화면이 아직 준비되지 않았습니다. 권한을 허용한 뒤 카메라 시작을 다시 눌러 주세요.');
        setStatus('idle');
        stopStream();
        return;
      }
      setCameraNote('');

      chunksRef.current = [];
      const mime = pickRecorderMime();
      mimeRef.current = mime || 'video/webm';
      const recordingStream = createRecordedStream();
      const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.standard;
      const rec = new MediaRecorder(recordingStream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: preset.videoBps,
        audioBitsPerSecond: preset.audioBps,
      });

      rec.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };
      rec.onerror = () => {
        stopComposeLoop();
        stopRecordStream();
        stopStream();
        clearRecordTimers();
        setError('녹화 중 오류가 발생했습니다. 카메라 권한과 저장 공간을 확인해 주세요.');
        setVideoReady(false);
        setStatus('idle');
      };
      rec.onstop = () => {
        stopComposeLoop();
        stopRecordStream();
        // 카메라(미리보기 스트림)는 끄지 않고 유지한다 — '다시 녹화'가
        // getUserMedia 재연결 없이 즉시 이어지도록(연속 촬영 로딩 제거).
        // 스트림 해제는 화면 이탈(stopAll/언마운트)에서만 수행한다.
        stopPreviewLoop();
        clearRecordTimers();
        if (!chunksRef.current.length) {
          setError('녹화된 영상 데이터가 없습니다. 다시 촬영해 주세요.');
          setStatus('idle');
          return;
        }
        const type = mimeRef.current;
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        setSavedSize(formatBytes(blob.size));
        setElapsed((current) => Math.min(
          MAX_RECORD_SECONDS,
          Math.max(current || 0, Math.ceil((Date.now() - startTsRef.current) / 1000))
        ));
        const url = URL.createObjectURL(blob);
        // 녹화 종료 시각 기준 고유 이름(몸가짐YYMMDDHHmm) — 같은 분이면 초 추가.
        const fileName = buildRecordingFileName(type);
        setSavedFileName(fileName);
        setVideoUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
        setStatus('done');
        setAutoSaveState('saving');
        requestAnimationFrame(() => {
          setAutoSaveState(triggerDownload(url, fileName) ? 'attempted' : 'blocked');
        });
      };

      recorderRef.current = rec;
      startTsRef.current = Date.now();
      setElapsed(0);
      clearRecordTimers();
      timerRef.current = setInterval(() => {
        const nextElapsed = Math.min(MAX_RECORD_SECONDS, Math.floor((Date.now() - startTsRef.current) / 1000));
        setElapsed(nextElapsed);
        if (nextElapsed >= MAX_RECORD_SECONDS) stopRecorder();
      }, 250);
      autoStopTimerRef.current = setTimeout(stopRecorder, MAX_RECORD_SECONDS * 1000);
      // 타임슬라이스로 청크를 나눠 받으면(특히 mp4) Blob 이어붙이기 과정에서
      // 실제 녹화 시간보다 재생 가능한 길이가 짧아지는 문제가 생긴다.
      // stop() 시 한 번에 완전한 Blob을 받도록 타임슬라이스 없이 시작한다.
      rec.start();
      setStatus('recording');
    } catch (e) {
      stopComposeLoop();
      stopRecordStream();
      setError(e?.message || '녹화를 시작할 수 없습니다.');
    }
  };

  const stopRec = () => {
    stopRecorder();
    clearRecordTimers();
  };

  const stopAll = useCallback(() => {
    stopPreviewLoop();
    stopComposeLoop();
    stopRecordStream();
    clearRecordTimers();
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch (e) { /* noop */ }
    }
    stopStream();
    setVideoReady(false);
    setFocusPoint(null);
  }, []);

  const reset = () => {
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    blobRef.current = null;
    setSavedSize('');
    setSavedFileName('');
    setAutoSaveState('idle');
    setElapsed(0);
    setVideoReady(!!videoRef.current?.videoWidth);
    setStatus(streamRef.current ? 'ready' : 'idle');
    requestAnimationFrame(() => {
      attachPreview();
      if (streamRef.current) rafRef.current = requestAnimationFrame(drawLoop);
    });
  };

  // 화면 진입 시 '카메라 시작' 탭 없이 곧바로 카메라를 켠다.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'ready' || status === 'recording') attachPreview();
  }, [status, attachPreview]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const markReady = () => setVideoReady(video.videoWidth > 0 && video.readyState >= 2);
    video.addEventListener('loadedmetadata', markReady);
    video.addEventListener('canplay', markReady);
    video.addEventListener('playing', markReady);
    return () => {
      video.removeEventListener('loadedmetadata', markReady);
      video.removeEventListener('canplay', markReady);
      video.removeEventListener('playing', markReady);
    };
  }, []);

  useEffect(() => () => {
    stopAll();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [stopAll, videoUrl]);

  const displayElapsed = Math.min(MAX_RECORD_SECONDS, elapsed);
  const mmss = `${String(Math.floor(displayElapsed / 60)).padStart(2, '0')}:${String(displayElapsed % 60).padStart(2, '0')}`;
  const maxTimeLabel = `00:${String(MAX_RECORD_SECONDS).padStart(2, '0')}`;
  const fname = savedFileName; // onstop 에서 고정 — 자동저장·재시도·공유가 같은 이름 사용
  const shareSupported = typeof navigator !== 'undefined' && !!navigator.canShare;

  const saveToGallery = async () => {
    try {
      const blob = blobRef.current;
      if (!blob) return;
      const file = new File([blob], fname, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fname });
      } else {
        triggerDownload(videoUrl, fname);
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        alert('공유 창을 열 수 없습니다. 영상 다운로드로 저장해 주세요.');
      }
    }
  };

  const retryAutoSave = () => {
    setAutoSaveState(triggerDownload(videoUrl, fname) ? 'attempted' : 'blocked');
  };

  const miniToolPanel = (
    <section className="rounded-2xl bg-black/22 border border-white/10 backdrop-blur-sm px-3 py-2 text-white shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-black/25 p-0.5">
          {[
            ['stopwatch', '초시계'],
            ['interval', '인터벌'],
            ['metronome', '메트로놈'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setToolTab(key)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold ${toolTab === key ? 'bg-amber-500/90 text-slate-950' : 'text-white/70'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] font-bold text-white/50">녹화 보조</span>
      </div>
      {toolTab === 'stopwatch' ? (
        <InlineStopwatch
          elapsed={stopwatchElapsed}
          running={stopwatchRunning}
          onElapsedChange={setStopwatchElapsed}
          onRunningChange={setStopwatchRunning}
        />
      ) : toolTab === 'interval' ? (
        <InlineInterval stateRef={intervalStateRef} onChange={() => setIntervalView((v) => v + 1)} />
      ) : (
        <InlineMetronome
          bpm={metronomeBpm}
          playing={metronomePlaying}
          onBpmChange={setMetronomeBpm}
          onPlayingChange={setMetronomePlaying}
        />
      )}
    </section>
  );

  if (status !== 'done') {
    // 이미지2(1:1)·이미지3(3:4)처럼, 프리뷰를 선택한 비율 프레임 안에
    // 실제 저장 비율 그대로(위·아래 검은 여백 포함) 보여준다.
    const frameRatio = aspect === '1/1' ? '1 / 1' : '3 / 4';
    return (
        <div className="fixed inset-0 z-[80] bg-black overflow-hidden">
        <div
          className="absolute inset-0 flex flex-col items-center"
          style={{ paddingTop: 'max(64px, calc(env(safe-area-inset-top) + 56px))' }}
          onPointerDown={handlePreviewFocus}
        >
          <div
            ref={frameRef}
            className="relative w-full overflow-hidden touch-manipulation"
            style={{ aspectRatio: frameRatio, maxHeight: '100%' }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />
            <canvas ref={guideCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />
            {focusPoint && (
              <div
                className="pointer-events-none absolute z-10 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300/90 shadow-[0_0_22px_rgba(251,191,36,0.65)]"
                style={{ left: `${focusPoint.x}%`, top: `${focusPoint.y}%` }}
              />
            )}
          </div>
        </div>

        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
          <button onClick={onBack} className="rounded-full bg-black/55 px-3 py-2 text-sm font-bold text-white backdrop-blur">← 메뉴</button>
          <div className="flex gap-1 rounded-xl bg-black/55 p-1 backdrop-blur">
            {Object.entries(QUALITY_PRESETS).map(([key, qp]) => (
              <button
                key={key}
                onClick={() => selectQuality(key)}
                disabled={status === 'recording'}
                className={`rounded-lg px-3 py-2 text-xs font-black ${quality === key ? 'bg-cyan-400 text-slate-950' : 'text-slate-300'} disabled:opacity-60`}
              >
                {qp.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-xl bg-black/55 p-1 backdrop-blur">
            {['3/4', '1/1'].map((ratio) => (
              <button
                key={ratio}
                onClick={() => setAspect(ratio)}
                disabled={status === 'recording'}
                className={`rounded-lg px-4 py-2 text-sm font-black ${aspect === ratio ? 'bg-amber-500 text-slate-950' : 'text-slate-300'} disabled:opacity-60`}
              >
                {ratio === '3/4' ? '3:4' : '1:1'}
              </button>
            ))}
          </div>
        </div>

        {status === 'idle' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-slate-200">
            <div className="rounded-2xl bg-black/70 px-5 py-4 backdrop-blur">
              {error ? (
                <div className="space-y-3">
                  <p>{error}</p>
                  <button onClick={startCamera} className="btn btn-primary w-full">다시 시도</button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                  <span>{cameraNote || '카메라 연결 중입니다...'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {status === 'ready' && !videoReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-slate-200 text-sm text-center px-4 bg-black/25">
            <div className="rounded-xl bg-black/75 px-4 py-3 backdrop-blur">
              <div className="mx-auto mb-2 h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
              <p>{cameraNote || '카메라 영상 준비 중입니다...'}</p>
            </div>
          </div>
        )}

        {status === 'recording' && (
          <div className="absolute top-[max(74px,calc(env(safe-area-inset-top)+64px))] left-1/2 z-10 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 backdrop-blur">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-sm font-bold text-white">{mmss}</span>
            <span className="font-mono text-xs font-bold text-white/55">/ {maxTimeLabel}</span>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 z-10 space-y-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {(status === 'ready' || status === 'recording') && miniToolPanel}

          {status === 'ready' && (
            <button onClick={startRec} className="w-full rounded-xl bg-red-500 py-4 text-base font-black text-white shadow-lg active:scale-95 transition-transform">
              {videoReady ? '녹화 시작' : '준비 확인 후 녹화 시작'}
            </button>
          )}
          {status === 'recording' && (
            <button onClick={stopRec} className="w-full rounded-xl bg-white py-4 text-base font-black text-slate-950 shadow-lg active:scale-95 transition-transform">
              녹화 정지
            </button>
          )}

          <p className="text-center text-[11px] leading-relaxed text-white/70">
            {QUALITY_PRESETS[quality].label} 화질({QUALITY_PRESETS[quality].hint}) · {aspect} 비율로 저장됩니다. 화면을 탭하면 초점을 다시 잡고, 최대 {MAX_RECORD_SECONDS}초까지 자동 저장됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">일반 영상 녹화</h2>
        <span className="w-12" />
      </div>

      <div className="space-y-4 animate-fade-in">
        <div className="rounded-2xl overflow-hidden bg-black">
          <video src={videoUrl} controls playsInline className="w-full" style={{ maxHeight: '60vh' }} />
        </div>
        <div className="rounded-xl bg-slate-800 px-3 py-2 text-center text-xs text-slate-300">
          <span className="font-mono font-bold text-slate-100">{savedFileName}</span>
          <span className="text-slate-500"> · {aspect} · {savedSize || '크기 확인 중'}</span>
        </div>
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/25 px-3 py-2 text-center text-xs text-amber-100">
          {autoSaveState === 'saving'
            ? '자동 저장 중입니다...'
            : autoSaveState === 'blocked'
              ? '브라우저가 자동 저장을 막았습니다. 아래 버튼으로 다시 저장해 주세요.'
              : '자동 저장을 시도했습니다. 휴대폰 다운로드 폴더를 확인해 주세요.'}
        </div>
        <div className={`grid ${autoSaveState === 'blocked' ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
          <button onClick={reset}
            className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black py-3 text-sm active:scale-[0.98] shadow-lg shadow-amber-500/25">
            ● 다시 녹화 (즉시)
          </button>
          {autoSaveState === 'blocked' && (
            <button onClick={retryAutoSave} className="btn btn-primary">
              자동 저장 다시 시도
            </button>
          )}
        </div>
        {shareSupported && (
          <button onClick={saveToGallery} className="block w-full text-center text-[11px] text-slate-400 underline">
            휴대폰 저장/공유 열기
          </button>
        )}
        <p className="text-[11px] text-slate-500 text-center leading-relaxed">
          카메라는 켜진 채 유지됩니다 — '다시 녹화'를 누르면 재연결 없이 바로 촬영이 이어집니다. 파일명은 촬영마다 시각으로 달라져 카톡 전송 시 겹치지 않습니다.
        </p>
      </div>
    </div>
  );
}

function InlineStopwatch({ elapsed, running, onElapsedChange, onRunningChange }) {
  const startRef = useRef(0);
  const accRef = useRef(0);
  const rafRef = useRef(null);

  const tick = useCallback(() => {
    onElapsedChange(accRef.current + (performance.now() - startRef.current));
    rafRef.current = requestAnimationFrame(tick);
  }, [onElapsedChange]);

  const toggle = () => {
    if (running) {
      accRef.current += performance.now() - startRef.current;
      cancelAnimationFrame(rafRef.current);
      onRunningChange(false);
      return;
    }
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    onRunningChange(true);
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    accRef.current = 0;
    onElapsedChange(0);
    onRunningChange(false);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const text = formatStopwatch(elapsed);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-xl bg-black/20 px-3 py-2 text-center font-mono text-3xl font-black tabular-nums text-amber-300">
        {text}
      </div>
      <button onClick={toggle} className={`h-11 w-16 rounded-xl text-xs font-black ${running ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>
        {running ? '정지' : '시작'}
      </button>
      <button onClick={reset} className="h-11 w-14 rounded-xl border border-white/15 text-xs font-bold text-white/75">
        리셋
      </button>
    </div>
  );
}

function InlineMetronome({ bpm, playing, onBpmChange, onPlayingChange }) {
  const ctxRef = useRef(null);
  const nextNoteRef = useRef(0);
  const timerRef = useRef(null);
  const beatRef = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    onPlayingChange(false);
  }, [onPlayingChange]);

  const start = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    nextNoteRef.current = ctx.currentTime + 0.05;
    beatRef.current = 0;
    timerRef.current = setInterval(() => {
      const secPerBeat = 60 / bpm;
      while (nextNoteRef.current < ctx.currentTime + 0.1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const down = beatRef.current % 4 === 0;
        osc.frequency.value = down ? 1500 : 1000;
        gain.gain.setValueAtTime(boostedGain(down ? 0.45 : 0.25), nextNoteRef.current);
        gain.gain.exponentialRampToValueAtTime(0.001, nextNoteRef.current + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(nextNoteRef.current);
        osc.stop(nextNoteRef.current + 0.05);
        nextNoteRef.current += secPerBeat;
        beatRef.current += 1;
      }
    }, 25);
    onPlayingChange(true);
  }, [bpm, onPlayingChange]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch (e) { /* noop */ }
      ctxRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    stop();
    start();
  }, [bpm, playing, start, stop]);

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onBpmChange(Math.max(40, bpm - 5))} className="h-11 w-12 rounded-xl border border-white/15 text-sm font-black text-white/75">-5</button>
      <div className="flex-1 rounded-xl bg-black/20 px-3 py-2 text-center font-mono text-3xl font-black text-amber-300">
        {bpm}<span className="text-sm text-white/45"> BPM</span>
      </div>
      <button onClick={() => onBpmChange(Math.min(220, bpm + 5))} className="h-11 w-12 rounded-xl border border-white/15 text-sm font-black text-white/75">+5</button>
      <button onClick={playing ? stop : start} className={`h-11 w-16 rounded-xl text-xs font-black ${playing ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>
        {playing ? '정지' : '시작'}
      </button>
    </div>
  );
}

// 녹화 중 미니 패널용 인터벌 타이머. 진행 상태는 부모 stateRef 에 저장되어
// 다른 탭(초시계/메트로놈)으로 갔다 와도 카운트가 유지된다.
function InlineInterval({ stateRef, onChange }) {
  const rafRef = useRef(null);
  const ctxRef = useRef(null);
  const lastTickRef = useRef(-1);

  const beep = useCallback((tone) => {
    try {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const blips =
        tone === 'work' ? [[880, 0], [1320, 0.12]]
          : tone === 'rest' ? [[660, 0]]
            : tone === 'done' ? [[660, 0], [880, 0.15], [1180, 0.3]]
              : [[1000, 0]];
      for (const [freq, t] of blips) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        const dur = tone === 'count' ? 0.06 : 0.12;
        g.gain.setValueAtTime(boostedGain(0.4), now + t);
        g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + t);
        o.stop(now + t + dur);
      }
    } catch (e) { /* noop */ }
  }, []);

  const secFor = (s, ph) => phaseDurationSec(s, ph);

  const enterPhase = useCallback((ph, rnd) => {
    const s = stateRef.current;
    s.phase = ph;
    s.round = rnd;
    s.endAt = performance.now() + secFor(s, ph) * 1000;
    if (ph === 'work') beep('work');
    else if (ph === 'rest') beep('rest');
  }, [stateRef, beep]);

  const finish = useCallback(() => {
    const s = stateRef.current;
    cancelAnimationFrame(rafRef.current);
    s.running = false;
    s.phase = 'done';
    beep('done');
    onChange();
  }, [stateRef, beep, onChange]);

  const advance = useCallback(() => {
    const s = stateRef.current;
    const nxt = nextPhase(s, { phase: s.phase, round: s.round });
    if (nxt.phase === 'done') { finish(); return; }
    enterPhase(nxt.phase, nxt.round);
  }, [stateRef, enterPhase, finish]);

  const tick = useCallback(() => {
    const s = stateRef.current;
    const left = s.endAt - performance.now();
    const leftSec = Math.ceil(left / 1000);
    if (left > 0 && leftSec <= 3 && leftSec !== lastTickRef.current) {
      lastTickRef.current = leftSec;
      beep('count');
    }
    if (left <= 0) {
      lastTickRef.current = -1;
      advance();
      onChange();
      if (s.phase !== 'done') rafRef.current = requestAnimationFrame(tick);
      return;
    }
    onChange();
    rafRef.current = requestAnimationFrame(tick);
  }, [stateRef, beep, advance, onChange]);

  // 패널이 떠 있는 동안 진행 중이면 루프를 이어붙인다(탭 복귀 시 재개).
  useEffect(() => {
    const s = stateRef.current;
    if (s.running && s.phase !== 'idle' && s.phase !== 'done') {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [stateRef, tick]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (ctxRef.current) { try { ctxRef.current.close(); } catch (e) { /* noop */ } }
  }, []);

  const s = stateRef.current;
  const startPause = () => {
    if (s.running) {
      cancelAnimationFrame(rafRef.current);
      s.running = false;
      // 남은 시간 보존: endAt 을 남은 ms 로 환산해 둔다
      s.remainAt = s.endAt - performance.now();
      onChange();
      return;
    }
    if (s.phase === 'idle' || s.phase === 'done') {
      const f = firstPhase(s);
      enterPhase(f.phase, f.round);
    } else if (s.remainAt != null) {
      s.endAt = performance.now() + s.remainAt;
    }
    s.running = true;
    rafRef.current = requestAnimationFrame(tick);
    onChange();
  };
  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    s.phase = 'idle';
    s.round = 1;
    s.running = false;
    lastTickRef.current = -1;
    onChange();
  };
  const setField = (key, val, min, max) => {
    s[key] = Math.max(min, Math.min(max, Number(val) || 0));
    onChange();
  };

  const left = s.running || s.phase !== 'idle' ? Math.max(0, s.endAt - performance.now()) : 0;
  const showSec = s.phase === 'idle' ? 0 : Math.ceil(left / 1000);
  const mm = Math.floor(showSec / 60), ss = showSec % 60;
  const phaseLabel = s.phase === 'prepare' ? '준비' : s.phase === 'work' ? '운동' : s.phase === 'rest' ? '휴식' : s.phase === 'done' ? '완료' : '대기';
  const phaseColor = s.phase === 'work' ? 'text-emerald-300' : s.phase === 'rest' ? 'text-sky-300' : s.phase === 'prepare' ? 'text-amber-300' : 'text-white/70';
  const bigTime = s.phase === 'idle' ? '--:--' : s.phase === 'done' ? '완료!' : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  if (s.phase === 'idle') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1">
          {[
            ['운동', 'workSec', 1, 599],
            ['휴식', 'restSec', 0, 599],
            ['회', 'rounds', 1, 99],
            ['준비', 'prepSec', 0, 60],
          ].map(([label, key, min, max]) => (
            <div key={key} className="flex flex-col items-center">
              <span className="text-[9px] text-white/50">{label}</span>
              <input
                type="number" value={s[key]} min={min} max={max}
                onChange={(e) => setField(key, e.target.value, min, max)}
                className="w-full bg-black/25 border border-white/15 text-white rounded-lg px-1 py-1 text-center text-sm font-mono"
              />
            </div>
          ))}
        </div>
        <button onClick={startPause} className="w-full rounded-xl bg-amber-500/90 py-2 text-xs font-black text-slate-950">시작</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-xl bg-black/20 px-3 py-1.5 text-center">
        <p className={`text-[10px] font-bold ${phaseColor}`}>
          {phaseLabel}{(s.phase === 'work' || s.phase === 'rest') && <span className="text-white/45"> · {s.round}/{s.rounds}</span>}
        </p>
        <p className={`font-mono text-2xl font-black tabular-nums ${phaseColor}`}>{bigTime}</p>
      </div>
      <button onClick={startPause} className={`h-11 w-16 rounded-xl text-xs font-black ${s.running ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>
        {s.running ? '정지' : (s.phase === 'done' ? '시작' : '계속')}
      </button>
      <button onClick={reset} className="h-11 w-14 rounded-xl border border-white/15 text-xs font-bold text-white/75">리셋</button>
    </div>
  );
}
