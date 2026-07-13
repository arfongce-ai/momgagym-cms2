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
  UnifiedEmptyState, UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection,
} from '../../components/report/UnifiedReportPrimitives';
import { buildLiftingInterpretation, exerciseLabel, VBT_ZONE_PURPOSE, vbtZonePurpose } from '../core/lifting';
import { generateLiftingDiagnosis, GRADE_LABEL } from '../core/barbellClinical';

function fmt(v, unit = '') {
  return v == null || Number.isNaN(Number(v)) ? '—' : `${v}${unit}`;
}

const MODE_TITLE = { lifting: '역도 궤적 분석', vbt: 'VBT 속도 분석', onerm: '1RM 추정' };

export default function LiftingReportDashboard({ report, onClose, member }) {
  const interp = useMemo(() => buildLiftingInterpretation(report || {}), [report]);
  const diag = useMemo(() => generateLiftingDiagnosis(report || {}, {}), [report]);

  if (!report) return <UnifiedEmptyState onClose={onClose} />;

  const resolvedMember = member || report.member || null;

  const mode = report.mode || 'vbt';
  const m = report.metrics || {};
  const meta = report.metadata || {};
  const exLabel = exerciseLabel(report.exerciseType);
  const conf = Number(m.confidenceScore);
  const confPct = Number.isFinite(conf) ? Math.round(conf * 100) : null;
  const precision = report.precision || {};
  const measuredZone = mode === 'vbt' ? vbtZonePurpose(m.meanVelocity) : null;
  const estimateStats = meta.estimateStats || {};
  const estimateRange = meta.confidenceInterval || estimateStats.confidenceInterval || null;

  // 핵심 수치 타일(모드별).
  const tiles = [];
  if (report.outlierWarning?.isOutlier) {
    tiles.push({ label: '측정값 확인', value: '확인 필요' });
  }
  if (mode === 'onerm') {
    tiles.push({ label: '추정 1RM', value: fmt(m.oneRM, 'kg'), accent: true });
    tiles.push({ label: '입력', value: `${fmt(meta.weight, 'kg')}×${fmt(meta.reps, '회')}` });
    if (meta.attemptNo) tiles.push({ label: '도전 차수', value: `${meta.attemptNo}차` });
    if (meta.bestOneRM) tiles.push({ label: '세션 최고', value: fmt(meta.bestOneRM, 'kg') });
    if (estimateStats.spreadKg != null) tiles.push({ label: '공식 편차', value: `${estimateStats.spreadKg}kg` });
    if (estimateRange?.low != null) tiles.push({ label: '참고 범위', value: `${estimateRange.low}~${estimateRange.high}kg` });
  } else {
    tiles.push({ label: '평균속도', value: fmt(m.meanVelocity, ' m/s'), accent: true });
    tiles.push({ label: m.peakReason === 'sg_ok' ? '최고속도(평활)' : '최고속도', value: m.peakVelocity != null ? fmt(m.peakVelocity, ' m/s') : '샘플/고속영상 필요' });
    if (report.barPath?.maxDriftCm != null || meta.barPath?.maxDriftCm != null) {
      const bp = report.barPath || meta.barPath;
      tiles.push({ label: '바 수평 이탈', value: fmt(bp.maxDriftCm, ' cm') });
    }
    tiles.push({ label: '가동범위', value: fmt(m.rangeOfMotion, ' cm') });
    if (meta.reps != null) tiles.push({ label: '반복', value: fmt(meta.reps, '회') });
    if (m.velocityLoss != null) tiles.push({ label: '속도저하', value: fmt(m.velocityLoss, '%') });
    if (meta.loadVelocityPoint?.loadKg != null && meta.loadVelocityPoint?.meanVelocity != null) {
      tiles.push({
        label: '프로필 기준점',
        value: `${meta.loadVelocityPoint.loadKg}kg / ${meta.loadVelocityPoint.meanVelocity}m/s`,
      });
    }
    if (m.meanPower != null || m.peakPower != null) tiles.push({ label: '파워(근사)', value: fmt(m.meanPower ?? m.peakPower, ' W') });
  }

  const tone = confPct == null ? 'text-slate-400'
    : confPct >= 70 ? 'text-emerald-300'
    : confPct >= 50 ? 'text-amber-300' : 'text-red-300';

  return (
    <UnifiedReportCanvas>
      <div className="mb-3 flex items-center justify-between">
        <ReportActions
          reportNodeId="lifting-report"
          baseName={`바벨리프팅_${exLabel}`}
          videoBlob={report.videoBlob || null}
        />
        <button onClick={onClose} className="rounded-lg bg-slate-700 text-white font-bold text-sm px-4 py-2">닫기</button>
      </div>
      <UnifiedReportPage id="lifting-report" className="mx-auto">
          <UnifiedReportHeader
            title={`${MODE_TITLE[mode] || '바벨 리프팅'} · ${exLabel}`}
            subtitle={interp.headline}
            measuredAt={report.recordedAt}
            member={resolvedMember}
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

          {/* AI 자동 평가 */}
          {diag && diag.grade !== 'insufficient' && (
            <UnifiedReportSection title="AI 자동 평가" subtitle={GRADE_LABEL[diag.grade]}>
              <div className="rounded-xl bg-slate-800/50 p-3 space-y-1.5">
                <p className="text-[12px] font-black text-slate-100">{diag.headline}</p>
                {diag.details.map((d, i) => (
                  <p key={i} className="text-[11px] text-slate-300 leading-snug">· {d}</p>
                ))}
              </div>
            </UnifiedReportSection>
          )}

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

          {mode === 'vbt' && (
            <UnifiedReportSection title="속도 구간별 훈련 목적" subtitle="평균속도 기준">
              <div className="space-y-1.5">
                {VBT_ZONE_PURPOSE.map((z, i) => {
                  const active = measuredZone && measuredZone.label === z.label;
                  const range = `${z.min}${z.max === Infinity ? '+' : `~${z.max}`} m/s`;
                  return (
                    <div key={i} className={`rounded-xl border p-2.5 ${active ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-800/45 border-slate-700'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-black ${active ? 'text-amber-300' : 'text-slate-200'}`}>{z.label}</span>
                        <span className="font-mono text-[10px] text-slate-400">{range}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-slate-300">{z.purpose}</p>
                    </div>
                  );
                })}
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
            {(report.cogGap?.available || report.crossValidation?.totalFrames > 0) && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                {report.cogGap?.available && (
                  <div className="rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 p-2">
                    <p className="text-fuchsia-300">바-무게중심 이격</p>
                    <p className="font-mono font-bold text-fuchsia-100">
                      {report.cogGap.medianCm != null ? `${report.cogGap.medianCm}cm` : fmt(report.cogGap.medianRatio)}
                      {report.cogGap.maxCm != null && <span className="text-[9px] text-fuchsia-300/70"> · 최대 {report.cogGap.maxCm}cm</span>}
                    </p>
                  </div>
                )}
                {report.crossValidation?.totalFrames > 0 && (
                  <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-2">
                    <p className="text-cyan-300">교차검증(신호 일치)</p>
                    <p className="font-mono font-bold text-cyan-100">
                      {report.crossValidation.avgAgreement != null ? `${Math.round(report.crossValidation.avgAgreement * 100)}%` : '—'}
                      {report.crossValidation.assistRatio > 0 && (
                        <span className="text-[9px] text-cyan-300/70"> · 보완 {Math.round(report.crossValidation.assistRatio * 100)}%</span>
                      )}
                    </p>
                  </div>
                )}
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
    </UnifiedReportCanvas>
  );
}
