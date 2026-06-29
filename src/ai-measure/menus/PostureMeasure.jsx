import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayYMD } from '../../utils/dates';
import { usePoseEngine } from '../core/usePoseEngine';
import { createSmoother } from '../core/smoothing';
import { analyzePostureFromLandmarks, classifyPostureAgeGroup, medianLandmarks, detectPostureView, PostureViewVoter, sanitizeBackLandmarks } from '../core/postureMath';
import { beepTick, beepGo, beepSuccess, primeAudio } from '../core/audioCue';
import CameraStage from './CameraStage.jsx';
import PostureReport from './PostureReport.jsx';
import ReportActions from '../../components/report/ReportActions';
import { dataUrlToFile } from '../core/reportShare';

const VIEW_STEPS = [
  { key: 'front', label: '정면', short: '앞' },
  { key: 'left', label: '좌측면', short: '왼쪽' },
  { key: 'back', label: '후면', short: '뒤' },
  { key: 'right', label: '우측면', short: '오른쪽' },
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
  const [report, setReport] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [actionMsg, setActionMsg] = useState('');
  const [guide, setGuide] = useState('정면으로 서서 전신이 화면 안에 들어오게 맞춰주세요.');
  // 수동 면 고정(view lock): 켜면 자동 면 판정을 신뢰하지 않고, 사용자가 선택한
  // 면을 그대로 사용해 '전신이 보이고 + 잠시 멈추면' 촬영한다(측면 미인식 우회).
  const [lockView, setLockView] = useState(false);
  const lockViewRef = useRef(false);
  useEffect(() => { lockViewRef.current = lockView; }, [lockView]);
  const holdStartRef = useRef(0); // 면 고정 시 '멈춤 유지' 시작 시각

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

  const handlePose = useCallback((landmarks, ts, video) => {
    latestVideoRef.current = video || latestVideoRef.current;
    const smoothed = landmarks ? smootherRef.current(landmarks) : smootherRef.current(null);
    latestLandmarksRef.current = smoothed || latestLandmarksRef.current;
    drawSkeleton(canvasRef.current, video, smoothed, activeViewKeyRef.current);

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
      holdStartRef.current = 0; // 면 고정 hold 타이머 리셋
      return;
    }
    // 안정적으로 전신이 잡힌 프레임만 시간순 버퍼에 누적(슬라이딩 윈도우).
    const buf = frameBufferRef.current;
    buf.push({ landmarks: smoothed, ts });
    const cutoff = ts - CAPTURE_WINDOW_MS;
    while (buf.length && buf[0].ts < cutoff) buf.shift();
    // (측정 중 점수/CoG 패널 제거 → 매 프레임 분석 계산 중단. 결과는 촬영 시 1회 산출)

    // ── 자동 촬영 모드: 목표 면 인식 → 안정되면 카운트다운 트리거 ──
    if (captureModeRef.current === 'auto') {
      const target = activeViewKeyRef.current;
      const det = detectPostureView(smoothed);
      viewVoterRef.current.push(det.view);
      if (ts % 120 < 18) setDetectedView(det.view);
      if (autoBusyRef.current) return; // 카운트다운/캡처 중이면 가이드 유지
      const targetLabel = VIEW_STEPS.find((s) => s.key === target)?.label || target;

      // ▸ 수동 면 고정(view lock): 자동 판정을 신뢰하지 않고, 선택한 면으로 강제 진행.
      //   전신이 보이는 상태로 0.8초 멈춰 있으면 촬영(흔들림 방지용 hold-still만 검사).
      if (lockViewRef.current) {
        if (!holdStartRef.current) holdStartRef.current = ts;
        const heldMs = ts - holdStartRef.current;
        const HOLD_MS = 800;
        if (heldMs >= HOLD_MS) {
          setGuide(`${targetLabel} (면 고정) — 측정을 시작합니다.`);
          holdStartRef.current = 0;
          startAutoCountdown();
        } else {
          setGuide(`${targetLabel} 면 고정 — 자세를 유지하세요 (${Math.ceil((HOLD_MS - heldMs) / 100) / 10}s)`);
        }
        return;
      }

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const rawLandmarks = combined && isFullBodyVisible(combined) ? combined : live;
    // 후면 측정: 코·눈은 추정값이라 제거하고 분석/저장 (귀만 유지)
    const landmarks = step.key === 'back' ? sanitizeBackLandmarks(rawLandmarks) : rawLandmarks;

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

  // 자동 모드에서 면 인식이 안 될 때 사용하는 '강제 촬영' 버튼.
  // 자동 카운트다운/인식 판정을 건너뛰고 현재 활성 면으로 즉시 촬영한다.
  // 측정 정직성: 전신이 안정적으로 보이지 않으면 촬영을 거부하고 안내한다.
  const handleForceCapture = () => {
    if (autoCountdown != null) return; // 카운트다운 진행 중에는 무시
    // 진행 중이던 자동 카운트다운/타이머 정리
    if (autoCountdownRef.current) { clearInterval(autoCountdownRef.current); autoCountdownRef.current = null; }
    setAutoCountdown(null);
    autoBusyRef.current = false;
    holdStartRef.current = 0;
    const live = latestLandmarksRef.current;
    if (!live || !isFullBodyVisible(live)) {
      setGuide('전신(어깨·골반·무릎·발목)이 모두 보여야 강제 촬영할 수 있습니다.');
      return;
    }
    primeAudio();
    beepGo();
    const more = performCapture();
    if (more !== null) beepSuccess();
    // 다음 면이 있으면 자동 진행이 곧바로 재트리거되지 않도록 잠깐 텀을 둔다.
    if (more) {
      autoBusyRef.current = true;
      setTimeout(() => { autoBusyRef.current = false; }, 1500);
    }
  };

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
      // 단일 프레임 대신 '안정 다수결(voter)'로 판정 — 측면 임계 구간에서 한 프레임만
      // 튀어도 촬영이 거부되던 문제 방지.
      const live = latestLandmarksRef.current;
      const target = activeViewKeyRef.current;
      // 면 고정 시에는 자동 면 판정을 검사하지 않고, 전신이 보이는지만 확인.
      const stillStable = lockViewRef.current
        ? true
        : viewVoterRef.current.isStable(target, { minRatio: 0.6, minFrames: 6 });
      if (!live || !isFullBodyVisible(live) || !stillStable) {
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
      setActionMsg('회원이 선택되지 않아 기록 저장은 건너뜁니다.');
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

        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/95 p-3">
          {/* '리포트 저장'을 누르면 A4 JPG 저장 + 회원 기록 자동 저장 (탭 불필요) */}
          <ReportActions
            reportNodeId="posture-report-sheet"
            imageFiles={snapFiles}
            imageButtonLabel={`📸 사진 저장 (${snapFiles.length}장)`}
            baseName={`${member?.name || '회원'}_자세`}
            reportButtonLabel={saveState === 'saved' ? '✓ 리포트 저장됨' : '🖼 리포트 저장'}
            onAfterReportSave={handleSave}
            onMessage={setActionMsg}
          />
          {actionMsg && <p className="text-center text-xs text-slate-400">{actionMsg}</p>}
          {saveState === 'saved' && (
            <p className="text-center text-xs font-bold text-emerald-400">회원 기록에 저장되었습니다.</p>
          )}
          {saveState === 'error' && (
            <p className="text-center text-xs text-red-400">회원 기록 저장 실패. ‘리포트 저장’을 다시 눌러 주세요.</p>
          )}
        </div>
      </div>
    );
  }

  // 측정 시작 전: 자동/수동 선택 화면
  const beginMeasure = (mode) => {
    // 자동 모드: 4면 전부 순서대로(front→left→back→right). 수동: 현재 선택된 면 유지.
    const order = ['front', 'left', 'back', 'right'];
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
          // 자동 인식이 안 될 때를 대비한 '강제 촬영' 버튼.
          // 카운트다운 중이 아니고 전신이 보이면, 누르는 즉시 현재 면을 강제로 촬영한다.
          <button
            type="button"
            onClick={handleForceCapture}
            disabled={autoCountdown != null}
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-amber-300/70 bg-black/55 backdrop-blur active:scale-95 transition disabled:opacity-60"
          >
            {autoCountdown != null ? (
              <span className="font-black text-amber-300 leading-none" style={{ fontSize: '2.6rem' }}>
                {autoCountdown}
              </span>
            ) : (
              <span className="text-[10px] font-black text-white text-center leading-tight whitespace-pre-line">
                {`강제촬영\n${activeStep.short}`}
              </span>
            )}
          </button>
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
        {/* 측정 중에는 점수·체형나이·CoG 를 노출하지 않는다(촬영 후 결과·리포트에서만 확인). */}
        {captureMode === 'auto' && (
          <div className="flex flex-col items-center gap-1.5">
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${
              lockView
                ? 'bg-amber-400 text-slate-950'
                : detectedView === activeStep.key
                  ? 'bg-emerald-400 text-slate-950'
                  : 'bg-black/55 text-white/80 border border-white/15'
            }`}>
              {lockView
                ? `면 고정: ${activeStep.label}`
                : `인식: ${VIEW_STEPS.find((s) => s.key === detectedView)?.label || '—'}${detectedView === activeStep.key ? ' ✓' : ''}`}
            </span>
            <button
              type="button"
              onClick={() => { setLockView((v) => !v); holdStartRef.current = 0; viewVoterRef.current.reset(); }}
              className={`rounded-full px-3 py-1 text-[11px] font-bold border transition-colors ${
                lockView
                  ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                  : 'bg-black/40 border-white/20 text-white/70 hover:border-amber-400/50'
              }`}>
              {lockView ? '✓ 선택한 면으로 강제 촬영 중 (해제)' : '인식이 안 되면 → 선택한 면으로 강제 촬영'}
            </button>
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
    sex: member?.sex || member?.gender || null,
    birthDate: member?.birthDate || null,
    isVirtualMember: member?.isVirtual === true,
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

function drawSkeleton(canvas, video, landmarks, viewKey) {
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

  // ── 정면/후면: 양 발목 중점 수직 중심선 ──
  if (viewKey === 'front' || viewKey === 'back') {
    drawAnkleMidCenterLine(ctx, landmarks, mapper);
    drawFrontalImbalanceMarkers(ctx, landmarks, mapper);
  }
  // ── 정면: 눈·코·귀 위치 + 머리 기울기(roll)/회전(yaw) ──
  if (viewKey === 'front') {
    drawFrontHeadAlignment(ctx, landmarks, mapper);
  }
  // ── 후면: 귀만 사용(코·눈은 추정값이라 제거), 양 귀로 머리 기울기 ──
  if (viewKey === 'back') {
    drawBackHeadAlignment(ctx, landmarks, mapper);
  }

  // ── 측면(좌/우) 전용: 관절 정렬 기준선 + 거북목 기울기선 + 발목 중심선 ──
  if (viewKey === 'left' || viewKey === 'right') {
    drawSideReferenceLines(ctx, landmarks, mapper, viewKey);
  }
}

// 정면/후면 좌우 불균형 마커(라이브): 어깨·골반 높이차 원, 무릎 외반/내반 화살표.
// 측정 중에는 mm 환산 분석을 돌리지 않으므로(측정 정직성: 결과는 촬영 시 1회),
// 화면 좌표(normalized y) 차이로만 임계 판정해 가벼운 시각 피드백을 준다.
function drawFrontalImbalanceMarkers(ctx, lm, mapper) {
  const drawArrowL = (fromX, fromY, toX, toY, color) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY); ctx.stroke();
    const ang = Math.atan2(toY - fromY, toX - fromX); const head = 10;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - head * Math.cos(ang - Math.PI / 6), toY - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(toX - head * Math.cos(ang + Math.PI / 6), toY - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  const ring = (cx, cy, rad, color) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };
  const lab = (text, x, y, color) => {
    ctx.save();
    ctx.font = 'bold 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 4, y - 14, w + 8, 18);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.restore();
  };
  const ORANGE = 'rgba(251,146,60,0.95)';
  const RED = 'rgba(248,113,113,0.95)';

  // 어깨 높이차: normalized y 차이 0.012 이상이면 강조
  const lSh = lm[11]; const rSh = lm[12];
  if (isVisible(lSh) && isVisible(rSh)) {
    const dy = Math.abs(lSh.y - rSh.y);
    if (dy >= 0.012) {
      const higher = lSh.y <= rSh.y ? lSh : rSh;
      const hx = mapper.x(higher); const hy = mapper.y(higher);
      ring(hx, hy, 16, ORANGE);
      lab('어깨 높이차', hx + 18, hy - 6, ORANGE);
    }
  }
  // 골반 높이차
  const lHip = lm[23]; const rHip = lm[24];
  if (isVisible(lHip) && isVisible(rHip)) {
    const dy = Math.abs(lHip.y - rHip.y);
    if (dy >= 0.012) {
      const higher = lHip.y <= rHip.y ? lHip : rHip;
      const hx = mapper.x(higher); const hy = mapper.y(higher);
      ring(hx, hy, 16, ORANGE);
      lab('골반 높이차', hx + 18, hy + 4, ORANGE);
    }
  }
  // 무릎 외반(X)/내반(O): 무릎 간격 대비 발목 간격으로 추정
  const lKnee = lm[25]; const rKnee = lm[26];
  const la = lm[27]; const ra = lm[28];
  if (isVisible(lKnee) && isVisible(rKnee) && isVisible(la) && isVisible(ra)) {
    const kneeGap = Math.abs(lKnee.x - rKnee.x);
    const ankleGap = Math.abs(la.x - ra.x) || 1e-6;
    const ratio = kneeGap / ankleGap;
    const LK = { x: mapper.x(lKnee), y: mapper.y(lKnee) };
    const RK = { x: mapper.x(rKnee), y: mapper.y(rKnee) };
    const midY = (LK.y + RK.y) / 2;
    if (ratio < 0.55) {
      // 무릎이 안쪽으로 모임 → 외반(X자)
      drawArrowL(LK.x - 26, midY, LK.x, midY, RED);
      drawArrowL(RK.x + 26, midY, RK.x, midY, RED);
      lab('무릎 외반(X)', Math.min(LK.x, RK.x) - 26, midY - 8, RED);
    } else if (ratio > 1.5) {
      // 무릎이 바깥으로 벌어짐 → 내반(O자)
      drawArrowL(LK.x, midY, LK.x - 26, midY, RED);
      drawArrowL(RK.x, midY, RK.x + 26, midY, RED);
      lab('무릎 내반(O)', Math.min(LK.x, RK.x) - 26, midY - 8, RED);
    }
  }
}

// 정면/후면 중심선: 양 발목 중점을 지나는 수직선.
function drawAnkleMidCenterLine(ctx, lm, mapper) {
  const la = lm[27]; const ra = lm[28];
  if (!isVisible(la) || !isVisible(ra)) return;
  const cx = (mapper.x(la) + mapper.x(ra)) / 2;
  const topY = mapper.y(lm[0] || lm[11]) - 20; // 머리 위쪽
  const botY = Math.max(mapper.y(la), mapper.y(ra)) + 14;
  ctx.save();
  ctx.strokeStyle = 'rgba(125,211,252,0.85)'; // sky
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx, botY);
  ctx.stroke();
  // 발목 중점 마커
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(125,211,252,1)';
  ctx.beginPath();
  ctx.arc(cx, (mapper.y(la) + mapper.y(ra)) / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 정면 머리 정렬: 눈·코·귀 점 + 머리 좌우 기울기(roll) + 머리 회전(yaw).
function drawFrontHeadAlignment(ctx, lm, mapper) {
  const nose = lm[0];
  const lEye = lm[2]; const rEye = lm[5];
  const lEar = lm[7]; const rEar = lm[8];
  // 얼굴 점
  ctx.save();
  ctx.fillStyle = 'rgba(52,211,153,0.95)';
  [nose, lEye, rEye, lEar, rEar].forEach((p) => {
    if (!isVisible(p)) return;
    ctx.beginPath();
    ctx.arc(mapper.x(p), mapper.y(p), 3, 0, Math.PI * 2);
    ctx.fill();
  });
  // 머리 기울기(roll): 양 눈(없으면 양 귀) 연결선의 수평 대비 각도
  const pairA = (isVisible(lEye) && isVisible(rEye)) ? [lEye, rEye] : (isVisible(lEar) && isVisible(rEar) ? [lEar, rEar] : null);
  if (pairA) {
    const [l, r] = pairA;
    const lx = mapper.x(l); const ly = mapper.y(l);
    const rx = mapper.x(r); const ry = mapper.y(r);
    ctx.strokeStyle = 'rgba(250,204,21,0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
    const rollDeg = Math.round(Math.atan2(ry - ly, rx - lx) * 180 / Math.PI);
    ctx.fillStyle = 'rgba(250,204,21,1)';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(`머리 기울기 ${Math.abs(rollDeg)}°`, Math.min(lx, rx), Math.min(ly, ry) - 8);
  }
  // 머리 회전(yaw): 코가 양 눈/귀 중심에서 좌우로 치우친 정도
  if (isVisible(nose) && pairA) {
    const [l, r] = pairA;
    const midX = (mapper.x(l) + mapper.x(r)) / 2;
    const span = Math.abs(mapper.x(r) - mapper.x(l)) || 1;
    const yawRatio = (mapper.x(nose) - midX) / (span / 2); // -1~1
    const yawPct = Math.round(Math.abs(yawRatio) * 100);
    ctx.strokeStyle = 'rgba(248,113,113,0.8)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(midX, mapper.y(nose));
    ctx.lineTo(mapper.x(nose), mapper.y(nose));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(248,113,113,1)';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(`머리 회전 ${yawPct}%`, mapper.x(nose) + 6, mapper.y(nose) + 4);
  }
  ctx.restore();
}

// 후면 머리 정렬: 귀만 사용(코·눈은 추정이라 제거). 양 귀로 머리 기울기만 표시.
function drawBackHeadAlignment(ctx, lm, mapper) {
  const lEar = lm[7]; const rEar = lm[8];
  if (!isVisible(lEar) || !isVisible(rEar)) return;
  ctx.save();
  // 귀 점만
  ctx.fillStyle = 'rgba(52,211,153,0.95)';
  [lEar, rEar].forEach((p) => {
    ctx.beginPath();
    ctx.arc(mapper.x(p), mapper.y(p), 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
  // 머리 기울기(양 귀 연결선)
  const lx = mapper.x(lEar); const ly = mapper.y(lEar);
  const rx = mapper.x(rEar); const ry = mapper.y(rEar);
  ctx.strokeStyle = 'rgba(250,204,21,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
  const rollDeg = Math.round(Math.atan2(ry - ly, rx - lx) * 180 / Math.PI);
  ctx.fillStyle = 'rgba(250,204,21,1)';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(`머리 기울기 ${Math.abs(rollDeg)}°`, Math.min(lx, rx), Math.min(ly, ry) - 8);
  ctx.restore();
}

// 측면 기준선: 카메라를 향한(앞쪽) 어깨·고관절·무릎·발목을 한 줄로 잇는
// 정렬 기준선과, 발목에서 올린 수직 기준선(plumb line), 귀-어깨 거북목 각도선.
function drawSideReferenceLines(ctx, lm, mapper, viewKey) {
  // 측면에서는 카메라에 가까운 쪽 관절을 사용. BlazePose z 가 더 작은(가까운) 쪽.
  const pick = (leftIdx, rightIdx) => {
    const L = lm[leftIdx]; const R = lm[rightIdx];
    if (isVisible(L) && isVisible(R)) {
      return ((L.z ?? 0) <= (R.z ?? 0)) ? L : R;
    }
    return isVisible(L) ? L : (isVisible(R) ? R : null);
  };
  const ear = pick(7, 8);          // 귓구멍
  const shoulder = pick(11, 12);   // 어깨관절
  const hip = pick(23, 24);        // 고관절
  const knee = pick(25, 26);       // 무릎관절
  const ankle = pick(27, 28);      // 발목관절

  const chain = [shoulder, hip, knee, ankle].filter(isVisible);
  if (chain.length >= 2) {
    // 정렬 기준선 (어깨→고관절→무릎→발목)
    ctx.save();
    ctx.strokeStyle = 'rgba(250,204,21,0.95)'; // amber
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(mapper.x(chain[0]), mapper.y(chain[0]));
    chain.slice(1).forEach((p) => ctx.lineTo(mapper.x(p), mapper.y(p)));
    ctx.stroke();
    ctx.restore();

    // 발목(외측 복사뼈) 기준 수직 중심선
    if (isVisible(ankle)) {
      ctx.save();
      ctx.strokeStyle = 'rgba(125,211,252,0.85)'; // sky
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 6]);
      const ax = mapper.x(ankle);
      const topY = mapper.y(ear || shoulder || chain[0]) - 24;
      const botY = mapper.y(ankle) + 12;
      ctx.beginPath();
      ctx.moveTo(ax, topY);
      ctx.lineTo(ax, botY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(125,211,252,1)';
      ctx.beginPath();
      ctx.arc(ax, mapper.y(ankle), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('발목 중심선', ax + 6, botY - 2);
      ctx.restore();
    }

    // 관절 강조 포인트
    ctx.save();
    ctx.fillStyle = 'rgba(250,204,21,1)';
    [shoulder, hip, knee, ankle].forEach((p) => {
      if (!isVisible(p)) return;
      ctx.beginPath();
      ctx.arc(mapper.x(p), mapper.y(p), 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // 귀-어깨 거북목 기울기선 + 각도 라벨
  if (isVisible(ear) && isVisible(shoulder)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(248,113,113,0.95)'; // red
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    const ex = mapper.x(ear); const ey = mapper.y(ear);
    const sx = mapper.x(shoulder); const sy = mapper.y(shoulder);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // 수직선 대비 전방 기울기 각도(0=수직, 클수록 거북목)
    const dx = ex - sx; const dy = sy - ey; // 위로 갈수록 dy>0
    const tiltDeg = Math.round(Math.abs(Math.atan2(dx, Math.max(1, dy)) * 180 / Math.PI));
    ctx.fillStyle = 'rgba(248,113,113,1)';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`목 기울기 ${tiltDeg}°`, ex + 8, ey - 6);
    // 어깨 기준 수직 참조선
    ctx.strokeStyle = 'rgba(248,113,113,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - Math.abs(sy - ey) - 10);
    ctx.stroke();
    ctx.restore();
  }
}

// 후면 코·눈 정제는 postureMath.sanitizeBackLandmarks 사용.

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
