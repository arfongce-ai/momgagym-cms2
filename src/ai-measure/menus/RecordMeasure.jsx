// ai-measure/menus/RecordMeasure.jsx
// General video recording. Preview and saved video use the selected frame
// ratio, with a compact bitrate for faster KakaoTalk sharing.
import { useRef, useState, useEffect, useCallback } from 'react';
import { todayYMD } from '../../utils/dates';
import { drawGuides } from '../core/cameraGuide';
import { openMainCameraStream } from '../core/cameraSelect';

const RECORD_FPS = 24;
const VIDEO_BITS_PER_SECOND = 850_000;
const AUDIO_BITS_PER_SECOND = 64_000;

const OUTPUT_SIZE = {
  '3/4': { width: 540, height: 720 },
  '1/1': { width: 540, height: 540 },
};

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

export default function RecordMeasure({ member, onBack }) {
  const videoRef = useRef(null);
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

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [aspect, setAspect] = useState('3/4');
  const [toolTab, setToolTab] = useState('stopwatch');
  const [videoReady, setVideoReady] = useState(false);
  const [cameraNote, setCameraNote] = useState('');
  const [savedSize, setSavedSize] = useState('');

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
      drawGuides(ctx, width, height);
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

  const stopStream = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startCamera = async () => {
    setError(null);
    setVideoReady(false);
    setCameraNote('카메라 연결 중입니다...');
    setStatus('idle');
    try {
      stopPreviewLoop();
      stopStream();
      const stream = await openMainCameraStream({ audio: true, preferExactDevice: false });
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
    const stream = await openMainCameraStream({ audio: false, preferExactDevice: false });
    streamRef.current = stream;
    await attachPreview();
    ready = await waitForVideoReady(videoRef.current, 7000);
    return ready;
  };

  const createRecordedStream = () => {
    const video = videoRef.current;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    const size = OUTPUT_SIZE[aspect] || OUTPUT_SIZE['3/4'];
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
      const rec = new MediaRecorder(recordingStream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });

      rec.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };
      rec.onerror = () => {
        stopComposeLoop();
        stopRecordStream();
        setError('녹화 중 오류가 발생했습니다. 카메라 권한과 저장 공간을 확인해 주세요.');
        setStatus('ready');
      };
      rec.onstop = () => {
        stopComposeLoop();
        stopRecordStream();
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        if (!chunksRef.current.length) {
          setError('녹화된 영상 데이터가 없습니다. 다시 촬영해 주세요.');
          setStatus('ready');
          return;
        }
        const type = mimeRef.current;
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        setSavedSize(formatBytes(blob.size));
        const url = URL.createObjectURL(blob);
        setVideoUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
        setStatus('done');
      };

      recorderRef.current = rec;
      startTsRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000)), 250);
      rec.start(1000);
      setStatus('recording');
    } catch (e) {
      stopComposeLoop();
      stopRecordStream();
      setError(e?.message || '녹화를 시작할 수 없습니다.');
    }
  };

  const stopRec = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const stopAll = useCallback(() => {
    stopPreviewLoop();
    stopComposeLoop();
    stopRecordStream();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch (e) { /* noop */ }
    }
    stopStream();
    setVideoReady(false);
  }, []);

  const reset = () => {
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    blobRef.current = null;
    setSavedSize('');
    setElapsed(0);
    setVideoReady(!!videoRef.current?.videoWidth);
    setStatus(streamRef.current ? 'ready' : 'idle');
    requestAnimationFrame(() => {
      attachPreview();
      if (streamRef.current) rafRef.current = requestAnimationFrame(drawLoop);
    });
  };

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

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const ext = (mimeRef.current || '').includes('mp4') ? 'mp4' : 'webm';
  const safeName = (member?.name || 'video').replace(/[\\/:*?"<>|]/g, '_');
  const fname = `momgagym_record_${safeName}_${aspect.replace('/', 'x')}_${todayYMD().replace(/-/g, '')}.${ext}`;
  const shareSupported = typeof navigator !== 'undefined' && !!navigator.canShare;

  const saveToGallery = async () => {
    try {
      const blob = blobRef.current;
      if (!blob) return;
      const file = new File([blob], fname, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fname });
      } else {
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = fname;
        a.click();
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        alert('공유 창을 열 수 없습니다. 영상 다운로드로 저장해 주세요.');
      }
    }
  };

  const miniToolPanel = (
    <section className="rounded-2xl bg-black/22 border border-white/10 backdrop-blur-sm px-3 py-2 text-white shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-black/25 p-0.5">
          {[
            ['stopwatch', '초시계'],
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
        <InlineStopwatch />
      ) : (
        <InlineMetronome />
      )}
    </section>
  );

  if (status !== 'done') {
    return (
      <div className="fixed inset-0 z-[80] bg-black overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={guideCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />

        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
          <button onClick={onBack} className="rounded-full bg-black/55 px-3 py-2 text-sm font-bold text-white backdrop-blur">← 메뉴</button>
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
              {error || cameraNote || '카메라를 시작하세요'}
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
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 z-10 space-y-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {(status === 'ready' || status === 'recording') && miniToolPanel}

          {status === 'idle' && (
            <button onClick={startCamera} className="btn btn-primary w-full">
              카메라 시작
            </button>
          )}
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
            저장 영상은 {aspect} 비율로 꽉 차게 잘라 저장됩니다. 카카오톡 전송이 빠르도록 540px · 저용량으로 기록합니다.
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
          저장 완료: {aspect} · {savedSize || '저용량'} · 카카오톡 전송용 540px 영상
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={reset} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">
            다시 녹화
          </button>
          <a href={videoUrl} download={fname} className="btn btn-primary">
            영상 다운로드
          </a>
        </div>
        {shareSupported && (
          <button onClick={saveToGallery} className="block w-full text-center text-[11px] text-slate-400 underline">
            다운로드가 안 될 때만 공유/저장 열기
          </button>
        )}
        <p className="text-[11px] text-slate-500 text-center leading-relaxed">
          카카오톡 앱이 바로 공유에서 멈추는 기기가 있어, 먼저 영상 다운로드로 저장한 뒤 파일을 선택해 전송하는 방식을 권장합니다. 영상은 540px 저용량 파일로 저장됩니다.
        </p>
      </div>
    </div>
  );
}

function InlineStopwatch() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startRef = useRef(0);
  const accRef = useRef(0);
  const rafRef = useRef(null);

  const tick = useCallback(() => {
    setElapsed(accRef.current + (performance.now() - startRef.current));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const toggle = () => {
    if (running) {
      accRef.current += performance.now() - startRef.current;
      cancelAnimationFrame(rafRef.current);
      setRunning(false);
      return;
    }
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    setRunning(true);
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    accRef.current = 0;
    setElapsed(0);
    setRunning(false);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const cs = Math.floor((elapsed % 1000) / 10);
  const sec = Math.floor(elapsed / 1000) % 60;
  const min = Math.floor(elapsed / 60000);
  const text = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;

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

function InlineMetronome() {
  const [bpm, setBpm] = useState(100);
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef(null);
  const nextNoteRef = useRef(0);
  const timerRef = useRef(null);
  const beatRef = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
  }, []);

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
        gain.gain.setValueAtTime(down ? 0.45 : 0.25, nextNoteRef.current);
        gain.gain.exponentialRampToValueAtTime(0.001, nextNoteRef.current + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(nextNoteRef.current);
        osc.stop(nextNoteRef.current + 0.05);
        nextNoteRef.current += secPerBeat;
        beatRef.current += 1;
      }
    }, 25);
    setPlaying(true);
  }, [bpm]);

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
      <button onClick={() => setBpm((value) => Math.max(40, value - 5))} className="h-11 w-12 rounded-xl border border-white/15 text-sm font-black text-white/75">-5</button>
      <div className="flex-1 rounded-xl bg-black/20 px-3 py-2 text-center font-mono text-3xl font-black text-amber-300">
        {bpm}<span className="text-sm text-white/45"> BPM</span>
      </div>
      <button onClick={() => setBpm((value) => Math.min(220, value + 5))} className="h-11 w-12 rounded-xl border border-white/15 text-sm font-black text-white/75">+5</button>
      <button onClick={playing ? stop : start} className={`h-11 w-16 rounded-xl text-xs font-black ${playing ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>
        {playing ? '정지' : '시작'}
      </button>
    </div>
  );
}
