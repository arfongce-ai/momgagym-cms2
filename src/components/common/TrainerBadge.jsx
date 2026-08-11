// TrainerBadge.jsx — 트레이너별 잔여 세션 배지
// Gemini 교차검증 권고: 총합 표시 금지, 트레이너별 분리 배지

/**
 * @param {Object} trainerSessions — { [trainerId]: { total, remaining } }
 * @param {Array}  trainers        — 트레이너 목록 (id, name, color 포함)
 * @param {boolean} compact        — 컴팩트 모드 (목록용)
 * @param {boolean} showBar        — 프로그레스 바 표시 여부
 */
export default function TrainerBadge({
  trainerSessions = {},
  trainers        = [],
  compact         = false,
  showBar         = false,
}) {
  const entries = Object.entries(trainerSessions);

  if (!entries.length) {
    return (
      <span className="text-[10px] text-slate-600 italic">세션없음</span>
    );
  }

  return (
    <div className={`flex ${compact ? 'flex-col' : 'flex-wrap'} gap-1`}>
      {entries.map(([tid, s]) => {
        const trainer = trainers.find(t => t.id === tid);
        const pct     = s.total > 0 ? (s.remaining / s.total) * 100 : 0;

        // 잔여 비율에 따른 색상
        const colorClass =
          pct > 30 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25' :
          pct > 0  ? 'text-amber-700 dark:text-amber-400  bg-amber-500/10  border-amber-500/25'  :
                     'text-red-700 dark:text-red-400    bg-red-500/10    border-red-500/25';

        const barColor =
          pct > 30 ? '#10b981' :
          pct > 0  ? '#f59e0b' :
                     '#ef4444';

        return (
          <div key={tid} className="flex flex-col gap-0.5">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold
                          px-1.5 py-0.5 rounded-md border whitespace-nowrap ${colorClass}`}
            >
              {/* 트레이너 색상 점 */}
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: trainer?.color || '#94a3b8' }}
              />
              {compact ? (
                <>
                  {trainer?.name || '??'}:{' '}
                  <span className="font-mono">
                    {s.remaining}
                    <span className="opacity-50">/{s.total}</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="opacity-80">{trainer?.name || '?'}</span>{' '}
                  <span className="font-mono">{s.remaining}/{s.total}회</span>
                </>
              )}
            </span>

            {/* 프로그레스 바 (showBar=true 시) */}
            {showBar && (
              <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden w-full">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: barColor }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
