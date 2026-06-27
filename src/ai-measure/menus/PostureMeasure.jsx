import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayYMD } from '../../utils/dates';
import { usePoseEngine } from '../core/usePoseEngine';
import { createSmoother } from '../core/smoothing';
import { analyzePostureFromLandmarks, classifyPostureAgeGroup } from '../core/postureMath';
import CameraStage from './CameraStage.jsx';
import PostureReport from './PostureReport.jsx';

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

export default function PostureMeasure({ member, onSave, onBack }) {
  const canvasRef = useRef(null);
  const latestLandmarksRef = useRef(null);
  const latestVideoRef = useRef(null);
  const smootherRef = useRef(createSmoother(0.28));

  const [selectedViews, setSelectedViews] = useState(() => ({
    front: true,
    right: true,
    back: true,
    left: true,
  }));
  const [activeViewKey, setActiveViewKey] = useState('front');
  const [captures, setCaptures] = useState({});
  const [liveAnalysis, setLiveAnalysis] = useState(null);
  const [report, setReport] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [guide, setGuide] = useState('정면으로 서서 전신이 화면 안에 들어오게 맞춰주세요.');

  const selectedSteps = useMemo(
    () => VIEW_STEPS.filter((step) => selectedViews[step.key]),
    [selectedViews],
  );
  const activeStep = selectedSteps.find((step) => step.key === activeViewKey) || selectedSteps[0] || VIEW_STEPS[0];
  const activeIndex = Math.max(0, selectedSteps.findIndex((step) => step.key === activeStep.key));

  const bodyInfo = useMemo(() => ({
    heightCm: Number(member?.height || member?.heightCm) || null,
    actualAge: getAge(member?.birthDate) || Number(member?.age) || null,
  }), [member]);

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
      return;
    }
    if (!isFullBodyVisible(smoothed)) {
      setGuide('어깨, 골반, 무릎, 발목이 모두 보이게 화면을 맞춰주세요.');
      return;
    }
    setGuide(`${activeStep.label} 자세가 인식되었습니다. 2초간 멈춘 뒤 측정하세요.`);
    if (ts % 250 < 18) setLiveAnalysis(analyzeLandmarks(smoothed));
  }, [activeStep.label, analyzeLandmarks]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handlePose });

  useEffect(() => {
    const timer = setTimeout(() => start(videoRef.current), 80);
    return () => {
      clearTimeout(timer);
      stop();
      Object.values(captures).forEach((capture) => {
        if (capture?.snapshotUrl) URL.revokeObjectURL(capture.snapshotUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleCapture = () => {
    const landmarks = latestLandmarksRef.current;
    if (!landmarks || !isFullBodyVisible(landmarks)) {
      setGuide('측정 가능한 전신 자세가 아직 안정적으로 인식되지 않았습니다.');
      return;
    }

    const snapshotUrl = captureVideoSnapshot(latestVideoRef.current);
    const nextCaptures = {
      ...captures,
      [activeStep.key]: {
        view: activeStep.key,
        label: activeStep.label,
        landmarks,
        analysis: analyzeLandmarks(landmarks),
        snapshotUrl,
        capturedAt: new Date().toISOString(),
      },
    };
    if (captures[activeStep.key]?.snapshotUrl) URL.revokeObjectURL(captures[activeStep.key].snapshotUrl);
    setCaptures(nextCaptures);

    const nextStep = selectedSteps[activeIndex + 1];
    if (nextStep) {
      setActiveViewKey(nextStep.key);
      smootherRef.current = createSmoother(0.28);
      latestLandmarksRef.current = null;
      setGuide(`${nextStep.label} 측정으로 이동합니다. 자세를 바꿔주세요.`);
      return;
    }

    const finalReport = buildReport({
      member,
      bodyInfo,
      captures: nextCaptures,
      selectedSteps,
    });
    setPreviewUrl(finalReport.localPreviewUrl || '');
    setReport(finalReport);
    setSaveState('idle');
    stop();
  };

  const handleRetake = () => {
    Object.values(captures).forEach((capture) => {
      if (capture?.snapshotUrl) URL.revokeObjectURL(capture.snapshotUrl);
    });
    setCaptures({});
    setPreviewUrl('');
    setReport(null);
    setSaveState('idle');
    smootherRef.current = createSmoother(0.28);
    latestLandmarksRef.current = null;
    setActiveViewKey(selectedSteps[0]?.key || 'front');
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
      const { localPreviewUrl, ...savePayload } = report;
      await onSave?.(savePayload);
      setSaveState('saved');
    } catch (event) {
      setSaveState('error');
      alert(`저장에 실패했습니다. ${event?.message || ''}`);
    }
  };

  if (report) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">자세·체형 측정</h2>
          <button onClick={handleRetake} className="measure-back">다시 측정</button>
        </div>
        <PostureReport
          report={report}
          member={member}
          currentLandmarks={report.rawLandmarks}
          currentImageUrl={previewUrl}
          heightCm={bodyInfo.heightCm}
          actualAge={bodyInfo.actualAge}
        />
        <div className="sticky bottom-20 z-30 rounded-2xl border border-slate-800 bg-slate-950/95 p-3">
          <button
            onClick={handleSave}
            disabled={saveState === 'saving' || saveState === 'saved'}
            className="btn btn-primary w-full disabled:opacity-60"
          >
            {saveState === 'saving' ? '저장 중...' : saveState === 'saved' ? '저장 완료' : '회원 기록에 저장'}
          </button>
          {saveState === 'error' && <p className="mt-2 text-center text-xs text-red-400">저장 실패. 다시 시도해 주세요.</p>}
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
        <button
          onClick={handleCapture}
          disabled={status !== 'running' || !isFullBodyVisible(latestLandmarksRef.current)}
          className="h-20 w-20 rounded-full border-4 border-white bg-amber-500 text-xs font-black text-slate-950 shadow-lg disabled:bg-slate-600 disabled:text-slate-300"
        >
          {activeStep.short}
          <br />
          측정
        </button>
      }
    >
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
        <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-center text-sm font-bold text-white backdrop-blur">
          <span className="text-amber-300">{activeStep.label}</span> · {guide}
        </div>
      </div>
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
    };
  });

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
