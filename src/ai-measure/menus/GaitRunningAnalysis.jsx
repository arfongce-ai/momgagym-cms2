import React, { useState, useEffect, useRef } from 'react';
import {
  GaitCycleTracker, jointAnglesFromPose, AngleAccumulator,
  pelvisRelativeFeet, cameraAngleQuality, detectOrientation
} from '../core/gaitBiomechanics';
import { loadPoseLandmarker, detectPoseFrame, closePoseLandmarker, isPoseReady } from '../core/poseBackend';
import { shareReportWithVideo } from '../core/reportShare';
import { drawMeasurementOverlay, formatRecordTime } from '../core/recordingOverlay';
import { lockZoom, unlockZoom } from '../../utils/viewportLock';

// 캘리브레이션: 세이프존 + 인식 안정이 이만큼 유지되면 락
const CALIB_HOLD_MS = 800; // 사람이 잡히면 거의 즉시 인식(0.8초 안정화로 깜빡임만 방지)
const RECORD_FPS = 30;
// 화면비별 녹화 출력 해상도 (캔버스 합성 → 검은 영역 없이 꽉 채워 크롭)
const OUTPUT_SIZE = {
  '3/4': { width: 1080, height: 1440 },
  '1/1': { width: 1080, height: 1080 },
};
// 원본 비디오를 타겟 비율에 맞춰 중앙 크롭 (검은 여백 없음)
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

function drawMetricOverlay(ctx, reportTimeMs, tracker, width, height) {
  const summary = tracker?.summary?.() || {};
  drawMeasurementOverlay(ctx, width, height, {
    title: 'GAIT LIVE',
    elapsedMs: reportTimeMs,
    metrics: [
      { label: 'CADENCE', value: summary.averageCadenceSpm != null ? `${summary.averageCadenceSpm} SPM` : '--' },
      { label: 'STANCE/SWING', value: (summary.stancePct != null) ? `${summary.stancePct}/${summary.swingPct}%` : '--' },
      { label: 'STEPS', value: summary.totalSteps ?? 0 },
    ],
  });
}
// BlazePose 하반신 연결 (보행 분석 핵심 부위 중심)
const POSE_BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24], // 어깨~골반
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31], // 왼다리
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32], // 오른다리
];
// 검출된 포즈를 카메라 위에 스틱 피규어로 그린다. object-cover 비디오에 맞춰 좌표 보정.
function drawSkeleton(canvas, video, landmarks, locked) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!landmarks) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  // object-cover: 비디오를 캔버스에 꽉 채우며 크롭. 정규화 좌표를 화면 픽셀로 변환.
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  const px = (p) => ox + p.x * dw;
  const py = (p) => oy + p.y * dh;
  const col = locked ? 'rgba(52,211,153,0.95)' : 'rgba(34,211,238,0.95)';
  // 뼈대
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [a, b] of POSE_BONES) {
    const pa = landmarks[a], pb = landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.visibility != null && pa.visibility < 0.3) || (pb.visibility != null && pb.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.moveTo(px(pa), py(pa)); ctx.lineTo(px(pb), py(pb)); ctx.stroke();
  }
  // 관절점
  ctx.fillStyle = locked ? 'rgba(52,211,153,1)' : 'rgba(255,255,255,0.95)';
  for (const i of [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
    const p = landmarks[i];
    if (!p || (p.visibility != null && p.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.arc(px(p), py(p), 5, 0, Math.PI * 2); ctx.fill();
  }
}

// 피사체가 중앙 세이프존(상하좌우 15% 여백) 안에 있는지
function isInSafeZone(lm) {
  if (!Array.isArray(lm)) return false;
  // 골반·무릎·발목 중 충분수가 세이프존 안에 있으면 OK.
  // 발(아래쪽)이 박스 하단을 살짝 넘는 건 흔하므로, '하나라도 벗어나면 실패'가
  // 아니라 '안에 든 개수'로 판정해 jitter·경계 걸침에 관대하게 한다.
  let inside = 0, seen = 0;
  for (const i of [23, 24, 25, 26, 27, 28]) {
    const p = lm[i];
    if (!p || (p.visibility != null && p.visibility < 0.3)) continue;
    seen += 1;
    // 좌우는 여유 있게(0.1~0.9), 상단만 0.12, 하단은 거의 끝까지(0.98) 허용
    if (p.x >= 0.10 && p.x <= 0.90 && p.y >= 0.12 && p.y <= 0.98) inside += 1;
  }
  // 관절이 충분히 보이고(>=3), 그중 다수(>=3)가 존 안에 있으면 통과
  return seen >= 3 && inside >= 3;
}

export default function GaitRunningAnalysis({ member, onBack, onSaveToFirebase, onSave, onOpenSavedReport }) {
  const saveToFirebase = onSaveToFirebase || onSave;

  const [view, setView] = useState('camera');
  const [isReady, setIsReady] = useState(false);   // 캘리브레이션 락
  const [recordingTime, setRecordingTime] = useState(0);
  const [warningMsg, setWarningMsg] = useState('');
  const [reportData, setReportData] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(''); // 녹화 영상 blob URL (state라야 비디오에 반영됨)
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error  회차 저장 상태
  const [shareMsg, setShareMsg] = useState('');
  const [poseLoaded, setPoseLoaded] = useState(false); // MediaPipe 준비 여부
  const [aspect, setAspect] = useState('3/4'); // 3/4 | 1/1
  const [orientation, setOrientation] = useState('unknown'); // side | back | unknown
  const orientationRef = useRef(null); // 히스테리시스용 직전 판정
  // 컴팩트 도구 (초시계/메트로놈)
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolTab, setToolTab] = useState('stopwatch');
  const [swElapsed, setSwElapsed] = useState(0);
  const [swRunning, setSwRunning] = useState(false);
  const [bpm, setBpm] = useState(160);
  const [metroPlaying, setMetroPlaying] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState({ cadence: null, stancePct: null, swingPct: null, totalSteps: 0 });

  const armingSinceRef = useRef(null); // 안정 인식 시작 시각(ms)
  const lastTsRef = useRef(0);         // detectForVideo 타임스탬프 단조증가 보장
  const lostFramesRef = useRef(0);     // 캘리브레이션 jitter 관용 카운터
  const isReadyRef = useRef(false);    // 스켈레톤 색상용 (락 상태 미러)
  const aspectRef = useRef('3/4');
  const composeRafRef = useRef(null);  // 캔버스 합성 루프
  const recordCanvasRef = useRef(null);
  const recordStreamRef = useRef(null);
  const recordingStartedAtRef = useRef(0);
  const autoSavedRef = useRef(null); // 자동 저장 중복 방지 (저장한 measuredAt 기록)
  const swBaseRef = useRef(0);
  const swStartedAtRef = useRef(0);
  const swRafRef = useRef(null);
  const metroCtxRef = useRef(null);
  const metroTimerRef = useRef(null);
  const metroNextNoteRef = useRef(0);
  const metroBeatRef = useRef(0);
  const metricsLastUiRef = useRef(0);

  const videoRef = useRef(null);
  const skeletonCanvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recordedBlobRef = useRef(null);
  const reqFrameRef = useRef(null);
  const viewRef = useRef('camera');
  const previewUrlRef = useRef(null);

  // 데이터 파이프라인 인스턴스
  const trackerRef = useRef(new GaitCycleTracker());
  const angleAccRef = useRef(new AngleAccumulator());

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { aspectRef.current = aspect; }, [aspect]);
  useEffect(() => { isReadyRef.current = isReady; }, [isReady]);

  useEffect(() => {
    if (!swRunning) return undefined;
    swStartedAtRef.current = performance.now();
    const tick = () => {
      setSwElapsed(swBaseRef.current + (performance.now() - swStartedAtRef.current));
      swRafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (swRafRef.current) cancelAnimationFrame(swRafRef.current);
      swRafRef.current = null;
      swBaseRef.current += performance.now() - swStartedAtRef.current;
    };
  }, [swRunning]);

  const resetStopwatch = () => {
    if (swRafRef.current) cancelAnimationFrame(swRafRef.current);
    swRafRef.current = null;
    swBaseRef.current = 0;
    swStartedAtRef.current = performance.now();
    setSwElapsed(0);
    setSwRunning(false);
  };

  useEffect(() => {
    if (metroTimerRef.current) {
      clearInterval(metroTimerRef.current);
      metroTimerRef.current = null;
    }
    if (!metroPlaying) return undefined;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return undefined;
    if (!metroCtxRef.current) metroCtxRef.current = new AudioCtor();
    const ctx = metroCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    metroNextNoteRef.current = ctx.currentTime + 0.05;
    metroBeatRef.current = 0;
    metroTimerRef.current = setInterval(() => {
      const secondsPerBeat = 60 / Math.max(40, Math.min(220, bpm));
      while (metroNextNoteRef.current < ctx.currentTime + 0.1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const downBeat = metroBeatRef.current % 4 === 0;
        osc.frequency.value = downBeat ? 1500 : 980;
        gain.gain.setValueAtTime(downBeat ? 0.45 : 0.24, metroNextNoteRef.current);
        gain.gain.exponentialRampToValueAtTime(0.001, metroNextNoteRef.current + 0.055);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(metroNextNoteRef.current);
        osc.stop(metroNextNoteRef.current + 0.055);
        metroNextNoteRef.current += secondsPerBeat;
        metroBeatRef.current += 1;
      }
    }, 25);
    return () => {
      if (metroTimerRef.current) clearInterval(metroTimerRef.current);
      metroTimerRef.current = null;
    };
  }, [metroPlaying, bpm]);

  // 카메라 생명주기 분리: camera 진입 시 켜고, preview 갈 때만 끔.
  // recording 중에는 스트림을 절대 건드리지 않는다(녹화 끊김 방지).
  useEffect(() => {
    if (view === 'camera' && !streamRef.current) {
      startCamera();
    } else if (view === 'preview') {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      // MediaPipe PoseLandmarker 를 CDN 런타임 로드(1회). GPU 실패 시 CPU 자동 폴백.
      loadPoseLandmarker({ numPoses: 1, modelTier: 'full' })
        .then(() => setPoseLoaded(true))
        .catch((e) => { setPoseLoaded(false); setWarningMsg(e?.message || 'AI 분석 모듈 로드 실패'); });
      startVisionPipeline();
    } catch (err) {
      setWarningMsg('카메라 권한을 허용해주세요.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null; // 중요: null 로 비워야 '다시 찍기' 시 카메라가 재시작됨
    }
    if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); reqFrameRef.current = null; }
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  // 실제 데이터 추출 루프: MediaPipe 추론 → 캘리브레이션 + 녹화 중 누적
  const startVisionPipeline = () => {
    if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current); // 중복 루프 방지
    // setState 과호출 방지용 직전값 캐시 (60fps 매프레임 setState → 발열·렌더폭주 차단)
    let lastReady = null, lastWarn = null;
    const setReadyOnce = (v) => { if (v !== lastReady) { lastReady = v; setIsReady(v); } };
    const setWarnOnce = (v) => { if (v !== lastWarn) { lastWarn = v; setWarningMsg(v); } };
    let lastOri = null;
    const setOrientationOnce = (v) => { if (v !== lastOri) { lastOri = v; setOrientation(v); } };
    const loop = () => {
      const video = videoRef.current;
      // 타임스탬프 단조증가 보장 (detectForVideo 는 같은 값 2회 시 예외)
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      let landmarks = null;
      try {
        const res = detectPoseFrame(video, ts); // 백엔드 미준비면 null
        landmarks = res?.landmarks || null;
      } catch (e) { landmarks = null; }

      // 스켈레톤 시각화 (검출 여부를 눈으로 확인 — 인식 신뢰성)
      try { drawSkeleton(skeletonCanvasRef.current, video, landmarks, isReadyRef.current); } catch (e) { /* noop */ }

      if (landmarks) {
        if (viewRef.current === 'recording') {
          // 녹화 중: 분석 누적 (화면엔 수치 미표시)
          trackerRef.current.push(pelvisRelativeFeet(landmarks), ts);
          angleAccRef.current.push(jointAnglesFromPose(landmarks));
          if (ts - metricsLastUiRef.current > 250) {
            metricsLastUiRef.current = ts;
            const s = trackerRef.current.summary();
            setLiveMetrics({
              cadence: s.averageCadenceSpm ?? null,
              stancePct: s.stancePct ?? null,
              swingPct: s.swingPct ?? null,
              totalSteps: s.totalSteps ?? 0,
              signalAmp: s.signalAmp ?? null,
            });
          }
        } else {
          // 방향 판별 (측면/후면) — 히스테리시스로 경계 떨림 방지.
          // unknown 이면 직전 판정을 유지해 잠깐 인식 실패 시 깜빡임을 막는다.
          const ori = detectOrientation(landmarks, orientationRef.current);
          if (ori.view !== 'unknown') { orientationRef.current = ori.view; setOrientationOnce(ori.view); }
          // 캘리브레이션: 앵글 품질 + 세이프존이 유지되면 락.
          // 후면뷰는 어깨가 넓어 high_angle 오판이 잦으므로 앵글 검사를 완화한다.
          const q = cameraAngleQuality(landmarks);
          const angleOk = orientationRef.current === 'back' ? true : q.ok;
          const inZone = isInSafeZone(landmarks);
          if (angleOk && inZone) {
            lostFramesRef.current = 0;
            if (armingSinceRef.current == null) armingSinceRef.current = ts;
            const held = ts - armingSinceRef.current;
            setReadyOnce(held >= CALIB_HOLD_MS);
            setWarnOnce(held >= CALIB_HOLD_MS ? '' : `자세 안정화 중... ${Math.min(99, Math.round(held / CALIB_HOLD_MS * 100))}%`);
          } else {
            // jitter 관용: 조건이 잠깐(최대 8프레임≈0.13s) 빠져도 타이머 유지
            lostFramesRef.current += 1;
            if (lostFramesRef.current > 8) {
              armingSinceRef.current = null;
              setReadyOnce(false);
              setWarnOnce(!angleOk ? '카메라를 골반 높이로 내려주세요'
                : '피사체를 가운데 박스 안에 맞춰주세요');
            }
          }
        }
      } else if (viewRef.current !== 'recording') {
        // 포즈 미검출 또는 백엔드 미연결
        armingSinceRef.current = null;
        lostFramesRef.current = 0;
        setReadyOnce(false);
        // isPoseReady() 는 모듈 전역값이라 stale 클로저 영향을 받지 않는다.
        setWarnOnce(isPoseReady()
          ? '사람 전신(머리~발)이 화면에 들어오게 해주세요'
          : 'AI 분석 모듈 로딩 중...');
      }

      reqFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  // 녹화 타이머 (1초 단위 경과)
  useEffect(() => {
    if (view !== 'recording') { setRecordingTime(0); return undefined; }
    const timer = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [view]);

  // 15초 자동 종료 (메모리 오버플로우 방지) — updater 부수효과 대신 별도 effect
  useEffect(() => {
    if (view === 'recording' && recordingTime >= 15) stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingTime, view]);

  // 캔버스 합성 녹화 스트림: 원본 비디오를 선택 비율로 크롭해 그린 캔버스를 녹화.
  // → 저장 영상이 항상 3:4 또는 1:1 로, 검은 여백 없이 꽉 차게 나온다.
  const createRecordedStream = () => {
    const video = videoRef.current;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    const size = OUTPUT_SIZE[aspectRef.current] || OUTPUT_SIZE['3/4'];
    canvas.width = size.width;
    canvas.height = size.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCover(ctx, video, canvas.width, canvas.height);
      drawMetricOverlay(
        ctx,
        performance.now() - recordingStartedAtRef.current,
        trackerRef.current,
        canvas.width,
        canvas.height
      );
      composeRafRef.current = requestAnimationFrame(draw);
    };
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    draw();
    const canvasStream = canvas.captureStream ? canvas.captureStream(RECORD_FPS) : null;
    if (!canvasStream) return streamRef.current; // 폴백: 원본 스트림
    const mixed = new MediaStream();
    canvasStream.getVideoTracks().forEach((t) => mixed.addTrack(t));
    streamRef.current?.getAudioTracks().forEach((t) => mixed.addTrack(t));
    recordStreamRef.current = mixed;
    return mixed;
  };

  const startRecording = () => {
    if (!isReady) return;
    chunksRef.current = [];
    trackerRef.current = new GaitCycleTracker(); // 녹화 시작 시 파이프라인 초기화
    angleAccRef.current = new AngleAccumulator();
    armingSinceRef.current = null;
    recordingStartedAtRef.current = performance.now();
    // 이전 측정의 저장/공유 상태 리셋 (재녹화 시 저장 버튼이 막히지 않도록)
    setSaveState('idle');
    setShareMsg('');
    setReportData(null);
    setLiveMetrics({ cadence: null, stancePct: null, swingPct: null, totalSteps: 0 });
    autoSavedRef.current = null;

    const mimeTypes = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
    let selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    const recordingStream = createRecordedStream(); // 캔버스 합성 스트림
    mediaRecorderRef.current = new MediaRecorder(recordingStream, { mimeType: selectedMime });
    mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mediaRecorderRef.current.onstop = () => {
      if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
      if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
      recordedBlobRef.current = new Blob(chunksRef.current, { type: selectedMime });

      // blob URL 을 즉시 생성해 state 로 넣는다(비디오 src 반영). 이전 URL 은 해제.
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(recordedBlobRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);

      // 녹화 종료 시 실제 누적된 분석 데이터를 리포트로 설정 (하드코딩 아님)
      const cycleSummary = trackerRef.current.summary();
      const angleSummary = angleAccRef.current.summary();

      setReportData({
        cadence: cycleSummary.averageCadenceSpm,
        stancePct: cycleSummary.stancePct,
        swingPct: cycleSummary.swingPct,
        totalSteps: cycleSummary.totalSteps,
        valid: cycleSummary.valid,
        signalAmp: cycleSummary.signalAmp,
        angles: angleSummary,
        aspect: aspectRef.current,
        member: { id: member?.id || null, name: member?.name || null },
        measuredAt: new Date().toISOString(),
      });
      setView('preview');
    };

    mediaRecorderRef.current.start(1000);
    setView('recording');
  };

  const handleStopAttempt = () => {
    if (recordingTime < 5) {
      setWarningMsg('최소 5초 이상 측정해야 합니다.');
      setTimeout(() => setWarningMsg(''), 2000);
      return;
    }
    stopRecording();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  // 리포트(JPG) + 영상 함께 공유/기기 저장. 데이터 저장과 독립.
  // 동영상만 저장/공유 (오버레이 합성된 녹화본).
  const handleShareVideo = async () => {
    const blob = recordedBlobRef.current || null;
    if (!blob) { setShareMsg('저장할 영상이 없습니다.'); return; }
    setShareMsg('영상 준비 중...');
    try {
      const res = await shareReportWithVideo(null, blob, {
        baseName: `${member?.name || '회원'}_보행분석`,
        title: '보행 분석 영상',
      });
      setShareMsg(res.msg);
    } catch (e) { setShareMsg('영상 저장 실패 — 다시 시도하세요'); }
  };

  // 리포트 화면 A4 JPG 저장과 회차 데이터 수동저장은 '결과 리포트' 화면(ReportActions)과
  // 자동 저장(useEffect)으로 일원화되어 여기서는 제거되었다.

  // 자동 저장: 유효 측정(valid)인 리포트가 생성되면 1회 자동으로 서버 저장.
  // - 무효 측정(누워있음/정지)은 자동 저장하지 않음 → 서버에 쓰레기 데이터 방지.
  // - measuredAt 으로 측정당 1회만 (중복/재렌더 저장 차단).
  // - 실패하면 saveState='error' 가 되어 수동 재시도 버튼이 노출된다.
  useEffect(() => {
    if (view !== 'preview' || !reportData) return;
    if (reportData.valid !== true) return; // 무효 측정은 자동 저장 안 함
    if (typeof saveToFirebase !== 'function') return;
    if (autoSavedRef.current === reportData.measuredAt) return; // 이미 저장(시도)함
    autoSavedRef.current = reportData.measuredAt;
    (async () => {
      setSaveState('saving');
      try {
        await saveToFirebase(reportData);
        setSaveState('saved');
      } catch (e) {
        setSaveState('error'); // 실패 시 수동 버튼으로 재시도 가능
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, reportData]);

  // 다시 찍기 등으로 preview 를 벗어날 때 blob URL 정리
  useEffect(() => {
    if (view !== 'preview' && previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl('');
    }
  }, [view]);

  useEffect(() => () => {
    stopCamera();
    if (swRafRef.current) cancelAnimationFrame(swRafRef.current);
    if (metroTimerRef.current) clearInterval(metroTimerRef.current);
    if (metroCtxRef.current) {
      try { metroCtxRef.current.close(); } catch (e) { /* noop */ }
    }
    closePoseLandmarker();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 카메라 측정 화면: 확대 잠금 (언마운트 시 복원)
  useEffect(() => { lockZoom(); return () => unlockZoom(); }, []);

  return (
    <div
      className="fixed inset-0 z-[80] w-screen bg-slate-950 overflow-hidden flex flex-col font-sans"
      style={{ height: '100dvh' }}
    >
      {(view === 'camera' || view === 'recording') && (
        <>
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay />
          {/* 검출된 포즈 스켈레톤 오버레이 (인식 확인용) */}
          <canvas ref={skeletonCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          {/* (장식성 HUD 오버레이 제거 — 스켈레톤 + 프레임만 남김) */}
          {/* 세이프 존 가이드 (상하좌우 15% 여백) — 캘리브레이션 시 녹색 */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-[15%]">
            <div className={`w-full h-full border-4 rounded-lg transition-colors ${isReady ? 'border-green-500/70' : 'border-white/30'}`} />
          </div>
          <div className="absolute top-0 z-20 w-full p-4 flex justify-between items-start bg-gradient-to-b from-black/60 to-transparent">
            <button onClick={onBack} className="measure-back">← 뒤로</button>
            <div className="text-center">
              <h1 className="measure-title">보행 & 런닝 분석</h1>
              {view === 'camera' && (
                <p className="text-sm font-bold text-amber-400 mt-1 drop-shadow-md">
                  {poseLoaded ? '일정한 속도로 뛸 때 시작하세요' : 'AI 분석 모듈 준비 중...'}
                </p>
              )}
              {/* 측면/후면 자동 판별 표시 */}
              {poseLoaded && orientation !== 'unknown' && (
                <span className={`inline-block mt-1 rounded-full px-2.5 py-0.5 text-[11px] font-black ${orientation === 'side' ? 'bg-emerald-500/90 text-slate-950' : 'bg-sky-500/90 text-white'}`}>
                  {orientation === 'side' ? '◧ 측면뷰 (관절 각도 분석)' : '⬓ 후면뷰 (좌우 대칭 분석)'}
                </span>
              )}
              {warningMsg && <p className="text-sm font-bold text-red-400 mt-1 bg-black/50 px-2 py-1 rounded">{warningMsg}</p>}
            </div>
            {/* 화면비 선택 (녹화 전에만) */}
            {view === 'camera' ? (
              <div className="flex gap-1 rounded-xl bg-black/55 p-1 backdrop-blur">
                {['3/4', '1/1'].map((r) => (
                  <button key={r} onClick={() => setAspect(r)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-black ${aspect === r ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
                    {r === '3/4' ? '3:4' : '1:1'}
                  </button>
                ))}
              </div>
            ) : <div className="w-10" />}
          </div>
          {/* 작동하는 컴팩트 도구 (초시계/메트로놈) — 좌측 하단 */}
          <CompactTools
            open={toolsOpen} onToggleOpen={() => setToolsOpen(v => !v)}
            tab={toolTab} onTab={setToolTab}
            bpm={bpm} onBpm={setBpm} metroPlaying={metroPlaying} onMetroPlaying={setMetroPlaying}
            swElapsed={swElapsed} swRunning={swRunning} onSwRunning={setSwRunning} onSwReset={resetStopwatch}
          />
          <div className="absolute bottom-0 z-20 w-full p-6 bg-gradient-to-t from-black/80 to-transparent flex flex-col items-center gap-4">
            {view === 'recording' && (
              <div className="w-full max-w-md h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${recordingTime >= 5 ? 'bg-green-500' : 'bg-orange-500'}`}
                  style={{ width: `${(recordingTime / 15) * 100}%` }}
                />
              </div>
            )}
            {view === 'camera' ? (
              <button onClick={startRecording} disabled={!isReady} className={`w-20 h-20 rounded-full border-4 transition-all ${isReady ? 'border-green-500 bg-red-500' : 'border-slate-500 bg-slate-600'}`} />
            ) : (
              <button onClick={handleStopAttempt} className="w-20 h-20 rounded-full bg-slate-200 flex items-center justify-center text-red-600 text-3xl pb-2">■</button>
            )}
          </div>
        </>
      )}

      {view === 'preview' && (
        <div className="absolute inset-0 flex flex-col md:flex-row bg-slate-900">
          <div className="relative flex-1 md:flex-[2] bg-black flex items-center justify-center overflow-hidden">
            {/* 저장 비율(3:4 또는 1:1)에 맞춘 컨테이너 → 검은 여백은 위아래에만 생기고 좌우엔 없음 */}
            <div
              className="relative max-h-full max-w-full"
              style={{ aspectRatio: (reportData?.aspect || '3/4').replace('/', ' / '), height: '100%' }}
            >
              <video src={previewUrl || ''} className="w-full h-full object-cover" controls playsInline autoPlay loop muted />
            </div>
            <div className="absolute top-4 left-4 bg-black/60 p-3 rounded-lg backdrop-blur-md">
              {reportData?.valid === false ? (
                <>
                  <p className="text-red-400 font-bold">⚠ 측정 무효</p>
                  <p className="text-white text-xs">보행 동작이 감지되지 않았습니다</p>
                </>
              ) : (
                <>
                  <p className="text-amber-400 font-bold">SPM: {reportData?.cadence}</p>
                  <p className="text-white text-sm">입각기: {reportData?.stancePct}% | 유각기: {reportData?.swingPct}%</p>
                </>
              )}
            </div>
            <button onClick={() => setView('camera')} className="absolute top-4 right-4 bg-white/20 text-white px-4 py-2 rounded-lg backdrop-blur-md font-bold">✕ 다시 찍기</button>
          </div>
          <div id="gait-live-report-sheet" className="flex-1 bg-slate-800 p-6 overflow-y-auto">
            <h2 className="text-2xl font-black text-white mb-6">측정 리포트</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-700 p-4 rounded-xl">
                <p className="text-slate-400 text-sm">평균 케이던스</p>
                <p className="text-2xl font-bold text-white">{reportData?.cadence} <span className="text-sm">SPM</span></p>
              </div>
              <div className="bg-slate-700 p-4 rounded-xl">
                <p className="text-slate-400 text-sm">비율 (Stance/Swing)</p>
                <p className="text-2xl font-bold text-white">{reportData?.stancePct}% / {reportData?.swingPct}%</p>
              </div>
            </div>
            <div className="bg-slate-700 p-4 rounded-xl mb-6">
              <h3 className="text-slate-300 font-bold mb-3">관절 가동 범위 (ROM)</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-white"><span className="text-slate-400">고관절</span> <span>{reportData?.angles?.hip?.rom ?? 0}°</span></div>
                <div className="flex justify-between text-white"><span className="text-slate-400">무릎</span> <span>{reportData?.angles?.knee?.rom ?? 0}°</span></div>
                <div className="flex justify-between text-white"><span className="text-slate-400">발목</span> <span>{reportData?.angles?.ankle?.rom ?? 0}°</span></div>
              </div>
            </div>
            <div className="space-y-2">
              {/* '리포트 저장'은 즉석 캡처 대신 '결과 리포트' 화면으로 이동한다.
                  결과 리포트 안에서 리포트 저장(A4)·동영상 저장을 제공한다.
                  유효 측정은 백그라운드에서 이미 자동 저장됨(useEffect) → 별도 회차기록 버튼 제거. */}
              <button
                onClick={() => onOpenSavedReport?.(reportData, recordedBlobRef.current || null)}
                className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3.5 text-sm active:scale-95">
                📄 결과 리포트 보기
              </button>
              <button onClick={handleShareVideo} className="w-full rounded-xl border border-slate-600 bg-slate-700 text-white font-bold py-3 text-sm active:scale-95">
                📹 동영상 저장
              </button>
              {shareMsg && <p className="text-center text-xs text-emerald-400">{shareMsg}</p>}
              {reportData?.valid !== true && (
                <p className="text-center text-xs text-amber-400">측정이 무효하여 저장되지 않았습니다. 다시 측정해 주세요.</p>
              )}
              <p className="text-center text-[11px] text-slate-500">영상은 기기에, 회차 기록(정량 데이터)은 서버에 자동 저장됩니다.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 작동하는 컴팩트 도구 (좌측 하단) ───────── */
function CompactTools({ open, onToggleOpen, tab, onTab, bpm, onBpm, metroPlaying, onMetroPlaying, swElapsed, swRunning, onSwRunning, onSwReset }) {
  return (
    <div className="absolute bottom-[max(96px,calc(env(safe-area-inset-bottom)+96px))] left-3 z-20 w-[170px]">
      {open && (
        <div className="mb-2 rounded-2xl bg-black/55 backdrop-blur border border-white/10 p-2 text-white shadow-lg">
          <div className="mb-2 flex gap-1 rounded-full bg-black/30 p-0.5">
            {[['stopwatch', '초시계'], ['metronome', '메트로놈']].map(([k, label]) => (
              <button key={k} onClick={() => onTab(k)}
                className={`flex-1 rounded-full px-2 py-1 text-[10px] font-bold ${tab === k ? 'bg-amber-500/90 text-slate-950' : 'text-white/70'}`}>{label}</button>
            ))}
          </div>
          {tab === 'metronome'
            ? <CompactMetronome bpm={bpm} playing={metroPlaying} onBpm={onBpm} onPlaying={onMetroPlaying} />
            : <CompactStopwatch elapsed={swElapsed} running={swRunning} onRunning={onSwRunning} onReset={onSwReset} />}
        </div>
      )}
      <button onClick={onToggleOpen} className="flex items-center gap-2 rounded-full bg-black/55 backdrop-blur border border-white/10 px-3 py-1.5 text-white shadow-lg">
        <span className={`h-2 w-2 rounded-full ${(metroPlaying || swRunning) ? 'bg-amber-400 animate-pulse' : 'bg-white/40'}`} />
        <span className="font-mono text-xs font-bold text-amber-300">{tab === 'metronome' ? `${bpm} BPM` : fmtSw(swElapsed)}</span>
        <span className="text-[10px] text-white/50">{open ? '▾' : '▴'}</span>
      </button>
    </div>
  );
}

function fmtSw(ms) {
  const s = Math.floor(ms / 1000), cs = Math.floor((ms % 1000) / 10);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function CompactStopwatch({ elapsed, running, onRunning, onReset }) {
  const toggle = () => onRunning(!running);
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 rounded-lg bg-black/25 py-1.5 text-center font-mono text-base font-black tabular-nums text-amber-300">{fmtSw(elapsed)}</div>
      <button onClick={toggle} className={`h-9 w-12 rounded-lg text-[11px] font-black ${running ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>{running ? '정지' : '시작'}</button>
      <button onClick={onReset} className="h-9 w-10 rounded-lg border border-white/15 text-[11px] font-bold text-white/75">리셋</button>
    </div>
  );
}

function CompactMetronome({ bpm, playing, onBpm, onPlaying }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onBpm(Math.max(40, bpm - 5))} className="h-9 w-8 rounded-lg border border-white/15 text-xs font-black text-white/75">-</button>
      <div className="flex-1 rounded-lg bg-black/25 py-1.5 text-center font-mono text-lg font-black text-amber-300">{bpm}</div>
      <button onClick={() => onBpm(Math.min(220, bpm + 5))} className="h-9 w-8 rounded-lg border border-white/15 text-xs font-black text-white/75">+</button>
      <button onClick={() => onPlaying(!playing)} className={`h-9 w-12 rounded-lg text-[11px] font-black ${playing ? 'bg-white/20 text-white' : 'bg-amber-500/90 text-slate-950'}`}>{playing ? '정지' : '시작'}</button>
    </div>
  );
}
