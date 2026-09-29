// components/common/TimeField.jsx
// [아날로그 시계 2026-09-29] 스크롤 목록 방식이 번거로워 아날로그 시계 다이얼로 교체.
// 시(오전/오후 토글 + 12시간 다이얼) → 분 다이얼 순으로 탭/드래그로 고른다.
// 외부 API는 그대로다(value "HH:MM" 문자열, onChange("HH:MM"), stepMinutes, className,
// placeholder) — Schedule.jsx의 6개 호출부는 수정할 필요가 없다.
// 순수 React/SVG라 PC·폰·태블릿에서 모양과 조작이 동일하다(예약 시간 통일 2026-09-17 취지 유지).
import { useState, useRef, useEffect, useCallback } from 'react';

const pad2 = n => String(n).padStart(2, '0');

const SIZE = 216;
const C = SIZE / 2;
const R_LABEL = 78;   // 숫자 라벨 반지름
const R_HAND = 70;    // 시계바늘 끝 반지름
const R_DOT = 17;     // 선택 원 반지름

const polar = (deg, r) => {
  const rad = (deg - 90) * Math.PI / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
};

export default function TimeField({ value, onChange, stepMinutes = 5, className = 'input', placeholder = '--:--' }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('hour'); // 'hour' | 'minute'
  const boxRef = useRef(null);
  const dialRef = useRef(null);
  const draggingRef = useRef(false);

  const [hh, mm] = String(value || '').split(':');
  const hour = hh !== undefined && hh !== '' && !Number.isNaN(Number(hh)) ? Number(hh) : null;
  const minute = mm !== undefined && mm !== '' && !Number.isNaN(Number(mm)) ? Number(mm) : null;
  const isPM = hour !== null ? hour >= 12 : false;
  const step = stepMinutes > 0 ? stepMinutes : 1;

  useEffect(() => {
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h, { passive: true });
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('touchstart', h);
    };
  }, []);

  // 열 때는 항상 시 다이얼부터 시작한다.
  useEffect(() => { if (open) setMode('hour'); }, [open]);

  const commit = useCallback((h, m) => onChange(`${pad2(h)}:${pad2(m)}`), [onChange]);

  // 12시간 다이얼 값(1~12) + 오전/오후 → 24시간제 시
  const to24 = (h12, pm) => (h12 % 12) + (pm ? 12 : 0);

  const setAmPm = pm => {
    const base = hour === null ? 9 : hour % 12;
    commit(base + (pm ? 12 : 0), minute ?? 0);
  };

  // 포인터 위치 → 다이얼 값으로 변환
  const pick = useCallback((clientX, clientY, final) => {
    const el = dialRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - (rect.left + rect.width / 2);
    const y = clientY - (rect.top + rect.height / 2);
    let deg = Math.atan2(y, x) * 180 / Math.PI + 90; // 12시 방향이 0도
    if (deg < 0) deg += 360;

    if (mode === 'hour') {
      const h12 = Math.round(deg / 30) % 12 || 12;
      commit(to24(h12, isPM || (hour === null ? false : hour >= 12)), minute ?? 0);
      if (final) setMode('minute');
    } else {
      let m = Math.round(deg / 6) % 60;
      m = Math.round(m / step) * step;
      if (m >= 60) m = 0;
      commit(hour ?? 0, m);
      if (final) setOpen(false);
    }
  }, [mode, commit, isPM, hour, minute, step]);

  const onPointerDown = e => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pick(e.clientX, e.clientY, false);
  };
  const onPointerMove = e => {
    if (!draggingRef.current) return;
    pick(e.clientX, e.clientY, false);
  };
  const onPointerUp = e => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    pick(e.clientX, e.clientY, true);
  };

  // 현재 선택 각도(바늘 방향)
  const selectedDeg = mode === 'hour'
    ? (hour !== null ? ((hour % 12) * 30) : null)
    : (minute !== null ? minute * 6 : null);

  const hourLabels = Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i));
  const minuteLabels = Array.from({ length: 12 }, (_, i) => i * 5);
  const labels = mode === 'hour' ? hourLabels : minuteLabels;
  const isLabelSelected = v => (mode === 'hour'
    ? hour !== null && ((hour % 12) || 12) === v
    : minute !== null && minute === v);

  // 분 다이얼: 라벨이 없는 분(예: 23분)이 선택돼 있으면 끝에 작은 점을 따로 그린다.
  const minuteOffLabel = mode === 'minute' && minute !== null && minute % 5 !== 0;

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`${className} text-left flex items-center justify-between font-mono`}>
        <span className={value ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500'}>
          {value || placeholder}
        </span>
        <span className="text-slate-500 text-xs ml-2">🕒</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl shadow-xl p-3 select-none">
          {/* 상단: HH : MM + 오전/오후 */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center font-mono text-2xl font-bold">
              <button type="button" onClick={() => setMode('hour')}
                className={`px-2 py-0.5 rounded-lg transition-colors ${mode === 'hour' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {hour !== null ? pad2(hour) : '--'}
              </button>
              <span className="text-slate-500">:</span>
              <button type="button" onClick={() => setMode('minute')}
                className={`px-2 py-0.5 rounded-lg transition-colors ${mode === 'minute' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {minute !== null ? pad2(minute) : '--'}
              </button>
            </div>
            <div className="flex flex-col rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 text-xs">
              <button type="button" onClick={() => setAmPm(false)}
                className={`px-2 py-1 ${hour !== null && !isPM ? 'bg-amber-500 text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                오전
              </button>
              <button type="button" onClick={() => setAmPm(true)}
                className={`px-2 py-1 ${hour !== null && isPM ? 'bg-amber-500 text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                오후
              </button>
            </div>
          </div>

          {/* 아날로그 다이얼 */}
          <svg ref={dialRef} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="mx-auto block touch-none cursor-pointer"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={() => { draggingRef.current = false; }}>
            <circle cx={C} cy={C} r={C - 2} className="fill-slate-100 dark:fill-slate-800" />
            {selectedDeg !== null && (() => {
              const [x, y] = polar(selectedDeg, R_HAND);
              return (
                <g>
                  <line x1={C} y1={C} x2={x} y2={y} className="stroke-amber-500" strokeWidth="2" />
                  <circle cx={x} cy={y} r={R_DOT} className="fill-amber-500" />
                </g>
              );
            })()}
            <circle cx={C} cy={C} r="3.5" className="fill-amber-500" />
            {labels.map((v, i) => {
              const [x, y] = polar(i * 30, R_LABEL);
              const sel = isLabelSelected(v);
              return (
                <text key={v} x={x} y={y} textAnchor="middle" dominantBaseline="central"
                  className={sel ? 'fill-white font-bold' : 'fill-slate-700 dark:fill-slate-200'}
                  fontSize="14" pointerEvents="none">
                  {mode === 'minute' ? pad2(v) : v}
                </text>
              );
            })}
            {minuteOffLabel && (() => {
              const [x, y] = polar(minute * 6, R_HAND);
              return <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                className="fill-white font-bold" fontSize="12" pointerEvents="none">{pad2(minute)}</text>;
            })()}
          </svg>

          <p className="text-center text-[11px] text-slate-500 mt-1">
            {mode === 'hour' ? '시를 누르거나 끌어서 선택' : `분을 선택 (${step}분 단위)`}
          </p>
        </div>
      )}
    </div>
  );
}
