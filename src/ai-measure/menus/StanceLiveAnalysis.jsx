// ai-measure/menus/StanceLiveAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  한다리서기(SLST) 실시간 카메라 측정 — usePoseEngine.js(공유 훅)를 그대로
//  사용한다. 캘리브레이션·시행 추적 로직은 업로드 모드(StanceUploadAnalysis)와
//  완전히 동일한 singleLegStanceTracker.js를 공유 — 화면(측정 방식)만 다르고
//  "카메라가 본 것을 숫자로 바꾸는" 두뇌는 하나다.
//
//  같은 다리로 최대 2회 시행을 연속으로 잡는다(발을 들면 자동 시작, 내리면
//  자동 종료 후 바로 다음 시행 대기). 균형 상실은 자동 추정 + 트레이너가
//  육안으로 보고 버튼으로 직접 표시하는 것 둘 다 지원한다.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { StandingCalibrator, SingleLegStanceTracker } from '../core/singleLegStanceTracker';

const LEG_KO = { left: '왼쪽', right: '오른쪽' };

export default function StanceLiveAnalysis({ member, stanceLeg, onBack, onComplete, onMemberHeightChange }) {
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [needHeight, setNeedHeight] = useState(!member?.height);
  const [heightInput, setHeightInput] = useState('');

  // calibrating | low_visibility | ready | holding | trial_done | finished | error
  const [uiPhase, setUiPhase] = useState('calibrating');
  const [calibProgress, setCalibProgress] = useState(0);
  const [holdMs, setHoldMs] = useState(0);
  const [trialsFound, setTrialsFound] = useState(0);
  const [lastTrialNote, setLastTrialNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const calibRef = useRef(null);
  const trackerRef = useRef(null);
  const lastTsRef = useRef(0);
  const startedRef = useRef(false);

  const legLabel = LEG_KO[stanceLeg] || stanceLeg;

  const handleResult = useCallback((landmarks, ts) => {
    lastTsRef.current = ts;
    if (!landmarks) return;
    if (!calibRef.current) calibRef.current = new StandingCalibrator({ heightCm });
    const calib = calibRef.current;

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
      // 방금 시행 하나가 종료됨
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
    if (status === 'error' && error) { setErrorMsg(error); setUiPhase('error'); }
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
      setUiPhase('error');
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
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
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

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
        <h2 className="text-white font-black">한다리서기 · {legLabel} 지지 (실시간)</h2>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col items-center justify-center gap-5">
        <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-black aspect-[3/4]">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-xs font-black backdrop-blur">
            {uiPhase === 'calibrating' && <span className="text-amber-300">자세 보정 중… {Math.round(calibProgress * 100)}%</span>}
            {uiPhase === 'low_visibility' && <span className="text-red-300">전신이 보이도록 서 주세요</span>}
            {uiPhase === 'ready' && <span className="text-emerald-300">{legLabel} 발 반대쪽을 들어 시작</span>}
            {uiPhase === 'holding' && <span className="text-amber-300">유지 중 · {secs}초</span>}
            {uiPhase === 'trial_done' && <span className="text-emerald-300">{trialsFound}차 완료</span>}
            {uiPhase === 'finished' && <span className="text-emerald-300">2회 모두 완료</span>}
          </div>
        </div>

        {heightCm && <p className="text-[11px] text-emerald-400">회원 키 {heightCm}cm로 흔들림 거리를 환산합니다</p>}

        {uiPhase === 'holding' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <p className="text-4xl font-black tabular-nums text-amber-300">{secs}초</p>
            <div className="flex gap-2 w-full">
              <button onClick={markBalanceLoss}
                className="flex-1 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 font-black py-3">
                ⚠ 균형 상실 표시
              </button>
              <button onClick={stopCurrentHold}
                className="flex-1 rounded-xl bg-emerald-500 text-slate-950 font-black py-3">
                ✓ 목표 도달, 종료
              </button>
            </div>
          </div>
        )}

        {uiPhase === 'trial_done' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <p className="text-sm text-emerald-300 font-bold">✓ {trialsFound}차 시행 완료 — {lastTrialNote}</p>
            <p className="text-sm text-slate-300 text-center">이어서 {legLabel} 발 반대쪽을 다시 들면 2차 시행이 자동으로 시작됩니다.</p>
            <button onClick={finishAndSubmit}
              className="w-full rounded-xl bg-slate-700 text-white font-bold py-3">
              1차만으로 측정 마치기
            </button>
          </div>
        )}

        {uiPhase === 'finished' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <p className="text-sm text-emerald-300 font-bold">✓ 2회 시행 모두 완료 — {lastTrialNote}</p>
            <button onClick={finishAndSubmit}
              className="w-full rounded-xl bg-emerald-500 text-slate-950 font-black py-3.5">
              측정 완료 → 다음
            </button>
          </div>
        )}

        {uiPhase === 'ready' && (
          <p className="text-sm text-slate-300 text-center max-w-md">
            {legLabel} 다리로 지지하고 반대쪽 발을 들어 버텨보세요. 발이 뜨는 순간 자동으로 측정이 시작됩니다.
          </p>
        )}

        {(uiPhase === 'error' || errorMsg) && (
          <p className="text-sm text-red-400 text-center max-w-md">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
