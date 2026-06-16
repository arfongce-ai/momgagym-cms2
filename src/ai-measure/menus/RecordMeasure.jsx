// ai-measure/menus/RecordMeasure.jsx
// Menu 0: general video recording with camera preview, save/share, stopwatch,
// and metronome support during recording.
import { useRef, useState, useEffect, useCallback } from 'react';
import { todayYMD } from '../../utils/dates';
import { drawGuides } from '../core/cameraGuide';
import { openMainCameraStream } from '../core/cameraSelect';
import { Metronome, Stopwatch } from './TimerTool';

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

export default function RecordMeasure({ member, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const mimeRef = useRef('video/webm');
  const rafRef = useRef(null);
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

  const drawLoop = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (v && c && v.videoWidth) {
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      drawGuides(ctx, c.width, c.height);
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const attachPreview = useCallback(async () => {
    if (!videoRef.current || !streamRef.current) return;
    if (videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
    videoRef.current.muted = true;
    videoRef.current.setAttribute('playsinline', 'true');
    videoRef.current.setAttribute('webkit-playsinline', 'true');
    await videoRef.current.play().catch(() => {});
  }, []);

  const stopPreviewLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const stopStream = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
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
      setCameraNote(ready ? '' : '카메라 영상 준비가 늦습니다. 녹화 시작을 누르면 한 번 더 준비를 확인합니다.');
      setStatus('ready');
      rafRef.current = requestAnimationFrame(drawLoop);
    } catch (e) {
      setError(e?.message || '카메라를 열 수 없습니다. 권한을 허용했는지 확인하세요.');
      setCameraNote('');
      setStatus('idle');
    }
  };

  const startRec = async () => {
    if (!streamRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('이 브라우저에서는 영상 녹화를 지원하지 않습니다.');
      return;
    }

    try {
      setError(null);
      setCameraNote('카메라 영상을 확인하는 중입니다...');
      await attachPreview();
      let ready = await waitForVideoReady(videoRef.current, 5000);
      if (!ready) {
        // Some Android browsers open an audio+video stream but do not deliver a
        // first frame. Reopen video-only before giving up.
        stopStream();
        const stream = await openMainCameraStream({ audio: false, preferExactDevice: false });
        streamRef.current = stream;
        await attachPreview();
        ready = await waitForVideoReady(videoRef.current, 7000);
      }
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
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);

      rec.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = () => {
        setError('녹화 중 오류가 발생했습니다. 카메라 권한과 저장 공간을 확인해 주세요.');
        setStatus('ready');
      };
      rec.onstop = () => {
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
  const safeName = (member?.name || '영상').replace(/[\\/:*?"<>|]/g, '_');
  const fname = `몸가짐_측정영상_${safeName}_${todayYMD().replace(/-/g, '')}.${ext}`;
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

  const toolPanel = (
    <section className="card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black text-slate-100">촬영 보조 도구</p>
          <p className="text-[11px] text-slate-500">녹화 중에도 계속 사용할 수 있습니다.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-800 p-1 shrink-0">
          {[
            ['stopwatch', '초시계'],
            ['metronome', '메트로놈'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setToolTab(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${toolTab === key ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {toolTab === 'stopwatch' ? <Stopwatch compact /> : <Metronome compact />}
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">일반 영상 녹화</h2>
        <span className="w-12" />
      </div>

      {status !== 'done' ? (
        <>
          {status === 'ready' && (
            <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5 w-fit">
              {['3/4', '1/1'].map((r) => (
                <button
                  key={r}
                  onClick={() => setAspect(r)}
                  className={`px-3 py-1 rounded text-[11px] font-bold ${aspect === r ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}
                >
                  {r === '3/4' ? '3:4' : '1:1'}
                </button>
              ))}
            </div>
          )}

          <div className="measure-camera" style={{ aspectRatio: aspect.replace('/', ' / ') }}>
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            {status === 'idle' && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm text-center px-4">
                {error || cameraNote || '카메라를 시작하세요'}
              </div>
            )}
            {status === 'ready' && !videoReady && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-200 text-sm text-center px-4 bg-black/40">
                <div className="rounded-xl bg-black/70 px-4 py-3">
                  <div className="mx-auto mb-2 h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                  <p>{cameraNote || '카메라 영상 준비 중입니다...'}</p>
                </div>
              </div>
            )}
            {status === 'recording' && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 rounded-full px-3 py-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white font-mono font-bold text-sm">{mmss}</span>
              </div>
            )}
            {status === 'ready' && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[90%]">
                <button onClick={startRec} className="w-full rounded-xl bg-red-500 text-white font-black py-3 text-base shadow-lg active:scale-95 transition-transform">
                  {videoReady ? '녹화 시작' : '준비 확인 후 녹화 시작'}
                </button>
              </div>
            )}
            {status === 'recording' && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[90%]">
                <button onClick={stopRec} className="w-full rounded-xl bg-white text-slate-950 font-black py-3 text-base shadow-lg active:scale-95 transition-transform">
                  녹화 정지
                </button>
              </div>
            )}
          </div>

          {status === 'idle' && (
            <button onClick={startCamera} className="btn btn-primary w-full">
              카메라 시작
            </button>
          )}

          {toolPanel}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            카메라 또는 마이크 권한이 제한된 기기에서도 먼저 영상 촬영이 되도록 자동으로 폴백합니다. 녹화를 정지하면 바로 재생하고 저장할 수 있습니다.
          </p>
        </>
      ) : (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-2xl overflow-hidden bg-black">
            <video src={videoUrl} controls playsInline className="w-full" style={{ maxHeight: '60vh' }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={reset} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">
              다시 녹화
            </button>
            {shareSupported ? (
              <button onClick={saveToGallery} className="btn btn-primary">
                사진앱에 저장
              </button>
            ) : (
              <a href={videoUrl} download={fname} className="btn btn-primary">
                영상 다운로드
              </a>
            )}
          </div>
          {shareSupported && (
            <a href={videoUrl} download={fname} className="block text-center text-[11px] text-slate-400 underline">
              또는 파일로 다운로드
            </a>
          )}
          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            공유 창에서 사진 또는 갤러리를 선택하면 카메라 롤에 저장할 수 있습니다. 파일명은 몸가짐_측정영상으로 시작합니다.
          </p>
        </div>
      )}
    </div>
  );
}
