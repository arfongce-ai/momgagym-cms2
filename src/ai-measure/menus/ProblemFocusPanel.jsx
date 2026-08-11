const SEVERITY = {
  normal: {
    label: '안정',
    light: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dark: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  },
  caution: {
    label: '주의',
    light: 'border-amber-200 bg-amber-50 text-amber-700',
    dark: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  },
  risk: {
    label: '집중',
    light: 'border-red-200 bg-red-50 text-red-700',
    dark: 'border-red-500/30 bg-red-500/10 text-red-200',
  },
};

export default function ProblemFocusPanel({ focus, context, variant = 'dark' }) {
  if (!focus) return null;
  const tone = SEVERITY[focus.severity] || SEVERITY.caution;
  const isLight = variant === 'light';
  const shell = isLight
    ? 'border-slate-200 bg-white text-slate-900'
    : 'border-slate-300/70 dark:border-slate-700/70 bg-slate-100/40 dark:bg-slate-800/40 text-slate-800 dark:text-slate-100';
  const subtle = isLight ? 'text-slate-500' : 'text-slate-500 dark:text-slate-400';
  const item = isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60';
  const chip = tone[isLight ? 'light' : 'dark'];
  const sourceCount = context?.sources?.length || 0;
  const outputLabel = focus.outputMode === 'photo' ? '사진 리포트' : focus.outputMode === 'video' ? '영상 리포트' : '리포트';

  return (
    <section className={`rounded-xl border p-4 ${shell}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[11px] font-black uppercase tracking-[0.16em] ${subtle}`}>Problem Focus</p>
          <h2 className="mt-1 text-base font-black">문제점 확인 중심 요약</h2>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${chip}`}>{tone.label}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${isLight ? 'border-slate-200 text-slate-600' : 'border-slate-400 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{outputLabel}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${isLight ? 'border-sky-200 text-sky-700' : 'border-sky-500/30 text-sky-200'}`}>
            보강 {sourceCount}건
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm font-bold leading-relaxed">{focus.primaryFinding}</p>

      {focus.issues?.length > 0 && (
        <div className="mt-3 grid gap-2">
          {focus.issues.slice(0, 3).map((issue, index) => (
            <div key={`${issue.text}-${index}`} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${item}`}>
              <span className="font-black">확인 {index + 1}. </span>{issue.text}
            </div>
          ))}
        </div>
      )}

      {focus.issues?.length === 0 && focus.strengths?.length > 0 && (
        <div className="mt-3 grid gap-2">
          {focus.strengths.slice(0, 2).map((text, index) => (
            <div key={`${text}-${index}`} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${item}`}>
              <span className="font-black">근거 {index + 1}. </span>{text}
            </div>
          ))}
        </div>
      )}

      {context?.notes?.length > 0 && (
        <p className={`mt-3 text-[11px] font-semibold leading-relaxed ${subtle}`}>
          {context.notes[0]}
        </p>
      )}
      {focus.recommendedNextCheck && (
        <p className={`mt-2 text-[11px] leading-relaxed ${subtle}`}>
          다음 확인: {focus.recommendedNextCheck}
        </p>
      )}
    </section>
  );
}
