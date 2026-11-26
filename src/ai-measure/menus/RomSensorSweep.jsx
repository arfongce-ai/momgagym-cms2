// ai-measure/menus/RomSensorSweep.jsx
// 고니오메타 쓸기 모드(몸통) — 폰을 세로로(긴 변이 척추 방향, 화면 바깥) 등에 대고 아래 지점부터
// 위 지점까지 한 곳씩 1초 멈추면 자동으로 기록된다. 지점 간 기울기 차이(위 − 아래)가 구간 각도다.
// 카메라 측정의 보조·보완용이며, 정확도는 실기기 확인 전이다(근사값).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createTiltTracker, hapticFeedback, roundToStep } from '../core/sensorTilt';
import { createSweepRecorder, createAutoMarker, computeSegments, profilePoints, getSweepPreset } from '../core/sensorSweep';

const PLANE_LABEL = { yz: '앞뒤(굽힘·폄)', yx: '옆(가쪽 굽힘)', xz: '돌림' };

export default function RomSensorSweep({ jointName, jointKey, plane = 'yz', onBack, onComplete }) {
  const preset = getSweepPreset(jointKey, plane);
  const points = preset?.points || [];
  const recRef = useRef(null);
  if (!recRef.current) recRef.current = createSweepRecorder();
  const autoRef = useRef(null);
  if (!autoRef.current) autoRef.current = createAutoMarker();
  const [liveDeg, setLiveDeg] = useState(null);
  const [marks, setMarks] = useState([]);       // [{key, angle, range, quality}]
  const marksRef = useRef([]);
  const [flip, setFlip] = useState(false);
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState(0);  // 멈춘 채 유지한 비율(0~1)
  const [tick, setTick] = useState(0);          // 곡선 갱신용
  const lastUiRef = useRef(0);

  const setMarksBoth = (next) => { marksRef.current = next; setMarks(next); };

  // 다음 지점을 기록(자동·수동 공용). 표본이 모자라면 null.
  const markNext = () => {
    const pt = points[marksRef.current.length];
    if (!pt) return false;
    const m = recRef.current.mark(pt.key, Date.now());
    if (!m) { setMsg('센서 신호가 부족합니다 — 폰을 댄 채 1초만 멈춰 주세요.'); return false; }
    setMsg(m.quality === 'shaky'
      ? `${pt.label}: 흔들림이 있었습니다(±${(m.range / 2).toFixed(1)}°) — 참고용으로 표시됩니다. 다시 하려면 ‘마지막 취소’.`
      : '');
    hapticFeedback([30]);
    setMarksBoth([...marksRef.current, m]);
    return true;
  };
  const markNextRef = useRef(markNext);
  markNextRef.current = markNext;

  useEffect(() => {
    const rec = recRef.current;
    const auto = autoRef.current;
    rec.reset(); auto.reset();
    const tracker = createTiltTracker({
      plane,
      onSample: ({ angleDeg, accMag }) => {
        if (angleDeg == null) return;
        const now = Date.now();
        rec.push(angleDeg, accMag, now);
        const r = auto.push(angleDeg, accMag, now);
        if (r.fire) markNextRef.current();
        if (now - lastUiRef.current < 120) return;
        lastUiRef.current = now;
        setLiveDeg(roundToStep(angleDeg, 0.5));
        setProgress(marksRef.current.length >= points.length ? 0 : r.progress);
        setTick((v) => (v + 1) % 1000000);
      },
    });
    tracker.start();
    return () => tracker.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plane]);

  const nextPoint = points[Math.min(marks.length, points.length)] || null;
  const done = marks.length >= points.length && points.length > 0;

  const undo = () => { setMarksBoth(marksRef.current.slice(0, -1)); setMsg(''); autoRef.current.disarm(); }; // 취소 후엔 폰을 한 번 움직였다 멈춰야 다시 자동 기록(같은 값 즉시 재기록 방지)
  const restart = () => { setMarksBoth([]); setMsg(''); recRef.current.reset(); autoRef.current.reset(); };

  const segments = useMemo(
    () => computeSegments(marks, preset?.segments || [], { flip }),
    [marks, preset, flip],
  );
  const shown = segments.filter((s) => s.value != null);
  const pts = useMemo(() => profilePoints(recRef.current.series().slice(-400), { flip, width: 300, height: 70 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, flip]);

  const save = () => {
    const primary = shown.find((s) => s.key === 'thoracolumbar') || shown[0];
    if (!primary) return;
    const shakyCount = marks.filter((m) => m.quality === 'shaky').length;
    const confidence = Math.round(Math.max(0.3, 0.8 - 0.15 * shakyCount) * 100) / 100;
    const movement = plane === 'yx' ? '측굴 (Lateral flexion) · 쓸기 측정' : plane === 'xz' ? '회전 (Rotation) · 쓸기 측정' : '굴곡·신전 · 쓸기 측정';
    hapticFeedback([40]);
    onComplete?.(
      { single: { angle: Math.abs(primary.value), recordedAt: new Date().toISOString() } },
      {
        movement, jointKey, jointName,
        quality: {
          confidence,
          method: 'sweep_dual_point',
          plane,
          flip,
          primary: primary.key,
          segments: shown.map((s) => ({ key: s.key, value: s.value, ok: s.ok })),
          marks: marks.map((m) => ({ key: m.key, angle: m.angle, range: m.range, quality: m.quality })),
        },
      },
    );
  };

  if (!preset) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 일반 측정</button>
        <h2 className="measure-title">쓸기 · {jointName || '몸통'}</h2>
        <span className="w-12" />
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] leading-relaxed text-slate-700 dark:text-slate-200 space-y-1">
        <p className="font-black">이렇게 하세요 ({PLANE_LABEL[plane] || plane})</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>끝 자세(예: 최대로 숙인 자세)를 잡고 그대로 유지합니다.{plane === 'xz' ? ' (돌림은 앉아 팔짱 끼고 몸통을 바닥과 평행하게 숙여 끝까지 돌린 자세)' : ''}</li>
          <li>폰을 세로로, 화면이 바깥을 향하게 아래 지점부터 댑니다.</li>
          <li>지점마다 <b>1초 멈추면 자동으로 기록</b>됩니다. 다음 지점으로 천천히 옮기세요.</li>
        </ol>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">현재 기울기(참고)</p>
        <p className="font-black tabular-nums text-amber-300" style={{ fontSize: '3rem', lineHeight: 1.1 }}>{liveDeg == null ? '—' : `${liveDeg}°`}</p>
        <p className="mt-1 text-sm text-slate-200">
          {nextPoint ? <>지금 댈 곳: <b className="text-emerald-300">{nextPoint.label}</b> ({marks.length + 1}/{points.length})</> : '모든 지점을 기록했습니다'}
        </p>
        {nextPoint && (
          <div className="mx-auto mt-2 h-2 w-48 overflow-hidden rounded-full bg-slate-700" aria-label="멈춤 진행">
            <div className="h-full bg-emerald-400 transition-[width] duration-100" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {nextPoint && <p className="mt-1 text-[11px] text-slate-400">{progress > 0 ? '그대로 멈추세요…' : '폰을 대고 멈추면 시작됩니다'}</p>}
      </div>

      {pts && (
        <svg viewBox="0 0 300 70" className="h-16 w-full rounded-lg bg-slate-100 dark:bg-slate-800" preserveAspectRatio="none" aria-label="기울기 곡선">
          <polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
        </svg>
      )}

      {msg && <p className="text-xs font-bold text-amber-700 dark:text-amber-300">{msg}</p>}

      {marks.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1">
          <p className="text-xs font-black text-slate-700 dark:text-slate-200">기록한 지점</p>
          {marks.map((m) => {
            const pt = points.find((p) => p.key === m.key);
            return (
              <p key={`${m.key}-${m.t}`} className="text-[12px] text-slate-600 dark:text-slate-300">
                · {pt?.label || m.key}: {m.angle}° {m.quality === 'shaky' ? <span className="font-black text-amber-600">(흔들림)</span> : null}
              </p>
            );
          })}
        </div>
      )}

      {shown.length > 0 && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1">
          <p className="text-xs font-black text-emerald-800 dark:text-emerald-200">구간 각도 (위 − 아래)</p>
          {shown.map((s) => (
            <p key={s.key} className="text-sm text-slate-700 dark:text-slate-200">
              {s.label}: <b className="tabular-nums">{s.value}°</b>{' '}
              {s.ok ? null : <span className="text-[11px] font-black text-amber-600">참고용(흔들림)</span>}
              <span className="text-[10px] text-slate-500">{s.textbook ? ' 교재 방식' : ' 근사'}</span>
            </p>
          ))}
          <p className="text-[11px] text-slate-500">값이 반대 부호로 보이면 ‘부호 뒤집기’를 누르세요(폰 방향에 따라 반대일 수 있음). 정상치는 교재 사진에서 확인하지 못해 각도만 기록합니다.</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => markNext()} disabled={done}
          className="rounded-xl border border-amber-500/60 bg-amber-500/15 px-2 py-3 text-xs font-black text-amber-800 dark:text-amber-200 disabled:opacity-40">직접 기록</button>
        <button onClick={undo} disabled={!marks.length}
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 py-3 text-xs font-black text-slate-600 dark:text-slate-300 disabled:opacity-50">마지막 취소</button>
        <button onClick={restart}
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 py-3 text-xs font-black text-slate-600 dark:text-slate-300">처음부터</button>
        <button onClick={() => setFlip((v) => !v)} aria-pressed={flip}
          className={`col-span-3 rounded-xl border px-2 py-2.5 text-xs font-black ${flip ? 'border-sky-500/60 bg-sky-500/20 text-sky-800 dark:text-sky-200' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
          부호 뒤집기 {flip ? '(켜짐)' : ''}
        </button>
      </div>

      <button onClick={save} disabled={!shown.length}
        className="w-full rounded-xl bg-emerald-500 px-4 py-4 text-base font-black text-slate-950 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 active:scale-[0.99]">
        결과 저장
      </button>
    </div>
  );
}
