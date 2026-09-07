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
//   - 스톱워치·메트로놈 도구 서랍
//   - 필요해지면 GaitRunningAnalysis.jsx의 해당 부분을 옮겨오면 된다.
//
// [영상 다시보기 2026-09-07] GaitRunningAnalysis.jsx는 포즈 오버레이를 캔버스에
// 합성해 녹화하지만(별도 15초 녹화 창), 스프린트는 이미 "큐 → 종료"로 구간이
// 명확해 그 구간 동안 카메라 원본 스트림(streamRef)을 MediaRecorder로 그대로
// 녹화한다 — 캔버스 합성 없이 더 단순하게. 화면 전용(recordedBlobRef)이며
// storagePolicy.videoStored:false 정책과 동일하게 Firestore/Storage에는 저장하지 않는다.

import React, { useState, useEffect, useRef } from 'react';
import { SprintTracker, calibrateTrack } from '../core/sprintAgility';
import { beepTick, beepGo, primeAudio } from '../core/audioCue';
import { loadPoseLandmarker, detectPoseFrame, isPoseReady, closePoseLandmarker } from '../core/poseBackend';
import { openMainCameraStream, describeCameraError } from '../core/cameraSelect';
import { pickRecorderMime } from '../core/recordSink';
import { aiStore } from '../../demoData';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';
import SprintReportDashboard from './SprintReportDashboard.jsx';

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
  // [가로모드 감지 2026-09-07 수정] innerWidth/innerHeight 실측을 1순위로 삼는다.
  // matchMedia('orientation: landscape')만 쓰면 일부 안드로이드 Chrome/WebView에서
  // orientationchange 이벤트가 실제 리사이즈보다 먼저 발생해 치수가 갱신되기 전
  // 값을 읽는 경우가 있어, 이벤트 이후 살짝 지연(150ms)해서 한 번 더 재확인한다.
  // 그래도 안 바뀐다면 기기 자체의 "자동 회전" 잠금이 원인일 가능성이 크다
  // (앱 코드가 아니라 OS 설정 — 빠른설정에서 자동회전 켜져 있는지 확인 필요).
  const getIsLandscape = () => {
    if (typeof window === 'undefined') return true;
    if (typeof window.innerWidth === 'number' && typeof window.innerHeight === 'number' && window.innerHeight > 0) {
      return window.innerWidth > window.innerHeight;
    }
    if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
    return true;
  };
  const [isLandscape, setIsLandscape] = useState(getIsLandscape);
  useEffect(() => {
    let retryTimer = null;
    const onChange = () => {
      setIsLandscape(getIsLandscape());
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => setIsLandscape(getIsLandscape()), 150);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener('change', onChange);
    }
    return () => {
      clearTimeout(retryTimer);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.removeEventListener('change', onChange);
      }
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
  // [직전 측정 비교 2026-09-07] SprintUploadAnalysis.jsx와 동일 패턴 —
  // GaitAnalysisHub.jsx의 previousReport를 라이브 모드에도 이식.
  const [previousReport, setPreviousReport] = useState(null);

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
  // [영상 다시보기 2026-09-07] GaitRunningAnalysis.jsx의 mediaRecorderRef/chunksRef/
  // recordedBlobRef와 동일한 역할.
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordedBlobRef = useRef(null);

  useEffect(() => { viewRef.current = view; }, [view]);

  // calibrate 화면 진입할 때마다 핸들 기본 위치로 리셋(직전 측정에서 옮긴 채 남지 않게)
  useEffect(() => {
    if (view === 'calibrate') setCalibPoints(DEFAULT_CALIB_POINTS);
  }, [view]);

  useEffect(() => {
    // [기록·확인 단계 2026-09-07] 측정 종료 직후(record)부터 카메라를 끈다 —
    // 예전엔 result까지 켜둔 채였는데, 이제 record 화면이 그 사이에 끼어들어
    // 그대로 두면 저장 확인하는 동안 카메라가 계속 돈다.
    if (view !== 'result' && view !== 'record' && !streamRef.current) startCamera();
    if (view === 'result' || view === 'record') stopCamera();
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

  // [영상 다시보기 2026-09-07] 큐(출발 신호) 순간부터 카메라 원본 스트림을
  // 그대로 녹화한다. GaitRunningAnalysis.jsx처럼 캔버스에 포즈 오버레이를 합성하지
  // 않는 이유: 스프린트는 트랙 전체가 프레임 안에 들어와야 해서 오버레이보다
  // "원본을 다시 보며 육안으로 자세를 확인"하는 쓰임이 크다.
  const startRecording = () => {
    if (typeof MediaRecorder === 'undefined' || !streamRef.current) return;
    try {
      chunksRef.current = [];
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        recordedBlobRef.current = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: mime || 'video/webm' })
          : null;
      };
      mediaRecorderRef.current = rec;
      rec.start();
    } catch (e) {
      // 녹화 실패는 측정 자체를 막지 않는다 — 다시보기 영상만 없을 뿐.
      mediaRecorderRef.current = null;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  useEffect(() => {
    if (view !== 'countdown') return undefined;
    if (countdown <= 0) {
      const cueTs = performance.now();
      beepGo();
      trackerRef.current?.markCue(cueTs);
      startRecording();
      setView('running');
      return undefined;
    }
    beepTick();
    cueTimerRef.current = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(cueTimerRef.current);
  }, [view, countdown]);

  const finishRun = () => {
    if (!trackerRef.current) return;
    stopRecording();
    const summary = trackerRef.current.finalize();
    setReportData({
      ...summary,
      testKey,
      testLabel: TEST_TYPES[testKey].label,
      source: 'live',
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    });
    // [기록·확인 단계 2026-09-07] 측정 직후 바로 결과+저장 버튼을 보여주던 것을
    // 다른 탭(Gait 등)과 동일하게 '기록' 단계(MeasureRecordConfirm)로 바꾼다.
    setView('record');
  };

  // [기록·확인 단계 2026-09-07] SprintUploadAnalysis.jsx와 동일 — 확인·저장을
  // 눌러야 실제 Firestore에 쓴다.
  const handleConfirmRecord = async (record) => {
    if (!reportData || !saveToFirebase) return;
    const withNote = { ...reportData, note: record?.note || '' };
    setReportData(withNote);
    setSaveState('saving');
    try {
      const res = await saveToFirebase(withNote);
      const saved = (res && typeof res === 'object') ? { ...withNote, ...res } : withNote;
      setReportData(saved);
      setSaveState('saved');
      setView('result');
    } catch (e) {
      setSaveState('error');
      setWarningMsg('저장에 실패했습니다. 다시 시도해주세요.');
    }
  };

  // [직전 측정 비교 2026-09-07] 저장 성공 후 같은 회원·같은 testKey의 직전 기록을
  // 하나 불러온다(GaitAnalysisHub.jsx:38-54, SprintUploadAnalysis.jsx와 동일 패턴).
  useEffect(() => {
    let cancelled = false;
    if (saveState !== 'saved' || !reportData?.id || !member?.id || member?.isVirtual) return undefined;
    (async () => {
      try {
        const list = await aiStore.ensureGaitReports(member.id);
        if (cancelled) return;
        const matching = (list || []).filter((r) => r.testKey === reportData.testKey && r.id !== reportData.id);
        const sorted = matching.sort((a, b) => String(b.createdAt || b.measuredAt || '')
          .localeCompare(String(a.createdAt || a.measuredAt || '')));
        setPreviousReport(sorted[0] || null);
      } catch (e) {
        if (!cancelled) setPreviousReport(null);
      }
    })();
    return () => { cancelled = true; };
  }, [saveState, reportData?.id, reportData?.testKey, member?.id, member?.isVirtual]);

  const handleRetry = () => {
    setCalibPoints(DEFAULT_CALIB_POINTS);
    setReportData(null);
    setSaveState('idle');
    setPreviousReport(null);
    trackerRef.current = null;
    recordedBlobRef.current = null;
    chunksRef.current = [];
    setView('camera');
  };

  // [기록·확인 단계 2026-09-07] GaitAnalysisHub.jsx의 view==='record' 화면과
  // 동일한 위치·역할 — 측정 직후, 실제 저장 전에 메모를 남기고 확인한다.
  if (view === 'record' && reportData) {
    const rows = [{ label: '총 소요시간', value: `${(reportData.totalTimeMs / 1000).toFixed(2)}초` }];
    if (reportData.peakVelocityMs != null) rows.push({ label: '최고속도', value: `${reportData.peakVelocityMs.toFixed(1)} m/s` });
    if (reportData.reactionTimeMs != null) rows.push({ label: '반응속도', value: `${reportData.reactionTimeMs}ms` });
    return (
      <div style={{ ...styles.root, overflowY: 'auto' }}>
        <div style={{ maxWidth: 420, margin: '0 auto', padding: 16, width: '100%' }}>
          <MeasureRecordConfirm
            title={reportData.testLabel}
            summaryRows={rows}
            noteMode
            onConfirm={handleConfirmRecord}
            onBack={handleRetry}
            saving={saveState === 'saving'}
            saved={saveState === 'saved'}
            error={saveState === 'error'}
          />
        </div>
      </div>
    );
  }

  // [스프린트 전용 결과리포트 대시보드 2026-09-07] SprintUploadAnalysis.jsx와
  // 동일 — 저장 완료 후 SprintReportDashboard로 결과를 보여준다. videoBlob은
  // 큐~종료 구간 카메라 원본 녹화본(화면 전용).
  if (view === 'result' && reportData) {
    return (
      <div style={{ ...styles.root, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px 0' }}>
          {onBack && <button style={styles.textBtn} onClick={onBack}>닫기</button>}
        </div>
        <SprintReportDashboard
          report={reportData}
          previousReport={previousReport}
          videoBlob={recordedBlobRef.current}
          member={member}
        />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px 24px' }}>
          <button style={styles.primaryBtn} onClick={handleRetry}>다시 측정</button>
        </div>
      </div>
    );
  }

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
    </div>
  );
}

// [트랙 가이드 비주얼 리뉴얼 2026-09-07] Metric Sprint 앱류 AR 트랙 오버레이
// 느낌으로 정리 — 좁아지는 원근 코리더 + 미터 눈금 + 필 배지 라벨. 좌표 로직
// (calibrateTrack에 넘기는 handle 위치, viewBox 0~100 기준)은 손대지 않았고
// 순수 표현만 바꿨다. 두 컴포넌트가 공유하는 시각 톤: 앰버(#f97316)를 트랙의
// 주 색으로, 0m 지점은 시안(#22d3ee)으로 구분.
const TRACK_AMBER = '#f97316';
const TRACK_CYAN = '#22d3ee';

// camera 화면용 — 아직 조작 전, 위치만 대략 보여주는 정적(비반응) 가이드.
function StaticTrackGuide({ trackDistanceM, mode }) {
  const label = mode === 'agility' ? '왕복' : `${trackDistanceM}m`;
  const ticks = mode === 'agility' ? [0, 1] : Array.from({ length: trackDistanceM + 1 }, (_, i) => i / trackDistanceM);
  // 사다리꼴 코너: 하단(가까운 쪽) 넓게, 상단(먼 쪽) 좁게 — t(0~1)로 좌우 x, y를 보간.
  const laneAt = (t) => ({ xL: 15 + (35 - 15) * t, xR: 85 - (85 - 65) * t, y: 82 - (82 - 45) * t });
  const near = laneAt(0);
  const far = laneAt(1);
  return (
    <>
      <svg viewBox="0 0 100 100" style={styles.guideOverlay} preserveAspectRatio="none">
        <defs>
          <linearGradient id="trackFade" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgba(249,115,22,0.14)" />
            <stop offset="100%" stopColor="rgba(249,115,22,0.02)" />
          </linearGradient>
        </defs>
        <polygon
          points={`${near.xL},${near.y} ${near.xR},${near.y} ${far.xR},${far.y} ${far.xL},${far.y}`}
          fill="url(#trackFade)" stroke="rgba(249,115,22,0.55)" strokeWidth="0.5"
        />
        {/* 중앙 러닝라인 */}
        <line x1={50} y1={near.y} x2={50} y2={far.y} stroke="rgba(255,255,255,0.35)" strokeWidth="0.35" strokeDasharray="1.6,1.6" />
        {/* 미터 눈금 */}
        {ticks.map((t, i) => {
          const p = laneAt(t);
          return <line key={i} x1={p.xL} y1={p.y} x2={p.xR} y2={p.y} stroke="rgba(249,115,22,0.5)" strokeWidth="0.4" />;
        })}
      </svg>
      <TrackBadge x={(near.xL + near.xR) / 2} y={near.y} text="0m" color={TRACK_CYAN} />
      <TrackBadge x={(far.xL + far.xR) / 2} y={far.y} text={label} color={TRACK_AMBER} />
    </>
  );
}

// 거리 라벨용 필 배지 — SVG <text>보다 폰트 렌더링이 또렷해 HTML로 얹는다.
function TrackBadge({ x, y, text, color }) {
  return (
    <div style={{
      position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, 6px)',
      fontSize: 12, fontWeight: 800, color: '#fff', background: 'rgba(10,12,16,0.72)',
      padding: '3px 10px', borderRadius: 10, border: `1px solid ${color}66`,
      fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      {text}
    </div>
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
        <defs>
          <linearGradient id="calibLine" x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={TRACK_CYAN} />
            <stop offset="100%" stopColor={TRACK_AMBER} />
          </linearGradient>
        </defs>
        <line x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100} stroke="url(#calibLine)" strokeWidth="0.9" strokeLinecap="round" opacity="0.9" />
        {[0.25, 0.5, 0.75].map((t) => (
          <circle key={t} cx={a.x * 100 + (b.x - a.x) * 100 * t} cy={a.y * 100 + (b.y - a.y) * 100 * t} r="0.6" fill="rgba(255,255,255,0.7)" />
        ))}
      </svg>
      <DragHandle point={a} label="0m" color={TRACK_CYAN} onPointerDown={onHandleDown(0)} />
      <DragHandle point={b} label={label} color={TRACK_AMBER} onPointerDown={onHandleDown(1)} />
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
      {/* 이중 링 — 바깥은 은은한 글로우, 안쪽은 실제 손잡이 */}
      <div style={{ position: 'relative', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1.5px solid ${color}`, opacity: 0.4 }} />
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: color, border: '3px solid #fff', boxShadow: `0 2px 10px ${color}99` }} />
      </div>
      <span style={{
        marginTop: 2, fontSize: 12, fontWeight: 800, letterSpacing: 0.2, color: '#fff',
        background: 'rgba(10,12,16,0.72)', padding: '3px 9px', borderRadius: 10,
        border: `1px solid ${color}55`, fontVariantNumeric: 'tabular-nums',
      }}>
        {label}
      </span>
    </div>
  );
}

// [비주얼 리뉴얼 2026-09-07] Metric Sprint류 프로 카메라 앱 톤(글래스 패널 +
// 앰버 액센트 + 타이트한 타이포)으로 정리. 레이아웃 위치·클릭 핸들러는 그대로 두고
// 색·굵기·블러·라운딩만 다듬었다.
const glass = { background: 'rgba(10,12,16,0.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' };

const styles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: '#0b0f14', color: '#fff' },
  videoWrap: { position: 'relative', flex: 1, overflow: 'hidden' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  guideOverlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  rotateBanner: {
    position: 'absolute', top: 10, left: 10, right: 10, textAlign: 'center', ...glass,
    borderRadius: 14, padding: '9px 12px', fontSize: 12.5, fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
  },
  centerPanel: { position: 'absolute', left: 0, right: 0, bottom: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  testPicker: { display: 'flex', gap: 6, padding: 4, borderRadius: 20, ...glass, border: '1px solid rgba(255,255,255,0.08)' },
  testBtn: { padding: '7px 14px', borderRadius: 16, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 600, letterSpacing: 0.1 },
  testBtnActive: { background: TRACK_AMBER, color: '#0b0f14', fontWeight: 800, boxShadow: '0 2px 10px rgba(249,115,22,0.5)' },
  primaryBtn: {
    padding: '11px 26px', borderRadius: 22, background: `linear-gradient(135deg, ${TRACK_AMBER}, #fb923c)`,
    color: '#0b0f14', fontWeight: 800, fontSize: 14, border: 'none', letterSpacing: 0.2,
    boxShadow: '0 6px 18px rgba(249,115,22,0.4)',
  },
  textBtn: { padding: '9px 16px', borderRadius: 18, background: 'transparent', color: 'rgba(255,255,255,0.75)', border: 'none', fontSize: 13, fontWeight: 600 },
  hintBar: { position: 'absolute', left: 0, right: 0, bottom: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  hintText: {
    fontSize: 12.5, fontWeight: 600, ...glass, padding: '7px 14px', borderRadius: 14, textAlign: 'center',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  calibConfirmRow: { display: 'flex', gap: 8 },
  countdownOverlay: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 88, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums',
    textShadow: `0 0 40px ${TRACK_AMBER}, 0 4px 24px rgba(0,0,0,0.6)`,
  },
  hud: {
    position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', textAlign: 'center',
    ...glass, borderRadius: 20, padding: '10px 24px', border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
  },
  hudMain: { fontSize: 32, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: TRACK_AMBER },
  hudSub: { fontSize: 12.5, opacity: 0.8, marginTop: 2, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  stopBtn: {
    marginTop: 10, padding: '8px 22px', borderRadius: 16, background: '#ef4444', color: '#fff',
    border: 'none', fontSize: 13, fontWeight: 800, boxShadow: '0 4px 14px rgba(239,68,68,0.45)',
  },
  warning: {
    position: 'absolute', top: 10, left: 10, right: 10, padding: '8px 12px', ...glass, borderRadius: 12,
    fontSize: 12, fontWeight: 600, textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)',
  },
};
