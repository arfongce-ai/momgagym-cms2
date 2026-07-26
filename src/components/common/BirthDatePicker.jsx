// BirthDatePicker.jsx — 년/월/일 3개 select 조합 날짜 선택
// iOS/Android 캘린더 위젯 불일치 제거 (Gemini 교차검증 권고)
// YYYY-MM-DD 문자열로 변환하여 onChange 호출

const CUR_YEAR = new Date().getFullYear();

function getDaysInMonth(year, month) {
  if (!year || !month) return 31;
  return new Date(Number(year), Number(month), 0).getDate();
}

/**
 * @param {string}   value      — 'YYYY-MM-DD' 또는 빈 문자열
 * @param {function} onChange   — (value: string) => void
 * @param {string}   label      — 필드 레이블
 * @param {number}   yearStart  — 시작 연도 (기본: 현재-80)
 * @param {number}   yearEnd    — 종료 연도 (기본: 현재)
 */
export default function BirthDatePicker({
  value    = '',
  onChange,
  label    = '날짜',
  yearStart,
  yearEnd,
}) {
  const start = yearStart ?? (CUR_YEAR - 80);
  const end   = yearEnd   ?? CUR_YEAR;

  const years  = Array.from({ length: end - start + 1 }, (_, i) => end - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const parts = value ? value.split('-') : ['', '', ''];
  const year  = parts[0] || '';
  const month = parts[1] ? String(parseInt(parts[1])) : '';
  const day   = parts[2] ? String(parseInt(parts[2])) : '';

  const maxDay = getDaysInMonth(year, month);
  const days   = Array.from({ length: maxDay }, (_, i) => i + 1);

  const emit = (y, m, d) => {
    if (y && m && d) {
      onChange(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    } else {
      onChange('');
    }
  };

  const sel = `
    flex-1 min-w-0 bg-slate-800 border border-slate-700 text-slate-100
    rounded-xl px-2 py-2.5 text-sm focus:outline-none focus:border-amber-500
    cursor-pointer appearance-none
  `;

  return (
    <div>
      {label && (
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
          {label}
        </label>
      )}
      <div className="flex gap-1.5">
        {/* 년도 */}
        <select
          value={year}
          onChange={e => emit(e.target.value, month, day)}
          className={sel}
        >
          <option value="">년도</option>
          {years.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>

        {/* 월 */}
        <select
          value={month}
          onChange={e => emit(year, e.target.value, day)}
          className={sel}
        >
          <option value="">월</option>
          {months.map(m => <option key={m} value={m}>{m}월</option>)}
        </select>

        {/* 일 */}
        <select
          value={day}
          onChange={e => emit(year, month, e.target.value)}
          className={sel}
        >
          <option value="">일</option>
          {days.map(d => <option key={d} value={d}>{d}일</option>)}
        </select>
      </div>
    </div>
  );
}
