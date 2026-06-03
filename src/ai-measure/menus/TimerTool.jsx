// ai-measure/menus/TimerTool.jsx
// 메뉴 11: 초시계 · 메트로놈 (카메라/AI 불필요)
//  - 초시계: performance.now() 기반 정밀 측정, 랩 기록
//  - 메트로놈: Web Audio API 정확 박자 (setInterval 드리프트 회피)
import { useRef, useState, useEffect, useCallback } from 'react';

/* ───────── 초시계 ───────── */
function Stopwatch() {
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
    accRef.current = 0; setElapsed(0); setRunning(false); setLaps([]);
  };
  const lap = () => { if (running) setLaps(l => [elapsed, ...l]); };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const fmt = (ms) => {
    const cs = Math.floor((ms % 1000) / 10);
    const s  = Math.floor(ms / 1000) % 60;
    const m  = Math.floor(ms / 60000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  };

  return (
    <div className="space-y-4">
      <div className="text-center bg-slate-900 border border-slate-800 rounded-2xl py-8">
        <p className="font-mono font-black text-5xl text-amber-400 tabular-nums">{fmt(elapsed)}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={reset} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">리셋</button>
        <button onClick={startStop}
          className={`rounded-xl font-bold py-3 text-sm ${running ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}>
          {running ? '정지' : '시작'}
        </button>
        <button onClick={lap} disabled={!running}
          className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm disabled:opacity-40">랩</button>
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

/* ───────── 메트로놈 ───────── */
function Metronome() {
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

  const start = () => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    nextNoteRef.current = ctx.currentTime + 0.05;
    beatRef.current = 0;

    // 스케줄러: 25ms 마다 다음 박자를 미리 예약 (정확한 타이밍)
    timerRef.current = setInterval(() => {
      const secPerBeat = 60.0 / bpm;
      while (nextNoteRef.current < ctx.currentTime + 0.1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const isDown = beatRef.current % 4 === 0; // 4박마다 강박
        osc.frequency.value = isDown ? 1500 : 1000;
        gain.gain.setValueAtTime(isDown ? 0.5 : 0.3, nextNoteRef.current);
        gain.gain.exponentialRampToValueAtTime(0.001, nextNoteRef.current + 0.05);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(nextNoteRef.current);
        osc.stop(nextNoteRef.current + 0.05);
        nextNoteRef.current += secPerBeat;
        beatRef.current++;
      }
    }, 25);
    setPlaying(true);
  };

  useEffect(() => () => {
    // 언마운트 시 interval 정리 + AudioContext 완전 해제(누적 방지)
    if (timerRef.current) clearInterval(timerRef.current);
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch (e) { /* noop */ }
      ctxRef.current = null;
    }
  }, []);
  // bpm 변경 시 재생 중이면 재시작
  useEffect(() => { if (playing) { stop(); start(); } /* eslint-disable-next-line */ }, [bpm]);

  return (
    <div className="space-y-4">
      <div className="text-center bg-slate-900 border border-slate-800 rounded-2xl py-6">
        <p className="font-mono font-black text-5xl text-amber-400">{bpm}<span className="text-lg text-slate-500"> BPM</span></p>
      </div>
      <input type="range" min="40" max="220" value={bpm} onChange={e => setBpm(Number(e.target.value))}
        className="w-full accent-amber-500" />
      <div className="grid grid-cols-4 gap-2">
        <button onClick={() => setBpm(b => Math.max(40, b - 5))} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-2">−5</button>
        <button onClick={() => setBpm(b => Math.min(220, b + 5))} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-2">+5</button>
        <button onClick={playing ? stop : start}
          className={`col-span-2 rounded-xl font-bold py-2 ${playing ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}>
          {playing ? '정지' : '시작'}
        </button>
      </div>
      <div className="flex gap-2 justify-center">
        {[60, 80, 100, 120, 140].map(p => (
          <button key={p} onClick={() => setBpm(p)}
            className={`px-3 py-1 rounded-lg text-xs font-bold ${bpm === p ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>{p}</button>
        ))}
      </div>
    </div>
  );
}

/* ───────── 타이머 (카운트다운) ───────── */
function Countdown() {
  const [setMin, setSetMin] = useState(1);
  const [setSec, setSetSec] = useState(0);
  const [remain, setRemain] = useState(0);     // ms
  const [running, setRunning] = useState(false);
  const endRef = useRef(0);
  const rafRef = useRef(null);
  const alarmRef = useRef(null);

  const tick = useCallback(() => {
    const left = endRef.current - performance.now();
    if (left <= 0) {
      setRemain(0); setRunning(false);
      beep();
      return;
    }
    setRemain(left);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      alarmRef.current = ctx;
      const now = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.4, now + i * 0.4);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.4 + 0.3);
        o.connect(g); g.connect(ctx.destination);
        o.start(now + i * 0.4); o.stop(now + i * 0.4 + 0.3);
      }
      setTimeout(() => { try { ctx.close(); } catch(e){} }, 1500);
    } catch (e) { /* noop */ }
  };

  const start = () => {
    const total = (setMin * 60 + setSec) * 1000;
    const base = remain > 0 && !running ? remain : total;
    if (base <= 0) return;
    endRef.current = performance.now() + base;
    rafRef.current = requestAnimationFrame(tick);
    setRunning(true);
  };
  const pause = () => { cancelAnimationFrame(rafRef.current); setRunning(false); };
  const reset = () => { cancelAnimationFrame(rafRef.current); setRunning(false); setRemain(0); };

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (alarmRef.current) { try { alarmRef.current.close(); } catch(e){} }
  }, []);

  const display = remain > 0 ? remain : (setMin * 60 + setSec) * 1000;
  const mm = Math.floor(display / 60000);
  const ss = Math.floor((display % 60000) / 1000);

  return (
    <div className="space-y-4">
      <div className="text-center bg-slate-900 border border-slate-800 rounded-2xl py-8">
        <p className={`font-mono font-black text-6xl tabular-nums ${remain>0&&remain<10000?'text-red-400':'text-amber-400'}`}>
          {String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}
        </p>
      </div>
      {!running && remain === 0 && (
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-1">
            <input type="number" min="0" max="99" value={setMin} onChange={e=>setSetMin(Math.max(0,Math.min(99,Number(e.target.value)||0)))}
              className="w-16 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-2 py-2 text-center text-lg font-mono"/>
            <span className="text-slate-500 text-sm">분</span>
          </div>
          <div className="flex items-center gap-1">
            <input type="number" min="0" max="59" value={setSec} onChange={e=>setSetSec(Math.max(0,Math.min(59,Number(e.target.value)||0)))}
              className="w-16 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-2 py-2 text-center text-lg font-mono"/>
            <span className="text-slate-500 text-sm">초</span>
          </div>
        </div>
      )}
      <div className="flex gap-2 justify-center">
        {[30, 60, 90, 180, 300].map(sec=>(
          <button key={sec} onClick={()=>{setSetMin(Math.floor(sec/60));setSetSec(sec%60);setRemain(0);setRunning(false);}}
            className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-400 hover:text-white">
            {sec<60?`${sec}초`:`${sec/60}분`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={reset} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">리셋</button>
        <button onClick={running?pause:start}
          className={`col-span-2 rounded-xl font-bold py-3 text-sm ${running?'bg-red-500 text-white':'bg-amber-500 text-slate-950'}`}>
          {running?'일시정지':(remain>0?'계속':'시작')}
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
        <button onClick={onBack} className="text-slate-400 text-sm">← 메뉴</button>
        <h2 className="text-lg font-black">초시계 · 타이머 · 메트로놈</h2>
        <span className="w-12" />
      </div>
      <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
        {[['stopwatch','초시계'],['countdown','타이머'],['metronome','메트로놈']].map(([k,l])=>(
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${tab === k ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>{l}</button>
        ))}
      </div>
      {tab === 'stopwatch' ? <Stopwatch /> : tab === 'countdown' ? <Countdown /> : <Metronome />}
    </div>
  );
}
