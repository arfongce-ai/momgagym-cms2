// ai-measure/menus/JumpPrecisionAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  점프 정밀 측정 (라이브) — 보행&러닝(GaitRunningAnalysis)과 동일 수준의 UX
//   · BlazePose 스켈레톤 오버레이로 인식 상태를 눈으로 확인
//   · 서 있는 자세 캘리브레이션(키 자동 보정) → 점프 검출 → 비행시간 높이
//   · 골반 변위 교차검증(±오차) + 키 sanity → valid 플래그로 무효 측정 차단
//   · 유효 측정만 자동 저장 (gait 와 동일한 저장 흐름)
//
//  요구사항 매핑:
//   [1] 측정 시작 시 member.height 로 px↔cm 스케일 자동 산출 (StandingCalibrator)
//   [2] 상단에 "회원 키(000cm)로 자동 보정 중..." 표시 / 키 없으면 입력 팝업
//   [3] 서 있는 자세 불안정(가시성↓·흔들림↑)이면 "올바르게 서 주세요" → 측정 차단
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from 'react';
import {
  StandingCalibrator, JumpFlightTracker,
  JumpBiomechAccumulator, jumpPhaseOf,
} from '../core/jumpBiomechanics';
import { calcJump, calcRSI } from '../core/performance';
import { computeRSIFromFlights, rsiGrade } from '../core/reactiveJump';
import { OrientationVoter } from '../core/gaitBiomechanics';
import { loadPoseLandmarker, detectPoseFrame, isPoseReady } from '../core/poseBackend';
import { beepTick, beepGo, primeAudio } from '../core/audioCue';
import { lockZoom, unlockZoom } from '../../utils/viewportLock';
import ReportActions from '../../components/report/ReportActions';
import { store } from '../../demoData';

// 회원 신체기록에서 최신 체중을 보조 조회 (member.weight 없을 때 Sayers 파워용)
function resolveWeight(member, fallback = null) {
  let w = member?.weight != null ? Number(member.weight) : fallback;
  try {
    if (w == null && member?.id && typeof store?.getBodyRecords === 'function') {
      const recs = store.getBodyRecords(member.id) || [];
      const sorted = [...recs].sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
      const hit = sorted.find(r => r.weight != null);
      if (hit) w = Number(hit.weight);
    }
  } catch (e) { /* member 값 사용 */ }
  return Number.isFinite(w) ? w : null;
}

const RECORD_FPS = 30;
const REC_SIZE = { width: 720, height: 960 }; // 3:4 세로
const LAND_WINDOW = 10; // 착지 직후 생체역학 지표를 누적할 프레임 수
const RSI_REQUIRED_JUMPS = 3;

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function buildRsiCyclePreview(flights = []) {
  const cycles = [];
  const sorted = [...flights].sort((a, b) => a.takeoffMs - b.takeoffMs);
  for (let i = 0; i < sorted.length - 1; i++) {
    const contactMs = sorted[i + 1].takeoffMs - sorted[i].landingMs;
    const flightMs = sorted[i + 1].flightMs;
    if (!(contactMs > 0) || !(flightMs > 0)) continue;
    const jump = calcJump(flightMs / 1000, null);
    cycles.push({
      contactMs: Math.round(contactMs),
      flightMs: Math.round(flightMs),
      heightCm: jump?.heightCm ?? null,
      rsi: Math.round((flightMs / contactMs) * 100) / 100,
    });
  }
  return cycles;
}

function flightRows(flights = [], cycles = []) {
  return flights.slice(-5).map((f, i, arr) => {
    const originalIndex = flights.length - arr.length + i;
    const jump = calcJump((f.flightMs || 0) / 1000, null);
    return {
      no: originalIndex + 1,
      flightMs: Math.round(f.flightMs || 0),
      heightCm: jump?.heightCm ?? null,
      rsi: originalIndex > 0 ? cycles[originalIndex - 1]?.rsi ?? null : null,
      contactMs: originalIndex > 0 ? cycles[originalIndex - 1]?.contactMs ?? null : null,
    };
  });
}

function allFlightRows(flights = [], cycles = []) {
  return flights.map((f, i) => {
    const jump = calcJump((f.flightMs || 0) / 1000, null);
    return {
      no: i + 1,
      takeoffMs: Math.round(f.takeoffMs || 0),
      landingMs: Math.round(f.landingMs || 0),
      flightMs: Math.round(f.flightMs || 0),
      heightCm: jump?.heightCm ?? null,
      rsi: i > 0 ? cycles[i - 1]?.rsi ?? null : null,
      contactMs: i > 0 ? cycles[i - 1]?.contactMs ?? null : null,
    };
  });
}

function drawJumpLiveOverlay(ctx, width, height, snap = {}) {
  const scale = Math.max(1.05, Math.min(1.65, width / 720));
  const isRsi = snap.jumpType === 'reactive';
  const phase = snap.phase || 'arming';
  const accent = phase === 'air' ? '#fbbf24' : phase === 'ready' ? '#34d399' : phase === 'low_visibility' ? '#f87171' : '#22d3ee';
  const title = isRsi ? 'RSI · SIDE' : 'POWER · FRONT';
  const main = isRsi ? (snap.latestCycle?.rsi != null ? snap.latestCycle.rsi : snap.liveJump?.heightCm ?? '--') : (snap.liveJump?.heightCm ?? snap.bestHeight ?? '--');
  const mainUnit = isRsi ? (snap.latestCycle?.rsi != null ? 'RSI' : 'cm') : 'cm';
  const helper = isRsi
    ? `${snap.jumpCount || 0}/${RSI_REQUIRED_JUMPS} jumps · GCT ${snap.latestCycle?.contactMs ? `${snap.latestCycle.contactMs}ms` : '--'} · flight ${snap.liveJump?.flightMs ? `${snap.liveJump.flightMs}ms` : '--'}`
    : `jumps ${snap.jumpCount || 0} · flight ${snap.liveJump?.flightMs ? `${snap.liveJump.flightMs}ms` : '--'}`;

  ctx.save();
  ctx.textBaseline = 'middle';
  const pad = 16 * scale;
  const panelH = 118 * scale;
  const panelY = pad;
  roundRect(ctx, pad, panelY, width - pad * 2, panelH, 18 * scale);
  ctx.fillStyle = 'rgba(2,6,23,0.68)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(pad + 20 * scale, panelY + 27 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.font = `900 ${16 * scale}px system-ui, sans-serif`;
  ctx.fillText(title, pad + 38 * scale, panelY + 27 * scale);
  ctx.fillStyle = 'rgba(226,232,240,0.78)';
  ctx.font = `800 ${12 * scale}px system-ui, sans-serif`;
  ctx.fillText(phase === 'ready' ? 'READY' : phase === 'air' ? 'AIR' : phase === 'low_visibility' ? 'CHECK POSTURE' : 'CALIBRATING', pad + 38 * scale, panelY + 55 * scale);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `900 ${52 * scale}px ui-monospace, Menlo, monospace`;
  ctx.fillText(String(main), width - pad - 74 * scale, panelY + 48 * scale);
  ctx.fillStyle = accent;
  ctx.font = `900 ${18 * scale}px system-ui, sans-serif`;
  ctx.fillText(mainUnit, width - pad - 14 * scale, panelY + 51 * scale);
  ctx.fillStyle = 'rgba(226,232,240,0.72)';
  ctx.font = `800 ${13 * scale}px system-ui, sans-serif`;
  ctx.fillText(helper, width - pad - 14 * scale, panelY + 88 * scale);
  ctx.textAlign = 'left';

  const rows = (snap.jumpRows || []).slice(-3);
  if (rows.length) {
    const rowW = Math.min(width - pad * 2, 430 * scale);
    const rowH = 34 * scale;
    const rowX = pad;
    const rowY = height - pad - rows.length * rowH - 14 * scale;
    roundRect(ctx, rowX, rowY, rowW, rows.length * rowH + 12 * scale, 14 * scale);
    ctx.fillStyle = 'rgba(2,6,23,0.58)';
    ctx.fill();
    rows.forEach((r, i) => {
      const y = rowY + 12 * scale + i * rowH;
      ctx.fillStyle = 'rgba(203,213,225,0.72)';
      ctx.font = `800 ${11 * scale}px system-ui, sans-serif`;
      ctx.fillText(`#${r.no}`, rowX + 12 * scale, y);
      ctx.fillStyle = '#f8fafc';
      ctx.font = `900 ${15 * scale}px ui-monospace, Menlo, monospace`;
      const value = isRsi
        ? (r.rsi != null ? `RSI ${r.rsi} · ${r.contactMs ? `${r.contactMs}ms` : '--'}` : `${r.heightCm ?? '--'}cm · ${r.flightMs ?? '--'}ms`)
        : `${r.heightCm ?? '--'}cm · ${r.flightMs}ms`;
      ctx.fillText(value, rowX + 50 * scale, y);
    });
  }
  ctx.restore();
}

// 녹화 캔버스에 비디오를 꽉 채워 그린다(검은 여백 없이 크롭) — gait drawCover 와 동일.
function drawCoverJump(ctx, video, width, height) {
  const sw0 = video.videoWidth, sh0 = video.videoHeight;
  if (!sw0 || !sh0) return;
  const sr = sw0 / sh0, tr = width / height;
  let sx = 0, sy = 0, sw = sw0, sh = sh0;
  if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
  else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
}

// 캘리브레이션 안정 유지 시간(깜빡임 방지). 충분히 서 있으면 거의 즉시 락.
const POSE_BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [0, 11], [0, 12], // 머리~어깨 (전신 프레이밍 확인용)
];

function drawSkeleton(canvas, video, landmarks, phase) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!landmarks) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  const px = (p) => ox + p.x * dw;
  const py = (p) => oy + p.y * dh;
  // 색상: 캘리브 중=시안, 측정 준비=초록, 공중=앰버
  const col = phase === 'air' ? 'rgba(251,191,36,0.95)'
    : phase === 'ready' ? 'rgba(52,211,153,0.95)'
    : 'rgba(34,211,238,0.95)';
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [a, b] of POSE_BONES) {
    const pa = landmarks[a], pb = landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.visibility != null && pa.visibility < 0.3) || (pb.visibility != null && pb.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.moveTo(px(pa), py(pa)); ctx.lineTo(px(pb), py(pb)); ctx.stroke();
  }
  ctx.fillStyle = phase === 'ready' || phase === 'air' ? col : 'rgba(255,255,255,0.95)';
  for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28, 31, 32]) {
    const p = landmarks[i];
    if (!p || (p.visibility != null && p.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.arc(px(p), py(p), 5, 0, Math.PI * 2); ctx.fill();
  }
}

// 캘리브 기준선을 화면에 가로선으로 표시 (사용자 피드백)
function drawBaseline(canvas, video, baselineFeetY) {
  if (!canvas || !video || baselineFeetY == null) return;
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(cw / vw, ch / vh);
  const dh = vh * scale;
  const oy = (ch - dh) / 2;
  const y = oy + baselineFeetY * dh;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(52,211,153,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  ctx.setLineDash([]);
}

export default function JumpPrecisionAnalysis({ member, onBack, onSaveToFirebase, onSave, onMemberHeightChange, onManualComplete, onOpenSavedReport, jumpType = 'power' }) {
  const saveToFirebase = onSaveToFirebase || onSave;

  const [view, setView] = useState('camera');     // camera | preview
  const [showManual, setShowManual] = useState(false);
  const [phase, setPhase] = useState('arming');    // arming | low_visibility | ready | air
  const [calibMsg, setCalibMsg] = useState('');
  const [reportData, setReportData] = useState(null);
  const [poseLoaded, setPoseLoaded] = useState(false);
  const [warning, setWarning] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error
  const [jumpCount, setJumpCount] = useState(0);
  const [rsiCycles, setRsiCycles] = useState([]);
  const [jumpRows, setJumpRows] = useState([]);
  const [liveJump, setLiveJump] = useState({ flightMs: null, heightCm: null });
  // 측정 시작 게이트: 스켈레톤이 잡혀도 자동으로 측정을 시작하지 않고,
  // 사용자가 '측정 시작' 버튼을 누르면 3초 카운트다운 후 측정을 개시한다.
  const [armed, setArmed] = useState(false);       // true → 점프 트래킹/녹화 진행 중
  const [countdown, setCountdown] = useState(null); // 3,2,1 표시값. null이면 비표시.

  // 키/체중 입력 팝업 (회원 미정 또는 신체정보 부족 시)
  const initialWeight = resolveWeight(member);
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [bodyWeight, setBodyWeight] = useState(initialWeight);
  const [needHeight, setNeedHeight] = useState(!member?.height || (!member?.id && initialWeight == null));
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState(initialWeight ? String(initialWeight) : '');

  const videoRef = useRef(null);
  const skeletonCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const reqFrameRef = useRef(null);
  const lastTsRef = useRef(0);
  const viewRef = useRef('camera');
  const phaseRef = useRef('arming');

  const calibRef = useRef(null);     // StandingCalibrator
  const trackerRef = useRef(null);   // JumpFlightTracker
  const biomechAccRef = useRef(null); // JumpBiomechAccumulator
  const prevInAirRef = useRef(false);
  const landFramesLeftRef = useRef(0);
  const frameDtRef = useRef([]);     // 측정 단계 프레임 간격(ms) 모음 — RSI fps 경고용
  const orientRef = useRef(null);    // OrientationVoter — 반응(RSI) 모드 측면뷰 강제용
  const prevFrameTsRef = useRef(0);  // 직전 프레임 타임스탬프(간격 계산용)
  const heightRef = useRef(heightCm);
  const weightRef = useRef(bodyWeight);
  const overlayRef = useRef({});
  const autoSavedRef = useRef(null);
  const armedRef = useRef(false);          // 측정 개시 게이트(루프에서 참조)
  const calibLockedRef = useRef(false);    // 캘리브레이션 잠금 완료 여부
  const countdownTimerRef = useRef(null);  // 카운트다운 인터벌 정리용

  // 오버레이 녹화 파이프라인 (보행과 동일 구조)
  const recordCanvasRef = useRef(null);
  const recordStreamRef = useRef(null);
  const composeRafRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordedBlobRef = useRef(null);
  const recStartedAtRef = useRef(0);
  const jumpCountRef = useRef(0);
  const bestHeightRef = useRef(null);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { armedRef.current = armed; }, [armed]);
  useEffect(() => { heightRef.current = heightCm; }, [heightCm]);
  useEffect(() => { weightRef.current = bodyWeight; }, [bodyWeight]);
  useEffect(() => {
    overlayRef.current = {
      jumpType,
      phase,
      jumpCount,
      liveJump,
      rsiCycles,
      latestCycle: rsiCycles.at(-1) || null,
      jumpRows,
      bestHeight: bestHeightRef.current,
      heightCm,
    };
  }, [jumpType, phase, jumpCount, liveJump, rsiCycles, jumpRows, heightCm]);

  // 카메라 생명주기
  useEffect(() => {
    if (view === 'camera' && !streamRef.current && !needHeight) startCamera();
    else if (view === 'preview') stopCamera();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, needHeight]);

  useEffect(() => () => stopCamera(), []);
  useEffect(() => () => { if (countdownTimerRef.current) clearInterval(countdownTimerRef.current); }, []);
  // 카메라 측정 화면: 확대 잠금 (언마운트 시 복원)
  useEffect(() => { lockZoom(); return () => unlockZoom(); }, []);

  const resetPipeline = () => {
    calibRef.current = new StandingCalibrator({ heightCm: heightRef.current });
    trackerRef.current = null;
    biomechAccRef.current = new JumpBiomechAccumulator({ heightCm: heightRef.current });
    prevInAirRef.current = false;
    landFramesLeftRef.current = 0;
    frameDtRef.current = [];
    prevFrameTsRef.current = 0;
    setPhase('arming');
    setArmed(false);
    armedRef.current = false;
    calibLockedRef.current = false;
    setCountdown(null);
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    setJumpCount(0);
    setRsiCycles([]);
    setJumpRows([]);
    setLiveJump({ flightMs: null, heightCm: null });
    setReportData(null);
    setSaveState('idle');
    autoSavedRef.current = null;
    jumpCountRef.current = 0;
    bestHeightRef.current = null;
    recordedBlobRef.current = null;
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      loadPoseLandmarker({ numPoses: 1, modelTier: 'full' })
        .then(() => setPoseLoaded(true))
        .catch((e) => { setPoseLoaded(false); setWarning(e?.message || 'AI 분석 모듈 로드 실패'); });
      resetPipeline();
      startVisionPipeline();
    } catch (err) {
      setWarning('카메라 권한을 허용해주세요.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); reqFrameRef.current = null; }
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  // 오버레이(스켈레톤 없이 측정값 텍스트) 합성 녹화 스트림 — 보행과 동일 구조.
  const createRecordedStream = () => {
    const video = videoRef.current;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = REC_SIZE.width; canvas.height = REC_SIZE.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCoverJump(ctx, video, canvas.width, canvas.height);
      drawJumpLiveOverlay(ctx, canvas.width, canvas.height, {
        ...overlayRef.current,
        phase: phaseRef.current,
        jumpCount: jumpCountRef.current,
        bestHeight: bestHeightRef.current,
      });
      composeRafRef.current = requestAnimationFrame(draw);
    };
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    draw();
    const cs = canvas.captureStream ? canvas.captureStream(RECORD_FPS) : null;
    if (!cs) return streamRef.current;
    const mixed = new MediaStream();
    cs.getVideoTracks().forEach(t => mixed.addTrack(t));
    recordStreamRef.current = mixed;
    return mixed;
  };

  const startRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') return;
    chunksRef.current = [];
    recStartedAtRef.current = performance.now();
    const mimeTypes = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = mimeTypes.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    try {
      const stream = createRecordedStream();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
        if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
        recordedBlobRef.current = chunksRef.current.length ? new Blob(chunksRef.current, { type: mime || 'video/webm' }) : null;
      };
      rec.start();
    } catch (e) { /* 녹화 불가 환경 — 측정은 계속 */ }
  };

  const stopRecording = () => new Promise((resolve) => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== 'recording') { resolve(); return; }
    rec.onstop = ((orig) => function (...a) { orig?.apply(this, a); resolve(); })(rec.onstop);
    try { rec.stop(); } catch (e) { resolve(); }
  });

  // '측정 시작' 버튼 → 3초 카운트다운(큰 숫자 + 소리) 후 측정 개시.
  const beginCountdown = () => {
    if (armed || countdown != null) return;            // 중복 시작 방지
    if (!calibLockedRef.current) return;               // 기준 미확보 시 무시
    primeAudio();                                      // 사용자 제스처에서 오디오 워밍업
    let n = 3;
    setCountdown(n);
    beepTick();
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        beepTick();
      } else {
        // 0 → 측정 시작
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdown(null);
        beepGo();
        // 트래커/누적기 생성 + 오버레이 녹화 시작 (기존 락 시점 로직을 여기로 이동)
        const calib = calibRef.current;
        if (calib?.result) {
          trackerRef.current = new JumpFlightTracker(calib.result);
          trackerRef.current.calibHeightCm = heightRef.current;
          orientRef.current = jumpType === 'reactive' ? new OrientationVoter() : null;
          prevInAirRef.current = false;
          landFramesLeftRef.current = 0;
          frameDtRef.current = [];
          prevFrameTsRef.current = 0;
          startRecording();
          setArmed(true);
          armedRef.current = true;
        }
      }
    }, 1000);
  };

  const startVisionPipeline = () => {
    if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current);
    let lastPhase = null, lastMsg = null;
    const setPhaseOnce = (v) => { if (v !== lastPhase) { lastPhase = v; setPhase(v); } };
    const setMsgOnce = (v) => { if (v !== lastMsg) { lastMsg = v; setCalibMsg(v); } };
    let lastCount = 0;

    const loop = () => {
      const video = videoRef.current;
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      let landmarks = null;
      try {
        const res = detectPoseFrame(video, ts);
        landmarks = res?.landmarks || null;
      } catch (e) { landmarks = null; }

      const calib = calibRef.current;
      const tracker = trackerRef.current;

      // 스켈레톤 + 기준선
      try {
        const ph = tracker ? (tracker.inAir ? 'air' : 'ready') : 'arming';
        drawSkeleton(skeletonCanvasRef.current, video, landmarks, ph);
        if (calib?.result) drawBaseline(skeletonCanvasRef.current, video, calib.result.baselineFeetY);
      } catch (e) { /* noop */ }

      if (landmarks && viewRef.current === 'camera') {
        if (!calib.locked) {
          // ── 캘리브레이션 단계 ──
          calib.push(landmarks);
          const st = calib.status();
          if (st.ready) {
            // 락 완료 → 기준 확보. 단, 자동으로 측정을 시작하지 않는다.
            // 사용자가 '측정 시작' 버튼 → 3초 카운트다운 후 armed 가 되면 측정 개시.
            calibLockedRef.current = true;
            setPhaseOnce('ready');
            setMsgOnce('');
          } else if (st.reason === 'low_visibility') {
            // 요구사항 3: 자세 불안정 → 측정 차단 경고
            setPhaseOnce('low_visibility');
            setMsgOnce('올바르게 서 주세요 — 전신이 보이도록 카메라 앞에 똑바로 서세요');
          } else {
            setPhaseOnce('arming');
            setMsgOnce(`자세 보정 중... ${Math.round(st.progress * 100)}%`);
          }
        } else if (!armedRef.current) {
          // ── 측정 대기 단계: 기준은 잡혔으나 아직 '측정 시작' 전 ──
          // 스켈레톤만 계속 그리고, 점프 트래킹/녹화는 하지 않는다.
          setPhaseOnce('ready');
          setMsgOnce('');
        } else {
          // ── 측정 단계 ──
          // 프레임 간격(ms) 수집 — RSI 접지시간 정확도(fps) 판정용
          tracker.push(landmarks, ts);
          const curInAir = tracker.inAir;
          const prevInAir = prevInAirRef.current;
          if (prevInAir && !curInAir) landFramesLeftRef.current = LAND_WINDOW;
          const landActive = landFramesLeftRef.current > 0;
          const { phase: jp, justTookOff } = jumpPhaseOf(prevInAir, curInAir, landActive);
          biomechAccRef.current?.push(landmarks, ts, jp, justTookOff);
          if (landActive && !curInAir) landFramesLeftRef.current--;
          prevInAirRef.current = curInAir;
          // 반응(RSI) 모드: 측면뷰 판정용 방향 누적
          if (orientRef.current) orientRef.current.push(landmarks);
          const prevTs = prevFrameTsRef.current;
          if (prevTs > 0) {
            const dt = ts - prevTs;
            if (dt > 0 && dt < 200) {
              const arr = frameDtRef.current;
              arr.push(dt);
              if (arr.length > 300) arr.shift();
            }
          }
          prevFrameTsRef.current = ts;
          setPhaseOnce(tracker.inAir ? 'air' : 'ready');
          const c = tracker.flights.length;
          if (c !== lastCount) {
            lastCount = c; setJumpCount(c); jumpCountRef.current = c;
            // 오버레이용 최고 높이 갱신
            try {
              const s = tracker.summary({ heightCm: heightRef.current });
              if (s?.heightCm != null) bestHeightRef.current = s.heightCm;
              const latest = tracker.flights.at(-1);
              let nextLiveJump = overlayRef.current.liveJump || { flightMs: null, heightCm: null };
              if (latest?.flightMs) {
                const jump = calcJump(latest.flightMs / 1000, null);
                nextLiveJump = {
                  flightMs: Math.round(latest.flightMs),
                  heightCm: jump?.heightCm ?? null,
                };
                setLiveJump(nextLiveJump);
              }
              let nextCycles = [];
              let nextRows = [];
              if (jumpType === 'reactive') {
                const cyclePreview = buildRsiCyclePreview(tracker.flights);
                nextCycles = cyclePreview;
                nextRows = flightRows(tracker.flights, cyclePreview);
                setRsiCycles(nextCycles);
                setJumpRows(nextRows);
              } else {
                nextRows = flightRows(tracker.flights, []);
                setJumpRows(nextRows);
              }
              overlayRef.current = {
                ...overlayRef.current,
                jumpType,
                phase: phaseRef.current,
                jumpCount: c,
                liveJump: nextLiveJump,
                rsiCycles: nextCycles,
                latestCycle: nextCycles[nextCycles.length - 1] || null,
                jumpRows: nextRows,
                bestHeight: bestHeightRef.current,
                heightCm: heightRef.current,
              };
            } catch (e) { /* noop */ }
          }
        }
      } else if (viewRef.current === 'camera') {
        if (!calib?.locked) {
          setPhaseOnce('arming');
          setMsgOnce(isPoseReady()
            ? '전신(머리~발)이 화면에 들어오게 해주세요'
            : 'AI 분석 모듈 로딩 중...');
        }
      }

      reqFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  // 측정 종료 → 결과 산출
  const finishMeasure = async () => {
    const tracker = trackerRef.current;
    if (!tracker) { setWarning('아직 보정이 끝나지 않았습니다.'); return; }
    // 오버레이 녹화 종료 → blob 확보
    await stopRecording();
    const videoBlob = recordedBlobRef.current || null;
    const sum = tracker.summary({ heightCm: heightRef.current });
    const biomech = biomechAccRef.current?.summary() || null;
    // performance.calcJump 로 파워(Sayers)까지 일관 산출 (체중 있으면)
    const power = calcJump(sum.flightTimeSec, resolveWeight(member, weightRef.current));

    // ── 반응 탄성 점프 모드: 사이클 간 접지시간으로 RSI 산출 ──
    // 측면뷰 강제: 누적된 방향이 'side'가 아니면 코어가 무효 처리한다.
    let rsiResult = null;
    if (jumpType === 'reactive') {
      const dts = frameDtRef.current.slice().sort((a, b) => a - b);
      const medDt = dts.length ? dts[Math.floor(dts.length / 2)] : null;
      const decidedView = orientRef.current ? orientRef.current.decide() : undefined;
      rsiResult = computeRSIFromFlights(tracker.flights, {
        frameIntervalMs: medDt,
        view: decidedView,
      });
    }
    const liveCyclePreview = buildRsiCyclePreview(tracker.flights);
    const perJump = allFlightRows(tracker.flights, rsiResult?.perCycle || liveCyclePreview);

    const report = {
      ...sum,
      heightCm: sum.heightCm,
      takeoffVelocity: sum.takeoffVelocity,
      peakPower: power?.peakPower ?? null,
      bodyWeight: resolveWeight(member, weightRef.current),
      calibHeightCm: heightRef.current,
      jumpType,                       // 'power' | 'reactive'
      rsi: rsiResult,                 // 반응 모드에서만 채워짐(null 가능)
      source: 'live',
      videoBlob, // 오버레이 합성 녹화본 (저장은 안 함, 화면에서 '동영상 저장'에 사용)
      perJump,
      videoMetrics: {
        overlayRecorded: Boolean(videoBlob),
        recordingFps: RECORD_FPS,
        recommendedView: jumpType === 'reactive' ? 'side' : 'front',
        detectedView: biomech?.view ?? null,
      },
      biomech,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    };
    // 반응 모드는 RSI(접지시간) 측정 성공 여부까지 유효성에 반영
    if (jumpType === 'reactive') {
      report.valid = report.valid === true && rsiResult?.valid === true;
      if (rsiResult && rsiResult.valid !== true) report.reason = rsiResult.reason;
    }
    setReportData(report);
    setView('preview');
    stopCamera();
    // 유효 측정만 자동 저장 (gait 와 동일 철학) — videoBlob 은 저장 페이로드에서 제외
    if (report.valid === true && saveToFirebase && autoSavedRef.current !== report.measuredAt) {
      autoSavedRef.current = report.measuredAt;
      const { videoBlob: _vb, ...dataOnly } = report;
      autoSave(dataOnly);
    }
  };

  const autoSave = async (report) => {
    setSaveState('saving');
    try {
      const saved = await saveToFirebase(report);
      setSaveState('saved');
      return { ok: true, saved };
    }
    catch (e) { setSaveState('error'); return { ok: false, saved: null }; }
  };

  const handleManualSave = async () => {
    if (!reportData || reportData.valid !== true || !saveToFirebase) return;
    // 자동 저장과 동일하게 videoBlob 은 저장 페이로드에서 제외(Firestore 오염 방지).
    const { videoBlob: _vb, ...dataOnly } = reportData;
    autoSavedRef.current = reportData.measuredAt;   // 중복 저장 방지 마킹
    const res = await autoSave(dataOnly);
    if (!res?.ok) return;
    const nextReport = res.saved && typeof res.saved === 'object' ? { ...reportData, ...res.saved } : reportData;
    setReportData(nextReport);
  };

  const retry = () => { setView('camera'); };

  const applyHeight = () => {
    const h = Number(heightInput || heightCm);
    const w = Number(weightInput || bodyWeight);
    if (!h || h < 80 || h > 250) { setWarning('키를 80~250cm로 입력하세요.'); return; }
    if (!w || w < 20 || w > 250) { setWarning('몸무게를 20~250kg으로 입력하세요.'); return; }
    setHeightCm(h);
    setBodyWeight(w);
    heightRef.current = h;
    weightRef.current = w;
    setNeedHeight(false);
    onMemberHeightChange?.(h);
    setWarning('');
  };

  // ── 키/몸무게 입력 팝업 (회원 미정 또는 신체정보 부족) ──
  if (needHeight) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
          <h2 className="text-white font-black">점프 정밀 측정</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키와 몸무게가 필요합니다</p>
              <p className="text-slate-400 text-xs leading-relaxed">
                {member?.name ? `${member.name} 회원의 ` : '회원 미정 상태입니다. '}
                cm 보정과 파워 계산을 위해 지금 입력해 주세요.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-slate-500">키</span>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="numeric" value={heightInput}
                    onChange={e => setHeightInput(e.target.value)} placeholder="170"
                    className="min-w-0 flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                  <span className="text-slate-400 text-xs font-bold">cm</span>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-slate-500">몸무게</span>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" value={weightInput}
                    onChange={e => setWeightInput(e.target.value)} placeholder="70"
                    className="min-w-0 flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                  <span className="text-slate-400 text-xs font-bold">kg</span>
                </div>
              </label>
            </div>
            <button onClick={applyHeight}
              className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95">
              입력하고 측정 시작
            </button>
            {warning && <p className="text-center text-xs text-red-400">{warning}</p>}
          </div>
        </div>
      </div>
    );
  }

  const phaseColor = phase === 'air' ? 'text-amber-400'
    : phase === 'ready' ? 'text-emerald-400'
    : phase === 'low_visibility' ? 'text-red-400' : 'text-cyan-400';

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      {view === 'camera' && (
        <div className="relative w-full h-full">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          <canvas ref={skeletonCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

          {/* 헤더 */}
          <div className="absolute top-0 z-20 inset-x-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
            <button onClick={onBack} className="text-white font-bold text-sm">← 뒤로</button>
            <h2 className="text-white font-black text-sm">점프 정밀 측정</h2>
            <div className="w-12" />
          </div>

          <JumpLiveOverlay
            jumpType={jumpType}
            phase={phase}
            phaseColor={phaseColor}
            calibMsg={calibMsg}
            heightCm={heightCm}
            jumpCount={jumpCount}
            liveJump={liveJump}
            bestHeight={bestHeightRef.current}
            rsiCycles={rsiCycles}
            jumpRows={jumpRows}
          />

          {warning && (
            <div className="absolute top-1/2 inset-x-6 -translate-y-1/2 bg-red-500/90 text-white text-center rounded-xl px-4 py-3 font-bold text-sm">
              {warning}
            </div>
          )}

          {/* 측정 시작 3초 카운트다운 — 화면 중앙 큰 숫자 */}
          {countdown != null && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
              <div className="flex h-44 w-44 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm ring-4 ring-amber-300/80 animate-pulse">
                <span className="font-black text-amber-300 leading-none" style={{ fontSize: '7rem' }}>
                  {countdown}
                </span>
              </div>
            </div>
          )}

          {/* 하단 컨트롤 */}
          <div className="absolute bottom-[max(24px,calc(env(safe-area-inset-bottom)+24px))] z-20 inset-x-0 flex flex-col items-center gap-3">
            {!armed ? (
              <>
                {/* 측정 시작 전: 녹화버튼 형태의 측정 시작 버튼 */}
                <button
                  onClick={beginCountdown}
                  disabled={phase !== 'ready' || countdown != null}
                  className={`flex h-20 w-20 items-center justify-center rounded-full border-4 shadow-lg transition active:scale-95
                    ${phase === 'ready' && countdown == null
                      ? 'border-white bg-red-500'
                      : 'border-white/40 bg-white/15'}`}>
                  <span className="text-[11px] font-black text-white leading-tight text-center whitespace-pre-line">
                    {countdown != null ? String(countdown) : phase === 'ready' ? '측정\n시작' : '대기'}
                  </span>
                </button>
                <p className="text-white/80 text-xs font-bold text-center px-6">
                  {phase === 'ready'
                    ? '버튼을 누르면 3초 후 측정이 시작됩니다'
                    : phase === 'low_visibility'
                    ? '전신이 보이도록 똑바로 서 주세요'
                    : '자세 인식 중...'}
                </p>
                <button onClick={() => setShowManual(true)}
                  className="text-white/70 text-xs underline underline-offset-2">
                  ✍️ 카메라 대신 수동 입력 (체공시간)
                </button>
              </>
            ) : (
              <>
                <div className="flex w-full max-w-sm gap-2 px-4">
                  <button
                    onClick={async () => { await stopRecording(); resetPipeline(); }}
                    className="flex-1 rounded-xl bg-black/60 border border-white/15 py-3 text-sm font-black text-white backdrop-blur">
                    기준 다시 잡기
                  </button>
                  <button
                    onClick={finishMeasure}
                    disabled={jumpCount < (jumpType === 'reactive' ? RSI_REQUIRED_JUMPS : 1)}
                    className={`flex-[1.25] rounded-xl py-3 font-black text-sm shadow-lg transition
                      ${jumpCount >= (jumpType === 'reactive' ? RSI_REQUIRED_JUMPS : 1) ? 'bg-emerald-500 text-slate-950 active:scale-95' : 'bg-white/20 text-white/50'}`}>
                    {jumpType === 'reactive'
                      ? `측정 완료 ${jumpCount}/${RSI_REQUIRED_JUMPS}`
                      : `측정 완료 ${jumpCount >= 1 ? `(${jumpCount}회)` : ''}`}
                  </button>
                </div>
                {/* 요구사항 8: 수동 입력을 실시간 화면 안에서 바로 (점프매트/타이머 값) */}
                <button onClick={() => setShowManual(true)}
                  className="text-white/70 text-xs underline underline-offset-2">
                  ✍️ 카메라 대신 수동 입력 (체공시간)
                </button>
              </>
            )}
          </div>
          {showManual && (
            <ManualEntryModal member={member} jumpType={jumpType}
              onClose={() => setShowManual(false)}
              onSubmit={async (report) => { setShowManual(false); await (onManualComplete || onSaveToFirebase)?.(report); }} />
          )}
        </div>
      )}

      {view === 'preview' && reportData && (
        <JumpReport
          report={reportData}
          saveState={saveState}
          onSave={handleManualSave}
          onRetry={retry}
          onBack={onBack}
          onOpenSavedReport={onOpenSavedReport}
        />
      )}
    </div>
  );
}

// ── 리포트 화면 ──
function JumpReport({ report, saveState, onSave, onRetry, onBack, onOpenSavedReport }) {
  const isRsi = report.jumpType === 'reactive';
  const biomech = report.biomech || {};
  const viewLabel = report.videoMetrics?.detectedView === 'side' ? '측면'
    : report.videoMetrics?.detectedView === 'back' ? '정면'
    : '미확인';
  const recommendedView = report.videoMetrics?.recommendedView === 'side' ? '측면'
    : report.videoMetrics?.recommendedView === 'front' ? '정면'
    : '미지정';
  const measuredAt = report.measuredAt
    ? new Date(report.measuredAt).toLocaleString('ko-KR', { hour12: false })
    : '—';
  const grade = report.valid
    ? report.heightCm >= 50 ? { label: '매우 우수', color: 'text-blue-400' }
    : report.heightCm >= 40 ? { label: '우수', color: 'text-emerald-400' }
    : report.heightCm >= 30 ? { label: '보통', color: 'text-amber-400' }
    : { label: '개선 필요', color: 'text-red-400' }
    : null;

  const cc = report.crossCheck || {};
  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <button onClick={onRetry} className="text-slate-300 font-bold text-sm">← 다시 측정</button>
        <h2 className="text-white font-black">측정 리포트</h2>
        <button onClick={onBack} className="text-slate-400 text-sm font-bold">닫기</button>
      </div>

      <div id="jump-live-report-sheet" className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Jump Report</p>
              <p className="text-xl font-black text-white">{isRsi ? 'RSI 반응 점프' : '파워 점프'} 결과 리포트</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-200">
              {report.source === 'live' ? '실시간 측정' : '영상 분석'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <InfoRow label="회원" value={report.member?.name || '회원 미정'} />
            <InfoRow label="측정일" value={measuredAt} />
            <InfoRow label="권장 방향" value={recommendedView} />
            <InfoRow label="감지 방향" value={viewLabel} />
            <InfoRow label="기준 키" value={report.calibHeightCm ? `${report.calibHeightCm}cm` : '—'} />
            <InfoRow label="체중" value={report.bodyWeight ? `${report.bodyWeight}kg` : '미입력'} />
          </div>
        </div>

        {report.valid !== true ? (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-5 text-center space-y-2">
            <p className="text-3xl">⚠</p>
            <p className="text-red-400 font-black">측정 무효</p>
            <p className="text-slate-300 text-sm">
              {report.reason === 'no_jump' ? '점프 동작이 감지되지 않았습니다.'
                : report.reason === 'sanity_fail' ? '측정값이 키 대비 비현실적입니다. 카메라 각도/위치를 확인하고 다시 측정하세요.'
                : report.rsi?.message ? report.rsi.message
                : '측정이 무효합니다. 다시 시도해 주세요.'}
            </p>
          </div>
        ) : (
          <>
            <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">점프 높이</p>
                <p className={`text-sm font-bold ${grade.color}`}>{grade.label}</p>
              </div>
              <p className="text-center font-mono font-black text-6xl text-slate-100">
                {report.heightCm}<span className="text-xl text-slate-500"> cm</span>
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="체공시간" value={`${report.flightTimeMs}ms`} />
                <Stat label="이륙속도" value={`${report.takeoffVelocity} m/s`} />
                <Stat label="최고파워" value={report.peakPower != null ? `${report.peakPower}W` : '체중 미입력'} />
              </div>
            </div>

            {isRsi
              ? <RsiReportSections report={report} biomech={biomech} viewLabel={viewLabel} />
              : <PowerReportSections report={report} biomech={biomech} viewLabel={viewLabel} crossCheck={cc} />}
          </>
        )}
      </div>

      {/* 액션 (캡처 영역 밖): 리포트 저장 + 동영상 저장 + 회차 기록 */}
      <div className="p-5 pt-0 space-y-2">
        <ReportActions
          reportNodeId="jump-live-report-sheet"
          videoBlob={report.videoBlob || null}
          onReportClick={() => onOpenSavedReport?.(report)}
          reportButtonLabel="📄 결과 리포트 보기"
          baseName={`${report.member?.name || '회원'}_점프`} onMessage={() => {}} />
        {report.valid === true && saveState !== 'saved' && (
          <button onClick={onSave}
            disabled={saveState === 'saving' || saveState === 'saved'}
            className="w-full rounded-xl bg-slate-700 text-white font-bold py-3 disabled:opacity-60 flex items-center justify-center gap-2">
            {saveState === 'saving' && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            {saveState === 'saved' ? '✓ 자동 저장됨' : saveState === 'saving' ? '저장 중...' : saveState === 'error' ? '↻ 다시 저장' : '💾 회차 기록 (데이터)'}
          </button>
        )}
        <button onClick={onRetry} className="w-full rounded-xl border border-slate-700 text-slate-200 font-bold py-3">
          다시 측정
        </button>
        {saveState === 'error' && <p className="text-center text-xs text-red-400">자동 저장 실패 — 위 버튼으로 다시 시도하세요</p>}
        {report.valid !== true && <p className="text-center text-xs text-amber-400">무효 측정은 저장되지 않습니다.</p>}
      </div>
    </div>
  );
}

function PowerReportSections({ report, biomech, viewLabel, crossCheck }) {
  const relativePower = report.peakPower != null && report.bodyWeight
    ? Math.round((report.peakPower / report.bodyWeight) * 10) / 10
    : null;
  const heightPct = report.calibHeightCm && report.heightCm
    ? Math.round((report.heightCm / report.calibHeightCm) * 1000) / 10
    : null;
  const rows = Array.isArray(report.perJump) ? report.perJump : [];

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="상대 파워" value={relativePower != null ? `${relativePower}W/kg` : '체중 필요'} />
        <MetricCard label="키 대비 높이" value={heightPct != null ? `${heightPct}%` : '—'} />
        <MetricCard label="감지 점프" value={`${report.jumps || 0}회`} />
        <MetricCard label="녹화 HUD" value={report.videoMetrics?.overlayRecorded ? '포함' : '미녹화'} />
      </div>

      <ReportPanel title="파워 점프 핵심 해석" tone="amber">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="폭발력 지표" value={report.peakPower != null ? `${report.peakPower}W` : '체중 필요'} />
          <MetricCard label="도약 속도" value={report.takeoffVelocity != null ? `${report.takeoffVelocity}m/s` : '—'} />
          <MetricCard label="체공 시간" value={report.flightTimeMs != null ? `${report.flightTimeMs}ms` : '—'} />
          <MetricCard label="주 측정값" value="최고 점프" />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          파워 점프는 한 번의 최대 수직 도약 능력을 보는 리포트입니다. 높이, 이륙속도, 최고파워, 체중 대비 파워를 함께 보고
          정면 촬영에서는 좌우 안정성과 착지 대칭을 보조 지표로 확인합니다.
        </p>
      </ReportPanel>

      <ReportPanel title="정면 안정성 및 착지 품질" tone="slate">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="감지 방향" value={viewLabel} />
          <MetricCard label="착지 대칭" value={biomech.footLandingSymmetry?.symmetryPct != null ? `${biomech.footLandingSymmetry.symmetryPct}%` : '—'} />
          <MetricCard label="골반 불균형" value={biomech.pelvicImbalance != null ? `${biomech.pelvicImbalance}°` : '—'} />
          <MetricCard label="신전 정렬도" value={biomech.extensionAlignment?.alignmentScore != null ? `${biomech.extensionAlignment.alignmentScore}점` : '—'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          파워 점프의 추천 방향은 정면입니다. 정면에서는 좌우 흔들림, 착지 발끝 대칭, 골반 기울기 변화를 더 직관적으로 확인할 수 있습니다.
        </p>
      </ReportPanel>

      <ReportPanel title="높이 교차 확인" tone="slate">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="비행시간 기반" value={`${report.heightCm}cm`} />
          <MetricCard label="골반변위 참고" value={crossCheck.heightCrossCm != null ? `${crossCheck.heightCrossCm}cm` : '—'} />
          <MetricCard label="차이" value={crossCheck.deltaPct != null ? `${crossCheck.deltaPct}%` : '—'} />
          <MetricCard label="판정" value={crossCheck.agree == null ? '참고' : crossCheck.agree ? '일치' : '차이 큼'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          최종 높이는 비행시간 기반 값을 사용합니다. 골반변위 추정은 카메라 거리와 각도 영향을 많이 받아 참고값으로만 표시합니다.
        </p>
      </ReportPanel>

      {rows.length > 0 && (
        <ReportPanel title="회차별 파워 점프 측정값" tone="amber">
          <div className="space-y-1.5">
            {rows.map((row) => {
              const jump = calcJump((row.flightMs || 0) / 1000, report.bodyWeight || null);
              return (
                <div key={row.no} className="grid grid-cols-5 gap-1 rounded-lg bg-slate-800/70 px-2 py-2 text-center">
                  <Stat label={`#${row.no}`} value={`${row.heightCm ?? '—'}cm`} />
                  <Stat label="체공" value={`${row.flightMs ?? '—'}ms`} />
                  <Stat label="속도" value={jump?.takeoffVelocity != null ? `${jump.takeoffVelocity}` : '—'} />
                  <Stat label="파워" value={jump?.peakPower != null ? `${jump.peakPower}W` : '—'} />
                  <Stat label="구간" value={`${Math.round((row.takeoffMs || 0) / 1000)}-${Math.round((row.landingMs || 0) / 1000)}s`} />
                </div>
              );
            })}
          </div>
        </ReportPanel>
      )}

      <ReportPanel title="추천 코칭 포인트" tone="amber">
        <GuideList items={[
          '정면 기준으로 무릎과 발끝 방향이 좌우로 크게 흔들리지 않는지 확인합니다.',
          '최고 높이만 보지 말고 체중 대비 파워와 착지 대칭을 함께 봅니다.',
          '다음 재측정은 같은 카메라 위치와 같은 기준 키로 진행해야 비교가 안정적입니다.',
        ]} />
      </ReportPanel>
    </>
  );
}

function RsiReportSections({ report, biomech, viewLabel }) {
  const rsi = report.rsi || {};
  const cycles = Array.isArray(rsi.perCycle) ? rsi.perCycle : [];
  const rows = Array.isArray(report.perJump) ? report.perJump : [];
  const basisText = rsi.rsiBasis === 'mean' ? '변동률 높음 · 평균값 채택' : '안정적 · 최고값 채택';

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="대표 RSI" value={rsi.rsi ?? '—'} />
        <MetricCard label="등급" value={rsi.grade?.label || '—'} />
        <MetricCard label="평균 접지" value={rsi.contactTimeMeanMs != null ? `${rsi.contactTimeMeanMs}ms` : '—'} />
        <MetricCard label="변동률" value={rsi.cvPct != null ? `${rsi.cvPct}%` : '—'} />
      </div>

      <ReportPanel title="RSI 반응성 핵심 해석" tone="emerald">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="최고 RSI" value={rsi.rsiBest ?? '—'} />
          <MetricCard label="평균 RSI" value={rsi.rsiMean ?? '—'} />
          <MetricCard label="대표값 기준" value={basisText} />
          <MetricCard label="유효 사이클" value={`${cycles.length}회`} />
          <MetricCard label="최고 접지" value={rsi.contactTimeMs != null ? `${rsi.contactTimeMs}ms` : '—'} />
          <MetricCard label="최고 체공" value={rsi.flightTimeMs != null ? `${rsi.flightTimeMs}ms` : '—'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          RSI는 높게 뛰는 능력보다 짧게 접지하고 빠르게 다시 튀어 오르는 반응 탄성을 봅니다. 회차 간 변동률이 높으면
          우연히 짧게 잡힌 접지시간을 피하기 위해 평균 RSI를 대표값으로 사용합니다.
        </p>
      </ReportPanel>

      {rsi.lowFps && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-bold leading-relaxed text-amber-300">
          접지 시간이 짧아 프레임 오차 영향이 커질 수 있습니다. RSI는 측면에서 120fps 이상, 가능하면 240fps 슬로우 모션 촬영을 권장합니다.
        </div>
      )}

      <ReportPanel title="연속 점프 사이클 분석" tone="emerald">
        <div className="space-y-1.5">
          {cycles.map((c, i) => (
            <div key={i} className="grid grid-cols-5 gap-1 rounded-lg bg-slate-800/70 px-2 py-2 text-center">
              <Stat label={`Cycle ${i + 1}`} value={c.rsi} />
              <Stat label="접지" value={`${c.contactMs}ms`} />
              <Stat label="체공" value={`${c.flightMs}ms`} />
              <Stat label="높이" value={`${c.heightCm}cm`} />
              <Stat label="보조" value={c.rsiHeight ?? '—'} />
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          최소 {RSI_REQUIRED_JUMPS}회 이상 연속 점프해야 접지시간과 체공시간의 반복 패턴을 안정적으로 볼 수 있습니다.
        </p>
      </ReportPanel>

      {rows.length > 0 && (
        <ReportPanel title="원본 점프별 영상 측정값" tone="slate">
          <div className="space-y-1.5">
            {rows.map((row) => (
              <div key={row.no} className="grid grid-cols-5 gap-1 rounded-lg bg-slate-800/70 px-2 py-2 text-center">
                <Stat label={`#${row.no}`} value={`${row.heightCm ?? '—'}cm`} />
                <Stat label="체공" value={`${row.flightMs ?? '—'}ms`} />
                <Stat label="접지" value={row.contactMs != null ? `${row.contactMs}ms` : '—'} />
                <Stat label="RSI" value={row.rsi ?? '—'} />
                <Stat label="구간" value={`${Math.round((row.takeoffMs || 0) / 1000)}-${Math.round((row.landingMs || 0) / 1000)}s`} />
              </div>
            ))}
          </div>
        </ReportPanel>
      )}

      <ReportPanel title="측면 자세 및 접지 품질" tone="slate">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="감지 방향" value={viewLabel} />
          <MetricCard label="착지 무릎각" value={biomech.landingKneeAngle != null ? `${biomech.landingKneeAngle}°` : '—'} />
          <MetricCard label="상체 변화" value={biomech.trunkLeanChange != null ? `${biomech.trunkLeanChange}°` : '—'} />
          <MetricCard label="착지 대칭" value={biomech.footLandingSymmetry?.symmetryPct != null ? `${biomech.footLandingSymmetry.symmetryPct}%` : '—'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          RSI의 추천 방향은 측면입니다. 측면에서는 발이 바닥에 닿는 순간과 다시 떨어지는 순간을 더 명확히 구분할 수 있어 접지시간 신뢰도가 올라갑니다.
        </p>
      </ReportPanel>

      <ReportPanel title="추천 코칭 포인트" tone="emerald">
        <GuideList items={[
          '착지 후 오래 버티지 말고 즉시 다시 튀어 오르는 리듬을 유지합니다.',
          '높이보다 접지시간과 회차별 RSI 변동률을 먼저 확인합니다.',
          '연속 점프 중 무릎이 과도하게 접히거나 상체가 무너지면 반응성이 떨어질 수 있습니다.',
        ]} />
      </ReportPanel>
    </>
  );
}

function ReportPanel({ title, tone = 'slate', children }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-500/25'
    : tone === 'amber'
      ? 'border-amber-500/25'
      : 'border-slate-800';
  const titleClass = tone === 'emerald'
    ? 'text-emerald-300'
    : tone === 'amber'
      ? 'text-amber-300'
      : 'text-slate-300';
  return (
    <div className={`bg-slate-900 border ${toneClass} rounded-2xl p-4 space-y-3`}>
      <p className={`text-xs font-bold ${titleClass}`}>{title}</p>
      {children}
    </div>
  );
}

function GuideList({ items }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item} className="flex gap-2 rounded-xl bg-slate-800/70 px-3 py-2 text-xs leading-relaxed text-slate-300">
          <span className="font-black text-slate-500">{i + 1}</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-800 rounded-xl py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="font-mono font-bold text-slate-200 text-sm">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-800 px-3 py-2">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="truncate text-sm font-bold text-slate-100">{value}</p>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-800 px-3 py-2 text-center">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="font-mono text-base font-black text-slate-100">{value}</p>
    </div>
  );
}

function JumpLiveOverlay({
  jumpType, phase, phaseColor, calibMsg, heightCm, jumpCount,
  liveJump, bestHeight, rsiCycles, jumpRows,
}) {
  const isRsi = jumpType === 'reactive';
  const latestCycle = rsiCycles.at(-1) || null;
  const mainValue = isRsi ? latestCycle?.rsi ?? liveJump.heightCm ?? '--' : liveJump.heightCm ?? bestHeight ?? '--';
  const mainUnit = isRsi ? (latestCycle?.rsi != null ? 'RSI' : 'cm') : 'cm';
  const readyText = isRsi ? `측면 · 연속 ${RSI_REQUIRED_JUMPS}회` : '정면 · 1회 최대 점프';
  const statusText = phase === 'air' ? '공중'
    : phase === 'ready' ? '준비됨'
    : phase === 'low_visibility' ? '자세 확인'
    : '기준 잡는 중';

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(50px,calc(env(safe-area-inset-top)+50px))] z-20 px-3">
      <div className="mx-auto max-w-[820px] rounded-2xl border border-white/15 bg-black/76 px-4 py-3 text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${
                phase === 'air' ? 'bg-amber-400' : phase === 'ready' ? 'bg-emerald-400' : phase === 'low_visibility' ? 'bg-red-400' : 'bg-cyan-400'
              }`} />
              <p className="truncate text-sm font-black text-white/90">
                {isRsi ? 'RSI 측정' : '파워 점프'} · {readyText}
              </p>
            </div>
            <p className={`mt-1 truncate text-xs font-bold ${phaseColor}`}>
              {statusText}{calibMsg ? ` · ${calibMsg}` : ` · 키 ${heightCm}cm 보정`}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-mono text-6xl font-black leading-none tracking-normal text-white max-[390px]:text-5xl">
              {mainValue}<span className="ml-1 text-lg text-amber-300 max-[390px]:text-base">{mainUnit}</span>
            </p>
            <p className="mt-1 text-xs font-bold text-white/65">
              {isRsi
                ? `GCT ${latestCycle?.contactMs ? `${latestCycle.contactMs}ms` : '--'} · flight ${liveJump.flightMs ? `${liveJump.flightMs}ms` : '--'} · ${jumpCount}/${RSI_REQUIRED_JUMPS}`
                : `체공 ${liveJump.flightMs ? `${liveJump.flightMs}ms` : '--'} · ${jumpCount}회`}
            </p>
          </div>
        </div>

        {jumpRows.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-hidden">
            {jumpRows.slice(-4).map((row) => (
              <div key={row.no} className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-center">
                <p className="text-[10px] font-bold text-white/45">#{row.no}</p>
                <p className="truncate font-mono text-base font-black text-white">
                  {isRsi ? (row.rsi != null ? row.rsi : `${row.heightCm ?? '--'}cm`) : `${row.heightCm ?? '--'}cm`}
                </p>
                <p className="truncate text-[10px] font-bold text-white/45">
                  {isRsi ? (row.contactMs ? `${row.contactMs}ms` : `${row.flightMs ?? '--'}ms`) : `${row.flightMs}ms`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 수동 입력 모달 — 실시간 화면 안에서 체공시간 직접 입력(점프매트/타이머).
// 자동 측정과 동일한 리포트 페이로드를 만들어 동일 저장 흐름을 탄다.
function ManualEntryModal({ member, jumpType = 'power', onClose, onSubmit }) {
  const isReactive = jumpType === 'reactive';
  const [flight, setFlight] = useState('');
  const [contact, setContact] = useState('');   // 반응 모드 전용(접지 시간)
  const [weight, setWeight] = useState(() => {
    const w = resolveWeight(member);
    return w != null ? String(w) : '';
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const ft = Number(flight);
    if (!ft || ft <= 0 || ft > 1.5) { alert('체공 시간을 초 단위로 입력하세요. (예: 0.50)'); return; }

    // ── 반응(RSI) 모드: 접지 시간이 있어야 RSI 산출 가능 ──
    if (isReactive) {
      const r = calcRSI(ft, Number(contact));
      if (!r) { alert('접지 시간을 초 단위로 입력하세요. (예: 0.20)'); return; }
      if (r.error) { alert(r.message); return; }
      setBusy(true);
      await onSubmit?.({
        valid: true, reason: 'ok', source: 'manual', jumpType: 'reactive', jumps: 1,
        flightTimeSec: ft, flightTimeMs: Math.round(ft * 1000),
        contactTimeSec: Number(contact), contactTimeMs: Math.round(Number(contact) * 1000),
        heightCm: r.heightCm, takeoffVelocity: r.takeoffVelocity,
        // 수동 RSI 결과를 카메라 RSI 와 같은 형태로 담아 리포트가 동일하게 표시
        rsi: {
          valid: true, reason: 'ok', mode: 'reactive', method: 'flight_over_contact',
          view: null, cycles: 1, rsi: r.rsi, rsiBasis: 'manual', rsiBest: r.rsi,
          rsiMean: r.rsi, rsiHeight: r.rsiHeight,
          contactTimeMs: Math.round(Number(contact) * 1000),
          flightTimeMs: Math.round(ft * 1000), heightCm: r.heightCm,
          cvPct: null, grade: rsiGrade(r.rsi), lowFps: false,
          frameIntervalMs: null, framesPerContact: null, perCycle: [],
        },
        member: { id: member?.id || null, name: member?.name || null },
        measuredAt: new Date().toISOString(),
      });
      setBusy(false);
      return;
    }

    // ── 파워 모드: 체공시간만으로 높이/파워 ──
    const r = calcJump(ft, weight ? Number(weight) : null);
    if (!r) { alert('계산 실패 — 입력값을 확인하세요.'); return; }
    setBusy(true);
    await onSubmit?.({
      valid: true, reason: 'ok', source: 'manual', jumpType: 'power', jumps: 1,
      flightTimeSec: ft, flightTimeMs: Math.round(ft * 1000),
      heightCm: r.heightCm, takeoffVelocity: r.takeoffVelocity, peakPower: r.peakPower,
      bodyWeight: weight ? Number(weight) : null,
      crossCheck: { heightCrossCm: null, deltaPct: null, agree: null },
      calibHeightCm: member?.height || null,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    });
    setBusy(false);
  };

  return (
    <div className="absolute inset-0 z-[88] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-white font-black">✍️ 수동 입력 {isReactive && <span className="text-emerald-400 text-xs">· RSI</span>}</p>
          <button onClick={onClose} className="text-slate-400 text-sm font-bold">닫기 ✕</button>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">체공 시간 (초)</label>
          <input type="number" inputMode="decimal" step="0.01" value={flight}
            onChange={e => setFlight(e.target.value)} placeholder="0.50"
            className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-amber-500" />
          <p className="text-[11px] text-slate-500 mt-1">점프매트·앱 타이머로 잰 발이 떠 있던 시간</p>
        </div>
        {isReactive ? (
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">접지 시간 (초)</label>
            <input type="number" inputMode="decimal" step="0.01" value={contact}
              onChange={e => setContact(e.target.value)} placeholder="0.20"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-emerald-500" />
            <p className="text-[11px] text-slate-500 mt-1">착지 후 다시 뛰기까지 지면에 닿은 시간. RSI = 체공 ÷ 접지</p>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">체중 (kg) <span className="text-slate-600">— 파워 계산 시</span></label>
            <input type="number" inputMode="numeric" step="0.1" value={weight}
              onChange={e => setWeight(e.target.value)} placeholder="70"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-amber-500" />
          </div>
        )}
        <button onClick={submit} disabled={busy}
          className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95 disabled:opacity-60">
          {busy ? '계산 중...' : isReactive ? 'RSI 분석' : '점프 분석'}
        </button>
        <p className="text-[11px] text-slate-500">
          {isReactive
            ? 'RSI = 체공 ÷ 접지(무단위). 높이 h=g·t²/8 추정값.'
            : '높이 h=g·t²/8, 이륙속도 v=g·t/2, 최고파워는 Sayers(체중 입력 시) 추정값.'}
        </p>
      </div>
    </div>
  );
}
