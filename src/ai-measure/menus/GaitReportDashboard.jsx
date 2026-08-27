import React, { useState, useMemo } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend,
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';
import { buildProblemFocus } from '../core/crossMeasureContext';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import MomiAutoNote from '../../components/report/MomiAutoNote.jsx';
import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';
import { aiStore } from '../../demoData';
import ReportActions from '../../components/report/ReportActions';
import { MetricCard, UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage } from '../../components/report/UnifiedReportPrimitives';
import { rangeToStatus } from '../core/unifiedReport';
import { buildSummaryData } from '../core/unifiedReport';

/*
 * GaitReportDashboard — 보행/러닝 종합 리포트 (1장 대시보드)
 * ──────────────────────────────────────────────────────────────
 * Firestore gait_reports 한 건(report)을 받아 한 화면에 정리해 보여준다.
 * report.metrics 안에 GaitRunningAnalysis 가 저장한 정량 지표가 들어 있고,
 * 구버전(아직 metrics 없는 데이터)도 깨지지 않도록 폴백을 둔다.
 *
 * props:
 *   report      gait_reports 문서 (필수)
 *   onComment   (text) => void   트레이너 코멘트 저장 콜백 (선택)
 *   onClose     () => void       닫기 (선택)
 * ──────────────────────────────────────────────────────────────
 * 이미지 저장 용이성을 위해 #gait-report-sheet 한 노드 안에 전부 담는다.
 * (html2canvas 등으로 이 노드만 캡처하면 1장 리포트가 그대로 나온다.)
 */

// 정상범위 정의 — 색/판정에 공통 사용
const RANGES = {
  cadence: { good: [160, 180], warn: [150, 190], unit: 'SPM', label: '케이던스' },
  stance: { good: [55, 65], warn: [50, 70], unit: '%', label: '입각기' },
  trunkLean: { good: [4, 12], warn: [0, 18], unit: '°', label: '몸통 기울기' },
  pelvicDrop: { good: [0, 4], warn: [0, 7], unit: '%', label: '골반 드롭' },
  verticalOsc: { good: [4, 9], warn: [0, 13], unit: '%', label: '수직 진폭' },
  kneeSym: { good: [92, 100], warn: [85, 100], unit: '%', label: '무릎 대칭' },
  stride: { good: [0.7, 1.1], warn: [0.5, 1.4], unit: '×', label: '보폭/신장' },
};

// 값이 정상/주의/이상 중 어디인지 → 색
const statusColor = (v, r) => {
  if (v == null || Number.isNaN(v)) return '#64748b';        // slate-500 (데이터 없음)
  if (v >= r.good[0] && v <= r.good[1]) return '#34d399';     // emerald-400 정상
  if (v >= r.warn[0] && v <= r.warn[1]) return '#fbbf24';     // amber-400 주의
  return '#f87171';                                          // red-400 이상
};
const statusText = (v, r) => {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= r.good[0] && v <= r.good[1]) return '정상';
  if (v >= r.warn[0] && v <= r.warn[1]) return '주의';
  return '이상';
};

// 종합 점수: 핵심 지표가 정상범위에 들면 가점 (0~100)
function computeScore(m) {
  const checks = [
    [m.cadence, RANGES.cadence],
    [m.stancePct, RANGES.stance],
    [m.trunkLean?.avg, RANGES.trunkLean],
    [m.pelvicDropAbs, RANGES.pelvicDrop],
    [m.verticalOscillation, RANGES.verticalOsc],
    [m.kneeSymmetry, RANGES.kneeSym],
    [m.strideToHeight, RANGES.stride],
  ];
  let score = 0, n = 0;
  for (const [v, r] of checks) {
    if (v == null || Number.isNaN(v)) continue;
    n++;
    if (v >= r.good[0] && v <= r.good[1]) score += 100;
    else if (v >= r.warn[0] && v <= r.warn[1]) score += 65;
    else score += 30;
  }
  return n ? Math.round(score / n) : 0;
}

// 구버전 데이터(metrics 없음) 폴백 — 최상위 필드에서 끌어온다.
function normalizeMetrics(report) {
  const m = report?.metrics || {};
  const top = report || {};
  return {
    cadence: m.cadence ?? top.cadence ?? 0,
    stancePct: m.stancePct ?? top.stancePct ?? 0,
    swingPct: m.swingPct ?? top.swingPct ?? 0,
    totalSteps: m.totalSteps ?? top.totalSteps ?? 0,
    valid: m.valid ?? top.valid,
    angles: m.angles ?? top.angles ?? { hip: {}, knee: {}, ankle: {} },
    trunkLean: m.trunkLean ?? { avg: null, max: null, min: null },
    kneeFlexion: m.kneeFlexion ?? { left: {}, right: {} },
    pelvicDrop: m.pelvicDrop ?? { avg: null, max: null, min: null },
    pelvicDropAbs: m.pelvicDropAbs ?? null,
    verticalOscillation: m.verticalOscillation ?? null,
    kneeSymmetry: m.kneeSymmetry ?? null,
    strideToHeight: m.strideToHeight ?? null,
  };
}

export default function GaitReportDashboard({ report, onComment, onClose, videoBlob, member }) {
  const m = useMemo(() => normalizeMetrics(report), [report]);
  const score = useMemo(() => computeScore(m), [m]);
  const [comment, setComment] = useState(report?.trainerComment || '');
  const [saved, setSaved] = useState(false);

  const resolvedMember = member || report?.member || null;
  const memberName = resolvedMember?.name || '회원';
  const dateStr = (report?.createdAt || report?.measuredAt || '').slice(0, 10) || '—';
  const problemFocus = useMemo(() => report?.problem_focus || buildProblemFocus('gait', report), [report]);

  // 중단 좌측: 좌/우 무릎·골반·발목 비교 (Kinematic 레이더)
  // 무릎=BiomechAccumulator 좌우, 고관절/발목=angles(AngleAccumulator) 좌우.
  // [2026-08-27] 이전엔 angles(hip/ankle)가 좌측 landmark만 누적해 이 두 축이
  // 항상 좌=우로 복제되어(실제 비대칭이 있어도 항상 대칭으로) 표시됐다 —
  // AngleAccumulator가 좌우를 각각 누적하도록 고쳐(gaitBiomechanics.js) 이제
  // 실제 좌/우 값을 쓴다. 구버전 리포트(각도 데이터에 left/right 없음)는
  // ?? 0 폴백으로 0으로 표시된다(재측정 전까지는 정상적인 동작).
  const kf = m.kneeFlexion;
  const radarData = [
    { axis: '무릎 굽힘', left: kf.left?.min ?? 0, right: kf.right?.min ?? 0 },
    { axis: '무릎 신전', left: kf.left?.max ?? 0, right: kf.right?.max ?? 0 },
    { axis: '고관절 ROM', left: m.angles?.hip?.left?.rom ?? 0, right: m.angles?.hip?.right?.rom ?? 0 },
    { axis: '발목 ROM', left: m.angles?.ankle?.left?.rom ?? 0, right: m.angles?.ankle?.right?.rom ?? 0 },
    { axis: '무릎 평균', left: kf.left?.avg ?? 0, right: kf.right?.avg ?? 0 },
  ];

  // 중단 우측: Symmetry 게이지용
  const symBars = [
    { key: 'pelvicDrop', name: '골반 드롭', value: m.pelvicDropAbs, range: RANGES.pelvicDrop, max: 12 },
    { key: 'verticalOsc', name: '수직 진폭', value: m.verticalOscillation, range: RANGES.verticalOsc, max: 16 },
    { key: 'kneeSym', name: '무릎 대칭', value: m.kneeSymmetry, range: RANGES.kneeSym, max: 100 },
  ];

  const handleSaveComment = () => {
    if (typeof onComment === 'function') onComment(comment);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <UnifiedReportCanvas>
      <UnifiedReportPage id="gait-report-sheet" className="mx-auto">
        {/* ── 헤더 ── */}
        <UnifiedReportHeader
          eyebrow="GAIT & RUNNING REPORT"
          badge="GAIT"
          title={memberName}
          subtitle={dateStr}
          score={score}
          onClose={onClose}
          compact
          member={resolvedMember}
        />

        {/* ── 본문: 4분할 ── */}
        <div className="grid gap-3">
          <ProblemFocusPanel focus={problemFocus} context={report?.cross_measure_context} />
          {/* [Axis3 확장 2026-08-08] MomiAutoNote — PostureReport.jsx와 동일 패턴.
              gait_reports 컬렉션을 jump와 공유하므로 updateGaitReport를 그대로 쓴다. */}
          <MomiAutoNote kind="gait" report={report} member={resolvedMember}
            onSaved={(patch) => aiStore.updateGaitReport(resolvedMember?.id, report.id, patch)} />
          {/* [Axis4 확장 2026-08-08] MomiAutoNote와 별개로, 필요하면 트레이너가
              직접 물어보고 후속 질문까지 이어갈 수 있는 대화창. */}
          <MomiInsightPanel kind="gait" report={report} member={resolvedMember} />

          {/* ① 상단 요약 */}
          <section className="grid grid-cols-4 gap-2.5">
            <MetricCard metric={{ key:'cadence', label:'분당 걸음수', displayValue:m.cadence, unit:'spm',
              description:`정상 ${RANGES.cadence.good[0]}~${RANGES.cadence.good[1]}`,
              status: rangeToStatus(m.cadence, RANGES.cadence) }} />
            <MetricCard metric={{ key:'stance', label:'땅 딛는 · 뜨는 비율', displayValue:`${m.stancePct}/${m.swingPct}`, unit:'%',
              description:`정상 ${RANGES.stance.good[0]}~${RANGES.stance.good[1]}%`,
              status: rangeToStatus(m.stancePct, RANGES.stance) }} />
            <MetricCard metric={{ key:'steps', label:'총 스텝', displayValue:m.totalSteps, unit:'회',
              description:'측정 구간 누적' }} />
            <ScoreStat score={score} />
          </section>

          {/* ②③ 중단: 좌 Kinematic / 우 Symmetry */}
          <section className="grid h-[280px] grid-cols-2 gap-3">
            {/* ② Kinematic 레이더 */}
            <Panel title="관절 각도 비교" subtitle="좌 · 우 비교">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="72%"
                  margin={{ top: 8, right: 18, bottom: 8, left: 18 }}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                  <Radar name="좌측" dataKey="left" stroke="#34d399" fill="#34d399" fillOpacity={0.32} />
                  <Radar name="우측" dataKey="right" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.28} />
                  <Legend iconSize={9} wrapperStyle={{ fontSize: 10, color: '#cbd5e1' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
              <p className="px-2 pb-1 text-[10px] text-slate-500 text-center">
                무릎 굽힘=값 작을수록 깊게 굽힘 · 좌우 형태가 겹칠수록 대칭적
              </p>
            </Panel>

            {/* ③ Symmetry 게이지 */}
            <Panel title="좌우 균형 지표" subtitle="균형 점검">
              <div className="flex flex-col justify-center gap-3 px-3 py-2 h-full">
                {symBars.map((b) => (
                  <GaugeRow key={b.key}
                    name={b.name} value={b.value} unit={b.range.unit}
                    range={b.range} max={b.max} />
                ))}
                <div className="mt-1 rounded-lg bg-slate-100/70 dark:bg-slate-800/70 px-3 py-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400">몸통 전방 기울기</span>
                    <span style={{ color: statusColor(m.trunkLean?.avg, RANGES.trunkLean) }} className="font-black">
                      {m.trunkLean?.avg ?? '—'}° · {statusText(m.trunkLean?.avg, RANGES.trunkLean)}
                    </span>
                  </div>
                  <p className="text-[9px] text-slate-500 mt-0.5">정상 {RANGES.trunkLean.good[0]}~{RANGES.trunkLean.good[1]}°</p>
                </div>
              </div>
            </Panel>
          </section>

          {/* ④ 하단: Spatial + 코멘트 */}
          <section className="grid h-[180px] grid-cols-[1fr_1.4fr] gap-3">
            <Panel title="보폭 비율" subtitle="걸음 크기">
              <div className="flex flex-col items-center justify-center h-full py-2">
                <div className="text-4xl font-black"
                  style={{ color: statusColor(m.strideToHeight, RANGES.stride) }}>
                  {m.strideToHeight ?? '—'}<span className="text-base text-slate-500 dark:text-slate-400 ml-1">×</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">보폭 / 신장 비율</p>
                <p className="text-[10px] mt-0.5"
                  style={{ color: statusColor(m.strideToHeight, RANGES.stride) }}>
                  정상 {RANGES.stride.good[0]}~{RANGES.stride.good[1]}× · {statusText(m.strideToHeight, RANGES.stride)}
                </p>
              </div>
            </Panel>

            <Panel title="트레이너 코멘트" subtitle="기록">
              <div className="flex flex-col h-full p-2.5 gap-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="자세 교정 포인트, 다음 측정까지의 과제 등을 적어주세요."
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

      {/* 결과 리포트 화면 내 저장 액션 (캡처 노드 #gait-report-sheet 바깥) */}
      <div className="w-full max-w-[794px] mt-3">
        <ReportActions
          reportNodeId="gait-report-sheet"
          videoBlob={videoBlob || report?.videoBlob || null}
          baseName={`${memberName}_보행`}
          simpleSummary={buildSummaryData(report, { reportType: 'gait' })}
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
  const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  return (
    <div className="rounded-xl px-3 py-2.5 flex flex-col items-center justify-center border-2"
      style={{ background: 'rgba(15,23,42,0.7)', borderColor: color }}>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">종합 점수</p>
      <p className="text-3xl font-black leading-none mt-0.5" style={{ color }}>{score}</p>
      <p className="text-[9px] text-slate-500 mt-0.5">/ 100</p>
    </div>
  );
}

// 한 줄 게이지: 값 위치를 정상범위 밴드 위에 표시
function GaugeRow({ name, value, unit, range, max }) {
  const v = (value == null || Number.isNaN(value)) ? null : value;
  const pct = v == null ? 0 : Math.max(0, Math.min(100, (v / max) * 100));
  const goodL = (range.good[0] / max) * 100;
  const goodW = ((range.good[1] - range.good[0]) / max) * 100;
  const color = statusColor(v, range);
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{name}</span>
        <span className="text-[11px] font-black tabular-nums" style={{ color }}>
          {v ?? '—'}{v != null ? unit : ''} · {statusText(v, range)}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-slate-200/70 dark:bg-slate-700/70 overflow-hidden">
        {/* 정상범위 밴드 */}
        <div className="absolute top-0 h-full bg-emerald-500/25"
          style={{ left: `${goodL}%`, width: `${goodW}%` }} />
        {/* 실제 값 막대 */}
        <div className="absolute top-0 left-0 h-full rounded-full"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="text-[9px] text-slate-500 mt-0.5">
        정상 {range.good[0]}~{range.good[1]}{unit}
      </p>
    </div>
  );
}
