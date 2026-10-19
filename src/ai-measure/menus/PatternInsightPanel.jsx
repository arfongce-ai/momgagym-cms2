import { extractKeyMetrics } from '../core/unifiedReport';
import { buildPatternInsights, EVIDENCE } from '../core/patternInsights';

// 측정값 → 자세·움직임 패턴 경향 참고 자료. 진단이 아니며 트레이너 확인 후 회원에게 전달한다.
export default function PatternInsightPanel({ measure, report }) {
  let items = [];
  try {
    items = buildPatternInsights(measure, extractKeyMetrics(report || {}, measure));
  } catch {
    items = [];
  }
  if (!items.length) return null;
  const line = (label, arr) => (arr && arr.length ? <p className="text-xs"><b>{label}</b> {arr.join(', ')}</p> : null);
  return (
    <section className="rounded-xl border border-slate-300/70 dark:border-slate-700/70 bg-slate-100/40 dark:bg-slate-800/40 p-4 text-slate-800 dark:text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-black">자세·움직임 패턴 참고</h2>
        <span className="rounded-full border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-[10px] font-black">트레이너 확인용</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        진단이 아닌 참고 자료입니다. 근육 상태는 영상으로 확인한 것이 아니라 교과서가 설명하는 일반적인 경향입니다.
      </p>
      <div className="mt-3 space-y-3">
        {items.map((p) => (
          <article key={p.key} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-3 space-y-1.5">
            <h3 className="text-sm font-black">{p.title}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">근거 지표: {p.trigger.label} {p.trigger.value}{p.trigger.unit || ''}</p>
            <p className="text-xs">{p.observation}</p>
            {line('짧아지기 쉬운 근육', p.shortMuscles)}
            {line('약해지기 쉬운 근육', p.weakMuscles)}
            {p.suggestions?.length ? (
              <ul className="list-disc pl-4 text-xs">{p.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
            ) : null}
            {p.fascialLink ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <b>참고 연결(근거 약함)</b> {p.fascialLink.text} <span className="text-[10px]">저자의 임상 경험에 기반한 가설이며 연구로 검증되지 않았습니다. 출처: 근막경선 해부학 {p.fascialLink.where}</span>
              </p>
            ) : null}
            {p.caution ? <p className="text-xs text-amber-700 dark:text-amber-300">{p.caution}</p> : null}
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              근거 수준: {EVIDENCE[p.evidence]} · 출처(쪽수는 ±1쪽 오차 가능): {p.sources.map((s) => `${s.book} ${s.where}`).join(' / ')}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
