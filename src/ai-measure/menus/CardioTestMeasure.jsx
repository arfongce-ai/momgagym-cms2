// ai-measure/menus/CardioTestMeasure.jsx
// ════════════════════════════════════════════════════════════════════════
//  [15번 심폐지구력 2026-11-12] 유산소 장비 + 심박 밴드 자동 기록 → 참고 VO2max.
//  흐름: 장비·테스트 선택 → 장비/밴드 블루투스 연결 → 시작 → (목표 도달 시 자동 종료)
//        → 1분 회복 심박 → 결과 확인(트레이너 확인값·메모) → 회원 측정 이력에 저장.
//  · 1초 단위 원본(심박·와트·케이던스·거리)을 그대로 저장한다(core/cardioTest.js).
//  · 장비 연결이 안 되면 트레이너가 장비 화면 숫자(시간·거리·평균 와트)를 넣어 저장한다.
//  · 14번 초시계와 같은 심박 밴드 연결 코드(core/heartRateBle.js)를 쓴다.
//  · 화면을 나가면 장비·밴드 연결을 모두 끊는다.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiStore } from '../../demoData';
import {
  ageFromBirthDate,
  connectHeartRateBand,
  heartRateZone,
  HEART_RATE_ZONE_LABELS,
  isHeartRateBleSupported,
  shortBandId,
} from '../core/heartRateBle';
import { connectFitnessMachine } from '../core/fitnessMachineBle';
import {
  CARDIO_GLOSSARY,
  CARDIO_MACHINES,
  RECOVERY_SEC,
  STEP_DEFAULTS,
  STEP_STAGE_SEC,
  STEP_STOP_PCT,
  buildCardioRecord,
  computeCardioResult,
  createRecorder,
  formatClock,
  formatPace,
  getProtocol,
  lastDistance,
  normalizeSex,
  pastCardioRecords,
  personalMaxHr,
  protocolsForMachine,
  recordTick,
  windowAvg,
} from '../core/cardioTest';

const FRESH_MS = 5000; // 이 시간 안에 온 값만 '현재 값'으로 쓴다
const MACHINE_ORDER = ['rower', 'bike', 'ski', 'treadmill', 'climber'];

function machineError(err) {
  if (err?.name === 'NotFoundError') return '';
  if (err?.message === 'timeout') return '연결 시간이 지났습니다. 장비 화면을 켜고(페달·노를 한 번 움직이면 켜짐) 가까이에서 다시 눌러 주세요.';
  if (err?.message === 'unsupported-machine') {
    return `연결은 됐지만 표준 운동 신호가 없습니다(${err.deviceName || '장비'}: ${(err.services || []).join(', ') || '신호 없음'}). 이 문구를 캡처해 보내 주시면 다음 버전에 추가합니다. 지금은 장비 화면 숫자를 결과에 직접 입력해 저장할 수 있습니다.`;
  }
  if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') return '블루투스 권한이 꺼져 있습니다. 브라우저·기기 설정에서 허용해 주세요.';
  return '장비에 연결하지 못했습니다. 장비 화면을 켠 뒤 다시 눌러 주세요. 다른 폰·앱이 이미 연결돼 있으면 먼저 끊어야 합니다.';
}

function Tile({ label, value, unit, big = false, tone = '' }) {
  return (
    <div className={`rounded-xl border-2 px-2 py-2 text-center ${tone || 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`font-mono font-black tabular-nums leading-tight text-slate-900 dark:text-slate-100 ${big ? 'text-4xl' : 'text-2xl'}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-bold">{unit}</span>}
      </p>
    </div>
  );
}

// 최근 구간 심박(빨강)·와트(주황) 선 그래프. 같은 칸에 각자 비율로 그린다.
function LiveChart({ rec, windowSec = 300, version }) {
  void version; // 1초마다 다시 그리기 위한 값
  const n = rec.t.length;
  if (n < 2) return <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800" />;
  const from = Math.max(0, n - windowSec);
  const line = (arr, color) => {
    const v = arr.slice(from);
    const nums = v.filter((x) => x != null);
    if (nums.length < 2) return null;
    const lo = Math.min(...nums); const hi = Math.max(...nums);
    const span = hi - lo || 1;
    const pts = v.map((x, i) => (x == null ? null : `${(i / Math.max(v.length - 1, 1)) * 300},${90 - ((x - lo) / span) * 80}`)).filter(Boolean).join(' ');
    return <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />;
  };
  return (
    <svg viewBox="0 0 300 96" className="h-24 w-full rounded-xl bg-slate-100 dark:bg-slate-800" preserveAspectRatio="none" aria-label="심박·와트 그래프">
      {line(rec.w, '#f59e0b')}
      {line(rec.hr, '#ef4444')}
    </svg>
  );
}

// 테스트 설명(무엇을 보나 · 하는 방법 · 결과 보는 법 · 주의)
function ProtocolInfo({ info, compact = false }) {
  if (!info) return null;
  return (
    <div className={`space-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/70 p-2 text-[11px] leading-relaxed text-slate-700 dark:text-slate-200 ${compact ? '' : 'mt-1'}`} data-testid="cardio-protocol-info">
      <p><b>무엇을 보나</b> {info.what}</p>
      {!compact && (
        <div>
          <b>하는 방법</b>
          <ol className="ml-4 list-decimal">
            {info.how.map((h) => <li key={h}>{h}</li>)}
          </ol>
        </div>
      )}
      <p><b>결과 보는 법</b> {info.read}</p>
      {info.care && <p className="font-bold text-red-600 dark:text-red-400">주의 {info.care}</p>}
    </div>
  );
}

const parseClock = (s) => {
  const m = /^(\d{1,3}):(\d{1,2})$/.exec(String(s || '').trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function CardioTestMeasure({ onBack, member = null, onSave = null }) {
  const supported = isHeartRateBleSupported();
  const [machineId, setMachineId] = useState('rower');
  const [protocolId, setProtocolId] = useState('rower_2k');
  const protocol = getProtocol(protocolId);
  const machineMeta = CARDIO_MACHINES[machineId];

  // 대상자 정보(회원에서 자동, 없으면 입력)
  const [subject, setSubject] = useState(() => ({
    age: member ? (ageFromBirthDate(member.birthDate) || Number(member.age) || '') : '',
    sex: member ? (normalizeSex(member.sex || member.gender) || '') : '',
    weightKg: member?.weight ? String(member.weight) : '',
  }));
  const [allSessions, setAllSessions] = useState([]);
  useEffect(() => {
    let alive = true;
    if (member?.id && !member.isVirtual) {
      aiStore.ensureSessions(member.id).then((list) => { if (alive) setAllSessions(Array.isArray(list) ? list : []); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [member?.id, member?.isVirtual]);

  // 블루투스 연결
  const machineRef = useRef(null); // 연결 handle
  const machineLive = useRef({}); // 최신 장비 값 + at
  const bandRef = useRef(null);
  const bandLive = useRef({});
  const [machineInfo, setMachineInfo] = useState(null); // { name, protocol, machineKind, services, status }
  const [bandInfo, setBandInfo] = useState(null);
  const [connecting, setConnecting] = useState('');
  const [error, setError] = useState('');

  const connectMachine = async (showAll = false) => {
    if (connecting) return;
    setError(''); setConnecting('machine');
    try {
      machineRef.current?.disconnect();
      const handle = await connectFitnessMachine({
        showAll,
        onData: (d) => { machineLive.current = { ...machineLive.current, ...d, at: Date.now() }; },
        onStatus: (status) => setMachineInfo((m) => (m ? { ...m, status } : m)),
      });
      machineRef.current = handle;
      setMachineInfo({ name: handle.name, protocol: handle.protocol, machineKind: handle.machineKind, services: handle.services, status: 'connected' });
    } catch (err) {
      setError(machineError(err));
    } finally { setConnecting(''); }
  };

  const connectBand = async () => {
    if (connecting) return;
    setError(''); setConnecting('band');
    try {
      bandRef.current?.disconnect();
      const handle = await connectHeartRateBand({
        onValue: ({ bpm }) => { bandLive.current = { bpm, at: Date.now() }; },
        onStatus: (status) => setBandInfo((b) => (b ? { ...b, status } : b)),
      });
      bandRef.current = handle;
      setBandInfo({ name: handle.name, battery: handle.battery, status: 'connected' });
    } catch (err) {
      if (err?.name !== 'NotFoundError') setError('심박 밴드에 연결하지 못했습니다. 밴드가 장비 콘솔에 먼저 연결돼 있으면 폰에서는 안 잡힐 수 있습니다 — 이때는 장비가 보내는 심박을 자동으로 씁니다.');
    } finally { setConnecting(''); }
  };

  useEffect(() => () => {
    machineRef.current?.disconnect();
    bandRef.current?.disconnect();
  }, []);

  // 현재 값(밴드 심박 우선, 없으면 장비가 보낸 심박)
  const readNow = useCallback(() => {
    const now = Date.now();
    const m = machineLive.current;
    const mFresh = m.at && now - m.at < FRESH_MS;
    const b = bandLive.current;
    const bFresh = b.at && now - b.at < FRESH_MS;
    return {
      hr: bFresh ? b.bpm : (mFresh && m.hrBpm ? m.hrBpm : null),
      hrFrom: bFresh ? 'band' : (mFresh && m.hrBpm ? 'machine' : 'none'),
      powerW: mFresh ? m.powerW ?? null : null,
      cadence: mFresh ? m.cadence ?? null : null,
      distanceM: mFresh ? m.distanceM ?? null : null,
      paceSec500: mFresh ? m.paceSec500 ?? null : null,
    };
  }, []);

  // 단계 테스트 계획
  const [stepPlan, setStepPlan] = useState(() => ({ ...STEP_DEFAULTS.rower }));

  // 진행 상태
  const [phase, setPhase] = useState('setup'); // setup | running | recovery | result
  const recRef = useRef(createRecorder());
  const runRef = useRef(null); // { startPerf, startedAt, workEndSec, hrSources:Set }
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(readNow());
  const wakeRef = useRef(null);

  const hrMaxNow = personalMaxHr({ age: subject.age, sessions: allSessions }).value;

  const finishWork = useCallback((sec) => {
    const run = runRef.current;
    if (!run || run.workEndSec != null) return;
    run.workEndSec = sec;
    setPhase('recovery');
  }, []);

  const finishAll = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    if (run.workEndSec == null) run.workEndSec = (performance.now() - run.startPerf) / 1000;
    run.endedAt = new Date().toISOString();
    try { wakeRef.current?.release(); } catch { /* noop */ }
    wakeRef.current = null;
    setPhase('result');
  }, []);

  // 1초마다 기록 + 자동 종료 판단
  useEffect(() => {
    if (phase !== 'running' && phase !== 'recovery') return undefined;
    const timer = setInterval(() => {
      const run = runRef.current;
      if (!run) return;
      const sec = (performance.now() - run.startPerf) / 1000;
      const now = readNow();
      run.hrSources.add(now.hrFrom);
      recordTick(recRef.current, sec, now);
      setLive(now);
      setTick((t) => t + 1);
      const rec = recRef.current;
      if (phase === 'running') {
        const p = getProtocol(run.protocolId);
        const dist = lastDistance(rec);
        if (p?.target?.distanceM && dist != null && dist >= p.target.distanceM) finishWork(sec);
        else if (p?.target?.durationSec && sec >= p.target.durationSec) finishWork(sec);
        else if (p?.id === 'step' && run.hrMax && sec > 60) {
          const hr15 = windowAvg(rec, 'hr', sec - 15, sec + 1);
          if (hr15 != null && hr15 >= run.hrMax * (STEP_STOP_PCT / 100)) finishWork(sec);
        }
      } else if (run.workEndSec != null && sec >= run.workEndSec + RECOVERY_SEC) {
        finishAll();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, readNow, finishWork, finishAll]);

  // 준비 화면에서도 현재 값을 1초마다 보여 준다(연결 확인용)
  useEffect(() => {
    if (phase !== 'setup') return undefined;
    const timer = setInterval(() => setLive(readNow()), 1000);
    return () => clearInterval(timer);
  }, [phase, readNow]);

  const start = async () => {
    recRef.current = createRecorder();
    runRef.current = {
      protocolId, machineId, startPerf: performance.now(), startedAt: new Date().toISOString(),
      workEndSec: null, endedAt: null, hrSources: new Set(), hrMax: hrMaxNow,
    };
    setResultInputs({ time: '', distance: '', power: '', confirmed: '', reference: '', note: '' });
    setSaveState({ state: 'idle', error: '' });
    setPhase('running');
    try { if (navigator.wakeLock?.request) wakeRef.current = await navigator.wakeLock.request('screen'); } catch { /* 지원 안 함 */ }
  };

  const reset = () => {
    runRef.current = null;
    recRef.current = createRecorder();
    setPhase('setup');
  };

  // 결과 화면 입력
  const [resultInputs, setResultInputs] = useState({ time: '', distance: '', power: '', confirmed: '', reference: '', note: '' });
  const [saveState, setSaveState] = useState({ state: 'idle', error: '' });

  const past = useMemo(() => pastCardioRecords(allSessions, machineId), [allSessions, machineId]);
  const manual = useMemo(() => {
    const m = {
      timeSec: parseClock(resultInputs.time),
      distanceM: Number(resultInputs.distance) || null,
      avgPowerW: Number(resultInputs.power) || null,
    };
    return m.timeSec || m.distanceM || m.avgPowerW ? m : null;
  }, [resultInputs.time, resultInputs.distance, resultInputs.power]);

  const computed = useMemo(() => {
    if (phase !== 'result' || !runRef.current) return null;
    return computeCardioResult({
      protocolId: runRef.current.protocolId,
      machineId: runRef.current.machineId,
      rec: recRef.current,
      workEndSec: runRef.current.workEndSec,
      subject: { age: Number(subject.age) || null, sex: subject.sex, weightKg: Number(subject.weightKg) || null },
      past,
      allSessions,
      manual,
    });
  }, [phase, subject.age, subject.sex, subject.weightKg, past, allSessions, manual]);

  const hrSourceLabel = () => {
    const s = runRef.current?.hrSources || new Set();
    if (s.has('band') && s.has('machine')) return 'band+machine';
    if (s.has('band')) return 'band';
    if (s.has('machine')) return 'machine';
    return 'none';
  };

  const save = async () => {
    if (!computed || !onSave || !member || saveState.state === 'saving' || saveState.state === 'saved') return;
    setSaveState({ state: 'saving', error: '' });
    const run = runRef.current;
    const record = buildCardioRecord({
      protocolId: run.protocolId,
      machineId: run.machineId,
      machine: machineInfo,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      rec: recRef.current,
      computed,
      hrSource: hrSourceLabel(),
      manual,
      trainerNote: resultInputs.note,
      confirmedVo2max: Number(resultInputs.confirmed) || null,
      referenceVo2max: Number(resultInputs.reference) || null,
      stepPlan: run.protocolId === 'step' ? stepPlan : null,
    });
    try {
      await onSave(record);
      setSaveState({ state: 'saved', error: '' });
    } catch (err) {
      setSaveState({ state: 'error', error: err?.message || '저장에 실패했습니다.' });
    }
  };

  // ── 화면 ──
  const run = runRef.current;
  const rec = recRef.current;
  const elapsed = run ? (performance.now() - run.startPerf) / 1000 : 0;
  const dist = lastDistance(rec);
  const zone = live.hr && hrMaxNow ? heartRateZone(live.hr, hrMaxNow) : null;
  const memberLabel = member ? (member.isVirtual ? '미등록회원' : `${member.name || '회원'} 회원`) : '';
  const stage = protocolId === 'step' ? Math.floor(elapsed / STEP_STAGE_SEC) + 1 : 0;
  const stageTargetW = protocolId === 'step' ? stepPlan.startW + (stage - 1) * stepPlan.incW : null;
  const kindMismatch = machineInfo?.machineKind && machineId === 'bike' && machineInfo.machineKind !== 'bike';
  const needsManual = computed && (computed.result.powerCoveragePct < 50 || computed.result.distanceM == null);

  const pickMachine = (id) => {
    setMachineId(id);
    const first = protocolsForMachine(id)[0];
    setProtocolId(first?.id || 'free');
    if (STEP_DEFAULTS[id]) setStepPlan({ ...STEP_DEFAULTS[id] });
  };

  const inputCls = 'mt-1 w-full rounded-lg border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100';

  return (
    <div className="space-y-4" data-testid="cardio-test">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">심폐지구력 (VO2max)</h2>
        <span className="w-12" />
      </div>

      {!supported && (
        <p className="rounded-xl bg-amber-100 dark:bg-amber-900/40 p-3 text-xs font-bold text-amber-800 dark:text-amber-200">
          이 기기·브라우저는 블루투스 연결을 지원하지 않습니다. 안드로이드 폰·태블릿이나 PC 크롬에서 열어 주세요. 연결 없이도 결과 숫자를 직접 넣어 저장할 수 있습니다.
        </p>
      )}

      {phase === 'setup' && (
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-bold text-slate-600 dark:text-slate-300">① 장비</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {MACHINE_ORDER.map((id) => (
                <button key={id} onClick={() => pickMachine(id)} className={`rounded-xl border-2 py-2 text-xs font-bold ${machineId === id ? 'border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-200' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>
                  {CARDIO_MACHINES[id].label}
                  <span className="block text-[10px] font-normal opacity-70">{CARDIO_MACHINES[id].model || ' '}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-600 dark:text-slate-300">② 테스트</p>
            <div className="space-y-2">
              {protocolsForMachine(machineId).map((p) => (
                <button key={p.id} onClick={() => setProtocolId(p.id)} className={`w-full rounded-xl border-2 px-3 py-2 text-left ${protocolId === p.id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-300 dark:border-slate-600'}`}>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.label}{p.estimate ? ' · 참고 추정' : ''}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{p.guide}</p>
                  {protocolId === p.id ? <ProtocolInfo info={p.info} /> : p.caution && <p className="text-[11px] font-bold text-red-600 dark:text-red-400">{p.caution}</p>}
                </button>
              ))}
            </div>
            {protocolId === 'step' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">시작 와트
                  <input inputMode="numeric" value={stepPlan.startW} onChange={(e) => setStepPlan((s) => ({ ...s, startW: Number(e.target.value.replace(/\D+/g, '')) || 0 }))} className={inputCls} />
                </label>
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">단계마다 올릴 와트
                  <input inputMode="numeric" value={stepPlan.incW} onChange={(e) => setStepPlan((s) => ({ ...s, incW: Number(e.target.value.replace(/\D+/g, '')) || 0 }))} className={inputCls} />
                </label>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-600 dark:text-slate-300">③ 대상자 {member ? `· ${memberLabel}` : '· 회원 미선택(저장 안 됨)'}</p>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">나이
                <input inputMode="numeric" value={subject.age} onChange={(e) => setSubject((s) => ({ ...s, age: e.target.value.replace(/\D+/g, '').slice(0, 3) }))} className={inputCls} />
              </label>
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">성별
                <select value={subject.sex} onChange={(e) => setSubject((s) => ({ ...s, sex: e.target.value }))} className={inputCls}>
                  <option value="">-</option><option value="male">남</option><option value="female">여</option>
                </select>
              </label>
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">체중(kg)
                <input inputMode="decimal" value={subject.weightKg} onChange={(e) => setSubject((s) => ({ ...s, weightKg: e.target.value.replace(/[^\d.]/g, '').slice(0, 5) }))} className={inputCls} />
              </label>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              최대심박 {hrMaxNow || '-'}{hrMaxNow ? (personalMaxHr({ age: subject.age, sessions: allSessions }).source === 'observed' ? ' (이 회원의 실제 기록 기준)' : ' (220-나이)') : ' — 나이를 넣어 주세요'}
            </p>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-600 dark:text-slate-300">④ 연결</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => connectMachine(false)} disabled={!supported || !machineMeta.ble || connecting !== ''} className="rounded-xl border-2 border-dashed border-slate-400 dark:border-slate-500 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40">
                {connecting === 'machine' ? '장비 연결 중…' : machineInfo ? `장비: ${machineInfo.name}${machineInfo.status !== 'connected' ? ' (재연결 중)' : ''}` : machineMeta.ble ? '+ 장비 연결' : '이 장비는 연결 없음'}
              </button>
              <button onClick={connectBand} disabled={!supported || connecting !== ''} className="rounded-xl border-2 border-dashed border-slate-400 dark:border-slate-500 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40">
                {connecting === 'band' ? '밴드 연결 중…' : bandInfo ? `밴드 ${shortBandId(bandInfo.name)}${bandInfo.status !== 'connected' ? ' (재연결 중)' : ''}` : '+ 심박 밴드(선택)'}
              </button>
            </div>
            {machineMeta.ble && (
              <button onClick={() => connectMachine(true)} disabled={!supported || connecting !== ''} className="mt-1 text-[11px] font-bold text-slate-500 underline dark:text-slate-400">
                장비가 목록에 안 보이면: 모든 블루투스 기기 보기
              </button>
            )}
            {kindMismatch && <p className="mt-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">연결된 장비가 바이크 신호가 아닙니다({machineInfo.machineKind}). 장비를 다시 골랐는지 확인하세요.</p>}
            <div className="mt-2 grid grid-cols-4 gap-1">
              <Tile label="심박" value={live.hr || '--'} unit={live.hrFrom === 'machine' ? '장비' : ''} />
              <Tile label="와트" value={live.powerW ?? '--'} unit="W" />
              <Tile label={machineMeta.cadenceUnit || '케이던스'} value={live.cadence ?? '--'} />
              <Tile label="거리" value={live.distanceM ?? '--'} unit="m" />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">숫자가 움직이면 연결 정상입니다. 장비는 연결 없이도 시작할 수 있고, 끝난 뒤 장비 화면 숫자를 직접 넣으면 됩니다.</p>
          </div>

          {error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}

          <button onClick={start} className="w-full rounded-xl bg-amber-500 py-3 text-base font-black text-slate-950" data-testid="cardio-start">
            ▶ {protocol?.label || '테스트'} 시작
          </button>
        </div>
      )}

      {(phase === 'running' || phase === 'recovery') && run && (
        <div className="space-y-3 landscape:grid landscape:grid-cols-2 landscape:gap-3 landscape:space-y-0">
          <div className="space-y-3">
            <div className={`rounded-xl p-3 text-center ${phase === 'recovery' ? 'bg-sky-100 dark:bg-sky-900/40' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
              {phase === 'recovery' ? (
                <>
                  <p className="text-sm font-black text-sky-800 dark:text-sky-200">회복 심박 측정 중 — 가만히 앉아 계세요</p>
                  <p className="font-mono text-4xl font-black text-sky-900 dark:text-sky-100">{formatClock(Math.max(0, run.workEndSec + RECOVERY_SEC - elapsed))}</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{protocol?.label}</p>
                  <p className="font-mono text-5xl font-black text-slate-900 dark:text-slate-100">
                    {protocol?.target?.durationSec ? formatClock(Math.max(0, protocol.target.durationSec - elapsed)) : formatClock(elapsed)}
                  </p>
                  {protocol?.target?.distanceM && <p className="text-sm font-bold text-slate-700 dark:text-slate-200">남은 거리 {dist != null ? Math.max(0, protocol.target.distanceM - dist) : protocol.target.distanceM}m</p>}
                  {protocolId === 'step' && <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{stage}단계 · 목표 {stageTargetW}W · 다음 단계까지 {formatClock(STEP_STAGE_SEC - (elapsed % STEP_STAGE_SEC))}</p>}
                  {protocolId === 'bike_astrand' && (
                    <p className={`text-sm font-bold ${live.hr >= 125 && live.hr <= 170 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
                      심박 {live.hr || '--'} {live.hr >= 125 && live.hr <= 170 ? '✓ 125~170 안' : '— 125~170이 되도록 와트 조절'}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Tile big label="심박" value={live.hr || '--'} tone={zone ? 'border-red-400 bg-red-50 dark:bg-red-900/30' : ''} />
              <Tile big label="와트" value={live.powerW ?? '--'} />
              <Tile big label={machineMeta.cadenceUnit || '케이던스'} value={live.cadence ?? '--'} />
              <Tile label="거리" value={dist ?? '--'} unit="m" />
              <Tile label="페이스/500m" value={formatPace(live.paceSec500)} />
              <Tile label="강도" value={zone ? `${zone.pct}%` : '--'} unit={zone ? HEART_RATE_ZONE_LABELS[zone.zone] : ''} />
            </div>
          </div>
          <div className="space-y-3">
            <LiveChart rec={rec} version={tick} />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">빨강 심박 · 주황 와트 · 1초마다 자동 기록 중 ({rec.t.length}초)</p>
            {phase === 'running' && protocol?.info && (
              <ol className="ml-4 list-decimal text-[11px] text-slate-600 dark:text-slate-300">
                {protocol.info.how.map((h) => <li key={h}>{h}</li>)}
              </ol>
            )}
            {phase === 'running' ? (
              <button onClick={() => finishWork(elapsed)} className="w-full rounded-xl bg-red-500 py-3 text-sm font-bold text-white">■ 운동 끝 (회복 심박 측정으로)</button>
            ) : (
              <button onClick={finishAll} className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-600 py-3 text-sm font-bold text-slate-700 dark:text-slate-200">회복 측정 건너뛰고 결과 보기</button>
            )}
            <button onClick={reset} className="w-full text-xs font-bold text-slate-500 underline dark:text-slate-400">처음으로(이번 기록 버리기)</button>
          </div>
        </div>
      )}

      {phase === 'result' && computed && (
        <div className="space-y-3" data-testid="cardio-result">
          <div className="rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{protocol?.label} 결과 · {machineMeta.label}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Tile label="시간" value={formatClock(computed.result.durationSec)} />
              <Tile label="거리" value={computed.result.distanceM ?? '-'} unit="m" />
              <Tile label="평균 와트" value={computed.result.avgPowerW ?? '-'} unit="W" />
              <Tile label="평균 심박" value={computed.result.avgHr ?? '-'} />
              <Tile label="최고 심박" value={computed.result.peakHr ?? '-'} />
              <Tile label="1분 회복" value={computed.recovery.drop60 ?? '-'} unit="bpm" />
            </div>
            {computed.estimates.vo2max && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-2">
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                  VO2max 참고 추정: {computed.estimates.vo2max.value ?? '계산 안 됨'}{computed.estimates.vo2max.value ? ' mL/kg/min' : ''}
                  {computed.estimates.vo2max.calibratedValue ? ` → 보정 ${computed.estimates.vo2max.calibratedValue}` : ''}
                  {computed.estimates.vo2max.grade ? ` · 신뢰 ${computed.estimates.vo2max.grade}` : ''}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">{computed.estimates.vo2max.reason}</p>
              </div>
            )}
            {computed.estimates.maxPower && (
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-2">
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                  추정 최대 파워: {computed.estimates.maxPower.value ?? '계산 안 됨'}{computed.estimates.maxPower.value ? 'W' : ''}
                  {computed.estimates.maxPower.grade ? ` · 신뢰 ${computed.estimates.maxPower.grade} (점 ${computed.estimates.maxPower.points}개 · ${computed.estimates.maxPower.sessionsUsed}회차)` : ''}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">{computed.estimates.maxPower.reason}</p>
              </div>
            )}
            {computed.stages && computed.stages.length > 0 && (
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                {computed.stages.map((s) => `${s.stage}단계 ${s.avgPowerW ?? '-'}W/${s.avgHr ?? '-'}bpm${s.complete ? '' : '(미완)'}`).join(' · ')}
              </p>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              최대심박 {computed.hrMax.value ?? '-'}({computed.hrMax.source === 'observed' ? '실제 기록' : computed.hrMax.source === 'age' ? '220-나이' : '없음'}) · 심박 출처 {hrSourceLabel()} · 와트 기록률 {computed.result.powerCoveragePct}% · 심박 기록률 {computed.result.hrCoveragePct}%
            </p>
            <LiveChart rec={rec} windowSec={CARDIO_SERIES_MAX_SEC_FOR_VIEW} version={rec.t.length} />
            <ProtocolInfo info={protocol?.info} compact />
            <details className="text-[11px] text-slate-600 dark:text-slate-300">
              <summary className="cursor-pointer font-bold">용어 설명</summary>
              <dl className="mt-1 space-y-1">
                {CARDIO_GLOSSARY.map(([term, desc]) => (
                  <div key={term}><dt className="inline font-bold">{term}</dt> <dd className="inline">— {desc}</dd></div>
                ))}
              </dl>
            </details>
          </div>

          <div className="rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
              장비 화면 숫자 {needsManual ? '(장비 기록이 부족합니다 — 입력해 주세요)' : '(장비 값과 다르면 고쳐 넣으세요)'}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">시간(분:초)
                <input value={resultInputs.time} onChange={(e) => setResultInputs((s) => ({ ...s, time: e.target.value }))} placeholder="7:30" className={inputCls} />
              </label>
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">거리(m)
                <input inputMode="numeric" value={resultInputs.distance} onChange={(e) => setResultInputs((s) => ({ ...s, distance: e.target.value.replace(/\D+/g, '') }))} className={inputCls} />
              </label>
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">평균 와트
                <input inputMode="numeric" value={resultInputs.power} onChange={(e) => setResultInputs((s) => ({ ...s, power: e.target.value.replace(/\D+/g, '') }))} className={inputCls} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">트레이너 확인 VO2max(선택)
                <input inputMode="decimal" value={resultInputs.confirmed} onChange={(e) => setResultInputs((s) => ({ ...s, confirmed: e.target.value.replace(/[^\d.]/g, '') }))} className={inputCls} />
              </label>
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">다른 곳 실측 VO2max(있을 때만)
                <input inputMode="decimal" value={resultInputs.reference} onChange={(e) => setResultInputs((s) => ({ ...s, reference: e.target.value.replace(/[^\d.]/g, '') }))} className={inputCls} />
              </label>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">실측값(병원·연구실 호흡가스 검사)을 넣어 두면 다음 측정부터 이 회원의 추정값을 그 비율로 보정합니다.</p>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">메모
              <input value={resultInputs.note} onChange={(e) => setResultInputs((s) => ({ ...s, note: e.target.value.slice(0, 300) }))} placeholder="컨디션, 특이사항" className={inputCls} />
            </label>
          </div>

          {!member && <p className="text-[11px] text-slate-500 dark:text-slate-400">회원을 고르지 않아 저장하지 않습니다. 측정 화면에서 회원을 먼저 고른 뒤 다시 측정해 주세요.</p>}
          {saveState.state === 'saved' && <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">✓ {memberLabel} 측정 이력에 저장했습니다(1초 단위 원본 포함).</p>}
          {saveState.error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{saveState.error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={reset} disabled={saveState.state === 'saving'} className="rounded-xl border-2 border-slate-300 dark:border-slate-600 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-50">
              {saveState.state === 'saved' || !member ? '새 측정' : '버리고 새 측정'}
            </button>
            {member && onSave && saveState.state !== 'saved' ? (
              <button onClick={save} disabled={saveState.state === 'saving'} className="rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950 disabled:opacity-40" data-testid="cardio-save">
                {saveState.state === 'saving' ? '저장 중…' : saveState.state === 'error' ? '다시 저장' : `${memberLabel} 기록에 저장`}
              </button>
            ) : <span />}
          </div>
        </div>
      )}
    </div>
  );
}

const CARDIO_SERIES_MAX_SEC_FOR_VIEW = 3600;
