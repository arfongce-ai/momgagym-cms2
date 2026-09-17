// components/common/TimeField.jsx
// [예약 시간 통일 2026-09-17] 네이티브 <input type="time">을 대체하는 커스텀 시간 선택기.
// 문제: type="time"은 OS/브라우저가 그리는 위젯이라 PC(스피너·24h)·폰(휠·보통 12h AM/PM)·
// 테블릿이 서로 다르게 보이고 조작 방식도 다르다 — "PC랑 폰이랑 테블릿이 다 달라"는
// 불만의 원인이 바로 이 네이티브 렌더링 차이다. 이 컴포넌트는 순수 React/CSS로 그려서
// 어떤 기기에서 열어도 시:분 목록 UI가 완전히 동일하다(MemberPicker와 같은 방식).
import { useState, useRef, useEffect } from 'react';

const pad2 = n => String(n).padStart(2, '0');

export default function TimeField({ value, onChange, stepMinutes = 5, className = 'input', placeholder = '--:--' }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const hourListRef = useRef(null);
  const minuteListRef = useRef(null);

  useEffect(() => {
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // 열릴 때 현재 선택된 시/분으로 스크롤 이동 — 기기 상관없이 항상 같은 위치에서 시작.
  useEffect(() => {
    if (!open) return;
    const scrollTo = (ref) => {
      const el = ref.current?.querySelector('[data-selected="true"]');
      if (el) el.scrollIntoView({ block: 'center' });
    };
    scrollTo(hourListRef);
    scrollTo(minuteListRef);
  }, [open]);

  const [hh, mm] = String(value || '').split(':');
  const hour = hh !== undefined && hh !== '' ? Number(hh) : null;
  const minute = mm !== undefined && mm !== '' ? Number(mm) : null;

  const step = stepMinutes > 0 ? stepMinutes : 1;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);

  const commit = (h, m) => onChange(`${pad2(h)}:${pad2(m)}`);

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`${className} text-left flex items-center justify-between font-mono`}>
        <span className={value ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500'}>
          {value || placeholder}
        </span>
        <span className="text-slate-500 text-xs ml-2">▼</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-40 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden flex">
          <div ref={hourListRef} className="flex-1 max-h-52 overflow-y-auto border-r border-slate-200 dark:border-slate-800">
            {hours.map(h => (
              <button key={h} type="button" data-selected={h === hour}
                onClick={() => commit(h, minute ?? 0)}
                className={`w-full text-center px-2 py-1.5 text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-800
                  ${h === hour ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold' : 'text-slate-700 dark:text-slate-200'}`}>
                {pad2(h)}
              </button>
            ))}
          </div>
          <div ref={minuteListRef} className="flex-1 max-h-52 overflow-y-auto">
            {minutes.map(m => (
              <button key={m} type="button" data-selected={m === minute}
                onClick={() => { commit(hour ?? 0, m); setOpen(false); }}
                className={`w-full text-center px-2 py-1.5 text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-800
                  ${m === minute ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold' : 'text-slate-700 dark:text-slate-200'}`}>
                {pad2(m)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
