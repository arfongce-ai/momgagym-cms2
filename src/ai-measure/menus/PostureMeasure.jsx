import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayYMD } from '../../utils/dates';
import { usePoseEngine } from '../core/usePoseEngine';
import { createSmoother } from '../core/smoothing';
import { analyzePostureFromLandmarks, classifyPostureAgeGroup, medianLandmarks, detectPostureView, PostureViewVoter } from '../core/postureMath';
import { beepTick, beepGo, beepSuccess, primeAudio } from '../core/audioCue';
import CameraStage from './CameraStage.jsx';
import PostureReport from './PostureReport.jsx';
import ReportActions from '../../components/report/ReportActions';
import { dataUrlToFile } from '../core/reportShare';

const VIEW_STEPS = [
  { key: 'front', label: '정면', short: '앞' },
  { key: 'right', label: '우측면', short: '오른쪽' },
  { key: 'back', label: '후면', short: '뒤' },
  { key: 'left', label: '좌측면', short: '왼쪽' },
];

const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

// 캡처 직전 이 시간(ms) 동안 모인 프레임을 좌표별 중앙값으로 결합해 떨림 제거.
// 시간 기반이라 카메라 fps 와 무관하게 동작한다(30fps≈15장, 60fps≈30장).
const CAPTURE_WINDOW_MS = 500;
const CAPTURE_MIN_FRAMES = 3;

export default function PostureMeasure({ member, onSave, onBack }) {
  const canvasRef = useRef(null);
  const latestLandmarksRef = useRef(null);
  const latestVideoRef = useRef(null);
  const smootherRef = useRef(createSmoother(0.28));
  // 캡처 직전 N프레임 버퍼: [{ landmarks, ts }] 시간순. CAPTURE_WINDOW_MS 보다
  // 오래된 프레임은 버린다(슬라이딩 윈도우). 캡처 시 중앙값 결합에 사용.
  const frameBufferRef = useRef([]);
  // 자동 촬영용: 현재 프레임의 방향(면) 안정 판정 누적기 + 진행 제어 ref
  const viewVoterRef = useRef(new PostureViewVoter({ window: 12 }));
  const autoCountdownRef = useRef(null);   // 카운트다운 인터벌
  const autoBusyRef = useRef(false);       // 카운트다운/캡처 진행 중 재트리거 방지
  const activeViewKeyRef = useRef('front'); // 콜백에서 최신 목표 면 참조
  const captureModeRef = useRef('select');  // 콜백에서 최신 모드 참조
  const activeStepLabelRef = useRef('정면'); // 수동 모드 가이드 문구용

  // 촬영 방식: 'select'(시작 전 모드 선택) → 'auto' | 'manual'
  const [captureMode, setCaptureMode] = useState('select'); // select | auto | manual
  const [started, setStarted] = useState(false);             // 카메라 측정 진입 여부
  const [detectedView, setDetectedView] = useState('unknown'); // 자동 모드 현재 인식 면
  const [autoCountdown, setAutoCountdown] = useState(null);    // 3,2,1 표시

  const [selectedViews, setSelectedViews] = useState(() => ({
    front: true,
    right: true,
    back: true,
    left: true,
  }));
  const [activeViewKey, setActiveViewKey] = useState('front');
  const [captures, setCaptures] = useState({});
  const capturesRef = useRef({});
  useEffect(() => { capturesRef.current = captures; }, [captures]);
  const [liveAnalysis, setLiveAnalysis] = useState(null);
  const [report, setReport] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [guide, setGuide] = useState('정면으로 서서 전신이 화면 안에 들어오게 맞춰주세요.');

  const selectedSteps = useMemo(
    () => VIEW_STEPS.filter((step) => selectedViews[step.key]),
    [selectedViews],
  );
  const selectedStepsRef = useRef(selectedSteps);
  useEffect(() => { selectedStepsRef.current = selectedSteps; }, [selectedSteps]);
  const activeStep = selectedSteps.find((step) => step.key === activeViewKey) || selectedSteps[0] || VIEW_STEPS[0];
  const activeIndex = Math.max(0, selectedSteps.findIndex((step) => step.key === activeStep.key));
  useEffect(() => { activeViewKeyRef.current = activeStep.key; }, [activeStep.key]);
  useEffect(() => { activeStepLabelRef.current = activeStep.label; }, [activeStep.label]);
  useEffect(() => { captureModeRef.current = captureMode; }, [captureMode]);

  const bodyInfo = useMemo(() => ({
    heightCm: Number(member?.height || member?.heightCm) || null,
    actualAge: getAge(member?.birthDate) || Number(member?.age) || null,
  }), [member]);
  const bodyInfoRef = useRef(bodyInfo);
  useEffect(() => { bodyInfoRef.current = bodyInfo; }, [bodyInfo]);

  useEffect(() => {
    if (!selectedSteps.length) {
      setSelectedViews((prev) => ({ ...prev, front: true }));
      setActiveViewKey('front');
      return;
    }
    if (!selectedViews[activeViewKey]) setActiveViewKey(selectedSteps[0].key);
  }, [activeViewKey, selectedSteps, selectedViews]);

  const analyzeLandmarks = useCallback((landmarks) => {
    if (!landmarks) return null;
    return analyzePostureFromLandmarks(landmarks, {
      heightCm: bodyInfo.heightCm,
      actualAge: bodyInfo.actualAge,
    });
  }, [bodyInfo.actualAge, bodyInfo.heightCm]);

  const handlePose = useCallback((landmarks, ts, video) => {
    latestVideoRef.current = video || latestVideoRef.current;
    const smoothed = landmarks ? smootherRef.current(landmarks) : smootherRef.current(null);
    latestLandmarksRef.current = smoothed || latestLandmarksRef.current;
    drawSkeleton(canvasRef.current, video, smoothed);

    if (!smoothed) {
      setGuide('전신이 보이도록 한 걸음 뒤로 이동해 주세요.');
      frameBufferRef.current = [];
      viewVoterRef.current.reset();
      return;
    }
    if (!isFullBodyVisible(smoothed)) {
      setGuide('어깨, 골반, 무릎, 발목이 모두 보이게 화면을 맞춰주세요.');
      frameBufferRef.current = [];
      viewVoterRef.current.reset();
      return;
    }
    // 안정적으로 전신이 잡힌 프레임만 시간순 버퍼에 누적(슬라이딩 윈도우).
    const buf = frameBufferRef.current;
    buf.push({ landmarks: smoothed, ts });
    const cutoff = ts - CAPTURE_WINDOW_MS;
    while (buf.length && buf[0].ts < cutoff) buf.shift();
    if (ts % 250 < 18) setLiveAnalysis(analyzeLandmarks(smoothed));

    // ── 자동 촬영 모드: 목표 면 인식 → 안정되면 카운트다운 트리거 ──
    if (captureModeRef.current === 'auto') {
      const target = activeViewKeyRef.current;
      const det = detectPostureView(smoothed);
      viewVoterRef.current.push(det.view);
      if (ts % 120 < 18) setDetectedView(det.view);
      if (autoBusyRef.current) return; // 카운트다운/캡처 중이면 가이드 유지
      const targetLabel = VIEW_STEPS.find((s) => s.key === target)?.label || target;
      if (viewVoterRef.current.isStable(target, { minRatio: 0.7, minFrames: 8 })) {
        setGuide(`${targetLabel} 인식됨 — 측정을 시작합니다.`);
        startAutoCountdown();
      } else {
        const seen = VIEW_STEPS.find((s) => s.key === det.view)?.label || '자세 확인 중';
        setGuide(`${targetLabel}으로 서 주세요. (현재 인식: ${seen})`);
      }
    } else {
      setGuide(`${activeStepLabelRef.current} 자세가 인식되었습니다. 2초간 멈춘 뒤 측정하세요.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeLandmarks]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handlePose, modelTier: 'full' });

  useEffect(() => {
    if (!started) return undefined;
    const timer = setTimeout(() => start(videoRef.current), 80);
    return () => {
      clearTimeout(timer);
      stop();
      if (autoCountdownRef.current) { clearInterval(autoCountdownRef.current); autoCountdownRef.current = null; }
      Object.values(capturesRef.current).forEach((capture) => {
        if (capture?.snapshotUrl) URL.revokeObjectURL(capture.snapshotUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const toggleView = (key) => {
    setSelectedViews((prev) => {
      const enabledCount = Object.values(prev).filter(Boolean).length;
      if (prev[key] && enabledCount <= 1) return prev;
      const next = { ...prev, [key]: !prev[key] };
      if (!next[activeViewKey]) {
        const first = VIEW_STEPS.find((step) => next[step.key]);
        if (first) setActiveViewKey(first.key);
      }
      return next;
    });
  };

  // 실제 캡처 + 다음 면으로 진행. ref 기반이라 수동 버튼/자동 카운트다운 양쪽에서 안전.
  // 반환: true=다음 면 남음, false=마지막 면(리포트 생성됨), null=캡처 실패
  const performCapture = useCallback(() => {
    const live = latestLandmarksRef.current;
    if (!live || !isFullBodyVisible(live)) {
      setGuide('측정 가능한 전신 자세가 아직 안정적으로 인식되지 않았습니다.');
      return null;
    }
    const steps = selectedStepsRef.current;
    const stepKey = activeViewKeyRef.current;
    const step = steps.find((s) => s.key === stepKey) || VIEW_STEPS.find((s) => s.key === stepKey);
    if (!step) return null;
    const idx = Math.max(0, steps.findIndex((s) => s.key === stepKey));

    // 캡처 직전 윈도우의 프레임들을 좌표별 중앙값으로 결합해 순간 떨림을 제거.
    const buffered = frameBufferRef.current.map((f) => f.landmarks);
    const combined =
      buffered.length >= CAPTURE_MIN_FRAMES ? medianLandmarks(buffered) : live;
    const landmarks = combined && isFullBodyVisible(combined) ? combined : live;

    const snapshotUrl = captureVideoSnapshot(latestVideoRef.current);
    const bi = bodyInfoRef.current;
    const analysis = analyzePostureFromLandmarks(landmarks, {
      heightCm: bi.heightCm,
      actualAge: bi.actualAge,
    });
    const prevCaptures = capturesRef.current;
    if (prevCaptures[step.key]?.snapshotUrl) URL.revokeObjectURL(prevCaptures[step.key].snapshotUrl);
    const nextCaptures = {
      ...prevCaptures,
      [step.key]: {
        view: step.key,
        label: step.label,
        landmarks,
        analysis,
        snapshotUrl,
        capturedAt: new Date().toISOString(),
      },
    };
    capturesRef.current = nextCaptures;
    setCaptures(nextCaptures);

    const nextStep = steps[idx + 1];
    if (nextStep) {
      setActiveViewKey(nextStep.key);
      activeViewKeyRef.current = nextStep.key;
      smootherRef.current = createSmoother(0.28);
      latestLandmarksRef.current = null;
      frameBufferRef.current = [];
      viewVoterRef.current.reset();
      setDetectedView('unknown');
      setGuide(`${nextStep.label} 측정으로 이동합니다. 자세를 바꿔주세요.`);
      return true;
    }

    const finalReport = buildReport({
      member,
      bodyInfo: bi,
      captures: nextCaptures,
      selectedSteps: steps,
    });
    setPreviewUrl(finalReport.localPreviewUrl || '');
    setReport(finalReport);
    setSaveState('idle');
    stop();
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, stop]);

  // 수동 측정 버튼
  const handleCapture = () => { performCapture(); };

  // 자동 모드: 목표 면 안정 인식 → 3초 카운트다운(큰 숫자 + 소리) → 캡처 + 성공음 → 다음 면.
  const startAutoCountdown = () => {
    if (autoBusyRef.current) return;
    autoBusyRef.current = true;
    primeAudio();
    let n = 3;
    setAutoCountdown(n);
    beepTick();
    if (autoCountdownRef.current) clearInterval(autoCountdownRef.current);
    autoCountdownRef.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setAutoCountdown(n);
        beepTick();
        return;
      }
      // 0 → 캡처
      clearInterval(autoCountdownRef.current);
      autoCountdownRef.current = null;
      setAutoCountdown(null);
      // 카운트다운 동안 자세가 흐트러졌으면 재시도(측정 정직성: 잘못된 캡처 방지)
      const live = latestLandmarksRef.current;
      const det = live ? detectPostureView(live) : { view: 'unknown' };
      const target = activeViewKeyRef.current;
      if (!live || !isFullBodyVisible(live) || det.view !== target) {
        setGuide('자세가 흐트러졌습니다 — 다시 맞춰주세요.');
        viewVoterRef.current.reset();
        autoBusyRef.current = false;
        return;
      }
      beepGo();
      const more = performCapture();
      beepSuccess();
      // 다음 면이 있으면 잠깐 텀을 두고 자동 진행 재개(자세 변경 시간 확보)
      if (more) {
        setTimeout(() => { autoBusyRef.current = false; }, 1500);
      } else {
        autoBusyRef.current = false;
      }
    }, 1000);
  };

  const handleRetake = () => {
    Object.values(capturesRef.current).forEach((capture) => {
      if (capture?.snapshotUrl) URL.revokeObjectURL(capture.snapshotUrl);
    });
    setCaptures({});
    capturesRef.current = {};
    setPreviewUrl('');
    setReport(null);
    setSaveState('idle');
    smootherRef.current = createSmoother(0.28);
    latestLandmarksRef.current = null;
    frameBufferRef.current = [];
    viewVoterRef.current.reset();
    setDetectedView('unknown');
    setAutoCountdown(null);
    autoBusyRef.current = false;
    if (autoCountdownRef.current) { clearInterval(autoCountdownRef.current); autoCountdownRef.current = null; }
    const first = selectedStepsRef.current[0]?.key || 'front';
    setActiveViewKey(first);
    activeViewKeyRef.current = first;
    setTimeout(() => start(videoRef.current), 80);
  };

  const handleSave = async () => {
    if (!member) {
      alert('저장하려면 먼저 회원을 선택해 주세요.');
      return;
    }
    if (!report) return;
    setSaveState('saving');
    try {
      const { localPreviewUrl, perViewSnapshots, ...savePayload } = report;
      await onSave?.(savePayload);
      setSaveState('saved');
    } catch (event) {
      setSaveState('error');
      alert(`저장에 실패했습니다. ${event?.message || ''}`);
    }
  };

  if (report) {
    const snapFiles = (report.perViewSnapshots || [])
      .filter((s) => s.snapshotUrl)
      .map((s) => {
        try {
          return dataUrlToFile(s.snapshotUrl, `${member?.name || '회원'}_자세_${s.label}.jpg`);
        } catch (e) { return null; }
      })
      .filter(Boolean);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">자세·체형 측정</h2>
          <button onClick={handleRetake} className="measure-back">다시 측정</button>
        </div>

        <div id="posture-report-sheet">
          <PostureReport
            report={report}
            member={member}
            currentLandmarks={report.rawLandmarks}
            currentImageUrl={previewUrl}
            heightCm={bodyInfo.heightCm}
            actualAge={bodyInfo.actualAge}
            perViewSnapshots={report.perViewSnapshots}
          />
        </div>

        <div className="sticky bottom-20 z-30 space-y-2 rounded-2xl border border-slate-800 bg-slate-950/95 p-3">
          {/* 보행/점프와 동일: 리포트 저장(A4 JPG) + 사진 저장(면별 스냅샷) */}
          <ReportActions
            reportNodeId="posture-report-sheet"
            imageFiles={snapFiles}
            imageButtonLabel={`📸 사진 저장 (${snapFiles.length}장)`}
            baseName={`${member?.name || '회원'}_자세`}
            reportButtonLabel="🖼 리포트 저장"
            onMessage={() => {}}
          />
          <button
            onClick={handleSave}
            disabled={saveState === 'saving' || saveState === 'saved'}
            className="btn btn-primary w-full disabled:opacity-60"
          >
            {saveState === 'saving' ? '저장 중...' : saveState === 'saved' ? '✓ 회원 기록에 저장됨' : '💾 회원 기록에 저장'}
          </button>
          {saveState === 'error' && <p className="mt-1 text-center text-xs text-red-400">저장 실패. 다시 시도해 주세요.</p>}
        </div>
      </div>
    );
  }

  // 측정 시작 전: 자동/수동 선택 화면
  const beginMeasure = (mode) => {
    // 자동 모드: 4면 전부 순서대로(front→right→back→left). 수동: 현재 선택된 면 유지.
    const order = ['front', 'right', 'back', 'left'];
    let firstKey = 'front';
    if (mode === 'auto') {
      setSelectedViews({ front: true, right: true, back: true, left: true });
    }
    // 첫 활성 면 = 선택된 면 중 order 순서상 가장 앞
    const enabled = mode === 'auto'
      ? { front: true, right: true, back: true, left: true }
      : selectedViews;
    firstKey = order.find((k) => enabled[k]) || 'front';
    setActiveViewKey(firstKey);
    activeViewKeyRef.current = firstKey;
    captureModeRef.current = mode;
    setCaptureMode(mode);
    viewVoterRef.current.reset();
    setDetectedView('unknown');
    setGuide(mode === 'auto'
      ? '카메라 앞에 서면 면을 자동 인식해 촬영합니다. 먼저 정면으로 서 주세요.'
      : '면을 맞춘 뒤 측정 버튼을 눌러 촬영하세요.');
    primeAudio();
    setStarted(true);
  };

  if (!started) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">자세·체형 측정</h2>
          <span className="w-12" />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-200">촬영 방식을 선택하세요</p>
          <button
            onClick={() => beginMeasure('auto')}
            className="w-full rounded-xl bg-amber-500 px-4 py-4 text-left active:scale-[0.99] transition">
            <p className="text-base font-black text-slate-950">자동 촬영 (권장)</p>
            <p className="mt-0.5 text-xs font-bold text-slate-900/80">
              정면 → 오른쪽 → 후면 → 왼쪽 순서. 면이 인식되면 3초 후 자동 촬영됩니다.
            </p>
          </button>
          <button
            onClick={() => beginMeasure('manual')}
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-4 text-left active:scale-[0.99] transition">
            <p className="text-base font-black text-white">수동 촬영</p>
            <p className="mt-0.5 text-xs font-bold text-slate-400">
              원하는 면만 골라 직접 버튼으로 촬영합니다.
            </p>
          </button>
        </div>

        {/* 수동 모드용 면 선택 (자동은 4면 고정) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-xs font-bold text-slate-400">수동 촬영 시 측정할 면</p>
          <div className="flex flex-wrap gap-2">
            {VIEW_STEPS.map((step) => {
              const selected = !!selectedViews[step.key];
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => toggleView(step.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                    selected
                      ? 'border-amber-400 bg-amber-400 text-slate-950'
                      : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}
                >
                  {selected ? '✓ ' : ''}{step.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            ※ 최소 1개 면은 선택되어야 합니다. 자동 촬영은 4면 모두 진행합니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <CameraStage
      videoRef={videoRef}
      canvasRef={canvasRef}
      status={status}
      error={error}
      onClose={onBack}
      tappable={false}
      showFutureOverlay={false}
      topBar={
        <div className="w-full text-right">
          <p className="text-sm font-black text-white">자세·체형 측정</p>
          <p className="text-[11px] font-bold text-amber-300">
            {member?.name || '회원 미선택'} · {bodyInfo.heightCm ? `${bodyInfo.heightCm}cm` : '키 미입력'} · {bodyInfo.actualAge ? `${bodyInfo.actualAge}세` : '나이 미입력'}
          </p>
          <div className="mt-2 flex flex-wrap justify-end gap-1">
            {VIEW_STEPS.map((step) => {
              const selected = !!selectedViews[step.key];
              const captured = !!captures[step.key];
              const active = activeStep.key === step.key;
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => toggleView(step.key)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${
                    active
                      ? 'border-amber-300 bg-amber-400 text-slate-950'
                      : selected
                      ? 'border-white/25 bg-black/45 text-white'
                      : 'border-white/10 bg-black/20 text-white/35'
                  }`}
                >
                  {captured ? '✓ ' : ''}{step.short}
                </button>
              );
            })}
          </div>
          {!bodyInfo.heightCm && <p className="mt-1 text-[10px] text-red-300">신체정보에서 키를 입력하면 mm 편차 정확도가 올라갑니다.</p>}
        </div>
      }
      controls={
        captureMode === 'auto' ? (
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-amber-300/70 bg-black/55 backdrop-blur">
            {autoCountdown != null ? (
              <span className="font-black text-amber-300 leading-none" style={{ fontSize: '2.6rem' }}>
                {autoCountdown}
              </span>
            ) : (
              <span className="text-[10px] font-black text-white text-center leading-tight whitespace-pre-line">
                {`자동\n${activeStep.short}`}
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={handleCapture}
            disabled={status !== 'running' || !isFullBodyVisible(latestLandmarksRef.current)}
            className="h-20 w-20 rounded-full border-4 border-white bg-amber-500 text-xs font-black text-slate-950 shadow-lg disabled:bg-slate-600 disabled:text-slate-300"
          >
            {activeStep.short}
            <br />
            측정
          </button>
        )
      }
    >
      <>
      <div className="mx-auto max-w-md space-y-2">
        <div className="flex justify-center gap-1">
          {selectedSteps.map((step, index) => (
            <span
              key={step.key}
              className={`h-2 rounded-full transition-all ${
                captures[step.key] ? 'w-6 bg-emerald-400' : index === activeIndex ? 'w-6 bg-amber-400' : 'w-2 bg-white/30'
              }`}
            />
          ))}
        </div>
        {liveAnalysis && (
          <div className="grid grid-cols-3 gap-2">
            <LiveMetric label="점수" value={`${liveAnalysis.score}`} tone={scoreTone(liveAnalysis.score)} />
            <LiveMetric label="체형나이" value={liveAnalysis.bodyAge ? `${liveAnalysis.bodyAge}세` : '--'} tone="amber" />
            <LiveMetric
              label="CoG"
              value={liveAnalysis.cog?.available ? `${Math.abs(liveAnalysis.cog.balanceOffsetPct ?? liveAnalysis.cog.offsetPct)}%` : '--'}
              tone={liveAnalysis.cog?.status === 'risk' ? 'red' : liveAnalysis.cog?.status === 'caution' ? 'amber' : 'emerald'}
            />
          </div>
        )}
        {captureMode === 'auto' && (
          <div className="flex justify-center">
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${
              detectedView === activeStep.key
                ? 'bg-emerald-400 text-slate-950'
                : 'bg-black/55 text-white/80 border border-white/15'
            }`}>
              인식: {VIEW_STEPS.find((s) => s.key === detectedView)?.label || '—'}
              {detectedView === activeStep.key ? ' ✓' : ''}
            </span>
          </div>
        )}
        <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-center text-sm font-bold text-white backdrop-blur">
          <span className="text-amber-300">{activeStep.label}</span> · {guide}
        </div>
      </div>

      {/* 자동 촬영 3초 카운트다운 — 화면 중앙 큰 숫자 */}
      {autoCountdown != null && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <div className="flex h-44 w-44 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm ring-4 ring-amber-300/80 animate-pulse">
            <span className="font-black text-amber-300 leading-none" style={{ fontSize: '7rem' }}>
              {autoCountdown}
            </span>
          </div>
        </div>
      )}
      </>
    </CameraStage>
  );
}

function LiveMetric({ label, value, tone = 'amber' }) {
  const toneClass = {
    emerald: 'text-emerald-300 border-emerald-400/30',
    amber: 'text-amber-300 border-amber-400/30',
    red: 'text-red-300 border-red-400/30',
  }[tone] || 'text-amber-300 border-amber-400/30';
  return (
    <div className={`rounded-xl border bg-black/55 px-2 py-2 text-center backdrop-blur ${toneClass}`}>
      <p className="text-[10px] font-bold text-white/60">{label}</p>
      <p className="mt-0.5 text-base font-black tabular-nums">{value}</p>
    </div>
  );
}

function buildReport({ member, bodyInfo, captures, selectedSteps }) {
  const primaryCapture = captures.front || selectedSteps.map((step) => captures[step.key]).find(Boolean);
  const perView = {};
  selectedSteps.forEach((step) => {
    const capture = captures[step.key];
    if (!capture) return;
    perView[step.key] = {
      label: step.label,
      capturedAt: capture.capturedAt,
      landmarks: capture.landmarks,
      analysis: capture.analysis,
      snapshotUrl: capture.snapshotUrl || '',
    };
  });

  // 화면 표시용 면별 스냅샷(사진+스켈레톤 점검용). snapshotUrl 은 로컬 ObjectURL 이라
  // 저장 페이로드(savePayload)에서는 제외된다(localPreviewUrl 와 동일 처리).
  const perViewSnapshots = selectedSteps
    .map((step) => {
      const capture = captures[step.key];
      if (!capture) return null;
      return { key: step.key, label: step.label, snapshotUrl: capture.snapshotUrl || '', landmarks: capture.landmarks, analysis: capture.analysis };
    })
    .filter(Boolean);

  return {
    kind: 'posture',
    member: member ? { id: member.id, name: member.name } : null,
    memberId: member?.id || null,
    memberName: member?.name || '',
    measurementRound: 1,
    pairKey: member?.id ? `${member.id}_posture` : 'posture_unassigned',
    phase: 'multi_view',
    measuredAt: new Date().toISOString(),
    recordedAt: todayYMD(),
    heightCm: bodyInfo.heightCm,
    actualAge: bodyInfo.actualAge,
    ageGroup: classifyPostureAgeGroup(bodyInfo.actualAge),
    view: primaryCapture?.view || 'front',
    viewsMeasured: selectedSteps.map((step) => step.key),
    imageUrl: '',
    image_urls: { front: '', side_left: '', side_right: '', back: '', current: { front: '', side_left: '', side_right: '', back: '' }, before: {} },
    rawLandmarks: primaryCapture?.landmarks || [],
    viewLandmarks: Object.fromEntries(Object.entries(perView).map(([key, value]) => [key, value.landmarks])),
    perViewAnalysis: Object.fromEntries(Object.entries(perView).map(([key, value]) => [key, value.analysis])),
    perViewSnapshots, // 화면 전용 (저장 시 제외)
    analysis: primaryCapture?.analysis,
    postureScore: primaryCapture?.analysis?.score ?? null,
    bodyAge: primaryCapture?.analysis?.bodyAge ?? null,
    summaryComment: primaryCapture?.analysis?.summaryComment || '',
    comparison: {},
    localPreviewUrl: primaryCapture?.snapshotUrl || '',
  };
}

function drawSkeleton(canvas, video, landmarks) {
  if (!canvas || !video) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  const mapper = objectContainMapper(video, width, height);
  ctx.strokeStyle = 'rgba(52,211,153,0.88)';
  ctx.lineWidth = 2.25;
  ctx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!isVisible(pa) || !isVisible(pb)) return;
    ctx.beginPath();
    ctx.moveTo(mapper.x(pa), mapper.y(pa));
    ctx.lineTo(mapper.x(pb), mapper.y(pb));
    ctx.stroke();
  });

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach((index) => {
    const point = landmarks[index];
    if (!isVisible(point)) return;
    ctx.beginPath();
    ctx.arc(mapper.x(point), mapper.y(point), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function objectContainMapper(video, width, height) {
  const vw = video?.videoWidth || width;
  const vh = video?.videoHeight || height;
  const scale = Math.min(width / vw, height / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const ox = (width - drawW) / 2;
  const oy = (height - drawH) / 2;
  return {
    x: (point) => ox + point.x * drawW,
    y: (point) => oy + point.y * drawH,
  };
}

function captureVideoSnapshot(video) {
  if (!video?.videoWidth || !video?.videoHeight) return '';
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function isFullBodyVisible(landmarks) {
  if (!Array.isArray(landmarks)) return false;
  return [11, 12, 23, 24, 25, 26, 27, 28].every((index) => isVisible(landmarks[index], 0.35));
}

function isVisible(point, threshold = 0.3) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility == null || point.visibility >= threshold);
}

function scoreTone(score) {
  if (score == null) return 'amber';
  if (score >= 80) return 'emerald';
  if (score >= 65) return 'amber';
  return 'red';
}

function getAge(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age > 0 ? age : null;
}
