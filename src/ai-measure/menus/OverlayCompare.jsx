// ai-measure/menus/OverlayCompare.jsx
// 전/후 비교 — 사진·영상 오버레이 & 어니언 스킨 비교 도구.
//  · 레이어 A(기준/전)·B(비교/후)를 업로드하면 자동으로 발목 위치를 인식해
//    정렬하고(core/poseImageBackend.js), 투명도 슬라이더로 미세한 차이를
//    비교한다. 영상일 때는 A 길이에 맞춰 B의 재생속도를 자동으로 맞춘다.
//  · 값을 산출/판정하는 측정 화면이 아니라 시각 비교 도구라 별도 저장
//    (Firestore)은 하지 않는다 — 녹화 영상이 트레이너 폰에만 저장되고
//    스냅샷도 로컬 data URL로만 존재하는 기존 정책(recordSink.js 주석 참고)과
//    같은 이유로, 비교 스냅샷은 그 자리에서 다운로드하는 것까지만 지원한다.
//  · 다른 화면(자세측정 리포트 등)이 이미 들고 있는 사진/영상을 새로 업로드
//    하지 않고 바로 넘겨줄 수 있도록 window.postMessage 연동 API를 연다
//    (하단 "외부 연동 API" 섹션 참고).
import { useState, useRef, useCallback, useEffect } from 'react';
import { useHardwareBack } from '../core/useHardwareBack';
import { loadImagePoseLandmarker, detectPoseImage } from '../core/poseImageBackend';
import { clamp, computeContainRect, solveAutoAlign, extractAnkleData } from '../core/overlayAlign';

const BLEND_OPTIONS = [
  { value: 'normal', label: '기본(Normal)' },
  { value: 'difference', label: '차이 강조(Difference)' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'lighten', label: 'Lighten' },
];

const REC_MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

// 화면 배율(devicePixelRatio)만큼 캔버스 실제 픽셀 수를 늘려 녹화하고(레티나
// 화면에서 CSS 픽셀 그대로 녹화하면 해상도가 낮아 흐릿해짐 — 스냅샷은 이미
// 이렇게 하고 있어 영상도 동일하게 맞춘다), 해상도가 커진 만큼 비트레이트도
// 함께 올려야 압축 때문에 해상도 이득이 뭉개지지 않는다.
function computeRecordBitrate(pixelW, pixelH) {
  const bpp = 0.12; // VP9 기준 프레임당 비트/픽셀 — 여유 있게 고화질 쪽으로
  return clamp(Math.round(pixelW * pixelH * 30 * bpp), 6_000_000, 20_000_000);
}

const SCALE_MIN = 30;
const SCALE_MAX = 300;
const OFFSET_MIN = -300;
const OFFSET_MAX = 300;

function fmtTime(s) {
  if (!Number.isFinite(s)) return '00:00.0';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ALIGN_PROGRESS_STEPS = [
  { key: 'confirm', label: '레이어 A 위치 확인' },
  { key: 'autoAlign', label: '레이어 B 자동 정렬 (A 기준 · 발목)' },
  { key: 'apply', label: '오버레이 적용' },
];

function emptyLayer() {
  return { type: null, url: null, name: '', ready: false };
}

async function shareOrDownloadFile(file, title) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, files: [file] });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

export default function OverlayCompare({ onBack }) {
  // 1 업로드 → 2 정렬(자동 파이프라인 진행 화면) → 3 비교
  const [step, setStep] = useState(1);
  const [layerA, setLayerA] = useState(emptyLayer());
  const [layerB, setLayerB] = useState(emptyLayer());

  const [opacity, setOpacity] = useState(50);
  const [blend, setBlend] = useState('normal');
  const [grayscale, setGrayscale] = useState(true);
  const [align, setAlign] = useState({ x: 0, y: 0, scale: 100, flip: false });
  const [guides, setGuides] = useState(false);
  const [checker, setChecker] = useState(true);
  const [alignStatus, setAlignStatus] = useState({
    text: '두 레이어를 모두 업로드하면 자동 정렬을 사용할 수 있어요.',
    kind: 'dim',
  });
  const [alignProgress, setAlignProgress] = useState({ confirm: 'pending', autoAlign: 'pending', apply: 'pending' });
  const [alignPipelineError, setAlignPipelineError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [fps, setFps] = useState(30);
  const [autoEdit, setAutoEdit] = useState(true);
  const [lock, setLock] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [timeA, setTimeA] = useState('00:00.0 / 00:00.0');
  const [timeB, setTimeB] = useState('00:00.0 / 00:00.0');
  const [isRecording, setIsRecording] = useState(false);

  // 최신 상태를 이벤트 핸들러·비동기 콜백 안에서 스테일 클로저 없이 읽기 위한
  // ref들 — usePoseEngine.js의 onResultRef 패턴과 동일한 이유.
  const layerARef = useRef(layerA); layerARef.current = layerA;
  const layerBRef = useRef(layerB); layerBRef.current = layerB;
  const alignRef = useRef(align); alignRef.current = align;
  const autoEditRef = useRef(autoEdit); autoEditRef.current = autoEdit;
  const lockRef = useRef(lock); lockRef.current = lock;
  const fpsRef = useRef(fps); fpsRef.current = fps;
  const lockOffsetRef = useRef(0);
  const opacityRef = useRef(opacity); opacityRef.current = opacity;
  const blendRef = useRef(blend); blendRef.current = blend;
  const grayscaleRef = useRef(grayscale); grayscaleRef.current = grayscale;
  // rate/playbackSpeed는 재생 배속 관련 이벤트 핸들러(useCallback, 빈 deps)
  // 안에서 최신값을 즉시 읽고 즉시 갱신해야 하므로 ref를 함께 둔다 — 값을
  // 바꾸는 지점에서는 setState와 함께 ref도 그 자리에서 바로 갱신한다.
  const rateRef = useRef(rate); rateRef.current = rate;
  const playbackSpeedRef = useRef(playbackSpeed); playbackSpeedRef.current = playbackSpeed;
  const loopRef = useRef(loop); loopRef.current = loop;
  const loopRestartPendingRef = useRef(false);

  const stageRef = useRef(null);
  const imgARef = useRef(null);
  const videoARef = useRef(null);
  const imgBRef = useRef(null);
  const videoBRef = useRef(null);

  // 영상 저장(녹화) 관련 — canvas.captureStream() + MediaRecorder를 쓰므로
  // React 렌더와 무관하게 매 프레임 갱신되는 값들은 ref로 들고 있는다.
  const recorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordRafRef = useRef(null);
  const recordCanvasRef = useRef(null);
  const recordCtxRef = useRef(null);
  const recordMimeTypeRef = useRef(null);

  const isVideoA = layerA.type === 'video';
  const isVideoB = layerB.type === 'video';
  const showVideoPanel = isVideoA || isVideoB;

  useHardwareBack(step > 1, () => setStep(1));

  // ---------------------------------------------------------------
  // 파일 업로드 (또는 외부 postMessage 연동에서의 Blob/URL 주입)
  // ---------------------------------------------------------------
  const setLayerBySlot = useCallback((slot, patch) => {
    const setter = slot === 'A' ? setLayerA : setLayerB;
    setter((prev) => ({ ...prev, ...patch }));
  }, []);

  const assignMediaToSlot = useCallback((slot, { type, url, name }) => {
    const prev = (slot === 'A' ? layerARef : layerBRef).current;
    if (prev.url) URL.revokeObjectURL(prev.url);
    const setter = slot === 'A' ? setLayerA : setLayerB;
    setter({ type: type || null, url: url || null, name: name || '', ready: false });
  }, []);

  const loadFile = useCallback((slot, file) => {
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      alert('이미지 또는 동영상 파일만 업로드할 수 있습니다.');
      return;
    }
    const url = URL.createObjectURL(file);
    assignMediaToSlot(slot, { type: isVideo ? 'video' : 'image', url, name: file.name });
  }, [assignMediaToSlot]);

  const markReady = useCallback((slot) => setLayerBySlot(slot, { ready: true }), [setLayerBySlot]);

  useEffect(() => () => {
    if (layerARef.current.url) URL.revokeObjectURL(layerARef.current.url);
    if (layerBRef.current.url) URL.revokeObjectURL(layerBRef.current.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------
  // 순수 기하 도우미(overlayAlign.js) 재사용
  // ---------------------------------------------------------------
  const setAlignStatusSafe = useCallback((text, kind = 'dim') => setAlignStatus({ text, kind }), []);

  const resetAlign = useCallback(() => {
    setAlign({ x: 0, y: 0, scale: 100, flip: false });
  }, []);

  // ---------------------------------------------------------------
  // 영상 프레임 → 캔버스 캡처(정지 이미지 포즈 인식용)
  // ---------------------------------------------------------------
  function seekVideoTo(video, t) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - t) < 0.01 && video.readyState >= 2) return resolve();
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
      video.addEventListener('seeked', onSeeked);
      try { video.currentTime = t; } catch (e) { /* noop */ }
      setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 1500);
    });
  }

  async function captureFrameCanvas(slot) {
    const layer = (slot === 'A' ? layerARef : layerBRef).current;
    if (!layer.type) return null;
    if (layer.type === 'image') {
      const img = slot === 'A' ? imgARef.current : imgBRef.current;
      if (!img || !img.naturalWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return { canvas, w: img.naturalWidth, h: img.naturalHeight };
    }
    const video = slot === 'A' ? videoARef.current : videoBRef.current;
    if (!video || !video.videoWidth) return null;
    await seekVideoTo(video, 0);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return { canvas, w: video.videoWidth, h: video.videoHeight };
  }

  // ---------------------------------------------------------------
  // 자동 정렬(발목 기준)
  // ---------------------------------------------------------------
  const runAutoAlign = useCallback(async () => {
    if (!layerARef.current.type || !layerBRef.current.type) {
      setAlignStatusSafe('두 레이어를 모두 업로드하면 자동 정렬을 사용할 수 있어요.', 'dim');
      return false;
    }
    setAlignStatusSafe('포즈 인식 모델을 불러오는 중…', 'dim');
    try {
      await loadImagePoseLandmarker();
    } catch (e) {
      setAlignStatusSafe('AI 모델을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. (수동 슬라이더는 계속 사용할 수 있어요)', 'danger');
      return false;
    }
    setAlignStatusSafe('발목 위치를 분석하는 중…', 'dim');
    const frameA = await captureFrameCanvas('A');
    const frameB = await captureFrameCanvas('B');
    if (!frameA || !frameB) {
      setAlignStatusSafe('이미지를 불러오지 못했습니다.', 'danger');
      return false;
    }
    let resA;
    let resB;
    try {
      resA = detectPoseImage(frameA.canvas);
      resB = detectPoseImage(frameB.canvas);
    } catch (e) {
      setAlignStatusSafe('포즈 분석 중 오류가 발생했습니다.', 'danger');
      return false;
    }
    const dataA = extractAnkleData(resA);
    const dataB = extractAnkleData(resB);
    if (!dataA || !dataB) {
      setAlignStatusSafe('사람을 인식하지 못했습니다. 전신이 잘 보이는 사진/영상으로 시도해 주세요.', 'danger');
      return false;
    }
    const stage = stageRef.current;
    const stageRect = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 };
    if (!stageRect.width || !stageRect.height) {
      setAlignStatusSafe('화면 크기를 확인하지 못했습니다. 다시 시도해 주세요.', 'danger');
      return false;
    }
    const rectA = computeContainRect(frameA.w, frameA.h, stageRect.width, stageRect.height);
    const rectB = computeContainRect(frameB.w, frameB.h, stageRect.width, stageRect.height);
    const result = solveAutoAlign({
      stageW: stageRect.width,
      stageH: stageRect.height,
      rectA,
      rectB,
      ankleA: dataA.ankle,
      ankleB: dataB.ankle,
      refA: dataA.ref,
      refB: dataB.ref,
      flip: alignRef.current.flip,
      scaleMin: SCALE_MIN,
      scaleMax: SCALE_MAX,
      offsetMin: OFFSET_MIN,
      offsetMax: OFFSET_MAX,
    });
    setAlign((prev) => ({ ...prev, x: result.x, y: result.y, scale: result.scale }));
    setAlignStatusSafe('자동 정렬 완료 ✓ (발목 기준)', 'success');
    return true;
  }, [setAlignStatusSafe]);

  // ---------------------------------------------------------------
  // 영상 자동 편집: B의 재생속도를 A 길이에 맞춘다
  // ---------------------------------------------------------------
  const applyAutoSpeedMatch = useCallback(() => {
    const vA = videoARef.current;
    const vB = videoBRef.current;
    if (!vA || !vB) return;
    const durA = vA.duration;
    const durB = vB.duration;
    if (!Number.isFinite(durA) || !Number.isFinite(durB) || durA <= 0 || durB <= 0) return;
    const nextRate = clamp(durB / durA, 0.25, 4);
    rateRef.current = nextRate;
    vB.playbackRate = nextRate * playbackSpeedRef.current;
    setRate(nextRate);
    setLock(false);
  }, []);

  const runAutoPipeline = useCallback(async () => {
    if (layerARef.current.type === 'video' && layerBRef.current.type === 'video' && autoEditRef.current) {
      applyAutoSpeedMatch();
    }
    try { await runAutoAlign(); } catch (e) { /* 상태 메시지는 runAutoAlign 내부에서 이미 설정됨 */ }
  }, [applyAutoSpeedMatch, runAutoAlign]);

  // 2단계(정렬) 화면: "레이어 A 위치 확인 → 레이어 B 자동 정렬(A 기준) → 오버레이
  // 적용" 3단계를 눈에 보이게 진행시킨 뒤 비교 화면(3단계)으로 자동 전환한다.
  // 실패해도 막지 않고, 사용자가 다음 화면에서 슬라이더로 직접 조정할 수 있음을
  // 안내한 뒤 "계속하기" 버튼으로 진행하게 한다.
  const runAlignSequence = useCallback(async () => {
    setAlignProgress({ confirm: 'active', autoAlign: 'pending', apply: 'pending' });
    setAlignPipelineError('');

    await wait(220);
    setAlignProgress((prev) => ({ ...prev, confirm: 'done', autoAlign: 'active' }));

    if (layerARef.current.type === 'video' && layerBRef.current.type === 'video' && autoEditRef.current) {
      applyAutoSpeedMatch();
    }
    let ok = true;
    try { ok = await runAutoAlign(); } catch (e) { ok = false; }
    setAlignProgress((prev) => ({ ...prev, autoAlign: ok ? 'done' : 'failed' }));

    if (!ok) {
      setAlignPipelineError('자동 정렬에 실패했어요. 다음 화면에서 슬라이더로 직접 위치를 맞출 수 있어요.');
      return;
    }

    await wait(200);
    setAlignProgress((prev) => ({ ...prev, apply: 'active' }));
    await wait(280);
    setAlignProgress((prev) => ({ ...prev, apply: 'done' }));
    await wait(300);
    setStep(3);
  }, [applyAutoSpeedMatch, runAutoAlign]);

  // 두 레이어가 모두 준비되면 자동으로 정렬 화면(2단계)으로 전환하고
  // 자동 정렬·자동 편집 파이프라인을 실행한다.
  useEffect(() => {
    if (layerA.type && layerB.type && layerA.ready && layerB.ready) {
      setStep(2);
      const raf1 = requestAnimationFrame(() => {
        requestAnimationFrame(() => { runAlignSequence(); });
      });
      return () => cancelAnimationFrame(raf1);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerA.type, layerA.ready, layerA.url, layerB.type, layerB.ready, layerB.url]);

  // 새 영상이 로드되면(업로드·교체) 현재 재생 속도(rate × playbackSpeed) 설정을
  // 이어서 적용한다 — 새로 생성된 <video> 엘리먼트는 기본 playbackRate(1)로
  // 시작하므로, 기존에 맞춰둔 배속을 그대로 유지하려면 다시 적용해 줘야 한다.
  useEffect(() => {
    if (videoARef.current) videoARef.current.playbackRate = playbackSpeedRef.current;
    if (videoBRef.current) videoBRef.current.playbackRate = rateRef.current * playbackSpeedRef.current;
  }, [isVideoA, isVideoB]);

  // ---------------------------------------------------------------
  // 레이어 교체(A ↔ B)
  // ---------------------------------------------------------------
  const swapLayers = useCallback(() => {
    setLayerA(layerBRef.current);
    setLayerB(layerARef.current);
    resetAlign();
    setAlignStatusSafe('레이어를 교체했습니다. 다시 정렬해 보세요.', 'dim');
    setTimeout(() => {
      if (layerBRef.current.type && layerARef.current.type) runAutoPipeline();
    }, 0);
  }, [resetAlign, runAutoPipeline, setAlignStatusSafe]);

  // ---------------------------------------------------------------
  // 재생 · 프레임 동기화
  // ---------------------------------------------------------------
  const seekA = useCallback((t) => {
    const vA = videoARef.current;
    if (!vA) return;
    vA.currentTime = clamp(t, 0, vA.duration || t);
    if (lockRef.current && videoBRef.current) {
      const target = vA.currentTime + lockOffsetRef.current;
      videoBRef.current.currentTime = clamp(target, 0, videoBRef.current.duration || target);
    }
  }, []);
  const seekB = useCallback((t) => {
    const vB = videoBRef.current;
    if (!vB) return;
    vB.currentTime = clamp(t, 0, vB.duration || t);
    if (lockRef.current && videoARef.current) {
      lockOffsetRef.current = vB.currentTime - videoARef.current.currentTime;
    }
  }, []);

  const handleTimeUpdateA = useCallback(() => {
    const vA = videoARef.current;
    if (!vA) return;
    setTimeA(`${fmtTime(vA.currentTime)} / ${fmtTime(vA.duration)}`);
    if (lockRef.current && videoBRef.current) {
      const target = vA.currentTime + lockOffsetRef.current;
      if (Math.abs(videoBRef.current.currentTime - target) > 0.15) {
        videoBRef.current.currentTime = clamp(target, 0, videoBRef.current.duration || target);
      }
    }
  }, []);
  const handleTimeUpdateB = useCallback(() => {
    const vB = videoBRef.current;
    if (!vB) return;
    setTimeB(`${fmtTime(vB.currentTime)} / ${fmtTime(vB.duration)}`);
  }, []);

  const togglePlay = useCallback(() => {
    const next = !playing;
    if (next) {
      if (videoARef.current) videoARef.current.play();
      if (videoBRef.current) videoBRef.current.play();
    } else {
      videoARef.current?.pause();
      videoBRef.current?.pause();
    }
    setPlaying(next);
  }, [playing]);

  const stopVideos = useCallback(() => {
    videoARef.current?.pause();
    videoBRef.current?.pause();
    setPlaying(false);
    seekA(0);
    if (videoBRef.current && !lockRef.current) videoBRef.current.currentTime = 0;
  }, [seekA]);

  // 반복재생(loop)이 켜져 있으면 두 레이어를 함께 처음으로 되돌려 계속 재생한다.
  // 단, 영상 저장(녹화) 중에는 자연 종료 시 자동으로 녹화를 멈추는 기존 동작을
  // 그대로 유지해야 하므로 녹화 중일 때는 반복재생을 일시적으로 건너뛴다
  // (recorderRef.current가 존재하면 녹화 진행 중이라는 뜻 — startRecording/
  // stopRecording에서 쓰는 것과 같은 판정 방식).
  const maybeLoopRestart = useCallback(() => {
    if (!loopRef.current || recorderRef.current || loopRestartPendingRef.current) return false;
    loopRestartPendingRef.current = true;
    requestAnimationFrame(() => {
      if (videoARef.current) { videoARef.current.currentTime = 0; videoARef.current.play(); }
      if (videoBRef.current) { videoBRef.current.currentTime = 0; videoBRef.current.play(); }
      setPlaying(true);
      loopRestartPendingRef.current = false;
    });
    return true;
  }, []);

  const handleEnded = useCallback(() => {
    if (maybeLoopRestart()) return;
    const aDone = !videoARef.current || videoARef.current.paused;
    const bDone = !videoBRef.current || videoBRef.current.paused;
    if (aDone && bDone) setPlaying(false);
  }, [maybeLoopRestart]);

  const onAutoEditToggle = useCallback((checked) => {
    setAutoEdit(checked);
    if (checked) {
      setLock(false);
      if (isVideoA && isVideoB) applyAutoSpeedMatch();
    } else if (videoBRef.current) {
      rateRef.current = 1;
      videoBRef.current.playbackRate = playbackSpeedRef.current;
      setRate(1);
    }
  }, [applyAutoSpeedMatch, isVideoA, isVideoB]);

  const onLockToggle = useCallback((checked) => {
    setLock(checked);
    if (checked) {
      setAutoEdit(false);
      if (videoBRef.current) {
        rateRef.current = 1;
        videoBRef.current.playbackRate = playbackSpeedRef.current;
        setRate(1);
      }
      if (videoARef.current && videoBRef.current) {
        lockOffsetRef.current = videoBRef.current.currentTime - videoARef.current.currentTime;
      }
    }
  }, []);

  const onRateChange = useCallback((value) => {
    const v = clamp(parseFloat(value) || 1, 0.25, 4);
    rateRef.current = v;
    if (videoBRef.current) videoBRef.current.playbackRate = v * playbackSpeedRef.current;
    setRate(v);
    setAutoEdit(false);
  }, []);

  // ---------------------------------------------------------------
  // 전역 재생 속도(리뷰용 배속) · 반복재생 — videoA.playbackRate는
  // playbackSpeed를, videoB.playbackRate는 (rate × playbackSpeed)를 갖도록
  // 유지해 기존 "A 길이에 맞춘 B 자동 편집" 동기화 값과 곱해서 함께
  // 동작한다(서로 값을 덮어쓰지 않음).
  // ---------------------------------------------------------------
  const onSpeedChange = useCallback((value) => {
    const v = clamp(parseFloat(value) || 1, 0.25, 2);
    playbackSpeedRef.current = v;
    if (videoARef.current) videoARef.current.playbackRate = v;
    if (videoBRef.current) videoBRef.current.playbackRate = rateRef.current * v;
    setPlaybackSpeed(v);
  }, []);

  const onLoopToggle = useCallback((checked) => {
    setLoop(checked);
  }, []);

  // ---------------------------------------------------------------
  // 스냅샷(PNG)·영상 저장(WebM) 공용 합성 렌더 — 화면에 보이는 오버레이
  // (투명도·블렌드·정렬·흑백)를 그대로 캔버스에 그린다. 영상 녹화 중에는
  // requestAnimationFrame으로 매 프레임 호출되므로 React state가 아니라
  // ref(최신값)를 읽어 스테일 클로저 없이 항상 현재 값을 반영한다.
  // ---------------------------------------------------------------
  const drawCompositeFrame = useCallback((ctx, w, h) => {
    // 캔버스 2D의 기본 리샘플링 품질은 브라우저에 따라 낮게 설정될 수 있어
    // (특히 원본보다 축소·확대해서 그릴 때 흐릿해짐) 스냅샷·영상 저장 어디서
    // 그리든 항상 최고 품질로 그리도록 명시한다.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const a = layerARef.current;
    const b = layerBRef.current;
    const al = alignRef.current;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const baseEl = a.type === 'video' ? videoARef.current : imgARef.current;
    const baseW = a.type === 'video' ? baseEl?.videoWidth : baseEl?.naturalWidth;
    const baseH = a.type === 'video' ? baseEl?.videoHeight : baseEl?.naturalHeight;
    if (baseEl && baseW) {
      const r = computeContainRect(baseW, baseH, w, h);
      ctx.save();
      if (grayscaleRef.current) ctx.filter = 'grayscale(1)';
      ctx.drawImage(baseEl, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    const topEl = b.type === 'video' ? videoBRef.current : imgBRef.current;
    const topW = b.type === 'video' ? topEl?.videoWidth : topEl?.naturalWidth;
    const topH = b.type === 'video' ? topEl?.videoHeight : topEl?.naturalHeight;
    if (topEl && topW) {
      const r = computeContainRect(topW, topH, w, h);
      ctx.save();
      ctx.globalAlpha = opacityRef.current / 100;
      ctx.globalCompositeOperation = { normal: 'source-over', difference: 'difference', multiply: 'multiply', screen: 'screen', lighten: 'lighten' }[blendRef.current] || 'source-over';
      const cx = w / 2;
      const cy = h / 2;
      ctx.translate(cx + al.x, cy + al.y);
      const s = al.scale / 100;
      ctx.scale(al.flip ? -s : s, s);
      ctx.translate(-cx, -cy);
      ctx.drawImage(topEl, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }, []);

  // ---------------------------------------------------------------
  // 스냅샷 저장(PNG) — 서버 저장 없이 기기로 바로 다운로드/공유.
  // ---------------------------------------------------------------
  const takeSnapshot = useCallback(async () => {
    if (!layerA.type && !layerB.type) {
      alert('먼저 이미지 또는 동영상을 업로드해 주세요.');
      return;
    }
    const stage = stageRef.current;
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    drawCompositeFrame(ctx, rect.width, rect.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const file = new File([blob], `몸가짐_전후비교_${Date.now()}.png`, { type: 'image/png' });
    await shareOrDownloadFile(file, '전/후 비교 스냅샷');
  }, [layerA, layerB, drawCompositeFrame]);

  // ---------------------------------------------------------------
  // 영상으로 저장 — 오버레이 합성 화면을 canvas.captureStream() +
  // MediaRecorder로 그대로 녹화해 WebM 파일로 저장한다. 레이어 A/B 중
  // 최소 하나가 동영상일 때만 의미가 있다(showVideoPanel과 동일 조건).
  // ---------------------------------------------------------------
  const stopRecording = useCallback(() => {
    if (recordRafRef.current) cancelAnimationFrame(recordRafRef.current);
    recordRafRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    videoARef.current?.pause();
    videoBRef.current?.pause();
    setPlaying(false);
  }, []);

  const recordDrawLoop = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    const stage = stageRef.current;
    const rect = stage.getBoundingClientRect();
    const canvas = recordCanvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    // 주의: startRecording()의 초기 캔버스 크기 계산과 반드시 같은 반올림
    // 순서(Math.round(rect.width * dpr))를 써야 한다. CSS 폭을 먼저
    // 반올림한 뒤 dpr을 곱하면(이중 반올림) 1px 오차가 생겨, 매 프레임마다
    // "크기가 달라졌다"고 오판해 캔버스를 계속 리사이즈하게 된다 — 녹화 중인
    // captureStream 트랙의 해상도가 프레임마다 바뀌면 인코더가 정상적인
    // 영상을 만들지 못해 거의 빈 파일이 저장되는 심각한 버그로 이어진다.
    const pixelW = Math.round(rect.width * dpr);
    const pixelH = Math.round(rect.height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
      // 캔버스 크기를 바꾸면 브라우저가 변환(transform) 상태를 초기화하므로
      // 매번 다시 scale()을 걸어줘야 다음 그리기도 실제 픽셀 배율로 그려진다.
      recordCtxRef.current.scale(dpr, dpr);
    }
    drawCompositeFrame(recordCtxRef.current, rect.width, rect.height);

    const vA = videoARef.current;
    const vB = videoBRef.current;
    const aDone = layerARef.current.type !== 'video' || !vA || vA.paused || vA.ended;
    const bDone = layerBRef.current.type !== 'video' || !vB || vB.paused || vB.ended;
    if (aDone && bDone) {
      stopRecording();
      return;
    }
    recordRafRef.current = requestAnimationFrame(recordDrawLoop);
  }, [drawCompositeFrame, stopRecording]);

  const startRecording = useCallback(() => {
    if (recorderRef.current) return;
    if (layerARef.current.type !== 'video' && layerBRef.current.type !== 'video') {
      alert('영상 저장은 레이어 A 또는 B가 동영상일 때만 사용할 수 있어요.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      alert('이 브라우저에서는 영상 저장을 지원하지 않아요. 최신 Chrome/Edge/Safari를 사용해 주세요.');
      return;
    }
    const mimeType = REC_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      alert('이 브라우저에서는 영상 저장을 지원하지 않아요. 최신 Chrome/Edge/Safari를 사용해 주세요.');
      return;
    }
    const stage = stageRef.current;
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const stream = canvas.captureStream(30);

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: computeRecordBitrate(canvas.width, canvas.height) });
    } catch (e) {
      alert(`영상 녹화를 시작하지 못했습니다: ${e.message}`);
      return;
    }

    recordCanvasRef.current = canvas;
    recordCtxRef.current = ctx;
    recordMimeTypeRef.current = mimeType;
    recordChunksRef.current = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recordChunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(recordChunksRef.current, { type: mimeType.split(';')[0] });
      recorderRef.current = null;
      recordChunksRef.current = [];
      setIsRecording(false);
      if (blob.size > 0) {
        const file = new File([blob], `몸가짐_전후비교_${Date.now()}.webm`, { type: mimeType.split(';')[0] });
        await shareOrDownloadFile(file, '전/후 비교 영상');
      }
    };
    recorder.start();
    setIsRecording(true);

    // 처음부터 다시 재생하며 녹화한다.
    if (layerARef.current.type === 'video') seekA(0);
    if (layerBRef.current.type === 'video' && !lockRef.current) {
      const vB = videoBRef.current;
      if (vB) vB.currentTime = 0;
    }
    videoARef.current?.play();
    videoBRef.current?.play();
    setPlaying(true);

    recordRafRef.current = requestAnimationFrame(recordDrawLoop);
  }, [recordDrawLoop, seekA]);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  // 언마운트 시 진행 중인 녹화가 있으면 정리한다.
  useEffect(() => () => {
    if (recordRafRef.current) cancelAnimationFrame(recordRafRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch (e) { /* noop */ }
    }
  }, []);

  // ---------------------------------------------------------------
  // 외부 연동 API — 다른 AI측정 화면(자세측정 리포트 등)이 이미 들고 있는
  // 사진/영상(Blob 또는 data: URL)을 새로 업로드하지 않고 바로 이 도구에
  // 적용할 수 있게 한다. 부모 화면이 이 화면을 모달/iframe으로 띄운 뒤
  //   frame.contentWindow.postMessage({ type:'overlay:load', slot:'A',
  //     source: capture.snapshotUrl /* data: URL */ | capture.rawBlob,
  //     mediaType:'image'|'video', name:'이전 측정' }, '*')
  // 로 보내면 된다. 실서비스에서는 event.origin을 자사 도메인으로 검증할 것.
  useEffect(() => {
    async function loadFromExternalSource(slot, source, mediaType, name) {
      try {
        let blob;
        if (source instanceof Blob) blob = source;
        else if (typeof source === 'string' && source) blob = await (await fetch(source)).blob();
        else return;
        const type = mediaType === 'video' || mediaType === 'image'
          ? mediaType
          : (blob.type.startsWith('video/') ? 'video' : 'image');
        const url = URL.createObjectURL(blob);
        assignMediaToSlot(slot === 'B' ? 'B' : 'A', { type, url, name: name || '' });
      } catch (e) { /* 무시 — 상태 메시지는 자동 정렬 단계에서 별도로 노출됨 */ }
    }
    function onMessage(event) {
      const data = event.data;
      if (!data || data.type !== 'overlay:load') return;
      loadFromExternalSource(data.slot === 'B' ? 'B' : 'A', data.source, data.mediaType, data.name);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [assignMediaToSlot]);

  // ---------------------------------------------------------------
  // 렌더
  // ---------------------------------------------------------------
  const stageTransform = `translate(${align.x}px, ${align.y}px) scale(${align.flip ? -align.scale / 100 : align.scale / 100}, ${align.scale / 100})`;

  if (step === 1) {
    const bothReady = !!(layerA.type && layerB.type);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">전/후 비교 (오버레이)</h2>
          <span className="w-12" />
        </div>

        <div className="card p-4 space-y-3 text-center">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">두 장의 사진 또는 영상을 업로드하세요</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">업로드가 끝나면 AI가 자동으로 발목 위치를 인식해 정렬하고, 비교 화면으로 이동합니다.</p>

          <div className="grid grid-cols-2 gap-3 pt-1">
            {[['A', '기준(전)'], ['B', '비교(후)']].map(([slot, label]) => {
              const layer = slot === 'A' ? layerA : layerB;
              return (
                <label key={slot} className="panel flex flex-col items-center justify-center gap-1 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl py-8 px-2 cursor-pointer hover:border-amber-500 transition-colors">
                  <span className="text-sm font-black">레이어 {slot} · {label}</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">클릭하여 업로드</span>
                  {layer.name && <span className="mt-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 break-all">{layer.name}</span>}
                  <input type="file" accept="image/*,video/*" hidden
                    onChange={(e) => loadFile(slot, e.target.files[0])} />
                </label>
              );
            })}
          </div>

          <button
            onClick={() => {
              if (!bothReady) { alert('두 파일을 모두 업로드해 주세요.'); return; }
              setStep(2);
              requestAnimationFrame(() => requestAnimationFrame(() => runAlignSequence()));
            }}
            disabled={!bothReady}
            className="btn btn-primary w-full disabled:opacity-40"
          >
            2. 비교 시작하기 →
          </button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-4">
        <div className="card p-6 max-w-xl mx-auto space-y-4 text-center">
          <div>
            <h2 className="measure-title">레이어 위치를 자동으로 맞추는 중입니다</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              레이어 A를 기준으로, 발목 위치를 인식해 레이어 B를 자동으로 정렬해요.
            </p>
          </div>

          <ul className="space-y-2 text-left">
            {ALIGN_PROGRESS_STEPS.map(({ key, label }) => {
              const state = alignProgress[key];
              const rowClass =
                state === 'done' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' :
                state === 'failed' ? 'border-red-500 text-red-600 dark:text-red-400' :
                state === 'active' ? 'border-amber-500 text-slate-700 dark:text-slate-200' :
                'border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500';
              const iconClass =
                state === 'done' ? 'bg-emerald-500 border-emerald-500' :
                state === 'failed' ? 'bg-red-500 border-red-500' :
                state === 'active' ? 'border-amber-500 border-t-transparent animate-spin' :
                'border-slate-300 dark:border-slate-700';
              return (
                <li key={key} className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-bold transition-colors ${rowClass}`}>
                  <span className={`relative w-5 h-5 flex-none rounded-full border-2 ${iconClass}`}>
                    {state === 'done' && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white">✓</span>}
                    {state === 'failed' && <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white">!</span>}
                  </span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ul>

          {alignPipelineError && (
            <p className="text-[11px] font-bold text-red-600 dark:text-red-400">{alignPipelineError}</p>
          )}

          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button onClick={() => setStep(3)} className="btn btn-ghost btn-sm">지금 건너뛰기 →</button>
            {alignPipelineError && (
              <button onClick={() => setStep(3)} className="btn btn-primary btn-sm">비교 화면으로 계속하기 →</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => { if (isRecording) stopRecording(); setStep(1); }} className="measure-back">← 업로드 수정</button>
        <h2 className="measure-title">전/후 비교</h2>
        <button onClick={swapLayers} className="measure-back">⇄ A/B 교체</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        {/* 스테이지 + 재생 컨트롤 (같은 컬럼에 세로로 쌓음: 재생 컨트롤이 화면을 보면서 바로 조작 가능하도록 스테이지 바로 아래 배치) */}
        <div className="space-y-3">
        <div className="card p-3 space-y-3">
          <div
            ref={stageRef}
            className="relative w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-black"
            style={{
              aspectRatio: '4 / 3',
              backgroundImage: checker
                ? 'conic-gradient(#3a3a3a 0 25%, #000 0 50%, #3a3a3a 0 75%, #000 0)'
                : 'none',
              backgroundSize: '24px 24px',
            }}
          >
            {/* 레이어 A(기준) — 흑백/컬러 토글 대상 */}
            <div className="absolute inset-0 flex items-center justify-center" style={{ filter: grayscale ? 'grayscale(1)' : 'none' }}>
              {layerA.type === 'image' && (
                <img ref={imgARef} src={layerA.url} alt="레이어 A" className="max-w-full max-h-full object-contain" onLoad={() => markReady('A')} />
              )}
              {layerA.type === 'video' && (
                <video ref={videoARef} src={layerA.url} className="max-w-full max-h-full object-contain" playsInline muted
                  onLoadedData={() => markReady('A')} onTimeUpdate={handleTimeUpdateA} onEnded={handleEnded} />
              )}
              {!layerA.type && <p className="text-xs font-bold text-slate-400">레이어 A · 기준</p>}
            </div>

            {/* 레이어 B(비교) — 투명도·블렌드·정렬 적용 대상 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: opacity / 100, mixBlendMode: blend }}>
              <div className="w-full h-full flex items-center justify-center" style={{ transform: stageTransform, transformOrigin: 'center center' }}>
                {layerB.type === 'image' && (
                  <img ref={imgBRef} src={layerB.url} alt="레이어 B" className="max-w-full max-h-full object-contain" onLoad={() => markReady('B')} />
                )}
                {layerB.type === 'video' && (
                  <video ref={videoBRef} src={layerB.url} className="max-w-full max-h-full object-contain" playsInline muted
                    onLoadedData={() => markReady('B')} onTimeUpdate={handleTimeUpdateB} onEnded={handleEnded} />
                )}
              </div>
              {!layerB.type && <p className="text-xs font-bold text-slate-400">레이어 B · 비교</p>}
            </div>

            {/* 중심 가이드라인 */}
            {guides && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-500/85" />
                <div className="absolute top-1/2 left-0 right-0 h-px bg-amber-500/85" />
              </div>
            )}

            {layerA.name && (
              <span className="absolute top-2.5 left-2.5 z-10 max-w-[44%] truncate rounded-lg border border-white/10 bg-slate-950/75 px-2 py-1 text-[11px] font-black text-white">
                A · {layerA.name}
              </span>
            )}
            {layerB.name && (
              <span className="absolute top-2.5 right-2.5 z-10 max-w-[44%] truncate rounded-lg border border-white/10 bg-slate-950/75 px-2 py-1 text-[11px] font-black text-white">
                B · {layerB.name}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> 중심 가이드라인
            </label>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={checker} onChange={(e) => setChecker(e.target.checked)} /> 체커 배경
            </label>
            <div className="flex-1" />
            <button onClick={takeSnapshot} className="btn btn-primary btn-sm">📸 스냅샷 저장(PNG)</button>
            {showVideoPanel && (
              <button
                onClick={toggleRecording}
                className={`btn btn-sm ${isRecording ? 'bg-red-600 text-white border-red-600' : 'btn-primary'}`}
              >
                {isRecording ? '⏺ 녹화 중지' : '🎥 영상으로 저장'}
              </button>
            )}
          </div>

          {/* 재생/정지 — 영상 비교 시 화면을 보면서 바로 조작해야 하는 핵심 컨트롤이라
              "고급 설정"에 넣지 않고 스테이지 바로 아래 항상 노출한다. */}
          {showVideoPanel && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <button onClick={togglePlay} className="btn btn-primary btn-sm">{playing ? '⏸ 일시정지' : '▶ 재생'}</button>
                <button onClick={stopVideos} className="btn btn-ghost btn-sm">⏹ 처음으로</button>
              </div>
              <label
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400"
                title="영상 저장(녹화) 중에는 반복재생이 잠시 꺼집니다."
              >
                <input type="checkbox" checked={loop} onChange={(e) => onLoopToggle(e.target.checked)} /> 🔁 반복재생
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">재생 속도</span>
                <input
                  type="range" min="25" max="200" step="5"
                  value={Math.round(playbackSpeed * 100)}
                  onChange={(e) => onSpeedChange((+e.target.value) / 100)}
                  className="w-28"
                />
                <span className="w-12 text-right text-xs font-black text-amber-700 dark:text-amber-300 tabular-nums">{playbackSpeed.toFixed(2)}×</span>
              </div>
              {isRecording && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                  녹화 중…
                </span>
              )}
            </div>
          )}
        </div>
        </div>

        {/* 사이드 패널 — 자동 정렬·자동 속도 맞춤이 이미 적용돼 있으므로
            기본은 오버레이 투명도만 남기고, 나머지는 "고급 설정"에서 펼쳐 본다. */}
        <div className="space-y-3">
          <div className="card p-3 space-y-3">
            <p className="label">오버레이 투명도</p>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-16">B 레이어</span>
              <input type="range" min="0" max="100" value={opacity} onChange={(e) => setOpacity(+e.target.value)} className="flex-1" />
              <span className="w-11 text-right text-xs font-black text-amber-700 dark:text-amber-300 tabular-nums">{opacity}%</span>
            </div>
            <div className="flex gap-2">
              {[0, 50, 100].map((v) => (
                <button key={v} onClick={() => setOpacity(v)} className="flex-1 seg-item bg-slate-100 dark:bg-slate-800">
                  {v === 0 ? 'A만 보기' : v === 100 ? 'B만 보기' : '50 / 50'}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="btn btn-ghost w-full justify-center text-sm"
          >
            ⚙ 고급 설정 <span className={`inline-block transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>▾</span>
          </button>

          {showAdvanced && (
            <div className="space-y-3">
              <div className="card p-3 space-y-2">
                <p className="label">블렌드 모드</p>
                <select value={blend} onChange={(e) => setBlend(e.target.value)} className="input">
                  {BLEND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className="card p-3 space-y-2">
                <p className="label">색상 비교 모드</p>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
                  전/후 색 구분 (레이어 A 흑백 · 레이어 B 원본색)
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">기준(전) 자세는 흑백으로, 비교(후) 자세는 원본 색상으로 표시해 두 레이어를 한눈에 구분할 수 있습니다.</p>
              </div>

              <div className="card p-3 space-y-3">
                <p className="label">정렬 조정 (레이어 B)</p>
                <button onClick={runAutoAlign} className="btn btn-primary btn-sm w-full">🦶 자동 정렬 다시 실행 (발목 기준)</button>
                <p className={`text-[11px] font-bold ${alignStatus.kind === 'success' ? 'text-emerald-600 dark:text-emerald-400' : alignStatus.kind === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {alignStatus.text}
                </p>
                <div className="h-px bg-slate-200 dark:bg-slate-800" />
                {[
                  ['가로 위치', align.x, 'x', OFFSET_MIN, OFFSET_MAX, 'px'],
                  ['세로 위치', align.y, 'y', OFFSET_MIN, OFFSET_MAX, 'px'],
                  ['크기', align.scale, 'scale', SCALE_MIN, SCALE_MAX, '%'],
                ].map(([label, value, key, min, max, unit]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-16">{label}</span>
                    <input type="range" min={min} max={max} value={value}
                      onChange={(e) => setAlign((prev) => ({ ...prev, [key]: +e.target.value }))} className="flex-1" />
                    <span className="w-12 text-right text-xs font-black text-amber-700 dark:text-amber-300 tabular-nums">{value}{unit}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={align.flip} onChange={(e) => setAlign((prev) => ({ ...prev, flip: e.target.checked }))} /> 좌우 반전
                  </label>
                  <button onClick={resetAlign} className="btn btn-ghost btn-sm">정렬 초기화</button>
                </div>
              </div>

              {showVideoPanel && (
                <div className="card p-3 space-y-3">
                  <p className="label">재생 상세 설정</p>
                  <div className="flex items-center gap-2 justify-end">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                      FPS <input type="number" min="1" max="240" value={fps} onChange={(e) => setFps(clamp(+e.target.value || 30, 1, 240))} className="input w-16 py-1" />
                    </span>
                  </div>

                  {isVideoA && isVideoB && (
                    <>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={autoEdit} onChange={(e) => onAutoEditToggle(e.target.checked)} />
                        레이어 A 길이에 맞춰 B 자동 편집(재생속도)
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">B 재생속도</span>
                        <input type="number" min="0.25" max="4" step="0.05" value={rate.toFixed(2)}
                          onChange={(e) => onRateChange(e.target.value)} className="input w-20 py-1" />
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">× (1.00 = 원본 속도)</span>
                      </div>
                    </>
                  )}

                  <div className="h-px bg-slate-200 dark:bg-slate-800" />

                  {isVideoA && (
                    <div className="panel p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black">레이어 A</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{timeA}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => seekA((videoARef.current?.currentTime || 0) - 1 / fps)} className="btn btn-ghost btn-sm px-2">⏮</button>
                        <input type="range" min="0" max={Math.round((videoARef.current?.duration || 0) * 1000) || 1000}
                          onChange={(e) => seekA((+e.target.value) / 1000)} className="flex-1" />
                        <button onClick={() => seekA((videoARef.current?.currentTime || 0) + 1 / fps)} className="btn btn-ghost btn-sm px-2">⏭</button>
                      </div>
                    </div>
                  )}
                  {isVideoB && (
                    <div className="panel p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black">레이어 B</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{timeB}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => seekB((videoBRef.current?.currentTime || 0) - 1 / fps)} className="btn btn-ghost btn-sm px-2">⏮</button>
                        <input type="range" min="0" max={Math.round((videoBRef.current?.duration || 0) * 1000) || 1000}
                          onChange={(e) => seekB((+e.target.value) / 1000)} className="flex-1" />
                        <button onClick={() => seekB((videoBRef.current?.currentTime || 0) + 1 / fps)} className="btn btn-ghost btn-sm px-2">⏭</button>
                      </div>
                    </div>
                  )}

                  {isVideoA && isVideoB && (
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                      <input type="checkbox" checked={lock} onChange={(e) => onLockToggle(e.target.checked)} /> 동기화 오프셋 고정(수동)
                    </label>
                  )}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    "자동 편집"은 두 영상의 속도를 맞춰 동시에 끝나도록 합니다. 같은 배속으로 시작 프레임만 수동으로 맞추고 싶다면 자동 편집을 끄고 "동기화 오프셋 고정"을 사용하세요. 오디오는 비교 명확성을 위해 음소거됩니다.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
