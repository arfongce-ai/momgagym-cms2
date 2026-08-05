// ai-measure/menus/VbtMeasure.jsx
// 메뉴 7: VBT (속도 기반 트레이닝) — 관절 인식(양 손목 중점) 기반 자동 반복·속도 측정.
//  - [재설계] 카메라를 켜면 화면 전체를 덮는 풀스크린 오버레이로 전환.
//  - 화면에서 엔드캡을 한 번 누르면 그 색을 학습해 따라간다.
//  - 측정 시작 → 한 렙 동작 → 종료 시: 수직 이동거리(키 환산 m) ÷ 시간 = 평균속도.
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { personHeightRatio, barbellPoint } from '../core/barbell';
import { velocityZone } from '../core/performance';
import {
  detectPlatesFromVideo, suggestSidePlates, totalWeight,
  plateCmPerRatio, PLATE_CALIBRATION_TAGS,
} from '../core/plates';
import { exerciseLabel as exerciseLabelLocal, snapWeight, stepWeight } from '../core/lifting';
import { saveVideoToPhone, pickRecorderMime } from '../core/recordSink';
import { drawLiftingDataHud } from '../core/recordingOverlay';
import { DEFAULT_ASPECT, outputSize, aspectLabel, drawVideoCover, rotateLandmarksNormalized } from '../core/recordAspect';
import { useCameraRotation } from '../core/useCameraRotation';
import { assessFraming, FRAMING_PRESETS } from '../core/framingGuide';
import {
  CALIBRATION_PRESETS, buildReferenceScale, ratioToCm,
  resolveDistanceScale, serializeDistanceScale,
} from '../core/calibration';
import { beepRep } from '../core/audioCue';
import { BarbellAccumulator } from '../core/barbellBiomechanics';
import PlateWeightInput from './PlateWeightInput';
import FramingIntro from './FramingIntro';
import HeightField from './HeightField';
import CameraStage from './CameraStage';
import GaugeHud from './GaugeHud';
import LiftingResultSheet from './LiftingResultSheet';

const MAX_RECORDING_MS = 60000;

export default function VbtMeasure({ member, onSave, onBack, exerciseType, embedded = false, autoStartSignal = 0, topOffset = 0 }) {
  const canvasRef = useRef(null);
  // ── 다중 신호 융합(LiftingMeasure와 동일 구조 — 측정 정직성/신뢰성 일관화) ──
  //  fusedRef        = color/skeleton/plate 세 신호를 매 프레임 융합한 최종 궤적
  //                    (ROM·시간·속도는 전부 이 융합 궤적에서 산출 → 가려져도 안 끊김)
  const fusedRef = useRef(new BarbellAccumulator()); // 실시간 렙 분절·속도·궤적 엔진
  const phRef = useRef(null);
  const phSamplesRef = useRef([]);
  const phHistoryRef = useRef([]); // 최근 N프레임 원시값 — 실시간 스케일용 중앙값 평활(단일 프레임 튐 방지)
  const frameStatsRef = useRef({ total: 0, lost: 0 });
  const recordingRef = useRef(false);
  const framingRef = useRef({ level: 'bad', message: '' });
  const consumedAutoStartRef = useRef(0);
  const camOpenedOnceRef = useRef(false); // 최초 카메라 오픈 여부(첫 진입 로더용)
  const roiRef = useRef({ x: 0.06, y: 0.42, w: 0.30, h: 0.40 });
  const calibrationPointsRef = useRef([]);
  const countdownTimerRef = useRef(null);
  const maxRecordTimerRef = useRef(null);

  // ── 녹화(MediaRecorder) — 영상 위 궤적선 + 데이터HUD 번인. 영상은 트레이너 폰 저장.
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordCanvasRef = useRef(null);
  const composeRafRef = useRef(null);
  const recordStreamRef = useRef(null);
  const recordStartRef = useRef(0);
  const liveHudRef = useRef({ romCm: null, meanVelocity: null });
  const [liveReps, setLiveReps] = useState(0);
  const [liveHud, setLiveHud] = useState(null); // 실시간 렙 속도/저하 HUD
  const videoBlobRef = useRef(null);
  const [videoBlob, setVideoBlob] = useState(null);
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoSavedMsg, setVideoSavedMsg] = useState('');

  const [recording, setRecording] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT); // 인스타 비율(3:4 기본 / 1:1)
  const aspectRef = useRef(DEFAULT_ASPECT);
  const [countdown, setCountdown] = useState(null);
  useEffect(() => { aspectRef.current = aspect; }, [aspect]);
  const [result, setResult] = useState(null);
  const [heightCm, setHeightCm] = useState(member?.height || '');
  const [plate, setPlate] = useState({ barKg: 20, sidePlates: [] });
  const [dialWeight, setDialWeight] = useState(20);
  const [weightSource, setWeightSource] = useState('dial');
  const [detected, setDetected] = useState([]);
  const [framing, setFraming] = useState({ level: 'bad', message: '카메라 준비 중…' });
  const [, setExposureLock] = useState(false);
  const [referenceLengthCm, setReferenceLengthCm] = useState(CALIBRATION_PRESETS[0].lengthCm);
  const [referenceScale, setReferenceScale] = useState(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationPointCount, setCalibrationPointCount] = useState(0);
  const [rotationDeg] = useCameraRotation();

  const handleResult = useCallback((rawLms, ts, _video) => {
    // 오버레이/추적선 없음(RSI 방식) — 캔버스는 비워 둔다.
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크) 보정 —
    // 바 속도(VBT의 핵심 지표)는 "수직" 변위 기반이라 회전 보정 없이는
    // 완전히 다른 축을 재게 된다. 이 화면은 라이브 스켈레톤 오버레이가
    // 없어(위 주석 참고) raw/보정 분리 없이 여기서 한 번만 보정하면 된다.
    const lms = rotateLandmarksNormalized(rawLms, rotationDeg);

    const ph = personHeightRatio(lms);
    if (ph) {
      // 원시값을 그대로 스케일에 쓰면, 코·발목 랜드마크가 한 프레임만 튀어도
      // (정면 오버헤드 동작에서 바가 머리 근처를 지날 때 흔함) cmPerRatio가
      // 순간적으로 폭증해 ROM/속도가 비정상적으로 커 보이는 문제가 있었다.
      // 최근 프레임들의 중앙값을 실시간 스케일 기준으로 써서 단일 프레임 튐을 흡수한다.
      const hist = phHistoryRef.current;
      hist.push(ph);
      if (hist.length > 15) hist.shift();
      const sorted = [...hist].sort((a, b) => a - b);
      phRef.current = sorted[Math.floor(sorted.length / 2)];
      if (recordingRef.current) phSamplesRef.current.push(ph);
    }

    const fr = assessFraming(lms, { want: FRAMING_PRESETS.vbt.want });
    if (fr.level !== framingRef.current.level || fr.message !== framingRef.current.message) {
      framingRef.current = fr;
      setFraming({ level: fr.level, message: fr.message });
    }

    // 바 위치 = 양 손목 중점(스켈레톤). 별도 추적점 지정 없이 자동으로 잡는다.
    const bar = barbellPoint(lms);
    if (!bar) {
      if (recordingRef.current) {
        frameStatsRef.current.total += 1;
        frameStatsRef.current.lost += 1;
      }
      return;
    }

    if (recordingRef.current) {
      fusedRef.current.push(bar, ts);
      frameStatsRef.current.total += 1;
      // 실시간 렙 카운트 + 렙 속도/저하 — 엔진이 프레임마다 갱신.
      const H = Number(heightCm) || null;
      const scale = resolveDistanceScale({ referenceScale, personHeightRatio: phRef.current, heightCm: H });
      const lv = fusedRef.current.live(scale.cmPerRatio);
      setLiveReps(prev => { if (lv.reps > prev) beepRep(); return prev !== lv.reps ? lv.reps : prev; });
      setLiveHud(prev => {
        if (prev && prev.reps === lv.reps && prev.lastRepVelocity === lv.lastRepVelocity
          && prev.velocityLossPct === lv.velocityLossPct && prev.phase === lv.phase) return prev;
        return lv;
      });
      liveHudRef.current = {
        romCm: lv.romCm,
        meanVelocity: lv.lastRepVelocity ?? lv.bestRepVelocity ?? null,
        repList: lv.repList || null,
      };
    }
  }, [heightCm, referenceScale, rotationDeg]);

  const { videoRef, start, stop, status, error, lockCapture, unlockCapture } = usePoseEngine({ onResult: handleResult });

  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
  }, []);

  const clearMaxRecordTimer = useCallback(() => {
    if (maxRecordTimerRef.current) {
      clearTimeout(maxRecordTimerRef.current);
      maxRecordTimerRef.current = null;
    }
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

  const syncCanvas = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (v && c && v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.addEventListener('loadedmetadata', syncCanvas);
    return () => {
      if (v) v.removeEventListener('loadedmetadata', syncCanvas);
      clearCountdown();
      clearMaxRecordTimer();
      unlockCapture();
      stop();
      stopCompose();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
    };
  }, [clearCountdown, clearMaxRecordTimer, syncCanvas, stop, unlockCapture]);

  const startCam = useCallback(() => {
    setResult(null);
    fusedRef.current.reset();
    calibrationPointsRef.current = [];
    setCalibrationPointCount(0);
    setCalibrating(false);
    setVideoBlob(null); videoBlobRef.current = null; setVideoSavedMsg('');
    camOpenedOnceRef.current = true;
    start();
  }, [start]);
  const closeCam = () => {
    clearCountdown(); clearMaxRecordTimer(); unlockCapture(); setExposureLock(false);
    stop(); recordingRef.current = false; setRecording(false); stopCompose();
    if (embedded) onBack?.(); // 허브 내부에선 준비 화면 대신 상위 메뉴로 복귀
  };

  const stopCompose = () => {
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  const createRecordedStream = () => {
    const video = videoRef.current;
    const size = outputSize(aspectRef.current); // 인스타 비율 통일(3:4 / 1:1)
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawVideoCover(ctx, video, canvas.width, canvas.height, rotationDeg); // 검은 여백 없이 중앙 크롭(+회전 보정)
      const elapsedSec = recordingRef.current ? (performance.now() - recordStartRef.current) / 1000 : null;
      drawLiftingDataHud(ctx, canvas.width, canvas.height, {
        title: 'VBT',
        romCm: liveHudRef.current.romCm,
        meanVelocity: liveHudRef.current.meanVelocity,
        repList: liveHudRef.current.repList,
        elapsedSec,
        recording: recordingRef.current,
      });
      composeRafRef.current = requestAnimationFrame(draw);
    };
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    draw();
    const canvasStream = canvas.captureStream ? canvas.captureStream(30) : null;
    if (!canvasStream) return null;
    recordStreamRef.current = canvasStream;
    return canvasStream;
  };

  const handleSaveVideo = async () => {
    const blob = videoBlobRef.current || videoBlob;
    if (!blob) { alert('저장할 녹화 영상이 없습니다.'); return; }
    setSavingVideo(true);
    try {
      const res = await saveVideoToPhone(blob, {
        measure: `VBT_${exerciseType ? exerciseLabelLocal(exerciseType) : '속도'}`,
        member,
      });
      setVideoSavedMsg(res.saved
        ? (res.method === 'share' ? '저장/공유 창을 열었습니다.' : '영상을 다운로드했습니다.')
        : '저장이 취소되었습니다.');
    } catch (e) {
      setVideoSavedMsg('영상 저장에 실패했습니다.');
    }
    setSavingVideo(false);
  };

  const applyPlateWeight = useCallback((next, source = 'plate-manual') => {
    const normalized = { barKg: next?.barKg ?? 20, sidePlates: next?.sidePlates ?? [] };
    setPlate(normalized);
    setDialWeight(totalWeight(normalized.sidePlates, normalized.barKg).total);
    setWeightSource(source);
  }, []);

  const scanPlateColors = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { alert('카메라가 아직 준비되지 않았습니다.'); return; }
    const { dominant, roi: detectedRoi } = detectPlatesFromVideo(v, roiRef.current);
    if (!dominant.length) { alert('원판 색을 찾지 못했습니다. 원판이 박스 안에 잘 보이게 한 뒤 다시 시도하세요.'); return; }
    if (detectedRoi) roiRef.current = detectedRoi;
    setDetected(dominant);
    applyPlateWeight({ ...plate, sidePlates: suggestSidePlates(dominant) }, 'plate-color');
  }, [applyPlateWeight, plate, videoRef]);

  useEffect(() => {
    if (!autoStartSignal || consumedAutoStartRef.current === autoStartSignal) return;
    consumedAutoStartRef.current = autoStartSignal;
    if (status === 'idle') startCam();
  }, [autoStartSignal, startCam, status]);

  const addCalibrationPoint = useCallback((point) => {
    const next = [...calibrationPointsRef.current, point].slice(-2);
    calibrationPointsRef.current = next;
    setCalibrationPointCount(next.length);
    if (next.length < 2) return;

    const scale = buildReferenceScale(next, referenceLengthCm);
    if (!scale) {
      alert('거리 보정 기준 길이를 다시 확인해 주세요.');
      calibrationPointsRef.current = [];
      setCalibrationPointCount(0);
      return;
    }
    setReferenceScale(scale);
    setCalibrating(false);
  }, [referenceLengthCm]);

  const onTapVideo = (e) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || status !== 'running') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const clientY = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    const vAR = v.videoWidth / v.videoHeight;
    const bAR = rect.width / rect.height;
    let drawW = rect.width, drawH = rect.height, offX = 0, offY = 0;
    if (vAR > bAR) { drawH = rect.width / vAR; offY = (rect.height - drawH) / 2; }
    else { drawW = rect.height * vAR; offX = (rect.width - drawW) / 2; }
    const nx = (clientX - offX) / drawW;
    const ny = (clientY - offY) / drawH;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    if (calibrating) {
      addCalibrationPoint({ x: nx, y: ny });
    }
  };

  // 세트 종료 시 융합 궤적·교차검증·COG 이격을 한 번에 계산하는 공통 헬퍼(LiftingMeasure와 동일 패턴).
  const computeResult = useCallback(() => {
    const fs = frameStatsRef.current;
    const lostRatio = fs.total ? fs.lost / fs.total : 1;
    const H = Number(heightCm) || null;
    const phs = phSamplesRef.current.filter(Boolean).sort((a, b) => a - b);
    const phMed = phs.length ? phs[Math.floor(phs.length / 2)] : phRef.current;
    const scale = resolveDistanceScale({ referenceScale, personHeightRatio: phMed, heightCm: H });
    const sum = fusedRef.current.summary({ cmPerRatio: scale.cmPerRatio, source: 'live' });
    if (!sum || sum.valid === false) return null; // 정직성: 부족하면 결과를 내지 않음
    const cm = sum.romCm;
    if (!cm) return { error: 'no_height' };
    const distanceM = cm / 100;
    const timeSec = sum.durationSec;
    // 평균속도 = 렙 컨센트릭 평균(엔진) — 하강·정지 구간이 섞이지 않아 정확.
    const meanVelocity = sum.meanVelocity;
    if (!meanVelocity) return null;
    const repVelocity = sum.repVelocityCompat;
    const reps = sum.repCount;
    return {
      meanVelocity,
      zone: velocityZone(meanVelocity),
      distanceM: Math.round(distanceM * 1000) / 1000,
      timeSec: Math.round(timeSec * 100) / 100,
      romCm: cm,
      reps,
      repVelocity,
      velocityLoss: repVelocity.summary.velocityLossPct,
      peakVelocity: sum.peakVelocity,          // 실시간 평활 추정
      peakReason: sum.peakReason,
      barPath: sum.barPath,
      consistencyCvPct: sum.consistencyCvPct,
      calibration: serializeDistanceScale(scale),
      calibrationSource: scale.source,
      isCalibrated: scale.isCalibrated,
      lostRatio,
    };
  }, [heightCm, referenceScale]);

  const finishRecord = (autoLimited = false) => {
    if (!recordingRef.current) return;
    clearMaxRecordTimer();
    recordingRef.current = false;
    unlockCapture();
    setExposureLock(false);
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) { stopCompose(); }
    } else {
      stopCompose();
    }
    const res = computeResult();
    if (!res) { alert('기록된 움직임이 부족합니다. 다시 측정하세요.'); return; }
    if (res.error === 'no_height') { alert('키(cm)를 입력하고 전신이 보이게 측정하세요.'); return; }
    if (res.lostRatio > 0.4) {
      alert('관절 인식이 자주 끊겼습니다(인식 ' + Math.round((1 - res.lostRatio) * 100) + '%). 전신·양팔이 화면에 들어오게 다시 측정해 주세요.');
    }
    setResult(res);
    if (autoLimited) setVideoSavedMsg('최대 60초 녹화가 완료되었습니다.');
  };

  const toggleRecord = () => {
    if (countdown != null) return;
    if (!recording) {
      runStartCountdown(() => {
        fusedRef.current.reset();
        phSamplesRef.current = [];
        phHistoryRef.current = [];
        frameStatsRef.current = { total: 0, lost: 0 };
        liveHudRef.current = { romCm: null, meanVelocity: null, repList: null };
        setLiveReps(0);
        setLiveHud(null);
        recordStartRef.current = performance.now();
        recordingRef.current = true;
        lockCapture().then(setExposureLock).catch(() => setExposureLock(false));
        setRecording(true);
        setResult(null);
        setVideoBlob(null); videoBlobRef.current = null; setVideoSavedMsg('');
        try {
          chunksRef.current = [];
          const stream = createRecordedStream();
          if (stream) {
            const mime = pickRecorderMime();
            const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
            mediaRecorderRef.current = mr;
            mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            mr.onstop = () => {
              stopCompose();
              const type = mr.mimeType || 'video/webm';
              const blob = new Blob(chunksRef.current, { type });
              videoBlobRef.current = blob;
              setVideoBlob(blob);
            };
            // 타임슬라이스로 청크를 나눠 받으면(특히 mp4) Blob 이어붙이기 과정에서
            // 실제 녹화 시간보다 재생 가능한 길이가 짧아지는 문제가 생긴다.
            // stop() 시 한 번에 완전한 Blob을 받도록 타임슬라이스 없이 시작한다.
            mr.start();
          }
        } catch (e) { mediaRecorderRef.current = null; }
        clearMaxRecordTimer();
        maxRecordTimerRef.current = setTimeout(() => finishRecord(true), MAX_RECORDING_MS);
      });
    } else {
      clearMaxRecordTimer();
      recordingRef.current = false;
      unlockCapture();
      setExposureLock(false);
      setRecording(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { stopCompose(); }
      } else {
        stopCompose();
      }
      const res = computeResult();
      if (!res) { alert('기록된 움직임이 부족합니다. 다시 측정하세요.'); return; }
      if (res.error === 'no_height') { alert('키(cm)를 입력·적용한 뒤, 사람 전신이 보이게 측정하세요.'); return; }
      if (res.lostRatio > 0.4) {
        alert('관절 인식이 자주 끊겼습니다(인식 ' + Math.round((1 - res.lostRatio) * 100) + '%). 전신·양팔이 화면에 들어오게 다시 측정해 주세요.');
      }
      setResult(res);
    }
  };

  const save = () => {
    if (!result) return;
    const weight = snapWeight(dialWeight) || totalWeight(plate.sidePlates, plate.barKg).total;
    onSave?.({
      type: 'vbt',
      exerciseType: exerciseType || null,
      source: 'live',
      lostRatio: result.lostRatio ?? null,
      distance: result.distanceM,
      time: result.timeSec,
      romCm: result.romCm ?? null,
      meanVelocity: result.meanVelocity,
      peakVelocity: result.peakVelocity ?? null,   // 실시간 평활 추정(sg_ok일 때만)
      peakReason: result.peakReason ?? null,
      barPath: result.barPath ?? null,
      consistencyCvPct: result.consistencyCvPct ?? null,
      reps: result.reps ?? null,
      repVelocity: result.repVelocity ?? null,
      velocityLoss: result.velocityLoss ?? null,
      zone: result.zone?.label,
      heightCm: Number(heightCm) || null,
      isCalibrated: result.isCalibrated === true,
      calibration: result.calibration ?? null,
      calibrationSource: result.calibrationSource ?? result.calibration?.source ?? null,
      weight: weight || null,
      barKg: plate.barKg,
      sidePlates: plate.sidePlates,
      weightSource,
      videoBlob: videoBlobRef.current || videoBlob || null,
    });
  };

  // ───────── 풀스크린 카메라(측정 중) ─────────
  if (status !== 'idle') {
    const topBar = (
      <>

        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${framing.level === 'good' ? 'bg-emerald-500/85 text-slate-950' : framing.level === 'warn' ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
          {framing.level === 'good' ? '✓ ' : '⚠ '}{framing.message}
        </span>
        {!heightCm && (
          <span className="rounded-full px-2.5 py-1 text-[10px] font-bold bg-amber-500/85 text-slate-950">
            키 미입력 — 속도 계산엔 키 필요
          </span>
        )}
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${referenceScale ? 'bg-emerald-500/85 text-slate-950' : 'bg-slate-700/90 text-slate-200'}`}>
          {calibrating ? `거리 보정 ${calibrationPointCount}/2` : referenceScale ? '기준물 보정' : '키 보정'}
        </span>
        {/* 인스타 비율 토글(3:4 / 1:1) — 녹화 중엔 잠금 */}
        <div className="pointer-events-auto flex gap-0.5 rounded-full bg-black/55 backdrop-blur p-0.5 border border-white/10">
          {['3/4', '1/1'].map((r) => (
            <button key={r} onClick={() => !recording && setAspect(r)} disabled={recording}
              className={`rounded-full px-2 py-0.5 text-[10px] font-black transition-colors disabled:opacity-50 ${aspect === r ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
              {aspectLabel(r)}
            </button>
          ))}
        </div>
      </>
    );

    const controls = (
      <div className="flex items-center gap-2">
        <button onClick={toggleRecord}
          disabled={countdown != null}
          className={`px-6 h-14 rounded-2xl text-base font-black active:scale-95 shadow-xl disabled:opacity-60 transition-transform ${
            recording ? 'bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-red-500/30'
            : 'bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 shadow-amber-500/30'}`}>
          {recording ? '■ 측정 종료' : countdown != null ? '시작 대기' : '● 측정 시작'}
        </button>
        <button onClick={scanPlateColors}
          className="h-14 px-3 rounded-2xl text-[11px] font-black bg-white/[0.08] border border-white/15 text-white active:scale-95 backdrop-blur">
          🎨<span className="block text-[9px] mt-0.5">색 인식</span>
        </button>
        <button
          onClick={() => {
            calibrationPointsRef.current = [];
            setCalibrationPointCount(0);
            setCalibrating(v => !v);
          }}
          disabled={recording || countdown != null}
          className={`h-14 px-3 rounded-2xl text-[11px] font-black active:scale-95 disabled:opacity-50 backdrop-blur ${calibrating ? 'bg-cyan-400 text-slate-950' : 'bg-white/[0.08] border border-white/15 text-white'}`}>
          📐<span className="block text-[9px] mt-0.5">{calibrating ? '보정점' : '거리 보정'}</span>
        </button>
      </div>
    );

    return (
      <CameraStage
        videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
        onTapVideo={onTapVideo} onClose={closeCam} topBar={topBar} controls={controls}
        recording={recording} tappable={countdown == null}
        countdown={countdown}
        topOffset={topOffset}
        aspectFrame={aspect}
      >
        {/* 렙별 기록 카드 — RSI 점프별 HUD 처럼 렙마다 속도가 카드로 남는다.
            (m/s 평균속도 + ROM/저하율. 최신 렙은 시안 강조.) */}
        {recording && liveHud?.repList?.length > 0 && (
          <div className="mx-auto max-w-sm w-full overflow-x-auto pointer-events-none">
            <div className="flex gap-1.5 justify-end min-w-max px-1">
              {liveHud.repList.map((r, i) => {
                const latest = i === liveHud.repList.length - 1;
                return (
                  <div key={r.repNo}
                    className={`min-w-[54px] rounded-lg px-2 py-1.5 text-center backdrop-blur ${
                      latest ? 'bg-cyan-400/90 text-slate-950 shadow-lg shadow-cyan-400/30'
                             : 'bg-white/10 text-white border border-white/10'}`}>
                    <p className={`text-[10px] font-bold ${latest ? 'text-slate-900/70' : 'text-white/45'}`}>#{r.repNo}</p>
                    <p className="truncate font-mono text-base font-black leading-none">{r.meanVelocity ?? '–'}<span className="text-[9px] font-bold opacity-60"> m/s</span></p>
                    <p className={`truncate text-[10px] font-bold ${latest ? 'text-slate-900/70' : 'text-white/45'}`}>
                      {r.lossPct != null && r.lossPct > 0 ? `-${r.lossPct}%` : (r.romCm != null ? `${r.romCm}cm` : '–')}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {recording && (
          <GaugeHud
            label="평균속도"
            value={liveHud?.lastRepVelocity ?? null}
            unit="m/s" decimals={2}
            arc min={0} max={1.5} accent="#22d3ee"
            stats={[
              { label: 'REP', value: liveReps },
              { label: 'BEST', value: liveHud?.bestRepVelocity ?? null, unit: 'm/s' },
              { label: 'ROM', value: liveHud?.romCm ?? null, unit: 'cm' },
              {
                label: 'LOSS', value: liveHud?.velocityLossPct ?? null, unit: '%',
                tone: liveHud?.velocityLossPct == null ? 'text-white'
                  : liveHud.velocityLossPct > 20 ? 'text-red-300'
                  : liveHud.velocityLossPct > 10 ? 'text-amber-300' : 'text-emerald-300',
              },
            ]}
          />
        )}
        {!recording && (
          <div className="mx-auto max-w-xs w-full rounded-xl bg-black/55 backdrop-blur border border-white/10 p-2">
            <div className="flex items-center justify-center gap-1.5">
              <button onClick={() => { setDialWeight(w => stepWeight(w, -10)); setWeightSource('dial'); }}
                className="w-9 h-9 rounded-lg bg-white/10 text-slate-100 font-black text-[11px] active:scale-90">−5</button>
              <button onClick={() => { setDialWeight(w => stepWeight(w, -1)); setWeightSource('dial'); }}
                className="w-9 h-9 rounded-lg bg-white/10 text-slate-100 font-black active:scale-90">−</button>
              <div className="min-w-[72px] text-center">
                <p className="font-mono font-black text-2xl text-white leading-none">{snapWeight(dialWeight)}</p>
                <p className="text-[8px] text-slate-400">kg</p>
              </div>
              <button onClick={() => { setDialWeight(w => stepWeight(w, +1)); setWeightSource('dial'); }}
                className="w-9 h-9 rounded-lg bg-amber-500 text-slate-950 font-black active:scale-90">+</button>
              <button onClick={() => { setDialWeight(w => stepWeight(w, +10)); setWeightSource('dial'); }}
                className="w-9 h-9 rounded-lg bg-amber-500 text-slate-950 font-black text-[11px] active:scale-90">+5</button>
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-2 text-[9px] text-slate-400">
              <span>{weightSource === 'plate-color' ? '원판 색 인식 반영' : '수동 무게'}</span>
              {detected.length > 0 && <span className="text-cyan-300">{detected.map(d => d.label).join(', ')}</span>}
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-slate-300">
              <span>기준 길이</span>
              <input
                type="number"
                min="5"
                max="300"
                step="0.5"
                value={referenceLengthCm}
                onChange={e => setReferenceLengthCm(Number(e.target.value) || 0)}
                className="w-16 rounded bg-black/35 border border-white/10 px-2 py-1 text-center font-mono text-white"
              />
              <span>cm</span>
            </div>
          </div>
        )}
        {result && (
          <LiftingResultSheet
            mode="vbt" exerciseType={exerciseType} result={result} zone={result.zone}
            onSave={onSave ? save : null}
            videoBlob={videoBlob} onSaveVideo={handleSaveVideo}
            savingVideo={savingVideo} videoSavedMsg={videoSavedMsg}
          />
        )}
      </CameraStage>
    );
  }

  // ───────── 카메라 자동 진입(허브 내부): 준비 화면을 거치지 않는다 ─────────
  //  autoStart effect 가 마운트 직후 카메라를 켠다. 최초 오픈 전까지만 로더를
  //  보여 깜빡임을 없앤다(닫은 뒤 idle 상태에서 로더에 갇히지 않도록).
  if (embedded && !camOpenedOnceRef.current) {
    return (
      <div className="fixed inset-0 z-[70] bg-slate-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-amber-400/40 border-t-amber-400 animate-spin" />
        <p className="text-sm font-bold text-slate-300">카메라를 켜는 중…</p>
      </div>
    );
  }

  // ───────── 준비 화면(카메라 꺼짐) · 독립 실행 시에만 ─────────
  return (
    <div className={`space-y-4 ${embedded ? 'pt-44 px-3 max-w-md mx-auto overflow-y-auto pb-8' : ''}`} style={embedded ? { height: '100dvh' } : undefined}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">VBT · {exerciseType ? exerciseLabelLocal(exerciseType) : '속도기반'}</h2>
          <span className="w-12" />
        </div>
      )}

      {!embedded && (
        <HeightField value={heightCm} onChange={setHeightCm} member={member}
          hint="거리·속도 환산에 사용" />
      )}

      <FramingIntro preset={FRAMING_PRESETS.vbt} onStart={startCam} startLabel="📷 카메라 시작 (전체화면)" />

      <details className="rounded-xl bg-slate-900/60 border border-slate-700">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-300 select-none">
          원판 무게 설정 (기록용) · 선택
        </summary>
        <div className="px-3 pb-3">
          <PlateWeightInput value={plate} onChange={next => applyPlateWeight(next, 'plate-manual')} getVideo={null} />
        </div>
      </details>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 카메라를 켜면 전체 화면으로 전환됩니다. 옆에서 촬영해야 바벨 수직 속도가 정확히 잡히며,
        한 번에 1렙만 측정하면 속도가 더 정확합니다. 카메라 한 대 추정이라 전용 엔코더보다
        정밀하진 않으며 평균속도 추세 파악용으로 적합합니다.
      </p>
    </div>
  );
}
