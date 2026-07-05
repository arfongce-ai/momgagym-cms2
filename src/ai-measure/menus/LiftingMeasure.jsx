// ai-measure/menus/LiftingMeasure.jsx
// 메뉴 8: 역도 — 바벨 엔드캡(봉 끝) 탭 추적 + 수직 변위/추진시간 기록.
//  - [재설계] 카메라를 켜면 화면 전체를 덮는 풀스크린 오버레이로 띄우고,
//    가이드·컨트롤·결과를 모두 영상 위에 겹쳐 한 화면에서 측정→확인이 끝난다.
//  - 화면에서 엔드캡을 톡 누르면 그 색을 학습해 따라간다(원판이 손 가려도 OK).
//  - 옆에서 촬영 권장. cm 환산은 회원 키 기준(근사).
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { personHeightRatio, barbellPoint, createBarbellTracker } from '../core/barbell';
import { createMultiTracker } from '../core/endcapTracker';
import { assessFraming, FRAMING_PRESETS } from '../core/framingGuide';
import {
  detectPlatesFromVideo, suggestSidePlates, totalWeight, createPlateBlobTracker,
  plateCmPerRatio, PLATE_CALIBRATION_TAGS,
} from '../core/plates';
import { exerciseLabel as exerciseLabelLocal, snapWeight, stepWeight } from '../core/lifting';
import { fuseTrackingCandidates, summarizeCrossValidation } from '../core/trackFusion';
import { estimateBodyCOG, barCogHorizontalGap } from '../core/bodyCog';
import { saveVideoToPhone, pickRecorderMime } from '../core/recordSink';
import { drawLiftingDataHud, drawBarPathToRecord } from '../core/recordingOverlay';
import { createRepCounter } from '../core/repCounter';
import {
  CALIBRATION_PRESETS, buildReferenceScale, ratioToCm,
  resolveDistanceScale, serializeDistanceScale,
} from '../core/calibration';
import { buildRepVelocityMetrics } from '../core/repVelocity';
import PlateWeightInput from './PlateWeightInput';
import FramingIntro from './FramingIntro';
import HeightField from './HeightField';
import CameraStage from './CameraStage';

const MAX_RECORDING_MS = 60000;

export default function LiftingMeasure({ member, onSave, onBack, exerciseType, embedded = false, autoStartSignal = 0, topOffset = 0 }) {
  const canvasRef = useRef(null);
  const capRef = useRef(createMultiTracker());
  // ── 다중 신호 융합 ──
  //  capRef       = 사용자가 탭한 색(엔드캡/원판) 추적(UI 점 개수/신뢰도 표시 겸용)
  //  plateTrackerRef = 원판 색 블롭 연속 추적(색 인식 후 자동 시드)
  //  fusedRef     = color/skeleton/plate 세 신호를 매 프레임 융합한 최종 궤적
  //                 (ROM·반복·속도는 전부 이 융합 궤적에서 산출 → 가려져도 안 끊김)
  const plateTrackerRef = useRef(createPlateBlobTracker());
  const fusedRef = useRef(createBarbellTracker());
  const crossValFramesRef = useRef([]);     // 세트 동안 프레임별 융합 소스/일치도 로그
  const cogRef = useRef({ available: false, point: null });   // 최신 COG(측면 촬영시만)
  const barCogGapSamplesRef = useRef([]);   // 세트 동안 바-COG 수평 이격(cm) 샘플
  const phRef = useRef(null);
  const phSamplesRef = useRef([]);
  const frameStatsRef = useRef({ total: 0, lost: 0 });
  const recordingRef = useRef(false);
  const seededRef = useRef(false);
  const framingRef = useRef({ level: 'bad', message: '' });
  const consumedAutoStartRef = useRef(0);
  const roiRef = useRef({ x: 0.05, y: 0.34, w: 0.26, h: 0.46 });
  const calibrationPointsRef = useRef([]);
  const countdownTimerRef = useRef(null);
  const maxRecordTimerRef = useRef(null);

  // ── 녹화(MediaRecorder) — 영상 위에 바벨 궤적선 + 데이터HUD를 합성해 번인.
  //    측정 데이터는 Firestore, 영상 blob 은 트레이너 폰(saveVideoToPhone)으로 분리 저장.
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordCanvasRef = useRef(null);     // 합성용 오프스크린 캔버스
  const composeRafRef = useRef(null);        // 합성 루프
  const recordStreamRef = useRef(null);      // 캔버스 captureStream
  const recordStartRef = useRef(0);          // 녹화 시작 시각(ms)
  const liveHudRef = useRef({ romCm: null, meanVelocity: null }); // 번인용 실시간 값
  const repCounterRef = useRef(createRepCounter());
  const [liveReps, setLiveReps] = useState(0);
  const videoBlobRef = useRef(null);
  const [videoBlob, setVideoBlob] = useState(null);
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoSavedMsg, setVideoSavedMsg] = useState('');

  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [seedHintSignal, setSeedHintSignal] = useState(0);
  const [seeded, setSeeded] = useState(false);
  const [ptCount, setPtCount] = useState(0);
  const [activePts, setActivePts] = useState(0);
  const [result, setResult] = useState(null);
  const [heightCm, setHeightCm] = useState(member?.height || '');
  const [plate, setPlate] = useState({ barKg: 20, sidePlates: [] });
  const [dialWeight, setDialWeight] = useState(20);
  const [weightSource, setWeightSource] = useState('dial');
  const [detected, setDetected] = useState([]);
  const [framing, setFraming] = useState({ level: 'bad', message: '카메라 준비 중…' });
  const [cogActive, setCogActive] = useState(false);   // 측면 인식으로 COG 산출 중인지(칩)
  const [, setExposureLock] = useState(false);
  const [referenceLengthCm, setReferenceLengthCm] = useState(CALIBRATION_PRESETS[0].lengthCm);
  const [referenceScale, setReferenceScale] = useState(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationPointCount, setCalibrationPointCount] = useState(0);

  const handleResult = useCallback((lms, ts, video) => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    const ph = personHeightRatio(lms);
    if (ph) {
      phRef.current = ph;
      if (recordingRef.current) phSamplesRef.current.push(ph);
    }

    const fr = assessFraming(lms, { want: FRAMING_PRESETS.lifting.want });
    if (fr.level !== framingRef.current.level || fr.message !== framingRef.current.message) {
      framingRef.current = fr;
      setFraming({ level: fr.level, message: fr.message });
    }

    // ── 전신 무게중심(COG) 자동 인식 — 측면 촬영일 때만 ──
    const cog = estimateBodyCOG(lms, fr.orientation);
    cogRef.current = cog;
    setCogActive(prev => (prev !== cog.available ? cog.available : prev));

    const r = roiRef.current;
    ctx.save();
    ctx.strokeStyle = 'rgba(245,158,11,0.95)';
    ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
    ctx.strokeRect(r.x * cw, r.y * ch, r.w * cw, r.h * ch);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(245,158,11,0.95)';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('원판 색 인식', r.x * cw + 6, r.y * ch - 8);
    ctx.restore();

    // COG 마커(측면 인식시에만 그려짐 — 정면/불명확하면 자동으로 사라짐).
    if (cog.available && cog.point) {
      ctx.save();
      ctx.fillStyle = 'rgba(217,70,239,0.9)';
      ctx.beginPath(); ctx.arc(cog.point.x * cw, cog.point.y * ch, 9, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(cog.point.x * cw, cog.point.y * ch, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(217,70,239,0.95)';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('COG', cog.point.x * cw + 12, cog.point.y * ch + 4);
      ctx.restore();
    }

    const cap = capRef.current;
    const skeletonPoint = barbellPoint(lms);
    const plateColorPoint = plateTrackerRef.current.isSeeded() ? plateTrackerRef.current.update(video) : null;

    if (cap.isSeeded()) {
      const p = cap.update(video);
      const colorActive = cap.activeCount();
      // 세 신호(색/스켈레톤/원판색) 융합 — 한 신호가 가려져도 궤적이 끊기지 않는다.
      const fused = fuseTrackingCandidates({ colorPoint: p, colorActive, skeletonPoint, plateColorPoint });

      if (fused.point && recordingRef.current) {
        fusedRef.current.push(fused.point, ts);
        crossValFramesRef.current.push({ source: fused.source, agreement: fused.agreement, usedFallback: fused.usedFallback });
        // 바-COG 수평 이격(측면 인식시에만) — 정직성: COG 없으면 샘플을 남기지 않는다.
        if (cog.available && cog.point) {
          const gapRatio = barCogHorizontalGap(fused.point, cog.point);
          const scale = resolveDistanceScale({
            referenceScale,
            personHeightRatio: phRef.current,
            heightCm: Number(heightCm) || null,
          });
          const gapCm = ratioToCm(gapRatio, scale.cmPerRatio);
          barCogGapSamplesRef.current.push({ gapRatio, gapCm });
        }
        // 바벨 수직 위치로 렙 자동 카운트(융합 위치 기준 — 더 안정적).
        repCounterRef.current.push(fused.point.y);
        const shown = repCounterRef.current.countWithPending();
        setLiveReps(prev => (prev !== shown ? shown : prev));
      }
      if (colorActive !== activePts) setActivePts(colorActive);
      if (recordingRef.current) {
        frameStatsRef.current.total += 1;
        if (colorActive === 0) frameStatsRef.current.lost += 1;
        // 번인용 실시간 값: 융합 궤적 → cm/평균속도(키 보정 가능 시).
        const live = fusedRef.current.summary();
        if (live) {
          const H = Number(heightCm) || null;
          const ph = phRef.current;
          const scale = resolveDistanceScale({ referenceScale, personHeightRatio: ph, heightCm: H });
          const cm = ratioToCm(live.romRatio, scale.cmPerRatio);
          const sec = live.durationMs / 1000;
          liveHudRef.current = {
            romCm: cm,
            meanVelocity: cm && sec ? Math.round((cm / 100 / sec) * 100) / 100 : null,
          };
        }
      }

      const path = fusedRef.current.path();
      ctx.save();
      ctx.strokeStyle = 'rgba(34,211,238,0.95)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      path.forEach((q, i) => {
        const X = q.x * cw, Y = q.y * ch;
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      });
      ctx.stroke();
      cap.points().forEach(pt => {
        if (!pt.ema) return;
        ctx.fillStyle = pt.alive ? 'rgba(16,185,129,0.95)' : 'rgba(148,163,184,0.6)';
        ctx.beginPath(); ctx.arc(pt.ema.x * cw, pt.ema.y * ch, 11, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(pt.ema.x * cw, pt.ema.y * ch, 11, 0, Math.PI * 2); ctx.stroke();
      });
      if (fused.point) {
        // 색 추적 살아있으면 주황. 스켈레톤/원판색으로 대체된 프레임은 붉은 테두리로
        // 방식이 바뀌었음을 드러낸다(측정 정직성 — 정밀도 다른 방법을 똑같이 보이면 안 됨).
        ctx.fillStyle = fused.usedFallback ? '#fb923c' : '#f59e0b';
        ctx.beginPath(); ctx.arc(fused.point.x * cw, fused.point.y * ch, 16, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = fused.usedFallback ? '#ef4444' : '#fff';
        ctx.beginPath(); ctx.arc(fused.point.x * cw, fused.point.y * ch, 16, 0, Math.PI * 2); ctx.stroke();
        // 바-COG 연결선(측면 인식 + 기록 중일 때만) — 이격이 눈으로 보이게.
        if (cog.available && cog.point && recordingRef.current) {
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(217,70,239,0.6)';
          ctx.beginPath();
          ctx.moveTo(fused.point.x * cw, fused.point.y * ch);
          ctx.lineTo(cog.point.x * cw, fused.point.y * ch);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }
  }, [activePts, heightCm, referenceScale]);

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
    seededRef.current = false; setSeeded(false);
    setPtCount(0); setActivePts(0);
    capRef.current.clear();
    plateTrackerRef.current.clear();
    fusedRef.current.reset();
    crossValFramesRef.current = [];
    barCogGapSamplesRef.current = [];
    calibrationPointsRef.current = [];
    setCalibrationPointCount(0);
    setCalibrating(false);
    cogRef.current = { available: false, point: null };
    setVideoBlob(null); videoBlobRef.current = null; setVideoSavedMsg('');
    start();
  }, [start]);
  const closeCam = () => {
    clearCountdown();
    clearMaxRecordTimer();
    unlockCapture();
    setExposureLock(false);
    stop();
    recordingRef.current = false;
    setRecording(false);
    stopCompose();
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
    // 원판 색을 인식하면 그 색을 매 프레임 계속 추적하는 블롭 트래커도 시드
    // — 색/스켈레톤 추적과 융합되는 3번째 신호가 된다.
    const top = dominant[0];
    const roi = detectedRoi || roiRef.current;
    if (top?.tag) plateTrackerRef.current.seed(top.tag, roi.x + roi.w / 2, roi.y + roi.h / 2);
  }, [applyPlateWeight, plate, videoRef]);

  useEffect(() => {
    if (!autoStartSignal || consumedAutoStartRef.current === autoStartSignal) return;
    consumedAutoStartRef.current = autoStartSignal;
    if (status === 'idle') startCam();
  }, [autoStartSignal, startCam, status]);

  // 합성 루프/스트림 정리.
  const stopCompose = () => {
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  // 녹화용 합성 스트림: 카메라 영상 + 바벨 궤적선 + 데이터HUD 를 오프스크린
  // 캔버스에 매 프레임 그려 captureStream 으로 뽑는다(RomMeasure 와 동일 구조).
  const createRecordedStream = () => {
    const video = videoRef.current;
    const vw = video?.videoWidth || 720;
    const vh = video?.videoHeight || 1280;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = vw; canvas.height = vh;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (video && video.videoWidth) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // 실제 추적 궤적선(장식 아님).
      drawBarPathToRecord(ctx, fusedRef.current.path(), canvas.width, canvas.height);
      // 데이터-only HUD: 수직이동(cm) · 평균속도 · 경과시간.
      const elapsedSec = recordingRef.current ? (performance.now() - recordStartRef.current) / 1000 : null;
      drawLiftingDataHud(ctx, canvas.width, canvas.height, {
        romCm: liveHudRef.current.romCm,
        meanVelocity: liveHudRef.current.meanVelocity,
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
      return;
    }
    const ok = capRef.current.seed(v, nx, ny);
    if (ok) {
      seededRef.current = true; setSeeded(true);
      setPtCount(capRef.current.pointCount());
    }
  };

  // 세트 종료 시 융합 궤적·교차검증·COG 이격을 한 번에 계산하는 공통 헬퍼.
  const computeResult = useCallback(() => {
    const sum = fusedRef.current.summary();
    if (!sum) return null;
    const fs = frameStatsRef.current;
    const lostRatio = fs.total ? fs.lost / fs.total : 1;
    const H = Number(heightCm) || null;
    const phs = phSamplesRef.current.filter(Boolean).sort((a, b) => a - b);
    const phMed = phs.length ? phs[Math.floor(phs.length / 2)] : phRef.current;
    const scale = resolveDistanceScale({ referenceScale, personHeightRatio: phMed, heightCm: H });
    const cm = ratioToCm(sum.romRatio, scale.cmPerRatio);
    const sec = sum.durationMs / 1000;
    const velocity = cm && sec ? Math.round((cm / 100 / sec) * 100) / 100 : null;
    const repVelocity = buildRepVelocityMetrics(fusedRef.current.path(), {
      cmPerRatio: scale.cmPerRatio,
      source: 'live',
    });
    const reps = repVelocity.summary.repCount || repCounterRef.current.countWithPending();
    const crossVal = summarizeCrossValidation(crossValFramesRef.current);
    const gaps = barCogGapSamplesRef.current;
    let cogGap = null;
    if (gaps.length) {
      const cmVals = gaps.map(g => g.gapCm).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
      const ratioVals = gaps.map(g => g.gapRatio).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
      const medCm = cmVals.length ? cmVals[Math.floor(cmVals.length / 2)] : null;
      const medRatio = ratioVals.length ? ratioVals[Math.floor(ratioVals.length / 2)] : null;
      const maxCm = cmVals.length ? cmVals[cmVals.length - 1] : null;
      cogGap = {
        available: cogRef.current?.available === true,
        medianCm: medCm != null ? Math.round(medCm * 10) / 10 : null,
        maxCm: maxCm != null ? Math.round(maxCm * 10) / 10 : null,
        medianRatio: medRatio != null ? Math.round(medRatio * 1000) / 1000 : null,
        samples: gaps.length,
      };
    }
    return {
      ...sum,
      romCm: cm,
      sec: Math.round(sec * 100) / 100,
      velocity,
      reps,
      repVelocity,
      velocityLoss: repVelocity.summary.velocityLossPct,
      calibration: serializeDistanceScale(scale),
      calibrationSource: scale.source,
      isCalibrated: scale.isCalibrated,
      lostRatio,
      crossValidation: crossVal,
      cogGap,
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
    if (res.lostRatio > 0.4) {
      alert('추적이 자주 끊겼습니다(인식 ' + Math.round((1 - res.lostRatio) * 100) + '%). 끝이 보이는 지점을 2~3곳 눌러 다시 측정하면 정확합니다.');
    }
    setResult(res);
    if (autoLimited) setVideoSavedMsg('최대 60초 녹화가 완료되었습니다.');
  };

  const toggleRecord = () => {
    if (!seededRef.current) { setSeedHintSignal(v => v + 1); return; }
    if (countdown != null) return;
    if (!recording) {
      runStartCountdown(() => {
        capRef.current.reset();
        fusedRef.current.reset();
        crossValFramesRef.current = [];
        barCogGapSamplesRef.current = [];
        phSamplesRef.current = [];
        frameStatsRef.current = { total: 0, lost: 0 };
        liveHudRef.current = { romCm: null, meanVelocity: null };
        repCounterRef.current.reset();
        setLiveReps(0);
        recordStartRef.current = performance.now();
        recordingRef.current = true;
        lockCapture().then(setExposureLock).catch(() => setExposureLock(false));
        setRecording(true);
        setResult(null);
        setVideoBlob(null); videoBlobRef.current = null; setVideoSavedMsg('');
        // MediaRecorder 시작(지원 시). 미지원이면 측정만 진행(영상 없음).
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
      // 레코더 종료 → onstop 에서 blob 확정.
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { stopCompose(); }
      } else {
        stopCompose();
      }
      const res = computeResult();
      if (!res) { alert('기록된 움직임이 부족합니다. 다시 측정하세요.'); return; }
      if (res.lostRatio > 0.4) {
        alert('추적이 자주 끊겼습니다(인식 ' + Math.round((1 - res.lostRatio) * 100) + '%). 더 잘 보이는 지점을 2~3곳 눌러 다시 측정하면 정확합니다.');
      }
      setResult(res);
    }
  };

  // 녹화 영상을 트레이너 폰에 저장(몸가짐ai 파일명).
  const handleSaveVideo = async () => {
    const blob = videoBlobRef.current || videoBlob;
    if (!blob) { alert('저장할 녹화 영상이 없습니다.'); return; }
    setSavingVideo(true);
    try {
      const res = await saveVideoToPhone(blob, {
        measure: exerciseType ? exerciseLabelLocal(exerciseType) : '역도',
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

  const save = () => {
    if (!result) return;
    const weight = snapWeight(dialWeight) || totalWeight(plate.sidePlates, plate.barKg).total;
    onSave?.({
      type: 'lifting',
      exerciseType: exerciseType || null,
      source: 'live',          // 실시간 카메라 — peakVelocity 미산출(허브 게이트)
      lostRatio: result.lostRatio ?? null,   // 추적 손실률 → confidenceScore 산정에 사용
      romRatio: result.romRatio,
      romCm: result.romCm,
      durationSec: result.sec,
      meanVelocity: result.velocity,
      reps: result.reps ?? null,
      repVelocity: result.repVelocity ?? null,
      velocityLoss: result.velocityLoss ?? null,
      heightCm: Number(heightCm) || null,
      isCalibrated: result.isCalibrated === true,
      calibration: result.calibration ?? null,
      calibrationSource: result.calibrationSource ?? result.calibration?.source ?? null,
      weight: weight || null,
      barKg: plate.barKg,
      sidePlates: plate.sidePlates,
      weightSource,
      crossValidation: result.crossValidation ?? null,  // 다중 신호 교차검증 요약
      cogGap: result.cogGap ?? null,                     // 바-COG 수평 이격(측면시)
      videoBlob: videoBlobRef.current || videoBlob || null,
    });
  };

  // ───────── 풀스크린 카메라(측정 중) ─────────
  if (status !== 'idle') {
    const topBar = (
      <>
        {recording && (
          <div className="self-center rounded-full bg-black/70 backdrop-blur px-3 py-1.5 border border-amber-500/40">
            <p className="text-center font-mono font-black text-lg text-white leading-none"><span className="text-[10px] text-amber-300 mr-1">반복</span>{liveReps}<span className="text-xs text-slate-400">회</span></p>
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span className="bg-black/65 rounded-full px-2.5 py-1 text-[10px] text-cyan-300 font-bold">
            {ptCount === 0
              ? '바벨 끝·원판을 눌러 추적점 지정 또는 색 인식'
              : recording
                ? `추적점 ${activePts}/${ptCount} 인식 중`
                : `추적점 ${ptCount}개 · 색 인식 또는 측정 시작`}
          </span>
          {ptCount > 0 && (
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${activePts >= 2 ? 'bg-emerald-500/85 text-slate-950' : activePts === 1 ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
              신뢰도 {activePts >= 2 ? '높음' : activePts === 1 ? '보통' : '낮음'}
            </span>
          )}
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${framing.level === 'good' ? 'bg-emerald-500/85 text-slate-950' : framing.level === 'warn' ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
          {framing.level === 'good' ? '✓ ' : '⚠ '}{framing.message}
        </span>
        {cogActive && (
          <span className="rounded-full px-2.5 py-1 text-[10px] font-bold bg-fuchsia-500/85 text-white">
            ⦿ 무게중심(COG) 자동 인식 중
          </span>
        )}
        {!heightCm && (
          <span className="rounded-full px-2.5 py-1 text-[10px] font-bold bg-amber-500/85 text-slate-950">
            키 미입력 — 닫고 입력하면 cm·속도 정확
          </span>
        )}
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${referenceScale ? 'bg-emerald-500/85 text-slate-950' : 'bg-slate-700/90 text-slate-200'}`}>
          {calibrating ? `거리 보정 ${calibrationPointCount}/2` : referenceScale ? '기준물 보정' : '키 보정'}
        </span>
      </>
    );

    const controls = (
      <div className="flex items-center gap-2">
        <button onClick={toggleRecord}
          disabled={countdown != null}
          className={`px-5 h-12 rounded-full text-sm font-black active:scale-95 shadow-lg disabled:opacity-60 ${recording ? 'bg-red-500 text-white' : seeded ? 'bg-amber-500 text-slate-950' : 'bg-slate-600 text-slate-200'}`}>
          {recording ? '■ 측정 종료' : countdown != null ? '시작 대기' : '● 측정 시작'}
        </button>
        <button onClick={scanPlateColors}
          className="px-3.5 h-12 rounded-full text-xs font-black bg-slate-700 text-white active:scale-95 shadow-lg">
          🎨 색 인식
        </button>
        <button
          onClick={() => {
            calibrationPointsRef.current = [];
            setCalibrationPointCount(0);
            setCalibrating(v => !v);
          }}
          disabled={recording || countdown != null}
          className={`px-3.5 h-12 rounded-full text-xs font-black active:scale-95 shadow-lg disabled:opacity-50 ${calibrating ? 'bg-cyan-400 text-slate-950' : 'bg-slate-700 text-white'}`}>
          {calibrating ? '보정점 찍기' : '거리 보정'}
        </button>
      </div>
    );

    return (
      <CameraStage
        videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
        onTapVideo={onTapVideo} onClose={closeCam} topBar={topBar} controls={controls}
        recording={recording} tappable={countdown == null}
        seedHint={ptCount === 0 && !recording} hintSignal={seedHintSignal} countdown={countdown}
        topOffset={topOffset}
      >
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
          <div className="mx-auto max-w-md w-full card-accent p-3 space-y-2 animate-fade-in">
            <p className="text-[11px] font-bold text-amber-400 uppercase tracking-widest">바벨 추적 결과 {result.reps ? `· ${result.reps}회` : ''}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-800 rounded-xl py-2">
                <p className="text-[10px] text-slate-500">수직 이동</p>
                <p className="font-mono font-bold text-slate-100 text-sm">{result.romCm != null ? `${result.romCm}cm` : `${result.romRatio}`}</p>
              </div>
              <div className="bg-slate-800 rounded-xl py-2">
                <p className="text-[10px] text-slate-500">소요 시간</p>
                <p className="font-mono font-bold text-slate-100 text-sm">{result.sec}s</p>
              </div>
              <div className="bg-slate-800 rounded-xl py-2">
                <p className="text-[10px] text-slate-500">평균 속도</p>
                <p className="font-mono font-bold text-slate-100 text-sm">{result.velocity != null ? `${result.velocity}m/s` : '-'}</p>
              </div>
            </div>
            {result.repVelocity?.summary?.repCount > 0 && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl py-2">
                  <p className="text-[10px] text-emerald-300">반복</p>
                  <p className="font-mono font-bold text-emerald-100 text-sm">{result.repVelocity.summary.repCount}</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl py-2">
                  <p className="text-[10px] text-emerald-300">최고 평균속도</p>
                  <p className="font-mono font-bold text-emerald-100 text-sm">{result.repVelocity.summary.bestMeanVelocity ?? '-'}m/s</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl py-2">
                  <p className="text-[10px] text-emerald-300">속도저하</p>
                  <p className="font-mono font-bold text-emerald-100 text-sm">{result.velocityLoss != null ? `${result.velocityLoss}%` : '-'}</p>
                </div>
              </div>
            )}
            {(result.cogGap?.available || result.crossValidation?.totalFrames) && (
              <div className="grid grid-cols-2 gap-2 text-center">
                {result.cogGap?.available && (
                  <div className="bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-xl py-2">
                    <p className="text-[10px] text-fuchsia-300">바-무게중심 이격</p>
                    <p className="font-mono font-bold text-fuchsia-100 text-sm">
                      {result.cogGap.medianCm != null ? `${result.cogGap.medianCm}cm` : `${result.cogGap.medianRatio}`}
                      {result.cogGap.maxCm != null && <span className="text-[9px] text-fuchsia-300/70"> · 최대 {result.cogGap.maxCm}cm</span>}
                    </p>
                  </div>
                )}
                {result.crossValidation?.totalFrames > 0 && (
                  <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl py-2">
                    <p className="text-[10px] text-cyan-300">교차검증(신호 일치)</p>
                    <p className="font-mono font-bold text-cyan-100 text-sm">
                      {result.crossValidation.avgAgreement != null ? `${Math.round(result.crossValidation.avgAgreement * 100)}%` : '-'}
                      {result.crossValidation.assistRatio > 0 && (
                        <span className="text-[9px] text-cyan-300/70"> · 보완 {Math.round(result.crossValidation.assistRatio * 100)}%</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
            {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
            {videoBlob && (
              <button onClick={handleSaveVideo} disabled={savingVideo}
                className="w-full rounded-xl bg-slate-700 text-white font-bold py-2.5 text-sm active:scale-95 disabled:opacity-60">
                {savingVideo ? '저장 중…' : '🎥 녹화 영상 폰에 저장'}
              </button>
            )}
            {videoSavedMsg && <p className="text-center text-[11px] text-emerald-400">{videoSavedMsg}</p>}
          </div>
        )}
      </CameraStage>
    );
  }

  // ───────── 준비 화면(카메라 꺼짐) ─────────
  return (
    <div className={`space-y-4 ${embedded ? 'pt-44 px-3 max-w-md mx-auto overflow-y-auto pb-8' : ''}`} style={embedded ? { height: '100dvh' } : undefined}>
      {/* 임베드(허브) 모드에서는 상단 허브 오버레이가 뒤로가기·종목을 담당하므로 자체 헤더 숨김 */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">역도 · {exerciseType ? exerciseLabelLocal(exerciseType) : '바벨 추적'}</h2>
          <span className="w-12" />
        </div>
      )}

      {/* 키는 허브 선등록·회원정보에서 확보되므로 임베드 모드에선 숨김(중복 제거) */}
      {!embedded && (
        <HeightField value={heightCm} onChange={setHeightCm} member={member}
          hint="cm·속도 환산에 사용" />
      )}

      {/* 카메라 시작을 최상단으로(요구사항: 카메라 우선) */}
      <FramingIntro preset={FRAMING_PRESETS.lifting} onStart={startCam} startLabel="📷 카메라 시작 (전체화면)" />

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 카메라를 켜면 전체 화면으로 전환됩니다. 바벨 끝·원판 등 잘 보이는 곳을 2~3군데 눌러
        추적점을 지정하면, 한 점이 가려지거나 튀어도 나머지 점으로 보완해 오차를 줄입니다.
        반복은 바벨 움직임으로 자동 카운트됩니다.
      </p>

      {/* 원판 무게(기록용) — 접이식 */}
      <details className="rounded-xl bg-slate-900/60 border border-slate-700">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-300 select-none">
          원판 무게 설정 (기록용) · 선택
        </summary>
        <div className="px-3 pb-3">
          <PlateWeightInput value={plate} onChange={next => applyPlateWeight(next, 'plate-manual')} getVideo={null} />
        </div>
      </details>
    </div>
  );
}
