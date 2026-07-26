// ai-measure/menus/OneRMEstimate.jsx
// 메뉴 5: 1RM 추정 (벤치프레스 / 스쿼트 / 데드리프트).
//  - [재설계] 역도·VBT와 동일한 통일 UX:
//      · 무게는 "직접 입력"이 기본(가장 확실). 카메라는 원판 색 인식 보조.
//      · 카메라를 켜면 풀스크린 오버레이로 전환 → 영상 인식 후 닫으면
//        인식된 원판이 자동 채워지고, 장수를 직접 확인·수정한다.
//      · 인식이 안 되면 그냥 직접 입력으로 진행(폴백).
//  - 1RM = Epley·Brzycki 등 검증된 공식 평균.
import { useRef, useState, useEffect, useCallback } from 'react';
import { estimate1RM, LIFTS } from '../core/strength';
import {
  IWF_PLATES, BAR_WEIGHTS, detectPlatesFromVideo,
  suggestSidePlates, totalWeight,
} from '../core/plates';
import { repTargets } from '../core/strength';
import {
  snapWeight, stepWeight, clampReps, repEstimateConfidence,
  appendAttempt, summarizeAttempts, WEIGHT_STEP_KG,
} from '../core/lifting';
import { usePoseEngine } from '../core/usePoseEngine';
import { assessFraming, FRAMING_PRESETS } from '../core/framingGuide';
import { personHeightRatio, barbellPoint } from '../core/barbell';
import { BarbellAccumulator, estimateOneRmFromMeanVelocity } from '../core/barbellBiomechanics';
import { beepRep } from '../core/audioCue';
import { saveVideoToPhone, pickRecorderMime } from '../core/recordSink';
import { drawGaugeHud } from '../core/recordingOverlay';
import { DEFAULT_ASPECT, outputSize, aspectLabel, drawVideoCover } from '../core/recordAspect';
import FramingIntro from './FramingIntro';
import CameraStage from './CameraStage';
import GaugeHud from './GaugeHud';

const PLATE_HEX = { 빨강:'#D7263D', 파랑:'#0B61A4', 노랑:'#F2C200', 초록:'#1F9D55', 흰색:'#E8E8E8' };

// 무게 입력 방식. 다이얼이 기본(0.5kg 단위·빠르고 정확).
const WEIGHT_MODES = [
  ['dial', '🎚 다이얼'],
  ['manual', '⌨ 직접 입력'],
  ['plate', '🎨 원판 인식'],
];

const MAX_RECORDING_MS = 60000;

export default function OneRMEstimate({ member, onSave, onBack, exerciseType, embedded = false, autoStartSignal = 0, topOffset = 0 }) {
  // 허브 종목(exerciseType, 예 'bench_press') → 내부 lift 키('bench') 매핑.
  const exToLift = (ex) => (ex === 'bench_press' ? 'bench' : ex === 'squat' ? 'squat' : ex === 'deadlift' ? 'deadlift' : null);
  const [lift, setLift] = useState(exToLift(exerciseType) || 'squat');
  const [reps, setReps] = useState(5);
  const [barKg, setBarKg] = useState(20);
  const [sidePlates, setSidePlates] = useState([]);
  const [manualWeight, setManualWeight] = useState('');
  const [dialWeight, setDialWeight] = useState(60);          // 다이얼 무게(0.5kg 단위)
  const [weightMode, setWeightMode] = useState('dial');       // 'dial' | 'manual' | 'plate'
  // 사용자가 다이얼/직접입력으로 무게를 직접 정했는지 여부. true 면 색 인식이
  // 확인 없이 덮어쓰지 않는다(수동 40kg 이 자동 70kg 로 바뀌던 문제 방지).
  const [weightUserSet, setWeightUserSet] = useState(false);
  const [result, setResult] = useState(null);
  const [attempts, setAttempts] = useState([]);              // 도전 차수 누적
  // 카메라 세트에서 측정된 평균속도 기반 교차검증(속도→%1RM 근거 테이블).
  const [velocityCheck, setVelocityCheck] = useState(null);
  const liftToEx = (l) => (l === 'bench' ? 'bench_press' : l);

  // 허브에서 종목이 바뀌면 내부 lift 도 동기화(임베드 모드).
  useEffect(() => {
    const mapped = exToLift(exerciseType);
    if (embedded && mapped && mapped !== lift) { setLift(mapped); setResult(null); }
  }, [exerciseType, embedded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 카메라(원판 색 인식 + 바벨 추적 렙 카운팅) ──
  const canvasRef = useRef(null);
  const roiRef = useRef({ x: 0.30, y: 0.42, w: 0.40, h: 0.40 }); // 화면 중앙·원판 높이 박스
  const [detected, setDetected] = useState([]);
  const framingRef = useRef({ level: 'bad', message: '' });
  const [framing, setFraming] = useState({ level: 'bad', message: '카메라 준비 중…' });
  const liftRef = useRef(lift);
  liftRef.current = lift;
  // 바벨 추적(실시간 렙 카운팅 + 세트 평균속도 — 생체역학 엔진)
  const accRef = useRef(new BarbellAccumulator());
  const phRef = useRef(null);                 // 사람 화면상 신장(cm 환산 스케일)
  const heightRef = useRef(Number(member?.height) || null);
  heightRef.current = Number(member?.height) || null;
  const [liveHud, setLiveHud] = useState(null); // 실시간 렙 속도 게이지
  const countingRef = useRef(false);
  const consumedAutoStartRef = useRef(0);
  const camOpenedOnceRef = useRef(false); // 최초 카메라 오픈 여부(첫 진입 로더용)
  const countdownTimerRef = useRef(null);
  const maxRecordTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordCanvasRef = useRef(null);
  const composeRafRef = useRef(null);
  const recordStreamRef = useRef(null);
  const recordStartRef = useRef(0);
  const videoBlobRef = useRef(null);
  const [counting, setCounting] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const aspectRef = useRef(DEFAULT_ASPECT);
  const [countdown, setCountdown] = useState(null);
  useEffect(() => { aspectRef.current = aspect; }, [aspect]);
  const [liveReps, setLiveReps] = useState(0);
  const [videoBlob, setVideoBlob] = useState(null);
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoSavedMsg, setVideoSavedMsg] = useState('');

  // 최종 사용 무게 = '화면 다이얼에 보이는 값'을 단일 진실로 삼는다.
  //  (원판 색 인식·직접입력 모두 dialWeight 를 갱신하므로, 다이얼 = 저장/HUD 값.
  //   이렇게 하면 "다이얼엔 40인데 녹화엔 70" 같은 표시-저장 불일치가 사라진다.)
  const computedWeight = weightMode === 'manual'
    ? (Number(manualWeight) || snapWeight(dialWeight))
    : snapWeight(dialWeight);

  // 다이얼 조작 = 사용자가 무게를 직접 정함(색 인식이 조용히 덮어쓰지 않도록 표식).
  const bumpDial = (deltaSteps) => {
    setDialWeight((w) => stepWeight(w, deltaSteps));
    setWeightMode('dial');
    setWeightUserSet(true);
  };
  const setDialAbsolute = (kg) => {
    setDialWeight(snapWeight(kg));
    setWeightMode('dial');
    setWeightUserSet(true);
  };

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

  const handleResult = useCallback((lms, ts, _video) => {
    // 오버레이/추적선 없음(RSI 방식) — 캔버스는 비워 둔다.
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const want = (FRAMING_PRESETS[liftRef.current] || FRAMING_PRESETS.squat).want;
    const fr = assessFraming(lms, { want });
    if (fr.level !== framingRef.current.level || fr.message !== framingRef.current.message) {
      framingRef.current = fr;
      setFraming({ level: fr.level, message: fr.message });
    }

    // 사람 신장 스케일(속도 cm 환산).
    const ph = personHeightRatio(lms);
    if (ph) phRef.current = ph;

    // 바 위치 = 양 손목 중점(스켈레톤). 별도 추적점 지정 없이 반복을 자동 인식.
    if (!countingRef.current) return;
    const bar = barbellPoint(lms);
    if (!bar) return;
    accRef.current.push(bar, ts);
    const cmPerRatio = heightRef.current && phRef.current ? heightRef.current / phRef.current : null;
    const lv = accRef.current.live(cmPerRatio);
    setLiveReps(prev => { if (lv.reps > prev) beepRep(); return prev !== lv.reps ? lv.reps : prev; });
    setLiveHud(prev => {
      if (prev && prev.reps === lv.reps && prev.lastRepVelocity === lv.lastRepVelocity
        && prev.velocityLossPct === lv.velocityLossPct) return prev;
      return lv;
    });
  }, []);

  // 렙 카운팅 시작/정지.
  const toggleCounting = () => {
    if (countdown != null) return;
    if (!counting) {
      runStartCountdown(() => {
        accRef.current.reset();
        setLiveReps(0);
        setLiveHud(null);
        setVelocityCheck(null);
        setVideoBlob(null); videoBlobRef.current = null; setVideoSavedMsg('');
        recordStartRef.current = performance.now();
        countingRef.current = true;
        setCounting(true);
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
        maxRecordTimerRef.current = setTimeout(() => finishCounting(true), MAX_RECORDING_MS);
      });
    } else {
      clearMaxRecordTimer();
      countingRef.current = false;
      setCounting(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { stopCompose(); }
      } else {
        stopCompose();
      }
      applyEngineResult(); // 자동 카운트 + 속도 기반 교차검증 반영
    }
  };

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  const stopCompose = () => {
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  const createRecordedStream = () => {
    const video = videoRef.current;
    const size = outputSize(aspectRef.current); // 인스타 비율 통일
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawVideoCover(ctx, video, canvas.width, canvas.height);
      const live = accRef.current.live();
      const liveOneRM = live.reps > 0
        ? estimate1RM(snapWeight(computedWeight), live.reps).average
        : null;
      // 실시간 추정 1RM을 중앙에 번인한다. 입력 무게·자동 반복·속도는 근거값으로 함께 남긴다.
      drawGaugeHud(ctx, canvas.width, canvas.height, {
        title: '1RM',
        recording: countingRef.current,
        elapsedSec: countingRef.current ? (performance.now() - recordStartRef.current) / 1000 : null,
        accent: '#f59e0b',
        gauge: { label: '추정 1RM', value: liveOneRM, unit: 'kg' },
        stats: [
          { label: '입력 무게', value: snapWeight(computedWeight), unit: 'kg' },
          { label: '반복', value: live.reps, unit: '회' },
          { label: '평균속도', value: live.lastRepVelocity ?? null, unit: 'm/s' },
        ],
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


  // 세트 종료 공통: 엔진 요약 → 반복 반영 + 속도 기반 1RM 교차검증(정직성 게이트 포함).
  const applyEngineResult = () => {
    const heightNum = Number(member?.height) || null;
    const cmPerRatio = heightNum && phRef.current ? heightNum / phRef.current : null;
    const sum = accRef.current.summary({ cmPerRatio, source: 'live' });
    if (!sum || sum.valid === false) return;
    if (sum.repCount > 0) setReps(sum.repCount);
    const vc = estimateOneRmFromMeanVelocity({
      exerciseType: liftToEx(liftRef.current),
      loadKg: computedWeight,
      meanVelocity: sum.meanVelocity,
    });
    setVelocityCheck(vc.oneRm != null
      ? { ...vc, meanVelocity: sum.meanVelocity, repCount: sum.repCount }
      : null); // 범위 밖/스케일 없음이면 표시하지 않음(그럴듯한 가짜값 금지)
  };

  const finishCounting = (autoLimited = false) => {
    if (!countingRef.current) return;
    clearMaxRecordTimer();
    countingRef.current = false;
    setCounting(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) { stopCompose(); }
    } else {
      stopCompose();
    }
    applyEngineResult();
    if (autoLimited) setVideoSavedMsg('최대 60초 녹화가 완료되었습니다.');
  };

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
      stop();
      countingRef.current = false;
      stopCompose();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
    };
  }, [clearCountdown, clearMaxRecordTimer, syncCanvas, stop]);

  const openCam = useCallback(() => {
    setDetected([]);
    accRef.current.reset();
    setVelocityCheck(null);
    countingRef.current = false; setCounting(false);
    setLiveReps(0);
    setVideoBlob(null); videoBlobRef.current = null; setVideoSavedMsg('');
    camOpenedOnceRef.current = true;
    start();
  }, [start]);

  useEffect(() => {
    if (!autoStartSignal || consumedAutoStartRef.current === autoStartSignal) return;
    consumedAutoStartRef.current = autoStartSignal;
    if (status === 'idle') openCam();
  }, [autoStartSignal, openCam, status]);

  // 카메라를 닫으면, 인식된 원판이 없을 때는 직접 입력으로 자연스럽게 되돌린다.
  const closeCam = () => {
    clearCountdown();
    clearMaxRecordTimer();
    stop();
    countingRef.current = false; setCounting(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) { stopCompose(); }
    } else {
      stopCompose();
    }
    if (detected.length === 0 && sidePlates.length === 0) setWeightMode('dial');
  };

  // 색 자동인식(보조) — 현재 프레임 ROI 색 집계 → 후보 채움
  const scanColors = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { alert('카메라가 아직 준비되지 않았습니다.'); return; }
    const { dominant, roi: detectedRoi } = detectPlatesFromVideo(v, roiRef.current);
    if (!dominant.length) { alert('원판 색을 찾지 못했습니다. 원판이 박스 안에 잘 보이게 한 뒤 다시 시도하세요.'); return; }
    const nextSidePlates = suggestSidePlates(dominant);
    const scannedTotal = totalWeight(nextSidePlates, barKg).total;
    // 사용자가 이미 무게를 직접 설정했고, 인식 결과가 다르면 함부로 덮어쓰지 않는다.
    //  (수동 40kg 이 색 인식으로 조용히 70kg 로 바뀌던 문제 방지 — 정직성/신뢰)
    if (weightUserSet && Math.abs(scannedTotal - snapWeight(dialWeight)) >= 0.5) {
      const ok = window.confirm(
        `현재 설정한 무게는 ${snapWeight(dialWeight)}kg 입니다.\n`
        + `색 인식 결과(${scannedTotal}kg)로 바꿀까요?\n\n`
        + `취소하면 설정한 무게(${snapWeight(dialWeight)}kg)를 그대로 사용합니다.`
      );
      if (!ok) { setDetected(dominant); return; } // 감지 라벨만 참고 표시, 무게는 유지
    }
    if (detectedRoi) roiRef.current = detectedRoi;
    setDetected(dominant);
    setSidePlates(nextSidePlates);
    setWeightMode('plate');
    setDialWeight(scannedTotal);
    setWeightUserSet(false); // 색 인식 채택 → 자동값 상태로 전환
  };

  const handleSaveVideo = async () => {
    const blob = videoBlobRef.current || videoBlob;
    if (!blob) { alert('저장할 녹화 영상이 없습니다.'); return; }
    setSavingVideo(true);
    try {
      const res = await saveVideoToPhone(blob, {
        measure: `1RM_${LIFTS.find(l => l.key === lift)?.label || lift}`,
        member,
      });
      setVideoSavedMsg(res.saved
        ? (res.method === 'share' ? '저장/공유 창을 열었습니다.' : '영상이 다운로드되었습니다.')
        : '저장이 취소되었습니다.');
    } catch (e) {
      setVideoSavedMsg('영상 저장에 실패했습니다.');
    }
    setSavingVideo(false);
  };

  const addPlate = (p) => {
    setWeightMode('plate');
    setSidePlates(prev => {
      const i = prev.findIndex(x => x.kg === p.kg);
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], count: n[i].count + 1 }; return n; }
      return [...prev, { kg: p.kg, label: p.label, count: 1 }];
    });
  };
  const changeCount = (kg, delta) => {
    setSidePlates(prev => prev
      .map(x => x.kg === kg ? { ...x, count: Math.max(0, x.count + delta) } : x)
      .filter(x => x.count > 0));
  };

  const calc = () => {
    const w = computedWeight, r = clampReps(reps);
    if (!w || w <= 0) { alert('무게가 0보다 커야 합니다. 무게를 설정하거나 원판을 구성하세요.'); return; }
    // 반복 제한 없음(카운터). 고반복은 차단하지 않고 신뢰도로 안내(정직성).
    setResult({ ...estimate1RM(w, r), usedWeight: w, usedReps: r });
  };

  const save = () => {
    if (!result) return;
    // 도전 차수 누적(같은 세션 1·2·3차…). 저장 시 현재 결과를 한 차수로 기록.
    const nextAttempts = appendAttempt(attempts, {
      weight: result.usedWeight,
      reps: result.usedReps ?? Number(reps),
      oneRM: result.average,
      success: true,
    });
    setAttempts(nextAttempts);
    const summary = summarizeAttempts(nextAttempts);
    onSave?.({
      lift,
      liftLabel: LIFTS.find(l => l.key === lift)?.label,
      weight: result.usedWeight,
      reps: result.usedReps ?? Number(reps),
      oneRM: result.average,
      epley: result.epley,
      brzycki: result.brzycki,
      formulas: result.formulas,
      estimateStats: result.stats,
      confidenceInterval: result.confidenceInterval,
      formulaSpreadKg: result.formulaSpreadKg,
      formulaSpreadPct: result.formulaSpreadPct,
      barKg: weightMode === 'plate' ? barKg : null,
      sidePlates: weightMode === 'plate' ? sidePlates : null,
      weightSource: weightMode === 'manual' ? 'manual'
        : weightMode === 'dial' ? 'dial' : 'plate-color',
      attemptNo: summary.count,           // 이번이 몇 차 도전인지
      attempts: nextAttempts,             // 전체 도전 기록
      bestOneRM: summary.bestOneRM,       // 누적 최고 1RM
      bestAttemptNo: summary.bestAttemptNo,
      velocityCheck: velocityCheck ?? null,             // 속도 기반 e1RM 교차검증
      measuredMeanVelocity: velocityCheck?.meanVelocity ?? null,
      videoBlob: videoBlobRef.current || videoBlob || null,
    });
  };

  // ───────── 풀스크린 카메라(원판 색 인식 + 바벨 추적 렙 카운팅) ─────────
  if (status !== 'idle') {
    const liveOneRM = liveReps > 0
      ? estimate1RM(snapWeight(computedWeight), liveReps).average
      : null;
    const topBar = (
      <>

        <span className="bg-black/65 rounded-full px-2.5 py-1 text-[10px] text-cyan-300 font-bold">
          {counting ? '세트 수행 중 — 반복 자동 인식 · 끝나면 정지' : '옆에서 촬영 · 카운트 시작을 누르고 세트 수행'}
        </span>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${framing.level === 'good' ? 'bg-emerald-500/85 text-slate-950' : framing.level === 'warn' ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
          {framing.level === 'good' ? '✓ ' : '⚠ '}{framing.message}
        </span>
        <div className="pointer-events-auto flex gap-0.5 rounded-full bg-black/55 backdrop-blur p-0.5 border border-white/10">
          {['3/4', '1/1'].map((r) => (
            <button key={r} onClick={() => !counting && setAspect(r)} disabled={counting}
              className={`rounded-full px-2 py-0.5 text-[10px] font-black transition-colors disabled:opacity-50 ${aspect === r ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
              {aspectLabel(r)}
            </button>
          ))}
        </div>
      </>
    );
    const controls = (
      <div className="flex items-center gap-2">
        <button onClick={toggleCounting}
          disabled={countdown != null}
          className={`px-5 h-12 rounded-full text-sm font-black active:scale-95 shadow-lg disabled:opacity-60 ${counting ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}>
          {counting ? '■ 카운트 정지' : countdown != null ? '시작 대기' : '● 카운트 시작'}
        </button>
        <button onClick={scanColors}
          className="px-3.5 h-12 rounded-full text-xs font-black bg-slate-700 text-white active:scale-95 shadow-lg">
          🎨 색 인식
        </button>
      </div>
    );
    return (
      <CameraStage
        videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
        onClose={closeCam} topBar={topBar} controls={controls}
        recording={counting} recordingLabel="카운트 중" tappable={countdown == null}
        countdown={countdown}
        topOffset={topOffset}
        aspectFrame={aspect}
      >
        {counting && liveHud?.repList?.length > 0 && (
          <div className="mx-auto max-w-sm w-full overflow-x-auto pointer-events-none">
            <div className="flex gap-1.5 justify-end min-w-max px-1">
              {liveHud.repList.map((r, i) => {
                const latest = i === liveHud.repList.length - 1;
                return (
                  <span key={r.repNo}
                    className={`rounded-xl px-2 py-1 font-mono text-[11px] font-black backdrop-blur ${
                      latest ? 'bg-cyan-400/90 text-slate-950 shadow-lg shadow-cyan-400/30' : 'bg-black/50 text-slate-200 border border-white/10'}`}>
                    {r.repNo}<span className="opacity-60 text-[9px]">회</span> {r.meanVelocity ?? '–'}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {counting && (
          <GaugeHud
            label="추정 1RM"
            value={liveOneRM}
            unit="kg"
            accent="#f59e0b"
            stats={[
              { label: 'LOAD', value: snapWeight(computedWeight), unit: 'kg' },
              { label: 'REPS', value: liveReps, unit: '회' },
              { label: 'V', value: liveHud?.lastRepVelocity ?? null, unit: 'm/s' },
            ]}
          />
        )}
        {/* 무게 다이얼 반투명 오버레이 — 녹화(카운트) 버튼 바로 위. 촬영 전 무게 조정 */}
        {!counting && (
          <div className="mx-auto max-w-xs w-full rounded-xl bg-black/55 backdrop-blur border border-white/10 p-2">
            <div className="flex items-center justify-center gap-1.5">
              <button onClick={() => { bumpDial(-10); }}
                className="w-9 h-9 rounded-lg bg-white/10 text-slate-100 font-black text-[11px] active:scale-90">−5</button>
              <button onClick={() => { bumpDial(-1); }}
                className="w-9 h-9 rounded-lg bg-white/10 text-slate-100 font-black active:scale-90">−</button>
              <div className="min-w-[72px] text-center">
                <p className="font-mono font-black text-2xl text-white leading-none">{snapWeight(dialWeight)}</p>
                <p className="text-[8px] text-slate-400">kg</p>
              </div>
              <button onClick={() => { bumpDial(+1); }}
                className="w-9 h-9 rounded-lg bg-amber-500 text-slate-950 font-black active:scale-90">+</button>
              <button onClick={() => { bumpDial(+10); }}
                className="w-9 h-9 rounded-lg bg-amber-500 text-slate-950 font-black text-[11px] active:scale-90">+5</button>
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-2 text-[9px] text-slate-400">
              <span>{weightMode === 'plate' ? '원판 색 인식 반영' : '수동 무게'}</span>
              {detected.length > 0 && <span className="text-cyan-300">{detected.map(d => d.label).join(', ')}</span>}
            </div>
          </div>
        )}
        {videoBlob && !counting && (
          <div className="mx-auto max-w-xs w-full space-y-1">
            <button onClick={handleSaveVideo} disabled={savingVideo}
              className="w-full rounded-xl bg-slate-700 text-white font-bold py-2.5 text-sm active:scale-95 disabled:opacity-60">
              {savingVideo ? '저장 중...' : '녹화 영상 폴더에 저장'}
            </button>
            {videoSavedMsg && <p className="text-center text-[11px] text-emerald-400">{videoSavedMsg}</p>}
          </div>
        )}
      </CameraStage>
    );
  }

  // ───────── 첫 진입(허브 내부): 준비 화면 대신 카메라 로더 ─────────
  //  autoStart effect 가 마운트 직후 카메라를 켠다. 카메라를 한 번 닫은 뒤
  //  (반복 입력/결과 확인) 되돌아오는 화면은 그대로 보여준다.
  if (embedded && !camOpenedOnceRef.current) {
    return (
      <div className="fixed inset-0 z-[70] bg-slate-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-amber-400/40 border-t-amber-400 animate-spin" />
        <p className="text-sm font-bold text-slate-300">카메라를 켜는 중…</p>
      </div>
    );
  }

  // ───────── 입력/결과 화면 ─────────
  return (
    <div className={`space-y-4 ${embedded ? 'pt-36 px-3 max-w-md mx-auto overflow-y-auto pb-8' : ''}`} style={embedded ? { height: '100dvh' } : undefined}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">1RM 측정</h2>
          <span className="w-12" />
        </div>
      )}

      {/* 종목 — 임베드(허브) 모드에서는 상단 허브 선택기가 담당하므로 숨김 */}
      {!embedded && (
        <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
          {LIFTS.map(l => (
            <button key={l.key} onClick={() => { setLift(l.key); setResult(null); }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${lift === l.key ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
              {l.label}
            </button>
          ))}
        </div>
      )}

      {/* 무게 입력 방식 토글 (다이얼 기본) */}
      <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5 w-full text-[11px]">
        {WEIGHT_MODES.map(([k, label]) => (
          <button key={k} onClick={() => setWeightMode(k)}
            className={`flex-1 px-2 py-1.5 rounded font-bold ${weightMode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {weightMode === 'dial' ? (
        /* ── 무게 다이얼(기본 · 0.5kg 단위) ── */
        <div className="card-accent p-4">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3 text-center">든 무게 (0.5kg 단위)</label>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => bumpDial(-10)}
              className="w-12 h-12 rounded-xl bg-slate-700 text-slate-200 font-black text-sm active:scale-90">−5</button>
            <button onClick={() => bumpDial(-1)}
              className="w-12 h-12 rounded-xl bg-slate-700 text-slate-200 font-black active:scale-90">−</button>
            <div className="min-w-[110px] text-center">
              <p className="font-mono font-black text-4xl text-slate-100 leading-none">{snapWeight(dialWeight)}</p>
              <p className="text-[10px] text-slate-500 mt-1">kg</p>
            </div>
            <button onClick={() => bumpDial(+1)}
              className="w-12 h-12 rounded-xl bg-amber-500 text-slate-950 font-black active:scale-90">+</button>
            <button onClick={() => bumpDial(+10)}
              className="w-12 h-12 rounded-xl bg-amber-500 text-slate-950 font-black text-sm active:scale-90">+5</button>
          </div>
          <input type="range" min="0" max="300" step={WEIGHT_STEP_KG} value={snapWeight(dialWeight)}
            onChange={e => setDialAbsolute(e.target.value)}
            className="w-full mt-4 accent-amber-500" />
        </div>
      ) : weightMode === 'manual' ? (
        /* ── 직접 입력 ── */
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">든 무게 (kg)</label>
          <input type="number" step="0.5" value={manualWeight} onChange={e => { setManualWeight(e.target.value); setWeightUserSet(true); }}
            placeholder="80" className="input-mono" />
        </div>
      ) : (
        /* ── 원판 색·크기 인식(보조) + 수동 확인 ── */
        <div className="space-y-3">
          <FramingIntro
            preset={FRAMING_PRESETS[lift] || FRAMING_PRESETS.squat}
            onStart={openCam}
            startLabel="📷 카메라로 원판 인식 (전체화면)"
          />

          {detected.length > 0 && (
            <p className="text-[11px] text-cyan-400">
              인식된 색: {detected.map(d => `${d.label}(${Math.round(d.ratio * 100)}%)`).join(', ')} — 아래에서 장수를 확인·수정하세요.
            </p>
          )}

          {/* 봉 무게 */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">봉 무게</label>
            <select value={barKg} onChange={e => setBarKg(Number(e.target.value))} className="input">
              {BAR_WEIGHTS.map(b => <option key={b.kg} value={b.kg}>{b.label}</option>)}
            </select>
          </div>

          {/* 편측 원판 추가 */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">한쪽 원판 추가 (양쪽 동일 적용)</label>
            <div className="flex flex-wrap gap-1.5">
              {IWF_PLATES.filter(p => !p.small && !p.chrome).map(p => (
                <button key={p.label} onClick={() => addPlate(p)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold border"
                  style={{ borderColor: PLATE_HEX[p.label] || '#64748b', color: PLATE_HEX[p.label] || '#cbd5e1' }}>
                  + {p.kg}
                </button>
              ))}
            </div>
          </div>

          {sidePlates.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-3 space-y-2">
              <p className="text-[10px] text-slate-500">한쪽 구성 (확인·수정)</p>
              {sidePlates.map(p => (
                <div key={p.kg} className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: PLATE_HEX[p.label] || '#cbd5e1' }}>
                    {p.label} {p.kg}kg
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => changeCount(p.kg, -1)} className="w-7 h-7 rounded bg-slate-700 text-slate-200 font-bold">−</button>
                    <span className="font-mono font-bold text-slate-100 w-6 text-center">{p.count}</span>
                    <button onClick={() => changeCount(p.kg, +1)} className="w-7 h-7 rounded bg-slate-700 text-slate-200 font-bold">+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card-accent p-3 text-center">
            <p className="text-[10px] text-slate-500">총중량 (양쪽 + 봉)</p>
            <p className="font-mono font-black text-2xl text-slate-100">{computedWeight}<span className="text-sm text-slate-500"> kg</span></p>
          </div>
        </div>
      )}

      {/* 반복 횟수 — 카운터(제한 없음). 고반복은 차단 않고 신뢰도로 안내 */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">반복 횟수</label>
        <div className="flex items-center gap-3">
          <button onClick={() => setReps(r => clampReps(Number(r) - 1))}
            className="w-12 h-12 rounded-xl bg-slate-700 text-slate-200 font-black text-xl active:scale-90">−</button>
          <div className="flex-1 text-center">
            <p className="font-mono font-black text-3xl text-slate-100 leading-none">{clampReps(reps)}<span className="text-base text-slate-500"> 회</span></p>
          </div>
          <button onClick={() => setReps(r => clampReps(Number(r) + 1))}
            className="w-12 h-12 rounded-xl bg-amber-500 text-slate-950 font-black text-xl active:scale-90">+</button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {[1, 3, 5, 8, 10].map(r => (
            <button key={r} onClick={() => setReps(r)}
              className={`flex-1 py-1 rounded-lg text-[11px] font-bold ${clampReps(reps) === r ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-500'}`}>
              {r}회
            </button>
          ))}
        </div>
        {(() => {
          const c = repEstimateConfidence(reps);
          const tone = c.level === 'high' ? 'text-emerald-400' : c.level === 'medium' ? 'text-amber-400' : 'text-red-400';
          return <p className={`mt-1.5 text-[11px] font-bold ${tone}`}>● {c.note}</p>;
        })()}
        <button onClick={openCam}
          className="mt-2 w-full rounded-xl bg-slate-700 text-white font-bold py-2.5 text-sm active:scale-95">
          📷 카메라로 반복 자동 측정
        </button>
      </div>

      {videoBlob && (
        <button onClick={handleSaveVideo} disabled={savingVideo}
          className="w-full rounded-xl bg-slate-700 text-white font-bold py-2.5 text-sm active:scale-95 disabled:opacity-60">
          {savingVideo ? '저장 중...' : '녹화 영상 폴더에 저장'}
        </button>
      )}
      {videoSavedMsg && <p className="text-center text-[11px] text-emerald-400">{videoSavedMsg}</p>}

      <button onClick={calc}
        className="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-base active:scale-[0.98] shadow-xl shadow-amber-500/25">
        1RM 계산 →
      </button>

      {/* 도전 차수 누적 기록 */}
      {attempts.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">도전 기록 ({attempts.length}차)</p>
            <button onClick={() => setAttempts([])} className="text-[10px] text-slate-500 underline">초기화</button>
          </div>
          <div className="space-y-1">
            {attempts.map(a => {
              const best = summarizeAttempts(attempts).bestAttemptNo === a.attemptNo;
              return (
                <div key={a.attemptNo} className={`flex items-center justify-between text-[11px] rounded px-2 py-1 ${best ? 'bg-amber-500/15 border border-amber-500/30' : 'bg-slate-900/60'}`}>
                  <span className="text-slate-400 font-bold">{a.attemptNo}차</span>
                  <span className="text-slate-300">{a.weight}kg × {a.reps}회</span>
                  <span className={`font-mono font-bold ${best ? 'text-amber-300' : 'text-slate-300'}`}>{a.oneRM}kg{best ? ' ★' : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-3xl bg-slate-950/80 border border-amber-400/30 p-4 space-y-3 animate-fade-in shadow-2xl">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black text-amber-400 tracking-widest">
              추정 1RM · {result.usedWeight}kg × {result.usedReps ?? reps}회
            </p>
            {attempts.length > 0 && <span className="rounded-full bg-white/[0.07] border border-white/10 px-2.5 py-0.5 text-[9px] font-black text-slate-300">저장 시 {attempts.length + 1}차</span>}
          </div>
          <div className="relative mx-auto w-44 h-44">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 opacity-90" />
            <div className="absolute inset-[7px] rounded-full bg-slate-950 flex flex-col items-center justify-center">
              <p className="font-mono font-black text-slate-50 leading-none" style={{ fontSize: 46 }}>{result.average}</p>
              <p className="text-xs font-black text-slate-500 mt-1">kg</p>
            </div>
          </div>
          <p className="text-center text-[10px] text-slate-500">검증된 {result.formulas.filter(f => f.value != null).length}개 공식 평균</p>
          {result.stats && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-800 p-2">
                <p className="text-[10px] text-slate-500">공식 편차</p>
                <p className="font-mono font-bold text-slate-100">{result.stats.spreadKg ?? '—'}kg</p>
              </div>
              <div className="rounded-xl bg-slate-800 p-2">
                <p className="text-[10px] text-slate-500">편차율</p>
                <p className="font-mono font-bold text-slate-100">{result.stats.spreadPct != null ? `${result.stats.spreadPct}%` : '—'}</p>
              </div>
              <div className="rounded-xl bg-slate-800 p-2">
                <p className="text-[10px] text-slate-500">참고 범위</p>
                <p className="font-mono font-bold text-slate-100">
                  {result.confidenceInterval?.low != null ? `${result.confidenceInterval.low}~${result.confidenceInterval.high}` : '—'}
                </p>
              </div>
            </div>
          )}

          {velocityCheck?.oneRm != null && (() => {
            const diffPct = result.average > 0
              ? Math.round(Math.abs(velocityCheck.oneRm - result.average) / result.average * 100) : null;
            const agree = diffPct != null && diffPct <= 10;
            return (
              <div className={`rounded-xl p-3 border ${agree ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                <p className={`text-[10px] mb-1 font-bold ${agree ? 'text-emerald-300' : 'text-amber-300'}`}>
                  속도 기반 교차검증 (평균속도 {velocityCheck.meanVelocity}m/s · {velocityCheck.repCount}회 추적)
                </p>
                <p className="text-[11px] text-slate-200">
                  속도→%1RM 근거 테이블 추정 <span className="font-mono font-bold">{velocityCheck.oneRm}kg</span>
                  {diffPct != null && <span className={agree ? 'text-emerald-300' : 'text-amber-300'}> · 공식 평균과 {diffPct}% {agree ? '일치' : '차이 — 무게 입력·추적 확인'}</span>}
                </p>
                <p className="text-[9px] text-slate-500 mt-0.5">신뢰도 {velocityCheck.confidence === 'medium' ? '보통' : '낮음(데드리프트는 연구 편차 큼)'} · 참고용</p>
              </div>
            );
          })()}

          <div className="bg-slate-800 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 mb-1.5">공식별 추정 (kg)</p>
            <div className="grid grid-cols-2 gap-1.5 text-center text-[11px]">
              {result.formulas.map(f => (
                <div key={f.key} className="flex justify-between bg-slate-900/60 rounded px-2 py-1">
                  <span className="text-slate-500">{f.label}</span>
                  <span className="font-mono font-bold text-slate-200">
                    {f.value != null ? f.value : <span className="text-slate-600">제외</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 mb-1.5">반복별 목표 무게 (참고 · 회원별 실제값은 측정으로 확정)</p>
            <div className="grid grid-cols-2 gap-1 text-center text-[11px]">
              {repTargets(result.average).map(t => (
                <div key={t.reps}>
                  <p className="text-slate-500">{t.reps}회 ({t.pct}%)</p>
                  <p className="font-mono font-bold text-amber-400">{t.weight} kg</p>
                </div>
              ))}
            </div>
          </div>
          {onSave && (
            <button onClick={save}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-[15px] active:scale-[0.98] shadow-lg shadow-amber-500/25">
              저장하고 1RM 결과 리포트 보기 →
            </button>
          )}
          {videoBlob && (
            <button onClick={handleSaveVideo} disabled={savingVideo}
              className="w-full rounded-xl bg-slate-700 text-white font-bold py-2.5 text-sm active:scale-95 disabled:opacity-60">
              {savingVideo ? '저장 중...' : '녹화 영상 폴더에 저장'}
            </button>
          )}
          {videoSavedMsg && <p className="text-center text-[11px] text-emerald-400">{videoSavedMsg}</p>}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 무게는 다이얼(0.5kg) 또는 직접 입력이 가장 확실합니다. 원판 인식은 보조 기능으로,
        IWF 표준은 색=무게(빨강25·파랑20·노랑15·초록10·흰5kg)입니다. 같은 색의 큰/작은 원판
        (예: 빨강 25kg vs 2.5kg)은 지름이 다르므로, 인식 후 장수를 반드시 직접 확인·수정하세요.
        추정식은 1~10회에서 가장 정확하며, 그 이상은 참고용입니다.
      </p>
    </div>
  );
}
