// ai-measure/menus/SprintLiveAnalysis.jsx  (v3 — 2026-09-04 현장 피드백 반영)
//
// v2 → v3 변경점 (Metric Sprint 앱 참고 영상 피드백):
//   캘리브레이션 방식을 "화면 빈 곳 2번 탭"에서 "가이드선(0m·거리 마커) 핸들을
//   손가락으로 밀어서 실제 바닥 표시에 맞추는" 방식으로 바꿨다. calibrate 화면
//   진입 시 화면 하단에 기본 위치의 핸들 2개가 뜨고, 트레이너가 이걸 드래그해
//   바닥 테이프 위치와 맞춘 뒤 "측정 시작"을 누르면 그 두 점 좌표로
//   calibrateTrack()을 호출한다 — 계산 로직(sprintAgility.js)은 동일, 좌표를
//   얻는 UI 상호작용만 바뀐 것.
//
// v1 → v2에서 반영된 것(가로모드 안내, 단순화된 버튼)은 그대로 유지.
//
// [범위 안내 — 아직 안 넣은 것]
//   - 영상 녹화(MediaRecorder) / 스톱워치·메트로놈 도구 서랍
//   - 필요해지면 GaitRunningAnalysis.jsx의 해당 부분을 옮겨오면 된다.

import React, { useState, useEffect, useRef } from 'react';
import { SprintTracker, calibrateTrack } from '../core/sprintAgility';
import { beepTick, beepGo, primeAudio } from '../core/audioCue';
import { loadPoseLandmarker, detectPoseFrame, isPoseReady, closePoseLandmarker } from '../core/poseBackend';
import { openMainCameraStream, describeCameraError } from '../core/cameraSelect';

const TEST_TYPES = {
  sprint5: { label: '5m 스프린트', mode: 'sprint', splitDistancesM: [5], trackDistanceM: 5 },
  sprint10: { label: '10m 스프린트', mode: 'sprint', splitDistancesM: [5, 10], trackDistanceM: 10 },
  agility505: { label: '5-0-5 아질리티', mode: 'agility', splitDistancesM: [5], trackDistanceM: 5 },
};

const COUNTDOWN_SEC = 3;
// 캘리브레이션 핸들 기본 위치(화면 하단, 좌우로 벌어진 상태) — 여기서부터
// 트레이너가 실제 바닥 표시 쪽으로 드래그해 맞춘다.
const DEFAULT_CALIB_POINTS = [{ x: 0.18, y: 0.82 }, { x: 0.82, y: 0.82 }];

function useIsLandscape() {
  const getIsLandscape = () => {
    if (typeof window === 'undefined') return true;
    if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
    return window.innerWidth > window.innerHeight;
  };
  const [isLandscape, setIsLandscape] = useState(getIsLandscape);
  useEffect(() => {
    const onChange = () => setIsLandscape(getIsLandscape());
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
    };
  }, []);
  return isLandscape;
}

async function tryLockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) {
    // iOS Safari는 API 자체가 없고, 대부분의 브라우저가 풀스크린이 아니면 거부한다.
    // 실패해도 "가로로 돌려주세요" 안내 배너가 대체 수단이라 무시한다.
  }
}

export default function SprintLiveAnalysis({ member, onBack, onSaveToFirebase, onSave }) {
  const saveToFirebase = onSaveToFirebase || onSave;
  const isLandscape = useIsLandscape();

  const [view, setView] = useState('camera');
  const [testKey, setTestKey] = useState('sprint10');
  const [warningMsg, setWarningMsg] = useState('');
  const [cameraFailed, setCameraFailed] = useState(false);
  const [poseLoaded, setPoseLoaded] = useState(false);
  const [calibPoints, setCalibPoints] = useState(DEFAULT_CALIB_POINTS);
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const [liveMetrics, setLiveMetrics] = useState({ distanceM: 0, velocityMs: 0, elapsedMs: 0 });
  const [reportData, setReportData] = useState(null);
  const [saveState, setSaveState] = useState('idle');

  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const dragAreaRef = useRef(null); // 드래그 좌표 계산 기준(비디오 래퍼) — handle 위치는 이 요소 기준 %
  const streamRef = useRef(null);
  const reqFrameRef = useRef(null);
  const lastTsRef = useRef(0);
  const viewRef = useRef('camera');
  const trackerRef = useRef(null);
  const cueTimerRef = useRef(null);
  const draggingIndexRef = useRef(null);

  useEffect(() => { viewRef.current = view; }, [view]);

  // calibrate 화면 진입할 때마다 핸들 기본 위치로 리셋(직전 측정에서 옮긴 채 남지 않게)
  useEffect(() => {
    if (view === 'calibrate') setCalibPoints(DEFAULT_CALIB_POINTS);
  }, [view]);

  useEffect(() => {
    if (view !== 'result' && !streamRef.current) startCamera();
    if (view === 'result') stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => () => { stopCamera(); closePoseLandmarker(); }, []);

  const startCamera = async () => {
    setWarningMsg('');
    setCameraFailed(false);
    tryLockLandscape();
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

      drawHipDot(landmarks);

      if (viewRef.current === 'running' && landmarks && trackerRef.current) {
        trackerRef.current.push(landmarks, ts);
        if (ts - lastUi > 100) {
          lastUi = ts;
          const last = trackerRef.current.samples[trackerRef.current.samples.length - 1];
          if (last) setLiveMetrics({ distanceM: last.distanceM, velocityMs: last.velocityMs, elapsedMs: last.tMs });
        }
        const cfg = TEST_TYPES[testKey];
        const target = cfg.mode === 'agility' ? cfg.trackDistanceM * 2 : cfg.trackDistanceM;
        const last = trackerRef.current.samples[trackerRef.current.samples.length - 1];
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

  // 골반 위치 점만 캔버스에 그린다 — 캘리브레이션 선/핸들은 이제 HTML+SVG 오버레이(아래)가 담당.
  const drawHipDot = (landmarks) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    if (landmarks && landmarks[23] && landmarks[24]) {
      const hx = (landmarks[23].x + landmarks[24].x) / 2;
      const hy = (landmarks[23].y + landmarks[24].y) / 2;
      ctx.fillStyle = 'rgba(52,211,153,0.9)';
      ctx.beginPath(); ctx.arc(hx * cw, hy * ch, 6, 0, Math.PI * 2); ctx.fill();
    }
  };

  // ── 가이드선 드래그 ──
  const clampedFromEvent = (e) => {
    const rect = dragAreaRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };
  const onHandleMove = (e) => {
    const idx = draggingIndexRef.current;
    if (idx == null) return;
    const p = clampedFromEvent(e);
    setCalibPoints((prev) => { const next = [...prev]; next[idx] = p; return next; });
  };
  const onHandleUp = () => {
    draggingIndexRef.current = null;
    window.removeEventListener('pointermove', onHandleMove);
    window.removeEventListener('pointerup', onHandleUp);
  };
  const onHandleDown = (index) => (e) => {
    e.preventDefault();
    draggingIndexRef.current = index;
    window.addEventListener('pointermove', onHandleMove);
    window.addEventListener('pointerup', onHandleUp);
  };
  useEffect(() => () => onHandleUp(), []); // 언마운트 시 잔여 리스너 정리

  const resetCalibration = () => setCalibPoints(DEFAULT_CALIB_POINTS);

  const confirmCalibrationAndStart = () => {
    const cfg = TEST_TYPES[testKey];
    const calibration = calibrateTrack(calibPoints[0], calibPoints[1], cfg.trackDistanceM);
    if (!calibration) {
      setWarningMsg('캘리브레이션에 실패했습니다. 두 핸들 간격을 넓혀주세요.');
      return;
    }
    trackerRef.current = new SprintTracker({ calibration, splitDistancesM: cfg.splitDistancesM, mode: cfg.mode });
    primeAudio();
    setView('countdown');
    setCountdown(COUNTDOWN_SEC);
  };

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
    setCalibPoints(DEFAULT_CALIB_POINTS);
    setReportData(null);
    setSaveState('idle');
    trackerRef.current = null;
    setView('camera');
  };

  return (
    <div style={styles.root}>
      <div style={styles.videoWrap} ref={dragAreaRef}>
        <video ref={videoRef} playsInline muted style={styles.video} />

        {/* camera 화면: 아직 핸들 조작 전, 눈대중용 정적 가이드만 살짝 보여줌 */}
        {view === 'camera' && <StaticTrackGuide trackDistanceM={TEST_TYPES[testKey].trackDistanceM} mode={TEST_TYPES[testKey].mode} />}

        {/* calibrate 화면: 실제 드래그 가능한 가이드선 + 핸들 2개 */}
        {view === 'calibrate' && (
          <DraggableTrackGuide
            points={calibPoints}
            trackDistanceM={TEST_TYPES[testKey].trackDistanceM}
            mode={TEST_TYPES[testKey].mode}
            onHandleDown={onHandleDown}
          />
        )}

        <canvas ref={overlayCanvasRef} style={styles.overlay} />

        {!isLandscape && (
          <div style={styles.rotateBanner}>📱 화면을 가로로 돌려주세요 — 트랙 전체가 보여야 정확히 측정돼요</div>
        )}

        {view === 'camera' && (
          <div style={styles.centerPanel}>
            <div style={styles.testPicker}>
              {Object.entries(TEST_TYPES).map(([key, cfg]) => (
                <button key={key} onClick={() => setTestKey(key)} style={{ ...styles.testBtn, ...(testKey === key ? styles.testBtnActive : {}) }}>
                  {cfg.label}
                </button>
              ))}
            </div>
            <button style={styles.primaryBtn} onClick={() => setView('calibrate')} disabled={!poseLoaded}>
              {poseLoaded ? '바닥 기준선 잡기' : '로딩 중...'}
            </button>
            {cameraFailed && <button style={styles.textBtn} onClick={startCamera}>카메라 다시 시도</button>}
          </div>
        )}

        {view === 'calibrate' && (
          <div style={styles.hintBar}>
            <span style={styles.hintText}>초록 점을 바닥 0m·{TEST_TYPES[testKey].trackDistanceM}m 표시로 밀어서 맞추세요</span>
            <div style={styles.calibConfirmRow}>
              <button style={styles.textBtn} onClick={resetCalibration}>가운데로 리셋</button>
              <button style={styles.primaryBtn} onClick={confirmCalibrationAndStart}>측정 시작</button>
            </div>
          </div>
        )}

        {view === 'countdown' && <div style={styles.countdownOverlay}>{countdown > 0 ? countdown : 'GO'}</div>}

        {view === 'running' && (
          <div style={styles.hud}>
            <div style={styles.hudMain}>{liveMetrics.velocityMs.toFixed(1)} m/s</div>
            <div style={styles.hudSub}>{(liveMetrics.elapsedMs / 1000).toFixed(2)}s · {liveMetrics.distanceM.toFixed(1)}m</div>
            <button style={styles.stopBtn} onClick={finishRun}>종료</button>
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
          {reportData.reactionTimeMs != null && <ResultRow label="스타트 반응속도" value={`${reportData.reactionTimeMs}ms`} />}
          {reportData.deceleration && (
            <ResultRow label="감속·제동" value={`${reportData.deceleration.decelTimeMs}ms / ${reportData.deceleration.decelDistanceM}m`} />
          )}
          {reportData.turnCount > 0 && <ResultRow label="방향전환" value={`${reportData.turnCount}회`} />}
          <div style={styles.resultActions}>
            <button style={styles.textBtn} onClick={handleRetry}>다시 측정</button>
            <button style={styles.primaryBtn} onClick={handleSave} disabled={saveState === 'saving' || saveState === 'saved'}>
              {saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중...' : '저장'}
            </button>
            {onBack && <button style={styles.textBtn} onClick={onBack}>목록</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// camera 화면용 — 아직 조작 전, 위치만 대략 보여주는 정적(비반응) 가이드.
function StaticTrackGuide({ trackDistanceM, mode }) {
  const label = mode === 'agility' ? '왕복' : `${trackDistanceM}m`;
  return (
    <svg viewBox="0 0 100 100" style={styles.guideOverlay} preserveAspectRatio="none">
      <polygon points="15,82 85,82 65,45 35,45" fill="rgba(163,230,53,0.06)" stroke="rgba(163,230,53,0.4)" strokeWidth="0.6" strokeDasharray="2,2" />
      <text x="15" y="78" fontSize="4" fill="rgba(255,255,255,0.6)" textAnchor="middle">0m</text>
      <text x="85" y="78" fontSize="4" fill="rgba(255,255,255,0.6)" textAnchor="middle">{label}</text>
    </svg>
  );
}

// calibrate 화면용 — 실제 드래그 가능한 핸들 2개 + 연결선. 핸들 좌표(0~1)를
// 그대로 calibrateTrack()에 넘겨 실제 거리 스케일을 계산한다.
function DraggableTrackGuide({ points, trackDistanceM, mode, onHandleDown }) {
  const label = mode === 'agility' ? '왕복' : `${trackDistanceM}m`;
  const [a, b] = points;
  return (
    <>
      <svg viewBox="0 0 100 100" style={styles.guideOverlay} preserveAspectRatio="none">
        <line x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100} stroke="#a3e635" strokeWidth="0.8" strokeDasharray="2,2" />
      </svg>
      <DragHandle point={a} label="0m" color="#22d3ee" onPointerDown={onHandleDown(0)} />
      <DragHandle point={b} label={label} color="#f97316" onPointerDown={onHandleDown(1)} />
    </>
  );
}

function DragHandle({ point, label, color, onPointerDown }) {
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        touchAction: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'grab',
      }}
    >
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: color, border: '3px solid #fff', boxShadow: '0 0 0 4px rgba(0,0,0,0.25)' }} />
      <span style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '2px 6px', borderRadius: 8 }}>
        {label}
      </span>
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
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  guideOverlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  rotateBanner: { position: 'absolute', top: 10, left: 10, right: 10, textAlign: 'center', background: 'rgba(0,0,0,0.65)', borderRadius: 10, padding: '8px 10px', fontSize: 12.5 },
  centerPanel: { position: 'absolute', left: 0, right: 0, bottom: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  testPicker: { display: 'flex', gap: 6 },
  testBtn: { padding: '6px 12px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.8)', fontSize: 12.5 },
  testBtnActive: { background: '#fff', color: '#0b0f14', borderColor: '#fff', fontWeight: 600 },
  primaryBtn: { padding: '9px 20px', borderRadius: 18, background: '#22d3ee', color: '#0b0f14', fontWeight: 600, fontSize: 13.5, border: 'none' },
  textBtn: { padding: '9px 16px', borderRadius: 18, background: 'transparent', color: 'rgba(255,255,255,0.75)', border: 'none', fontSize: 13 },
  hintBar: { position: 'absolute', left: 0, right: 0, bottom: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  hintText: { fontSize: 13, background: 'rgba(0,0,0,0.5)', padding: '6px 12px', borderRadius: 14, textAlign: 'center' },
  calibConfirmRow: { display: 'flex', gap: 8 },
  countdownOverlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72, fontWeight: 700, color: '#22d3ee' },
  hud: { position: 'absolute', top: 14, left: 0, right: 0, textAlign: 'center' },
  hudMain: { fontSize: 32, fontWeight: 700 },
  hudSub: { fontSize: 13, opacity: 0.75, marginTop: 2 },
  stopBtn: { marginTop: 10, padding: '8px 18px', borderRadius: 16, background: '#ef4444', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600 },
  warning: { position: 'absolute', top: 10, left: 10, right: 10, padding: 8, background: 'rgba(0,0,0,0.65)', borderRadius: 8, fontSize: 12, textAlign: 'center' },
  resultPanel: { padding: 18, background: '#111827' },
  resultTitle: { marginBottom: 10, fontSize: 16 },
  resultRow: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 13.5 },
  resultLabel: { opacity: 0.65 },
  resultValue: { fontWeight: 600 },
  resultActions: { display: 'flex', gap: 8, marginTop: 16 },
};
