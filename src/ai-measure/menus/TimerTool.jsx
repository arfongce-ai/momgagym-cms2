// ai-measure/menus/TimerTool.jsx
// Stopwatch, countdown timer, and metronome. The individual tools are exported
// so recording screens can use them without changing menus.
import { useRef, useState, useEffect, useCallback } from 'react';
import { nextPhase, firstPhase, phaseDurationSec, totalDurationSec } from '../core/intervalTimer';

export function Stopwatch({ compact = false }) {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState([]);
  const startRef = useRef(0);
  const accRef = useRef(0);
  const rafRef = useRef(null);

  const tick = useCallback(() => {
    setElapsed(accRef.current + (performance.now() - startRef.current));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startStop = () => {
    if (running) {
      accRef.current += performance.now() - startRef.current;
      cancelAnimationFrame(rafRef.current);
      setRunning(false);
    } else {
      startRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
      setRunning(true);
    }
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    accRef.current = 0;
    setElapsed(0);
    setRunning(false);
    setLaps([]);
  };

  const lap = () => {
    if (running) setLaps((items) => [elapsed, ...items]);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const fmt = (ms) => {
    const cs = Math.floor((ms % 1000) / 10);
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className={`text-center bg-slate-900 border border-slate-800 rounded-2xl ${compact ? 'py-4' : 'py-8'}`}>
        <p className={`font-mono font-black text-amber-400 tabular-nums ${compact ? 'text-4xl' : 'text-5xl'}`}>{fmt(elapsed)}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={reset} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">리셋</button>
        <button
          onClick={startStop}
          className={`rounded-xl font-bold py-3 text-sm ${running ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}
        >
          {running ? '정지' : '시작'}
        </button>
        <button onClick={lap} disabled={!running} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm disabled:opacity-40">랩</button>
      </div>
      {laps.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800 max-h-40 overflow-y-auto">
          {laps.map((l, i) => (
            <div key={i} className="flex justify-between px-3 py-2 text-sm">
              <span className="text-slate-500">랩 {laps.length - i}</span>
              <span className="font-mono text-slate-200">{fmt(l)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Metronome({ compact = false }) {
  const [bpm, setBpm] = useState(100);
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef(null);
  const nextNoteRef = useRef(0);
  const timerRef = useRef(null);
  const beatRef = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
  }, []);

  const start = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    nextNoteRef.current = ctx.currentTime + 0.05;
    beatRef.current = 0;

    timerRef.current = setInterval(() => {
      const secPerBeat = 60 / bpm;
      while (nextNoteRef.current < ctx.currentTime + 0.1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const isDownBeat = beatRef.current % 4 === 0;
        osc.frequency.value = isDownBeat ? 1500 : 1000;
        gain.gain.setValueAtTime(isDownBeat ? 0.5 : 0.3, nextNoteRef.current);
        gain.gain.exponentialRampToValueAtTime(0.001, nextNoteRef.current + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(nextNoteRef.current);
        osc.stop(nextNoteRef.current + 0.05);
        nextNoteRef.current += secPerBeat;
        beatRef.current += 1;
      }
    }, 25);
    setPlaying(true);
  }, [bpm]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch (e) { /* noop */ }
      ctxRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    stop();
    start();
  }, [bpm, playing, start, stop]);

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className={`text-center bg-slate-900 border border-slate-800 rounded-2xl ${compact ? 'py-4' : 'py-6'}`}>
        <p className={`font-mono font-black text-amber-400 ${compact ? 'text-4xl' : 'text-5xl'}`}>
          {bpm}<span className="text-lg text-slate-500"> BPM</span>
        </p>
      </div>
      <input type="range" min="40" max="220" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-amber-500" />
      <div className="grid grid-cols-4 gap-2">
        <button onClick={() => setBpm((b) => Math.max(40, b - 5))} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-2">-5</button>
        <button onClick={() => setBpm((b) => Math.min(220, b + 5))} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-2">+5</button>
        <button
          onClick={playing ? stop : start}
          className={`col-span-2 rounded-xl font-bold py-2 ${playing ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}
        >
          {playing ? '정지' : '시작'}
        </button>
      </div>
      <div className="flex gap-2 justify-center flex-wrap">
        {[60, 80, 100, 120, 140].map((p) => (
          <button key={p} onClick={() => setBpm(p)} className={`px-3 py-1 rounded-lg text-xs font-bold ${bpm === p ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Countdown({ compact = false }) {
  const [setMin, setSetMin] = useState(1);
  const [setSec, setSetSec] = useState(0);
  const [remain, setRemain] = useState(0);
  const [running, setRunning] = useState(false);
  const endRef = useRef(0);
  const rafRef = useRef(null);
  const alarmRef = useRef(null);

  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      alarmRef.current = ctx;
      const now = ctx.currentTime;
      for (let i = 0; i < 3; i += 1) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.4, now + i * 0.4);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.4 + 0.3);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + i * 0.4);
        o.stop(now + i * 0.4 + 0.3);
      }
      setTimeout(() => { try { ctx.close(); } catch (e) { /* noop */ } }, 1500);
    } catch (e) { /* noop */ }
  };

  const tick = useCallback(() => {
    const left = endRef.current - performance.now();
    if (left <= 0) {
      setRemain(0);
      setRunning(false);
      beep();
      return;
    }
    setRemain(left);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = () => {
    const total = (setMin * 60 + setSec) * 1000;
    const base = remain > 0 && !running ? remain : total;
    if (base <= 0) return;
    endRef.current = performance.now() + base;
    rafRef.current = requestAnimationFrame(tick);
    setRunning(true);
  };

  const pause = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    setRemain(0);
  };

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (alarmRef.current) { try { alarmRef.current.close(); } catch (e) { /* noop */ } }
  }, []);

  const display = remain > 0 ? remain : (setMin * 60 + setSec) * 1000;
  const mm = Math.floor(display / 60000);
  const ss = Math.floor((display % 60000) / 1000);

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className={`text-center bg-slate-900 border border-slate-800 rounded-2xl ${compact ? 'py-4' : 'py-8'}`}>
        <p className={`font-mono font-black tabular-nums ${compact ? 'text-5xl' : 'text-6xl'} ${remain > 0 && remain < 10000 ? 'text-red-400' : 'text-amber-400'}`}>
          {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
        </p>
      </div>
      {!running && remain === 0 && (
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-1">
            <input type="number" min="0" max="99" value={setMin} onChange={(e) => setSetMin(Math.max(0, Math.min(99, Number(e.target.value) || 0)))} className="w-16 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-2 py-2 text-center text-lg font-mono" />
            <span className="text-slate-500 text-sm">분</span>
          </div>
          <div className="flex items-center gap-1">
            <input type="number" min="0" max="59" value={setSec} onChange={(e) => setSetSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))} className="w-16 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-2 py-2 text-center text-lg font-mono" />
            <span className="text-slate-500 text-sm">초</span>
          </div>
        </div>
      )}
      <div className="flex gap-2 justify-center flex-wrap">
        {[30, 60, 90, 180, 300].map((sec) => (
          <button key={sec} onClick={() => { setSetMin(Math.floor(sec / 60)); setSetSec(sec % 60); setRemain(0); setRunning(false); }} className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-400 hover:text-white">
            {sec < 60 ? `${sec}초` : `${sec / 60}분`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={reset} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">리셋</button>
        <button onClick={running ? pause : start} className={`col-span-2 rounded-xl font-bold py-3 text-sm ${running ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}>
          {running ? '일시정지' : (remain > 0 ? '계속' : '시작')}
        </button>
      </div>
    </div>
  );
}

// 인터벌 타이머 — "운동 N초 / 휴식 M초 × R세트"를 자동 반복하며 구간 전환 시 비프음.
// HIIT/타바타/서킷에 사용. 준비(prepare) 구간으로 시작 카운트다운을 준다.
export function IntervalTimer({ compact = false }) {
  const [workSec, setWorkSec] = useState(30);
  const [restSec, setRestSec] = useState(15);
  const [rounds, setRounds] = useState(8);
  const [prepSec, setPrepSec] = useState(5);

  // phase: 'idle' | 'prepare' | 'work' | 'rest' | 'done'
  const [phase, setPhase] = useState('idle');
  const [round, setRound] = useState(1);
  const [remain, setRemain] = useState(0); // ms
  const [running, setRunning] = useState(false);

  const endRef = useRef(0);
  const rafRef = useRef(null);
  const ctxRef = useRef(null);
  // 다음 프레임에서 진행할 단계 계획을 담는다(구간 종료 시 사용).
  const planRef = useRef({ phase: 'idle', round: 1 });

  // 비프음. tone: 'work'(높은 2음) | 'rest'(중간 1음) | 'done'(상승 3음) | 'count'(짧은 틱)
  const beep = useCallback((tone) => {
    try {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const blips =
        tone === 'work' ? [[880, 0], [1320, 0.12]]
          : tone === 'rest' ? [[660, 0]]
            : tone === 'done' ? [[660, 0], [880, 0.15], [1180, 0.3]]
              : [[1000, 0]]; // count tick
      for (const [freq, t] of blips) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        const dur = tone === 'count' ? 0.06 : 0.12;
        g.gain.setValueAtTime(0.4, now + t);
        g.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + t);
        o.stop(now + t + dur);
      }
    } catch (e) { /* noop */ }
  }, []);

  const secFor = useCallback((ph) => phaseDurationSec({ prepSec, workSec, restSec }, ph),
    [prepSec, workSec, restSec]);

  // 한 구간을 시작: phase/round 설정 + 종료시각 계산 + 알림음.
  const enterPhase = useCallback((ph, rnd) => {
    setPhase(ph);
    setRound(rnd);
    planRef.current = { phase: ph, round: rnd };
    const dur = secFor(ph) * 1000;
    endRef.current = performance.now() + dur;
    setRemain(dur);
    if (ph === 'work') beep('work');
    else if (ph === 'rest') beep('rest');
  }, [secFor, beep]);

  // 현재 구간이 끝났을 때 다음 구간 결정.
  const advance = useCallback(() => {
    const cfg = { workSec, restSec, rounds, prepSec };
    const nxt = nextPhase(cfg, planRef.current);
    if (nxt.phase === 'done') { finish(); return; }
    enterPhase(nxt.phase, nxt.round);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterPhase, workSec, restSec, rounds, prepSec]);

  const finish = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    setPhase('done');
    setRemain(0);
    planRef.current = { phase: 'done', round: rounds };
    beep('done');
  }, [beep, rounds]);

  const lastTickRef = useRef(-1);
  const tick = useCallback(() => {
    const left = endRef.current - performance.now();
    // 막판 3초 카운트 틱
    const leftSec = Math.ceil(left / 1000);
    if (left > 0 && leftSec <= 3 && leftSec !== lastTickRef.current) {
      lastTickRef.current = leftSec;
      beep('count');
    }
    if (left <= 0) {
      lastTickRef.current = -1;
      advance();
      // advance 가 done 이면 running=false 되어 더 진행 안 함
      if (planRef.current.phase !== 'done') rafRef.current = requestAnimationFrame(tick);
      return;
    }
    setRemain(left);
    rafRef.current = requestAnimationFrame(tick);
  }, [advance, beep]);

  const startPause = () => {
    if (running) {
      cancelAnimationFrame(rafRef.current);
      setRunning(false);
      return;
    }
    if (phase === 'idle' || phase === 'done') {
      // 새로 시작: 준비 구간(없으면 바로 work)
      const f = firstPhase({ prepSec });
      enterPhase(f.phase, f.round);
    } else {
      // 일시정지 후 재개: 남은 시간 기준으로 종료시각 재설정
      endRef.current = performance.now() + remain;
    }
    rafRef.current = requestAnimationFrame(tick);
    setRunning(true);
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    setPhase('idle');
    setRound(1);
    setRemain(0);
    lastTickRef.current = -1;
    planRef.current = { phase: 'idle', round: 1 };
  };

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (ctxRef.current) { try { ctxRef.current.close(); } catch (e) { /* noop */ } }
  }, []);

  const totalSec = totalDurationSec({ workSec, restSec, rounds, prepSec });
  const totalLabel = `${Math.floor(totalSec / 60)}분 ${totalSec % 60}초`;

  const phaseLabel = phase === 'prepare' ? '준비' : phase === 'work' ? '운동' : phase === 'rest' ? '휴식' : phase === 'done' ? '완료' : '대기';
  const phaseColor = phase === 'work' ? 'text-emerald-400' : phase === 'rest' ? 'text-sky-400' : phase === 'prepare' ? 'text-amber-400' : phase === 'done' ? 'text-emerald-400' : 'text-slate-400';
  const ringBg = phase === 'work' ? 'bg-emerald-500/10 border-emerald-500/40' : phase === 'rest' ? 'bg-sky-500/10 border-sky-500/40' : phase === 'prepare' ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-900 border-slate-800';

  const showSec = Math.ceil(remain / 1000);
  const mm = Math.floor(showSec / 60);
  const ss = showSec % 60;
  const bigTime = phase === 'idle' ? '준비' : phase === 'done' ? '완료!' : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  const numField = (label, value, setter, min, max, unit) => (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number" min={min} max={max} value={value}
          onChange={(e) => setter(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          disabled={running}
          className="w-16 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-2 py-2 text-center text-lg font-mono disabled:opacity-50"
        />
        {unit && <span className="text-slate-500 text-xs">{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className={`text-center border rounded-2xl ${ringBg} ${compact ? 'py-4' : 'py-6'}`}>
        <p className={`font-bold ${phaseColor} ${compact ? 'text-sm' : 'text-base'}`}>
          {phaseLabel}
          {(phase === 'work' || phase === 'rest') && (
            <span className="text-slate-500 font-mono"> · {round}/{rounds}</span>
          )}
        </p>
        <p className={`font-mono font-black tabular-nums ${phaseColor} ${compact ? 'text-5xl' : 'text-6xl'}`}>{bigTime}</p>
      </div>

      {phase === 'idle' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {numField('운동', workSec, setWorkSec, 1, 599, '초')}
            {numField('휴식', restSec, setRestSec, 0, 599, '초')}
            {numField('라운드', rounds, setRounds, 1, 99, '회')}
            {numField('준비', prepSec, setPrepSec, 0, 60, '초')}
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {[
              ['타바타', 20, 10, 8],
              ['HIIT', 30, 15, 8],
              ['EMOM', 50, 10, 10],
            ].map(([label, w, r, rd]) => (
              <button
                key={label}
                onClick={() => { setWorkSec(w); setRestSec(r); setRounds(rd); }}
                className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-400 hover:text-white"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-center text-[11px] text-slate-500">총 {totalLabel}</p>
        </>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button onClick={reset} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">리셋</button>
        <button
          onClick={startPause}
          className={`col-span-2 rounded-xl font-bold py-3 text-sm ${running ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}
        >
          {running ? '일시정지' : (phase === 'idle' || phase === 'done' ? '시작' : '계속')}
        </button>
      </div>
    </div>
  );
}

export default function TimerTool({ onBack }) {
  const [tab, setTab] = useState('stopwatch');
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">초시계 · 타이머 · 메트로놈</h2>
        <span className="w-12" />
      </div>
      <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
        {[
          ['stopwatch', '초시계'],
          ['countdown', '타이머'],
          ['interval', '인터벌'],
          ['metronome', '메트로놈'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${tab === k ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'stopwatch' ? <Stopwatch />
        : tab === 'countdown' ? <Countdown />
          : tab === 'interval' ? <IntervalTimer />
            : <Metronome />}
    </div>
  );
}
