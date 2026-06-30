import React from 'react';
import { scoreToStatus } from '../../ai-measure/core/unifiedReport';

export const UNIFIED_REPORT_PAGE_CLASS =
  'report-a4-page w-full max-w-[794px] rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-slate-700/70 sm:p-6';

export function UnifiedReportCanvas({ children, className = '' }) {
  return (
    <div className={`min-h-full w-full bg-slate-950 p-4 text-slate-100 ${className}`}>
      {children}
    </div>
  );
}

export function UnifiedReportPage({ id, children, className = '', minHeight = 1123 }) {
  return (
    <div id={id} className={`${UNIFIED_REPORT_PAGE_CLASS} ${className}`} style={{ minHeight }}>
      {children}
    </div>
  );
}

export function UnifiedReportHeader({
  eyebrow = 'MOMGAGYM REPORT',
  badge,
  title,
  subtitle,
  score,
  status,
  onClose,
  compact = false,
}) {
  const token = typeof status === 'string'
    ? scoreToStatus(status === 'normal' ? 100 : status === 'caution' ? 65 : status === 'risk' ? 35 : null)
    : status?.key ? status : scoreToStatus(score);
  return (
    <header className={`flex items-start justify-between gap-4 border-b border-slate-700/70 ${compact ? 'pb-4 mb-5' : 'pb-5 mb-6'}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="break-keep text-[11px] font-black uppercase tracking-[0.18em] text-amber-400 sm:text-[12px] sm:tracking-[0.22em]">
            {eyebrow}
          </p>
          {badge && (
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[9px] font-black text-slate-300">
              {badge}
            </span>
          )}
        </div>
        <h1 className="mt-2 break-keep text-2xl font-black leading-tight text-white sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 break-keep text-sm font-bold leading-tight text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-start gap-3">
        {score != null ? <ScoreRing score={score} /> : <TrafficLightBadge status={token} />}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm font-bold text-slate-300 hover:border-slate-500 hover:text-white"
          >
            닫기
          </button>
        )}
      </div>
    </header>
  );
}

export function UnifiedReportSection({ title, subtitle, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-700/70 bg-slate-800/35 p-4 ${className}`}>
      {(title || subtitle) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="break-keep text-base font-black text-white">{title}</h2>}
          {subtitle && <span className="break-keep text-[11px] font-bold text-slate-500">{subtitle}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function UnifiedEmptyState({ children = '리포트 데이터가 없습니다.', onClose }) {
  return (
    <UnifiedReportCanvas>
      <div className="mx-auto flex min-h-[320px] w-full max-w-[794px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
        <p className="text-sm font-bold text-slate-400">{children}</p>
        {onClose && (
          <button type="button" onClick={onClose} className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200">
            닫기
          </button>
        )}
      </div>
    </UnifiedReportCanvas>
  );
}

export function TrafficLightBadge({ status }) {
  const token = typeof status === 'string' ? scoreToStatus(status === 'normal' ? 100 : status === 'caution' ? 65 : 35) : status;
  const finalToken = token?.key ? token : scoreToStatus(null);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${finalToken.bgClass} ${finalToken.borderClass} ${finalToken.colorClass}`}>
      {finalToken.label}
    </span>
  );
}

export function ScoreRing({ score, label = '종합 점수' }) {
  const token = scoreToStatus(score);
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background: `conic-gradient(currentColor ${pct}%, rgba(71,85,105,.45) 0)` }}
      >
        <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-900 text-center">
          <span className={`font-mono text-xl font-black leading-none ${token.colorClass}`}>{pct}</span>
          <span className="text-[9px] font-bold text-slate-500">/100</span>
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-slate-500">{label}</p>
        <TrafficLightBadge status={token} />
      </div>
    </div>
  );
}

export function MetricCard({ metric }) {
  const token = metric?.status || scoreToStatus(null);
  return (
    <div className="min-w-0 rounded-xl bg-slate-800/70 px-3 py-3 ring-1 ring-slate-700/60">
      <div className="flex items-start justify-between gap-2">
        <p className="break-keep text-[11px] font-black leading-tight text-slate-300">{metric?.label || '측정 항목'}</p>
        <TrafficLightBadge status={token} />
      </div>
      <p className={`mt-3 font-mono text-2xl font-black leading-none tracking-normal ${token.colorClass}`}>
        {metric?.displayValue ?? '-'}
        {metric?.unit && <span className="ml-1 text-xs font-bold text-slate-500">{metric.unit}</span>}
      </p>
      {metric?.description && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{metric.description}</p>}
    </div>
  );
}

export function UnifiedReportCard({ title, subtitle, score, metrics = [], children }) {
  return (
    <section className="w-full max-w-[430px] rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-slate-700/70 sm:max-w-[794px]">
      <header className="flex items-start justify-between gap-4 border-b border-slate-700/70 pb-4">
        <div className="min-w-0">
          <p className="break-keep text-xl font-black leading-tight text-white">{title}</p>
          {subtitle && <p className="mt-1 break-keep text-sm font-bold leading-tight text-slate-500">{subtitle}</p>}
        </div>
        <ScoreRing score={score} />
      </header>
      {metrics.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)}
        </div>
      )}
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}
