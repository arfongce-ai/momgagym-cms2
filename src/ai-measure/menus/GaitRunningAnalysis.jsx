// ai-measure/menus/GaitRunningAnalysis.jsx
// 보행 & 러닝 분석 (Gait & Running Analysis) — v2 현장 개선판
//
// 핵심 변경(현장 피드백 반영):
//  · 녹화 전/중: 분석 수치 전부 숨김. 타이틀 + 하체 정렬 가이드 + [녹화] 버튼만.
//    메트로놈/초시계는 좌측 하단 '컴팩트 모드'로만 노출(시야 비가림).
//  · 트레드밀/바닥 토글 완전 삭제 → 알고리즘이 환경 무관(고관절 원점 상대좌표).
//  · 분석 대시보드(각도·SPM·입각/유각)는 녹화 후 미리보기에서만 오버레이.
//  · 각도는 회전 불변(벡터 내적) → 손에 들고 기울여 찍어도 정확.
//
// Props: member:{id,name}, onBack:()=>void, onSaveToFirebase|onSave:(report)=>Promise
import { useRef, useState, useEffect, useCallback } from 'react';
import { openMainCameraStream } from '../core/cameraSelect';
import { drawRecordingHud, formatStopwatch } from '../core/recordingOverlay';
import { drawGaitGuides } from '../core/gaitGuide';
import {
  jointAnglesFromPose,
  emptyAngles,
  GaitCycleTracker,
  AngleAccumulator,
  hipRelativeFootMetric,
  fmtAngle,
} from '../core/gaitBiomechanics';

const PREFERRED_FPS = 60;
const RECORD_FPS = 60;
const VIDEO_BITS_PER_SECOND = 16_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;
const SMOOTH_WINDOW = 5;

// 세로 프레임. 환경 토글이 없어졌으므로 뷰(측면/후면)만 출력비에 영향.
const OUTPUT_SIZE = {
  side: { width: 1080, height: 1920 },
  back: { width: 1080, height: 1620 },
};
const VIEW_OPTIONS = [
  { id: 'side', label: '측면', hint: '관절 각도·오버스트라이드' },
  { id: 'back', label: '후면', hint: '골반 드롭·무릎 흔들림' },
];
const SPEEDS = [0.25, 0.5, 1];

/* ───────── 로컬 저장 유틸 (모바일/태블릿 방어) ───────── */
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
    'video/mp4;codecs=h264,aac', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  return choices.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
function pad2(n) { return String(n).padStart(2, '0'); }
function buildFileName(memberName, mime) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const safe = (memberName || 'member').replace(/[\\/:*?"<>|\s]/g, '_');
  return `${safe}_보행분석_${stamp}.${extForMime(mime)}`;
}
function triggerLocalDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
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
      if (done) return; done = true; clearTimeout(timer);
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
  const sw0 = video.videoWidth, sh0 = video.videoHeight;
  if (!sw0 || !sh0) return false;
  const sr = sw0 / sh0, tr = width / height;
  let sx = 0, sy = 0, sw = sw0, sh = sh0;
  if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
  else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return true;
}

// 포즈 백엔드 PLACEHOLDER (MediaPipe 연동 지점)
async function detectPoseFrame(/* video, ts */) { return null; }

export default function GaitRunningAnalysis({ member, onBack, onSaveToFirebase, onSave }) {
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
  const viewRef = useRef('side');
  const cycleRef = useRef(new GaitCycleTracker({ windowSize: SMOOTH_WINDOW }));
  const angleAccRef = useRef(new AngleAccumulator());
  const snapsRef = useRef([]);

  // view: 'camera' | 'recording' | 'preview'  (요구사항 상태 분리)
  const [view, setView] = useState('camera');
  const [camView, setCamView] = useState('side'); // 측면/후면 (환경 토글은 삭제됨)
  const [status, setStatus] = useState('idle');   // idle|ready (camera 단계 내부 상태)
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [toolTab, setToolTab] = useState('metronome');
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [metronomeBpm, setMetronomeBpm] = useState(160);
  const [metronomePlaying, setMetronomePlaying] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false); // 컴팩트 도구 펼침 여부
  const [videoReady, setVideoReady] = useState(false);
  const [cameraNote, setCameraNote] = useState('');
  const [savedSize, setSavedSize] = useState('');
  const [appliedFps, setAppliedFps] = useState(null);
  const [poseReady, setPoseReady] = useState(false);

  // 분석 데이터 (preview 에서만 표시)
  const [angles, setAngles] = useState(emptyAngles());
  const [gait, setGait] = useState({ cadenceSpm: 0, phase: 'unknown', stancePct: 0, swingPct: 0, stepCount: 0, cycleMs: 0 });
  const [report, setReport] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('idle');

  useEffect(() => { viewRef.current = camView; }, [camView]);
  useEffect(() => {
    overlayStateRef.current = {
      toolTab, stopwatchElapsed, stopwatchRunning,
      metronomeBpm, metronomePlaying, recordingElapsed: elapsed,
    };
  }, [toolTab, stopwatchElapsed, stopwatchRunning, metronomeBpm, metronomePlaying, elapsed]);

  /* ── 가이드 루프 ── */
  const drawLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = guideCanvasRef.current;
    if (video && canvas && video.videoWidth) {
      const box = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width || 720));
      const height = Math.max(1, Math.round(box.height || 1280));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      drawGaitGuides(ctx, width, height, { view: viewRef.current });
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  /* ── 분석 루프 (백그라운드 집계만; 화면엔 미표시) ── */
  const analyzeLoop = useCallback(async () => {
    const video = videoRef.current;
    if (video && video.videoWidth) {
      try {
        const ts = performance.now();
        const result = await detectPoseFrame(video, ts);
        if (result?.landmarks) {
          if (!poseReady) setPoseReady(true);
          const a = jointAnglesFromPose(result.landmarks);
          if (statusIsRecording()) {
            angleAccRef.current.push(a);
            const metric = hipRelativeFootMetric(result.landmarks);
            cycleRef.current.push(metric, ts);
          }
          // 녹화 중에는 setState 로 화면 갱신하지 않는다(클러터 방지·성능).
          // preview 진입 시 buildReport 가 최종 요약을 setState 한다.
        }
      } catch (e) { /* 분석 실패는 녹화에 영향 없음 */ }
    }
    analyzeRafRef.current = requestAnimationFrame(() => analyzeLoop());
  }, [poseReady]);

  const statusIsRecording = () => recorderRef.current && recorderRef.current.state === 'recording';

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
    setError(null); setVideoReady(false);
    setCameraNote('카메라 연결 중입니다... (고프레임 요청)');
    setStatus('idle');
    cycleRef.current.reset(); angleAccRef.current.reset(); snapsRef.current = [];
    try {
      stopLoop(rafRef); stopLoop(analyzeRafRef); stopStream();
      const stream = await openMainCameraStream({ audio: true, preferExactDevice: true });
      streamRef.current = stream;
      const vt = stream.getVideoTracks()[0];
      if (vt?.applyConstraints) {
        try { await vt.applyConstraints({ frameRate: { ideal: PREFERRED_FPS, min: 30 } }); } catch (e) { /* 기기 한계 */ }
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
      setCameraNote(''); setStatus('idle');
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
    } catch (e) { /* noop */ }
  };

  const createRecordedStream = () => {
    const video = videoRef.current;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    const size = OUTPUT_SIZE[camView] || OUTPUT_SIZE.side;
    canvas.width = size.width; canvas.height = size.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    let frame = 0;
    const draw = () => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCover(ctx, video, canvas.width, canvas.height);
      drawGaitGuides(ctx, canvas.width, canvas.height, { view: camView });
      drawRecordingHud(ctx, canvas.width, canvas.height, overlayStateRef.current);
      if (frame % RECORD_FPS === 0) captureSnapshot();
      frame += 1;
      composeRafRef.current = requestAnimationFrame(draw);
    };
    stopLoop(composeRafRef); draw();
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
    if (typeof MediaRecorder === 'undefined') { setError('이 브라우저에서는 영상 녹화를 지원하지 않습니다.'); return; }
    try {
      setError(null); setSavedSize('');
      setCameraNote('카메라 영상을 확인하는 중입니다...');
      const ready = await ensureVideoReady();
      setVideoReady(ready);
      if (!ready) {
        setCameraNote('');
        setError('카메라 화면이 아직 준비되지 않았습니다. 권한을 허용한 뒤 카메라 시작을 다시 눌러 주세요.');
        setStatus('idle'); stopStream(); return;
      }
      setCameraNote('');
      cycleRef.current.reset(); angleAccRef.current.reset(); snapsRef.current = [];

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
        setView('camera'); setStatus('ready');
      };
      rec.onstop = () => {
        stopLoop(composeRafRef); stopRecordStream();
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        if (!chunksRef.current.length) {
          setError('녹화된 영상 데이터가 없습니다. 다시 촬영해 주세요.');
          setView('camera'); setStatus('ready'); return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        blobRef.current = blob;
        setSavedSize(formatBytes(blob.size));
        const url = URL.createObjectURL(blob);
        setVideoUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
        buildReport();
        setView('preview'); // 🔵 분석 대시보드는 여기서부터
      };
      recorderRef.current = rec;
      startTsRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000)), 250);
      rec.start(1000);
      setView('recording');
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

  const buildReport = () => {
    const cyc = cycleRef.current.summary();
    const ang = angleAccRef.current.summary();
    const durationSec = Math.max(0, Math.round((Date.now() - startTsRef.current) / 1000));
    // 화면 표시용 스냅샷도 동기화
    setGait({
      cadenceSpm: cyc.averageCadenceSpm, phase: 'unknown',
      stancePct: cyc.stancePct, swingPct: cyc.swingPct,
      stepCount: cyc.totalSteps, cycleMs: cyc.cycleMs,
    });
    setAngles({
      left: {
        hip: ang.hip?.avg ?? null, knee: ang.knee?.avg ?? null, ankle: ang.ankle?.avg ?? null,
      },
      right: { hip: null, knee: null, ankle: null },
    });
    const data = {
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
      env: { view: camView, appliedFps: appliedFps || null, poseBackend: poseReady ? 'mediapipe' : 'none', algorithm: 'hip-relative-v2' },
      duration: { seconds: durationSec },
      cadence: { averageSpm: cyc.averageCadenceSpm, totalSteps: cyc.totalSteps },
      gaitCycle: { stancePct: cyc.stancePct, swingPct: cyc.swingPct, cycleMs: cyc.cycleMs },
      jointAngles: ang,
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
    stopStream(); setVideoReady(false);
  }, []);

  const reset = () => {
    setVideoUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    blobRef.current = null;
    setSavedSize(''); setElapsed(0);
    setAngles(emptyAngles());
    setGait({ cadenceSpm: 0, phase: 'unknown', stancePct: 0, swingPct: 0, stepCount: 0, cycleMs: 0 });
    setReport(null); setSnapshots([]); setSaveState('idle');
    cycleRef.current.reset(); angleAccRef.current.reset(); snapsRef.current = [];
    setVideoReady(!!videoRef.current?.videoWidth);
    setView('camera');
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
    if (view === 'camera' || view === 'recording') attachPreview();
  }, [view, attachPreview]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const mark = () => setVideoReady(video.videoWidth > 0 && video.readyState >= 2);
    ['loadedmetadata', 'canplay', 'playing'].forEach((e) => video.addEventListener(e, mark));
    return () => ['loadedmetadata', 'canplay', 'playing'].forEach((e) => video.removeEventListener(e, mark));
  }, []);

  useEffect(() => () => { stopAll(); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [stopAll, videoUrl]);

  const saveVideoToDevice = () => {
    const blob = blobRef.current;
    if (!blob) return;
    triggerLocalDownload(blob, buildFileName(member?.name, mimeRef.current));
  };
  const saveRecordToFirebase = async () => {
    if (!report || typeof saveToFirebase !== 'function') return;
    setSaving(true); setSaveState('saving');
    try { await saveToFirebase(report); setSaveState('saved'); }
    catch (e) { setSaveState('error'); }
    finally { setSaving(false); }
  };

  const mmss = `${pad2(Math.floor(elapsed / 60))}:${pad2(elapsed % 60)}`;
  const recording = view === 'recording';

  /* ════════════════ 🔵 상태 2: 미리보기/분석 대시보드 ════════════════ */
  if (view === 'preview') {
    return (
      <GaitResultView
        member={member} videoUrl={videoUrl} savedSize={savedSize} camView={camView}
        angles={angles} gait={gait} report={report} snapshots={snapshots}
        poseReady={poseReady} saving={saving} saveState={saveState}
        canSaveFirebase={typeof saveToFirebase === 'function'}
        onBack={onBack} onReset={reset} onSaveVideo={saveVideoToDevice} onSaveFirebase={saveRecordToFirebase}
      />
    );
  }

  /* ════════════════ 🔴 상태 1: 녹화 전/중 (클러터 제거) ════════════════ */
  return (
    <div className="fixed inset-0 z-[80] bg-black overflow-hidden">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <canvas ref={guideCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />

      {/* 상단: 타이틀만 (뒤로 + 측/후면) */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button onClick={onBack} className="rounded-full bg-black/50 px-3 py-2 text-sm font-bold text-white backdrop-blur">← 메뉴</button>
        <span className="rounded-full bg-black/50 px-3 py-1.5 text-[11px] font-bold text-amber-300 backdrop-blur">
          🏃 {member?.name ? `${member.name} · ` : ''}보행 & 러닝{appliedFps ? ` · ${appliedFps}fps` : ''}
        </span>
        <div className="flex gap-1 rounded-xl bg-black/50 p-1 backdrop-blur">
          {VIEW_OPTIONS.map((o) => (
            <button key={o.id} onClick={() => setCamView(o.id)} disabled={recording} title={o.hint}
              className={`rounded-lg px-2.5 py-1 text-xs font-black disabled:opacity-50 ${camView === o.id ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 녹화 타이머 (녹화 중에만, 상단 중앙 작게) */}
      {recording && (
        <div className="absolute top-[max(70px,calc(env(safe-area-inset-top)+60px))] left-1/2 z-10 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="font-mono text-sm font-bold text-white">{mmss}</span>
        </div>
      )}

      {/* 안내/로딩 (분석 수치 아님) */}
      {status === 'idle' && !recording && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-slate-200">
          <div className="rounded-2xl bg-black/65 px-5 py-4 backdrop-blur">
            {error || cameraNote || '하체(골반·무릎·발목)를 가이드 박스에 맞추고 카메라를 시작하세요'}
          </div>
        </div>
      )}
      {status === 'ready' && !videoReady && !recording && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-slate-200 text-sm text-center px-4 bg-black/20">
          <div className="rounded-xl bg-black/70 px-4 py-3 backdrop-blur">
            <div className="mx-auto mb-2 h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <p>{cameraNote || '카메라 영상 준비 중입니다...'}</p>
          </div>
        </div>
      )}

      {/* 💡 좌측 하단: 컴팩트 메트로놈/초시계 (시야 비가림) */}
      <CompactTools
        open={toolsOpen}
        onToggleOpen={() => setToolsOpen((v) => !v)}
        tab={toolTab}
        onTab={setToolTab}
        bpm={metronomeBpm} onBpm={setMetronomeBpm}
        metroPlaying={metronomePlaying} onMetroPlaying={setMetronomePlaying}
        swElapsed={stopwatchElapsed} swRunning={stopwatchRunning}
        onSwElapsed={setStopwatchElapsed} onSwRunning={setStopwatchRunning}
      />

      {/* 하단 중앙: 녹화 버튼만 크게 */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-[max(18px,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-sm">
          {status === 'idle' && !recording && (
            <button onClick={startCamera} className="btn btn-primary w-full">카메라 시작</button>
          )}
          {status === 'ready' && !recording && (
            <button onClick={startRec}
              className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white/80 bg-red-500 shadow-xl active:scale-95 transition-transform">
              <span className="h-7 w-7 rounded-md bg-white/0" />
              <span className="absolute h-6 w-6 rounded-full bg-white" />
            </button>
          )}
          {recording && (
            <button onClick={stopRec}
              className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white/80 bg-white shadow-xl active:scale-95 transition-transform">
              <span className="h-6 w-6 rounded-[4px] bg-red-500" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ 컴팩트 도구 (좌측 하단) ════════════════ */
function CompactTools({
  open, onToggleOpen, tab, onTab, bpm, onBpm, metroPlaying, onMetroPlaying,
  swElapsed, swRunning, onSwElapsed, onSwRunning,
}) {
  return (
    <div className="absolute bottom-[max(20px,env(safe-area-inset-bottom))] left-3 z-20 w-[168px]">
      {open && (
        <div className="mb-2 rounded-2xl bg-black/55 backdrop-blur border border-white/10 p-2 text-white shadow-lg">
          <div className="mb-2 flex gap-1 rounded-full bg-black/30 p-0.5">
            {[['metronome', '메트로놈'], ['stopwatch', '초시계']].map(([k, label]) => (
              <button key={k} onClick={() => onTab(k)}
                className={`flex-1 rounded-full px-2 py-1 text-[10px] font-bold ${tab === k ? 'bg-amber-500/90 text-slate-950' : 'text-white/70'}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'metronome'
            ? <CompactMetronome bpm={bpm} playing={metroPlaying} onBpm={onBpm} onPlaying={onMetroPlaying} />
            : <CompactStopwatch elapsed={swElapsed} running={swRunning} onElapsed={onSwElapsed} onRunning={onSwRunning} />}
        </div>
      )}
      {/* 토글 핸들: 닫혀 있어도 현재 BPM/재생 상태를 작게 표시 */}
      <button onClick={onToggleOpen}
        className="flex items-center gap-2 rounded-full bg-black/55 backdrop-blur border border-white/10 px-3 py-1.5 text-white shadow-lg">
        <span className={`h-2 w-2 rounded-full ${(metroPlaying || swRunning) ? 'bg-amber-400 animate-pulse' : 'bg-white/40'}`} />
        <span className="font-mono text-xs font-bold text-amber-300">
          {tab === 'metronome' ? `${bpm} BPM` : formatStopwatch(swElapsed)}
        </span>
        <span className="text-[10px] text-white/50">{open ? '▾' : '▴'}</span>
      </button>
    </div>
  );
}

function CompactMetronome({ bpm, playing, onBpm, onPlaying }) {
  const ctxRef = useRef(null);
  const nextNoteRef = useRef(0);
  const timerRef = useRef(null);
  const beatRef = useRef(0);
  const stop = useCallback(() => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; onPlaying(false); }, [onPlaying]);
  const start = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    nextNoteRef.current = ctx.currentTime + 0.05; beatRef.current = 0;
    timerRef.current = setInterval(() => {
      const spb = 60 / bpm;
      while (nextNoteRef.current < ctx.currentTime + 0.1) {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        const down = beatRef.current % 4 === 0;
        osc.frequency.value = down ? 1500 : 1000;
        gain.gain.setValueAtTime(down ? 0.45 : 0.25, nextNoteRef.current);
        gain.gain.exponentialRampToValueAtTime(0.001, nextNoteRef.current + 0.05);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(nextNoteRef.current); osc.stop(nextNoteRef.current + 0.05);
        nextNoteRef.current += spb; beatRef.current += 1;
      }
    }, 25);
    onPlaying(true);
  }, [bpm, onPlaying]);
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (ctxRef.current) { try { ctxRef.current.close(); } catch (e) { /* noop */ } ctxRef.current = null; }
  }, []);
  useEffect(() => { if (!playing) return; stop(); start(); }, [bpm, playing, start, stop]);
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onBpm(Math.max(40, bpm - 5))} className="h-9 w-8 rounded-lg border border-white/15 text-xs font-black text-white/75">−</button>
      <div className="flex-1 rounded-lg bg-black/25 py-1.5 text-center font-mono text-lg font-black text-amber-300">{bpm}</div>
      <button onClick={() => onBpm(Math.min(220, bpm + 5))} className="h-9 w-8 rounded-lg border border-white/15 text-xs font-black text-white/75">+</button>
      <button onClick={playing ? stop : start} className={`h-9 w-12 rounded-lg text-[11px] font-black ${playing ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>
        {playing ? '정지' : '시작'}
      </button>
    </div>
  );
}

function CompactStopwatch({ elapsed, running, onElapsed, onRunning }) {
  const startRef = useRef(0);
  const accRef = useRef(0);
  const rafRef = useRef(null);
  const tick = useCallback(() => { onElapsed(accRef.current + (performance.now() - startRef.current)); rafRef.current = requestAnimationFrame(tick); }, [onElapsed]);
  const toggle = () => {
    if (running) { accRef.current += performance.now() - startRef.current; cancelAnimationFrame(rafRef.current); onRunning(false); return; }
    startRef.current = performance.now(); rafRef.current = requestAnimationFrame(tick); onRunning(true);
  };
  const reset = () => { cancelAnimationFrame(rafRef.current); accRef.current = 0; onElapsed(0); onRunning(false); };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 rounded-lg bg-black/25 py-1.5 text-center font-mono text-base font-black tabular-nums text-amber-300">{formatStopwatch(elapsed)}</div>
      <button onClick={toggle} className={`h-9 w-12 rounded-lg text-[11px] font-black ${running ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>{running ? '정지' : '시작'}</button>
      <button onClick={reset} className="h-9 w-10 rounded-lg border border-white/15 text-[11px] font-bold text-white/75">리셋</button>
    </div>
  );
}

/* ════════════════ 결과 화면 (플레이어 + 대시보드) ════════════════ */
function GaitResultView({
  member, videoUrl, savedSize, camView, angles, gait, report, snapshots,
  poseReady, saving, saveState, canSaveFirebase,
  onBack, onReset, onSaveVideo, onSaveFirebase,
}) {
  const playerRef = useRef(null);
  const [speed, setSpeed] = useState(0.5);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => { const v = playerRef.current; if (v) v.playbackRate = speed; }, [speed]);
  const toggle = () => { const v = playerRef.current; if (!v) return; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };
  const step = (frames) => { const v = playerRef.current; if (!v) return; v.pause(); setPlaying(false); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + frames / 60)); };

  const ja = report?.jointAngles || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">보행 & 러닝 분석</h2>
        <span className="w-12" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 animate-fade-in">
        {/* 좌: 플레이어 + HUD */}
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-black">
            <video ref={playerRef} src={videoUrl} playsInline muted
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime || 0)}
              onEnded={() => setPlaying(false)}
              className="w-full" style={{ maxHeight: '54vh' }} />
            <div className="pointer-events-none absolute left-2 top-2 right-2 flex justify-between gap-2">
              <div className="rounded-xl bg-black/55 px-2.5 py-1.5 backdrop-blur text-white text-[11px] font-bold">
                <div className="text-white/55 mb-0.5">관절 각도{poseReady ? '' : ' · 대기'}</div>
                <HudAngles angles={angles} />
              </div>
              <div className="rounded-xl bg-black/55 px-2.5 py-1.5 backdrop-blur text-white text-[11px] font-bold text-right">
                <div className="text-white/55 mb-0.5">보행 주기</div>
                <div className="font-mono text-amber-300 text-sm">{gait.cadenceSpm || '—'}<span className="text-[9px] text-white/50"> SPM</span></div>
                <div className="text-[10px] text-white/70">입각 {gait.stancePct || '—'}% · 유각 {gait.swingPct || '—'}%</div>
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-amber-500/90 px-2 py-0.5 text-[11px] font-black text-slate-950">{speed}x</div>
          </div>

          {/* 재생 컨트롤 */}
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

        {/* 우: 대시보드 */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <SummaryCard label="평균 케이던스" value={report?.cadence?.averageSpm || '—'} unit="SPM" />
            <SummaryCard label="주기 시간" value={report?.gaitCycle?.cycleMs ? (report.gaitCycle.cycleMs / 1000).toFixed(2) : '—'} unit="초" />
            <SummaryCard label="입각:유각" value={report?.gaitCycle?.stancePct ? `${report.gaitCycle.stancePct}:${report.gaitCycle.swingPct}` : '—'} unit="%" />
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-3">
            <div className="mb-2 text-xs font-bold text-slate-300">관절 각도 (평균 · ROM)</div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              {[['hip', '고관절'], ['knee', '무릎'], ['ankle', '발목']].map(([k, ko]) => (
                <div key={k} className="rounded-lg bg-slate-800/60 px-1 py-2">
                  <div className="text-slate-400">{ko}</div>
                  <div className="font-mono text-amber-300 font-bold text-base">{ja[k] ? `${ja[k].avg}°` : '—'}</div>
                  <div className="text-[9px] text-slate-500">ROM {ja[k] ? `${ja[k].rom}°` : '—'}</div>
                </div>
              ))}
            </div>
          </div>

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

          <div className="space-y-2">
            <div className="rounded-xl bg-slate-800 px-3 py-2 text-center text-xs text-slate-300">
              {VIEW_OPTIONS.find((v) => v.id === camView)?.label} · {savedSize || '—'} · 환경 무관 분석
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onSaveVideo} className="rounded-xl border border-slate-600 bg-slate-800 text-slate-100 font-bold py-3 text-sm">📥 영상 기기 저장</button>
              <button onClick={onSaveFirebase} disabled={!canSaveFirebase || saving || saveState === 'saved'}
                className="btn btn-primary disabled:opacity-60 flex items-center justify-center gap-2">
                {saving && <span className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />}
                {saveState === 'saved' ? '✓ 저장됨' : saving ? '저장 중...' : '💾 회차 기록 저장'}
              </button>
            </div>
            {saveState === 'error' && <p className="text-center text-[11px] text-red-400">저장에 실패했습니다. 네트워크를 확인하고 다시 시도하세요.</p>}
            <button onClick={onReset} className="w-full rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">다시 녹화</button>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              영상은 기기에만, 회차 기록은 정량 데이터(JSON)만 서버에 저장됩니다.
              {!poseReady && ' 각도·주기는 MediaPipe 연동 후 실측값으로 채워집니다.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 작은 조각 ── */
function SummaryCard({ label, value, unit }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/50 px-2 py-3 text-center">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="font-mono text-xl font-black text-amber-300 leading-tight">{value}</div>
      <div className="text-[9px] text-slate-500">{unit}</div>
    </div>
  );
}
function HudAngles({ angles }) {
  return (
    <div className="space-y-0.5 font-mono text-amber-300">
      <div>고관절 {fmtAngle(angles?.left?.hip)}</div>
      <div>무릎 &nbsp;{fmtAngle(angles?.left?.knee)}</div>
      <div>발목 &nbsp;{fmtAngle(angles?.left?.ankle)}</div>
    </div>
  );
}
