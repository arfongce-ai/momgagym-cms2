// pages/Report.jsx
// 측정 리포트 페이지: 회원 선택 → 실측 데이터 그래프/요약 열람.
import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { todayYMD } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { scopeMembersToTrainer, sortByName } from '../utils/memberList';
import { store, aiStore } from '../demoData';
import { buildFullReport, buildAnalysisTrend, buildPostureTrend, groupResultsByDate, buildInterpretationGuide, GUIDE_STATUS_LEGEND, menuGroupKey, plausibleVelocity } from '../services/reportService';
import { JUMP_SUBTYPES, resolveJumpSubType } from '../ai-measure/core/jumpTypes';
import { buildSummaryData, scoreToStatus, defaultRecommendation } from '../ai-measure/core/unifiedReport';
import { buildComprehensiveReport } from '../ai-measure/core/comprehensiveReport';
import { loadAllMeasureRecords, deleteMeasureRound, deleteMeasureType, deleteMeasureRecord } from '../services/comprehensiveReportService';
import { findAnomalies } from '../ai-measure/core/comprehensiveReport';
import { captureNodeToJpgFile, shareMeasurementSummaryToKakao } from '../ai-measure/core/reportShare';
import { canCaptureUnifiedResult, isLiftingShapedSession } from '../components/report/sessionShare';
import SessionShareReport from '../components/report/SessionShareReport';
import ReportActions from '../components/report/ReportActions';
import TrendChart from '../components/report/TrendChart';
import MemberPicker from '../components/common/MemberPicker';
import CombinedAssessmentPanel from '../components/report/CombinedAssessmentPanel';
import { consumePendingVoiceTarget } from '../voice/pendingVoiceTarget';
const JumpReportDashboard = lazy(() => import('../ai-measure/menus/JumpReportDashboard'));
const GaitReportDashboard = lazy(() => import('../ai-measure/menus/GaitReportDashboard'));
const PostureReport = lazy(() => import('../ai-measure/menus/PostureReport'));
const RomReport = lazy(() => import('../ai-measure/menus/RomReport'));
const LiftingReportDashboard = lazy(() => import('../ai-measure/menus/LiftingReportDashboard'));
// [리포트 통합 2026-08-09] SLST 저장된 리포트 열람 신설 — 다른 5개 측정 종류와
// 마찬가지로 이제 이 화면에서도 볼 수 있다(StanceAnalysisHub.jsx/
// StanceReportDashboard.jsx와 같은 컴포넌트를 재사용, 재구현 아님).
const StanceReportDashboard = lazy(() => import('../ai-measure/menus/StanceReportDashboard'));
const SquatReportDashboard = lazy(() => import('../ai-measure/menus/SquatReportDashboard'));

const COLORS = { weight:'#f59e0b', systolic:'#ef4444', diastolic:'#3b82f6', height:'#22d3ee' };
const DETAIL_SESSION_MENUS = new Set(['jump', 'gait', 'posture', 'rom', 'lifting']);

const REPORT_TYPE_META = {
  posture: { title: '자세·체형', badge: 'POSTURE', accent: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  rom: { title: '관절 가동범위', badge: 'ROM', accent: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-500/15', border: 'border-sky-500/25' },
  jump: { title: '점프·RSI', badge: 'JUMP', accent: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-500/25' },
  gait: { title: '보행·러닝', badge: 'GAIT', accent: 'text-cyan-700 dark:text-cyan-300', bg: 'bg-cyan-500/15', border: 'border-cyan-500/25' },
  one_rm: { title: '최대 근력', badge: '1RM', accent: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-500/15', border: 'border-violet-500/25' },
  vbt: { title: '운동 속도 근력', badge: 'VBT', accent: 'text-fuchsia-700 dark:text-fuchsia-300', bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-500/25' },
  general: { title: '측정 결과', badge: 'AI', accent: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-200 dark:bg-slate-700', border: 'border-slate-300 dark:border-slate-700' },
};

const STATUS_STYLE = {
  normal: { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/12', border: 'border-emerald-500/30' },
  caution: { text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/12', border: 'border-amber-500/30' },
  risk: { text: 'text-red-700 dark:text-red-300', bg: 'bg-red-500/12', border: 'border-red-500/30' },
  unknown: { text: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-200/60 dark:bg-slate-700/60', border: 'border-slate-300 dark:border-slate-700' },
};

function isJumpRsi(data) {
  return data?.jumpType === 'reactive' || Boolean(data?.rsi);
}

// 세션 1건에서 회차비교용 핵심 수치/라벨을 뽑는다 (메뉴별).
function getReportDate(item) {
  return String(
    item?.createdAt
    || item?.measuredAt
    || item?.recordedAtFull
    || item?.recordedAt
    || item?.basic_info?.createdAt
    || ''
  );
}

function formatDateOnly(value) {
  return String(value || '').slice(0, 10) || '-';
}

export function reportTypeFromSession(session) {
  if (session?.menu === 'onerm') return 'one_rm';
  if (session?.menu === 'vbt') return 'vbt';
  if (session?.menu === 'rsi') return 'jump';
  // 통합 바벨 리프팅 허브 세션: data.mode 로 세부 분류 (unifiedReport.inferReportType 과 동일 규칙).
  //  'lifting' 그대로 두면 REPORT_TYPE_META/reportTitle 에 매칭되지 않아 일반 'AI' 카드로 떨어진다.
  if (session?.menu === 'lifting') {
    const mode = session?.data?.mode;
    if (mode === 'onerm' || session?.data?.metrics?.oneRM != null) return 'one_rm';
    return 'vbt'; // 역도·VBT 모두 속도 기반 평가로 표시
  }
  return session?.menu || 'general';
}

function getReportTypeMeta(type, report) {
  if (type === 'jump' && isJumpRsi(report)) {
    return { ...REPORT_TYPE_META.jump, title: 'RSI 반응 점프', badge: 'RSI', accent: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' };
  }
  return REPORT_TYPE_META[type] || REPORT_TYPE_META.general;
}

function makeUnifiedResult({ report, reportType, source, index, member, session }) {
  const data = {
    ...(report || {}),
    kind: (report || {}).kind || reportType,
    member: (report || {}).member || member,
    measuredAt: getReportDate(report || session) || new Date().toISOString(),
  };
  const summary = buildSummaryData(data, { reportType });
  const status = scoreToStatus(summary.overallScore);
  const meta = getReportTypeMeta(reportType, data);
  return {
    id: `${source}:${data.id || session?.id || index}`,
    source,
    index,
    session,
    report: data,
    reportType,
    date: summary.measuredAt || getReportDate(data),
    summary: {
      ...summary,
      status: summary.status || status.key,
      statusLabel: summary.statusLabel || status.label,
    },
    meta,
  };
}

const WEEKDAYS = ['일','월','화','수','목','금','토'];

function scoreTone(score) {
  if (score == null) return 'text-slate-500';
  if (score >= 80) return 'text-emerald-700 dark:text-emerald-400';
  if (score >= 60) return 'text-amber-700 dark:text-amber-400';
  return 'text-red-700 dark:text-red-400';
}

// 캘린더는 회원 선택 화면(Schedule.jsx MonthView)과 동일한 일요일 시작 그리드를 쓴다.
function MeasureCalendar({ pivot, onPivotChange, dailyMap, selectedDate, onSelectDate, todayStr }) {
  const d = new Date(`${pivot}-01T12:00:00`);
  const y = d.getFullYear(), mo = d.getMonth();
  const first = new Date(y, mo, 1).getDay();
  const days = new Date(y, mo + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => {
    const day = i - first + 1;
    return (day > 0 && day <= days) ? `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
  });

  const shiftMonth = (delta) => {
    const nd = new Date(y, mo + delta, 1);
    onPivotChange(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
        <button type="button" onClick={() => shiftMonth(-1)} className="px-2 py-1 text-sm font-bold text-slate-500 dark:text-slate-400 active:text-white">◀</button>
        <p className="text-sm font-black text-white">{y}년 {mo + 1}월</p>
        <button type="button" onClick={() => shiftMonth(1)} className="px-2 py-1 text-sm font-bold text-slate-500 dark:text-slate-400 active:text-white">▶</button>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 text-center text-[11px] font-bold text-slate-500">
        {WEEKDAYS.map(w => <div key={w} className="py-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-14 border-b border-r border-slate-200/70 dark:border-slate-800/70 opacity-20" />;
          const g = dailyMap[date];
          const isToday = date === todayStr;
          const isSelected = date === selectedDate;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              className={`min-h-14 border-b border-r border-slate-200/70 dark:border-slate-800/70 p-1 text-left transition-colors ${
                isSelected ? 'bg-amber-500/15' : isToday ? 'bg-amber-500/5' : 'hover:bg-slate-100/40 dark:hover:bg-slate-800/40'
              }`}
            >
              <p className={`font-mono text-[10px] font-bold ${isToday ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {parseInt(date.slice(8, 10), 10)}
              </p>
              {g && (
                g.avgScore != null ? (
                  <p className={`text-[11px] font-black ${scoreTone(g.avgScore)}`}>{g.avgScore}</p>
                ) : (
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />
                )
              )}
              {g?.count > 1 && <p className="text-[9px] text-slate-600">{g.count}건</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// AI 측정 이력 아코디언에서 메뉴별(점프/보행/자세) 다지표 회차 추세.
// 기존에 별도 섹션(점프추세/보행추세/자세체형추세)이 보여주던 지표를 여기로 흡수해 중복을 없앤다.
function extraMenuTrendCharts(menu, trend, postureTrend) {
  if (menu === 'jump' && trend?.jump?.count > 0) {
    return [
      trend.jump.height.length > 1 && { key: 'height', title: '점프 높이', unit: 'cm', points: trend.jump.height, color: '#f59e0b' },
      trend.jump.peakPower.length > 1 && { key: 'peakPower', title: '최대 파워', unit: 'W', points: trend.jump.peakPower, color: '#22d3ee' },
      trend.jump.footSym.length > 1 && { key: 'footSym', title: '착지 대칭', unit: '%', points: trend.jump.footSym, color: '#34d399' },
      trend.jump.landKnee.length > 1 && { key: 'landKnee', title: '착지 무릎각', unit: '°', points: trend.jump.landKnee, color: '#a78bfa' },
    ].filter(Boolean);
  }
  if (menu === 'gait' && trend?.gait?.count > 0) {
    return [
      trend.gait.cadence.length > 1 && { key: 'cadence', title: '케이던스', unit: 'SPM', points: trend.gait.cadence, color: '#f59e0b' },
      trend.gait.pelvicDrop.length > 1 && { key: 'pelvicDrop', title: '골반 드롭', unit: '%', points: trend.gait.pelvicDrop, color: '#ef4444' },
      trend.gait.kneeSym.length > 1 && { key: 'kneeSym', title: '무릎 대칭', unit: '%', points: trend.gait.kneeSym, color: '#34d399' },
    ].filter(Boolean);
  }
  if (menu === 'posture' && postureTrend?.count > 0) {
    return [
      postureTrend.score.length > 1 && { key: 'score', title: '자세 점수', unit: '점', points: postureTrend.score, color: '#f59e0b' },
      postureTrend.forwardHead.length > 1 && { key: 'forwardHead', title: '거북목(전방이동)', unit: 'mm', points: postureTrend.forwardHead, color: '#ef4444' },
      postureTrend.shoulderDiff.length > 1 && { key: 'shoulderDiff', title: '어깨 높이차', unit: 'mm', points: postureTrend.shoulderDiff, color: '#22d3ee' },
      postureTrend.pelvisDiff.length > 1 && { key: 'pelvisDiff', title: '골반 높이차', unit: 'mm', points: postureTrend.pelvisDiff, color: '#a78bfa' },
    ].filter(Boolean);
  }
  return [];
}

const COMPREHENSIVE_UNITS = [
  { key: 'day', label: '일간' },
  { key: 'week', label: '주간' },
  { key: 'month', label: '월간' },
];

// 종합리포트 전용 표시 라벨. 내부 등급 체계(정상/주의/위험)는 그대로 두고
// 이 섹션에서만 "우수/적정/부족"으로 바꿔 보여준다(측정 성과 맥락에 맞는 표현).
const PERFORMANCE_LABEL = { normal: '우수', caution: '적정', risk: '부족', unknown: '평가 불가' };

// 일간·주간·월간 종합 리포트 — 리포트 탭 안의 별도 섹션.
// 이미 선택된 회원을 그대로 쓰고(별도 회원 선택 없음), 기존 comprehensiveReport 엔진을 그대로 재사용한다.
function ComprehensiveReportSection({ member, dataReady, onRecordsChanged }) {
  const [unit, setUnit] = useState('week');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [periodKey, setPeriodKey] = useState(null);
  // [리포트 통합 2026-08-09] 종전엔 독립 페이지(ComprehensiveReport.jsx, /summary)에만
  // 있던 기능 — 이상 데이터(사유 표시) 확인 후 개별/일괄 삭제. 이 섹션이 이제
  // 유일한 종합리포트 화면이 되면서 그 페이지의 기능을 전부 흡수한다(빠짐없이
  // 이관 — 기능 손실 없음).
  const [deleting, setDeleting] = useState(null); // 삭제 중인 레코드 id

  useEffect(() => {
    if (!member) { setRecords([]); return; }
    let alive = true;
    setLoading(true);
    loadAllMeasureRecords(member.id)
      .then((list) => { if (alive) setRecords(list); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [member?.id, dataReady]);

  useEffect(() => { setPeriodKey(null); }, [unit, member?.id]);

  const report = useMemo(() => buildComprehensiveReport(records, unit), [records, unit]);
  const selected = report.periods.find(p => p.key === periodKey) || report.periods[0] || null;
  // [리포트 통합 2026-08-09] 이상 데이터는 기간(unit)과 무관하게 회원의 전체
  // 기록 기준으로 판정한다 — 독립 페이지 시절과 동일한 기준(findAnomalies는
  // records 전체를 봄, 선택된 기간 periods가 아님).
  const anomalies = useMemo(() => findAnomalies(records), [records]);

  const handleDelete = async (record, why = '') => {
    const label = `${record.dateYMD || '날짜없음'} · ${record.typeLabel} · ${record.sourceLabel}`;
    const reason = why ? `\n사유: ${why}` : '';
    if (!window.confirm(`이 기록을 삭제할까요?\n${label}${reason}\n\n삭제하면 통합 리포트 사본까지 함께 제거되며 되돌릴 수 없습니다.`)) return;
    setDeleting(record.id);
    try {
      await deleteMeasureRecord(member.id, record);
      setRecords(prev => prev.filter(r => !(r.id === record.id && r.source === record.source)));
      onRecordsChanged?.();
    } catch (e) {
      alert(`삭제 실패: ${e?.message || e}`);
    } finally { setDeleting(null); }
  };

  const handleDeleteAllAnomalies = async () => {
    if (!anomalies.length) return;
    if (!window.confirm(`이상 데이터 ${anomalies.length}건을 모두 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    for (const a of anomalies) {
      setDeleting(a.record.id);
      try {
        await deleteMeasureRecord(member.id, a.record);
        setRecords(prev => prev.filter(r => !(r.id === a.record.id && r.source === a.record.source)));
      } catch (e) { alert(`삭제 실패(${a.record.id}): ${e?.message || e}`); break; }
    }
    setDeleting(null);
    onRecordsChanged?.();
  };

  // 기간별 평균 점수 변화 그래프(8-3) — 과거→최근 순으로 정렬.
  const trendPoints = useMemo(() => (
    [...report.periods]
      .filter(p => p.stats.score)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(p => ({ date: p.key, value: p.stats.score.avg }))
  ), [report.periods]);

  if (!member) return null;

  return (
    <section id="section-comprehensive" className="scroll-mt-14 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 p-3">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">종합 리포트</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">일간·주간·월간 측정을 모아 종합 평가합니다.</p>
        </div>
      </div>

      <div className="mb-3 flex overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700">
        {COMPREHENSIVE_UNITS.map((u) => (
          <button
            key={u.key}
            type="button"
            onClick={() => setUnit(u.key)}
            className={`flex-1 px-3 py-2 text-xs font-black transition-colors ${
              unit === u.key ? 'bg-amber-500 text-slate-950' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'
            }`}
          >
            {u.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-500">불러오는 중…</div>
      ) : report.periods.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center text-sm font-semibold text-slate-500">
          집계할 측정 기록이 없습니다.
        </div>
      ) : (
        <>
          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {report.periods.map((p) => {
              const active = selected?.key === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPeriodKey(p.key)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                    active ? 'border-amber-400 bg-amber-500 text-slate-950' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {p.label} <span className="opacity-70">{p.records.length}건</span>
                </button>
              );
            })}
          </div>

          {trendPoints.length > 1 && (
            <div className="mb-3">
              <TrendChart title={`${COMPREHENSIVE_UNITS.find(u => u.key === unit)?.label} 평균 점수 변화`} unit="점"
                points={trendPoints} color="#fbbf24" width={320} height={150} />
            </div>
          )}

          {selected && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                <p className="text-sm font-black text-white">{selected.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">측정 {selected.stats.total}회 · 유형 {selected.stats.typeCount}종</p>
                {selected.stats.score && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    기간 평균 <span className="font-mono font-black text-amber-700 dark:text-amber-400">{selected.stats.score.avg}</span>/100
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {selected.stats.typeStats.map((ts) => {
                  const token = ts.score ? scoreToStatus(ts.score.avg) : null;
                  const perfLabel = token ? (PERFORMANCE_LABEL[token.key] || token.label) : '평가 불가';
                  // 8-2: 부족(risk) 등급일 때만 무엇을 확인/훈련할지 코멘트를 보여준다.
                  const comment = token?.key === 'risk' ? defaultRecommendation(ts.type, 'risk') : null;
                  return (
                    <div key={ts.type} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{ts.typeLabel}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-500">{ts.count}회</span>
                          {token && (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${token.bgClass} ${token.borderClass} ${token.colorClass}`}>
                              {perfLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      {ts.score ? (
                        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          평균 {ts.score.avg} · 최저 {ts.score.min} · 최고 {ts.score.max}
                          {ts.score.count >= 2 && (
                            <span className={`ml-2 font-bold ${ts.score.delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : ts.score.delta < 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-500'}`}>
                              {ts.score.delta > 0 ? '▲' : ts.score.delta < 0 ? '▼' : '–'}{Math.abs(ts.score.delta)}
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-600">점수형 지표 없음</p>
                      )}
                      {comment && (
                        <p className="mt-2 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-200">
                          💡 {comment}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* [리포트 통합 2026-08-09] 독립 페이지(ComprehensiveReport.jsx)에서 이관 —
          선택한 기간(unit/periodKey)과 무관하게 회원 전체 기록 기준. */}
      {anomalies.length > 0 && (
        <div className="mt-3 rounded-2xl bg-red-950/20 border border-red-900/50">
          <div className="px-4 py-3 flex items-center gap-3 border-b border-red-900/40">
            <div className="flex-1">
              <div className="text-sm font-black text-red-700 dark:text-red-300">이상 데이터 {anomalies.length}건</div>
              <div className="text-[11px] text-red-700 dark:text-red-400/70">사유를 확인하고 잘못 저장된 결과데이터·리포트를 제거하세요.</div>
            </div>
            <button onClick={handleDeleteAllAnomalies}
              className="text-[11px] font-bold text-red-700 dark:text-red-300 border border-red-500/40 rounded-lg px-2.5 py-1.5 active:scale-95 transition-transform">
              일괄 삭제
            </button>
          </div>
          <div className="divide-y divide-red-900/30">
            {anomalies.map(a => (
              <div key={`${a.record.source}_${a.record.id}`} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{a.record.typeLabel}
                    <span className="text-xs text-slate-500 font-normal ml-1.5">{a.record.sourceLabel} · {a.record.dateYMD || '날짜 없음'}</span>
                  </div>
                  <div className="text-[11px] text-red-700 dark:text-red-400">{a.reasons.join(' · ')}</div>
                </div>
                <button onClick={() => handleDelete(a.record, a.reasons.join(', '))} disabled={deleting === a.record.id}
                  className="text-[11px] font-bold text-red-700 dark:text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1.5 active:scale-95 transition-transform disabled:opacity-40">
                  {deleting === a.record.id ? '삭제 중…' : '삭제'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const GUIDE_STATUS_TONE = { normal: 'text-emerald-700 dark:text-emerald-400', caution: 'text-amber-700 dark:text-amber-400', risk: 'text-red-700 dark:text-red-400' };

// 측정별 분석·평가 판독 설명서 — 회원에게 설명하고 트레이닝에 적용할 수 있도록
// 유형별로 접었다 펴는 아코디언. 실제 측정한 유형만 보여준다(측정 정직성 — 안 한 측정은 나열하지 않음).
function InterpretationGuideSection({ guide }) {
  const [openType, setOpenType] = useState(null);
  if (!guide.length) return null;

  return (
    <div id="section-guide" className="scroll-mt-14">
      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">측정별 분석·평가 판독 설명서</p>

      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5">
        {GUIDE_STATUS_LEGEND.map((s) => (
          <p key={s.key} className="text-[11px]">
            <span className={`font-black ${GUIDE_STATUS_TONE[s.key] || 'text-slate-500 dark:text-slate-400'}`}>{s.label}</span>
            <span className="text-slate-500"> · {s.meaning}</span>
          </p>
        ))}
      </div>

      <div className="space-y-2">
        {guide.map((g) => {
          const open = openType === g.type;
          return (
            <div key={g.type} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setOpenType(open ? null : g.type)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{g.typeLabel}</p>
                <span className={`text-xs text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {open && (
                <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 p-4">
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{g.overview}</p>

                  {g.metrics.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold text-slate-500">핵심 지표</p>
                      {g.metrics.map((m) => (
                        <div key={m.key} className="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 px-3 py-2">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{m.label}</p>
                          {m.description && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{m.description}</p>}
                          {m.hint && <p className="mt-0.5 text-[10px] text-slate-500">{m.hint}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  {g.trainingTip && (
                    <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
                      <p className="mb-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">🏋️ 트레이닝 적용</p>
                      <p className="text-[11px] leading-relaxed text-amber-100/90">{g.trainingTip}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function buildUnifiedResults({ member, savedReports, savedPostureReports, savedRomReports, savedLiftingSessions, sessions }) {
  if (!member) return [];
  const items = [];

  savedPostureReports.forEach((report, index) => {
    items.push(makeUnifiedResult({ report, reportType: 'posture', source: 'posture', index, member }));
  });
  savedRomReports.forEach((report, index) => {
    items.push(makeUnifiedResult({ report, reportType: 'rom', source: 'rom', index, member }));
  });
  savedReports.forEach((report, index) => {
    const reportType = report?.kind === 'jump' || report?.jumpType || report?.heightCm != null ? 'jump' : 'gait';
    items.push(makeUnifiedResult({ report, reportType, source: 'saved-report', index, member }));
  });
  // 바벨 리프팅: 전용 컬렉션이 없어 세션의 data를 그대로 리포트로 쓴다
  // (BarbellLiftingHub가 측정 직후 같은 방식으로 세션 data를 펼쳐 리포트를 만든다).
  (savedLiftingSessions || []).forEach((session, index) => {
    const reportType = reportTypeFromSession(session);
    items.push(makeUnifiedResult({
      report: {
        ...(session.data || {}),
        kind: reportType,
        member,
        measuredAt: session.recordedAtFull || session.recordedAt,
      },
      reportType,
      source: 'lifting',
      index,
      member,
      session,
    }));
  });

  (sessions || [])
    .filter((session) => !DETAIL_SESSION_MENUS.has(session.menu))
    .forEach((session, index) => {
      const reportType = reportTypeFromSession(session);
      items.push(makeUnifiedResult({
        report: {
          ...(session.data || {}),
          kind: reportType,
          member,
          measuredAt: session.recordedAtFull || session.recordedAt,
        },
        reportType,
        source: 'session',
        index,
        member,
        session,
      }));
    });

  return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

const REPORT_CAPTURE_PAGE_SELECTOR = '.report-a4-page';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });
}

async function waitForShareCapture(ref, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await nextFrame();
    const root = ref.current?.querySelector('[data-share-report-ready="true"]');
    const page = root?.querySelector(REPORT_CAPTURE_PAGE_SELECTOR);
    if (page && page.getBoundingClientRect().width > 0 && page.getBoundingClientRect().height > 0) {
      await nextFrame();
      return root;
    }
  }
  return ref.current?.querySelector('[data-share-report-ready="true"]') || null;
}

// 캡처(숨은 노드 렌더 → html2canvas) 전에 필요한 리포트 컴포넌트를 미리 import 해둔다.
// 리포트 5종은 모두 lazy 로드라, 이 회원의 이 리포트를 화면에서 한 번도 안 열어봤으면
// 캡처 시점에 처음 청크를 내려받게 되어 Suspense fallback(빈 A4 박스)만 찍힐 수 있다.
async function preloadReportChunk(item) {
  const report = item?.report || {};
  try {
    if (item?.source === 'saved-report') {
      await (report.kind === 'jump'
        ? import('../ai-measure/menus/JumpReportDashboard')
        : import('../ai-measure/menus/GaitReportDashboard'));
    } else if (item?.source === 'posture') {
      await import('../ai-measure/menus/PostureReport');
    } else if (item?.source === 'rom') {
      await import('../ai-measure/menus/RomReport');
    } else if (item?.source === 'lifting') {
      await import('../ai-measure/menus/LiftingReportDashboard');
    } else if (item?.source === 'session' && isLiftingShapedSession(report)) {
      await import('../ai-measure/menus/LiftingReportDashboard');
    }
  } catch (e) {
    console.warn('[Report] 리포트 청크 프리로드 실패(캡처는 계속 시도):', e?.message);
  }
}

async function waitForImages(root, timeoutMs = 1200) {
  const images = Array.from(root?.querySelectorAll?.('img') || []).filter(img => !img.complete);
  if (!images.length) {
    await nextFrame();
    return;
  }
  await Promise.race([
    Promise.all(images.map(img => new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))),
    sleep(timeoutMs),
  ]);
}

function safeFileSegment(value, fallback = 'report') {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || fallback;
}

function buildShareFileBaseName(item, member) {
  const rawDate = formatDateOnly(item?.date);
  const date = rawDate && rawDate !== '-' ? rawDate.replace(/-/g, '') : todayYMD().replace(/-/g, '');
  return [
    safeFileSegment(member?.name || item?.report?.member?.name, '회원'),
    safeFileSegment(item?.meta?.badge || item?.reportType, '리포트'),
    date,
  ].join('_');
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

async function shareReportFilesOrDownload(files, { title, text } = {}) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (!list.length) return { ok: false, mode: 'none', msg: '공유할 리포트 이미지가 없습니다.' };

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      const shareFiles = !navigator.canShare
        ? list
        : navigator.canShare({ files: list })
          ? list
          : list.length > 1 && navigator.canShare({ files: [list[0]] })
            ? [list[0]]
            : null;
      if (shareFiles) {
        await navigator.share({ title, text, files: shareFiles });
        return {
          ok: true,
          mode: 'share',
          msg: shareFiles.length === list.length ? '리포트 이미지를 공유했습니다.' : '리포트 첫 페이지 이미지를 공유했습니다.',
        };
      }
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: false, mode: 'cancel', msg: '' };
    }
  }

  list.forEach((file, index) => setTimeout(() => downloadFile(file), index * 250));
  return {
    ok: true,
    mode: 'download',
    msg: '이 기기에서는 이미지 공유가 제한되어 리포트 JPG를 저장했습니다.',
  };
}

function ShareCaptureReport({ item, member }) {
  if (!item) return null;
  const report = item.report || {};
  const reportMember = member || report.member;

  if (item.source === 'saved-report') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-50 dark:bg-slate-950">
        {report.kind === 'jump'
          ? <JumpReportDashboard report={report} member={reportMember} />
          : <GaitReportDashboard report={report} member={reportMember} />}
      </div>
    );
  }

  if (item.source === 'posture') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-50 dark:bg-slate-950">
        <PostureReport
          report={report}
          member={reportMember}
          heightCm={report?.heightCm}
          actualAge={report?.actualAge}
        />
      </div>
    );
  }

  if (item.source === 'rom') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-50 dark:bg-slate-950">
        <RomReport report={{ ...report, member: report.member || reportMember }} />
      </div>
    );
  }

  if (item.source === 'lifting') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-50 dark:bg-slate-950">
        <LiftingReportDashboard report={report} member={reportMember} />
      </div>
    );
  }

  // 세션(측정이력) 항목: 전용 리포트 화면이 없어도 A4 리포트로 그려 캡처한다.
  //  · 바벨 리프팅(역도/VBT/1RM) 페이로드는 전용 대시보드로 렌더(측정 직후와 동일 화면).
  //  · 그 외(신체정보·레거시 세션 등)는 통합 요약 기반 A4 리포트로 렌더.
  if (item.source === 'session') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-50 dark:bg-slate-950">
        {isLiftingShapedSession(report)
          ? <LiftingReportDashboard report={report} member={reportMember} />
          : <SessionShareReport item={item} member={reportMember} />}
      </div>
    );
  }

  return null;
}

// 세션 하나가 어느 전용 리포트(자세/ROM/보행·점프)에 대응하는지 찾는다.
//  1순위: linkedSessionId — 저장 시 명시적으로 연결한 값(신규 데이터, 100% 정확)
//  2순위: measuredAt 완전일치 — 과거 데이터 호환용 폴백(두 저장이 같은 원본 payload를
//         공유해 대개 일치하지만, 저장 시각이 미세하게 어긋나면 실패할 수 있다).
export function findLinkedReportIndex(session, list) {
  if (!session?.id || !Array.isArray(list) || !list.length) return -1;
  const byLink = list.findIndex(sr => sr.linkedSessionId && sr.linkedSessionId === session.id);
  if (byLink >= 0) return byLink;
  const measuredAt = session.data?.measuredAt;
  if (!measuredAt) return -1;
  return list.findIndex(sr => sr.measuredAt && sr.measuredAt === measuredAt);
}

export function extractSessionMetric(session) {
  const d = session.data || {};
  switch (session.menu) {
    case 'onerm':   return { value: d.oneRM, unit: 'kg', label: `1RM (${d.liftLabel ?? ''} ${d.weight ?? '-'}kg×${d.reps ?? '-'}회)` };
    case 'lifting': {
      // 통합 바벨 리프팅 허브 페이로드(mode + metrics)
      const m = d.metrics || {};
      if (d.mode === 'onerm' || m.oneRM != null) {
        return { value: m.oneRM, unit: 'kg', label: `1RM 추정 (${d.metadata?.weight ?? '-'}kg×${d.metadata?.reps ?? '-'}회)` };
      }
      return { value: plausibleVelocity(m.meanVelocity), unit: 'm/s', label: d.mode === 'lifting' ? '역도 평균속도' : 'VBT 평균속도' };
    }
    case 'rsi':     return { value: d.rsi, unit: '', label: `RSI · 높이 ${d.heightCm ?? '-'}cm` };
    case 'vbt':     return { value: plausibleVelocity(d.meanVelocity), unit: 'm/s', label: `평균속도 (${d.zone ?? ''})` };
    case 'jump': {
      // [2026-08-10] CMJ 이름 변경 + SJ/DJ/SLJ — 세부 종류별로 정확한 라벨을 쓴다.
      // (예전엔 RSI/파워 둘로만 나눠 DJ도 "RSI 반응점프"로 뭉뚱그렸다.)
      const subType = resolveJumpSubType(d);
      const subMeta = JUMP_SUBTYPES[subType] || JUMP_SUBTYPES.cmj;
      if (subMeta.engine === 'reactive') {
        return { value: d.rsi?.rsi ?? d.rsi, unit: '', label: `${subMeta.code} · 높이 ${d.heightCm ?? '-'}cm` };
      }
      const legSuffix = subType === 'slj' && d.leg ? ` · ${d.leg === 'left' ? '왼발' : '오른발'}` : '';
      return { value: d.heightCm, unit: 'cm', label: `${subMeta.code} · ${d.peakPower ? `${d.peakPower}W` : '파워 미입력'}${legSuffix}` };
    }
    case 'posture': {
      const shoulder = d.analysis?.frontal?.shoulderHeightDiffMm ?? d.frontal?.shoulderHeightDiffMm;
      const pelvis = d.analysis?.frontal?.pelvisHeightDiffMm ?? d.frontal?.pelvisHeightDiffMm;
      return { value: shoulder, unit: 'mm', label: `어깨 높이차 · 골반 ${pelvis ?? '-'}mm` };
    }
    case 'rom': {
      const s = d.summary || d;
      const angle = s.max_rom ?? s.left_max_rom ?? s.right_max_rom ?? s.max_angle ?? d.maxAngle ?? d.angle;
      const joint = d.joint || d.basic_info?.joint || '';
      return { value: angle, unit: '°', label: `가동범위${joint ? ` · ${joint}` : ''}` };
    }
    case 'gait':    return { value: d.cadence ?? d.metrics?.cadence, unit: 'SPM', label: '케이던스' };
    case 'body':    return { value: d.weight, unit: 'kg', label: `체중${d.systolic ? ` · ${d.systolic}/${d.diastolic}` : ''}` };
    default:        return { value: null, unit: '', label: '측정' };
  }
}

function UnifiedResultCard({ item, onOpen, onShare, sharing }) {
  const statusStyle = STATUS_STYLE[item.summary.status] || STATUS_STYLE.unknown;
  const findings = (item.summary.topFindings || []).slice(0, 3);
  const canOpen = item.source !== 'session' || item.session?.menu;
  return (
    <div
      className={`w-full rounded-2xl border bg-white dark:bg-slate-900 p-4 ${item.meta.border}`}
    >
      <button
        type="button"
        onClick={() => canOpen && onOpen(item)}
        disabled={!canOpen}
        className={`block w-full text-left transition ${canOpen ? 'active:scale-[0.99] cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${item.meta.bg} ${item.meta.accent}`}>
                {item.meta.badge}
              </span>
              <span className="text-[11px] font-bold text-slate-500">{formatDateOnly(item.date)}</span>
            </div>
            <p className="mt-2 break-keep text-base font-black leading-tight text-white">
              {item.summary.title || item.meta.title}
            </p>
            <p className="mt-1 break-keep text-[12px] font-semibold leading-tight text-slate-500">
              {item.meta.title}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`font-mono text-3xl font-black leading-none ${statusStyle.text}`}>
              {item.summary.overallScore ?? 0}
            </p>
            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusStyle.bg} ${statusStyle.border} ${statusStyle.text}`}>
              {item.summary.statusLabel || '확인 필요'}
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {findings.length > 0 ? findings.map((finding, idx) => (
            <p key={`${item.id}-finding-${idx}`} className="line-clamp-2 break-keep rounded-lg bg-slate-100/65 dark:bg-slate-800/65 px-3 py-2 text-[12px] font-semibold leading-relaxed text-slate-600 dark:text-slate-300">
              {finding.text}
            </p>
          )) : (
            <p className="rounded-lg bg-slate-100/65 dark:bg-slate-800/65 px-3 py-2 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
              핵심 결과를 정리 중입니다.
            </p>
          )}
        </div>
      </button>

      {/* 카카오톡 공유: 리포트 화면이 있으면 이미지 파일 공유, 없으면 요약 공유 */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onShare?.(item); }}
        disabled={sharing}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#FEE500] py-2.5 text-[13px] font-black text-[#191600] transition active:scale-[0.99] disabled:opacity-60"
      >
        {sharing ? '리포트 생성 중…' : '카카오톡으로 리포트 공유'}
      </button>
    </div>
  );
}

export default function Report() {
  const { user } = useAuth();
  // 트레이너 모드: 담당 회원만 / 모든 회원은 가나다 순으로 노출.
  const members = useMemo(() => sortByName(scopeMembersToTrainer(store.getMembers(), user)), [user]);
  const [memberId, setMemberId] = useState('');
  const [showCombined, setShowCombined] = useState(false); // 종합 분석 패널 표시 여부(신규, 기존 상태와 독립)
  // [리포트 통합 2026-08-09] AI측정 저장 화면의 "결과리포트에서 보기" 버튼으로
  // 도착했으면, 회원 선택 후 해당 종류의 저장된 리포트(방금 저장한 게 항상
  // 최신=0번 인덱스) 뷰어를 자동으로 연다. savedPostureReports 등은 member+
  // dataReady가 로딩된 뒤에야 채워지는 비동기 값이라, "무엇을 열어야 하는지"만
  // 여기 담아두고 실제로 여는 건 아래 데이터가 준비된 시점의 별도 effect가 한다.
  const [pendingOpenKind, setPendingOpenKind] = useState(null);

  // [모미 신규] "모미야 OO님 리포트 열어줘" 같은 음성 명령으로 도착했으면 회원을 자동 선택한다.
  useEffect(() => {
    const pending = consumePendingVoiceTarget();
    if (pending?.memberName) {
      const matched = members.find((m) => m.name === pending.memberName);
      if (matched) setMemberId(matched.id);
    }
    if (pending?.openReportKind) setPendingOpenKind(pending.openReportKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [msg, setMsg] = useState(null);
  const [sharingId, setSharingId] = useState(null);
  const [shareCaptureItem, setShareCaptureItem] = useState(null);
  const shareCaptureRef = useRef(null);

  const member = members.find(m => m.id === memberId);

  // [읽기 절감] 선택된 회원의 측정 데이터(ai · gait_reports)만 지연 로딩.
  // 로딩 완료 후 dataReady 가 바뀌면 아래 useMemo 들이 재계산된다.
  const [dataReady, setDataReady] = useState(0);
  useEffect(() => {
    if (!member) return;
    let alive = true;
    (async () => {
      await Promise.all([
        aiStore.ensureSessions(member.id),
        aiStore.ensureGaitReports(member.id),
        aiStore.ensurePostureReports(member.id),
        aiStore.ensureRomReports(member.id),
      ]);
      if (alive) setDataReady(v => v + 1);
    })();
    return () => { alive = false; };
  }, [member?.id]);

  const [deletingKey, setDeletingKey] = useState(null); // 삭제 진행 중인 항목(중복 클릭 방지 + 로딩 표시)

  // 회차 하나 삭제 — 세션과 연결된 전용 리포트(있으면)를 함께 지운다.
  const handleDeleteRound = async (session, linkedReport, label) => {
    if (!member || deletingKey) return;
    if (!window.confirm(`${label} 1건을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    setDeletingKey(`round:${session.id}`);
    try {
      await deleteMeasureRound(member.id, session, linkedReport);
      setDataReady(v => v + 1);
      setMsg('삭제되었습니다.');
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      alert('삭제에 실패했습니다.\n' + (e?.message || ''));
    } finally {
      setDeletingKey(null);
    }
  };

  // 유형 전체 삭제 — 같은 groupKey의 모든 세션 + 연결된 전용 리포트를 한 번에 지운다.
  const handleDeleteType = async (groupKey, sessions, findLinked, label, count) => {
    if (!member || deletingKey) return;
    if (!window.confirm(`"${label}" 전체 ${count}건을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    setDeletingKey(`type:${groupKey}`);
    try {
      const linkedReports = sessions.map(findLinked).filter(Boolean);
      await deleteMeasureType(member.id, sessions, linkedReports);
      setDataReady(v => v + 1);
      setMsg('삭제되었습니다.');
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      alert('삭제에 실패했습니다.\n' + (e?.message || ''));
    } finally {
      setDeletingKey(null);
    }
  };

  const report = useMemo(() => {
    if (!member) return null;
    return buildFullReport({
      member,
      bodyRecords: store.getBodyRecords(member.id),
      aiSessions:  aiStore.getSessions(member.id),
    });
  }, [member, dataReady]);

  // 보행/점프 분석 회차별 추세 (gait_reports)
  const trend = useMemo(() => {
    if (!member) return null;
    return buildAnalysisTrend(aiStore.getGaitReports(member.id));
  }, [member, dataReady]);

  // 자세·체형 측정 이력 추세 (posture_reports)
  const postureTrend = useMemo(() => {
    if (!member) return null;
    return buildPostureTrend(aiStore.getPostureReports(member.id));
  }, [member, dataReady]);

  // 저장된 자세 리포트 목록 (최신순)
  const savedPostureReports = useMemo(() => {
    if (!member) return [];
    return [...(aiStore.getPostureReports(member.id) || [])]
      .sort((a, b) => String(b.createdAt || b.measuredAt).localeCompare(String(a.createdAt || a.measuredAt)));
  }, [member, dataReady]);

  const savedRomReports = useMemo(() => {
    if (!member) return [];
    return [...(aiStore.getRomReports(member.id) || [])]
      .sort((a, b) => String(b.createdAt || b.measuredAt || b.basic_info?.createdAt).localeCompare(String(a.createdAt || a.measuredAt || a.basic_info?.createdAt)));
  }, [member, dataReady]);

  // 저장된 AI 측정 리포트 목록 (최신순) — 페이지별 열람용
  const savedReports = useMemo(() => {
    if (!member) return [];
    return [...(aiStore.getGaitReports(member.id) || [])]
      .sort((a, b) => String(b.createdAt || b.measuredAt).localeCompare(String(a.createdAt || a.measuredAt)));
  }, [member, dataReady]);

  // 바벨 리프팅은 전용 저장 컬렉션이 없어(세션에만 기록) 세션에서 직접 골라 쓴다.
  const savedLiftingSessions = useMemo(() => {
    if (!member) return [];
    return (aiStore.getSessions(member.id) || [])
      .filter((s) => s.menu === 'lifting')
      .sort((a, b) => String(b.recordedAtFull || b.recordedAt).localeCompare(String(a.recordedAtFull || a.recordedAt)));
  }, [member, dataReady]);

  // [리포트 통합 2026-08-09] SLST도 바벨 리프팅과 같은 방식(전용 컬렉션 없이
  // 세션에만 menu:'stance'로 저장)이라 완전히 같은 패턴으로 목록을 만든다.
  const savedStanceSessions = useMemo(() => {
    if (!member) return [];
    return (aiStore.getSessions(member.id) || [])
      .filter((s) => s.menu === 'stance')
      .sort((a, b) => String(b.recordedAtFull || b.recordedAt).localeCompare(String(a.recordedAtFull || a.recordedAt)));
  }, [member, dataReady]);

  // [리포트 통합 2026-08-09] 스쿼트도 SLST와 완전히 같은 패턴(전용 컬렉션 없이
  // 세션에만 menu:'squat'로 저장).
  const savedSquatSessions = useMemo(() => {
    if (!member) return [];
    return (aiStore.getSessions(member.id) || [])
      .filter((s) => s.menu === 'squat')
      .sort((a, b) => String(b.recordedAtFull || b.recordedAt).localeCompare(String(a.recordedAtFull || a.recordedAt)));
  }, [member, dataReady]);

  const [viewerIdx, setViewerIdx] = useState(null); // 열람 중인 리포트 인덱스
  const [postureViewerIdx, setPostureViewerIdx] = useState(null); // 자세 리포트 열람 인덱스
  const [liftingViewerIdx, setLiftingViewerIdx] = useState(null); // 바벨 리프팅 리포트 열람 인덱스
  const [romViewerIdx, setRomViewerIdx] = useState(null); // ROM 리포트 열람 인덱스
  const [stanceViewerIdx, setStanceViewerIdx] = useState(null); // SLST 리포트 열람 인덱스
  const [squatViewerIdx, setSquatViewerIdx] = useState(null); // 오버헤드 딥 스쿼트 리포트 열람 인덱스
  const [expandedMenu, setExpandedMenu] = useState(null); // 펼친 측정 메뉴

  // [리포트 통합 2026-08-09] pendingOpenKind가 있고 해당 종류의 저장된 리포트
  // 목록이 준비되면(비동기 로딩 완료) 최신(0번) 항목의 뷰어를 자동으로 연다.
  // 한 번 처리하면 pendingOpenKind를 비워 다시 실행되지 않게 한다(예: 트레이너가
  // 나중에 회원을 바꿔도 예전 요청이 재실행되지 않도록).
  //  [확장 지점] 다른 측정 종류(rom/gait/jump/lifting/stance/squat)도 같은 방식
  //  으로 이어붙이면 된다 — posture가 먼저 검증된 패턴.
  useEffect(() => {
    if (pendingOpenKind !== 'posture') return;
    if (savedPostureReports.length === 0) return; // 아직 로딩 중일 수 있음 — 다음 렌더에 재시도
    setPostureViewerIdx(0);
    setPendingOpenKind(null);
  }, [pendingOpenKind, savedPostureReports]);

  useEffect(() => {
    if (pendingOpenKind !== 'rom') return;
    if (savedRomReports.length === 0) return;
    setRomViewerIdx(0);
    setPendingOpenKind(null);
  }, [pendingOpenKind, savedRomReports]);

  // [리포트 통합 2026-08-09] gait/jump는 같은 목록(savedReports)을 공유하고
  // kind 필드로만 구분되므로(최신순 정렬), "그 종류 중 가장 최신" 인덱스를
  // 찾아야 한다 — 단순히 0번이 아닐 수 있다(예: 방금 gait를 저장했어도 그
  // 직전에 jump를 저장했으면 jump가 0번일 수 있음. 물론 방금 막 저장한
  // 직후라면 사실상 항상 0번이지만, 안전하게 kind로 찾는다).
  useEffect(() => {
    if (pendingOpenKind !== 'gait') return;
    const idx = savedReports.findIndex((r) => r.kind !== 'jump');
    if (idx === -1) return;
    setViewerIdx(idx);
    setPendingOpenKind(null);
  }, [pendingOpenKind, savedReports]);

  useEffect(() => {
    if (pendingOpenKind !== 'jump') return;
    const idx = savedReports.findIndex((r) => r.kind === 'jump');
    if (idx === -1) return;
    setViewerIdx(idx);
    setPendingOpenKind(null);
  }, [pendingOpenKind, savedReports]);

  useEffect(() => {
    if (pendingOpenKind !== 'lifting') return;
    if (savedLiftingSessions.length === 0) return;
    setLiftingViewerIdx(0);
    setPendingOpenKind(null);
  }, [pendingOpenKind, savedLiftingSessions]);

  useEffect(() => {
    if (pendingOpenKind !== 'stance') return;
    if (savedStanceSessions.length === 0) return;
    setStanceViewerIdx(0);
    setPendingOpenKind(null);
  }, [pendingOpenKind, savedStanceSessions]);

  useEffect(() => {
    if (pendingOpenKind !== 'squat') return;
    if (savedSquatSessions.length === 0) return;
    setSquatViewerIdx(0);
    setPendingOpenKind(null);
  }, [pendingOpenKind, savedSquatSessions]);

  // 메뉴별 개별 세션 목록 (상세/회차비교용)
  const sessionsByMenu = useMemo(() => {
    if (!member) return {};
    const all = aiStore.getSessions(member.id) || [];
    const map = {};
    for (const s of all) {
      const k = menuGroupKey(s);
      (map[k] = map[k] || []).push(s);
    }
    // 날짜 오름차순 (회차 비교는 시간순)
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => String(a.recordedAt || a.recordedAtFull).localeCompare(String(b.recordedAt || b.recordedAtFull)));
    }
    return map;
  }, [member, dataReady]);

  const unifiedResults = useMemo(() => {
    if (!member) return [];
    return buildUnifiedResults({
      member,
      savedReports,
      savedPostureReports,
      savedRomReports,
      savedLiftingSessions,
      sessions: aiStore.getSessions(member.id) || [],
    });
  }, [member, dataReady, savedReports, savedPostureReports, savedRomReports, savedLiftingSessions]);

  // 신체정보 원본 기록 (측정 캘린더 그룹핑 + 상단 "최근 측정" 표시에 함께 사용)
  const bodyRecords = useMemo(() => {
    if (!member) return [];
    return store.getBodyRecords(member.id) || [];
  }, [member, dataReady]);

  const latestBodyDate = useMemo(() => {
    if (!bodyRecords.length) return null;
    return [...bodyRecords].sort((a, b) => String(b?.recordedAt || '').localeCompare(String(a?.recordedAt || '')))[0]?.recordedAt || null;
  }, [bodyRecords]);

  // 날짜별 그룹 (측정 캘린더). "전체 결과"를 한 줄로 늘어놓는 대신 언제 측정했는지로 정리한다.
  const dailyGroups = useMemo(() => groupResultsByDate(unifiedResults, bodyRecords), [unifiedResults, bodyRecords]);
  const dailyMap = useMemo(() => Object.fromEntries(dailyGroups.map(g => [g.date, g])), [dailyGroups]);

  const [calendarPivot, setCalendarPivot] = useState(todayYMD().slice(0, 7)); // 'YYYY-MM'
  const [selectedDate, setSelectedDate] = useState(null);

  // 회원 전환/데이터 로딩 완료 시: 캘린더는 가장 최근 측정 달로, 선택 날짜는 가장 최근 측정일로.
  useEffect(() => {
    setCalendarPivot(dailyGroups[0]?.date.slice(0, 7) || todayYMD().slice(0, 7));
  }, [member?.id, dataReady]);

  useEffect(() => {
    if (!dailyGroups.length) { setSelectedDate(null); return; }
    setSelectedDate(prev => (prev && dailyGroups.some(g => g.date === prev)) ? prev : dailyGroups[0].date);
  }, [dailyGroups]);

  const selectedGroup = useMemo(
    () => dailyGroups.find(g => g.date === selectedDate) || null,
    [dailyGroups, selectedDate]
  );

  // 측정별 분석·평가 판독 설명서 — 이 회원이 실제로 측정한 유형만 대상으로 한다.
  const interpretationGuide = useMemo(() => {
    const types = new Set(unifiedResults.map(r => r.reportType).filter(Boolean));
    if (report?.body?.summary?.length > 0) types.add('body');
    return buildInterpretationGuide([...types]);
  }, [unifiedResults, report]);

  // 섹션 바로가기 — 실제로 렌더링되는 섹션만 대상으로 한다(측정 정직성 — 빈 섹션으로
  // 이동하는 버튼을 보여주지 않는다). 각 조건은 해당 섹션의 렌더 조건과 정확히 맞춘다.
  const sectionNavItems = useMemo(() => {
    const items = [];
    if (report?.body?.summary?.length > 0) items.push({ id: 'section-body', label: '신체정보' });
    if (dailyGroups.length > 0) items.push({ id: 'section-calendar', label: '캘린더' });
    if (report?.hasData && report?.ai?.menuSummaries?.length > 0) items.push({ id: 'section-history', label: 'AI측정이력' });
    items.push({ id: 'section-comprehensive', label: '종합리포트' });
    if (interpretationGuide.length > 0) items.push({ id: 'section-guide', label: '판독설명서' });
    return items;
  }, [report, dailyGroups, interpretationGuide]);

  const openUnifiedResult = (item) => {
    if (item.source === 'posture') {
      setPostureViewerIdx(item.index);
      return;
    }
    if (item.source === 'rom') {
      setRomViewerIdx(item.index);
      return;
    }
    if (item.source === 'lifting') {
      setLiftingViewerIdx(item.index);
      return;
    }
    if (item.source === 'saved-report') {
      setViewerIdx(item.index);
      return;
    }
    if (item.session?.menu) {
      setExpandedMenu(menuGroupKey(item.session));
      setMsg('아래 AI 측정 이력에서 해당 결과를 확인할 수 있습니다.');
      setTimeout(() => setMsg(null), 1800);
    }
  };

  const captureUnifiedResultFiles = async (item) => {
    if (!canCaptureUnifiedResult(item)) return [];
    await preloadReportChunk(item);
    setShareCaptureItem(item);
    try {
      await nextFrame();
      const root = await waitForShareCapture(shareCaptureRef);
      if (!root) return [];
      await waitForImages(root);
      await sleep(80);

      const pages = Array.from(root.querySelectorAll(REPORT_CAPTURE_PAGE_SELECTOR));
      const targets = pages.length ? pages : [root];
      const baseName = buildShareFileBaseName(item, member);
      const files = [];

      for (let i = 0; i < targets.length; i += 1) {
        const suffix = targets.length > 1 ? `_A4_${i + 1}` : '_A4';
        files.push(await captureNodeToJpgFile(targets[i], `${baseName}${suffix}.jpg`, { bg: '#0f172a', width: 794 }));
      }

      return files;
    } finally {
      setShareCaptureItem(null);
    }
  };

  const shareUnifiedResult = async (item) => {
    if (!item || sharingId) return;
    setSharingId(item.id); setMsg(null);
    try {
      if (canCaptureUnifiedResult(item)) {
        try {
          setMsg('리포트 이미지를 만드는 중입니다...');
          const files = await captureUnifiedResultFiles(item);
          if (files.length) {
            const res = await shareReportFilesOrDownload(files, {
              title: `${member?.name || '회원'} 결과 리포트`,
              text: '몸가짐운동센터 측정 결과 리포트입니다.',
            });
            setMsg(res.msg);
            return;
          }
        } catch (captureError) {
          console.warn('[Report] result image share fallback:', captureError);
        }
      }

      const res = await shareMeasurementSummaryToKakao(item.summary, {
        memberName: member?.name || '',
        reportType: item.reportType,
        title: `몸가짐CMS 측정 결과 요약 · ${member?.name || ''}`.trim(),
      });
      setMsg(res.msg);
    } catch (e) {
      setMsg(`카카오 공유 실패: ${e?.message || '오류'}`);
    } finally {
      setSharingId(null);
      setTimeout(() => setMsg(null), 2600);
    }
  };

  return (
    <div className="space-y-5 max-w-md mx-auto">
      <div>
        <h1 className="text-2xl font-black tracking-tight">측정 리포트</h1>
        <p className="text-slate-500 text-sm mt-1">실제 측정된 데이터만 리포트로 출력됩니다.</p>
      </div>

      {/* 회원 선택 (다른 탭과 동일한 검색형 선택기) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">회원 찾기</label>
        <MemberPicker members={members} value={memberId} onChange={setMemberId}
          allowNone={false} placeholder="이름 / 초성 / 전화 뒤4자리" />
      </div>

      {/* 측정 종합 분석 — 여러 측정 종류를 골라 하나로 묶어 보는 진입점(신규, 독립 컴포넌트) */}
      {member && (
        <div>
          {!showCombined ? (
            <button
              onClick={() => setShowCombined(true)}
              className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm py-2.5"
            >
              📊 측정 종합 분석 보기
            </button>
          ) : (
            <CombinedAssessmentPanel member={member} onClose={() => setShowCombined(false)} />
          )}
        </div>
      )}

      {/* 섹션 바로가기 — 페이지가 길어서(신체정보~판독설명서) 존재하는 섹션만 골라 보여준다. */}
      {member && sectionNavItems.length > 1 && (
        <div className="sticky top-1 z-20 -mx-1 flex gap-1.5 overflow-x-auto rounded-full border border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/95 px-2 py-1.5 backdrop-blur">
          {sectionNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-800 active:text-white"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* 신체정보 · 최근 측정 (맨 위 고정) — 과거 회차는 아래 추이 그래프로 확인 */}
      {member && report?.body?.summary?.length > 0 && (
        <div id="section-body" className="scroll-mt-14">
          <div className="mb-2 flex items-end justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">신체정보 · 최근 측정</p>
            {latestBodyDate && <span className="text-[11px] text-slate-500">{formatDateOnly(latestBodyDate)}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {report.body.summary.map(s => (
              <div key={s.key} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">{s.label}</p>
                <p className="font-mono font-black text-lg text-slate-800 dark:text-slate-100">
                  {s.latest}<span className="text-slate-500 text-[10px] font-normal"> {s.unit}</span>
                </p>
                {s.change != null && (
                  <p className={`text-[11px] font-bold ${s.change > 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    {s.change > 0 ? '▲' : '▼'} {Math.abs(s.change)}{s.unit} (최초 대비)
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* 나머지 회차는 그래프로 — 신체정보는 "최근 1건" 외엔 목록으로 늘어놓지 않는다 */}
          {report.body.fields.filter(f => report.body.series[f.key]?.length > 1).length > 0 && (
            <div className="mt-3 space-y-3">
              {report.body.fields
                .filter(f => report.body.series[f.key]?.length > 1)
                .map(f => (
                  <TrendChart key={f.key} title={f.label} unit={f.unit}
                    points={report.body.series[f.key]}
                    color={COLORS[f.key] || '#f59e0b'} width={320} height={150} />
                ))}
            </div>
          )}
        </div>
      )}

      {/* 측정 캘린더 — "전체 결과"를 일렬로 늘어놓는 대신 언제 측정했는지로 정리한다 */}
      {member && dailyGroups.length > 0 && (
        <section id="section-calendar" className="scroll-mt-14 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 p-3">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">측정 캘린더</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">날짜를 선택하면 그날 측정 결과를 볼 수 있습니다.</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-black text-slate-600 dark:text-slate-300">
              {unifiedResults.length}건
            </span>
          </div>

          <MeasureCalendar
            pivot={calendarPivot}
            onPivotChange={setCalendarPivot}
            dailyMap={dailyMap}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            todayStr={todayYMD()}
          />

          {selectedGroup && (
            <div className="mt-3">
              <div className="mb-2 flex items-end justify-between gap-3 px-1">
                <div>
                  <p className="text-sm font-black text-white">{formatDateOnly(selectedGroup.date)}</p>
                  {selectedGroup.avgScore != null && (
                    <p className="text-[12px] font-semibold text-slate-500">
                      이날 평균 <span className={`font-black ${scoreTone(selectedGroup.avgScore)}`}>{selectedGroup.avgScore}점</span>
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-black text-slate-600 dark:text-slate-300">
                  {selectedGroup.count}건
                </span>
              </div>

              {selectedGroup.bodyEntry && (
                <div className="mb-2 flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5">
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">신체정보 기록</p>
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {selectedGroup.bodyEntry.weight != null && `${selectedGroup.bodyEntry.weight}kg`}
                    {selectedGroup.bodyEntry.systolic != null && ` · ${selectedGroup.bodyEntry.systolic}/${selectedGroup.bodyEntry.diastolic}`}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {selectedGroup.items.length > 0 ? selectedGroup.items.map((item) => (
                  <UnifiedResultCard key={item.id} item={item} onOpen={openUnifiedResult} onShare={shareUnifiedResult} sharing={sharingId === item.id} />
                )) : (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center text-sm font-semibold text-slate-500">
                    이날은 신체정보 기록만 있습니다.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {report && !report.hasData && unifiedResults.length === 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">
          측정된 데이터가 없습니다.<br />신체정보나 AI 측정을 먼저 기록하세요.
        </div>
      )}

      {report && report.hasData && (
        <>
          {/* AI 측정 이력 (자세·1RM·RSI·VBT·점프 등) — 탭하면 상세 + 회차비교 */}
          {report.ai.menuSummaries?.length > 0 && (
            <div id="section-history" className="scroll-mt-14">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">AI 측정 이력 · 탭하여 상세</p>
              <div className="space-y-2">
                {report.ai.menuSummaries.map((m, i) => {
                  const open = expandedMenu === m.groupKey;
                  const sessions = sessionsByMenu[m.groupKey] || [];
                  const rows = sessions.map(s => ({ s, ...extractSessionMetric(s) }));
                  const numeric = rows.filter(r => typeof r.value === 'number' && !Number.isNaN(r.value));
                  const points = numeric.map(r => ({ date: String(r.s.recordedAt || '').slice(0, 10), value: r.value }));
                  const unit = numeric[0]?.unit || '';
                  const first = numeric[0]?.value, last = numeric.at(-1)?.value;
                  const delta = (first != null && last != null) ? Math.round((last - first) * 10) / 10 : null;
                  return (
                    <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                      <button onClick={() => setExpandedMenu(open ? null : m.groupKey)}
                        className="w-full px-3 py-2.5 flex items-center justify-between text-left active:bg-slate-100/50 dark:active:bg-slate-800/50">
                        <div>
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{m.title}</p>
                          <p className="text-[11px] text-slate-500">{m.metric}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{m.count}회</p>
                            <p className="text-[10px] text-slate-600">{m.latestDate}</p>
                          </div>
                          <span className={`text-amber-700 dark:text-amber-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                        </div>
                      </button>

                      {open && (() => {
                        // 점프·보행·자세는 여러 지표를 함께 추세로 보여준다(구 점프추세/보행추세/자세체형추세 섹션 흡수).
                        // 그 외 메뉴는 기존처럼 핵심 지표 1개만 추세로 보여준다.
                        const extraCharts = extraMenuTrendCharts(m.menu, trend, postureTrend);
                        return (
                          <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-3">
                            {/* 회차별 비교 차트 */}
                            {extraCharts.length > 0 ? (
                              <div>
                                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">회차별 비교</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {extraCharts.map(c => (
                                    <TrendChart key={c.key} title={c.title} unit={c.unit} points={c.points} color={c.color} width={320} height={140} />
                                  ))}
                                </div>
                              </div>
                            ) : points.length > 1 ? (
                              <div>
                                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">회차별 비교 {delta != null && (
                                  <span className={delta === 0 ? 'text-slate-500' : delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                                    (최초 대비 {delta > 0 ? '▲' : delta < 0 ? '▼' : '–'}{Math.abs(delta)}{unit})
                                  </span>
                                )}</p>
                                <TrendChart title={m.title} unit={unit} points={points} color="#fbbf24" width={320} height={140} />
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500">회차 비교는 2회차부터 표시됩니다.</p>
                            )}

                            {/* 회차별 상세 목록 (최신순) */}
                            <div className="space-y-1.5">
                              {[...rows].reverse().map((r, j) => {
                                const gIdx = (m.menu === 'jump' || m.menu === 'gait')
                                  ? findLinkedReportIndex(r.s, savedReports) : -1;
                                const pIdx = m.menu === 'posture'
                                  ? findLinkedReportIndex(r.s, savedPostureReports) : -1;
                                const romIdx = m.menu === 'rom'
                                  ? findLinkedReportIndex(r.s, savedRomReports) : -1;
                                // 바벨 리프팅은 전용 컬렉션이 없어 세션 자체를 재사용하므로 id로 직접 매칭한다
                                // (measuredAt 문자열 비교보다 정확 — 같은 세션 목록에서 그대로 찾는 것이므로).
                                const liftIdx = m.menu === 'lifting' && r.s?.id
                                  ? savedLiftingSessions.findIndex(sr => sr.id === r.s.id) : -1;
                                const openable = gIdx >= 0 || pIdx >= 0 || romIdx >= 0 || liftIdx >= 0;
                                const openDetail = () => {
                                  if (gIdx >= 0) setViewerIdx(gIdx);
                                  else if (pIdx >= 0) setPostureViewerIdx(pIdx);
                                  else if (liftIdx >= 0) setLiftingViewerIdx(liftIdx);
                                  else if (romIdx >= 0) setRomViewerIdx(romIdx);
                                };
                                const linkedReport = gIdx >= 0 ? { source: 'gait_reports', id: savedReports[gIdx].id }
                                  : pIdx >= 0 ? { source: 'posture_reports', id: savedPostureReports[pIdx].id }
                                  : romIdx >= 0 ? { source: 'rom_reports', id: savedRomReports[romIdx].id }
                                  : null;
                                const deleting = deletingKey === `round:${r.s.id}`;
                                return (
                                  <div key={j} className="flex items-center justify-between bg-slate-100/60 dark:bg-slate-800/60 rounded-lg px-3 py-2">
                                    <div>
                                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                        {r.value != null ? `${r.value}${r.unit}` : '—'} <span className="text-slate-500 font-normal">{r.label}</span>
                                      </p>
                                      <p className="text-[10px] text-slate-500">{String(r.s.recordedAt || '').slice(0, 10)}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                      {openable && (
                                        <button onClick={openDetail} className="text-amber-700 dark:text-amber-400 text-[11px] font-bold">리포트 →</button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteRound(r.s, linkedReport, m.title)}
                                        disabled={deleting}
                                        aria-label="이 회차 삭제"
                                        className="text-slate-600 text-[13px] active:text-red-700 dark:active:text-red-400 disabled:opacity-40"
                                      >
                                        {deleting ? '···' : '🗑'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* 유형 전체 삭제 */}
                            <button
                              type="button"
                              onClick={() => handleDeleteType(m.groupKey, sessions, (s) => {
                                const idx = findLinkedReportIndex(s, m.menu === 'posture' ? savedPostureReports : m.menu === 'rom' ? savedRomReports : (m.menu === 'jump' || m.menu === 'gait') ? savedReports : []);
                                if (idx < 0) return null;
                                const src = m.menu === 'posture' ? 'posture_reports' : m.menu === 'rom' ? 'rom_reports' : 'gait_reports';
                                const list = m.menu === 'posture' ? savedPostureReports : m.menu === 'rom' ? savedRomReports : savedReports;
                                return { source: src, id: list[idx].id };
                              }, m.title, m.count)}
                              disabled={deletingKey === `type:${m.groupKey}`}
                              className="w-full rounded-lg border border-red-500/20 bg-red-500/5 py-2 text-[11px] font-bold text-red-700 dark:text-red-400/80 active:bg-red-500/10 disabled:opacity-40"
                            >
                              {deletingKey === `type:${m.groupKey}` ? '삭제 중…' : `🗑 "${m.title}" 전체 ${m.count}건 삭제`}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 일간·주간·월간 종합 리포트 */}
          <ComprehensiveReportSection
            member={member}
            dataReady={dataReady}
            onRecordsChanged={() => setDataReady((v) => v + 1)}
          />

          <InterpretationGuideSection guide={interpretationGuide} />

          {msg && <p className="text-center text-xs text-slate-500 dark:text-slate-400">{msg}</p>}
        </>
      )}

      {shareCaptureItem && (
        <div
          aria-hidden="true"
          className="fixed top-0 w-[860px] max-w-none overflow-visible bg-slate-50 dark:bg-slate-950 pointer-events-none"
          style={{ left: '-10000px' }}
        >
          <div ref={shareCaptureRef} className="w-[860px] bg-slate-50 dark:bg-slate-950">
            <Suspense fallback={<div className="min-h-[1123px] w-[794px] bg-white dark:bg-slate-900" />}>
              <ShareCaptureReport item={shareCaptureItem} member={member} />
            </Suspense>
          </div>
        </div>
      )}

      {/* 페이지별 리포트 뷰어 (이전/다음으로 회차 넘김) */}
      {viewerIdx != null && savedReports[viewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setViewerIdx(null)} className="text-slate-600 dark:text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{viewerIdx + 1} / {savedReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setViewerIdx(i => Math.min(savedReports.length - 1, i + 1))}
                disabled={viewerIdx >= savedReports.length - 1}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setViewerIdx(i => Math.max(0, i - 1))}
                disabled={viewerIdx <= 0}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-500 dark:text-slate-400">불러오는 중…</div>}>
            {savedReports[viewerIdx].kind === 'jump'
              ? <JumpReportDashboard report={savedReports[viewerIdx]} onClose={() => setViewerIdx(null)} member={member} />
              : <GaitReportDashboard report={savedReports[viewerIdx]} onClose={() => setViewerIdx(null)} member={member} />}
          </Suspense>
        </div>
      )}
      {romViewerIdx != null && savedRomReports[romViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setRomViewerIdx(null)} className="text-slate-600 dark:text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{romViewerIdx + 1} / {savedRomReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setRomViewerIdx(i => Math.min(savedRomReports.length - 1, i + 1))}
                disabled={romViewerIdx >= savedRomReports.length - 1}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setRomViewerIdx(i => Math.max(0, i - 1))}
                disabled={romViewerIdx <= 0}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-500 dark:text-slate-400">불러오는 중…</div>}>
            <RomReport report={savedRomReports[romViewerIdx]} member={member} />
          </Suspense>
          <div className="mx-auto w-full max-w-[794px] p-4 pt-0">
            <ReportActions reportNodeId="rom-report-sheet" baseName={`${member?.name || '회원'}_ROM`} />
          </div>
        </div>
      )}
      {postureViewerIdx != null && savedPostureReports[postureViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setPostureViewerIdx(null)} className="text-slate-600 dark:text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{postureViewerIdx + 1} / {savedPostureReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setPostureViewerIdx(i => Math.min(savedPostureReports.length - 1, i + 1))}
                disabled={postureViewerIdx >= savedPostureReports.length - 1}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setPostureViewerIdx(i => Math.max(0, i - 1))}
                disabled={postureViewerIdx <= 0}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-500 dark:text-slate-400">불러오는 중…</div>}>
            <PostureReport
              report={savedPostureReports[postureViewerIdx]}
              member={member}
              heightCm={savedPostureReports[postureViewerIdx]?.heightCm}
              actualAge={savedPostureReports[postureViewerIdx]?.actualAge}
              onClose={() => setPostureViewerIdx(null)}
            />
          </Suspense>
          <div className="mx-auto w-full max-w-[794px] p-4 pt-0">
            <ReportActions reportNodeId="posture-report-sheet" baseName={`${member?.name || '회원'}_자세`} />
          </div>
        </div>
      )}
      {liftingViewerIdx != null && savedLiftingSessions[liftingViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setLiftingViewerIdx(null)} className="text-slate-600 dark:text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{liftingViewerIdx + 1} / {savedLiftingSessions.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setLiftingViewerIdx(i => Math.min(savedLiftingSessions.length - 1, i + 1))}
                disabled={liftingViewerIdx >= savedLiftingSessions.length - 1}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setLiftingViewerIdx(i => Math.max(0, i - 1))}
                disabled={liftingViewerIdx <= 0}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-500 dark:text-slate-400">불러오는 중…</div>}>
            <LiftingReportDashboard
              report={savedLiftingSessions[liftingViewerIdx]?.data || {}}
              member={member}
              onClose={() => setLiftingViewerIdx(null)}
            />
          </Suspense>
        </div>
      )}
      {/* [리포트 통합 2026-08-09] SLST — 위 lifting과 완전히 같은 패턴(전용
          컬렉션 없이 세션에서 골라 씀). StanceReportDashboard가 onClose는 필수로
          받지만 onRemeasure는 옵션이라(측정 화면 전용) 여기선 안 넘긴다 — 저장된
          리포트를 다시 보는 중엔 "다시 측정" 버튼이 뜨지 않는다. */}
      {stanceViewerIdx != null && savedStanceSessions[stanceViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setStanceViewerIdx(null)} className="text-slate-600 dark:text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{stanceViewerIdx + 1} / {savedStanceSessions.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setStanceViewerIdx(i => Math.min(savedStanceSessions.length - 1, i + 1))}
                disabled={stanceViewerIdx >= savedStanceSessions.length - 1}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setStanceViewerIdx(i => Math.max(0, i - 1))}
                disabled={stanceViewerIdx <= 0}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-500 dark:text-slate-400">불러오는 중…</div>}>
            <StanceReportDashboard
              report={savedStanceSessions[stanceViewerIdx]?.data || {}}
              member={member}
              onClose={() => setStanceViewerIdx(null)}
            />
          </Suspense>
        </div>
      )}
      {/* [리포트 통합 2026-08-09] 스쿼트 — 위 SLST와 완전히 같은 패턴. */}
      {squatViewerIdx != null && savedSquatSessions[squatViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setSquatViewerIdx(null)} className="text-slate-600 dark:text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{squatViewerIdx + 1} / {savedSquatSessions.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setSquatViewerIdx(i => Math.min(savedSquatSessions.length - 1, i + 1))}
                disabled={squatViewerIdx >= savedSquatSessions.length - 1}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setSquatViewerIdx(i => Math.max(0, i - 1))}
                disabled={squatViewerIdx <= 0}
                className="text-slate-600 dark:text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-500 dark:text-slate-400">불러오는 중…</div>}>
            <SquatReportDashboard
              report={savedSquatSessions[squatViewerIdx]?.data || {}}
              member={member}
              onClose={() => setSquatViewerIdx(null)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
