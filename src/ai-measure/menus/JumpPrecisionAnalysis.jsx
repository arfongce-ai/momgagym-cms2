// ai-measure/menus/JumpPrecisionAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  점프 정밀 측정 (라이브) — 보행&러닝(GaitRunningAnalysis)과 동일 수준의 UX
//   · BlazePose 스켈레톤 오버레이로 인식 상태를 눈으로 확인
//   · 서 있는 자세 캘리브레이션(키 자동 보정) → 점프 검출 → 비행시간 높이
//   · 골반 변위 교차검증(±오차) + 키 sanity → valid 플래그로 무효 측정 차단
//   · 유효 측정만 자동 저장 (gait 와 동일한 저장 흐름)
//
//  요구사항 매핑:
//   [1] 측정 시작 시 member.height 로 px↔cm 스케일 자동 산출 (StandingCalibrator)
//   [2] 상단에 "회원 키(000cm)로 자동 보정 중..." 표시 / 키 없으면 입력 팝업
//   [3] 서 있는 자세 불안정(가시성↓·흔들림↑)이면 "올바르게 서 주세요" → 측정 차단
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from 'react';
import {
  StandingCalibrator, JumpFlightTracker,
} from '../core/jumpBiomechanics';
import { calcJump } from '../core/performance';
import { loadPoseLandmarker, detectPoseFrame, isPoseReady } from '../core/poseBackend';

// 캘리브레이션 안정 유지 시간(깜빡임 방지). 충분히 서 있으면 거의 즉시 락.
const POSE_BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [0, 11], [0, 12], // 머리~어깨 (전신 프레이밍 확인용)
];

function drawSkeleton(canvas, video, landmarks, phase) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!landmarks) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  const px = (p) => ox + p.x * dw;
  const py = (p) => oy + p.y * dh;
  // 색상: 캘리브 중=시안, 측정 준비=초록, 공중=앰버
  const col = phase === 'air' ? 'rgba(251,191,36,0.95)'
    : phase === 'ready' ? 'rgba(52,211,153,0.95)'
    : 'rgba(34,211,238,0.95)';
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [a, b] of POSE_BONES) {
    const pa = landmarks[a], pb = landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.visibility != null && pa.visibility < 0.3) || (pb.visibility != null && pb.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.moveTo(px(pa), py(pa)); ctx.lineTo(px(pb), py(pb)); ctx.stroke();
  }
  ctx.fillStyle = phase === 'ready' || phase === 'air' ? col : 'rgba(255,255,255,0.95)';
  for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28, 31, 32]) {
    const p = landmarks[i];
    if (!p || (p.visibility != null && p.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.arc(px(p), py(p), 5, 0, Math.PI * 2); ctx.fill();
  }
}

// 캘리브 기준선을 화면에 가로선으로 표시 (사용자 피드백)
function drawBaseline(canvas, video, baselineFeetY) {
  if (!canvas || !video || baselineFeetY == null) return;
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(cw / vw, ch / vh);
  const dh = vh * scale;
  const oy = (ch - dh) / 2;
  const y = oy + baselineFeetY * dh;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(52,211,153,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  ctx.setLineDash([]);
}

export default function JumpPrecisionAnalysis({ member, onBack, onSaveToFirebase, onSave, onMemberHeightChange }) {
  const saveToFirebase = onSaveToFirebase || onSave;

  const [view, setView] = useState('camera');     // camera | preview
  const [phase, setPhase] = useState('arming');    // arming | low_visibility | ready | air
  const [calibMsg, setCalibMsg] = useState('');
  const [reportData, setReportData] = useState(null);
  const [poseLoaded, setPoseLoaded] = useState(false);
  const [warning, setWarning] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error
  const [jumpCount, setJumpCount] = useState(0);

  // 키 입력 팝업 (요구사항 2 예외처리)
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [needHeight, setNeedHeight] = useState(!member?.height);
  const [heightInput, setHeightInput] = useState('');

  const videoRef = useRef(null);
  const skeletonCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const reqFrameRef = useRef(null);
  const lastTsRef = useRef(0);
  const viewRef = useRef('camera');
  const phaseRef = useRef('arming');

  const calibRef = useRef(null);     // StandingCalibrator
  const trackerRef = useRef(null);   // JumpFlightTracker
  const heightRef = useRef(heightCm);
  const autoSavedRef = useRef(null);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { heightRef.current = heightCm; }, [heightCm]);

  // 카메라 생명주기
  useEffect(() => {
    if (view === 'camera' && !streamRef.current && !needHeight) startCamera();
    else if (view === 'preview') stopCamera();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, needHeight]);

  useEffect(() => () => stopCamera(), []);

  const resetPipeline = () => {
    calibRef.current = new StandingCalibrator({ heightCm: heightRef.current });
    trackerRef.current = null;
    setPhase('arming');
    setJumpCount(0);
    setReportData(null);
    setSaveState('idle');
    autoSavedRef.current = null;
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      loadPoseLandmarker({ numPoses: 1, modelTier: 'full' })
        .then(() => setPoseLoaded(true))
        .catch((e) => { setPoseLoaded(false); setWarning(e?.message || 'AI 분석 모듈 로드 실패'); });
      resetPipeline();
      startVisionPipeline();
    } catch (err) {
      setWarning('카메라 권한을 허용해주세요.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); reqFrameRef.current = null; }
  };

  const startVisionPipeline = () => {
    if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current);
    let lastPhase = null, lastMsg = null;
    const setPhaseOnce = (v) => { if (v !== lastPhase) { lastPhase = v; setPhase(v); } };
    const setMsgOnce = (v) => { if (v !== lastMsg) { lastMsg = v; setCalibMsg(v); } };
    let lastCount = 0;

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

      const calib = calibRef.current;
      const tracker = trackerRef.current;

      // 스켈레톤 + 기준선
      try {
        const ph = tracker ? (tracker.inAir ? 'air' : 'ready') : 'arming';
        drawSkeleton(skeletonCanvasRef.current, video, landmarks, ph);
        if (calib?.result) drawBaseline(skeletonCanvasRef.current, video, calib.result.baselineFeetY);
      } catch (e) { /* noop */ }

      if (landmarks && viewRef.current === 'camera') {
        if (!calib.locked) {
          // ── 캘리브레이션 단계 ──
          calib.push(landmarks);
          const st = calib.status();
          if (st.ready) {
            // 락 완료 → 트래커 생성, 측정 준비
            trackerRef.current = new JumpFlightTracker(calib.result);
            trackerRef.current.calibHeightCm = heightRef.current;
            setPhaseOnce('ready');
            setMsgOnce('');
          } else if (st.reason === 'low_visibility') {
            // 요구사항 3: 자세 불안정 → 측정 차단 경고
            setPhaseOnce('low_visibility');
            setMsgOnce('올바르게 서 주세요 — 전신이 보이도록 카메라 앞에 똑바로 서세요');
          } else {
            setPhaseOnce('arming');
            setMsgOnce(`자세 보정 중... ${Math.round(st.progress * 100)}%`);
          }
        } else {
          // ── 측정 단계 ──
          tracker.push(landmarks, ts);
          setPhaseOnce(tracker.inAir ? 'air' : 'ready');
          const c = tracker.flights.length;
          if (c !== lastCount) { lastCount = c; setJumpCount(c); }
        }
      } else if (viewRef.current === 'camera') {
        if (!calib?.locked) {
          setPhaseOnce('arming');
          setMsgOnce(isPoseReady()
            ? '전신(머리~발)이 화면에 들어오게 해주세요'
            : 'AI 분석 모듈 로딩 중...');
        }
      }

      reqFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  // 측정 종료 → 결과 산출
  const finishMeasure = () => {
    const tracker = trackerRef.current;
    if (!tracker) { setWarning('아직 보정이 끝나지 않았습니다.'); return; }
    const sum = tracker.summary({ heightCm: heightRef.current });
    // performance.calcJump 로 파워(Sayers)까지 일관 산출 (체중 있으면)
    const power = calcJump(sum.flightTimeSec, member?.weight);
    const report = {
      ...sum,
      heightCm: sum.heightCm,
      takeoffVelocity: sum.takeoffVelocity,
      peakPower: power?.peakPower ?? null,
      calibHeightCm: heightRef.current,
      source: 'live',
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    };
    setReportData(report);
    setView('preview');
    stopCamera();
    // 유효 측정만 자동 저장 (gait 와 동일 철학)
    if (report.valid === true && saveToFirebase && autoSavedRef.current !== report.measuredAt) {
      autoSavedRef.current = report.measuredAt;
      autoSave(report);
    }
  };

  const autoSave = async (report) => {
    setSaveState('saving');
    try { await saveToFirebase(report); setSaveState('saved'); }
    catch (e) { setSaveState('error'); }
  };

  const handleManualSave = async () => {
    if (!reportData || reportData.valid !== true || !saveToFirebase) return;
    await autoSave(reportData);
  };

  const retry = () => { setView('camera'); };

  const applyHeight = () => {
    const n = Number(heightInput);
    if (!n || n < 80 || n > 250) { setWarning('키를 80~250cm로 입력하세요.'); return; }
    setHeightCm(n);
    heightRef.current = n;
    setNeedHeight(false);
    onMemberHeightChange?.(n);
    setWarning('');
  };

  // ── 키 입력 팝업 (요구사항 2 예외) ──
  if (needHeight) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
          <h2 className="text-white font-black">점프 정밀 측정</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키 정보가 필요합니다</p>
              <p className="text-slate-400 text-xs leading-relaxed">
                {member?.name ? `${member.name} 회원의 ` : ''}키가 등록되어 있지 않습니다.
                cm 환산(자동 보정)에 필요하니 지금 입력해 주세요.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" inputMode="numeric" value={heightInput}
                onChange={e => setHeightInput(e.target.value)} placeholder="예: 170"
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
              <span className="text-slate-400 text-sm font-bold">cm</span>
            </div>
            <button onClick={applyHeight}
              className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95">
              입력하고 측정 시작
            </button>
            {warning && <p className="text-center text-xs text-red-400">{warning}</p>}
          </div>
        </div>
      </div>
    );
  }

  const phaseColor = phase === 'air' ? 'text-amber-400'
    : phase === 'ready' ? 'text-emerald-400'
    : phase === 'low_visibility' ? 'text-red-400' : 'text-cyan-400';

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      {view === 'camera' && (
        <div className="relative w-full h-full">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          <canvas ref={skeletonCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

          {/* 헤더 */}
          <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
            <button onClick={onBack} className="text-white font-bold text-sm">← 뒤로</button>
            <h2 className="text-white font-black text-sm">점프 정밀 측정</h2>
            <div className="w-12" />
          </div>

          {/* 요구사항 2: 자동 보정 안내 배너 */}
          <div className="absolute top-[max(52px,calc(env(safe-area-inset-top)+52px))] inset-x-0 flex justify-center px-4">
            <div className="rounded-full bg-black/60 backdrop-blur px-4 py-1.5 border border-white/10">
              {phase === 'ready' || phase === 'air' ? (
                <p className="text-xs font-bold text-emerald-300">
                  ✓ 회원 키({heightCm}cm)로 보정 완료 — 점프하세요
                </p>
              ) : phase === 'low_visibility' ? (
                <p className="text-xs font-bold text-red-300">⚠ 올바르게 서 주세요</p>
              ) : (
                <p className="text-xs font-bold text-cyan-200">
                  회원 키({heightCm}cm)로 자동 보정 중...
                </p>
              )}
            </div>
          </div>

          {/* 상태/가이드 */}
          <div className="absolute top-[max(92px,calc(env(safe-area-inset-top)+92px))] left-4 bg-black/55 backdrop-blur rounded-xl px-3 py-2">
            <p className={`text-sm font-black ${phaseColor}`}>
              {phase === 'air' ? '🛫 공중' : phase === 'ready' ? '준비됨' : phase === 'low_visibility' ? '자세 불안정' : '보정 중'}
            </p>
            {calibMsg && <p className="text-white text-[11px] mt-0.5">{calibMsg}</p>}
            {(phase === 'ready' || phase === 'air') && (
              <p className="text-amber-300 text-[11px] mt-0.5">감지된 점프: {jumpCount}회</p>
            )}
          </div>

          {warning && (
            <div className="absolute top-1/2 inset-x-6 -translate-y-1/2 bg-red-500/90 text-white text-center rounded-xl px-4 py-3 font-bold text-sm">
              {warning}
            </div>
          )}

          {/* 하단 컨트롤 */}
          <div className="absolute bottom-[max(24px,calc(env(safe-area-inset-bottom)+24px))] inset-x-0 flex flex-col items-center gap-3">
            <p className="text-white/70 text-xs px-6 text-center">
              보정선(초록 점선)에 발을 맞추고 서세요 → 점프 → 같은 자리에 착지 → [측정 완료]
            </p>
            <button
              onClick={finishMeasure}
              disabled={jumpCount < 1}
              className={`rounded-full px-8 py-4 font-black text-base shadow-lg transition
                ${jumpCount >= 1 ? 'bg-emerald-500 text-slate-950 active:scale-95' : 'bg-white/20 text-white/50'}`}>
              ✓ 측정 완료 {jumpCount >= 1 ? `(${jumpCount}회)` : ''}
            </button>
          </div>
        </div>
      )}

      {view === 'preview' && reportData && (
        <JumpReport
          report={reportData}
          saveState={saveState}
          onSave={handleManualSave}
          onRetry={retry}
          onBack={onBack}
        />
      )}
    </div>
  );
}

// ── 리포트 화면 ──
function JumpReport({ report, saveState, onSave, onRetry, onBack }) {
  const grade = report.valid
    ? report.heightCm >= 50 ? { label: '매우 우수', color: 'text-blue-400' }
    : report.heightCm >= 40 ? { label: '우수', color: 'text-emerald-400' }
    : report.heightCm >= 30 ? { label: '보통', color: 'text-amber-400' }
    : { label: '개선 필요', color: 'text-red-400' }
    : null;

  const cc = report.crossCheck || {};
  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <button onClick={onRetry} className="text-slate-300 font-bold text-sm">← 다시 측정</button>
        <h2 className="text-white font-black">측정 리포트</h2>
        <button onClick={onBack} className="text-slate-400 text-sm font-bold">닫기</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {report.valid !== true ? (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-5 text-center space-y-2">
            <p className="text-3xl">⚠</p>
            <p className="text-red-400 font-black">측정 무효</p>
            <p className="text-slate-300 text-sm">
              {report.reason === 'no_jump' ? '점프 동작이 감지되지 않았습니다.'
                : report.reason === 'cross_mismatch' ? `두 측정 방식의 차이가 큽니다(${cc.deltaPct}%). 카메라를 골반 높이로 고정하고 제자리에서 수직으로 점프해 다시 측정하세요.`
                : report.reason === 'sanity_fail' ? '측정값이 키 대비 비현실적입니다. 카메라 각도/위치를 확인하고 다시 측정하세요.'
                : '측정이 무효합니다. 다시 시도해 주세요.'}
            </p>
          </div>
        ) : (
          <>
            <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">점프 높이</p>
                <p className={`text-sm font-bold ${grade.color}`}>{grade.label}</p>
              </div>
              <p className="text-center font-mono font-black text-6xl text-slate-100">
                {report.heightCm}<span className="text-xl text-slate-500"> cm</span>
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="체공시간" value={`${report.flightTimeMs}ms`} />
                <Stat label="이륙속도" value={`${report.takeoffVelocity} m/s`} />
                <Stat label="최고파워" value={report.peakPower != null ? `${report.peakPower}W` : '체중 미입력'} />
              </div>
            </div>

            {/* 교차검증 신뢰도 카드 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-bold text-slate-300">측정 신뢰도 (교차검증)</p>
              <div className="grid grid-cols-2 gap-2 text-center text-sm">
                <div className="bg-slate-800 rounded-xl py-2">
                  <p className="text-[10px] text-slate-500">비행시간 기반</p>
                  <p className="font-mono font-bold text-slate-100">{report.heightCm} cm</p>
                </div>
                <div className="bg-slate-800 rounded-xl py-2">
                  <p className="text-[10px] text-slate-500">골반변위 기반</p>
                  <p className="font-mono font-bold text-slate-100">
                    {cc.heightCrossCm != null ? `${cc.heightCrossCm} cm` : '—'}
                  </p>
                </div>
              </div>
              {cc.agree != null && (
                <p className={`text-center text-xs font-bold ${cc.agree ? 'text-emerald-400' : 'text-red-400'}`}>
                  {cc.agree ? `✓ 두 방식 일치 (오차 ${cc.deltaPct}%)` : `✗ 불일치 (오차 ${cc.deltaPct}%)`}
                </p>
              )}
              <p className="text-[10px] text-slate-500 text-center">
                회원 키({report.calibHeightCm}cm) 기준 자동 보정 · 감지된 점프 {report.jumps}회 중 최고값
              </p>
            </div>
          </>
        )}

        <div className="space-y-2">
          {report.valid === true && (
            <button onClick={onSave}
              disabled={saveState === 'saving' || saveState === 'saved'}
              className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 disabled:opacity-60 flex items-center justify-center gap-2">
              {saveState === 'saving' && <span className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />}
              {saveState === 'saved' ? '✓ 자동 저장됨' : saveState === 'saving' ? '저장 중...' : saveState === 'error' ? '↻ 다시 저장' : '💾 회차 기록'}
            </button>
          )}
          <button onClick={onRetry} className="w-full rounded-xl border border-slate-700 text-slate-200 font-bold py-3">
            다시 측정
          </button>
          {saveState === 'saved' && <p className="text-center text-xs text-emerald-400">측정이 서버에 자동 저장되었습니다.</p>}
          {saveState === 'error' && <p className="text-center text-xs text-red-400">자동 저장 실패 — 위 버튼으로 다시 시도하세요</p>}
          {report.valid !== true && <p className="text-center text-xs text-amber-400">무효 측정은 저장되지 않습니다.</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-800 rounded-xl py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="font-mono font-bold text-slate-200 text-sm">{value}</p>
    </div>
  );
}
