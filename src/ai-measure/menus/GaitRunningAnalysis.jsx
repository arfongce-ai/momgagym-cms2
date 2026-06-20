import React, { useState, useEffect, useRef } from 'react';
import {
  GaitCycleTracker, jointAnglesFromPose, AngleAccumulator,
  pelvisRelativeFeet, cameraAngleQuality
} from '../core/gaitBiomechanics';
import { loadPoseLandmarker, detectPoseFrame, closePoseLandmarker } from '../core/poseBackend';

// 캘리브레이션: 세이프존 + 인식 안정이 이만큼 유지되면 락
const CALIB_HOLD_MS = 2000;
// 피사체가 중앙 세이프존(상하좌우 15% 여백) 안에 있는지
function isInSafeZone(lm) {
  if (!Array.isArray(lm)) return false;
  let n = 0;
  for (const i of [23, 24, 25, 26, 27, 28]) {
    const p = lm[i];
    if (!p || (p.visibility != null && p.visibility < 0.4)) continue;
    if (p.x < 0.15 || p.x > 0.85 || p.y < 0.15 || p.y > 0.85) return false;
    n += 1;
  }
  return n >= 4;
}

export default function GaitRunningAnalysis({ member, onBack, onSaveToFirebase, onSave }) {
  const saveToFirebase = onSaveToFirebase || onSave;

  const [view, setView] = useState('camera');
  const [isReady, setIsReady] = useState(false);   // 캘리브레이션 락
  const [recordingTime, setRecordingTime] = useState(0);
  const [warningMsg, setWarningMsg] = useState('');
  const [reportData, setReportData] = useState(null);
  const [poseLoaded, setPoseLoaded] = useState(false); // MediaPipe 준비 여부

  const armingSinceRef = useRef(null); // 안정 인식 시작 시각(ms)
  const lastTsRef = useRef(0);         // detectForVideo 타임스탬프 단조증가 보장

  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recordedBlobRef = useRef(null);
  const reqFrameRef = useRef(null);
  const viewRef = useRef('camera');
  const previewUrlRef = useRef(null);

  // 데이터 파이프라인 인스턴스
  const trackerRef = useRef(new GaitCycleTracker());
  const angleAccRef = useRef(new AngleAccumulator());

  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    if (view === 'camera' || view === 'recording') startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      // MediaPipe PoseLandmarker 를 CDN 런타임 로드(1회). 실패해도 카메라/녹화는 동작.
      loadPoseLandmarker({ numPoses: 1, delegate: 'GPU' })
        .then(() => setPoseLoaded(true))
        .catch((e) => { setPoseLoaded(false); setWarningMsg(e?.message || 'AI 분석 모듈 로드 실패'); });
      startVisionPipeline();
    } catch (err) {
      setWarningMsg('카메라 권한을 허용해주세요.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current);
  };

  // 실제 데이터 추출 루프: MediaPipe 추론 → 캘리브레이션 + 녹화 중 누적
  const startVisionPipeline = () => {
    const loop = () => {
      const video = videoRef.current;
      // 타임스탬프 단조증가 보장 (detectForVideo 는 같은 값 2회 시 예외)
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      let landmarks = null;
      try {
        const res = detectPoseFrame(video, ts); // 백엔드 미준비면 null
        landmarks = res?.landmarks || null;
      } catch (e) { landmarks = null; }

      if (landmarks) {
        if (viewRef.current === 'recording') {
          // 녹화 중: 분석 누적 (화면엔 수치 미표시)
          trackerRef.current.push(pelvisRelativeFeet(landmarks), ts);
          angleAccRef.current.push(jointAnglesFromPose(landmarks));
        } else {
          // 캘리브레이션: 앵글 품질 + 세이프존이 2초 유지되면 락
          const q = cameraAngleQuality(landmarks);
          const inZone = isInSafeZone(landmarks);
          if (q.ok && inZone) {
            if (armingSinceRef.current == null) armingSinceRef.current = ts;
            const held = ts - armingSinceRef.current;
            setIsReady(held >= CALIB_HOLD_MS);
            setWarningMsg(held >= CALIB_HOLD_MS ? '' : '자세 안정화 중...');
          } else {
            armingSinceRef.current = null;
            setIsReady(false);
            setWarningMsg(!q.ok ? '카메라를 골반 높이로 내려주세요'
              : !inZone ? '피사체를 가운데 박스 안에 맞춰주세요' : '');
          }
        }
      } else if (viewRef.current !== 'recording') {
        // 포즈 미검출 또는 백엔드 미연결
        armingSinceRef.current = null;
        // 백엔드 자체가 아직 로드 안 됐으면 안내만, 로드됐는데 사람이 없으면 경고
        if (!poseLoaded) { setIsReady(false); }
        else { setIsReady(false); setWarningMsg('하체가 보이도록 화면을 잡아주세요'); }
      }

      reqFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  useEffect(() => {
    let timer;
    if (view === 'recording') {
      timer = setInterval(() => {
        setRecordingTime(prev => {
          if (prev + 1 >= 15) stopRecording();
          return prev + 1;
        });
      }, 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const startRecording = () => {
    if (!isReady) return;
    chunksRef.current = [];
    trackerRef.current = new GaitCycleTracker(); // 녹화 시작 시 파이프라인 초기화
    angleAccRef.current = new AngleAccumulator();
    armingSinceRef.current = null;

    const mimeTypes = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
    let selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    mediaRecorderRef.current = new MediaRecorder(streamRef.current, { mimeType: selectedMime });
    mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mediaRecorderRef.current.onstop = () => {
      recordedBlobRef.current = new Blob(chunksRef.current, { type: selectedMime });

      // 녹화 종료 시 실제 누적된 분석 데이터를 리포트로 설정 (하드코딩 아님)
      const cycleSummary = trackerRef.current.summary();
      const angleSummary = angleAccRef.current.summary();

      setReportData({
        cadence: cycleSummary.averageCadenceSpm,
        stancePct: cycleSummary.stancePct,
        swingPct: cycleSummary.swingPct,
        angles: angleSummary,
        member: { id: member?.id || null, name: member?.name || null },
        measuredAt: new Date().toISOString(),
      });
      setView('preview');
    };

    mediaRecorderRef.current.start(1000);
    setView('recording');
  };

  const handleStopAttempt = () => {
    if (recordingTime < 5) {
      setWarningMsg('최소 5초 이상 측정해야 합니다.');
      setTimeout(() => setWarningMsg(''), 2000);
      return;
    }
    stopRecording();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleShareAndSave = async () => {
    if (!recordedBlobRef.current) return;
    const ext = recordedBlobRef.current.type.includes('mp4') ? 'mp4' : 'webm';
    const filename = `${member?.name || '회원'}_보행분석.${ext}`;
    const file = new File([recordedBlobRef.current], filename, { type: recordedBlobRef.current.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: '보행 분석', files: [file] });
        if (saveToFirebase) saveToFirebase(reportData);
      } catch (err) { /* 공유 취소/실패 무시 */ }
    } else {
      const url = URL.createObjectURL(recordedBlobRef.current);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      if (saveToFirebase) saveToFirebase(reportData);
    }
  };

  // preview 진입 시 blob URL 1회 생성 (매 렌더 생성 방지 → 메모리 누수 차단)
  useEffect(() => {
    if (view === 'preview' && recordedBlobRef.current) {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(recordedBlobRef.current);
    }
    return () => {
      if (view !== 'preview' && previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [view]);

  useEffect(() => () => {
    stopCamera();
    closePoseLandmarker();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden flex flex-col font-sans">
      {(view === 'camera' || view === 'recording') && (
        <>
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay />
          {/* 세이프 존 가이드 (상하좌우 15% 여백) — 캘리브레이션 시 녹색 */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-[15%]">
            <div className={`w-full h-full border-4 rounded-lg transition-colors ${isReady ? 'border-green-500/70' : 'border-white/30'}`} />
          </div>
          <div className="absolute top-0 w-full p-4 flex justify-between items-start bg-gradient-to-b from-black/60 to-transparent">
            <button onClick={onBack} className="measure-back">← 뒤로</button>
            <div className="text-center">
              <h1 className="measure-title">보행 & 런닝 분석</h1>
              {view === 'camera' && <p className="text-sm font-bold text-amber-400 mt-1 drop-shadow-md">일정한 속도로 뛸 때 시작하세요</p>}
              {warningMsg && <p className="text-sm font-bold text-red-400 mt-1 bg-black/50 px-2 py-1 rounded">{warningMsg}</p>}
            </div>
            <div className="w-10"></div>
          </div>
          {/* 컴팩트 초시계/메트로놈 (좌측 하단) */}
          <div className="absolute bottom-24 left-4 flex gap-2">
            <button className="bg-black/50 text-white rounded-full p-3 text-xs backdrop-blur-sm">⏱️</button>
            <button className="bg-black/50 text-white rounded-full p-3 text-xs backdrop-blur-sm">🎵</button>
          </div>
          <div className="absolute bottom-0 w-full p-6 bg-gradient-to-t from-black/80 to-transparent flex flex-col items-center gap-4">
            {view === 'recording' && (
              <div className="w-full max-w-md h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${recordingTime >= 5 ? 'bg-green-500' : 'bg-orange-500'}`}
                  style={{ width: `${(recordingTime / 15) * 100}%` }}
                />
              </div>
            )}
            {view === 'camera' ? (
              <button onClick={startRecording} disabled={!isReady} className={`w-20 h-20 rounded-full border-4 transition-all ${isReady ? 'border-green-500 bg-red-500' : 'border-slate-500 bg-slate-600'}`} />
            ) : (
              <button onClick={handleStopAttempt} className="w-20 h-20 rounded-full bg-slate-200 flex items-center justify-center text-red-600 text-3xl pb-2">■</button>
            )}
          </div>
        </>
      )}

      {view === 'preview' && (
        <div className="absolute inset-0 flex flex-col md:flex-row bg-slate-900">
          <div className="relative flex-1 md:flex-[2] bg-black">
            <video src={previewUrlRef.current || ''} className="w-full h-full object-contain" controls playsInline autoPlay loop muted />
            <div className="absolute top-4 left-4 bg-black/60 p-3 rounded-lg backdrop-blur-md">
              <p className="text-amber-400 font-bold">SPM: {reportData?.cadence}</p>
              <p className="text-white text-sm">입각기: {reportData?.stancePct}% | 유각기: {reportData?.swingPct}%</p>
            </div>
            <button onClick={() => setView('camera')} className="absolute top-4 right-4 bg-white/20 text-white px-4 py-2 rounded-lg backdrop-blur-md font-bold">✕ 다시 찍기</button>
          </div>
          <div className="flex-1 bg-slate-800 p-6 overflow-y-auto">
            <h2 className="text-2xl font-black text-white mb-6">측정 리포트</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-700 p-4 rounded-xl">
                <p className="text-slate-400 text-sm">평균 케이던스</p>
                <p className="text-2xl font-bold text-white">{reportData?.cadence} <span className="text-sm">SPM</span></p>
              </div>
              <div className="bg-slate-700 p-4 rounded-xl">
                <p className="text-slate-400 text-sm">비율 (Stance/Swing)</p>
                <p className="text-2xl font-bold text-white">{reportData?.stancePct}% / {reportData?.swingPct}%</p>
              </div>
            </div>
            <div className="bg-slate-700 p-4 rounded-xl mb-6">
              <h3 className="text-slate-300 font-bold mb-3">관절 가동 범위 (ROM)</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-white"><span className="text-slate-400">고관절</span> <span>{reportData?.angles?.hip?.rom ?? 0}°</span></div>
                <div className="flex justify-between text-white"><span className="text-slate-400">무릎</span> <span>{reportData?.angles?.knee?.rom ?? 0}°</span></div>
                <div className="flex justify-between text-white"><span className="text-slate-400">발목</span> <span>{reportData?.angles?.ankle?.rom ?? 0}°</span></div>
              </div>
            </div>
            <button onClick={handleShareAndSave} className="btn btn-primary w-full shadow-lg shadow-amber-500/20">🚀 기기 저장 및 리포트 전송</button>
          </div>
        </div>
      )}
    </div>
  );
}
