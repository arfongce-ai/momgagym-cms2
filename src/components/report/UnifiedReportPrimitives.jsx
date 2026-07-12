import React from 'react';
import { scoreToStatus } from '../../ai-measure/core/unifiedReport';
import { store } from '../../demoData';
import { getLatestBodyInfoSnapshot } from '../../services/reportService';

// 몸가짐운동센터 로고 원본(사용자 제공 파일, public/brand/momgagym-logo.png)을 그대로 쓰되
// 다크 리포트 배경에 맞춰 색만 반전(검정 선/텍스트 → 흰색, 흰 배경 → 투명)했다.
// (요청: 로고 디자인 변경 금지, 색반전만 허용) base64 인라인 삽입 — html2canvas 캡처 시
// 이미지 로딩 지연/누락 위험 없이 항상 나오게 한다.
const MOMGAGYM_LOGO_DATA_URI = 'data:image/png;base64,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';

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
export function UnifiedReportFooter() {
  return (
    <footer className="mt-8 flex flex-col items-center gap-2 border-t border-slate-800 pt-4">
      <img src={MOMGAGYM_LOGO_DATA_URI} alt="몸가짐 운동센터" className="h-11 w-auto opacity-90" />
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
