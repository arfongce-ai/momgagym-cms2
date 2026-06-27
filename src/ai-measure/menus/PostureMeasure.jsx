import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayYMD } from '../../utils/dates';
import { usePoseEngine } from '../core/usePoseEngine';
import { analyzePostureFromLandmarks } from '../core/postureMath';
import CameraStage from './CameraStage.jsx';
import PostureReport from './PostureReport.jsx';

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
  const [liveAnalysis, setLiveAnalysis] = useState(null);
  const [report, setReport] = useState(null);
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [guide, setGuide] = useState('정면으로 서서 전신이 화면 안에 들어오게 맞춰주세요.');

  const bodyInfo = useMemo(() => ({
    heightCm: Number(member?.height || member?.heightCm) || null,
    actualAge: getAge(member?.birthDate) || Number(member?.age) || null,
  }), [member]);

  const analyzeLandmarks = useCallback((landmarks) => {
    if (!landmarks) return null;
    return analyzePostureFromLandmarks(landmarks, {
      heightCm: bodyInfo.heightCm,
      actualAge: bodyInfo.actualAge,
    });
  }, [bodyInfo.actualAge, bodyInfo.heightCm]);

  const handlePose = useCallback((landmarks, ts, video) => {
    latestVideoRef.current = video || latestVideoRef.current;
    latestLandmarksRef.current = landmarks || latestLandmarksRef.current;
    drawSkeleton(canvasRef.current, video, landmarks);
    if (!landmarks) {
      setGuide('전신이 보이도록 한 걸음 뒤로 이동해 주세요.');
      return;
    }
    if (!isFullBodyVisible(landmarks)) {
      setGuide('어깨, 골반, 무릎, 발목이 모두 보이게 화면을 맞춰주세요.');
      return;
    }
    setGuide('자세가 인식되었습니다. 정면으로 2초간 멈춘 뒤 측정하세요.');
    if (ts % 250 < 18) {
      setLiveAnalysis(analyzeLandmarks(landmarks));
    }
  }, [analyzeLandmarks]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handlePose });

  useEffect(() => {
    const timer = setTimeout(() => start(videoRef.current), 80);
    return () => {
      clearTimeout(timer);
      stop();
      if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = () => {
    const landmarks = latestLandmarksRef.current;
    if (!landmarks || !isFullBodyVisible(landmarks)) {
      setGuide('측정할 수 있는 전신 포즈가 아직 안정적으로 인식되지 않았습니다.');
      return;
    }
    const analysis = analyzeLandmarks(landmarks);
    const imageUrl = captureVideoSnapshot(latestVideoRef.current);
    if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
    setSnapshotUrl(imageUrl);
    setReport(buildReport({
      member,
      bodyInfo,
      landmarks,
      analysis,
      imageUrl,
    }));
    setSaveState('idle');
    stop();
  };

  const handleRetake = () => {
    if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
    setSnapshotUrl('');
    setReport(null);
    setSaveState('idle');
    latestLandmarksRef.current = null;
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
      await onSave?.(report);
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
          currentImageUrl={snapshotUrl}
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
      overlay={{
        mode: 'POSTURE AI',
        primary: liveAnalysis ? `${liveAnalysis.score}점` : 'POSTURE READY',
        secondary: liveAnalysis?.bodyAge ? `체형 나이 ${liveAnalysis.bodyAge}세` : 'Body alignment scan',
        gauges: [
          { label: 'SCORE', value: liveAnalysis?.score ?? '--', percent: liveAnalysis?.score ?? 0, tone: scoreTone(liveAnalysis?.score) },
          { label: 'CoG', value: liveAnalysis?.cog?.available ? `${Math.abs(liveAnalysis.cog.balanceOffsetPct ?? liveAnalysis.cog.offsetPct)}%` : '--', percent: Math.min(100, Math.abs(liveAnalysis?.cog?.balanceOffsetPct ?? liveAnalysis?.cog?.offsetPct ?? 0) * 2), tone: 'emerald' },
        ],
        ringLabel: liveAnalysis?.score ?? 'AI',
      }}
      topBar={
        <div className="text-right">
          <p className="text-sm font-black text-white">자세·체형 측정</p>
          <p className="text-[11px] font-bold text-amber-300">
            {member?.name || '회원 미선택'} · {bodyInfo.heightCm ? `${bodyInfo.heightCm}cm` : '키 미입력'} · {bodyInfo.actualAge ? `${bodyInfo.actualAge}세` : '나이 미입력'}
          </p>
          {!bodyInfo.heightCm && <p className="text-[10px] text-red-300">신체정보에서 키를 입력하면 mm 편차 정확도가 올라갑니다.</p>}
        </div>
      }
      controls={
        <button
          onClick={handleCapture}
          disabled={status !== 'running' || !isFullBodyVisible(latestLandmarksRef.current)}
          className="h-20 w-20 rounded-full border-4 border-white bg-amber-500 text-xs font-black text-slate-950 shadow-lg disabled:bg-slate-600 disabled:text-slate-300"
        >
          측정
        </button>
      }
    >
      <div className="mx-auto max-w-md space-y-2">
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
          {guide}
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

function buildReport({ member, bodyInfo, landmarks, analysis, imageUrl }) {
  return {
    kind: 'posture',
    member: member ? { id: member.id, name: member.name } : null,
    memberId: member?.id || null,
    memberName: member?.name || '',
    measurementRound: 1,
    pairKey: member?.id ? `${member.id}_posture` : 'posture_unassigned',
    phase: 'single',
    measuredAt: new Date().toISOString(),
    recordedAt: todayYMD(),
    heightCm: bodyInfo.heightCm,
    actualAge: bodyInfo.actualAge,
    view: 'front',
    imageUrl: '',
    image_urls: { front: '', side_left: '', side_right: '', back: '', current: { front: '', side_left: '', side_right: '', back: '' }, before: {} },
    rawLandmarks: landmarks,
    analysis,
    postureScore: analysis.score,
    bodyAge: analysis.bodyAge,
    summaryComment: analysis.summaryComment,
    comparison: {},
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
  ctx.strokeStyle = 'rgba(52,211,153,0.95)';
  ctx.lineWidth = 3;
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

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach((index) => {
    const point = landmarks[index];
    if (!isVisible(point)) return;
    ctx.beginPath();
    ctx.arc(mapper.x(point), mapper.y(point), 5, 0, Math.PI * 2);
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
