// 결과 해석 블록 — 상세 리포트 A4 안에 들어간다(캡처·공유 이미지에도 포함).
// 문구는 ai-measure/core/interpretation.js 가 만든다. summary 는 buildSummaryData() 결과.
import { useMemo } from 'react';
import { buildInterpretation } from '../../ai-measure/core/interpretation';

const TONE = {
  normal: 'text-emerald-700 dark:text-emerald-300',
  caution: 'text-amber-700 dark:text-amber-300',
  risk: 'text-rose-700 dark:text-rose-300',
  observed: 'text-sky-700 dark:text-sky-300',
  unknown: 'text-slate-500 dark:text-slate-400',
};

export default function InterpretationSection({ summary, reportType, extra }) {
  const it = useMemo(() => (summary ? buildInterpretation(summary, { reportType, extra }) : null), [summary, reportType, extra]);
  if (!it || !it.detail.metrics.length) return null;
  const d = it.detail;
  return (
    <section data-testid="interpretation-section" className="mt-5 break-inside-avoid rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <h3 className="mb-2 text-sm font-black text-slate-900 dark:text-white">📖 결과 해석 (값이 무슨 뜻인지)</h3>
      <div className="space-y-1.5 text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-200">
        {d.overview.map((t, i) => <p key={`o${i}`} className="break-keep">{t}</p>)}
        {d.reading.map((t, i) => <p key={`r${i}`} className="break-keep font-bold">{t}</p>)}
        {d.extra.map((t, i) => <p key={`x${i}`} className="break-keep">{t}</p>)}
      </div>
      <ul className="mt-3 space-y-2">
        {d.metrics.map((m) => (
          <li key={m.key} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[12px] font-black text-slate-900 dark:text-white">
              {m.label} <span className={`ml-1 text-[11px] ${TONE[m.statusKey] || TONE.unknown}`}>{m.valueText} · {m.statusWord}</span>
            </p>
            <p className="mt-0.5 break-keep text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{m.what}</p>
            <p className="mt-0.5 break-keep text-[11px] font-semibold leading-relaxed text-slate-800 dark:text-slate-100">{m.judge}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 break-keep text-[11px] font-bold text-slate-800 dark:text-slate-100">다음 단계: {d.next}</p>
      <p className="mt-1 break-keep text-[10px] text-slate-500">{d.caution}</p>
    </section>
  );
}
