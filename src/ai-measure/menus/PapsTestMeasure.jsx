// ai-measure/menus/PapsTestMeasure.jsx
// ════════════════════════════════════════════════════════════════════════
//  [PAPS 탭 2026-11-25] 유소년·청소년 체력평가(PAPS 계열) 측정자 입력형 도구.
//  횟수 탭 · 카운트다운 · 초시계 · 메트로놈 · 자로 잰 값 입력. 카메라 자동 카운트는 2차 작업.
//  · 학년·성별·나이·키·몸무게는 회원 등록정보에서 가져온다(없으면 입력).
//  · 등급 판정은 하지 않는다(core/papsTests.js 머리 주석 참고). 값·무효 여부만 저장하고 회차별 비교.
//  · 이상·무효 값도 저장한다(저장 차단 금지).
// ════════════════════════════════════════════════════════════════════════
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { resolveBodyMetrics } from '../../services/bodyMetrics';
import { ageFromBirthDate } from '../core/heartRateBle';
import { normalizeSex } from '../core/cardioTest';
import {
  PAPS_GRADE_OPTIONS, PAPS_TESTS, PAPS_TEST_ORDER, bestOfTrials, buildPapsRecord, evaluatePapsTest,
} from '../core/papsTests';
import PapsReportSheet from '../../components/report/PapsReportSheet';

const Metronome = lazy(() => import('./TimerTool.jsx').then((m) => ({ default: m.Metronome })));

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

  // 진행: setup → ready(3초) → running → result
  const [phase, setPhase] = useState('setup');
  const [lead, setLead] = useState(3);
  const [count, setCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const runRef = useRef(null);
  const endedAtRef = useRef(null);
  const [result, setResult] = useState({ value: '', invalid: false, note: '', trials: [] });
  const [saveState, setSaveState] = useState({ state: 'idle', error: '' });
  const [savedRecord, setSavedRecord] = useState(null);

  const resetRun = () => {
    runRef.current = null; setCount(0); setElapsedMs(0); setLead(3); setPhase('setup');
    setResult({ value: '', invalid: false, note: '', trials: [] });
    setSaveState({ state: 'idle', error: '' }); setSavedRecord(null);
  };

  const finish = useCallback((valueOverride = null) => {
    const run = runRef.current;
    if (!run) return;
    const ms = performance.now() - run.startPerf;
    endedAtRef.current = new Date().toISOString();
    let value = valueOverride;
    if (value == null) value = meta.kind === 'hold' ? Math.round(ms / 100) / 10 : run.count;
    setResult((r) => ({ ...r, value: String(value) }));
    setPhase('result');
  }, [meta.kind]);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    setLead(3);
    const id = setInterval(() => {
      setLead((n) => {
        if (n <= 1) {
          clearInterval(id);
          runRef.current = { startPerf: performance.now(), startedAt: new Date().toISOString(), repLog: [], count: 0 };
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
    const id = setInterval(() => {
      const run = runRef.current;
      if (!run) return;
      const ms = performance.now() - run.startPerf;
      setElapsedMs(ms);
      if (meta.kind === 'reps_timed' && ms >= meta.durationSec * 1000) finish(run.count);
    }, 100);
    return () => clearInterval(id);
  }, [phase, meta.kind, meta.durationSec, finish]);

  const tapRep = () => {
    const run = runRef.current;
    if (!run || phase !== 'running') return;
    run.count += 1;
    run.repLog.push(Math.round((performance.now() - run.startPerf) / 100) / 10);
    setCount(run.count);
  };
  const undoRep = () => {
    const run = runRef.current;
    if (!run || run.count <= 0) return;
    run.count -= 1; run.repLog.pop(); setCount(run.count);
  };

  // value-형: 결과 화면에서 칸마다 입력 → 가장 좋은 값이 기록
  const startValueEntry = () => {
    runRef.current = { startPerf: performance.now(), startedAt: new Date().toISOString(), repLog: [], count: 0 };
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

  const preview = evaluatePapsTest(testId, result.value, { invalid: result.invalid });
  const memberLabel = member ? (member.isVirtual ? '미등록회원' : `${member.name || '회원'} 회원`) : '';
  const secText = (ms) => (ms / 1000).toFixed(1);
  const remain = meta.kind === 'reps_timed' ? Math.max(0, meta.durationSec - elapsedMs / 1000) : null;

  const save = async () => {
    if (!onSave || !member || saveState.state === 'saving' || saveState.state === 'saved') return;
    setSaveState({ state: 'saving', error: '' });
    const run = runRef.current || {};
    const record = buildPapsRecord({
      testId, value: result.value, subject, variant: testId === 'pushup' ? variant : '', invalid: result.invalid,
      trials: result.trials, metronomeBpm: bpmNote, startedAt: run.startedAt || null, endedAt: endedAtRef.current,
      trainerNote: result.note, repLog: run.repLog || [],
    });
    try {
      await onSave(record);
      setSavedRecord(record);
      setSaveState({ state: 'saved', error: '' });
    } catch (e) {
      setSaveState({ state: 'error', error: e?.message || '저장에 실패했습니다.' });
    }
  };

  const startLabel = meta.kind === 'value' ? '값 입력하기' : '측정 시작 (3초 뒤)';

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

          <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed dark:bg-slate-800/70" data-testid="paps-howto">
            <p><b>무엇을 보나</b> {meta.what}</p>
            <ol className="ml-4 list-decimal">{meta.how.map((h) => <li key={h}>{h}</li>)}</ol>
            <p className="font-bold text-red-600 dark:text-red-400">주의 {meta.care}</p>
            <p className="font-semibold text-slate-500">PAPS 등급 판정은 기준표 확인 후 추가됩니다. 지금은 값을 저장하고 회차별로 비교합니다. 달리기·제자리멀리뛰기는 5번·7번 탭을 쓰세요.</p>
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
            {meta.metronome && (
              <label className="mt-2 block text-xs font-bold">쓴 박자(BPM, 기록용)
                <input className={INP} type="number" value={bpmNote} onChange={(e) => setBpmNote(e.target.value)} placeholder="예) 60" />
              </label>
            )}
          </div>

          {meta.metronome && (
            <details className="rounded-xl border-2 border-slate-200 p-2 dark:border-slate-700">
              <summary className="cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-300">메트로놈 (박자 맞출 때)</summary>
              <div className="mt-2"><Suspense fallback={null}><Metronome compact /></Suspense></div>
            </details>
          )}

          <button type="button" onClick={() => (meta.kind === 'value' ? startValueEntry() : setPhase('ready'))} data-testid="paps-start"
            className="w-full rounded-xl bg-amber-500 py-3 text-base font-black text-slate-950">{startLabel}</button>
        </div>
      )}

      {phase === 'ready' && (
        <div className="rounded-2xl border-2 border-amber-400 p-8 text-center">
          <p className="text-sm font-bold">준비하세요</p>
          <p className="font-mono text-7xl font-black" data-testid="paps-lead">{lead}</p>
          <button type="button" onClick={resetRun} className="mt-3 rounded-lg border-2 border-slate-300 px-4 py-1.5 text-xs font-bold dark:border-slate-600">취소</button>
        </div>
      )}

      {phase === 'running' && (
        <div className="space-y-3">
          <div className="rounded-2xl border-2 border-slate-300 p-3 text-center dark:border-slate-600">
            <p className="text-xs font-bold text-slate-500">{meta.label}{variant === 'knee' && testId === 'pushup' ? ' (무릎)' : ''}</p>
            <p className="font-mono text-6xl font-black tabular-nums" data-testid="paps-clock">
              {meta.kind === 'reps_timed' ? secText(remain * 1000) : secText(elapsedMs)}<span className="text-lg">초</span>
            </p>
            {meta.kind !== 'hold' && <p className="font-mono text-4xl font-black text-amber-600" data-testid="paps-count">{count}<span className="text-base">회</span></p>}
          </div>
          {meta.kind !== 'hold' && (
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
            <p className="text-xs font-black">{meta.label}{variant === 'knee' && testId === 'pushup' ? ' (무릎)' : ''}</p>
            <p className="font-mono text-4xl font-black">{result.value || '-'}<span className="ml-1 text-base">{meta.unit}</span></p>
            <p className="text-sm font-black">{preview.label}</p>
            {preview.reason && <p className="text-[11px] font-semibold">{preview.reason}</p>}
            {preview.easy && <p className="mt-1 text-xs font-bold">{preview.easy}</p>}
          </div>

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
    </div>
  );
}
