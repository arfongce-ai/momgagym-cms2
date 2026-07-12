// components/report/SessionShareReport.jsx
// ════════════════════════════════════════════════════════════════════════
//  세션(측정이력) 항목용 A4 결과 리포트 — 카카오톡 이미지 공유 캡처 전용.
//   · 전용 리포트 화면이 없는 측정(신체정보·레거시 1RM/VBT/RSI 등)을
//     RSI/보행 리포트와 같은 A4·다크 포맷으로 그려 캡처한다.
//   · 데이터는 unified summary(점수·핵심발견·핵심지표)와 세션 원본 값만
//     사용하고, 없는 값은 그리지 않는다(측정 정직성).
// ════════════════════════════════════════════════════════════════════════
import {
  MetricCard, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection,
} from './UnifiedReportPrimitives';
import { extractSessionDetailTiles } from './sessionShare';

function formatDateOnly(value) {
  return String(value || '').slice(0, 10) || '-';
}

export default function SessionShareReport({ item, member }) {
  if (!item) return null;
  const summary = item.summary || {};
  const data = item.report || item.session?.data || {};
  const menu = item.session?.menu || item.reportType || '';
  const tiles = extractSessionDetailTiles(menu, data);
  const findings = (summary.topFindings || []).filter(Boolean);
  const metrics = (summary.keyMetrics || []).slice(0, 6);
  const recommendations = (summary.recommendations || []).filter(Boolean);
  const memberName = member?.name || data?.member?.name || '회원';
  const resolvedMember = member || data?.member || null;
  // 측정 정직성: 점수를 계산할 수 없는 측정(예: 신체정보)은 0점(위험) 링 대신
  // '확인 필요' 배지를 표시한다. 0점은 계산된 값처럼 보여 오해를 부른다.
  const hasScore = summary.status && summary.status !== 'unknown';

  return (
    <UnifiedReportPage id={`session-share-${item.id || 'report'}`}>
      <UnifiedReportHeader
        badge={item.meta?.badge || 'AI'}
        title={summary.title || item.meta?.title || '측정 결과'}
        subtitle={`${memberName} · ${formatDateOnly(item.date || summary.measuredAt)}`}
        score={hasScore ? (summary.overallScore ?? 0) : null}
        member={resolvedMember}
      />

      {findings.length > 0 && (
        <UnifiedReportSection title="문제점 확인 중심 요약" subtitle="PROBLEM FOCUS" className="mb-4">
          <div className="space-y-2">
            {findings.slice(0, 3).map((finding, idx) => (
              <p key={idx} className="break-keep rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2.5 text-[13px] font-semibold leading-relaxed text-slate-200">
                <span className="mr-1.5 font-black text-amber-300">확인 {idx + 1}.</span>
                {finding.text}
              </p>
            ))}
          </div>
        </UnifiedReportSection>
      )}

      {tiles.length > 0 && (
        <UnifiedReportSection title="측정 값" subtitle="핵심 지표" className="mb-4">
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((t, i) => (
              <div key={i} className={`rounded-xl border p-3 ${t.accent ? 'border-amber-500/35 bg-amber-500/10' : 'border-slate-700 bg-slate-800/60'}`}>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t.label}</p>
                <p className={`mt-2 font-mono text-2xl font-black leading-none ${t.accent ? 'text-amber-300' : 'text-slate-100'}`}>
                  {t.value}
                  {t.unit && <span className="ml-1 text-xs font-bold text-slate-500">{t.unit}</span>}
                </p>
              </div>
            ))}
          </div>
        </UnifiedReportSection>
      )}

      {metrics.length > 0 && (
        <UnifiedReportSection title="평가 지표" subtitle="상태 판정" className="mb-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)}
          </div>
        </UnifiedReportSection>
      )}

      {recommendations.length > 0 && (
        <UnifiedReportSection title="다음 확인" subtitle="권장 사항">
          <div className="space-y-1.5">
            {recommendations.map((text, idx) => (
              <p key={idx} className="break-keep text-[13px] font-semibold leading-relaxed text-slate-300">· {text}</p>
            ))}
          </div>
        </UnifiedReportSection>
      )}

      <p className="mt-6 border-t border-slate-800 pt-3 text-[10px] font-bold text-slate-600">
        몸가짐운동센터 · AI 측정 결과 리포트 · 같은 조건으로 반복 측정했을 때 추세 비교에 가장 의미가 있습니다.
      </p>
    </UnifiedReportPage>
  );
}
