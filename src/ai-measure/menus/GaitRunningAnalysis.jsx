// ai-measure/menus/GaitRunningAnalysis.jsx
// 보행 & 러닝 분석 (Gait & Running Analysis)
// RecordMeasure.jsx 를 계승·확장한 하체 집중 분석 전용 컴포넌트.
//
// Props:
//   member: { id, name }
//   onBack: () => void
//   onSaveToFirebase: (reportData) => Promise<void>
//
// 핵심:
//  1) 모바일/태블릿 무결점 로컬 다운로드(MIME↔확장자 매핑, iOS 폴백, 메모리 즉시 해제)
//  2) 영상은 기기에만, 정량 JSON 만 Firebase 로 (로딩 UI 포함)
//  3) DeviceOrientation 자이로 가이드 + 이동평균 필터 + 가변 FPS 주기 판별
//  4) 0.25/0.5/1x 배속 플레이어 + 각도 HUD + 결과 리포트 대시보드
//  5) iOS 자이로 권한, playsInline/muted/autoPlay, 반응형 2단 그리드, 언마운트 정리
import { useRef, useState, useEffect, useCallback } from 'react';
import { openMainCameraStream } from '../core/cameraSelect';
import { drawRecordingHud, formatStopwatch } from '../core/recordingOverlay';
import { drawGaitGuides } from '../core/gaitGuide';
import {
  jointAnglesFromPose,
  emptyAngles,
  GaitCycleTracker,
  AngleAccumulator,
  supportFootY,
  fmtAngle,
} from '../core/gaitBiomechanics';

const PREFERRED_FPS = 60;
const RECORD_FPS = 60;
const VIDEO_BITS_PER_SECOND = 16_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;
const SMOOTH_WINDOW = 5; // 이동평균 윈도우

const OUTPUT_SIZE = {
  side: { width: 1080, height: 1920 },
  back: { width: 1080, height: 1620 },
};

const VIEW_OPTIONS = [
  { id: 'side', label: '측면', hint: '관절 각도·오버스트라이드' },
  { id: 'back', label: '후면', hint: '골반 드롭·무릎 흔들림' },
];
const ENV_OPTIONS = [
  { id: 'treadmill', label: '트레드밀' },
  { id: 'floor', label: '바닥' },
];
const SPEEDS = [0.25, 0.5, 1];

/* ───────── 로컬 저장 유틸 (모바일/태블릿 방어) ───────── */

// MIME → 확장자 동적 매핑. 갤러리 재생 호환 위해 실제 코덱과 확장자를 일치시킴.
function extForMime(mime = '') {
  const m = mime.toLowerCase();
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  if (m.includes('ogg')) return 'ogv';
  return 'webm';
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
  return choices.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function pad2(n) { return String(n).padStart(2, '0'); }

// [회원이름]_보행분석_[YYYYMMDD_HHMM].[확장자]
function buildFileName(memberName, mime) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const safe = (memberName || 'member').replace(/[\\/:*?"<>|\s]/g, '_');
  return `${safe}_보행분석_${stamp}.${extForMime(mime)}`;
}

// iOS Safari/Android 무결점 다운로드: a 태그 표준 트리거 + 즉시 메모리 해제.
function triggerLocalDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // RAM 다운 방지: 트리거 직후 정리 + 100ms 후 URL 해제
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (e) { /* noop */ }
    URL.revokeObjectURL(url);
  }, 100);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)}MB`;
}

function waitForVideoReady(video, timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!video) return resolve(false);
    if (video.videoWidth > 0 && video.readyState >= 2) return resolve(true);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ['loadedmetadata', 'canplay', 'playing'].forEach((e) => video.removeEventListener(e, onReady));
      resolve(ok);
    };
    const onReady = () => { if (video.videoWidth > 0 && video.readyState >= 2) finish(true); };
    const timer = setTimeout(() => finish(video.videoWidth > 0), timeoutMs);
    ['loadedmetadata', 'canplay', 'playing'].forEach((e) => video.addEventListener(e, onReady));
    video.play().then(onReady).catch(() => {});
  });
}

function drawCover(ctx, video, width, height) {
  const sw0 = video.videoWidth;
  const sh0 = video.videoHeight;
  if (!sw0 || !sh0) return false;
  const sr = sw0 / sh0;
  const tr = width / height;
  let sx = 0, sy = 0, sw = sw0, sh = sh0;
  if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
  else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return true;
}

// ── 포즈 백엔드 PLACEHOLDER (MediaPipe 연동 지점) ──
// 반환 규약: { landmarks: Array<{x,y,z?,visibility?}> } | null  (0~1 정규화, 33점)
async function detectPoseFrame(/* video, timestampMs */) {
  return null;
}

export default function GaitRunningAnalysis({ member, onBack, onSaveToFirebase, onSave }) {
  // 사양상 prop 은 onSaveToFirebase. 기존 허브(AiMeasureHub)는 onSave 를 넘기므로 폴백.
  const saveToFirebase = onSaveToFirebase || onSave;
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
  const analyzeRafRef = useRef(null);
  const startTsRef = useRef(0);
  const timerRef = useRef(null);
  const overlayStateRef = useRef({});
  const optsRef = useRef({ view: 'side', env: 'floor', tilt: null });
  const tiltRef = useRef(null);
  const cycleRef = useRef(new GaitCycleTracker({ windowSize: SMOOTH_WINDOW }));
  const angleAccRef = useRef(new AngleAccumulator());
  const snapsRef = useRef([]); // 주요 구간 스냅샷(dataURL)

  const [status, setStatus] = useState('idle'); // idle|ready|recording|done
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [view, setView] = useState('side');
  const [env, setEnv] = useState('floor');
  const [toolTab, setToolTab] = useState('metronome');
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [metronomeBpm, setMetronomeBpm] = useState(160);
  const [metronomePlaying, setMetronomePlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [cameraNote, setCameraNote] = useState('');
  const [savedSize, setSavedSize] = useState('');
  const [appliedFps, setAppliedFps] = useState(null);
  const [poseReady, setPoseReady] = useState(false);
  const [gyroOn, setGyroOn] = useState(false);

  const [angles, setAngles] = useState(emptyAngles());
  const [gait, setGait] = useState({ cadenceSpm: 0, phase: 'unknown', stancePct: 0, swingPct: 0, stepCount: 0, cycleMs: 0 });

  // 리포트
  const [report, setReport] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error

  useEffect(() => { optsRef.current = { view, env, tilt: tiltRef.current }; }, [view, env]);

  useEffect(() => {
    overlayStateRef.current = {
      toolTab, stopwatchElapsed, stopwatchRunning,
      metronomeBpm, metronomePlaying, recordingElapsed: elapsed,
    };
  }, [toolTab, stopwatchElapsed, stopwatchRunning, metronomeBpm, metronomePlaying, elapsed]);

  /* ── 자이로(DeviceOrientation) ── */
  const onOrientation = useCallback((e) => {
    tiltRef.current = { beta: e.beta, gamma: e.gamma };
    optsRef.current = { ...optsRef.current, tilt: tiltRef.current };
  }, []);

  const enableGyro = useCallback(async () => {
    try {
      const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission(); // iOS 13+ 사용자 인터랙션 필요
        if (res !== 'granted') { setGyroOn(false); return; }
      }
      window.addEventListener('deviceorientation', onOrientation, true);
      setGyroOn(true);
    } catch (e) {
      setGyroOn(false);
    }
  }, [onOrientation]);

  const disableGyro = useCallback(() => {
    window.removeEventListener('deviceorientation', onOrientation, true);
    tiltRef.current = null;
    setGyroOn(false);
  }, [onOrientation]);

  /* ── 루프 ── */
  const drawLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = guideCanvasRef.current;
    if (video && canvas && video.videoWidth) {
      const box = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width || 720));
      const height = Math.max(1, Math.round(box.height || 1280));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      drawGaitGuides(ctx, width, height, { ...optsRef.current, tilt: tiltRef.current });
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const analyzeLoop = useCallback(async () => {
    const video = videoRef.current;
    if (video && video.videoWidth) {
      try {
        const ts = performance.now();
        const result = await detectPoseFrame(video, ts);
        if (result?.landmarks) {
          if (!poseReady) setPoseReady(true);
          const a = jointAnglesFromPose(result.landmarks);
          setAngles(a);
          if (status === 'recording') angleAccRef.current.push(a);
          const fy = supportFootY(result.landmarks);
          if (fy != null) {
            const snap = cycleRef.current.push(fy, ts);
            setGait(snap);
          }
        }
      } catch (e) { /* 분석 실패는 녹화에 영향 없음 */ }
    }
    analyzeRafRef.current = requestAnimationFrame(() => analyzeLoop());
  }, [poseReady, status]);

  const attachPreview = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    await video.play().catch(() => {});
  }, []);

  const stopLoop = (ref) => { if (ref.current) cancelAnimationFrame(ref.current); ref.current = null; };
  const stopStream = () => { if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  const stopRecordStream = () => { if (recordStreamRef.current) recordStreamRef.current.getTracks().forEach((t) => t.stop()); recordStreamRef.current = null; };

  const readAppliedFps = () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    const fps = track?.getSettings?.().frameRate;
    if (fps) setAppliedFps(Math.round(fps));
  };

  const startCamera = async () => {
    setError(null);
    setVideoReady(false);
    setCameraNote('카메라 연결 중입니다... (고프레임 요청)');
    setStatus('idle');
    cycleRef.current.reset();
    angleAccRef.current.reset();
    snapsRef.current = [];
    try {
      stopLoop(rafRef); stopLoop(analyzeRafRef); stopStream();
      const stream = await openMainCameraStream({ audio: true, preferExactDevice: true });
      streamRef.current = stream;
      const vt = stream.getVideoTracks()[0];
      if (vt?.applyConstraints) {
        try { await vt.applyConstraints({ frameRate: { ideal: PREFERRED_FPS, min: 30 } }); } catch (e) { /* 기기 한계 무시 */ }
      }
      await attachPreview();
      const ready = await waitForVideoReady(videoRef.current);
      readAppliedFps();
      setVideoReady(ready);
      setCameraNote(ready ? '' : '카메라 영상 준비가 늦습니다. 녹화 시작을 누르면 한 번 더 확인합니다.');
      setStatus('ready');
      rafRef.current = requestAnimationFrame(drawLoop);
      analyzeRafRef.current = requestAnimationFrame(() => analyzeLoop());
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
    return waitForVideoReady(videoRef.current, 7000);
  };

  const captureSnapshot = () => {
    const canvas = recordCanvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      snapsRef.current.push({ t: Date.now(), img: dataUrl });
      if (snapsRef.current.length > 6) snapsRef.current.shift();
    } catch (e) { /* tainted canvas 등 무시 */ }
  };

  const createRecordedStream = () => {
    const video = videoRef.current;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    const size = OUTPUT_SIZE[view] || OUTPUT_SIZE.side;
    canvas.width = size.width;
    canvas.height = size.height;
    recordCanvasRef.current = canvas;

    const ctx = canvas.getContext('2d', { alpha: false });
    let frame = 0;
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCover(ctx, video, canvas.width, canvas.height);
      drawGaitGuides(ctx, canvas.width, canvas.height, { view, env, tilt: tiltRef.current });
      drawRecordingHud(ctx, canvas.width, canvas.height, overlayStateRef.current);
      // 약 1초마다 구간 스냅샷
      if (frame % RECORD_FPS === 0) captureSnapshot();
      frame += 1;
      composeRafRef.current = requestAnimationFrame(draw);
    };
    stopLoop(composeRafRef);
    draw();

    const canvasStream = canvas.captureStream ? canvas.captureStream(RECORD_FPS) : null;
    if (!canvasStream) return streamRef.current;
    const mixed = new MediaStream();
    canvasStream.getVideoTracks().forEach((t) => mixed.addTrack(t));
    streamRef.current?.getAudioTracks().forEach((t) => mixed.addTrack(t));
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
      cycleRef.current.reset();
      angleAccRef.current.reset();
      snapsRef.current = [];

      chunksRef.current = [];
      const mime = pickRecorderMime();
      mimeRef.current = mime || 'video/webm';
      const recordingStream = createRecordedStream();
      const rec = new MediaRecorder(recordingStream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });

      rec.ondataavailable = (ev) => { if (ev.data?.size > 0) chunksRef.current.push(ev.data); };
      rec.onerror = () => {
        stopLoop(composeRafRef); stopRecordStream();
        setError('녹화 중 오류가 발생했습니다. 카메라 권한과 저장 공간을 확인해 주세요.');
        setStatus('ready');
      };
      rec.onstop = () => {
        stopLoop(composeRafRef); stopRecordStream();
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        if (!chunksRef.current.length) {
          setError('녹화된 영상 데이터가 없습니다. 다시 촬영해 주세요.');
          setStatus('ready');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        blobRef.current = blob;
        setSavedSize(formatBytes(blob.size));
        const url = URL.createObjectURL(blob);
        setVideoUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
        buildReport();
        setStatus('done');
      };

      recorderRef.current = rec;
      startTsRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000)), 250);
      rec.start(1000);
      setStatus('recording');
    } catch (e) {
      stopLoop(composeRafRef); stopRecordStream();
      setError(e?.message || '녹화를 시작할 수 없습니다.');
    }
  };

  const stopRec = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // 정량 리포트 구성 (영상 제외, 가벼운 JSON)
  const buildReport = () => {
    const cyc = cycleRef.current.summary();
    const ang = angleAccRef.current.summary();
    const durationSec = Math.max(0, Math.round((Date.now() - startTsRef.current) / 1000));
    const data = {
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
      env: { view, surface: env, appliedFps: appliedFps || null, poseBackend: poseReady ? 'mediapipe' : 'none' },
      duration: { seconds: durationSec },
      cadence: { averageSpm: cyc.averageCadenceSpm, totalSteps: cyc.totalSteps },
      gaitCycle: { stancePct: cyc.stancePct, swingPct: cyc.swingPct, cycleMs: cyc.cycleMs },
      jointAngles: ang, // {hip:{avg,min,max,rom}, knee:{...}, ankle:{...}}
      note: poseReady ? null : '포즈 백엔드 미연결 — 각도/주기는 추정 placeholder 값입니다.',
    };
    setReport(data);
    setSnapshots(snapsRef.current.slice());
    setSaveState('idle');
  };

  const stopAll = useCallback(() => {
    stopLoop(rafRef); stopLoop(composeRafRef); stopLoop(analyzeRafRef);
    stopRecordStream();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch (e) { /* noop */ }
    }
    stopStream();
    disableGyro();
    setVideoReady(false);
  }, [disableGyro]);

  const reset = () => {
    setVideoUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    blobRef.current = null;
    setSavedSize('');
    setElapsed(0);
    setAngles(emptyAngles());
    setGait({ cadenceSpm: 0, phase: 'unknown', stancePct: 0, swingPct: 0, stepCount: 0, cycleMs: 0 });
    setReport(null);
    setSnapshots([]);
    setSaveState('idle');
    cycleRef.current.reset();
    angleAccRef.current.reset();
    snapsRef.current = [];
    setVideoReady(!!videoRef.current?.videoWidth);
    setStatus(streamRef.current ? 'ready' : 'idle');
    requestAnimationFrame(() => {
      attachPreview();
      if (streamRef.current) {
        rafRef.current = requestAnimationFrame(drawLoop);
        analyzeRafRef.current = requestAnimationFrame(() => analyzeLoop());
      }
    });
  };

  useEffect(() => {
    if (status === 'ready' || status === 'recording') attachPreview();
  }, [status, attachPreview]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const mark = () => setVideoReady(video.videoWidth > 0 && video.readyState >= 2);
    ['loadedmetadata', 'canplay', 'playing'].forEach((e) => video.addEventListener(e, mark));
    return () => ['loadedmetadata', 'canplay', 'playing'].forEach((e) => video.removeEventListener(e, mark));
  }, []);

  // 언마운트 정리
  useEffect(() => () => { stopAll(); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [stopAll, videoUrl]);

  /* ── 저장 동작 ── */
  const saveVideoToDevice = () => {
    const blob = blobRef.current;
    if (!blob) return;
    const fname = buildFileName(member?.name, mimeRef.current);
    triggerLocalDownload(blob, fname);
  };

  const saveRecordToFirebase = async () => {
    if (!report || typeof saveToFirebase !== "function") return;
    setSaving(true);
    setSaveState('saving');
    try {
      await saveToFirebase(report);
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
    } finally {
      setSaving(false);
    }
  };

  const mmss = `${pad2(Math.floor(elapsed / 60))}:${pad2(elapsed % 60)}`;

  /* ── 보조 도구 패널 ── */
  const miniToolPanel = (
    <section className="rounded-2xl bg-black/22 border border-white/10 backdrop-blur-sm px-3 py-2 text-white shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-black/25 p-0.5">
          {[['metronome', '메트로놈'], ['stopwatch', '초시계']].map(([key, label]) => (
            <button key={key} onClick={() => setToolTab(key)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold ${toolTab === key ? 'bg-amber-500/90 text-slate-950' : 'text-white/70'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={gyroOn ? disableGyro : enableGyro}
          className={`rounded-full px-3 py-1 text-[11px] font-bold ${gyroOn ? 'bg-emerald-500/90 text-slate-950' : 'bg-black/30 text-white/70'}`}>
          {gyroOn ? '수평계 ON' : '수평계 켜기'}
        </button>
      </div>
      {toolTab === 'stopwatch' ? (
        <InlineStopwatch elapsed={stopwatchElapsed} running={stopwatchRunning} onElapsedChange={setStopwatchElapsed} onRunningChange={setStopwatchRunning} />
      ) : (
        <InlineMetronome bpm={metronomeBpm} playing={metronomePlaying} onBpmChange={setMetronomeBpm} onPlayingChange={setMetronomePlaying} />
      )}
    </section>
  );

  const liveHud = (
    <div className="pointer-events-none absolute left-1/2 top-[max(116px,calc(env(safe-area-inset-top)+104px))] z-10 -translate-x-1/2 w-[min(94%,520px)]">
      <div className="rounded-2xl bg-black/55 px-3 py-2 backdrop-blur text-white">
        <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-white/60">
          <span>실시간 분석{poseReady ? '' : ' · 대기(포즈 미연결)'}</span>
          <span>{gait.phase === 'stance' ? '입각기' : gait.phase === 'swing' ? '유각기' : '—'}</span>
        </div>
        <AnglesRow angles={angles} />
        <div className="mt-1 grid grid-cols-3 gap-1 text-center">
          <MiniStat label="SPM" value={gait.cadenceSpm || '—'} />
          <MiniStat label="입각" value={gait.stancePct ? `${gait.stancePct}%` : '—'} />
          <MiniStat label="유각" value={gait.swingPct ? `${gait.swingPct}%` : '—'} />
        </div>
      </div>
    </div>
  );

  /* ── 녹화/프리뷰 화면 ── */
  if (status !== 'done') {
    return (
      <div className="fixed inset-0 z-[80] bg-black overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={guideCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />

        <div className="absolute left-0 right-0 top-0 z-10 px-3 pt-[max(12px,env(safe-area-inset-top))] space-y-2">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="rounded-full bg-black/55 px-3 py-2 text-sm font-bold text-white backdrop-blur">← 메뉴</button>
            <span className="rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-bold text-amber-300 backdrop-blur">
              🏃 {member?.name ? `${member.name} · ` : ''}보행 & 러닝{appliedFps ? ` · ${appliedFps}fps` : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <SegGroup label="뷰" options={VIEW_OPTIONS} value={view} onChange={setView} disabled={status === 'recording'} />
            <SegGroup label="환경" options={ENV_OPTIONS} value={env} onChange={setEnv} disabled={status === 'recording'} />
          </div>
        </div>

        {(status === 'ready' || status === 'recording') && liveHud}

        {status === 'idle' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-slate-200">
            <div className="rounded-2xl bg-black/70 px-5 py-4 backdrop-blur">
              {error || cameraNote || '하체(골반·무릎·발목)가 가이드 박스 안에 들어오도록 카메라를 시작하세요'}
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
          {status === 'idle' && <button onClick={startCamera} className="btn btn-primary w-full">카메라 시작</button>}
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
            {view === 'side' ? '측면: 진행 방향과 직각으로, 골반~발목이 박스에 꽉 차게.' : '후면: 정중선이 신체 중앙에 오도록, 좌우 흔들림을 관찰.'}
          </p>
        </div>
      </div>
    );
  }

  /* ── 결과: 플레이어 + 리포트 대시보드 ── */
  return (
    <GaitResultView
      member={member}
      videoUrl={videoUrl}
      savedSize={savedSize}
      view={view}
      env={env}
      angles={angles}
      gait={gait}
      report={report}
      snapshots={snapshots}
      poseReady={poseReady}
      saving={saving}
      saveState={saveState}
      canSaveFirebase={typeof saveToFirebase === "function"}
      onBack={onBack}
      onReset={reset}
      onSaveVideo={saveVideoToDevice}
      onSaveFirebase={saveRecordToFirebase}
    />
  );
}

/* ───────────────── 결과 화면 (플레이어 + 대시보드) ───────────────── */
function GaitResultView({
  member, videoUrl, savedSize, view, env, angles, gait, report, snapshots,
  poseReady, saving, saveState, canSaveFirebase,
  onBack, onReset, onSaveVideo, onSaveFirebase,
}) {
  const playerRef = useRef(null);
  const [speed, setSpeed] = useState(0.5);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => { const v = playerRef.current; if (v) v.playbackRate = speed; }, [speed]);

  const toggle = () => {
    const v = playerRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };
  const step = (frames) => {
    const v = playerRef.current;
    if (!v) return;
    v.pause(); setPlaying(false);
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + frames / 60));
  };

  const ja = report?.jointAngles || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">보행 & 러닝 분석</h2>
        <span className="w-12" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 animate-fade-in">
        {/* 좌: 플레이어 */}
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-black">
            <video
              ref={playerRef} src={videoUrl} playsInline muted autoPlay={false}
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime || 0)}
              onEnded={() => setPlaying(false)}
              className="w-full" style={{ maxHeight: '52vh' }}
            />
            <div className="pointer-events-none absolute left-2 top-2 right-2 flex justify-between gap-2">
              <div className="rounded-xl bg-black/55 px-2.5 py-1.5 backdrop-blur text-white text-[11px] font-bold">
                <div className="text-white/55 mb-0.5">관절 각도{poseReady ? '' : ' · 대기'}</div>
                <HudAngles angles={angles} />
              </div>
              <div className="rounded-xl bg-black/55 px-2.5 py-1.5 backdrop-blur text-white text-[11px] font-bold text-right">
                <div className="text-white/55 mb-0.5">{gait.phase === 'stance' ? '입각기' : gait.phase === 'swing' ? '유각기' : '주기'}</div>
                <div className="font-mono text-amber-300 text-sm">{gait.cadenceSpm || '—'}<span className="text-[9px] text-white/50"> SPM</span></div>
                <div className="text-[10px] text-white/70">입각 {gait.stancePct || '—'}% · 유각 {gait.swingPct || '—'}%</div>
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-amber-500/90 px-2 py-0.5 text-[11px] font-black text-slate-950">{speed}x</div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} className="h-11 flex-1 rounded-xl border border-slate-700 text-slate-200 text-xs font-bold">◀ 1프레임</button>
            <button onClick={toggle} className="h-11 w-20 rounded-xl bg-amber-500 text-slate-950 text-sm font-black">{playing ? '일시정지' : '재생'}</button>
            <button onClick={() => step(1)} className="h-11 flex-1 rounded-xl border border-slate-700 text-slate-200 text-xs font-bold">1프레임 ▶</button>
          </div>

          <div className="flex gap-1.5">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-black ${speed === s ? 'bg-amber-500 text-slate-950' : 'border border-slate-700 text-slate-300'}`}>
                {s}x
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <span>{t.toFixed(2)}s</span>
            <input type="range" min={0} max={dur || 0} step={0.01} value={t}
              onChange={(e) => { const v = playerRef.current; if (v) { v.currentTime = Number(e.target.value); v.pause(); setPlaying(false); } }}
              className="flex-1 accent-amber-500" />
            <span>{dur.toFixed(2)}s</span>
          </div>
        </div>

        {/* 우: 리포트 대시보드 */}
        <div className="space-y-3">
          {/* 요약 카드 */}
          <div className="grid grid-cols-3 gap-2">
            <SummaryCard label="평균 케이던스" value={report?.cadence?.averageSpm || '—'} unit="SPM" />
            <SummaryCard label="주기 시간" value={report?.gaitCycle?.cycleMs ? (report.gaitCycle.cycleMs / 1000).toFixed(2) : '—'} unit="초" />
            <SummaryCard label="입각:유각" value={report?.gaitCycle?.stancePct ? `${report.gaitCycle.stancePct}:${report.gaitCycle.swingPct}` : '—'} unit="%" />
          </div>

          {/* 각도 변화 선형 그래프 Placeholder */}
          <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="mb-2 text-xs font-bold text-slate-300">보행 주기별 관절 각도 변화</div>
            <AngleGraphPlaceholder ja={ja} ready={poseReady} />
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
              {[['hip', '고관절'], ['knee', '무릎'], ['ankle', '발목']].map(([k, ko]) => (
                <div key={k} className="rounded-lg bg-slate-800/60 px-1 py-1.5">
                  <div className="text-slate-400">{ko}</div>
                  <div className="font-mono text-amber-300 font-bold">{ja[k] ? `${ja[k].avg}°` : '—'}</div>
                  <div className="text-[9px] text-slate-500">ROM {ja[k] ? `${ja[k].rom}°` : '—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 스냅샷 그리드 */}
          <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="mb-2 text-xs font-bold text-slate-300">주요 구간 스냅샷</div>
            {snapshots.length ? (
              <div className="grid grid-cols-3 gap-2">
                {snapshots.map((s, i) => (
                  <img key={s.t} src={s.img} alt={`snap-${i}`} className="aspect-[3/4] w-full rounded-lg object-cover border border-slate-700" />
                ))}
              </div>
            ) : (
              <div className="rounded-lg bg-slate-800/50 py-6 text-center text-[11px] text-slate-500">스냅샷 없음</div>
            )}
          </div>

          {/* 저장 버튼 분리 */}
          <div className="space-y-2">
            <div className="rounded-xl bg-slate-800 px-3 py-2 text-center text-xs text-slate-300">
              {VIEW_OPTIONS.find((v) => v.id === view)?.label} · {ENV_OPTIONS.find((e) => e.id === env)?.label} · {savedSize || '—'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onSaveVideo} className="rounded-xl border border-slate-600 bg-slate-800 text-slate-100 font-bold py-3 text-sm">
                📥 영상 기기 저장
              </button>
              <button
                onClick={onSaveFirebase}
                disabled={!canSaveFirebase || saving || saveState === 'saved'}
                className="btn btn-primary disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving && <span className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />}
                {saveState === 'saved' ? '✓ 저장됨' : saving ? '저장 중...' : '💾 회차 기록 저장'}
              </button>
            </div>
            {saveState === 'error' && <p className="text-center text-[11px] text-red-400">저장에 실패했습니다. 네트워크를 확인하고 다시 시도하세요.</p>}
            {!canSaveFirebase && <p className="text-center text-[11px] text-slate-500">onSaveToFirebase 가 전달되지 않아 회차 저장이 비활성화되었습니다.</p>}
            <button onClick={onReset} className="w-full rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">다시 녹화</button>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              영상은 기기에만 저장되고, 회차 기록은 정량 데이터(JSON)만 서버에 저장됩니다.
              {!poseReady && ' 각도·주기는 MediaPipe 연동 후 실측값으로 채워집니다.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────── 작은 UI 조각 ───────────────── */
function SegGroup({ label, options, value, onChange, disabled }) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-black/55 p-1 backdrop-blur">
      <span className="px-1 text-[10px] font-bold text-white/45">{label}</span>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} disabled={disabled} title={o.hint}
          className={`rounded-lg px-3 py-1.5 text-xs font-black disabled:opacity-60 ${value === o.id ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-white/10 px-1 py-1">
      <div className="text-[9px] text-white/55">{label}</div>
      <div className="font-mono text-sm font-black text-amber-300">{value}</div>
    </div>
  );
}

function SummaryCard({ label, value, unit }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/50 px-2 py-3 text-center">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="font-mono text-xl font-black text-amber-300 leading-tight">{value}</div>
      <div className="text-[9px] text-slate-500">{unit}</div>
    </div>
  );
}

function AnglesRow({ angles }) {
  const cell = (side, j) => fmtAngle(angles?.[side]?.[j]);
  return (
    <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
      {[['hip', '고관절'], ['knee', '무릎'], ['ankle', '발목']].map(([j, ko]) => (
        <div key={j} className="rounded-lg bg-white/8 px-1 py-1">
          <div className="text-[9px] text-white/50">{ko}</div>
          <div className="font-mono text-amber-300 font-bold">L {cell('left', j)} · R {cell('right', j)}</div>
        </div>
      ))}
    </div>
  );
}

function HudAngles({ angles }) {
  return (
    <div className="space-y-0.5 font-mono text-amber-300">
      <div>고관절 L{fmtAngle(angles?.left?.hip)} R{fmtAngle(angles?.right?.hip)}</div>
      <div>무릎 &nbsp;L{fmtAngle(angles?.left?.knee)} R{fmtAngle(angles?.right?.knee)}</div>
      <div>발목 &nbsp;L{fmtAngle(angles?.left?.ankle)} R{fmtAngle(angles?.right?.ankle)}</div>
    </div>
  );
}

// 각도 변화 선형 그래프 Placeholder (실데이터 연결 전 정적 미리보기)
function AngleGraphPlaceholder({ ja, ready }) {
  const series = [
    { key: 'hip', color: '#f59e0b' },
    { key: 'knee', color: '#22d3ee' },
    { key: 'ankle', color: '#34d399' },
  ];
  const W = 280, H = 90, pad = 6;
  const wave = (phase, amp, mid) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const x = pad + (i / 40) * (W - pad * 2);
      const y = mid - amp * Math.sin((i / 40) * Math.PI * 2 + phase);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[90px]">
        <rect x="0" y="0" width={W} height={H} fill="rgba(15,23,42,0.4)" rx="6" />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad} x2={W - pad} y1={H * f} y2={H * f} stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
        ))}
        {series.map((s, i) => (
          <polyline key={s.key} points={wave(i * 1.1, 18 - i * 3, H / 2)} fill="none" stroke={s.color} strokeWidth="1.8" opacity={ready ? 0.95 : 0.4} />
        ))}
      </svg>
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-md bg-slate-900/80 px-2 py-1 text-[10px] text-slate-300">포즈 연동 시 실측 그래프 표시</span>
        </div>
      )}
    </div>
  );
}

/* ───────── 보조 도구 (RecordMeasure 계승) ───────── */
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
  const reset = () => { cancelAnimationFrame(rafRef.current); accRef.current = 0; onElapsedChange(0); onRunningChange(false); };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-xl bg-black/20 px-3 py-2 text-center font-mono text-3xl font-black tabular-nums text-amber-300">{formatStopwatch(elapsed)}</div>
      <button onClick={toggle} className={`h-11 w-16 rounded-xl text-xs font-black ${running ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>{running ? '정지' : '시작'}</button>
      <button onClick={reset} className="h-11 w-14 rounded-xl border border-white/15 text-xs font-bold text-white/75">리셋</button>
    </div>
  );
}

function InlineMetronome({ bpm, playing, onBpmChange, onPlayingChange }) {
  const ctxRef = useRef(null);
  const nextNoteRef = useRef(0);
  const timerRef = useRef(null);
  const beatRef = useRef(0);
  const stop = useCallback(() => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; onPlayingChange(false); }, [onPlayingChange]);
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
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(nextNoteRef.current); osc.stop(nextNoteRef.current + 0.05);
        nextNoteRef.current += secPerBeat; beatRef.current += 1;
      }
    }, 25);
    onPlayingChange(true);
  }, [bpm, onPlayingChange]);
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (ctxRef.current) { try { ctxRef.current.close(); } catch (e) { /* noop */ } ctxRef.current = null; }
  }, []);
  useEffect(() => { if (!playing) return; stop(); start(); }, [bpm, playing, start, stop]);
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onBpmChange(Math.max(40, bpm - 5))} className="h-11 w-12 rounded-xl border border-white/15 text-sm font-black text-white/75">-5</button>
      <div className="flex-1 rounded-xl bg-black/20 px-3 py-2 text-center font-mono text-3xl font-black text-amber-300">{bpm}<span className="text-sm text-white/45"> BPM</span></div>
      <button onClick={() => onBpmChange(Math.min(220, bpm + 5))} className="h-11 w-12 rounded-xl border border-white/15 text-sm font-black text-white/75">+5</button>
      <button onClick={playing ? stop : start} className={`h-11 w-16 rounded-xl text-xs font-black ${playing ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>{playing ? '정지' : '시작'}</button>
    </div>
  );
}
