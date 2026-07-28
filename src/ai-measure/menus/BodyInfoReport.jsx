// ai-measure/menus/BodyInfoReport.jsx
// ════════════════════════════════════════════════════════════════════════
//  신체 정보 A4 결과 리포트 (JPG 전송용).
//   · 현재 측정값 + 2026 대한고혈압학회 지침 기반 등급.
//   · 회차별 비교: 회원 신체기록(store.getBodyRecords)의 체중·혈압 추이 그래프.
//  측정 정직성: 값이 없으면 표시하지 않고, 추이는 2회 이상 기록이 있을 때만 그린다.
// ════════════════════════════════════════════════════════════════════════
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  MetricCard,
  UnifiedReportCanvas,
  UnifiedReportPage,
  UnifiedReportHeader,
  UnifiedReportSection,
} from '../../components/report/UnifiedReportPrimitives';
import { scoreToStatus } from '../core/unifiedReport';

// grade('good'/'warn'/'bad') -> 다른 리포트와 같은 신호등 배지 색/라벨(scoreToStatus 대표 점수 공유).
function gradeToken(grade) {
  if (grade === 'bad') return scoreToStatus(35);
  if (grade === 'warn') return scoreToStatus(65);
  return scoreToStatus(90);
}

function worstGrade(items) {
  if (items.some(i => i.grade === 'bad')) return 'risk';
  if (items.some(i => i.grade === 'warn')) return 'caution';
  return 'normal';
}

export default function BodyInfoReport({ id = 'body-report-sheet', member, result, history = [], onClose }) {
  const items = result?.items || [];
  // 회차별 비교 시리즈(오래된→최신). 체중·수축기·이완기.
  // [모미 신규] 체중·혈압이 없는 컨디션 전용 기록도 포함(이전엔 필터에서 통째로 빠져
  // 추이에 반영되지 않았다). 체중/혈압 차트 자체는 그대로 null-skip 되므로 영향 없음.
  const series = (history || [])
    .filter(r => r && (r.weight != null || r.systolic != null || r.fatigue != null || r.painNrs != null))
    .map(r => ({
      date: (r.recordedAt || '').slice(5) || '',
      weight: r.weight != null ? Number(r.weight) : null,
      systolic: r.systolic != null ? Number(r.systolic) : null,
      diastolic: r.diastolic != null ? Number(r.diastolic) : null,
      fatigue: r.fatigue != null ? Number(r.fatigue) : null,
      painNrs: r.painNrs != null ? Number(r.painNrs) : null,
    }));
  const hasWeightTrend = series.filter(s => s.weight != null).length >= 2;
  const hasBpTrend = series.filter(s => s.systolic != null).length >= 2;
  const hasConditionTrend = series.filter(s => s.fatigue != null || s.painNrs != null).length >= 2;

  return (
    <UnifiedReportCanvas>
      <UnifiedReportPage id={id} className="mx-auto">
        <UnifiedReportHeader
          eyebrow="MOMGAGYM REPORT"
          badge="신체 정보"
          title="신체 정보 분석"
          subtitle={`${member?.name || '회원'} · ${(result?.analyzedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}`}
          status={worstGrade(items)}
          onClose={onClose}
        />

        {/* 현재 측정값 · 등급 */}
        <UnifiedReportSection title="측정값 및 평가" className="mb-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {items.length === 0 && <p className="text-sm text-slate-500">측정값이 없습니다.</p>}
            {items.map(item => (
              <MetricCard key={item.key} metric={{
                key: item.key, label: item.label, displayValue: item.value, unit: item.unit,
                description: item.description, status: gradeToken(item.grade),
              }} />
            ))}
          </div>
          {result?.summary && (
            <div className="mt-3 rounded-xl bg-slate-800/50 px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-slate-300">{result.summary}</p>
            </div>
          )}
        </UnifiedReportSection>

        {/* 회차별 비교 */}
        <UnifiedReportSection title="회차별 비교" subtitle={hasWeightTrend || hasBpTrend || hasConditionTrend ? '이전 기록 대비 추이' : '기록이 2회 이상 쌓이면 추이가 표시됩니다'}>
          {hasWeightTrend && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-bold text-slate-400">체중 (kg)</p>
              <div style={{ width: '100%', height: 160 }}>
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} domain={['dataMin - 2', 'dataMax + 2']} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                    <Line type="monotone" dataKey="weight" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} name="체중" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {hasBpTrend && (
            <div>
              <p className="mb-1 text-xs font-bold text-slate-400">혈압 (mmHg)</p>
              <div style={{ width: '100%', height: 160 }}>
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[40, 'dataMax + 10']} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                    <Line type="monotone" dataKey="systolic" stroke="#f87171" strokeWidth={2.5} dot={{ r: 3 }} name="수축기" />
                    <Line type="monotone" dataKey="diastolic" stroke="#fbbf24" strokeWidth={2.5} dot={{ r: 3 }} name="이완기" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {/* [모미 신규] 컨디션(피로도·통증) 추이 — 체중·혈압과 같은 패턴, 2회 이상일 때만 표시 */}
          {hasConditionTrend && (
            <div>
              <p className="mb-1 text-xs font-bold text-slate-400">컨디션 (피로도 1~5 · 통증 NRS 0~10)</p>
              <div style={{ width: '100%', height: 160 }}>
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 10]} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                    <Line type="monotone" dataKey="fatigue" stroke="#a78bfa" strokeWidth={2.5} dot={{ r: 3 }} name="피로도" connectNulls />
                    <Line type="monotone" dataKey="painNrs" stroke="#fb7185" strokeWidth={2.5} dot={{ r: 3 }} name="통증" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {!hasWeightTrend && !hasBpTrend && !hasConditionTrend && (
            <p className="text-sm text-slate-500">아직 비교할 이전 기록이 없습니다. 다음 측정부터 추이가 누적됩니다.</p>
          )}
        </UnifiedReportSection>

        <p className="mt-4 text-[10px] leading-relaxed text-slate-600">
          ※ 혈압 평가는 「대한고혈압학회 고혈압 진료지침 2026」 기준입니다. 본 리포트는 참고용이며 의학적 진단을 대체하지 않습니다.
        </p>
      </UnifiedReportPage>
    </UnifiedReportCanvas>
  );
}
