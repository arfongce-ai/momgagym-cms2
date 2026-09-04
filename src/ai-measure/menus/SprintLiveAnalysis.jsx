// ai-measure/menus/SprintLiveAnalysis.jsx
//
// [범위 안내 — GaitRunningAnalysis.jsx와의 차이]
// 이 파일은 GaitRunningAnalysis.jsx(854줄)의 카메라·포즈 파이프라인 패턴을
// 그대로 따르되, 1차 버전이라 아래는 의도적으로 뺐다. 필요해지면 Gait 파일의
// 해당 부분(createRecordedStream / MediaRecorder / useCameraRotation /
// 스톱워치·메트로놈 도구 서랍)을 그대로 옮겨오면 된다.
//   - 영상 녹화(MediaRecorder + 캔버스 합성) — 지금은 수치만 저장
//   - 화면 회전 보정(useCameraRotation) — 트랙 촬영은 보통 고정 각도라 우선 제외
//   - 스톱워치·메트로놈 도구 서랍
//
// [캘리브레이션 방식 차이]
// Gait는 "몸이 화면 중앙 박스 안에 잡히면 자동 락"이지만, 스프린트는 트랙
// 위 두 지점(0m·거리마커)을 트레이너가 화면에서 직접 터치해야 하므로
// 자동 세이프존 대신 2점 탭 UI를 쓴다.

import React, { useState, useEffect, useRef } from 'react';
import { SprintTracker, calibrateTrack } from '../core/sprintAgility';
import { beepTick, beepGo, primeAudio } from '../core/audioCue';
import { loadPoseLandmarker, detectPoseFrame, isPoseReady, closePoseLandmarker } from '../core/poseBackend';
import { openMainCameraStream, describeCameraError } from '../core/cameraSelect';

// 테스트 종류: 5m/10m 스프린트는 편도, 5-0-5는 왕복(아질리티)
const TEST_TYPES = {
  sprint5: { label: '5m 스프린트', mode: 'sprint', splitDistancesM: [5], trackDistanceM: 5 },
  sprint10: { label: '10m 스프린트', mode: 'sprint', splitDistancesM: [5, 10], trackDistanceM: 10 },
  agility505: { label: '5-0-5 아질리티', mode: 'agility', splitDistancesM: [5], trackDistanceM: 5 },
};

const COUNTDOWN_SEC = 3;

export default function SprintLiveAnalysis({ member, onBack, onSaveToFirebase, onSave }) {
  const saveToFirebase = onSaveToFirebase || onSave;

  // view: camera(카메라 켜짐) → calibrate(2점 탭) → countdown → running → result
  const [view, setView] = useState('camera');
  const [testKey, setTestKey] = useState('sprint10');
  const [warningMsg, setWarningMsg] = useState('');
  const [cameraFailed, setCameraFailed] = useState(false);
  const [poseLoaded, setPoseLoaded] = useState(false);
  const [calibPoints, setCalibPoints] = useState([]); // [{x,y}] 화면 정규화(0~1) 좌표, 최대 2개
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const [liveMetrics, setLiveMetrics] = useState({ distanceM: 0, velocityMs: 0, elapsedMs: 0 });
  const [reportData, setReportData] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error

  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const reqFrameRef = useRef(null);
  const lastTsRef = useRef(0);
  const viewRef = useRef('camera');
  const trackerRef = useRef(null);
  const cueTimerRef = useRef(null);

  useEffect(() => { viewRef.current = view; }, [view]);

  // 카메라 생명주기 — camera/calibrate/countdown/running 동안 켜두고, result에서만 끔.
  useEffect(() => {
    if (view !== 'result' && !streamRef.current) startCamera();
    if (view === 'result') stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => () => { stopCamera(); closePoseLandmarker(); }, []);

  const startCamera = async () => {
    setWarningMsg('');
    setCameraFailed(false);
    try {
      const stream = await openMainCameraStream({ audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        if (!video.videoWidth) {
          await new Promise((res) => {
            let done = false;
            const finish = () => { if (!done) { done = true; res(); } };
            video.addEventListener('loadedmetadata', finish, { once: true });
            setTimeout(finish, 1500);
          });
        }
        try { await video.play(); } catch (e) { /* 자동재생 정책 */ }
      }
      loadPoseLandmarker({ numPoses: 1, modelTier: 'full' })
        .then(() => setPoseLoaded(true))
        .catch((e) => { setPoseLoaded(false); setWarningMsg(e?.message || 'AI 분석 모듈 로드 실패'); });
      startVisionLoop();
    } catch (err) {
      setCameraFailed(true);
      setWarningMsg(describeCameraError(err));
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); reqFrameRef.current = null; }
  };

  // 매 프레임: 포즈 검출 → (calibrate 단계면 스켈레톤만 표시) → (running 단계면 tracker.push)
  const startVisionLoop = () => {
    if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current);
    let lastUi = 0;
    const loop = () => {
      const video = videoRef.current;
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      let landmarks = null;
      try {
        const res = detectPoseFrame(video, ts);
        landmarks = res?.landmarks || null;
      } catch (e) { landmarks = null; }

      drawOverlay(landmarks);

      if (viewRef.current === 'running' && landmarks && trackerRef.current) {
        trackerRef.current.push(landmarks, ts);
        if (ts - lastUi > 100) {
          lastUi = ts;
          const last = trackerRef.current.samples[trackerRef.current.samples.length - 1];
          if (last) {
            setLiveMetrics({ distanceM: last.distanceM, velocityMs: last.velocityMs, elapsedMs: last.tMs });
          }
        }
        // 자동 종료: 목표 거리(+0.5m 여유)를 넘겼고 속도가 거의 0(멈춤)이면 측정 종료.
        const cfg = TEST_TYPES[testKey];
        const target = cfg.mode === 'agility' ? cfg.trackDistanceM * 2 : cfg.trackDistanceM; // 아질리티는 왕복
        if (trackerRef.current.lastDistanceM != null &&
            Math.abs(trackerRef.current.lastDistanceM) >= target - 0.3 &&
            Math.abs(last?.velocityMs || 0) < 0.3) {
          finishRun();
        }
      }

      reqFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  // 골반 위치 + 캘리브레이션 점 시각화 (스켈레톤은 간단히 골반 점 하나만 — 전체 뼈대는
  // 필요해지면 GaitRunningAnalysis.jsx의 drawSkeleton()을 그대로 옮겨온다)
  const drawOverlay = (landmarks) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    // 캘리브레이션 탭 지점 표시
    calibPoints.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? '#22d3ee' : '#f97316';
      ctx.beginPath(); ctx.arc(p.x * cw, p.y * ch, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
      ctx.fillText(i === 0 ? '0m' : `${TEST_TYPES[testKey].trackDistanceM}m`, p.x * cw + 14, p.y * ch + 4);
    });
    if (calibPoints.length === 2) {
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(calibPoints[0].x * cw, calibPoints[0].y * ch);
      ctx.lineTo(calibPoints[1].x * cw, calibPoints[1].y * ch);
      ctx.stroke();
    }

    // 골반 위치 점
    if (landmarks && landmarks[23] && landmarks[24]) {
      const hx = (landmarks[23].x + landmarks[24].x) / 2;
      const hy = (landmarks[23].y + landmarks[24].y) / 2;
      ctx.fillStyle = 'rgba(52,211,153,0.9)';
      ctx.beginPath(); ctx.arc(hx * cw, hy * ch, 7, 0, Math.PI * 2); ctx.fill();
    }
  };

  // 캘리브레이션 화면 탭 처리 — 두 점 찍으면 자동으로 스케일 계산
  const handleCalibTap = (e) => {
    if (calibPoints.length >= 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setCalibPoints((prev) => [...prev, { x, y }]);
  };

  const resetCalibration = () => setCalibPoints([]);

  const confirmCalibrationAndStart = () => {
    if (calibPoints.length !== 2) return;
    const cfg = TEST_TYPES[testKey];
    const calibration = calibrateTrack(calibPoints[0], calibPoints[1], cfg.trackDistanceM);
    if (!calibration) {
      setWarningMsg('캘리브레이션에 실패했습니다. 두 점을 다시 찍어주세요.');
      return;
    }
    trackerRef.current = new SprintTracker({
      calibration,
      splitDistancesM: cfg.splitDistancesM,
      mode: cfg.mode,
    });
    primeAudio();
    setView('countdown');
    setCountdown(COUNTDOWN_SEC);
  };

  // 3-2-1 카운트다운 → beepGo() 재생과 동시에 markCue()로 반응속도 기준시각 기록 → running 진입
  useEffect(() => {
    if (view !== 'countdown') return undefined;
    if (countdown <= 0) {
      const cueTs = performance.now();
      beepGo();
      trackerRef.current?.markCue(cueTs);
      setView('running');
      return undefined;
    }
    beepTick();
    cueTimerRef.current = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(cueTimerRef.current);
  }, [view, countdown]);

  const finishRun = () => {
    if (!trackerRef.current) return;
    const summary = trackerRef.current.finalize();
    setReportData({
      ...summary,
      testKey,
      testLabel: TEST_TYPES[testKey].label,
      source: 'live',
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    });
    setView('result');
  };

  const handleSave = async () => {
    if (!reportData || !saveToFirebase) return;
    setSaveState('saving');
    try {
      await saveToFirebase(reportData);
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setWarningMsg('저장에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleRetry = () => {
    setCalibPoints([]);
    setReportData(null);
    setSaveState('idle');
    trackerRef.current = null;
    setView('camera');
  };

  // ── 렌더 ──
  return (
    <div style={styles.root}>
      <div style={styles.videoWrap}>
        <video ref={videoRef} playsInline muted style={styles.video} />
        <canvas
          ref={overlayCanvasRef}
          style={styles.overlay}
          onClick={view === 'calibrate' ? handleCalibTap : undefined}
        />

        {view === 'camera' && (
          <div style={styles.centerPanel}>
            <div style={styles.testPicker}>
              {Object.entries(TEST_TYPES).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setTestKey(key)}
                  style={{ ...styles.testBtn, ...(testKey === key ? styles.testBtnActive : {}) }}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
            <button style={styles.primaryBtn} onClick={() => setView('calibrate')} disabled={!poseLoaded}>
              {poseLoaded ? '바닥 기준선 잡기' : 'AI 모듈 로딩 중...'}
            </button>
            {cameraFailed && <button style={styles.secondaryBtn} onClick={startCamera}>카메라 다시 시도</button>}
          </div>
        )}

        {view === 'calibrate' && (
          <div style={styles.hintBar}>
            {calibPoints.length === 0 && '바닥 0m 지점을 화면에서 터치하세요'}
            {calibPoints.length === 1 && `${TEST_TYPES[testKey].trackDistanceM}m 지점을 터치하세요`}
            {calibPoints.length === 2 && (
              <div style={styles.calibConfirmRow}>
                <button style={styles.secondaryBtn} onClick={resetCalibration}>다시 찍기</button>
                <button style={styles.primaryBtn} onClick={confirmCalibrationAndStart}>측정 시작</button>
              </div>
            )}
          </div>
        )}

        {view === 'countdown' && (
          <div style={styles.countdownOverlay}>{countdown > 0 ? countdown : 'GO'}</div>
        )}

        {view === 'running' && (
          <div style={styles.hud}>
            <div style={styles.hudMain}>{liveMetrics.velocityMs.toFixed(1)} m/s</div>
            <div style={styles.hudSub}>{(liveMetrics.elapsedMs / 1000).toFixed(2)}초 · {liveMetrics.distanceM.toFixed(1)}m</div>
            <button style={styles.stopBtn} onClick={finishRun}>측정 종료</button>
          </div>
        )}

        {warningMsg && <div style={styles.warning}>{warningMsg}</div>}
      </div>

      {view === 'result' && reportData && (
        <div style={styles.resultPanel}>
          <h3 style={styles.resultTitle}>{reportData.testLabel} 결과</h3>
          <ResultRow label="총 소요시간" value={`${(reportData.totalTimeMs / 1000).toFixed(2)}초`} />
          <ResultRow label="최고속도" value={`${reportData.peakVelocityMs.toFixed(1)} m/s`} />
          {Object.entries(reportData.splits || {}).map(([d, ms]) => (
            <ResultRow key={d} label={`${d} 구간기록`} value={`${(ms / 1000).toFixed(2)}초`} />
          ))}
          {reportData.reactionTimeMs != null && (
            <ResultRow label="스타트 반응속도" value={`${reportData.reactionTimeMs}ms`} />
          )}
          {reportData.deceleration && (
            <ResultRow label="감속·제동" value={`${reportData.deceleration.decelTimeMs}ms / ${reportData.deceleration.decelDistanceM}m`} />
          )}
          {reportData.turnCount > 0 && <ResultRow label="방향전환" value={`${reportData.turnCount}회`} />}

          <div style={styles.resultActions}>
            <button style={styles.secondaryBtn} onClick={handleRetry}>다시 측정</button>
            <button style={styles.primaryBtn} onClick={handleSave} disabled={saveState === 'saving' || saveState === 'saved'}>
              {saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중...' : '저장'}
            </button>
            {onBack && <button style={styles.secondaryBtn} onClick={onBack}>목록으로</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultRow({ label, value }) {
  return (
    <div style={styles.resultRow}>
      <span style={styles.resultLabel}>{label}</span>
      <span style={styles.resultValue}>{value}</span>
    </div>
  );
}

const styles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: '#0b0f14', color: '#fff' },
  videoWrap: { position: 'relative', flex: 1, overflow: 'hidden' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  centerPanel: { position: 'absolute', left: 0, right: 0, bottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  testPicker: { display: 'flex', gap: 8 },
  testBtn: { padding: '8px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.4)', color: '#fff' },
  testBtnActive: { background: '#22d3ee', color: '#0b0f14', borderColor: '#22d3ee' },
  primaryBtn: { padding: '12px 24px', borderRadius: 24, background: '#22d3ee', color: '#0b0f14', fontWeight: 700, border: 'none' },
  secondaryBtn: { padding: '12px 24px', borderRadius: 24, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
  hintBar: { position: 'absolute', left: 0, right: 0, bottom: 24, textAlign: 'center', color: '#fff', fontSize: 16 },
  calibConfirmRow: { display: 'flex', gap: 12, justifyContent: 'center' },
  countdownOverlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 96, fontWeight: 800, color: '#22d3ee' },
  hud: { position: 'absolute', top: 20, left: 0, right: 0, textAlign: 'center' },
  hudMain: { fontSize: 40, fontWeight: 800 },
  hudSub: { fontSize: 16, opacity: 0.8, marginTop: 4 },
  stopBtn: { marginTop: 16, padding: '10px 22px', borderRadius: 20, background: '#ef4444', color: '#fff', border: 'none', fontWeight: 700 },
  warning: { position: 'absolute', top: 12, left: 12, right: 12, padding: 10, background: 'rgba(0,0,0,0.7)', borderRadius: 8, fontSize: 13, textAlign: 'center' },
  resultPanel: { padding: 20, background: '#111827' },
  resultTitle: { marginBottom: 12 },
  resultRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  resultLabel: { opacity: 0.7 },
  resultValue: { fontWeight: 700 },
  resultActions: { display: 'flex', gap: 10, marginTop: 20 },
};
