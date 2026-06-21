import React, { useState, useEffect, useRef } from 'react';
import {
  GaitCycleTracker, jointAnglesFromPose, AngleAccumulator,
  pelvisRelativeFeet, cameraAngleQuality
} from '../core/gaitBiomechanics';
import { loadPoseLandmarker, detectPoseFrame, closePoseLandmarker, isPoseReady } from '../core/poseBackend';

// 캘리브레이션: 세이프존 + 인식 안정이 이만큼 유지되면 락
const CALIB_HOLD_MS = 800; // 사람이 잡히면 거의 즉시 인식(0.8초 안정화로 깜빡임만 방지)
// 피사체가 중앙 세이프존(상하좌우 15% 여백) 안에 있는지
function isInSafeZone(lm) {
  if (!Array.isArray(lm)) return false;
  // 골반·무릎·발목 중 충분수가 세이프존 안에 있으면 OK.
  // 발(아래쪽)이 박스 하단을 살짝 넘는 건 흔하므로, '하나라도 벗어나면 실패'가
  // 아니라 '안에 든 개수'로 판정해 jitter·경계 걸침에 관대하게 한다.
  let inside = 0, seen = 0;
  for (const i of [23, 24, 25, 26, 27, 28]) {
    const p = lm[i];
    if (!p || (p.visibility != null && p.visibility < 0.3)) continue;
    seen += 1;
    // 좌우는 여유 있게(0.1~0.9), 상단만 0.12, 하단은 거의 끝까지(0.98) 허용
    if (p.x >= 0.10 && p.x <= 0.90 && p.y >= 0.12 && p.y <= 0.98) inside += 1;
  }
  // 관절이 충분히 보이고(>=3), 그중 다수(>=3)가 존 안에 있으면 통과
  return seen >= 3 && inside >= 3;
}

export default function GaitRunningAnalysis({ member, onBack, onSaveToFirebase, onSave }) {
  const saveToFirebase = onSaveToFirebase || onSave;

  const [view, setView] = useState('camera');
  const [isReady, setIsReady] = useState(false);   // 캘리브레이션 락
  const [recordingTime, setRecordingTime] = useState(0);
  const [warningMsg, setWarningMsg] = useState('');
  const [reportData, setReportData] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(''); // 녹화 영상 blob URL (state라야 비디오에 반영됨)
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error  회차 저장 상태
  const [shareMsg, setShareMsg] = useState('');
  const [poseLoaded, setPoseLoaded] = useState(false); // MediaPipe 준비 여부

  const armingSinceRef = useRef(null); // 안정 인식 시작 시각(ms)
  const lastTsRef = useRef(0);         // detectForVideo 타임스탬프 단조증가 보장
  const lostFramesRef = useRef(0);     // 캘리브레이션 jitter 관용 카운터

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

  // 카메라 생명주기 분리: camera 진입 시 켜고, preview 갈 때만 끔.
  // recording 중에는 스트림을 절대 건드리지 않는다(녹화 끊김 방지).
  useEffect(() => {
    if (view === 'camera' && !streamRef.current) {
      startCamera();
    } else if (view === 'preview') {
      stopCamera();
    }
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
      // MediaPipe PoseLandmarker 를 CDN 런타임 로드(1회). GPU 실패 시 CPU 자동 폴백.
      loadPoseLandmarker({ numPoses: 1 })
        .then(() => setPoseLoaded(true))
        .catch((e) => { setPoseLoaded(false); setWarningMsg(e?.message || 'AI 분석 모듈 로드 실패'); });
      startVisionPipeline();
    } catch (err) {
      setWarningMsg('카메라 권한을 허용해주세요.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null; // 중요: null 로 비워야 '다시 찍기' 시 카메라가 재시작됨
    }
    if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); reqFrameRef.current = null; }
  };

  // 실제 데이터 추출 루프: MediaPipe 추론 → 캘리브레이션 + 녹화 중 누적
  const startVisionPipeline = () => {
    if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current); // 중복 루프 방지
    // setState 과호출 방지용 직전값 캐시 (60fps 매프레임 setState → 발열·렌더폭주 차단)
    let lastReady = null, lastWarn = null;
    const setReadyOnce = (v) => { if (v !== lastReady) { lastReady = v; setIsReady(v); } };
    const setWarnOnce = (v) => { if (v !== lastWarn) { lastWarn = v; setWarningMsg(v); } };
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
          // 캘리브레이션: 앵글 품질 + 세이프존이 유지되면 락
          const q = cameraAngleQuality(landmarks);
          const inZone = isInSafeZone(landmarks);
          if (q.ok && inZone) {
            lostFramesRef.current = 0;
            if (armingSinceRef.current == null) armingSinceRef.current = ts;
            const held = ts - armingSinceRef.current;
            setReadyOnce(held >= CALIB_HOLD_MS);
            setWarnOnce(held >= CALIB_HOLD_MS ? '' : `자세 안정화 중... ${Math.min(99, Math.round(held / CALIB_HOLD_MS * 100))}%`);
          } else {
            // jitter 관용: 조건이 잠깐(최대 8프레임≈0.13s) 빠져도 타이머 유지
            lostFramesRef.current += 1;
            if (lostFramesRef.current > 8) {
              armingSinceRef.current = null;
              setReadyOnce(false);
              setWarnOnce(!q.ok ? '카메라를 골반 높이로 내려주세요'
                : '피사체를 가운데 박스 안에 맞춰주세요');
            }
          }
        }
      } else if (viewRef.current !== 'recording') {
        // 포즈 미검출 또는 백엔드 미연결
        armingSinceRef.current = null;
        lostFramesRef.current = 0;
        setReadyOnce(false);
        // isPoseReady() 는 모듈 전역값이라 stale 클로저 영향을 받지 않는다.
        setWarnOnce(isPoseReady()
          ? '사람 전신(머리~발)이 화면에 들어오게 해주세요'
          : 'AI 분석 모듈 로딩 중...');
      }

      reqFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  // 녹화 타이머 (1초 단위 경과)
  useEffect(() => {
    if (view !== 'recording') { setRecordingTime(0); return undefined; }
    const timer = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [view]);

  // 15초 자동 종료 (메모리 오버플로우 방지) — updater 부수효과 대신 별도 effect
  useEffect(() => {
    if (view === 'recording' && recordingTime >= 15) stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingTime, view]);

  const startRecording = () => {
    if (!isReady) return;
    chunksRef.current = [];
    trackerRef.current = new GaitCycleTracker(); // 녹화 시작 시 파이프라인 초기화
    angleAccRef.current = new AngleAccumulator();
    armingSinceRef.current = null;
    // 이전 측정의 저장/공유 상태 리셋 (재녹화 시 저장 버튼이 막히지 않도록)
    setSaveState('idle');
    setShareMsg('');
    setReportData(null);

    const mimeTypes = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
    let selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    mediaRecorderRef.current = new MediaRecorder(streamRef.current, { mimeType: selectedMime });
    mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mediaRecorderRef.current.onstop = () => {
      recordedBlobRef.current = new Blob(chunksRef.current, { type: selectedMime });

      // blob URL 을 즉시 생성해 state 로 넣는다(비디오 src 반영). 이전 URL 은 해제.
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(recordedBlobRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);

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

  // 영상 공유/기기 저장 (Web Share, 실패 시 다운로드 폴백). 데이터 저장과 독립.
  const handleShareVideo = async () => {
    if (!recordedBlobRef.current) return;
    const ext = recordedBlobRef.current.type.includes('mp4') ? 'mp4' : 'webm';
    const filename = `${member?.name || '회원'}_보행분석.${ext}`;
    const file = new File([recordedBlobRef.current], filename, { type: recordedBlobRef.current.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: '보행 분석', files: [file] });
        setShareMsg('공유 완료');
      } catch (err) {
        if (err?.name !== 'AbortError') setShareMsg('공유 실패 — 다운로드로 저장하세요');
      }
    } else {
      const url = URL.createObjectURL(recordedBlobRef.current);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      setShareMsg('기기에 저장됨');
    }
  };

  // 회차 데이터 저장 (Firebase). 영상 공유와 완전히 독립적으로 실행.
  const handleSaveReport = async () => {
    if (!reportData || typeof saveToFirebase !== 'function') return;
    setSaveState('saving');
    try {
      await saveToFirebase(reportData);
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
    }
  };

  // 다시 찍기 등으로 preview 를 벗어날 때 blob URL 정리
  useEffect(() => {
    if (view !== 'preview' && previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl('');
    }
  }, [view]);

  useEffect(() => () => {
    stopCamera();
    closePoseLandmarker();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] w-screen bg-slate-950 overflow-hidden flex flex-col font-sans"
      style={{ height: '100dvh' }}
    >
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
              {view === 'camera' && (
                <p className="text-sm font-bold text-amber-400 mt-1 drop-shadow-md">
                  {poseLoaded ? '일정한 속도로 뛸 때 시작하세요' : 'AI 분석 모듈 준비 중...'}
                </p>
              )}
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
            <video src={previewUrl || ''} className="w-full h-full object-contain" controls playsInline autoPlay loop muted />
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
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleShareVideo} className="rounded-xl border border-slate-600 bg-slate-700 text-white font-bold py-3 text-sm">
                  📤 영상 저장·공유
                </button>
                <button onClick={handleSaveReport} disabled={saveState === 'saving' || saveState === 'saved'}
                  className="btn btn-primary disabled:opacity-60 flex items-center justify-center gap-2">
                  {saveState === 'saving' && <span className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />}
                  {saveState === 'saved' ? '✓ 회차 저장됨' : saveState === 'saving' ? '저장 중...' : '💾 회차 기록 저장'}
                </button>
              </div>
              {shareMsg && <p className="text-center text-xs text-emerald-400">{shareMsg}</p>}
              {saveState === 'error' && <p className="text-center text-xs text-red-400">저장 실패 — 네트워크 확인 후 다시 시도하세요</p>}
              <p className="text-center text-[11px] text-slate-500">영상은 기기에, 회차 기록(정량 데이터)은 서버에 저장됩니다.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
