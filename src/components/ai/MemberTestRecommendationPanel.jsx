import { useEffect, useState } from 'react';

const SAFETY_LABEL = { allowed: '측정 가능', review: '확인 후 측정', blocked: '측정 제한' };
const SAFETY_CLASS = {
  allowed: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  review: 'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/20',
  blocked: 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/20',
};

export default function MemberTestRecommendationPanel({ member, result, loading = false, error = '', onSelect }) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { setShowAll(false); }, [member?.id]);

  if (!member) return null;
  return (
    <section id="section-recommendation" className="scroll-mt-14 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">회원별 추천 테스트</p>
          <h2 className="mt-1 font-black text-slate-900 dark:text-slate-100">{member.name}님 다음 측정 추천</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            최근 측정·운동 목적·연령·컨디션을 규칙으로 계산했습니다. 최종 진행 전 트레이너가 확인하세요.
          </p>
        </div>
        {result && (
          <span className="shrink-0 rounded-full border border-slate-300 dark:border-slate-700 px-2 py-1 text-[10px] font-mono text-slate-500">
            {result.engineVersion}
          </span>
        )}
      </div>

      {loading && <p className="py-5 text-center text-sm text-slate-500">회원 측정 기록을 분석하는 중…</p>}
      {!loading && error && <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>}

      {!loading && result && (
        <>
          {(result.safetySummary.latestPainNrs != null || result.safetySummary.latestFatigue != null) && (
            <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              최근 컨디션 기준
              {result.safetySummary.latestPainNrs != null ? ` · 통증 ${result.safetySummary.latestPainNrs}/10` : ''}
              {result.safetySummary.latestFatigue != null ? ` · 피로도 ${result.safetySummary.latestFatigue}/5` : ''}
            </div>
          )}

          <div className="mt-3 space-y-2">
            {result.recommendations.map((item, index) => (
              <button key={item.id} type="button" onClick={() => onSelect?.(item.id)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-500/50 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-black text-white">{index + 1}</span>
                  <span className="flex-1 text-sm font-black text-slate-900 dark:text-slate-100">{item.title}</span>
                  <span className="text-xs font-black text-emerald-700 dark:text-emerald-300">{item.score}점</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${SAFETY_CLASS[item.safety]}`}>
                    {SAFETY_LABEL[item.safety]}
                  </span>
                </div>
                <ul className="mt-2 space-y-1 pl-8 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {item.reasons.filter((reason) => !reason.includes('중복 우선순위')).slice(0, 2).map((reason) => <li key={reason}>• {reason}</li>)}
                  {item.safetyReasons.slice(0, 1).map((reason) => <li key={reason} className="text-amber-700 dark:text-amber-300">• {reason}</li>)}
                </ul>
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setShowAll((value) => !value)}
            className="mt-3 text-xs font-bold text-slate-600 underline decoration-slate-400 underline-offset-4 dark:text-slate-300">
            {showAll ? '전체 판정 접기' : '전체 테스트 판정 보기'}
          </button>

          {showAll && (
            <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              {result.candidates.map((item) => (
                <div key={item.id} className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs last:border-b-0 dark:border-slate-800">
                  <span className="flex-1 font-semibold text-slate-700 dark:text-slate-200">{item.title}</span>
                  <span className="font-mono text-slate-500">{item.score}점</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${SAFETY_CLASS[item.safety]}`}>
                    {SAFETY_LABEL[item.safety]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
