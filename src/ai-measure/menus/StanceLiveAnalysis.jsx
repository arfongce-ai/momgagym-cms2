// ai-measure/menus/StanceLiveAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  한다리서기(SLST) 실시간 카메라 측정 — usePoseEngine.js(공유 훅) +
//  CameraStage.jsx(공유 카메라 셸)를 자세·ROM·VBT·1RM·리프팅과 동일하게 쓴다
//  (풀스크린 비디오+스켈레톤 오버레이, "✕ 닫기", 로딩/오류 처리는 CameraStage가
//  전담 — 이 화면은 topBar/controls 슬롯만 채운다). 캘리브레이션·시행 추적
//  로직은 업로드 모드(StanceUploadAnalysis)와 완전히 동일한
//  singleLegStanceTracker.js를 공유 — 화면(측정 방식)만 다르고 "카메라가 본
//  것을 숫자로 바꾸는" 두뇌는 하나다.
//
//  같은 다리로 최대 2회 시행을 연속으로 잡는다(발을 들면 자동 시작, 내리면
//  자동 종료 후 바로 다음 시행 대기). 균형 상실은 자동 추정 + 트레이너가
//  육안으로 보고 버튼으로 직접 표시하는 것 둘 다 지원한다.
//  ⚠ 이 화면은 실시간 수치 판정에 집중한다 — 자세/ROM처럼 영상을 녹화해
//  회원에게 공유하는 기능은 포함하지 않는다(스쿼트 라이브도 동일한 범위).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { StandingCalibrator, SingleLegStanceTracker } from '../core/singleLegStanceTracker';
import CameraStage from './CameraStage.jsx';

const LEG_KO = { left: '왼쪽', right: '오른쪽' };

// 자세·보행 모듈과 동일한 본(bone) 목록 — 상체 코어 + 양다리.
const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

function vis(p, threshold = 0.3) {
  return !!p && (p.visibility == null || p.visibility >= threshold);
}

// CameraStage는 비디오를 object-contain으로 그리므로(레터박스 생김), 스켈레톤도
// 같은 보정으로 그려야 좌표가 맞는다(RomMeasure.jsx의 objectContainMapper와 동일).
function objectContainMapper(video, width, height) {
  const vw = video?.videoWidth || width;
  const vh = video?.videoHeight || height;
  const scale = Math.min(width / vw, height / vh);
  const drawW = vw * scale, drawH = vh * scale;
  const ox = (width - drawW) / 2, oy = (height - drawH) / 2;
  return { x: (p) => ox + p.x * drawW, y: (p) => oy + p.y * drawH };
}

function drawSkeleton(canvas, video, landmarks, locked) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!landmarks) return;
  const { x: X, y: Y } = objectContainMapper(video, cw, ch);
  const col = locked ? 'rgba(52,211,153,0.95)' : 'rgba(34,211,238,0.95)';
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    const pa = landmarks[a], pb = landmarks[b];
    if (!vis(pa) || !vis(pb)) return;
    ctx.beginPath(); ctx.moveTo(X(pa), Y(pa)); ctx.lineTo(X(pb), Y(pb)); ctx.stroke();
  });
  ctx.fillStyle = locked ? 'rgba(52,211,153,1)' : 'rgba(255,255,255,0.95)';
  [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach((i) => {
    const p = landmarks[i];
    if (!vis(p)) return;
    ctx.beginPath(); ctx.arc(X(p), Y(p), 5, 0, Math.PI * 2); ctx.fill();
  });
}

export default function StanceLiveAnalysis({ member, stanceLeg, onBack, onComplete, onMemberHeightChange }) {
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [needHeight, setNeedHeight] = useState(!member?.height);
  const [heightInput, setHeightInput] = useState('');

  // calibrating | low_visibility | ready | holding | trial_done | finished
  const [uiPhase, setUiPhase] = useState('calibrating');
  const [calibProgress, setCalibProgress] = useState(0);
  const [holdMs, setHoldMs] = useState(0);
  const [trialsFound, setTrialsFound] = useState(0);
  const [lastTrialNote, setLastTrialNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const calibRef = useRef(null);
  const trackerRef = useRef(null);
  const lastTsRef = useRef(0);
  const canvasRef = useRef(null);
  const startedRef = useRef(false);

  const legLabel = LEG_KO[stanceLeg] || stanceLeg;

  const handleResult = useCallback((landmarks, ts, video) => {
    lastTsRef.current = ts;
    if (!calibRef.current) calibRef.current = new StandingCalibrator({ heightCm });
    const calib = calibRef.current;

    drawSkeleton(canvasRef.current, video, landmarks, calib.locked);
    if (!landmarks) return;

    if (!calib.locked) {
      calib.push(landmarks);
      const st = calib.status();
      if (st.ready) {
        trackerRef.current = new SingleLegStanceTracker(calib.result, stanceLeg);
        setUiPhase('ready');
      } else if (st.reason === 'low_visibility') {
        setUiPhase('low_visibility');
      } else {
        setUiPhase('calibrating');
        setCalibProgress(st.progress);
      }
      return;
    }

    const tracker = trackerRef.current;
    if (!tracker || tracker.trials.length >= tracker.maxTrials) return;

    const beforeCount = tracker.trials.length;
    tracker.push(landmarks, ts);

    if (tracker.phase === 'holding') {
      setUiPhase('holding');
      setHoldMs(tracker.elapsedHoldMs(ts));
    } else if (tracker.trials.length > beforeCount) {
      const t = tracker.trials[tracker.trials.length - 1];
      setLastTrialNote(t.stepOut ? '조기 종료(스텝아웃)로 기록됨' : '정상 종료로 기록됨');
      setTrialsFound(tracker.trials.length);
      setUiPhase(tracker.trials.length >= tracker.maxTrials ? 'finished' : 'trial_done');
    } else {
      setUiPhase('ready');
    }
  }, [heightCm, stanceLeg]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  useEffect(() => {
    if (!needHeight && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needHeight]);

  useEffect(() => {
    if (status === 'error' && error) setErrorMsg(error);
  }, [status, error]);

  const markBalanceLoss = () => trackerRef.current?.markBalanceLoss();

  const stopCurrentHold = () => {
    trackerRef.current?.stopManually(lastTsRef.current);
    const tracker = trackerRef.current;
    if (tracker) {
      const t = tracker.trials[tracker.trials.length - 1];
      setLastTrialNote(t?.stepOut ? '조기 종료(스텝아웃)로 기록됨' : '정상 종료로 기록됨');
      setTrialsFound(tracker.trials.length);
      setUiPhase(tracker.trials.length >= tracker.maxTrials ? 'finished' : 'trial_done');
    }
  };

  const finishAndSubmit = async () => {
    const tracker = trackerRef.current;
    const calib = calibRef.current;
    if (!tracker) return;
    tracker.finalize(lastTsRef.current);
    const summary = tracker.summary({ cmPerNormUnit: calib?.result?.scaleCmPerY ?? null });
    stop();
    if (!summary.trial1) {
      setErrorMsg('유효한 유지 시행이 없습니다. 발을 드는 동작이 카메라에 잘 보이는지 확인하고 다시 시도해 주세요.');
      return;
    }
    if (typeof onComplete === 'function') await onComplete(summary);
  };

  const applyHeight = () => {
    const h = Number(heightInput);
    if (!h || h < 80 || h > 250) { setErrorMsg('키를 80~250cm로 입력하세요.'); return; }
    setHeightCm(h); setNeedHeight(false); setErrorMsg('');
    onMemberHeightChange?.(h);
  };

  if (needHeight) {
    return (
      <div className="absolute inset-0 bg-slate-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
          <h2 className="text-white font-black">한다리서기 · {legLabel} 지지</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키가 필요합니다</p>
              <p className="text-slate-400 text-xs">흔들림 거리(cm) 환산에 사용됩니다.</p>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold text-slate-500">키</span>
              <div className="flex items-center gap-2">
                <input type="number" inputMode="numeric" value={heightInput}
                  onChange={e => setHeightInput(e.target.value)} placeholder="170"
                  className="min-w-0 flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                <span className="text-slate-400 text-xs font-bold">cm</span>
              </div>
            </label>
            <button onClick={applyHeight} className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95">
              입력하고 계속
            </button>
            {errorMsg && <p className="text-center text-xs text-red-400">{errorMsg}</p>}
          </div>
        </div>
      </div>
    );
  }

  const secs = (holdMs / 1000).toFixed(1);

  const topBar = (
    <>
      <p className="text-sm font-black text-white">{legLabel} 지지</p>
      {uiPhase === 'calibrating' && <p className="text-xs font-bold text-amber-300">자세 보정 중… {Math.round(calibProgress * 100)}%</p>}
      {uiPhase === 'low_visibility' && <p className="text-xs font-bold text-red-300">전신이 보이도록 서 주세요</p>}
      {uiPhase === 'ready' && <p className="text-xs font-bold text-emerald-300">반대쪽 발을 들어 시작</p>}
      {uiPhase === 'trial_done' && <p className="text-xs font-bold text-emerald-300">{trialsFound}차 완료 — {lastTrialNote}</p>}
      {uiPhase === 'finished' && <p className="text-xs font-bold text-emerald-300">2회 모두 완료 — {lastTrialNote}</p>}
      {errorMsg && <p className="text-xs font-bold text-red-300">{errorMsg}</p>}
    </>
  );

  const controls = (
    <>
      {uiPhase === 'holding' && (
        <>
          <button onClick={markBalanceLoss}
            className="rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-black text-xs px-4 py-2.5 active:scale-95">
            ⚠ 균형 상실
          </button>
          <button onClick={stopCurrentHold}
            className="rounded-full bg-emerald-500 text-slate-950 font-black text-xs px-4 py-2.5 active:scale-95">
            ✓ 목표 도달, 종료
          </button>
        </>
      )}
      {uiPhase === 'trial_done' && (
        <button onClick={finishAndSubmit}
          className="rounded-full bg-slate-700 text-white font-bold text-xs px-4 py-2.5 active:scale-95">
          1차만으로 측정 마치기
        </button>
      )}
      {uiPhase === 'finished' && (
        <button onClick={finishAndSubmit}
          className="rounded-full bg-emerald-500 text-slate-950 font-black text-xs px-5 py-2.5 active:scale-95">
          측정 완료 →
        </button>
      )}
    </>
  );

  return (
    <CameraStage
      videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
      onClose={onBack} tappable={false} showSkeletonToggle
      topBar={topBar} controls={controls}
      recording={uiPhase === 'holding'} recordingLabel={`유지 중 · ${secs}초`}
    />
  );
}
