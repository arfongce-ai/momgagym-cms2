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

  const [fps, setFps] = useState(30);
  const [autoEdit, setAutoEdit] = useState(true);
  const [lock, setLock] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [timeA, setTimeA] = useState('00:00.0 / 00:00.0');
  const [timeB, setTimeB] = useState('00:00.0 / 00:00.0');

  // 최신 상태를 이벤트 핸들러·비동기 콜백 안에서 스테일 클로저 없이 읽기 위한
  // ref들 — usePoseEngine.js의 onResultRef 패턴과 동일한 이유.
  const layerARef = useRef(layerA); layerARef.current = layerA;
  const layerBRef = useRef(layerB); layerBRef.current = layerB;
  const alignRef = useRef(align); alignRef.current = align;
  const autoEditRef = useRef(autoEdit); autoEditRef.current = autoEdit;
  const lockRef = useRef(lock); lockRef.current = lock;
  const fpsRef = useRef(fps); fpsRef.current = fps;
  const lockOffsetRef = useRef(0);

  const stageRef = useRef(null);
  const imgARef = useRef(null);
  const videoARef = useRef(null);
  const imgBRef = useRef(null);
  const videoBRef = useRef(null);

  const isVideoA = layerA.type === 'video';
  const isVideoB = layerB.type === 'video';
  const showVideoPanel = isVideoA || isVideoB;

  useHardwareBack(step === 2, () => setStep(1));

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
      return;
    }
    setAlignStatusSafe('포즈 인식 모델을 불러오는 중…', 'dim');
    try {
      await loadImagePoseLandmarker();
    } catch (e) {
      setAlignStatusSafe('AI 모델을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. (수동 슬라이더는 계속 사용할 수 있어요)', 'danger');
      return;
    }
    setAlignStatusSafe('발목 위치를 분석하는 중…', 'dim');
    const frameA = await captureFrameCanvas('A');
    const frameB = await captureFrameCanvas('B');
    if (!frameA || !frameB) {
      setAlignStatusSafe('이미지를 불러오지 못했습니다.', 'danger');
      return;
    }
    let resA;
    let resB;
    try {
      resA = detectPoseImage(frameA.canvas);
      resB = detectPoseImage(frameB.canvas);
    } catch (e) {
      setAlignStatusSafe('포즈 분석 중 오류가 발생했습니다.', 'danger');
      return;
    }
    const dataA = extractAnkleData(resA);
    const dataB = extractAnkleData(resB);
    if (!dataA || !dataB) {
      setAlignStatusSafe('사람을 인식하지 못했습니다. 전신이 잘 보이는 사진/영상으로 시도해 주세요.', 'danger');
      return;
    }
    const stage = stageRef.current;
    const stageRect = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 };
    if (!stageRect.width || !stageRect.height) {
      setAlignStatusSafe('화면 크기를 확인하지 못했습니다. 다시 시도해 주세요.', 'danger');
      return;
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
    vB.playbackRate = nextRate;
    setRate(nextRate);
    setLock(false);
  }, []);

  const runAutoPipeline = useCallback(async () => {
    if (layerARef.current.type === 'video' && layerBRef.current.type === 'video' && autoEditRef.current) {
      applyAutoSpeedMatch();
    }
    try { await runAutoAlign(); } catch (e) { /* 상태 메시지는 runAutoAlign 내부에서 이미 설정됨 */ }
  }, [applyAutoSpeedMatch, runAutoAlign]);

  // 두 레이어가 모두 준비되면 자동으로 비교 화면(2단계)으로 전환하고
  // 자동 정렬·자동 편집 파이프라인을 실행한다.
  useEffect(() => {
    if (layerA.type && layerB.type && layerA.ready && layerB.ready) {
      setStep(2);
      const raf1 = requestAnimationFrame(() => {
        requestAnimationFrame(() => { runAutoPipeline(); });
      });
      return () => cancelAnimationFrame(raf1);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerA.type, layerA.ready, layerA.url, layerB.type, layerB.ready, layerB.url]);

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

  const handleEnded = useCallback(() => {
    const aDone = !videoARef.current || videoARef.current.paused;
    const bDone = !videoBRef.current || videoBRef.current.paused;
    if (aDone && bDone) setPlaying(false);
  }, []);

  const onAutoEditToggle = useCallback((checked) => {
    setAutoEdit(checked);
    if (checked) {
      setLock(false);
      if (isVideoA && isVideoB) applyAutoSpeedMatch();
    } else if (videoBRef.current) {
      videoBRef.current.playbackRate = 1;
      setRate(1);
    }
  }, [applyAutoSpeedMatch, isVideoA, isVideoB]);

  const onLockToggle = useCallback((checked) => {
    setLock(checked);
    if (checked) {
      setAutoEdit(false);
      if (videoBRef.current) { videoBRef.current.playbackRate = 1; setRate(1); }
      if (videoARef.current && videoBRef.current) {
        lockOffsetRef.current = videoBRef.current.currentTime - videoARef.current.currentTime;
      }
    }
  }, []);

  const onRateChange = useCallback((value) => {
    const v = clamp(parseFloat(value) || 1, 0.25, 4);
    if (videoBRef.current) videoBRef.current.playbackRate = v;
    setRate(v);
    setAutoEdit(false);
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
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const baseEl = layerA.type === 'video' ? videoARef.current : imgARef.current;
    const baseW = layerA.type === 'video' ? baseEl?.videoWidth : baseEl?.naturalWidth;
    const baseH = layerA.type === 'video' ? baseEl?.videoHeight : baseEl?.naturalHeight;
    if (baseEl && baseW) {
      const r = computeContainRect(baseW, baseH, rect.width, rect.height);
      ctx.save();
      if (grayscale) ctx.filter = 'grayscale(1)';
      ctx.drawImage(baseEl, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    const topEl = layerB.type === 'video' ? videoBRef.current : imgBRef.current;
    const topW = layerB.type === 'video' ? topEl?.videoWidth : topEl?.naturalWidth;
    const topH = layerB.type === 'video' ? topEl?.videoHeight : topEl?.naturalHeight;
    if (topEl && topW) {
      const r = computeContainRect(topW, topH, rect.width, rect.height);
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      ctx.globalCompositeOperation = { normal: 'source-over', difference: 'difference', multiply: 'multiply', screen: 'screen', lighten: 'lighten' }[blend] || 'source-over';
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      ctx.translate(cx + align.x, cy + align.y);
      const s = align.scale / 100;
      ctx.scale(align.flip ? -s : s, s);
      ctx.translate(-cx, -cy);
      ctx.drawImage(topEl, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const file = new File([blob], `몸가짐_전후비교_${Date.now()}.png`, { type: 'image/png' });
    await shareOrDownloadFile(file, '전/후 비교 스냅샷');
  }, [layerA, layerB, opacity, blend, align, grayscale]);

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
            onClick={() => (bothReady ? setStep(2) : alert('두 파일을 모두 업로드해 주세요.'))}
            disabled={!bothReady}
            className="btn btn-primary w-full disabled:opacity-40"
          >
            2. 비교 시작하기 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setStep(1)} className="measure-back">← 업로드 수정</button>
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
                    onLoadedData={() => markReady('B')} onTimeUpdate={handleTimeUpdateB} />
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
          </div>
        </div>

        {showVideoPanel && (
          <div className="card p-3 space-y-3">
            <p className="label">재생 · 프레임 동기화</p>
            <div className="flex items-center gap-2">
              <button onClick={togglePlay} className="btn btn-primary btn-sm">{playing ? '⏸ 일시정지' : '▶ 재생'}</button>
              <button onClick={stopVideos} className="btn btn-ghost btn-sm">⏹ 처음으로</button>
              <span className="ml-auto flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
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

        {/* 사이드 패널 */}
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
            <label className="block">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">블렌드 모드</span>
              <select value={blend} onChange={(e) => setBlend(e.target.value)} className="input mt-1">
                {BLEND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
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
            <button onClick={runAutoAlign} className="btn btn-primary btn-sm w-full">🦶 자동 정렬 (발목 기준)</button>
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
        </div>
      </div>
    </div>
  );
}
