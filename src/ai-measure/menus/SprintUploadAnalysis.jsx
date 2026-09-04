// ai-measure/menus/SprintUploadAnalysis.jsx
//
// 스프린트/아질리티 — 고속촬영 영상 업로드 분석 모드.
// GaitUploadAnalysis.jsx(영상 업로드 → seek 분석 → onComplete) 의 구조와
// SprintLiveAnalysis.jsx(캘리브레이션 드래그 핸들 + SprintTracker) 의 캘리브레이션
// UI를 그대로 재사용한다 — 둘 다 sprintAgility.js / videoAnalyzer.js 를 공유.
//
// 실시간 모드와 다른 점: 카메라 스트림 대신 업로드된 영상을 seek 하며 분석하고,
// 골반이 화면 상에서 어느 방향으로 움직이는지(전진 부호)는 사용자가 두 캘리브레이션
// 점을 실제 0m→목표거리 순서로 찍는다고 가정한다(라이브 모드와 동일 규약).
//
// [범위 안내] 슬로모 프리셋(GaitUploadAnalysis와 동일)을 지원해 케이던스性
// 지표는 없지만 구간기록·속도가 실제 시간 기준으로 정확히 보정되도록 한다.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SprintTracker, calibrateTrack } from '../core/sprintAgility';
import { analyzeUploadedVideo, CAPTURE_PRESETS } from '../core/videoAnalyzer';

const TEST_TYPES = {
  sprint5: { label: '5m 스프린트', mode: 'sprint', splitDistancesM: [5], trackDistanceM: 5 },
  sprint10: { label: '10m 스프린트', mode: 'sprint', splitDistancesM: [5, 10], trackDistanceM: 10 },
  agility505: { label: '5-0-5 아질리티', mode: 'agility', splitDistancesM: [5], trackDistanceM: 5 },
};

// 캘리브레이션 핸들 기본 위치(화면 하단, 좌우로 벌어진 상태) — SprintLiveAnalysis와 동일 규약.
const DEFAULT_CALIB_POINTS = [{ x: 0.18, y: 0.82 }, { x: 0.82, y: 0.82 }];

export default function SprintUploadAnalysis({ member, onBack, onSaveToFirebase, onSave }) {
  const saveToFirebase = onSaveToFirebase || onSave;

  // idle(파일 선택) → ready(재생가능, 프레임 고르기) → calibrate(바닥 기준선) →
  // analyzing → done(결과) | error
  const [phase, setPhase] = useState('idle');
  const [testKey, setTestKey] = useState('sprint10');
  const [capture, setCapture] = useState('normal');
  const [calibPoints, setCalibPoints] = useState(DEFAULT_CALIB_POINTS);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [reportData, setReportData] = useState(null);
  const [saveState, setSaveState] = useState('idle');

  const videoRef = useRef(null);
  const dragAreaRef = useRef(null);
  const fileUrlRef = useRef(null);
  const abortRef = useRef(null);
  const draggingIndexRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setErrorMsg('영상 파일을 선택해 주세요.');
      return;
    }
    setErrorMsg('');
    setFileName(file.name);
    setCalibPoints(DEFAULT_CALIB_POINTS);
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    const v = videoRef.current;
    if (v) {
      v.src = url;
      v.onloadedmetadata = () => setPhase('ready');
    }
  };

  // ── 캘리브레이션 핸들 드래그 (SprintLiveAnalysis와 동일 로직) ──
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
  useEffect(() => () => onHandleUp(), []);

  const resetCalibration = () => setCalibPoints(DEFAULT_CALIB_POINTS);

  const runAnalysis = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const cfg = TEST_TYPES[testKey];
    const calibration = calibrateTrack(calibPoints[0], calibPoints[1], cfg.trackDistanceM);
    if (!calibration) {
      setErrorMsg('캘리브레이션에 실패했습니다. 두 핸들 간격을 넓혀주세요.');
      return;
    }

    setPhase('analyzing');
    setProgress(0);
    setErrorMsg('');

    const tracker = new SprintTracker({ calibration, splitDistancesM: cfg.splitDistancesM, mode: cfg.mode });
    const abort = new AbortController();
    abortRef.current = abort;
    const preset = CAPTURE_PRESETS[capture] || CAPTURE_PRESETS.normal;

    try {
      const result = await analyzeUploadedVideo({
        video,
        signal: abort.signal,
        targetFps: preset.targetFps,
        playbackRate: preset.playbackRate,
        onProgress: setProgress,
        onFrame: ({ landmarks, tMs }) => { tracker.push(landmarks, tMs); },
      });

      if (result.aborted) { setPhase('calibrate'); return; }

      const summary = tracker.finalize();
      const data = {
        ...summary,
        testKey,
        testLabel: cfg.label,
        source: 'upload',
        captureMode: capture,
        playbackRate: result.playbackRate,
        member: { id: member?.id || null, name: member?.name || null },
        measuredAt: new Date().toISOString(),
      };
      setReportData(data);
      setSaveState('idle');
      setPhase('done');
    } catch (e) {
      setErrorMsg(e?.message || '분석 중 오류가 발생했습니다.');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [member, testKey, capture, calibPoints]);

  const cancelAnalysis = () => { abortRef.current?.abort(); };

  const handleSave = async () => {
    if (!reportData || !saveToFirebase) return;
    setSaveState('saving');
    try {
      await saveToFirebase(reportData);
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setErrorMsg('저장에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleRetry = () => {
    setCalibPoints(DEFAULT_CALIB_POINTS);
    setReportData(null);
    setSaveState('idle');
    setErrorMsg('');
    setPhase('ready');
  };

  useEffect(() => () => {
    abortRef.current?.abort();
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
  }, []);

  const pct = Math.round(progress * 100);
  const cfg = TEST_TYPES[testKey];

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn}>← 뒤로</button>
        <h2 style={styles.headerTitle}>영상 업로드 분석</h2>
        <div style={{ width: 48 }} />
      </div>

      <div style={styles.videoWrap} ref={dragAreaRef}>
        <video
          ref={videoRef}
          style={styles.video}
          playsInline muted
          controls={phase === 'ready'}
        />

        {phase === 'calibrate' && (
          <>
            <svg viewBox="0 0 100 100" style={styles.guideOverlay} preserveAspectRatio="none">
              <line
                x1={calibPoints[0].x * 100} y1={calibPoints[0].y * 100}
                x2={calibPoints[1].x * 100} y2={calibPoints[1].y * 100}
                stroke="#a3e635" strokeWidth="0.8" strokeDasharray="2,2"
              />
            </svg>
            <DragHandle point={calibPoints[0]} label="0m" color="#22d3ee" onPointerDown={onHandleDown(0)} />
            <DragHandle point={calibPoints[1]} label={cfg.mode === 'agility' ? '왕복' : `${cfg.trackDistanceM}m`} color="#f97316" onPointerDown={onHandleDown(1)} />
          </>
        )}

        {phase === 'analyzing' && (
          <div style={styles.analyzingBadge}>분석 중…</div>
        )}
      </div>

      <div style={styles.panel}>
        {phase === 'idle' && (
          <label style={styles.primaryLabelBtn}>
            영상 파일 선택
            <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
          </label>
        )}

        {fileName && phase !== 'idle' && <p style={styles.fileName}>📁 {fileName}</p>}

        {phase === 'ready' && (
          <div style={styles.readyCol}>
            <p style={styles.hintText}>측정 종류를 고르고, 바닥 표시가 잘 보이는 구간으로 영상을 넘긴 뒤 기준선을 잡으세요.</p>

            <div>
              <p style={styles.smallLabel}>측정 종류</p>
              <div style={styles.pickerRow}>
                {Object.entries(TEST_TYPES).map(([k, c]) => (
                  <button key={k} onClick={() => setTestKey(k)}
                    style={{ ...styles.testBtn, ...(testKey === k ? styles.testBtnActive : {}) }}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p style={styles.smallLabel}>촬영 모드</p>
              <div style={styles.pickerRow}>
                {Object.entries(CAPTURE_PRESETS).map(([k, p]) => (
                  <button key={k} onClick={() => setCapture(k)}
                    style={{ ...styles.testBtn, ...(capture === k ? styles.testBtnActive : {}) }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <p style={styles.microHint}>폰 슬로모로 찍었다면 해당 배속을 선택하세요. 구간기록·속도가 실제 시간 기준으로 보정됩니다.</p>
            </div>

            <button style={styles.primaryBtn} onClick={() => setPhase('calibrate')}>바닥 기준선 잡기</button>
            <label style={styles.textLabelBtn}>
              다른 영상 선택
              <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
            </label>
          </div>
        )}

        {phase === 'calibrate' && (
          <div style={styles.readyCol}>
            <p style={styles.hintText}>초록 점을 바닥 0m·{cfg.mode === 'agility' ? '왕복' : `${cfg.trackDistanceM}m`} 표시로 밀어서 맞추세요</p>
            <div style={styles.calibConfirmRow}>
              <button style={styles.textBtn} onClick={resetCalibration}>가운데로 리셋</button>
              <button style={styles.primaryBtn} onClick={runAnalysis}>▶ 분석 시작</button>
            </div>
          </div>
        )}

        {phase === 'analyzing' && (
          <div style={styles.readyCol}>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressFill, width: `${pct}%` }} />
            </div>
            <p style={styles.progressText}>{pct}% 분석 중…</p>
            <p style={styles.microHint}>1280×720으로 다운스케일하여 처리 중입니다</p>
            <button style={styles.textBtn} onClick={cancelAnalysis}>취소</button>
          </div>
        )}

        {phase === 'done' && reportData && (
          <div style={styles.resultCol}>
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
            </div>
          </div>
        )}

        {(phase === 'error' || errorMsg) && phase !== 'analyzing' && (
          <div style={styles.errorCol}>
            <p style={styles.errorText}>{errorMsg}</p>
            <label style={styles.textLabelBtn}>
              다시 시도
              <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
            </label>
          </div>
        )}
      </div>
    </div>
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
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  backBtn: { background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: 700 },
  headerTitle: { fontSize: 15, fontWeight: 900, color: '#fff', margin: 0 },
  videoWrap: { position: 'relative', flex: '0 0 auto', height: '46vh', minHeight: 220, overflow: 'hidden', background: '#000' },
  video: { width: '100%', height: '100%', objectFit: 'contain' },
  guideOverlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  analyzingBadge: { position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 700, color: '#fbbf24' },
  panel: { flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  readyCol: { display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 420, alignItems: 'stretch' },
  hintText: { fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  smallLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', marginBottom: 6 },
  microHint: { fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 6 },
  pickerRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  testBtn: { padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700, flex: '1 1 auto' },
  testBtnActive: { background: '#f59e0b', color: '#0b0f14', borderColor: '#f59e0b' },
  primaryBtn: { padding: '10px 20px', borderRadius: 12, background: '#22d3ee', color: '#0b0f14', fontWeight: 800, fontSize: 13.5, border: 'none' },
  primaryLabelBtn: { cursor: 'pointer', borderRadius: 12, background: '#f59e0b', color: '#0b0f14', fontWeight: 800, padding: '12px 22px' },
  textBtn: { padding: '9px 16px', borderRadius: 12, background: 'transparent', color: 'rgba(255,255,255,0.7)', border: 'none', fontSize: 13 },
  textLabelBtn: { fontSize: 12, color: 'rgba(251,191,36,0.9)', textDecoration: 'underline', cursor: 'pointer', textAlign: 'center' },
  fileName: { fontSize: 11.5, color: 'rgba(255,255,255,0.5)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  calibConfirmRow: { display: 'flex', gap: 8, justifyContent: 'center' },
  progressTrack: { width: '100%', height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  progressFill: { height: '100%', background: '#f59e0b', transition: 'width 150ms' },
  progressText: { fontSize: 13, fontWeight: 700, color: '#fbbf24', textAlign: 'center' },
  resultCol: { width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 2 },
  resultTitle: { fontSize: 16, fontWeight: 900, marginBottom: 8 },
  resultRow: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 13.5 },
  resultLabel: { opacity: 0.65 },
  resultValue: { fontWeight: 700 },
  resultActions: { display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' },
  errorCol: { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' },
  errorText: { fontSize: 13, color: '#f87171', textAlign: 'center', maxWidth: 420 },
};
