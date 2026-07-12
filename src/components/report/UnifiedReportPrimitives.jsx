import React from 'react';
import { scoreToStatus } from '../../ai-measure/core/unifiedReport';
import { store } from '../../demoData';
import { getLatestBodyInfoSnapshot } from '../../services/reportService';

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
      <UnifiedReportFooter />
    </div>
  );
}

// 몸가짐운동센터 로고 — 모든 리포트(JPG 캡처·카카오톡 공유 포함) 맨 아래 공통 표기.
// UnifiedReportPage 안에 고정 삽입되므로 새 측정 유형을 추가해도 이 프리미티브만 쓰면 자동 적용된다.
// 래스터 로고 파일(public/brand/momgagym-logo.png) 대신 인라인 SVG로 그려
//  html2canvas 캡처 시 이미지 로딩 지연/누락 위험 없이 항상 선명하게 나온다.
export function UnifiedReportFooter() {
  return (
    <footer className="mt-8 flex flex-col items-center gap-1.5 border-t border-slate-800 pt-4">
      <svg viewBox="0 0 120 120" className="h-9 w-9 text-slate-500" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="6" y="6" width="108" height="108" stroke="currentColor" strokeWidth="5" />
        <text x="60" y="63" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor">몸가짐</text>
        <text x="60" y="82" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor">운동센터</text>
      </svg>
      <p className="text-[10px] font-bold tracking-wide text-slate-600">MOMGAGYM FITNESS CENTER</p>
    </footer>
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
  member,
}) {
  const token = typeof status === 'string'
    ? scoreToStatus(status === 'normal' ? 100 : status === 'caution' ? 65 : status === 'risk' ? 35 : null)
    : status?.key ? status : scoreToStatus(score);
  return (
    <header className={`border-b border-slate-700/70 ${compact ? 'pb-4 mb-5' : 'pb-5 mb-6'}`}>
      <div className="flex items-start justify-between gap-4">
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
      </div>
      <BodyInfoStrip member={member} />
    </header>
  );
}

// 신체정보 자동 등록 — member 가 주어지면 최근 신체정보(키/몸무게/BMI/혈압)를 한 줄로 표시.
// 기록이 없으면 아무것도 렌더링하지 않는다(측정 정직성 — 값 없는 항목 표시 안 함).
function BodyInfoStrip({ member }) {
  if (!member?.id) return null;
  const snapshot = getLatestBodyInfoSnapshot(store.getBodyRecords(member.id) || []);
  if (!snapshot) return null;

  const parts = [];
  if (snapshot.height != null) parts.push(`${snapshot.height}cm`);
  if (snapshot.weight != null) parts.push(`${snapshot.weight}kg`);
  if (snapshot.bmi != null) parts.push(`BMI ${snapshot.bmi}`);
  if (snapshot.systolic != null && snapshot.diastolic != null) parts.push(`${snapshot.systolic}/${snapshot.diastolic}mmHg`);
  if (!parts.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-slate-800/50 px-3 py-2 text-[11px] font-bold">
      <span className="text-slate-500">신체정보</span>
      <span className="font-mono text-slate-200">{parts.join(' · ')}</span>
      {snapshot.date && (
        <span className="ml-auto text-[10px] font-semibold text-slate-600">{String(snapshot.date).slice(0, 10)} 측정</span>
      )}
    </div>
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
