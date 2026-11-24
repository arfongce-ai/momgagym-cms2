// ai-measure/menus/SeniorTestMeasure.jsx
// ════════════════════════════════════════════════════════════════════════
//  [시니어 기능 테스트 2026-11-24] 30초 의자 일어서기 · 5회 일어서기 · TUG.
//  측정자 입력형 도구: 횟수 탭 · 카운트다운 · 초시계 + 심박 밴드 + (선택)메트로놈.
//  · 나이·성별·키·몸무게·혈압은 회원 등록정보에서 가져온다(없으면 입력).
//  · 이상·무효 값도 저장한다(저장 차단 금지). 판정은 규준표(core/seniorTests.js)로만 하고
//    트레이너 확인값(값 수정·메모)을 함께 남긴다.
//  · 화면을 나가면 심박 밴드 연결을 끊는다.
// ════════════════════════════════════════════════════════════════════════
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { store } from '../../demoData';
import { resolveBodyMetrics } from '../../services/bodyMetrics';
import {
  ageFromBirthDate, connectHeartRateBand, heartRateZone, isHeartRateBleSupported,
  maxHeartRateFromAge, summarizeHeartRateSamples,
} from '../core/heartRateBle';
import { normalizeSex } from '../core/cardioTest';
import { usePoseEngine } from '../core/usePoseEngine';
import { useCameraRotation } from '../core/useCameraRotation';
import { rotateLandmarksNormalized } from '../core/recordAspect';
import { createSeniorAutoCounter } from '../core/seniorAutoCounter';
import { isSkeletonEnabled } from '../core/skeletonPref';
import CameraStage from './CameraStage.jsx';
import {
  SENIOR_TESTS, SENIOR_TEST_ORDER, buildSeniorRecord, evaluateSeniorTest, seniorPrecheck,
} from '../core/seniorTests';
import SeniorReportSheet from '../../components/report/SeniorReportSheet';

const Metronome = lazy(() => import('./TimerTool.jsx').then((m) => ({ default: m.Metronome })));

const FRESH_MS = 5000;

// 스켈레톤(어깨·엉덩이·무릎·다리). 기존 측정 화면과 같은 object-contain 좌표계로 그린다.
// 스켈레톤 OFF 여도 인식·카운트는 계속된다(화면에 그리는 것만 끈다).
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
const DOTS = [11, 12, 23, 24, 25, 26, 27, 28];
const visOk = (p) => !!p && (p.visibility == null || p.visibility >= 0.3);
function drawPoseSkeleton(canvas, video, landmarks, tracked) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth || canvas.width; const ch = canvas.clientHeight || canvas.height;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!landmarks || !isSkeletonEnabled()) return;
  const vw = video.videoWidth || cw; const vh = video.videoHeight || ch;
  const scale = Math.min(cw / vw, ch / vh);
  const dw = vw * scale; const dh = vh * scale; const ox = (cw - dw) / 2; const oy = (ch - dh) / 2;
  const X = (p) => ox + p.x * dw; const Y = (p) => oy + p.y * dh;
  ctx.strokeStyle = tracked ? 'rgba(52,211,153,0.95)' : 'rgba(251,191,36,0.95)';
  ctx.lineWidth = 3; ctx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    const pa = landmarks[a]; const pb = landmarks[b];
    if (!visOk(pa) || !visOk(pb)) return;
    ctx.beginPath(); ctx.moveTo(X(pa), Y(pa)); ctx.lineTo(X(pb), Y(pb)); ctx.stroke();
  });
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  DOTS.forEach((i) => {
    const p = landmarks[i];
    if (!visOk(p)) return;
    ctx.beginPath(); ctx.arc(X(p), Y(p), 5, 0, Math.PI * 2); ctx.fill();
  });
}

function latestBp(member) {
  try {
    if (!member?.id || member.isVirtual) return { systolic: member?.systolic ?? '', diastolic: member?.diastolic ?? '' };
    const recs = [...(store.getBodyRecords?.(member.id) || [])]
      .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    const r = recs.find((x) => x.systolic != null || x.diastolic != null);
    return { systolic: r?.systolic ?? '', diastolic: r?.diastolic ?? '' };
  } catch { return { systolic: '', diastolic: '' }; }
}

const STATUS_TONE = {
  normal: 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300',
  caution: 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  unknown: 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

export default function SeniorTestMeasure({ onBack, member = null, onSave = null, onViewInReport = null }) {
  const [testId, setTestId] = useState('chair30');
  const meta = SENIOR_TESTS[testId];
  const bm = resolveBodyMetrics(member);
  const bp0 = latestBp(member);
  const [subject, setSubject] = useState(() => ({
    age: member ? (ageFromBirthDate(member.birthDate) || Number(member.age) || '') : '',
    sex: member ? (normalizeSex(member.sex || member.gender) || '') : '',
    weightKg: bm.weight ?? '', heightCm: bm.height ?? '',
    systolic: bp0.systolic, diastolic: bp0.diastolic,
  }));
  const [check, setCheck] = useState({ painNow: false, dizzy: false });
  const precheck = seniorPrecheck({ ...subject, ...check });

  // 심박 밴드
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

  // 진행: setup → ready(카운트다운 3초) → running → result
  const [phase, setPhase] = useState('setup');
  const phaseRef = useRef('setup');
  phaseRef.current = phase;
  const [count, setCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lead, setLead] = useState(3);
  const runRef = useRef(null); // { startPerf, startedAt, repLog }
  const endedAtRef = useRef(null);

  const resetRun = () => {
    runRef.current = null; samplesRef.current = [];
    setCount(0); setElapsedMs(0); setLead(3); setPhase('setup');
    setSaveState({ state: 'idle', error: '' }); setSavedRecord(null);
    counterRef.current?.reset(); setAutoSnap(null);
    setResult({ value: '', armsUsed: false, completed: true, note: '' });
  };

  const [result, setResult] = useState({ value: '', armsUsed: false, completed: true, note: '' });

  // 카메라 자동 카운트(선택). 기본은 수동 입력이고, 자동값도 측정자가 확인·수정한 뒤 저장한다.
  const [mode, setMode] = useState('manual'); // manual | auto
  const [autoSnap, setAutoSnap] = useState(null);
  const counterRef = useRef(null);
  const finishRef = useRef(null);
  const [rotationDeg] = useCameraRotation();
  const rotationRef = useRef(rotationDeg);
  rotationRef.current = rotationDeg;
  const canvasRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const handlePose = useCallback((landmarks, ts, video) => {
    if (!counterRef.current) return;
    const lm = landmarks ? rotateLandmarksNormalized(landmarks, rotationRef.current) : null;
    const snap = counterRef.current.push(lm, performance.now());
    // 화면 스켈레톤은 원본 좌표 그대로(CameraStage 가 같은 회전 래퍼를 쓴다) — 이중 회전 방지.
    drawPoseSkeleton(canvasRef.current, video || null, landmarks, snap.tracked);
    setAutoSnap(snap);
    const run = runRef.current;
    if (phaseRef.current !== 'running' || !run) return;
    if (run.testId === 'tug') {
      if (snap.finished) { run.autoValue = snap.elapsedSec; run.autoWalked = snap.walked; finishRef.current?.(snap.elapsedSec); }
    } else {
      const total = snap.count + (run.offset || 0);
      if (total !== run.count) { run.count = total; run.repLog = snap.events.slice(); setCount(total); }
      if (run.testId === 'sts5' && snap.finished) {
        run.autoValue = Math.round((snap.finishedAtMs - run.startPerf) / 100) / 10;
        finishRef.current?.(run.autoValue);
      }
    }
  }, []);
  const pose = usePoseEngine({ onResult: handlePose });
  const poseStartRef = useRef(false);
  useEffect(() => {
    if (mode === 'auto' && cameraOpen && phase !== 'result' && !poseStartRef.current) {
      poseStartRef.current = true;
      counterRef.current = createSeniorAutoCounter({ testId, targetReps: SENIOR_TESTS.sts5.reps });
      pose.start();
    }
    if ((mode !== 'auto' || !cameraOpen || phase === 'result') && poseStartRef.current) {
      poseStartRef.current = false;
      pose.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase, cameraOpen]);
  // 결과 화면으로 넘어가면 카메라를 닫는다.
  useEffect(() => { if (phase === 'result') setCameraOpen(false); }, [phase]);
  useEffect(() => { if (counterRef.current) counterRef.current = createSeniorAutoCounter({ testId, targetReps: SENIOR_TESTS.sts5.reps }); }, [testId]);
  useEffect(() => () => { pose.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [saveState, setSaveState] = useState({ state: 'idle', error: '' });
  const [savedRecord, setSavedRecord] = useState(null);

  const finish = useCallback((valueOverride = null) => {
    const run = runRef.current;
    if (!run) return;
    const ms = performance.now() - run.startPerf;
    endedAtRef.current = new Date().toISOString();
    let value = valueOverride;
    if (value == null) value = testId === 'chair30' ? run.count : Math.round(ms / 100) / 10;
    run.finalMs = ms;
    setResult((r) => ({ ...r, value: String(value) }));
    setPhase('result');
  }, [testId]);
  finishRef.current = finish;

  // 3초 준비 카운트다운
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    setLead(3);
    const id = setInterval(() => {
      setLead((n) => {
        if (n <= 1) {
          clearInterval(id);
          runRef.current = { startPerf: performance.now(), startedAt: new Date().toISOString(), repLog: [], count: 0, testId, autoValue: null };
          counterRef.current?.reset();
          samplesRef.current = [];
          setCount(0); setElapsedMs(0); setPhase('running');
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // 진행 중 100ms 표시 갱신 + 1초 심박 기록 + 30초 자동 종료
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
      if (testId === 'chair30' && ms >= meta.durationSec * 1000) finish(run.count);
    }, 100);
    return () => clearInterval(id);
  }, [phase, testId, meta.durationSec, finish]);

  // 준비 화면에서도 현재 심박 표시
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
    if (mode === 'auto') run.offset = (run.offset || 0) + 1; // 자동 카운트 보정(+1)
    run.repLog.push(Math.round((performance.now() - run.startPerf) / 100) / 10);
    setCount(run.count);
    if (testId === 'sts5' && mode !== 'auto' && run.count >= meta.reps) finish();
  };
  const undoRep = () => {
    const run = runRef.current;
    if (!run || run.count <= 0) return;
    run.count -= 1; run.repLog.pop(); setCount(run.count);
    if (mode === 'auto') run.offset = (run.offset || 0) - 1; // 자동 카운트 보정(−1)
  };

  const maxHr = maxHeartRateFromAge(Number(subject.age)) || null;
  const hrSummary = () => {
    const run = runRef.current;
    if (!run) return null;
    return summarizeHeartRateSamples(samplesRef.current, { durationMs: run.finalMs ?? null, maxHr });
  };
  const hrZone = bpm && maxHr ? heartRateZone(bpm, maxHr) : null;

  const preview = evaluateSeniorTest(testId, result.value, {
    age: subject.age, sex: subject.sex, armsUsed: result.armsUsed, completed: result.completed,
  });

  const save = async () => {
    if (!onSave || !member || saveState.state === 'saving' || saveState.state === 'saved') return;
    setSaveState({ state: 'saving', error: '' });
    const run = runRef.current || {};
    const record = buildSeniorRecord({
      testId, value: result.value, subject, armsUsed: result.armsUsed, completed: result.completed,
      startedAt: run.startedAt || null, endedAt: endedAtRef.current,
      hr: hrSummary(), trainerNote: result.note, precheck: precheck.ok ? null : { reasons: precheck.reasons },
      repLog: run.repLog || [],
      auto: mode === 'auto' ? { used: true, autoValue: run.autoValue ?? null, autoCount: autoSnap?.count ?? null, walked: run.autoWalked ?? autoSnap?.walked ?? null, offset: run.offset || 0 } : null,
    });
    try {
      await onSave(record);
      setSavedRecord(record);
      setSaveState({ state: 'saved', error: '' });
    } catch (e) {
      setSaveState({ state: 'error', error: e?.message || '저장에 실패했습니다.' });
    }
  };

  const memberLabel = member ? (member.isVirtual ? '미등록회원' : `${member.name || '회원'} 회원`) : '';
  const INP = 'w-full rounded-lg border-2 border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  const secText = (ms) => (ms / 1000).toFixed(1);
  const remain = testId === 'chair30' ? Math.max(0, meta.durationSec - elapsedMs / 1000) : null;

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 text-slate-900 dark:text-slate-100" data-testid="senior-measure">
      <div className="flex items-center gap-2">
        {onBack && <button type="button" onClick={onBack} className="rounded-lg border-2 border-slate-300 px-3 py-1.5 text-sm font-bold dark:border-slate-600">← 메뉴</button>}
        <h2 className="text-base font-black">시니어 기능 테스트</h2>
        {memberLabel && <span className="ml-auto text-xs font-bold text-slate-500">{memberLabel}</span>}
      </div>

      {phase === 'setup' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            {SENIOR_TEST_ORDER.map((id) => (
              <button key={id} type="button" onClick={() => setTestId(id)} data-testid={`senior-pick-${id}`}
                className={`rounded-xl border-2 px-1 py-2 text-xs font-black ${testId === id ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' : 'border-slate-300 dark:border-slate-600'}`}>
                {SENIOR_TESTS[id].short}
              </button>
            ))}
          </div>

          <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed dark:bg-slate-800/70" data-testid="senior-howto">
            <p><b>무엇을 보나</b> {meta.what}</p>
            <ol className="ml-4 list-decimal">{meta.how.map((h) => <li key={h}>{h}</li>)}</ol>
            <p><b>결과 보는 법</b> {meta.read}</p>
            <p className="font-bold text-red-600 dark:text-red-400">주의 {meta.care}</p>
          </div>

          <div className="rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700">
            <p className="mb-1 text-xs font-black">대상자 정보 (등록정보에서 자동)</p>
            <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold">
              <label>나이<input className={INP} type="number" value={subject.age} onChange={(e) => setSubject({ ...subject, age: e.target.value })} /></label>
              <label>성별
                <select className={INP} value={subject.sex} onChange={(e) => setSubject({ ...subject, sex: e.target.value })}>
                  <option value="">선택</option><option value="male">남</option><option value="female">여</option>
                </select>
              </label>
              <label>몸무게(kg)<input className={INP} type="number" value={subject.weightKg} onChange={(e) => setSubject({ ...subject, weightKg: e.target.value })} /></label>
              <label>키(cm)<input className={INP} type="number" value={subject.heightCm} onChange={(e) => setSubject({ ...subject, heightCm: e.target.value })} /></label>
              <label>수축기<input className={INP} type="number" value={subject.systolic} onChange={(e) => setSubject({ ...subject, systolic: e.target.value })} /></label>
              <label>이완기<input className={INP} type="number" value={subject.diastolic} onChange={(e) => setSubject({ ...subject, diastolic: e.target.value })} /></label>
            </div>
            <div className="mt-2 flex gap-4 text-xs font-bold">
              <label className="flex items-center gap-1"><input type="checkbox" checked={check.painNow} onChange={(e) => setCheck({ ...check, painNow: e.target.checked })} />지금 통증 있음</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={check.dizzy} onChange={(e) => setCheck({ ...check, dizzy: e.target.checked })} />어지럼 있음</label>
            </div>
            {precheck.message && <p className={`mt-2 rounded-lg p-2 text-xs font-bold ${precheck.ok ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`} data-testid={precheck.ok ? 'senior-notice' : 'senior-hold'}>{precheck.message}</p>}
            {!subject.age || !subject.sex ? <p className="mt-1 text-[11px] font-semibold text-slate-500">나이·성별이 없으면 값은 저장되지만 평균 비교는 하지 않습니다.</p> : null}
          </div>

          <div className="rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700" data-testid="senior-mode">
            <p className="mb-1 text-xs font-black">횟수·시간 재는 방법</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[['manual', '수동 (측정자가 탭)'], ['auto', '카메라 자동 카운트']].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setMode(k)} data-testid={`senior-mode-${k}`}
                  className={`rounded-xl border-2 px-1 py-2 text-xs font-black ${mode === k ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' : 'border-slate-300 dark:border-slate-600'}`}>{label}</button>
              ))}
            </div>
            {mode === 'auto' && (
              <div className="mt-2 space-y-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <p>옆모습(측면)에서 어깨·엉덩이·무릎이 모두 보이게 세워 주세요. 의자는 카메라와 직각 방향. 자동값은 참고용이라 끝나고 측정자가 확인·수정합니다. 몸이 안 잡히면 수동 탭(+1/−1)으로 보정하세요.</p>
                {testId === 'tug' && <p>TUG는 첫 일어섬부터 다시 앉을 때까지를 자동으로 잽니다(3m 왕복이 화면에 보이게).</p>}
              </div>
            )}
          </div>

          <div className="rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <p className="text-xs font-black">심박 밴드(선택)</p>
              {supported
                ? <button type="button" onClick={connectBand} disabled={connecting} className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900" data-testid="senior-band">{connecting ? '연결 중…' : bandInfo ? '다시 연결' : '밴드 연결'}</button>
                : <span className="ml-auto text-[11px] font-semibold text-slate-500">이 브라우저는 블루투스를 지원하지 않습니다</span>}
            </div>
            {bandInfo && <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">연결됨: {bandInfo.name || '심박 밴드'} · 현재 {bpm ?? '-'} bpm</p>}
            {error && <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-300">메트로놈(걷는 박자 맞출 때)</summary>
              <div className="mt-2"><Suspense fallback={null}><Metronome compact /></Suspense></div>
            </details>
          </div>

          <button type="button" onClick={() => (mode === 'auto' ? setCameraOpen(true) : setPhase('ready'))} data-testid="senior-start"
            className="w-full rounded-xl bg-amber-500 py-3 text-base font-black text-slate-950">
            {mode === 'auto' ? (precheck.ok ? '카메라 열기' : '확인했습니다 — 카메라 열기') : (precheck.ok ? '측정 시작 (3초 뒤)' : '확인했습니다 — 그래도 시작')}
          </button>
        </div>
      )}

      {mode !== 'auto' && phase === 'ready' && (
        <div className="rounded-2xl border-2 border-amber-400 p-8 text-center">
          <p className="text-sm font-bold">준비하세요</p>
          <p className="font-mono text-7xl font-black" data-testid="senior-lead">{lead}</p>
          <button type="button" onClick={resetRun} className="mt-3 rounded-lg border-2 border-slate-300 px-4 py-1.5 text-xs font-bold dark:border-slate-600">취소</button>
        </div>
      )}

      {mode !== 'auto' && phase === 'running' && (
        <div className="space-y-3">
          <div className="rounded-2xl border-2 border-slate-300 p-3 text-center dark:border-slate-600">
            <p className="text-xs font-bold text-slate-500">{meta.label}</p>
            <p className="font-mono text-6xl font-black tabular-nums" data-testid="senior-clock">
              {testId === 'chair30' ? secText(remain * 1000) : secText(elapsedMs)}<span className="text-lg">초</span>
            </p>
            {testId !== 'tug' && <p className="font-mono text-4xl font-black text-amber-600" data-testid="senior-count">{count}<span className="text-base">회{testId === 'sts5' ? ` / ${meta.reps}` : ''}</span></p>}
            <p className="mt-1 text-xs font-bold text-slate-500">
              심박 {bpm ?? '-'} bpm{hrZone ? ` · ${hrZone.label || `${hrZone.zone}구간`}` : ''}
            </p>
          </div>
          {testId !== 'tug' && (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={undoRep} className="rounded-xl border-2 border-slate-300 py-6 text-sm font-black dark:border-slate-600">−1</button>
              <button type="button" onClick={tapRep} data-testid="senior-tap" className="col-span-2 rounded-xl bg-amber-500 py-6 text-2xl font-black text-slate-950 active:scale-95">+1 일어섬</button>
            </div>
          )}
          <button type="button" onClick={() => finish()} data-testid="senior-stop"
            className={`w-full rounded-xl py-3 text-base font-black ${testId === 'tug' ? 'bg-amber-500 py-6 text-slate-950' : 'border-2 border-red-400 text-red-600'}`}>
            {testId === 'tug' ? '앉음 — 멈춤' : '중단 / 종료'}
          </button>
        </div>
      )}

      {phase === 'result' && (
        <div className="space-y-3">
          <div className={`rounded-xl border-2 p-3 ${STATUS_TONE[preview.status]}`} data-testid="senior-preview">
            <p className="text-xs font-black">{meta.label}</p>
            <p className="font-mono text-4xl font-black">{result.value || '-'}<span className="ml-1 text-base">{meta.unit}</span></p>
            <p className="text-sm font-black">{preview.label}</p>
            {preview.reference && <p className="text-[11px] font-semibold">{preview.reference.text} · {preview.reference.source}</p>}
            {preview.reason && <p className="text-[11px] font-semibold">{preview.reason}</p>}
            {preview.easy && <p className="mt-1 text-xs font-bold">{preview.easy}</p>}
          </div>

          <div className="rounded-xl border-2 border-slate-200 p-2 text-xs font-bold dark:border-slate-700">
            <label className="block">트레이너 확인값({meta.unit}) — 측정값이 다르면 직접 고치세요
              <input className={INP} type="number" step="0.1" value={result.value} onChange={(e) => setResult({ ...result, value: e.target.value })} data-testid="senior-value" />
            </label>
            <div className="mt-2 flex flex-wrap gap-4">
              <label className="flex items-center gap-1"><input type="checkbox" checked={result.armsUsed} onChange={(e) => setResult({ ...result, armsUsed: e.target.checked })} />팔 사용{testId === 'chair30' ? '(0회 처리)' : '(무효)'}</label>
              {testId !== 'chair30' && <label className="flex items-center gap-1"><input type="checkbox" checked={!result.completed} onChange={(e) => setResult({ ...result, completed: !e.target.checked })} />끝까지 못 함(무효)</label>}
            </div>
            <label className="mt-2 block">메모<textarea className={INP} rows={2} value={result.note} onChange={(e) => setResult({ ...result, note: e.target.value })} /></label>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">무효·이상 값도 그대로 저장됩니다(판정만 '확인 필요'로 표시).</p>
          </div>

          {saveState.state === 'saved' && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">✓ {memberLabel} 측정 이력에 저장했습니다.</p>
              {onViewInReport && !member?.isVirtual && (
                <button type="button" onClick={onViewInReport} data-testid="senior-view-report"
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
              <button type="button" onClick={save} disabled={saveState.state === 'saving'} data-testid="senior-save" className="rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950 disabled:opacity-40">
                {saveState.state === 'saving' ? '저장 중…' : saveState.state === 'error' ? '다시 저장' : `${memberLabel} 기록에 저장`}
              </button>
            ) : <span />}
          </div>
          {saveState.state === 'saved' && savedRecord && (
            <div className="pt-2"><SeniorReportSheet report={savedRecord} member={member} /></div>
          )}
        </div>
      )}

      {mode === 'auto' && cameraOpen && phase !== 'result' && (
        <CameraStage
          videoRef={pose.videoRef} canvasRef={canvasRef} status={pose.status} error={pose.error}
          onClose={() => { if (phase === 'running') finish(); setCameraOpen(false); if (phase !== 'running') resetRun(); }}
          tappable={false} showSkeletonToggle
          countdown={phase === 'ready' ? lead : null}
          recording={phase === 'running'} recordingLabel={testId === 'chair30' ? `${secText(remain * 1000)}초 · ${count}회` : testId === 'sts5' ? `${secText(elapsedMs)}초 · ${count}/${meta.reps}회` : `${secText(elapsedMs)}초`}
          topBar={(
            <>
              <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white">{meta.short} · 카메라 자동</span>
              <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${autoSnap?.tracked ? 'bg-emerald-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`} data-testid="senior-track-status">
                {autoSnap?.tracked ? `✓ 인식됨 · ${autoSnap.state === 'stand' ? '서 있음' : autoSnap.state === 'sit' ? '앉음' : '확인 중'}` : '⚠ 몸이 안 잡혀요 — 옆모습, 어깨·엉덩이·무릎이 보이게'}
              </span>
              {bpm != null && <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white">심박 {bpm} bpm</span>}
            </>
          )}
          controls={phase === 'running' ? (
            <div className="flex items-center gap-2">
              {testId !== 'tug' && <button type="button" onClick={undoRep} className="h-12 w-14 rounded-full bg-slate-200 text-lg font-black text-slate-800 active:scale-95">−1</button>}
              {testId !== 'tug' && <button type="button" onClick={tapRep} data-testid="senior-tap" className="h-12 rounded-full bg-amber-500 px-5 text-sm font-black text-slate-950 active:scale-95">+1 보정</button>}
              <button type="button" onClick={() => finish()} data-testid="senior-stop" className="h-12 rounded-full bg-red-500 px-5 text-sm font-black text-white active:scale-95">■ 종료</button>
            </div>
          ) : phase === 'ready' ? (
            <button type="button" onClick={resetRun} className="h-12 rounded-full bg-slate-200 px-5 text-sm font-black text-slate-800 active:scale-95">취소</button>
          ) : (
            <button type="button" onClick={() => setPhase('ready')} disabled={pose.status !== 'running'} data-testid="senior-stage-start"
              className="h-12 rounded-full bg-amber-500 px-6 text-sm font-black text-slate-950 active:scale-95 disabled:opacity-50">● 측정 시작 (3초 뒤)</button>
          )}
        />
      )}
    </div>
  );
}
