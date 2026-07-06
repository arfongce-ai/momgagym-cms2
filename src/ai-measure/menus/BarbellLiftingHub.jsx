// ai-measure/menus/BarbellLiftingHub.jsx
// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅 통합 탭 — 세 측정을 한 메뉴에서 유기적으로.
//   mode='lifting' → LiftingMeasure   (역도 · 바벨 엔드캡 궤적 추적)
//   mode='vbt'     → VbtMeasure       (속도 기반 트레이닝)
//   mode='onerm'   → OneRMEstimate    (3대 운동 카메라 · 1RM 추정)
//
//  설계(측정 정직성 · 근거기반):
//   - 상단에 [역도/VBT/1RM] 모드 선택기를 두고, 1RM은 3대 운동 카메라로 바로 진입.
//   - 저장은 Hub 가 단일 책임으로 처리: 각 모듈의 onSave 페이로드를 표준
//     exerciseType + source + metrics 규약(buildLiftingPayload)으로 변환.
//   - peakVelocity 는 lifting.js 의 게이트로 고속영상에서만 채워진다.
//   - 별도 컬렉션을 새로 파지 않고 기존 'ai' + unifiedReport 흐름을 그대로 사용
//     (점프/보행/자세/ROM 과 동일) — 통합 리포트·카카오 공유·이력에 자연 합류.
//   - JumpAnalysisHub 패턴을 그대로 따른다(검증된 구조 재사용).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import LiftingMeasure from './LiftingMeasure';
import VbtMeasure from './VbtMeasure';
import OneRMEstimate from './OneRMEstimate';
import LiftingUploadAnalysis from './LiftingUploadAnalysis';
import LiftingReportDashboard from './LiftingReportDashboard';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';
import { useHardwareBack } from '../core/useHardwareBack';
import {
  exercisesForMode, lift1rmToExercise,
  vbtConfidence, estimateMeanPower, buildLiftingPayload, detectMeasurementOutlier,
} from '../core/lifting';
import { buildLoadVelocityPoint } from '../core/loadVelocityProfile';

const MODES = [
  ['lifting', '🏋️ 역도'],
  ['vbt',     '⚡ VBT'],
  ['onerm',   '💪 1RM'],
];

// 랜딩 카드 메타 — 모드별 색·설명(UX 재설계: 탭 → 대형 카드 선택).
const MODE_META = {
  lifting: {
    icon: '🏋️', title: '역도 궤적', accent: 'from-rose-500 to-orange-500',
    ring: 'ring-rose-400/60', desc: '스내치·클린&저크 바 경로 실시간 분석 — 수평 이탈·경로 효율·속도',
  },
  vbt: {
    icon: '⚡', title: 'VBT 속도', accent: 'from-cyan-400 to-sky-500',
    ring: 'ring-cyan-400/60', desc: '렙별 평균속도 게이지 · 속도저하(%)로 세트 종료 시점 판단',
  },
  onerm: {
    icon: '💪', title: '1RM 추정', accent: 'from-amber-400 to-orange-500',
    ring: 'ring-amber-400/60', desc: '무게×반복 공식 7종 평균 + 카메라 속도 교차검증',
  },
};
const STRENGTH_EXERCISES = exercisesForMode('onerm');

export default function BarbellLiftingHub({ member, onBack, onSave, onSaveToFirebase, onMemberHeightChange }) {
  const save = onSaveToFirebase || onSave;
  const [mode, setMode] = useState('lifting');
  // 공통 종목 — 모드 전환 시 해당 모드에서 유효하면 유지, 아니면 첫 항목으로.
  // 기본 모드가 역도(lifting)이므로 초기 종목도 역도 첫 종목(스내치).
  const [exerciseType, setExerciseType] = useState(() => exercisesForMode('lifting')[0]?.key || 'snatch');
  const [showGuide, setShowGuide] = useState(false);
  const [cameraStartSignal, setCameraStartSignal] = useState(1);
  const [vbtCameraStartSignal, setVbtCameraStartSignal] = useState(0);
  const [oneRmCameraStartSignal, setOneRmCameraStartSignal] = useState(0);
  // 측정 방식 — 역도/VBT만. 'live'(실시간 추적) | 'upload'(고속영상 슬로모 분석).
  const [captureMode, setCaptureMode] = useState('live');
  // 측정 완료 후 표시할 리포트.
  const [report, setReport] = useState(null);
  // 통일 흐름(UX 재설계): landing(모드 선택) → measure → record(기록·확인) → report
  const [view, setView] = useState('landing'); // landing | measure | record | report
  const [pending, setPending] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  // [항목 2] 폰 뒤로가기: report/record → measure, measure → landing 한 단계씩 복귀.
  useHardwareBack(!!report || view === 'record' || view === 'measure', () => {
    if (report || view === 'record') { setReport(null); setPending(null); setView('measure'); return; }
    setView('landing');
  });
  const backToLanding = useCallback(() => setView('landing'), []);
  const sessionHistoryRef = useRef(null);

  // ── 오버레이 겹침 수정 ──
  //  상단 모드/종목/촬영방식 선택 바의 실제 렌더 높이를 측정해 자식 카메라
  //  스테이지에 topOffset 으로 내려주면, CameraStage 의 ✕닫기·안내칩 줄이 그
  //  아래로 밀려 겹치지 않는다.
  const hubBarRef = useRef(null);
  const [hubBarHeight, setHubBarHeight] = useState(0);
  useLayoutEffect(() => {
    const el = hubBarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height;
      if (typeof h === 'number') setHubBarHeight(Math.ceil(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, showGuide]);
  const camTopOffset = hubBarHeight ? hubBarHeight + 6 : 0;

  // ── 회원 신체정보 연동(요구사항 4) ──
  //  키·몸무게는 회원 신체정보에서 자동 연동. 미등록(키 없음)이면 점프&RSI 처럼
  //  첫 화면에서 키·몸무게를 먼저 받고, 이후 카메라/측정으로 진입한다.
  const [bodyHeight, setBodyHeight] = useState(member?.height ? Number(member.height) : null);
  const [bodyWeight, setBodyWeight] = useState(member?.weight ? Number(member.weight) : null);
  // 등록 회원이고 키가 있으면 게이트 통과. 미등록이거나 키 없으면 선등록 화면.
  const [needBody, setNeedBody] = useState(!member?.height);
  const [heightInput, setHeightInput] = useState(member?.height ? String(member.height) : '');
  const [weightInput, setWeightInput] = useState(member?.weight ? String(member.weight) : '');
  const [bodyError, setBodyError] = useState('');

  // 각 측정 모듈에 내려줄, 신체정보가 보강된 member 객체.
  const memberWithBody = useMemo(() => ({
    ...(member || {}),
    height: bodyHeight ?? member?.height ?? null,
    weight: bodyWeight ?? member?.weight ?? null,
  }), [member, bodyHeight, bodyWeight]);

  const applyBody = useCallback(() => {
    const h = Number(heightInput);
    const w = weightInput ? Number(weightInput) : null;
    if (!h || h < 100 || h > 230) { setBodyError('키를 100~230cm 범위로 입력하세요.'); return; }
    if (w != null && (w < 25 || w > 250)) { setBodyError('몸무게를 25~250kg 범위로 입력하세요.'); return; }
    setBodyHeight(h);
    setBodyWeight(w);
    setBodyError('');
    onMemberHeightChange?.(h);
    setNeedBody(false);
  }, [heightInput, weightInput, onMemberHeightChange]);

  const modeExercises = useMemo(() => {
    if (mode === 'onerm') return STRENGTH_EXERCISES;
    return exercisesForMode(mode);
  }, [mode]);

  const vbtExtraExercises = useMemo(() => (
    exercisesForMode('vbt').filter(e => !STRENGTH_EXERCISES.some(s => s.key === e.key))
  ), []);

  // 랜딩용 — 카메라 신호 없이 모드·종목 유효성만 갱신.
  const switchModeQuiet = useCallback((next) => {
    setMode(next);
    const nextExercises = next === 'onerm' ? STRENGTH_EXERCISES : exercisesForMode(next);
    if (!nextExercises.some(e => e.key === exerciseType)) {
      setExerciseType(nextExercises[0]?.key || 'squat');
    }
    if (next === 'onerm') setCaptureMode('live');
  }, [exerciseType]);

  const switchMode = useCallback((next) => {
    setMode(next);
    const nextExercises = next === 'onerm' ? STRENGTH_EXERCISES : exercisesForMode(next);
    const valid = nextExercises.some(e => e.key === exerciseType);
    if (!valid) setExerciseType(nextExercises[0]?.key || 'squat');
    if (next === 'lifting') {
      setCaptureMode('live');
      setCameraStartSignal(v => v + 1);
    }
    // 상단 탭 선택 시 실시간 카메라로 바로 진입한다.
    if (next === 'vbt') {
      setCaptureMode('live');
      setVbtCameraStartSignal(v => v + 1);
    }
    if (next === 'onerm') {
      setCaptureMode('live');
      setOneRmCameraStartSignal(v => v + 1);
    }
  }, [exerciseType]);

  // 랜딩 → 측정 진입. 실시간이면 해당 모드 카메라 자동 시작 신호 발화.
  const startFromLanding = useCallback(() => {
    if (captureMode === 'live' || mode === 'onerm') {
      if (mode === 'lifting') setCameraStartSignal(v => v + 1);
      if (mode === 'vbt') setVbtCameraStartSignal(v => v + 1);
      if (mode === 'onerm') setOneRmCameraStartSignal(v => v + 1);
    }
    setView('measure');
  }, [mode, captureMode]);

  const selectExercise = useCallback((nextExercise) => {
    setExerciseType(nextExercise);
  }, []);

  // 측정완료 → 기록·확인 단계로 스테이징(즉시 저장하지 않음). 확인 시 실제 저장.
  const saveAndReport = useCallback((payload, reportExtras = {}) => {
    setPending({ payload, reportExtras });
    setSaveState('idle');
    setView('record');
    return payload;
  }, []);

  // 확인 시 실제 저장 + 리포트
  const persist = useCallback(async (record = {}) => {
    if (!pending) return;
    const base = record.note ? { ...pending.payload, note: record.note } : pending.payload;
    const outlierWarning = detectMeasurementOutlier(base, sessionHistoryRef.current);
    const nextPayload = outlierWarning.isOutlier ? { ...base, outlierWarning } : base;
    let saved = nextPayload;
    setSaveState('saving');
    try {
      const res = await save?.(nextPayload);
      if (res && typeof res === 'object') saved = { ...nextPayload, ...res };
      setSaveState('saved');
    } catch (e) { setSaveState('error'); }
    sessionHistoryRef.current = saved;
    setReport({ ...saved, ...pending.reportExtras });
    setView('report');
  }, [pending, save]);

  // 고속영상 분석은 이미 완성된 표준 페이로드를 넘겨주므로 그대로 저장+리포트.
  const handleUploadComplete = useCallback(async (rep) => {
    return saveAndReport(rep);
  }, [saveAndReport]);

  // ── 저장 래퍼: 각 모듈의 raw 페이로드 → 표준 페이로드로 변환 후 상위 저장 ──
  const handleSaveLifting = useCallback(async (raw) => {
    // LiftingMeasure raw: { type:'lifting', romRatio, romCm, durationSec,
    //                       meanVelocity, heightCm, weight, barKg, sidePlates, source? }
    const source = raw?.source || 'live';
    const loadVelocityPoint = buildLoadVelocityPoint({
      exerciseType,
      weight: raw?.weight,
      meanVelocity: raw?.repVelocity?.summary?.averageMeanVelocity ?? raw?.meanVelocity,
      repVelocity: raw?.repVelocity,
      reps: raw?.reps,
      source,
    });
    const conf = vbtConfidence({
      isCalibrated: raw?.isCalibrated === true || !!raw?.heightCm,
      lostRatio: raw?.lostRatio,
      durationSec: raw?.durationSec,
      source,
      romCm: raw?.romCm,
      crossValidation: raw?.crossValidation || null,   // 다중 신호 교차검증 → 신뢰도 반영
    });
    const payload = buildLiftingPayload({
      mode: 'lifting',
      exerciseType,
      source,
      metrics: {
        meanVelocity: raw?.meanVelocity ?? null,
        peakVelocity: raw?.peakVelocity ?? null,       // 고속영상 모듈만 채움
        peakReason: raw?.peakReason ?? (source === 'upload' ? 'ok' : 'live_fps_too_low'),
        rangeOfMotion: raw?.romCm ?? null,
        meanPower: estimateMeanPower(raw?.weight, raw?.meanVelocity),
        confidenceScore: conf.score,
        velocityLoss: raw?.velocityLoss ?? raw?.repVelocity?.summary?.velocityLossPct ?? null,
      },
      metadata: {
        weight: raw?.weight ?? null,
        isCalibrated: raw?.isCalibrated === true || !!raw?.heightCm,
        heightCm: raw?.heightCm ?? null,
        calibration: raw?.calibration ?? null,
        calibrationSource: raw?.calibrationSource ?? raw?.calibration?.source ?? null,
        reps: raw?.reps ?? null,
        repVelocity: raw?.repVelocity ?? null,
        loadVelocityPoint,
        barKg: raw?.barKg ?? null,
        sidePlates: raw?.sidePlates ?? null,
        confidenceReasons: conf.reasons,
      },
      extra: {
        romRatio: raw?.romRatio ?? null,
        durationSec: raw?.durationSec ?? null,
        crossValidation: raw?.crossValidation ?? null,   // 교차검증 요약 보존
        cogGap: raw?.cogGap ?? null,                       // 바-COG 이격(측면시)
        barPath: raw?.barPath ?? null,                     // 궤적 드리프트/효율(엔진)
        consistencyCvPct: raw?.consistencyCvPct ?? null,   // 렙 일관성(CV%)
      },
    });
    return saveAndReport(payload, { videoBlob: raw?.videoBlob ?? null });
  }, [exerciseType, saveAndReport]);

  const handleSaveVbt = useCallback(async (raw) => {
    // VbtMeasure raw: { type:'vbt', distance, time, meanVelocity, zone,
    //                   heightCm, weight, barKg, sidePlates, source? }
    const source = raw?.source || 'live';
    const loadVelocityPoint = buildLoadVelocityPoint({
      exerciseType,
      weight: raw?.weight,
      meanVelocity: raw?.repVelocity?.summary?.averageMeanVelocity ?? raw?.meanVelocity,
      repVelocity: raw?.repVelocity,
      reps: raw?.reps,
      source,
    });
    const conf = vbtConfidence({
      isCalibrated: raw?.isCalibrated === true || !!raw?.heightCm,
      lostRatio: raw?.lostRatio,
      durationSec: raw?.time,
      source,
      romCm: raw?.romCm,
      crossValidation: raw?.crossValidation || null,   // 다중 신호 교차검증 → 신뢰도 반영(역도와 동일)
    });
    const payload = buildLiftingPayload({
      mode: 'vbt',
      exerciseType,
      source,
      metrics: {
        meanVelocity: raw?.meanVelocity ?? null,
        peakVelocity: raw?.peakVelocity ?? null,
        peakReason: raw?.peakReason ?? (source === 'upload' ? 'ok' : 'live_fps_too_low'),
        rangeOfMotion: raw?.romCm ?? null,
        meanPower: estimateMeanPower(raw?.weight, raw?.meanVelocity),
        velocityLoss: raw?.velocityLoss ?? raw?.repVelocity?.summary?.velocityLossPct ?? null,
        confidenceScore: conf.score,
      },
      metadata: {
        weight: raw?.weight ?? null,
        isCalibrated: raw?.isCalibrated === true || !!raw?.heightCm,
        heightCm: raw?.heightCm ?? null,
        calibration: raw?.calibration ?? null,
        calibrationSource: raw?.calibrationSource ?? raw?.calibration?.source ?? null,
        reps: raw?.reps ?? null,
        repVelocity: raw?.repVelocity ?? null,
        loadVelocityPoint,
        zone: raw?.zone ?? null,
        weightSource: raw?.weightSource ?? null,
        distanceM: raw?.distance ?? null,
        timeSec: raw?.time ?? null,
        barKg: raw?.barKg ?? null,
        sidePlates: raw?.sidePlates ?? null,
        confidenceReasons: conf.reasons,
      },
      extra: {
        crossValidation: raw?.crossValidation ?? null,   // 교차검증 요약 보존(역도와 동일)
        cogGap: raw?.cogGap ?? null,                       // 바-COG 이격(측면시)
        barPath: raw?.barPath ?? null,                     // 궤적 드리프트/효율(엔진)
        consistencyCvPct: raw?.consistencyCvPct ?? null,   // 렙 일관성(CV%)
      },
    });
    return saveAndReport(payload, { videoBlob: raw?.videoBlob ?? null });
  }, [exerciseType, saveAndReport]);

  const handleSaveOneRm = useCallback(async (raw) => {
    // OneRMEstimate raw: { lift, liftLabel, weight, reps, oneRM, epley, brzycki,
    //   formulas, estimateStats, barKg, sidePlates, weightSource, attemptNo, attempts, bestOneRM }
    // 1RM은 내부 lift('bench')를 표준 exerciseType('bench_press')로 매핑해 저장.
    const exType = lift1rmToExercise(raw?.lift) || exerciseType;
    const r = Number(raw?.reps) || 0;
    // 반복수 기반 신뢰도(근거): 1~6 높음, 7~10 보통, 그 이상 낮음.
    const spreadPct = Number(raw?.formulaSpreadPct ?? raw?.estimateStats?.spreadPct);
    let conf = r >= 1 && r <= 6 ? 0.9 : r <= 10 ? 0.75 : 0.55;
    if (Number.isFinite(spreadPct) && spreadPct > 10) conf -= spreadPct > 15 ? 0.20 : 0.10;
    conf = Math.max(0.35, Math.round(conf * 100) / 100);
    const payload = buildLiftingPayload({
      mode: 'onerm',
      exerciseType: exType,
      source: 'manual',  // 1RM은 무게·반복 입력 기반(영상 보조). 항상 manual 산출.
      metrics: {
        oneRM: raw?.oneRM ?? null,
        confidenceScore: conf,
      },
      metadata: {
        weight: raw?.weight ?? null,
        isCalibrated: raw?.weightSource === 'manual' || raw?.weightSource === 'dial',
        reps: raw?.reps ?? null,
        weightSource: raw?.weightSource ?? null,
        estimateStats: raw?.estimateStats ?? null,
        confidenceInterval: raw?.confidenceInterval ?? null,
        formulaSpreadKg: raw?.formulaSpreadKg ?? null,
        formulaSpreadPct: raw?.formulaSpreadPct ?? null,
        barKg: raw?.barKg ?? null,
        sidePlates: raw?.sidePlates ?? null,
        attemptNo: raw?.attemptNo ?? null,        // 이번이 몇 차 도전인지
        bestOneRM: raw?.bestOneRM ?? null,        // 누적 최고 1RM
        bestAttemptNo: raw?.bestAttemptNo ?? null,
        velocityCheck: raw?.velocityCheck ?? null,          // 속도 기반 e1RM 교차검증
        measuredMeanVelocity: raw?.measuredMeanVelocity ?? null,
      },
      extra: {
        epley: raw?.epley ?? null,
        brzycki: raw?.brzycki ?? null,
        formulas: raw?.formulas ?? null,
        attempts: raw?.attempts ?? null,          // 전체 도전 기록(리포트용)
      },
    });
    return saveAndReport(payload, { videoBlob: raw?.videoBlob ?? null });
  }, [exerciseType, saveAndReport]);

  // ── 신체정보 선등록 게이트(미등록·키 없음) — 점프&RSI 패턴 ──
  if (needBody) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col" style={{ height: '100dvh' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
          <h2 className="text-white font-black">바벨 리프팅</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키와 몸무게를 입력하세요</p>
              <p className="text-slate-400 text-xs">바벨 cm 환산·속도·파워 계산에 사용됩니다. 입력 후 바로 측정으로 들어갑니다.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-slate-500">키</span>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="numeric" value={heightInput}
                    onChange={e => setHeightInput(e.target.value)} placeholder="170"
                    className="min-w-0 flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                  <span className="text-slate-400 text-xs font-bold">cm</span>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-slate-500">몸무게(선택)</span>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" value={weightInput}
                    onChange={e => setWeightInput(e.target.value)} placeholder="70"
                    className="min-w-0 flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                  <span className="text-slate-400 text-xs font-bold">kg</span>
                </div>
              </label>
            </div>
            <button onClick={applyBody}
              className="w-full h-13 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black py-3.5 active:scale-[0.98] shadow-xl shadow-amber-500/25">
              입력하고 시작하기 →
            </button>
            {bodyError && <p className="text-center text-xs text-red-400">{bodyError}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── 측정완료 → 기록·확인 단계 ──
  if (view === 'record' && pending) {
    const p = pending.payload || {};
    const rows = [];
    if (p.oneRM != null) rows.push({ label: '1RM(추정)', value: `${p.oneRM}kg` });
    if (p.meanVelocity != null) rows.push({ label: '평균속도', value: `${p.meanVelocity}m/s` });
    if (p.romCm != null) rows.push({ label: 'ROM', value: `${p.romCm}cm` });
    if (p.barKg != null) rows.push({ label: '중량', value: `${p.barKg}kg` });
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="max-w-md mx-auto p-4">
          <MeasureRecordConfirm
            title="바벨 리프팅"
            summaryRows={rows}
            noteMode
            onConfirm={persist}
            onBack={() => { setPending(null); setView('measure'); }}
            saving={saveState === 'saving'}
            saved={saveState === 'saved'}
            error={saveState === 'error'}
          />
        </div>
      </div>
    );
  }

  // ── 측정 완료 리포트 ──
  if (report) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <LiftingReportDashboard report={report} onClose={onBack} />
        <div className="sticky bottom-0 z-10 flex justify-center p-3 bg-slate-900/90 backdrop-blur border-t border-slate-800">
          <button onClick={() => { setReport(null); setPending(null); setView('landing'); }} className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-sm px-8 py-2.5 active:scale-95">← 다시 측정</button>
        </div>
      </div>
    );
  }

  // ── 랜딩(모드 선택) — UX 재설계: 카메라 진입 전 대형 카드로 측정을 고른다 ──
  if (view === 'landing') {
    const meta = MODE_META[mode];
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        {/* 배경 그라디언트 오브 */}
        <div className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute top-1/3 -left-20 w-80 h-80 rounded-full bg-amber-500/10 blur-3xl" />

        <div className="relative max-w-md mx-auto px-4 pb-10" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
          {/* 헤더 */}
          <div className="flex items-center justify-between pt-2">
            <button onClick={onBack}
              className="rounded-full bg-white/[0.07] border border-white/10 text-white text-xs font-bold px-3.5 py-2 active:scale-95">✕ 닫기</button>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-500 tracking-widest">BARBELL LAB</p>
              <p className="text-sm font-black text-slate-100">{member?.name ? `${member.name} 회원` : '바벨 리프팅'}</p>
            </div>
          </div>

          <h2 className="mt-6 text-2xl font-black text-slate-50 leading-tight">무엇을<br/>측정할까요?</h2>
          <p className="mt-1 text-[11px] text-slate-500 font-bold">실시간 렙 분절 · 속도 게이지 · AI 자동 평가</p>

          {/* 모드 카드 */}
          <div className="mt-5 space-y-2.5">
            {MODES.map(([k]) => {
              const mm = MODE_META[k];
              const active = mode === k;
              return (
                <button key={k} onClick={() => switchModeQuiet(k)}
                  className={`w-full text-left rounded-3xl p-4 flex items-center gap-3.5 transition-all active:scale-[0.98] ${
                    active ? `bg-white/[0.07] ring-2 ${mm.ring} shadow-xl` : 'bg-white/[0.03] border border-white/[0.07]'}`}>
                  <span className={`shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br ${mm.accent} flex items-center justify-center text-2xl shadow-lg`}>{mm.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-black text-slate-50">{mm.title}</span>
                    <span className="block text-[10.5px] text-slate-400 leading-snug mt-0.5 break-keep">{mm.desc}</span>
                  </span>
                  <span className={`shrink-0 text-lg font-black ${active ? 'text-white' : 'text-slate-600'}`}>›</span>
                </button>
              );
            })}
          </div>

          {/* 설정 패널 — 선택 모드의 종목/방식 */}
          <div className="mt-5 rounded-3xl bg-white/[0.04] border border-white/[0.08] p-4 space-y-3.5">
            <div>
              <p className="text-[10px] font-black text-slate-500 tracking-widest mb-2">종목</p>
              <div className="flex flex-wrap gap-1.5">
                {modeExercises.map(e => (
                  <button key={e.key} onClick={() => selectExercise(e.key)}
                    className={`rounded-2xl px-3.5 py-2 text-xs font-black transition-colors active:scale-95 ${
                      exerciseType === e.key
                        ? `bg-gradient-to-r ${meta.accent} text-slate-950 shadow-lg`
                        : 'bg-white/[0.06] border border-white/10 text-slate-300'}`}>
                    {e.label}
                  </button>
                ))}
                {mode === 'vbt' && vbtExtraExercises.map(e => (
                  <button key={e.key} onClick={() => selectExercise(e.key)}
                    className={`rounded-2xl px-3.5 py-2 text-xs font-black transition-colors active:scale-95 ${
                      exerciseType === e.key
                        ? `bg-gradient-to-r ${meta.accent} text-slate-950 shadow-lg`
                        : 'bg-white/[0.06] border border-white/10 text-slate-300'}`}>
                    {e.label}
                  </button>
                ))}
              </div>
            </div>

            {mode !== 'onerm' && (
              <div>
                <p className="text-[10px] font-black text-slate-500 tracking-widest mb-2">측정 방식</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[['live', '🔴 실시간 추적', '카메라 앞에서 바로'], ['upload', '📁 고속영상', '120/240fps 최고속도 실측']].map(([k, label, sub]) => (
                    <button key={k} onClick={() => setCaptureMode(k)}
                      className={`rounded-2xl px-3 py-2.5 text-left transition-colors active:scale-95 ${
                        captureMode === k ? 'bg-white/[0.1] ring-2 ring-white/30' : 'bg-white/[0.04] border border-white/10'}`}>
                      <span className="block text-xs font-black text-slate-100">{label}</span>
                      <span className="block text-[9px] text-slate-500 mt-0.5">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={startFromLanding}
              className={`w-full h-14 rounded-2xl bg-gradient-to-r ${meta.accent} text-slate-950 font-black text-base active:scale-[0.98] shadow-xl`}>
              {mode === 'onerm' ? '1RM 측정 시작 →' : captureMode === 'upload' ? '영상 불러오기 →' : '카메라 열고 측정 시작 →'}
            </button>
          </div>

          <button onClick={() => setShowGuide(true)}
            className="mt-3 w-full text-center text-[11px] font-bold text-slate-500 py-2">ⓘ 측정 방법 안내</button>
        </div>
        {showGuide && <LiftingGuide mode={mode} onClose={() => setShowGuide(false)} />}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      {/* ── 상단 모드·종목 선택기(오버레이) ── */}
      <div ref={hubBarRef} className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex flex-col items-center gap-1.5 px-3 pointer-events-none">
        {/* 모드 선택 */}
        <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
          {MODES.map(([k, label]) => (
            <button key={k} onClick={() => switchMode(k)}
              className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        {/* 종목 선택 + 도움말 */}
        <div className="flex items-center gap-1.5 w-full max-w-[100vw] px-1">
          {mode === 'lifting' ? (
            <div className="pointer-events-auto flex gap-0.5 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg min-w-0 flex-1 justify-center">
              {modeExercises.map(e => (
                  <button key={e.key} onClick={() => selectExercise(e.key)}
                    className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-black transition-colors ${
                    exerciseType === e.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
                    {e.label}
                  </button>
              ))}
            </div>
          ) : (
            <div className="pointer-events-auto flex max-w-[calc(100vw-4rem)] gap-0.5 overflow-x-auto rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg min-w-0 flex-1">
              {STRENGTH_EXERCISES.map(e => (
                <button key={e.key} onClick={() => selectExercise(e.key)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-black transition-colors ${
                  exerciseType === e.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
                  {e.label}
                </button>
              ))}
              {mode === 'vbt' && vbtExtraExercises.map(e => (
                <button key={e.key} onClick={() => selectExercise(e.key)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-black transition-colors ${
                  exerciseType === e.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
                  {e.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setShowGuide(true)}
            className="pointer-events-auto h-8 w-8 shrink-0 rounded-full bg-black/55 backdrop-blur border border-white/10 text-white font-black shadow-lg">
            ⓘ
          </button>
        </div>
        {/* 측정 방식 — 역도/VBT만(실시간 추적 / 고속영상 슬로모 분석) */}
        {mode !== 'onerm' && (
          <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
            {[['live', '🔴 실시간'], ['upload', '📁 고속영상']].map(([k, label]) => (
              <button key={k} onClick={() => setCaptureMode(k)}
                className={`rounded-full px-3 py-1 text-[11px] font-black transition-colors ${
                  captureMode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="pointer-events-none text-[10px] font-bold text-amber-300 bg-black/55 backdrop-blur rounded-full px-3 py-0.5 border border-amber-500/30">
          {mode === 'onerm'
            ? '1RM 실시간 카메라 · 스쿼트/데드리프트/벤치프레스'
            : mode === 'vbt'
              ? '측면 촬영 권장 · 1렙씩 · 고속영상(120/240fps)이면 최고속도까지 산출'
              : '역도 카메라 즉시 연결 · 바벨 끝/원판 2~3점 지정 · 신장 기준 cm 환산'}
        </p>
      </div>

      {showGuide && <LiftingGuide mode={mode} onClose={() => setShowGuide(false)} />}

      {/* ── 측정 모드 본체 ── */}
      {mode === 'lifting' && captureMode === 'live' && (
        <LiftingMeasure member={memberWithBody} onBack={backToLanding} onSave={handleSaveLifting}
          onMemberHeightChange={onMemberHeightChange}
          exerciseType={exerciseType} embedded autoStartSignal={cameraStartSignal} topOffset={camTopOffset} />
      )}
      {mode === 'vbt' && captureMode === 'live' && (
        <VbtMeasure member={memberWithBody} onBack={backToLanding} onSave={handleSaveVbt}
          onMemberHeightChange={onMemberHeightChange}
          exerciseType={exerciseType} embedded autoStartSignal={vbtCameraStartSignal} topOffset={camTopOffset} />
      )}
      {mode !== 'onerm' && captureMode === 'upload' && (
        <LiftingUploadAnalysis member={memberWithBody} onBack={backToLanding}
          onComplete={handleUploadComplete} mode={mode} exerciseType={exerciseType} />
      )}
      {mode === 'onerm' && (
        <OneRMEstimate member={memberWithBody} onBack={backToLanding} onSave={handleSaveOneRm}
          exerciseType={exerciseType} embedded autoStartSignal={oneRmCameraStartSignal} topOffset={camTopOffset} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  측정 방법 안내 (가이드 시트)
// ════════════════════════════════════════════════════════════════════════
function LiftingGuide({ mode, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[85dvh] overflow-y-auto bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-black text-lg">바벨 리프팅 측정 방법</h3>
          <button onClick={onClose} className="text-slate-400 font-bold text-sm">닫기 ✕</button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[['lifting', '🏋️ 역도', '카메라 즉시 연결'], ['vbt', '⚡ VBT', '속도 기반 존 판정'], ['onerm', '💪 1RM', '실시간 카메라']].map(([k, t, d]) => (
            <div key={k} className={`rounded-xl p-2.5 border ${mode === k ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-800/60 border-slate-700'}`}>
              <p className="text-white font-bold text-[11px] mb-0.5">{t}</p>
              <p className="text-slate-300 text-[10px] leading-snug">{d}</p>
            </div>
          ))}
        </div>

        {mode === 'onerm' ? (
          <GuideSection title="1RM 추정" emoji="💪" highlight>
            무게와 반복 횟수를 입력하면 검증된 7개 공식(Epley·Brzycki 등)의 평균으로
            최대 1회 무게를 추정합니다. <b className="text-white">무게 직접 입력이 가장 확실</b>하며,
            원판 색 인식은 보조입니다. <b className="text-white">1~10회에서 정확도가 가장 높습니다.</b>
            수집된 무게-속도(Velocity-Load) 데이터가 쌓이면 대시보드로 추세를 봅니다.
          </GuideSection>
        ) : (
          <>
            <GuideSection title="바벨 추적 촬영" emoji="📹" highlight>
              <b className="text-white">옆에서 전신이 보이게</b> 삼각대로 고정 촬영하세요. 카메라를 켜면
              전체 화면으로 전환되고, <b className="text-white">바벨 끝·원판 등 잘 보이는 곳을 2~3군데
              눌러</b> 추적점을 지정합니다. 한 점이 가려지거나 튀어도 나머지 점이 보완해 오차를 줄입니다.
              키를 입력하면 화면비율→cm 환산과 속도 정확도가 올라갑니다(신장 기준 정규화).
            </GuideSection>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
              <p className="text-emerald-300 text-xs font-bold mb-1">⏱ 고속영상과 최고속도</p>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                실시간(보통 30fps)에서는 <b className="text-white">평균속도</b>만 신뢰할 수 있습니다.
                순간 <b className="text-white">최고속도(peak)는 120/240fps 고속영상</b>에서만 산출되며,
                그 외에는 정확도를 위해 표시하지 않습니다(근거기반 정직성).
              </p>
            </div>
          </>
        )}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          ※ 카메라 한 대 추정은 전용 엔코더/포스플레이트보다 정밀하진 않으며, 동일 조건에서의
          <b className="text-slate-300"> 추세 파악</b>에 적합합니다. 신뢰도 점수가 낮게 표시되면
          조명·각도·키 입력·촬영 방향을 점검하세요.
        </p>
      </div>
    </div>
  );
}

function GuideSection({ title, emoji, highlight, children }) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? 'bg-amber-500/10 border border-amber-500/25' : 'bg-slate-800/60'}`}>
      <p className="text-white font-bold text-sm mb-1">{emoji} {title}</p>
      <p className="text-slate-300 text-[11px] leading-relaxed">{children}</p>
    </div>
  );
}
