import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { buildProblemFocus } from '../core/crossMeasureContext';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import MomiAutoNote from '../../components/report/MomiAutoNote.jsx';
import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';
import { aiStore } from '../../demoData';
import ReportActions from '../../components/report/ReportActions';
import { MetricCard, UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage } from '../../components/report/UnifiedReportPrimitives';
import { buildSummaryData } from '../core/unifiedReport';
import { computeChangeRow, summarizeChanges, reportDateOnly } from '../core/measurementComparison';
import ChangeSummaryPanel from '../../components/report/ChangeSummaryPanel.jsx';
import VideoCompareUpload from '../../components/report/VideoCompareUpload.jsx';

/*
 * SprintReportDashboard — 스프린트 & 아질리티 종합 리포트 (1장 대시보드)
 * ──────────────────────────────────────────────────────────────
 * GaitReportDashboard.jsx와 동일한 구조·컴포넌트 조합을 그대로 따른다
 * (헤더 → 문제 포커스 → 모미 자동노트/대화 → 지표 카드 → 차트/게이지 →
 * 전/후 변화 → 영상 비교 → 트레이너 코멘트 → 저장/공유 액션).
 * 점수·핵심지표는 unifiedReport.js의 buildSummaryData()가 sprint/agility에
 * 대해 이미 계산해 주는 값을 그대로 재사용한다(METRIC_DEFINITIONS.sprint —
 * 2026-09-05 결과리포트 연동 작업에서 추가) — Gait처럼 이 파일 안에서 정상범위를
 * 다시 정의하지 않는다.
 *
 * props:
 *   report          gait_reports 문서, kind==='sprint'|'agility' (필수)
 *   previousReport  직전 같은 testKey 기록 (선택 — SprintLiveAnalysis.jsx/
 *                   SprintUploadAnalysis.jsx의 previousReport 그대로 전달)
 *   videoBlob       측정 화면에서 녹화/업로드된 영상(화면 전용, 서버 저장 안 함)
 *   onComment       (text) => void 트레이너 코멘트 저장 콜백 (선택)
 *   onClose         () => void 닫기 (선택)
 */

// [전/후 변화 요약] GaitReportDashboard.jsx의 buildGaitChangeSummary와 동일한 역할.
// decelTime은 agility(5-0-5)에만 있는 지표라 값이 있을 때만 행을 만든다.
function buildSprintChangeSummary(report, previousReport) {
  if (!previousReport) return null;
  const rows = [
    computeChangeRow('총 소요시간', previousReport.totalTimeMs, report.totalTimeMs, 'ms', 'lowerBetter'),
    computeChangeRow('최고속도', previousReport.peakVelocityMs, report.peakVelocityMs, 'm/s', 'higherBetter'),
    computeChangeRow('반응속도', previousReport.reactionTimeMs, report.reactionTimeMs, 'ms', 'lowerBetter'),
    computeChangeRow('감속시간', previousReport.deceleration?.decelTimeMs, report.deceleration?.decelTimeMs, 'ms', 'lowerBetter'),
  ];
  return summarizeChanges(rows, reportDateOnly(previousReport));
}

export default function SprintReportDashboard({ report, previousReport, onComment, onClose, videoBlob, member }) {
  const kind = report?.kind === 'agility' ? 'agility' : 'sprint';
  const summary = useMemo(() => buildSummaryData(report, { reportType: 'sprint' }), [report]);
  const [comment, setComment] = useState(report?.trainerComment || '');
  const [saved, setSaved] = useState(false);
  const changeSummary = useMemo(() => buildSprintChangeSummary(report, previousReport), [report, previousReport]);

  // 측정 직후 화면에서만 넘어오는 videoBlob(메모리 상 녹화본/업로드 원본)을
  // 재생 가능한 object URL로 변환 — GaitReportDashboard.jsx와 동일 패턴.
  // 저장된 이력 화면(Report.jsx)에서 다시 열 때는 videoBlob이 없으므로
  // VideoCompareUpload가 알아서 업로드 2칸 모드로 대체된다.
  const [currentVideoUrl, setCurrentVideoUrl] = useState(null);
  useEffect(() => {
    if (!videoBlob) { setCurrentVideoUrl(null); return undefined; }
    const url = URL.createObjectURL(videoBlob);
    setCurrentVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

  const resolvedMember = member || report?.member || null;
  const memberName = resolvedMember?.name || '회원';
  const dateStr = (report?.createdAt || report?.measuredAt || '').slice(0, 10) || '—';
  const problemFocus = useMemo(() => report?.problem_focus || buildProblemFocus(kind, report), [report, kind]);

  const splitData = useMemo(() => Object.entries(report?.splits || {})
    .map(([distance, ms]) => ({ distance, seconds: Math.round((ms / 1000) * 100) / 100 })), [report]);

  const handleSaveComment = () => {
    if (typeof onComment === 'function') onComment(comment);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <UnifiedReportCanvas>
      <UnifiedReportPage id="sprint-report-sheet" className="mx-auto">
        {/* ── 헤더 ── */}
        <UnifiedReportHeader
          eyebrow={kind === 'agility' ? 'AGILITY REPORT' : 'SPRINT REPORT'}
          badge="SPD"
          title={memberName}
          subtitle={`${dateStr} · ${report?.testLabel || ''}`}
          score={summary.overallScore}
          onClose={onClose}
          compact
          member={resolvedMember}
        />

        <div className="grid gap-3">
          <ProblemFocusPanel focus={problemFocus} context={report?.cross_measure_context} />
          {/* gait_reports 컬렉션을 gait/jump와 공유하므로 updateGaitReport를 그대로 쓴다. */}
          <MomiAutoNote kind={kind} report={report} member={resolvedMember}
            onSaved={(patch) => aiStore.updateGaitReport(resolvedMember?.id, report.id, patch)} />
          <MomiInsightPanel kind={kind} report={report} member={resolvedMember} />

          {/* ① 상단 요약 — buildSummaryData가 만든 keyMetrics(반응속도·기록·속도·감속) 그대로 카드화 */}
          <section className="grid grid-cols-4 gap-2.5">
            {summary.keyMetrics.slice(0, 3).map((m) => <MetricCard key={m.key} metric={m} />)}
            <ScoreStat score={summary.overallScore} />
          </section>

          {/* ②③ 중단: 좌 구간기록 차트 / 우 방향전환·감속 요약 */}
          <section className="grid h-[240px] grid-cols-2 gap-3">
            <Panel title="구간 기록" subtitle={report?.testLabel || '구간별'}>
              {splitData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={splitData} margin={{ top: 12, right: 18, bottom: 8, left: 8 }}>
                    <XAxis dataKey="distance" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} unit="s" />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}초`, '기록']} />
                    <Bar dataKey="seconds" radius={[6, 6, 0, 0]}>
                      {splitData.map((_, i) => <Cell key={i} fill="#f59e0b" />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">구간기록 없음</div>
              )}
            </Panel>

            <Panel title="방향전환 · 감속" subtitle="아질리티">
              <div className="flex flex-col justify-center gap-3 px-3 py-2 h-full">
                {kind === 'agility' ? (
                  <>
                    <StatRow label="방향전환 횟수" value={report?.turnCount != null ? `${report.turnCount}회` : '—'} />
                    <StatRow label="감속·제동 시간" value={report?.deceleration?.decelTimeMs != null ? `${report.deceleration.decelTimeMs}ms` : '—'} />
                    <StatRow label="감속 거리" value={report?.deceleration?.decelDistanceM != null ? `${report.deceleration.decelDistanceM}m` : '—'} />
                  </>
                ) : (
                  <p className="text-center text-xs text-slate-500">직선 스프린트 종목이라 방향전환 지표가 없습니다.</p>
                )}
                <div className="mt-1 rounded-lg bg-slate-100/70 dark:bg-slate-800/70 px-3 py-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400">평균 속도</span>
                    <span className="font-black">{report?.avgVelocityMs != null ? `${report.avgVelocityMs.toFixed(1)} m/s` : '—'}</span>
                  </div>
                </div>
              </div>
            </Panel>
          </section>

          {changeSummary && <ChangeSummaryPanel summary={changeSummary} />}

          <VideoCompareUpload currentVideoUrl={currentVideoUrl} title="측정 영상" />

          {/* ④ 하단: 메모 + 트레이너 코멘트 */}
          <section className="grid h-[180px] grid-cols-[1fr_1.4fr] gap-3">
            <Panel title="측정 메모" subtitle="기록">
              <div className="flex h-full items-center justify-center px-3 py-2 text-center text-xs text-slate-500">
                {report?.note || '남긴 메모가 없습니다.'}
              </div>
            </Panel>

            <Panel title="트레이너 코멘트" subtitle="기록">
              <div className="flex flex-col h-full p-2.5 gap-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="스타트 반응, 방향전환 시 무릎 안정성, 다음 측정까지의 과제 등을 적어주세요."
                  className="flex-1 w-full resize-none rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs p-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/60"
                />
                <div className="flex items-center justify-between">
                  {typeof onComment !== 'function' && (
                    <span className="text-[10px] text-slate-500">저장 후 코멘트를 남길 수 있습니다</span>
                  )}
                  <button onClick={handleSaveComment} disabled={typeof onComment !== 'function'}
                    className="self-end ml-auto rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-black px-4 py-1.5 transition-colors">
                    {saved ? '✓ 저장됨' : '코멘트 저장'}
                  </button>
                </div>
              </div>
            </Panel>
          </section>
        </div>
      </UnifiedReportPage>

      <div className="w-full max-w-[794px] mt-3">
        <ReportActions
          reportNodeId="sprint-report-sheet"
          videoBlob={videoBlob || report?.videoBlob || null}
          baseName={`${memberName}_스프린트`}
          simpleSummary={summary}
          simpleMember={member}
        />
      </div>
    </UnifiedReportCanvas>
  );
}

/* ───────── 하위 컴포넌트 ───────── */

const tooltipStyle = {
  background: '#1e293b', border: '1px solid #334155',
  borderRadius: 8, color: '#e2e8f0', fontSize: 11,
};

function Panel({ title, subtitle, children }) {
  return (
    <div className="rounded-xl bg-slate-100/40 dark:bg-slate-800/40 ring-1 ring-slate-700/50 flex flex-col min-h-0 overflow-hidden">
      <div className="px-3 pt-2 pb-1 flex items-baseline justify-between">
        <h3 className="text-xs font-black text-slate-700 dark:text-slate-200">{title}</h3>
        <span className="text-[9px] font-bold tracking-wider text-slate-500 uppercase">{subtitle}</span>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function ScoreStat({ score }) {
  const s = score ?? 0;
  const color = s >= 80 ? '#34d399' : s >= 60 ? '#fbbf24' : '#f87171';
  return (
    <div className="rounded-xl px-3 py-2.5 flex flex-col items-center justify-center border-2"
      style={{ background: 'rgba(15,23,42,0.7)', borderColor: color }}>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">종합 점수</p>
      <p className="text-3xl font-black leading-none mt-0.5" style={{ color }}>{s}</p>
      <p className="text-[9px] text-slate-500 mt-0.5">/ 100</p>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{label}</span>
      <span className="text-[11px] font-black tabular-nums text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}
