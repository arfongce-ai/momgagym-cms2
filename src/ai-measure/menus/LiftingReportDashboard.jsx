// ai-measure/menus/LiftingReportDashboard.jsx
// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅(역도/VBT/1RM) 측정 리포트 — A4·다크모드.
//   · 통합 리포트 프리미티브(UnifiedReportPage/Header/Section)를 재사용해
//     다른 측정(점프·보행 등)과 동일한 A4 출력 포맷·다크 테마를 유지.
//   · 종목·목적별 해석은 buildLiftingInterpretation(순수 함수)에서 생성.
//     - VBT:  평균/최고속도 → 트레이닝 존(구간) 목적
//     - 1RM:  추정 무게 → 강도(%)·훈련무게·도전 차수
//     - 역도: 궤적·속도·가동범위
//   · 데이터는 측정 페이로드에서만 도출(추적 데이터 우선). 값 없으면 생략.
// ════════════════════════════════════════════════════════════════════════
import { useMemo } from 'react';
import ReportActions from '../../components/report/ReportActions';
import {
  UnifiedEmptyState, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection,
} from '../../components/report/UnifiedReportPrimitives';
import { buildLiftingInterpretation, exerciseLabel } from '../core/lifting';

function fmt(v, unit = '') {
  return v == null || Number.isNaN(Number(v)) ? '—' : `${v}${unit}`;
}

const MODE_TITLE = { lifting: '역도 궤적 분석', vbt: 'VBT 속도 분석', onerm: '1RM 추정' };

export default function LiftingReportDashboard({ report, onClose }) {
  const interp = useMemo(() => buildLiftingInterpretation(report || {}), [report]);

  if (!report) return <UnifiedEmptyState onClose={onClose} />;

  const mode = report.mode || 'vbt';
  const m = report.metrics || {};
  const meta = report.metadata || {};
  const exLabel = exerciseLabel(report.exerciseType);
  const conf = Number(m.confidenceScore);
  const confPct = Number.isFinite(conf) ? Math.round(conf * 100) : null;
  const precision = report.precision || {};

  // 핵심 수치 타일(모드별).
  const tiles = [];
  if (mode === 'onerm') {
    tiles.push({ label: '추정 1RM', value: fmt(m.oneRM, 'kg'), accent: true });
    tiles.push({ label: '입력', value: `${fmt(meta.weight, 'kg')}×${fmt(meta.reps, '회')}` });
    if (meta.attemptNo) tiles.push({ label: '도전 차수', value: `${meta.attemptNo}차` });
    if (meta.bestOneRM) tiles.push({ label: '세션 최고', value: fmt(meta.bestOneRM, 'kg') });
  } else {
    tiles.push({ label: '평균속도', value: fmt(m.meanVelocity, ' m/s'), accent: true });
    tiles.push({ label: '최고속도', value: m.peakVelocity != null ? fmt(m.peakVelocity, ' m/s') : '고속영상 필요' });
    tiles.push({ label: '가동범위', value: fmt(m.rangeOfMotion, ' cm') });
    if (meta.reps != null) tiles.push({ label: '반복', value: fmt(meta.reps, '회') });
    if (m.meanPower != null || m.peakPower != null) tiles.push({ label: '파워(근사)', value: fmt(m.meanPower ?? m.peakPower, ' W') });
  }

  const tone = confPct == null ? 'text-slate-400'
    : confPct >= 70 ? 'text-emerald-300'
    : confPct >= 50 ? 'text-amber-300' : 'text-red-300';

  return (
    <div className="bg-slate-950 min-h-full">
      <div className="flex items-center justify-between p-3">
        <ReportActions reportNodeId="lifting-report" baseName={`바벨리프팅_${exLabel}`} />
        <button onClick={onClose} className="rounded-lg bg-slate-700 text-white font-bold text-sm px-4 py-2">닫기</button>
      </div>
      <div className="flex justify-center px-3 pb-3">
        <UnifiedReportPage id="lifting-report">
          <UnifiedReportHeader
            title={`${MODE_TITLE[mode] || '바벨 리프팅'} · ${exLabel}`}
            subtitle={interp.headline}
            measuredAt={report.recordedAt}
          />

          {/* 핵심 수치 */}
          <UnifiedReportSection title="핵심 수치">
            <div className="grid grid-cols-2 gap-2">
              {tiles.map((t, i) => (
                <div key={i} className={`rounded-xl p-3 border ${t.accent ? 'bg-amber-500/10 border-amber-500/35' : 'bg-slate-800/60 border-slate-700'}`}>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest">{t.label}</p>
                  <p className={`font-mono font-black text-xl ${t.accent ? 'text-amber-300' : 'text-slate-100'}`}>{t.value}</p>
                </div>
              ))}
            </div>
          </UnifiedReportSection>

          {/* 목적별 해석 */}
          {interp.lines.length > 0 && (
            <UnifiedReportSection title="측정 해석" subtitle="목표·목적 기준">
              <div className="space-y-2">
                {interp.lines.map((ln, i) => (
                  <div key={i} className="flex gap-3 rounded-xl bg-slate-800/50 p-3">
                    <span className="shrink-0 text-[11px] font-black text-amber-400 w-20">{ln.label}</span>
                    <span className="text-[12px] text-slate-200 leading-snug">{ln.text}</span>
                  </div>
                ))}
              </div>
            </UnifiedReportSection>
          )}

          {/* 신뢰도·정밀도 */}
          <UnifiedReportSection title="측정 신뢰도">
            <div className="flex items-center justify-between rounded-xl bg-slate-800/60 p-3">
              <span className="text-[12px] text-slate-300">측정 신뢰도</span>
              <span className={`font-mono font-black text-lg ${tone}`}>{confPct != null ? `${confPct}%` : '—'}</span>
            </div>
            {(precision.measuredAvgFps || report.source === 'upload') && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-slate-800/40 p-2">
                  <p className="text-slate-500">분석 프레임</p>
                  <p className="font-mono font-bold text-slate-200">{fmt(precision.analyzedFrames)}</p>
                </div>
                <div className="rounded-lg bg-slate-800/40 p-2">
                  <p className="text-slate-500">실측 평균 fps</p>
                  <p className="font-mono font-bold text-slate-200">{fmt(precision.measuredAvgFps)}</p>
                </div>
              </div>
            )}
          </UnifiedReportSection>

          {/* 주의(정직성) */}
          {interp.cautions.length > 0 && (
            <UnifiedReportSection title="참고·주의">
              <ul className="space-y-1.5">
                {interp.cautions.map((c, i) => (
                  <li key={i} className="flex gap-2 text-[11px] text-amber-300/90">
                    <span>⚠</span><span className="leading-snug">{c}</span>
                  </li>
                ))}
              </ul>
            </UnifiedReportSection>
          )}

          <p className="mt-4 text-center text-[10px] text-slate-600">
            ※ 카메라 한 대 추정은 전용 엔코더·포스플레이트보다 정밀하지 않으며, 동일 조건의 추세 파악에 적합합니다.
          </p>
        </UnifiedReportPage>
      </div>
    </div>
  );
}
