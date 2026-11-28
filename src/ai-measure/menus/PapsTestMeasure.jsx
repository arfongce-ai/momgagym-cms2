// ai-measure/menus/PapsTestMeasure.jsx
// ════════════════════════════════════════════════════════════════════════
//  [PAPS 탭 2026-11-25] 유소년·청소년 체력평가(PAPS 계열) 측정자 입력형 도구.
//  [2026-11-25 개편] 영상촬영이 기본: 카메라로 동작 카운트 + 스켈레톤 + 인식률 + 초시계(+선택 메트로놈)를 영상에 같이 찍어 폰에 저장.
//  악력만 선택 녹화. 카메라 없이 수동(탭·초시계)으로도 잴 수 있다.
//  · 자동 카운트·심박 밴드·카메라 화면은 시니어 탭(SeniorTestMeasure)과 같은 부품을 쓴다.
//  · 학년·성별·나이·키·몸무게는 회원 등록정보에서 가져온다(없으면 입력).
//  · 등급은 공식 기준표(초3~고3) 종목에만(core/papsNorms.js). 그 외(성인 포함)는 값·변화·인식률로 평가(papsEvaluationText).
//  · 이상·무효 값도 저장한다(저장 차단 금지).
// ════════════════════════════════════════════════════════════════════════
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { resolveBodyMetrics } from '../../services/bodyMetrics';
import {
  ageFromBirthDate, connectHeartRateBand, heartRateZone, isHeartRateBleSupported,
  maxHeartRateFromAge, summarizeHeartRateSamples,
} from '../core/heartRateBle';
import { usePoseEngine } from '../core/usePoseEngine';
import { useCameraRotation } from '../core/useCameraRotation';
import { rotateLandmarksNormalized } from '../core/recordAspect';
import { ARM_BONES, ARM_DOTS, LEG_BONES, LEG_DOTS, drawPoseSkeleton } from '../core/drawPoseSkeleton';
import { createPapsAutoCounter, supportsPapsAuto } from '../core/papsAutoCounter';
import { createRecognitionTracker, frameKeyVisibility } from '../core/recognitionStats';
import { createMeasureRecorder } from '../core/measureRecorder';
import { saveVideoToPhone } from '../core/recordSink';
import CameraStage from './CameraStage.jsx';
import { beepRep } from '../core/audioCue';
import { normalizeSex } from '../core/cardioTest';
import {
  PAPS_GRADE_OPTIONS, PAPS_TESTS, PAPS_TEST_ORDER, bestOfTrials, buildPapsRecord, evaluatePapsTest,
} from '../core/papsTests';
import PapsReportSheet from '../../components/report/PapsReportSheet';

const Metronome = lazy(() => import('./TimerTool.jsx').then((m) => ({ default: m.Metronome })));

const FRESH_MS = 5000;
const INP = 'w-full rounded-lg border-2 border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export default function PapsTestMeasure({ onBack, member = null, onSave = null, onViewInReport = null }) {
  const [testId, setTestId] = useState('pushup');
  const meta = PAPS_TESTS[testId];
  const bm = resolveBodyMetrics(member);
  const [subject, setSubject] = useState(() => ({
    age: member ? (ageFromBirthDate(member.birthDate) || Number(member.age) || '') : '',
    sex: member ? (normalizeSex(member.sex || member.gender) || '') : '',
    grade: member?.grade || '',
    weightKg: bm.weight ?? '', heightCm: bm.height ?? '',
  }));
  const [variant, setVariant] = useState(''); // '' | 'knee'(팔굽혀펴기 무릎 대고)
  const [bpmNote, setBpmNote] = useState('');

  // 심박 밴드(선택)
  const supported = isHeartRateBleSupported();
  const bandRef = useRef(null);
  const bandLive = useRef({});
  const samplesRef = useRef([]);
  const [bandInfo, setBandInfo] = useState(null);
  const [bpm, setBpm] = useState(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const connectBand = async () => {
    if (connecting) return;
    setError(''); setConnecting(true);
    try {
      bandRef.current?.disconnect();
      const h = await connectHeartRateBand({
        onValue: ({ bpm: b }) => { bandLive.current = { bpm: b, at: Date.now() }; },
        onStatus: (status) => setBandInfo((x) => (x ? { ...x, status } : x)),
      });
      bandRef.current = h;
      setBandInfo({ name: h.name, status: 'connected' });
    } catch (e) {
      if (e?.name !== 'NotFoundError') setError('심박 밴드에 연결하지 못했습니다. 밴드를 켜고 가까이에서 다시 눌러 주세요. 심박 없이도 측정할 수 있습니다.');
    } finally { setConnecting(false); }
  };
  useEffect(() => () => { bandRef.current?.disconnect(); }, []);

  // 진행: setup → ready(3초) → running → result
  const [phase, setPhase] = useState('setup');
  const [lead, setLead] = useState(3);
  const [count, setCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const runRef = useRef(null);
  const counterRef = useRef(null);
  const canvasRef = useRef(null);
  const finishRef = useRef(null);
  const endedAtRef = useRef(null);
  const [result, setResult] = useState({ value: '', invalid: false, note: '', trials: [] });
  const [saveState, setSaveState] = useState({ state: 'idle', error: '' });
  const [savedRecord, setSavedRecord] = useState(null);

  // 영상촬영 기본: primary 종목은 카메라가 기본값, 악력(optional)은 꺼둔 채 선택. 끄면 수동(탭·초시계).
  const [useCam, setUseCam] = useState(true);
  const [autoSnap, setAutoSnap] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [distanceCm, setDistanceCm] = useState('');
  const effCam = Boolean(meta.video) && useCam;
  const autoOk = supportsPapsAuto(testId);
  const effAuto = effCam && autoOk; // 카메라로 횟수까지 자동 카운트하는 종목
  useEffect(() => { setUseCam(meta.video === 'primary'); }, [testId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 녹화·인식률·메트로놈 HUD
  const recogRef = useRef(createRecognitionTracker());
  const latestLmRef = useRef(null);
  const recorderRef = useRef(null);
  const blobRef = useRef(null);
  const trackedRef = useRef(false);
  const hudFnRef = useRef(() => ({}));
  const [metroCmd, setMetroCmd] = useState(null);
  const metroRef = useRef({ bpm: null, playing: false, beatAt: 0 });
  const [metroUi, setMetroUi] = useState({ bpm: 100, playing: false });
  const [videoState, setVideoState] = useState({ state: 'none', fileName: '', method: '' });
  const recogFinalRef = useRef(null);
  const metroUsedRef = useRef(null);
  const sendMetro = (action, bpmArg) => setMetroCmd({ id: `${Date.now()}-${Math.random()}`, action, ...(bpmArg ? { bpm: bpmArg } : {}) });
  // 윗몸말아올리기는 공식 박자(분당 20회=3초에 1번)를 기본으로 맞춰 둔다(소리는 켜지 않음).
  useEffect(() => { const b = PAPS_TESTS[testId]?.metronomeBpm; if (b) sendMetro('setBpm', b); }, [testId]); // eslint-disable-line react-hooks/exhaustive-deps
  const effCamRef = useRef(false);
  effCamRef.current = effCam;
  const phaseRef = useRef('setup');
  phaseRef.current = phase;
  const [rotationDeg] = useCameraRotation();
  const rotationRef = useRef(rotationDeg);
  rotationRef.current = rotationDeg;
  const handlePose = useCallback((landmarks, ts, video) => {
    latestLmRef.current = landmarks || null;
    const ph = phaseRef.current;
    if (ph === 'ready' || ph === 'running') recogRef.current.record(landmarks || null);
    const vis = landmarks ? frameKeyVisibility(landmarks) : null;
    let snap;
    if (counterRef.current) {
      const lm = landmarks ? rotateLandmarksNormalized(landmarks, rotationRef.current) : null;
      snap = counterRef.current.push(lm, performance.now());
    } else {
      snap = { tracked: vis != null && vis >= 0.5, count: null, events: [], calibrating: false };
    }
    trackedRef.current = Boolean(snap.tracked);
    // 화면 스켈레톤은 원본 좌표 그대로(CameraStage 가 같은 회전 래퍼를 쓴다) — 이중 회전 방지.
    drawPoseSkeleton(canvasRef.current, video || null, landmarks, snap.tracked, {
      bones: [...LEG_BONES, ...ARM_BONES], dots: [...LEG_DOTS, ...ARM_DOTS],
    });
    setAutoSnap(snap);
    const run = runRef.current;
    if (ph !== 'running' || !run || snap.count == null) return;
    const total = snap.count + (run.offset || 0);
    if (total !== run.count) { run.count = total; run.repLog = snap.events.slice(); setCount(total); }
  }, []);
  const pose = usePoseEngine({ onResult: handlePose });
  const poseStartRef = useRef(false);
  // 횟수가 올라갈 때마다(자동 카운트·+1 모두) 짧은 소리. 되돌리기(−1)나 초기화에는 울리지 않는다.
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (phase === 'running' && count > prevCountRef.current) beepRep();
    prevCountRef.current = count;
  }, [count, phase]);
  useEffect(() => {
    if (effCam && cameraOpen && phase !== 'result' && !poseStartRef.current) {
      poseStartRef.current = true;
      counterRef.current = effAuto ? createPapsAutoCounter({ testId }) : null;
      pose.start();
    }
    if ((!effCam || !cameraOpen || phase === 'result') && poseStartRef.current) {
      poseStartRef.current = false;
      pose.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effCam, effAuto, phase, cameraOpen]);
  useEffect(() => { if (phase === 'result') setCameraOpen(false); }, [phase]);
  useEffect(() => () => { pose.stop(); recorderRef.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetRun = () => {
    counterRef.current?.reset(); setAutoSnap(null); setCameraOpen(false);
    recorderRef.current?.abort(); recorderRef.current = null; blobRef.current = null; recogRef.current.reset(); recogFinalRef.current = null;
    setVideoState({ state: 'none', fileName: '', method: '' }); sendMetro('stop'); metroUsedRef.current = null;
    runRef.current = null; samplesRef.current = [];
    setCount(0); setElapsedMs(0); setLead(3); setPhase('setup');
    setResult({ value: '', invalid: false, note: '', trials: [] });
    setSaveState({ state: 'idle', error: '' }); setSavedRecord(null);
  };

  const finish = useCallback((valueOverride = null) => {
    const run = runRef.current;
    if (!run) return;
    const ms = performance.now() - run.startPerf;
    run.finalMs = ms;
    endedAtRef.current = new Date().toISOString();
    recogFinalRef.current = recogRef.current.snapshot();
    metroUsedRef.current = metroRef.current.playing ? metroRef.current.bpm : null;
    sendMetro('stop');
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) rec.stop().then((blob) => { blobRef.current = blob; setVideoState({ state: blob ? 'ready' : 'none', fileName: '', method: '' }); });
    if (meta.kind === 'value') {
      setResult({ value: '', invalid: false, note: '', trials: meta.fields.map((label) => ({ label, value: '' })) });
      setPhase('result');
      return;
    }
    let value = valueOverride;
    if (value == null) value = meta.kind === 'hold' ? Math.round(ms / 100) / 10 : run.count;
    setResult((r) => ({ ...r, value: String(value) }));
    setPhase('result');
  }, [meta.kind]);
  finishRef.current = finish;

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    setLead(3);
    const id = setInterval(() => {
      setLead((n) => {
        if (n <= 1) {
          clearInterval(id);
          runRef.current = { startPerf: performance.now(), startedAt: new Date().toISOString(), repLog: [], count: 0, offset: 0 };
          counterRef.current?.reset(); samplesRef.current = [];
          recogRef.current.reset(); recogFinalRef.current = null; blobRef.current = null;
          if (effCamRef.current && !recorderRef.current) {
            const r = createMeasureRecorder({
              getVideo: () => pose.videoRef.current, getLandmarks: () => latestLmRef.current,
              getRotation: () => rotationRef.current, getHud: () => hudFnRef.current(), getTracked: () => trackedRef.current,
              bones: [...LEG_BONES, ...ARM_BONES], dots: [...LEG_DOTS, ...ARM_DOTS],
            });
            if (r.start()) recorderRef.current = r;
          }
          setCount(0); setElapsedMs(0); setPhase('running');
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    let lastHr = 0;
    const id = setInterval(() => {
      const run = runRef.current;
      if (!run) return;
      const ms = performance.now() - run.startPerf;
      setElapsedMs(ms);
      const b = bandLive.current;
      const fresh = b.at && Date.now() - b.at < FRESH_MS;
      setBpm(fresh ? b.bpm : null);
      if (fresh && ms - lastHr >= 1000) { samplesRef.current.push({ t: Math.round(ms), bpm: b.bpm }); lastHr = ms; }
      if (meta.kind === 'reps_timed' && ms >= meta.durationSec * 1000) finishRef.current?.(run.count);
    }, 100);
    return () => clearInterval(id);
  }, [phase, meta.kind, meta.durationSec]);

  useEffect(() => {
    if (phase === 'running') return undefined;
    const id = setInterval(() => {
      const b = bandLive.current;
      setBpm(b.at && Date.now() - b.at < FRESH_MS ? b.bpm : null);
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const tapRep = () => {
    const run = runRef.current;
    if (!run || phase !== 'running') return;
    run.count += 1;
    if (effAuto) run.offset = (run.offset || 0) + 1;
    run.repLog.push(Math.round((performance.now() - run.startPerf) / 100) / 10);
    setCount(run.count);
  };
  const undoRep = () => {
    const run = runRef.current;
    if (!run || run.count <= 0) return;
    run.count -= 1; run.repLog.pop(); setCount(run.count);
    if (effAuto) run.offset = (run.offset || 0) - 1;
  };

  // value-형: 결과 화면에서 칸마다 입력 → 가장 좋은 값이 기록
  const startValueEntry = () => {
    runRef.current = { startPerf: performance.now(), startedAt: new Date().toISOString(), repLog: [], count: 0, offset: 0 };
    endedAtRef.current = new Date().toISOString();
    setResult({ value: '', invalid: false, note: '', trials: meta.fields.map((label) => ({ label, value: '' })) });
    setPhase('result');
  };
  const setTrial = (i, v) => {
    setResult((r) => {
      const trials = r.trials.map((t, k) => (k === i ? { ...t, value: v } : t));
      const best = bestOfTrials(trials);
      return { ...r, trials, value: best == null ? '' : String(best) };
    });
  };

  const maxHr = maxHeartRateFromAge(Number(subject.age)) || null;
  const hrSummary = () => {
    const run = runRef.current;
    if (!run || !samplesRef.current.length) return null;
    return summarizeHeartRateSamples(samplesRef.current, { durationMs: run.finalMs ?? null, maxHr });
  };
  const hrZone = bpm && maxHr ? heartRateZone(bpm, maxHr) : null;
  const titleSuffix = variant === 'knee' && testId === 'pushup' ? ' (무릎)' : '';

  const preview = evaluatePapsTest(testId, result.value, { invalid: result.invalid, subject });
  const memberLabel = member ? (member.isVirtual ? '미등록회원' : `${member.name || '회원'} 회원`) : '';
  const secText = (ms) => (ms / 1000).toFixed(1);
  const hasCountTest = meta.kind === 'reps_free' || meta.kind === 'reps_timed';
  hudFnRef.current = () => {
    const run = runRef.current;
    const ms = run ? performance.now() - run.startPerf : 0;
    const timed = meta.kind === 'reps_timed';
    const b = bandLive.current;
    const m = metroRef.current;
    return {
      title: `${meta.short}${titleSuffix}`,
      elapsedMs: timed ? null : ms,
      remainMs: timed ? Math.max(0, meta.durationSec * 1000 - ms) : null,
      count: meta.kind === 'reps_free' || timed ? (run?.count ?? 0) : null,
      unit: meta.unit,
      bpm: m.playing ? m.bpm : null,
      beat: performance.now() - m.beatAt < 130,
      recognition: recogRef.current.snapshot(),
      hr: b.at && Date.now() - b.at < FRESH_MS ? b.bpm : null,
      note: meta.needsDistance && distanceCm ? `거리 ${distanceCm}cm` : '',
    };
  };
  const remain = meta.kind === 'reps_timed' ? Math.max(0, meta.durationSec - elapsedMs / 1000) : null;

  const save = async () => {
    if (!onSave || !member || saveState.state === 'saving' || saveState.state === 'saved') return;
    setSaveState({ state: 'saving', error: '' });
    const run = runRef.current || {};
    const record = buildPapsRecord({
      testId, value: result.value, subject, variant: testId === 'pushup' ? variant : '', invalid: result.invalid,
      trials: result.trials, metronomeBpm: metroUsedRef.current ?? bpmNote, startedAt: run.startedAt || null, endedAt: endedAtRef.current,
      trainerNote: result.note, repLog: run.repLog || [], hr: hrSummary(),
      auto: effAuto ? { used: true, autoValue: autoSnap?.count ?? null, autoCount: autoSnap?.count ?? null, offset: run.offset || 0 } : null,
      recognition: effCam ? recogFinalRef.current : null,
      video: effCam ? { recorded: Boolean(blobRef.current), fileName: videoState.fileName, method: videoState.method } : null,
      conditions: { distanceCm: meta.needsDistance ? distanceCm : null, metronomeBpm: metroUsedRef.current ?? (bpmNote || null), cameraUsed: effCam },
    });
    try {
      await onSave(record);
      setSavedRecord(record);
      setSaveState({ state: 'saved', error: '' });
    } catch (e) {
      setSaveState({ state: 'error', error: e?.message || '저장에 실패했습니다.' });
    }
  };

  const startClick = () => {
    if (meta.needsDistance && !(Number(distanceCm) > 0)) { setError('사이드스텝은 선 사이 거리(cm)를 먼저 입력해 주세요.'); return; }
    if (effCam) { setCameraOpen(true); return; }
    if (meta.kind === 'value') { startValueEntry(); return; }
    setPhase('ready');
  };
  const startLabel = effCam ? '카메라 열고 촬영 준비' : meta.kind === 'value' ? '값 입력하기' : '측정 시작 (3초 뒤)';
  const recogSnap = recogRef.current.snapshot();
  const recogText = recogSnap && recogSnap.frames ? `인식률 ${Math.round(recogSnap.ratio * 100)}%` : '인식률 --';
  const hasCount = meta.kind === 'reps_free' || meta.kind === 'reps_timed';
  const liveLabel = `${secText(meta.kind === 'reps_timed' ? remain * 1000 : elapsedMs)}초${hasCount ? ` · ${count}회` : ''} · ${recogText}`;

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 text-slate-900 dark:text-slate-100" data-testid="paps-measure">
      <div className="flex items-center gap-2">
        {onBack && <button type="button" onClick={onBack} className="rounded-lg border-2 border-slate-300 px-3 py-1.5 text-sm font-bold dark:border-slate-600">← 메뉴</button>}
        <h2 className="text-base font-black">PAPS · 청소년 체력평가</h2>
        {memberLabel && <span className="ml-auto text-xs font-bold text-slate-500">{memberLabel}</span>}
      </div>

      {phase === 'setup' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1.5">
            {PAPS_TEST_ORDER.map((id) => (
              <button key={id} type="button" onClick={() => setTestId(id)} data-testid={`paps-pick-${id}`}
                className={`rounded-xl border-2 px-1 py-2 text-xs font-black ${testId === id ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' : 'border-slate-300 dark:border-slate-600'}`}>
                {PAPS_TESTS[id].short}
              </button>
            ))}
          </div>

          <div className="space-y-1.5 rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed dark:bg-slate-800/70" data-testid="paps-howto">
            <p><b>무엇을 보나</b> {meta.what}</p>
            <div><b>하는 방법</b><ol className="ml-4 list-decimal">{meta.how.map((h) => <li key={h}>{h}</li>)}</ol></div>
            {meta.camera && <p data-testid="paps-camera-guide"><b>촬영 위치</b> {meta.camera}</p>}
            {meta.countRule && <p data-testid="paps-count-rule"><b>카운트·기록 기준</b> {meta.countRule}</p>}
            {meta.verified?.length > 0 && <p className="text-emerald-700 dark:text-emerald-400"><b>확인된 기준</b> {meta.verified.join(' / ')}</p>}
            {meta.unverified?.length > 0 && <p className="font-bold text-amber-700 dark:text-amber-400" data-testid="paps-unverified"><b>확인 못 함</b> {meta.unverified.join(' / ')}</p>}
            <p className="font-bold text-red-600 dark:text-red-400">주의 {meta.care}</p>
            <p className="font-semibold text-slate-500">초3~고3 학년·성별이 있으면 윗몸말아올리기·앉아윗몸앞으로굽히기·악력·팔굽혀펴기(중·고)는 1~5등급이 나옵니다(학교건강검사규칙 별표 4). 성인·그 외는 등급 없이 값·영상·인식률·이전 기록과의 변화로 평가하고 결과리포트에 같은 형식으로 나옵니다. 달리기·제자리멀리뛰기는 5번·7번 탭을 쓰세요.</p>
          </div>

          <div className="rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700">
            <p className="mb-1 text-xs font-black">대상자 정보 (등록정보에서 자동)</p>
            <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold">
              <label>학년
                <select className={INP} value={subject.grade} onChange={(e) => setSubject({ ...subject, grade: e.target.value })} data-testid="paps-grade">
                  <option value="">선택</option>
                  {PAPS_GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label>나이<input className={INP} type="number" value={subject.age} onChange={(e) => setSubject({ ...subject, age: e.target.value })} /></label>
              <label>성별
                <select className={INP} value={subject.sex} onChange={(e) => setSubject({ ...subject, sex: e.target.value })}>
                  <option value="">선택</option><option value="male">남</option><option value="female">여</option>
                </select>
              </label>
              <label>키(cm)<input className={INP} type="number" value={subject.heightCm} onChange={(e) => setSubject({ ...subject, heightCm: e.target.value })} /></label>
              <label>몸무게(kg)<input className={INP} type="number" value={subject.weightKg} onChange={(e) => setSubject({ ...subject, weightKg: e.target.value })} /></label>
            </div>
            {testId === 'pushup' && (
              <label className="mt-2 flex items-center gap-1 text-xs font-bold">
                <input type="checkbox" checked={variant === 'knee'} onChange={(e) => setVariant(e.target.checked ? 'knee' : '')} data-testid="paps-knee" />
                무릎 대고 하는 방식(별도 추이로 비교)
              </label>
            )}
            {meta.needsDistance && (
              <label className="mt-2 block text-xs font-bold">선 사이 거리(cm) — 필수, 매번 같게
                <input className={INP} type="number" value={distanceCm} onChange={(e) => setDistanceCm(e.target.value)} placeholder="예) 100" data-testid="paps-distance" />
              </label>
            )}
            <label className="mt-2 block text-xs font-bold">메트로놈 박자 메모(BPM, 아래 메트로놈을 켜면 자동 기록)
              <input className={INP} type="number" value={bpmNote} onChange={(e) => setBpmNote(e.target.value)} placeholder="예) 60" />
            </label>
          </div>

          <div className="rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700" data-testid="paps-mode">
            <p className="mb-1 text-xs font-black">영상촬영 {meta.video === 'primary' ? '(기본)' : '(선택)'}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[[true, meta.video === 'optional' ? '하는 모습 녹화' : '카메라 촬영'], [false, meta.kind === 'value' ? '촬영 없이 값만 입력' : '촬영 없이 수동(탭·초시계)']].map(([k, label]) => (
                <button key={String(k)} type="button" onClick={() => setUseCam(k)} data-testid={k ? 'paps-mode-cam' : 'paps-mode-manual'}
                  className={`rounded-xl border-2 px-1 py-2 text-xs font-black ${(k ? useCam : !useCam) ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' : 'border-slate-300 dark:border-slate-600'}`}>{label}</button>
              ))}
            </div>
            {effCam && (
              <p className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                화면에 <b>초시계{hasCountTest ? '·횟수' : ''}·인식률{'(스켈레톤 인식 비율)'}·메트로놈 박자</b>가 같이 찍힌 영상이 만들어지고, 끝나면 폰에 저장합니다(서버 업로드 없음).
                {effAuto ? ' 자동값은 참고용이라 끝나고 측정자가 확인·수정합니다. 안 잡히면 +1/−1로 보정하세요.' : ''}
              </p>
            )}
          </div>

          <div className="rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <p className="text-xs font-black">심박 밴드(선택)</p>
              {supported
                ? <button type="button" onClick={connectBand} disabled={connecting} data-testid="paps-band" className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900">{connecting ? '연결 중…' : bandInfo ? '다시 연결' : '밴드 연결'}</button>
                : <span className="ml-auto text-[11px] font-semibold text-slate-500">이 브라우저는 블루투스를 지원하지 않습니다</span>}
            </div>
            {bandInfo && <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">연결됨: {bandInfo.name || '심박 밴드'} · 현재 {bpm ?? '-'} bpm</p>}
            {error && <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
          </div>

          <button type="button" onClick={startClick} data-testid="paps-start"
            className="w-full rounded-xl bg-amber-500 py-3 text-base font-black text-slate-950">{startLabel}</button>
        </div>
      )}

      <div className={phase === 'setup' && !cameraOpen ? 'rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700' : 'hidden'} data-testid="paps-metronome">
        <details>
          <summary className="cursor-pointer text-xs font-black text-slate-700 dark:text-slate-200">메트로놈 (선택 — 켜면 박자가 영상에도 표시)</summary>
          <div className="mt-2">
            <Suspense fallback={null}>
              <Metronome compact command={metroCmd}
                onBeat={({ bpm: b }) => { metroRef.current = { ...metroRef.current, bpm: b, beatAt: performance.now() }; }}
                onState={({ bpm: b, playing }) => { metroRef.current = { ...metroRef.current, bpm: b, playing }; setMetroUi({ bpm: b, playing }); }} />
            </Suspense>
          </div>
        </details>
      </div>

      {!effCam && phase === 'ready' && (
        <div className="rounded-2xl border-2 border-amber-400 p-8 text-center">
          <p className="text-sm font-bold">준비하세요</p>
          <p className="font-mono text-7xl font-black" data-testid="paps-lead">{lead}</p>
          <button type="button" onClick={resetRun} className="mt-3 rounded-lg border-2 border-slate-300 px-4 py-1.5 text-xs font-bold dark:border-slate-600">취소</button>
        </div>
      )}

      {!effCam && phase === 'running' && (
        <div className="space-y-3">
          <div className="rounded-2xl border-2 border-slate-300 p-3 text-center dark:border-slate-600">
            <p className="text-xs font-bold text-slate-500">{meta.label}{titleSuffix}</p>
            <p className="font-mono text-6xl font-black tabular-nums" data-testid="paps-clock">
              {meta.kind === 'reps_timed' ? secText(remain * 1000) : secText(elapsedMs)}<span className="text-lg">초</span>
            </p>
            {hasCountTest && <p className="font-mono text-4xl font-black text-amber-600" data-testid="paps-count">{count}<span className="text-base">회</span></p>}
            <p className="mt-1 text-xs font-bold text-slate-500">심박 {bpm ?? '-'} bpm{hrZone ? ` · ${hrZone.label || `${hrZone.zone}구간`}` : ''}</p>
          </div>
          {hasCountTest && (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={undoRep} className="rounded-xl border-2 border-slate-300 py-6 text-sm font-black dark:border-slate-600">−1</button>
              <button type="button" onClick={tapRep} data-testid="paps-tap" className="col-span-2 rounded-xl bg-amber-500 py-6 text-2xl font-black text-slate-950 active:scale-95">+1</button>
            </div>
          )}
          <button type="button" onClick={() => finish()} data-testid="paps-stop"
            className={`w-full rounded-xl py-3 text-base font-black ${meta.kind === 'hold' ? 'bg-amber-500 py-6 text-slate-950' : 'border-2 border-red-400 text-red-600'}`}>
            {meta.kind === 'hold' ? '멈춤' : '종료'}
          </button>
        </div>
      )}

      {phase === 'result' && (
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800" data-testid="paps-preview">
            <p className="text-xs font-black">{meta.label}{titleSuffix}</p>
            <p className="font-mono text-4xl font-black">{result.value || '-'}<span className="ml-1 text-base">{meta.unit}</span></p>
            <p className="text-sm font-black">{preview.label}</p>
            {preview.reference && <p className="text-[11px] font-semibold text-slate-500">{preview.reference}</p>}
            {preview.reason && <p className="text-[11px] font-semibold">{preview.reason}</p>}
            {preview.easy && <p className="mt-1 text-xs font-bold">{preview.easy}</p>}
          </div>

          {effCam && (
            <div className="rounded-xl border-2 border-slate-200 p-2 text-xs font-bold dark:border-slate-700" data-testid="paps-video-box">
              <p>동작 인식률 {recogFinalRef.current && recogFinalRef.current.frames ? `${Math.round(recogFinalRef.current.ratio * 100)}%` : '--'}
                <span className="ml-1 font-semibold text-slate-500">(몸 주요 관절이 또렷하게 잡힌 프레임 비율 — 낮으면 카운트는 측정자 확인값을 믿으세요)</span></p>
              {videoState.state === 'none' && <p className="mt-1 font-semibold text-slate-500">녹화된 영상이 없습니다(이 브라우저가 녹화를 지원하지 않거나 촬영 전에 끝남). 측정값은 그대로 저장할 수 있습니다.</p>}
              {videoState.state !== 'none' && (
                <button type="button" data-testid="paps-video-save"
                  onClick={async () => {
                    if (!blobRef.current) return;
                    const r = await saveVideoToPhone(blobRef.current, { measure: `paps_${testId}`, member });
                    if (r.saved) setVideoState({ state: 'saved', fileName: r.fileName, method: r.method });
                  }}
                  className="mt-1.5 w-full rounded-lg border-2 border-amber-400 bg-amber-50 py-2 text-xs font-black text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  {videoState.state === 'saved' ? `✓ 폰에 저장됨 (${videoState.fileName})` : '영상 폰에 저장 (초시계·횟수·박자·인식률 포함)'}
                </button>
              )}
            </div>
          )}

          <div className="rounded-xl border-2 border-slate-200 p-2 text-xs font-bold dark:border-slate-700">
            {meta.kind === 'value' ? (
              <div className="grid grid-cols-2 gap-1.5">
                {result.trials.map((t, i) => (
                  <label key={t.label}>{t.label} ({meta.unit})
                    <input className={INP} type="number" step="0.1" value={t.value} onChange={(e) => setTrial(i, e.target.value)} data-testid={`paps-trial-${i}`} />
                  </label>
                ))}
              </div>
            ) : (
              <label className="block">트레이너 확인값({meta.unit}) — 측정값이 다르면 직접 고치세요
                <input className={INP} type="number" step="0.1" value={result.value} onChange={(e) => setResult({ ...result, value: e.target.value })} data-testid="paps-value" />
              </label>
            )}
            <label className="mt-2 flex items-center gap-1"><input type="checkbox" checked={result.invalid} onChange={(e) => setResult({ ...result, invalid: e.target.checked })} data-testid="paps-invalid" />무효로 표시(자세 불량·중단 등)</label>
            <label className="mt-2 block">메모<textarea className={INP} rows={2} value={result.note} onChange={(e) => setResult({ ...result, note: e.target.value })} /></label>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">무효·이상 값도 그대로 저장됩니다(판정만 '확인 필요'로 표시).</p>
          </div>

          {saveState.state === 'saved' && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">✓ {memberLabel} 측정 이력에 저장했습니다.</p>
              {onViewInReport && !member?.isVirtual && (
                <button type="button" onClick={onViewInReport} data-testid="paps-view-report"
                  className="w-full rounded-xl border-2 border-amber-400 bg-amber-50 py-2.5 text-sm font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  결과리포트에서 저장된 기록 보기 →
                </button>
              )}
            </div>
          )}
          {saveState.error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{saveState.error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={resetRun} disabled={saveState.state === 'saving'} className="rounded-xl border-2 border-slate-300 py-3 text-sm font-bold dark:border-slate-600">
              {saveState.state === 'saved' || !member ? '새 측정' : '버리고 새 측정'}
            </button>
            {member && onSave && saveState.state !== 'saved' ? (
              <button type="button" onClick={save} disabled={saveState.state === 'saving'} data-testid="paps-save" className="rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950 disabled:opacity-40">
                {saveState.state === 'saving' ? '저장 중…' : saveState.state === 'error' ? '다시 저장' : `${memberLabel} 기록에 저장`}
              </button>
            ) : <span />}
          </div>
          {saveState.state === 'saved' && savedRecord && (
            <div className="pt-2"><PapsReportSheet report={savedRecord} member={member} /></div>
          )}
        </div>
      )}

      {effCam && cameraOpen && phase !== 'result' && (
        <CameraStage
          videoRef={pose.videoRef} canvasRef={canvasRef} status={pose.status} error={pose.error}
          onClose={() => { if (phase === 'running') finish(); setCameraOpen(false); if (phase !== 'running') resetRun(); }}
          tappable={false} showSkeletonToggle
          countdown={phase === 'ready' ? lead : null}
          recording={phase === 'running'} recordingLabel={liveLabel}
          topBar={(
            <>
              <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white">{meta.short}{titleSuffix} · {effAuto ? '카메라 자동' : '영상 기록'}</span>
              <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-emerald-300" data-testid="paps-recog">{recogText}</span>
              <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${autoSnap?.tracked ? 'bg-emerald-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`} data-testid="paps-track-status">
                {autoSnap?.calibrating ? '중심 잡는 중 — 가운데 서 주세요' : autoSnap?.tracked ? '✓ 인식됨' : '⚠ 몸이 안 잡혀요 — 필요한 관절이 보이게 세워 주세요'}
              </span>
              {bpm != null && <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white">심박 {bpm} bpm</span>}
            </>
          )}
          children={hasCountTest && phase === 'running' ? (
            <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center" data-testid="paps-center-count">
              <div key={count} className="flex h-40 w-40 flex-col items-center justify-center rounded-full border-4 border-amber-300/80 bg-black/55 shadow-2xl backdrop-blur animate-pulse-once">
                <span className="font-mono text-7xl font-black leading-none text-white">{count}</span>
                <span className="mt-1 text-sm font-bold text-amber-200">회</span>
              </div>
            </div>
          ) : null}
          controls={phase === 'running' ? (
            <div className="flex items-center gap-2">
              {hasCountTest && <button type="button" onClick={undoRep} className="h-12 w-14 rounded-full bg-slate-200 text-lg font-black text-slate-800 active:scale-95">−1</button>}
              {hasCountTest && <button type="button" onClick={tapRep} data-testid="paps-tap" className="h-12 rounded-full bg-amber-500 px-5 text-sm font-black text-slate-950 active:scale-95">+1 {effAuto ? '보정' : ''}</button>}
              <button type="button" onClick={() => sendMetro(metroUi.playing ? 'stop' : 'start')} data-testid="paps-stage-metro" className={`h-12 rounded-full px-4 text-xs font-black active:scale-95 ${metroUi.playing ? 'bg-amber-300 text-slate-950' : 'bg-slate-200 text-slate-800'}`}>♪ {metroUi.playing ? `${metroUi.bpm}` : '박자'}</button>
              <button type="button" onClick={() => finish()} data-testid="paps-stop" className="h-12 rounded-full bg-red-500 px-5 text-sm font-black text-white active:scale-95">{meta.kind === 'value' ? '■ 촬영 끝 → 값 입력' : '■ 종료'}</button>
            </div>
          ) : phase === 'ready' ? (
            <button type="button" onClick={resetRun} className="h-12 rounded-full bg-slate-200 px-5 text-sm font-black text-slate-800 active:scale-95">취소</button>
          ) : (
            <button type="button" onClick={() => setPhase('ready')} disabled={pose.status !== 'running'} data-testid="paps-stage-start"
              className="h-12 rounded-full bg-amber-500 px-6 text-sm font-black text-slate-950 active:scale-95 disabled:opacity-50">● 측정 시작 (3초 뒤)</button>
          )}
        />
      )}
    </div>
  );
}
