// components/report/ChangeSummaryPanel.jsx
// [전/후 변화 요약 2026-08-31] measurementComparison.js의 summarizeChanges() 결과를
// 그대로 받아 그리는 공용 카드 — 자세·ROM·보행·점프·리프팅·SLST·스쿼트 리포트가
// 전부 이 하나의 컴포넌트를 재사용한다(화면마다 새로 만들지 않음).
export default function ChangeSummaryPanel({ summary, title = '이전 측정 대비 변화' }) {
  if (!summary) return null;
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-black text-white">{title}</p>
        {summary.previousDate && <span className="text-[11px] text-slate-500">{summary.previousDate} → 오늘</span>}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{summary.narrative}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {summary.rows.map((r) => {
          const tone = r.direction === 'improved'
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : r.direction === 'worsened'
              ? 'border-red-500/30 bg-red-500/10'
              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40';
          const arrowTone = r.direction === 'improved'
            ? 'text-emerald-700 dark:text-emerald-300'
            : r.direction === 'worsened'
              ? 'text-red-700 dark:text-red-300'
              : 'text-slate-500';
          return (
            <div key={r.key} className={`rounded-md border px-2.5 py-2 ${tone}`}>
              <p className="text-[10px] font-bold text-slate-500">{r.label}</p>
              <p className="text-sm font-black text-white">
                {r.curVal}{r.unit}
                <span className={`ml-1 text-[11px] font-bold ${arrowTone}`}>
                  {r.diff > 0 ? '▲' : r.diff < 0 ? '▼' : '–'}{Math.abs(r.diff)}{r.unit}
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
