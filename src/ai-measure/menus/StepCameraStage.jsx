// ai-measure/menus/StepCameraStage.jsx
// ════════════════════════════════════════════════════════════════════════
//  [스텝테스트 카메라 2026-11-25] 필드 스텝테스트 중 카메라로 사이클 카운트 + 스켈레톤 + 인식률 + 영상 녹화.
//  CardioTestMeasure 가 측정이 시작(running)되면 active=true 로 띄우고, 회복(recovery)·결과로 가면 active=false.
//  · 카운트·인식률은 summaryRef 에 계속 써 둔다(저장 시점에 동기로 읽는다). 영상 Blob 은 끝난 뒤 blobRef 에 채워진다.
//  · 영상 HUD: 종목·초시계(남은 시간)·사이클 수·메트로놈 박자(실제 박자)·인식률. 폰 저장은 결과 화면 버튼(saveVideoToPhone).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { useCameraRotation } from '../core/useCameraRotation';
import { ARM_BONES, ARM_DOTS, LEG_BONES, LEG_DOTS, drawPoseSkeleton } from '../core/drawPoseSkeleton';
import { createStepCycleCounter } from '../core/stepCycleCounter';
import { createRecognitionTracker, frameKeyVisibility } from '../core/recognitionStats';
import { createMeasureRecorder } from '../core/measureRecorder';
import { rotateLandmarksNormalized } from '../core/recordAspect';
import CameraStage from './CameraStage.jsx';

export default function StepCameraStage({ active, startPerf, durationSec = 180, bpm = null, expectedPerMin = null, beatRef, summaryRef, blobRef, onBlob, onClose }) {
  const canvasRef = useRef(null);
  const counterRef = useRef(createStepCycleCounter());
  const recogRef = useRef(createRecognitionTracker());
  const recorderRef = useRef(null);
  const latestLm = useRef(null);
  const trackedRef = useRef(false);
  const [snap, setSnap] = useState(null);
  const [rotationDeg] = useCameraRotation();
  const rotRef = useRef(rotationDeg); rotRef.current = rotationDeg;
  const activeRef = useRef(active); activeRef.current = active;
  const hudRef = useRef(() => ({}));
  hudRef.current = () => {
    const ms = performance.now() - startPerf;
    return {
      title: '스텝테스트', remainMs: Math.max(0, durationSec * 1000 - ms), count: counterRef.current.snapshot().count, unit: '회',
      bpm, beat: beatRef ? performance.now() - (beatRef.current?.at || 0) < 130 : false, recognition: recogRef.current.snapshot(),
      note: expectedPerMin ? `기준 ${expectedPerMin}회/분` : '',
    };
  };

  const handlePose = useCallback((landmarks, ts, video) => {
    if (!activeRef.current) return;
    latestLm.current = landmarks || null;
    recogRef.current.record(landmarks || null);
    const lm = landmarks ? rotateLandmarksNormalized(landmarks, rotRef.current) : null;
    const s = counterRef.current.push(lm, performance.now());
    const vis = landmarks ? frameKeyVisibility(landmarks) : null;
    trackedRef.current = s.tracked && vis != null && vis >= 0.5;
    drawPoseSkeleton(canvasRef.current, video || null, landmarks, trackedRef.current, { bones: [...LEG_BONES, ...ARM_BONES], dots: [...LEG_DOTS, ...ARM_DOTS] });
    if (summaryRef) summaryRef.current = { cycles: s.count, events: s.events, recognition: recogRef.current.snapshot(), expectedPerMin };
    setSnap(s);
  }, [summaryRef, expectedPerMin]);
  const pose = usePoseEngine({ onResult: handlePose });

  useEffect(() => {
    if (!active) return undefined;
    counterRef.current.reset(); recogRef.current.reset();
    pose.start();
    const rec = createMeasureRecorder({
      getVideo: () => pose.videoRef.current, getLandmarks: () => latestLm.current, getRotation: () => rotRef.current,
      getHud: () => hudRef.current(), getTracked: () => trackedRef.current, bones: [...LEG_BONES, ...ARM_BONES], dots: [...LEG_DOTS, ...ARM_DOTS],
    });
    if (rec.start()) recorderRef.current = rec;
    return () => {
      pose.stop();
      const r = recorderRef.current; recorderRef.current = null;
      if (summaryRef) summaryRef.current = { cycles: counterRef.current.snapshot().count, events: counterRef.current.snapshot().events, recognition: recogRef.current.snapshot(), expectedPerMin };
      if (r) r.stop().then((blob) => { if (blobRef) blobRef.current = blob; onBlob?.(blob); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;
  const r = recogRef.current.snapshot();
  const recogText = r && r.frames ? `인식률 ${Math.round(r.ratio * 100)}%` : '인식률 --';
  const left = Math.max(0, durationSec - (performance.now() - startPerf) / 1000);
  return (
    <CameraStage
      videoRef={pose.videoRef} canvasRef={canvasRef} status={pose.status} error={pose.error}
      onClose={onClose} tappable={false} showSkeletonToggle
      recording recordingLabel={`${Math.ceil(left)}초 · ${snap?.count ?? 0}사이클 · ${recogText}`}
      topBar={(
        <>
          <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white">스텝테스트 · 카메라 카운트</span>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${snap?.tracked ? 'bg-emerald-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`} data-testid="step-track-status">
            {snap?.tracked ? '✓ 인식됨' : '⚠ 몸이 안 잡혀요 — 옆모습 전신이 보이게 세워 주세요'}
          </span>
          <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-emerald-300" data-testid="step-recog">{recogText}</span>
        </>
      )}
      controls={<button type="button" onClick={onClose} className="h-12 rounded-full bg-slate-200 px-5 text-sm font-black text-slate-800 active:scale-95">카메라 끄기(녹화 종료, 측정은 계속)</button>}
    />
  );
}
