// pages/Report.jsx
// 측정 리포트 페이지: 회원 선택 → 실측 데이터 그래프/요약 열람.
import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { todayYMD } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { scopeMembersToTrainer, sortByName } from '../utils/memberList';
import { store, aiStore } from '../demoData';
import { buildFullReport, buildAnalysisTrend, buildPostureTrend, groupResultsByDate, buildInterpretationGuide, GUIDE_STATUS_LEGEND, menuGroupKey } from '../services/reportService';
import { buildSummaryData, scoreToStatus, defaultRecommendation } from '../ai-measure/core/unifiedReport';
import { buildComprehensiveReport } from '../ai-measure/core/comprehensiveReport';
import { loadAllMeasureRecords } from '../services/comprehensiveReportService';
import { captureNodeToJpgFile, shareMeasurementSummaryToKakao } from '../ai-measure/core/reportShare';
import { canCaptureUnifiedResult, isLiftingShapedSession } from '../components/report/sessionShare';
import SessionShareReport from '../components/report/SessionShareReport';
import TrendChart from '../components/report/TrendChart';
import MemberPicker from '../components/common/MemberPicker';
const JumpReportDashboard = lazy(() => import('../ai-measure/menus/JumpReportDashboard'));
const GaitReportDashboard = lazy(() => import('../ai-measure/menus/GaitReportDashboard'));
const PostureReport = lazy(() => import('../ai-measure/menus/PostureReport'));
const RomReport = lazy(() => import('../ai-measure/menus/RomReport'));
const LiftingReportDashboard = lazy(() => import('../ai-measure/menus/LiftingReportDashboard'));

const COLORS = { weight:'#f59e0b', systolic:'#ef4444', diastolic:'#3b82f6', height:'#22d3ee' };
const DETAIL_SESSION_MENUS = new Set(['jump', 'gait', 'posture', 'rom', 'lifting']);

const REPORT_TYPE_META = {
  posture: { title: '자세·체형', badge: 'POSTURE', accent: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  rom: { title: '관절 가동범위', badge: 'ROM', accent: 'text-sky-300', bg: 'bg-sky-500/15', border: 'border-sky-500/25' },
  jump: { title: '점프·RSI', badge: 'JUMP', accent: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-500/25' },
  gait: { title: '보행·러닝', badge: 'GAIT', accent: 'text-cyan-300', bg: 'bg-cyan-500/15', border: 'border-cyan-500/25' },
  one_rm: { title: '최대 근력', badge: '1RM', accent: 'text-violet-300', bg: 'bg-violet-500/15', border: 'border-violet-500/25' },
  vbt: { title: '운동 속도 근력', badge: 'VBT', accent: 'text-fuchsia-300', bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-500/25' },
  general: { title: '측정 결과', badge: 'AI', accent: 'text-slate-300', bg: 'bg-slate-700', border: 'border-slate-700' },
};

const STATUS_STYLE = {
  normal: { text: 'text-emerald-300', bg: 'bg-emerald-500/12', border: 'border-emerald-500/30' },
  caution: { text: 'text-amber-300', bg: 'bg-amber-500/12', border: 'border-amber-500/30' },
  risk: { text: 'text-red-300', bg: 'bg-red-500/12', border: 'border-red-500/30' },
  unknown: { text: 'text-slate-400', bg: 'bg-slate-700/60', border: 'border-slate-700' },
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
    return { ...REPORT_TYPE_META.jump, title: 'RSI 반응 점프', badge: 'RSI', accent: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' };
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
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
        <button type="button" onClick={() => shiftMonth(-1)} className="px-2 py-1 text-sm font-bold text-slate-400 active:text-white">◀</button>
        <p className="text-sm font-black text-white">{y}년 {mo + 1}월</p>
        <button type="button" onClick={() => shiftMonth(1)} className="px-2 py-1 text-sm font-bold text-slate-400 active:text-white">▶</button>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-800 text-center text-[11px] font-bold text-slate-500">
        {WEEKDAYS.map(w => <div key={w} className="py-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-14 border-b border-r border-slate-800/70 opacity-20" />;
          const g = dailyMap[date];
          const isToday = date === todayStr;
          const isSelected = date === selectedDate;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              className={`min-h-14 border-b border-r border-slate-800/70 p-1 text-left transition-colors ${
                isSelected ? 'bg-amber-500/15' : isToday ? 'bg-amber-500/5' : 'hover:bg-slate-800/40'
              }`}
            >
              <p className={`font-mono text-[10px] font-bold ${isToday ? 'text-amber-400' : 'text-slate-400'}`}>
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
function ComprehensiveReportSection({ member, dataReady }) {
  const [unit, setUnit] = useState('week');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [periodKey, setPeriodKey] = useState(null);

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

  // 기간별 평균 점수 변화 그래프(8-3) — 과거→최근 순으로 정렬.
  const trendPoints = useMemo(() => (
    [...report.periods]
      .filter(p => p.stats.score)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(p => ({ date: p.key, value: p.stats.score.avg }))
  ), [report.periods]);

  if (!member) return null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">종합 리포트</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">일간·주간·월간 측정을 모아 종합 평가합니다.</p>
        </div>
      </div>

      <div className="mb-3 flex overflow-hidden rounded-xl border border-slate-700">
        {COMPREHENSIVE_UNITS.map((u) => (
          <button
            key={u.key}
            type="button"
            onClick={() => setUnit(u.key)}
            className={`flex-1 px-3 py-2 text-xs font-black transition-colors ${
              unit === u.key ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400'
            }`}
          >
            {u.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-500">불러오는 중…</div>
      ) : report.periods.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center text-sm font-semibold text-slate-500">
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
                    active ? 'border-amber-400 bg-amber-500 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-400'
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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-800 bg-slate-900 p-3">
                <p className="text-sm font-black text-white">{selected.label}</p>
                <p className="text-xs text-slate-400">측정 {selected.stats.total}회 · 유형 {selected.stats.typeCount}종</p>
                {selected.stats.score && (
                  <p className="text-xs text-slate-400">
                    기간 평균 <span className="font-mono font-black text-amber-400">{selected.stats.score.avg}</span>/100
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
                    <div key={ts.type} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-sm font-bold text-slate-200">{ts.typeLabel}</p>
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
                        <p className="font-mono text-xs text-slate-400">
                          평균 {ts.score.avg} · 최저 {ts.score.min} · 최고 {ts.score.max}
                          {ts.score.count >= 2 && (
                            <span className={`ml-2 font-bold ${ts.score.delta > 0 ? 'text-emerald-400' : ts.score.delta < 0 ? 'text-red-400' : 'text-slate-500'}`}>
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
    </section>
  );
}

const GUIDE_STATUS_TONE = { normal: 'text-emerald-400', caution: 'text-amber-400', risk: 'text-red-400' };

// 측정별 분석·평가 판독 설명서 — 회원에게 설명하고 트레이닝에 적용할 수 있도록
// 유형별로 접었다 펴는 아코디언. 실제 측정한 유형만 보여준다(측정 정직성 — 안 한 측정은 나열하지 않음).
function InterpretationGuideSection({ guide }) {
  const [openType, setOpenType] = useState(null);
  if (!guide.length) return null;

  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">측정별 분석·평가 판독 설명서</p>

      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
        {GUIDE_STATUS_LEGEND.map((s) => (
          <p key={s.key} className="text-[11px]">
            <span className={`font-black ${GUIDE_STATUS_TONE[s.key] || 'text-slate-400'}`}>{s.label}</span>
            <span className="text-slate-500"> · {s.meaning}</span>
          </p>
        ))}
      </div>

      <div className="space-y-2">
        {guide.map((g) => {
          const open = openType === g.type;
          return (
            <div key={g.type} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <button
                type="button"
                onClick={() => setOpenType(open ? null : g.type)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <p className="text-sm font-bold text-slate-200">{g.typeLabel}</p>
                <span className={`text-xs text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {open && (
                <div className="space-y-3 border-t border-slate-800 p-4">
                  <p className="text-xs leading-relaxed text-slate-300">{g.overview}</p>

                  {g.metrics.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold text-slate-500">핵심 지표</p>
                      {g.metrics.map((m) => (
                        <div key={m.key} className="rounded-lg bg-slate-800/60 px-3 py-2">
                          <p className="text-xs font-bold text-slate-200">{m.label}</p>
                          {m.description && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{m.description}</p>}
                          {m.hint && <p className="mt-0.5 text-[10px] text-slate-500">{m.hint}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  {g.trainingTip && (
                    <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
                      <p className="mb-0.5 text-[11px] font-bold text-amber-300">🏋️ 트레이닝 적용</p>
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
      <div data-share-report-ready="true" className="w-full bg-slate-950">
        {report.kind === 'jump'
          ? <JumpReportDashboard report={report} member={reportMember} />
          : <GaitReportDashboard report={report} member={reportMember} />}
      </div>
    );
  }

  if (item.source === 'posture') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-950">
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
      <div data-share-report-ready="true" className="w-full bg-slate-950">
        <RomReport report={{ ...report, member: report.member || reportMember }} />
      </div>
    );
  }

  if (item.source === 'lifting') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-950">
        <LiftingReportDashboard report={report} member={reportMember} />
      </div>
    );
  }

  // 세션(측정이력) 항목: 전용 리포트 화면이 없어도 A4 리포트로 그려 캡처한다.
  //  · 바벨 리프팅(역도/VBT/1RM) 페이로드는 전용 대시보드로 렌더(측정 직후와 동일 화면).
  //  · 그 외(신체정보·레거시 세션 등)는 통합 요약 기반 A4 리포트로 렌더.
  if (item.source === 'session') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-950">
        {isLiftingShapedSession(report)
          ? <LiftingReportDashboard report={report} member={reportMember} />
          : <SessionShareReport item={item} member={reportMember} />}
      </div>
    );
  }

  return null;
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
      return { value: m.meanVelocity, unit: 'm/s', label: d.mode === 'lifting' ? '역도 평균속도' : 'VBT 평균속도' };
    }
    case 'rsi':     return { value: d.rsi, unit: '', label: `RSI · 높이 ${d.heightCm ?? '-'}cm` };
    case 'vbt':     return { value: d.meanVelocity, unit: 'm/s', label: `평균속도 (${d.zone ?? ''})` };
    case 'jump': {
      if (isJumpRsi(d)) {
        return { value: d.rsi?.rsi ?? d.rsi, unit: '', label: `RSI 반응점프 · 높이 ${d.heightCm ?? '-'}cm` };
      }
      return { value: d.heightCm, unit: 'cm', label: `파워점프 · ${d.peakPower ? `${d.peakPower}W` : '파워 미입력'}` };
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
      className={`w-full rounded-2xl border bg-slate-900 p-4 ${item.meta.border}`}
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
            <p key={`${item.id}-finding-${idx}`} className="line-clamp-2 break-keep rounded-lg bg-slate-800/65 px-3 py-2 text-[12px] font-semibold leading-relaxed text-slate-300">
              {finding.text}
            </p>
          )) : (
            <p className="rounded-lg bg-slate-800/65 px-3 py-2 text-[12px] font-semibold text-slate-400">
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

  const [viewerIdx, setViewerIdx] = useState(null); // 열람 중인 리포트 인덱스
  const [postureViewerIdx, setPostureViewerIdx] = useState(null); // 자세 리포트 열람 인덱스
  const [liftingViewerIdx, setLiftingViewerIdx] = useState(null); // 바벨 리프팅 리포트 열람 인덱스
  const [romViewerIdx, setRomViewerIdx] = useState(null); // ROM 리포트 열람 인덱스
  const [expandedMenu, setExpandedMenu] = useState(null); // 펼친 측정 메뉴

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
        files.push(await captureNodeToJpgFile(targets[i], `${baseName}${suffix}.jpg`, { bg: '#0f172a' }));
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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">회원 찾기</label>
        <MemberPicker members={members} value={memberId} onChange={setMemberId}
          allowNone={false} placeholder="이름 / 초성 / 전화 뒤4자리" />
      </div>

      {/* 신체정보 · 최근 측정 (맨 위 고정) — 과거 회차는 아래 추이 그래프로 확인 */}
      {member && report?.body?.summary?.length > 0 && (
        <div>
          <div className="mb-2 flex items-end justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">신체정보 · 최근 측정</p>
            {latestBodyDate && <span className="text-[11px] text-slate-500">{formatDateOnly(latestBodyDate)}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {report.body.summary.map(s => (
              <div key={s.key} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">{s.label}</p>
                <p className="font-mono font-black text-lg text-slate-100">
                  {s.latest}<span className="text-slate-500 text-[10px] font-normal"> {s.unit}</span>
                </p>
                {s.change != null && (
                  <p className={`text-[11px] font-bold ${s.change > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
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
        <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">측정 캘린더</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">날짜를 선택하면 그날 측정 결과를 볼 수 있습니다.</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-black text-slate-300">
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
                <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-black text-slate-300">
                  {selectedGroup.count}건
                </span>
              </div>

              {selectedGroup.bodyEntry && (
                <div className="mb-2 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
                  <p className="text-xs font-bold text-slate-300">신체정보 기록</p>
                  <p className="font-mono text-xs text-slate-400">
                    {selectedGroup.bodyEntry.weight != null && `${selectedGroup.bodyEntry.weight}kg`}
                    {selectedGroup.bodyEntry.systolic != null && ` · ${selectedGroup.bodyEntry.systolic}/${selectedGroup.bodyEntry.diastolic}`}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {selectedGroup.items.length > 0 ? selectedGroup.items.map((item) => (
                  <UnifiedResultCard key={item.id} item={item} onOpen={openUnifiedResult} onShare={shareUnifiedResult} sharing={sharingId === item.id} />
                )) : (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center text-sm font-semibold text-slate-500">
                    이날은 신체정보 기록만 있습니다.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {report && !report.hasData && unifiedResults.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">
          측정된 데이터가 없습니다.<br />신체정보나 AI 측정을 먼저 기록하세요.
        </div>
      )}

      {report && report.hasData && (
        <>
          {/* AI 측정 이력 (자세·1RM·RSI·VBT·점프 등) — 탭하면 상세 + 회차비교 */}
          {report.ai.menuSummaries?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">AI 측정 이력 · 탭하여 상세</p>
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
                    <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                      <button onClick={() => setExpandedMenu(open ? null : m.groupKey)}
                        className="w-full px-3 py-2.5 flex items-center justify-between text-left active:bg-slate-800/50">
                        <div>
                          <p className="text-sm font-bold text-slate-200">{m.title}</p>
                          <p className="text-[11px] text-slate-500">{m.metric}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="text-[11px] text-slate-400">{m.count}회</p>
                            <p className="text-[10px] text-slate-600">{m.latestDate}</p>
                          </div>
                          <span className={`text-amber-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                        </div>
                      </button>

                      {open && (() => {
                        // 점프·보행·자세는 여러 지표를 함께 추세로 보여준다(구 점프추세/보행추세/자세체형추세 섹션 흡수).
                        // 그 외 메뉴는 기존처럼 핵심 지표 1개만 추세로 보여준다.
                        const extraCharts = extraMenuTrendCharts(m.menu, trend, postureTrend);
                        return (
                          <div className="border-t border-slate-800 p-3 space-y-3">
                            {/* 회차별 비교 차트 */}
                            {extraCharts.length > 0 ? (
                              <div>
                                <p className="text-[11px] font-bold text-slate-400 mb-1">회차별 비교</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {extraCharts.map(c => (
                                    <TrendChart key={c.key} title={c.title} unit={c.unit} points={c.points} color={c.color} width={320} height={140} />
                                  ))}
                                </div>
                              </div>
                            ) : points.length > 1 ? (
                              <div>
                                <p className="text-[11px] font-bold text-slate-400 mb-1">회차별 비교 {delta != null && (
                                  <span className={delta === 0 ? 'text-slate-500' : delta > 0 ? 'text-emerald-400' : 'text-red-400'}>
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
                                const measuredAt = r.s.data?.measuredAt;
                                const gIdx = (m.menu === 'jump' || m.menu === 'gait') && measuredAt
                                  ? savedReports.findIndex(sr => sr.measuredAt && sr.measuredAt === measuredAt) : -1;
                                const pIdx = m.menu === 'posture' && measuredAt
                                  ? savedPostureReports.findIndex(sr => sr.measuredAt && sr.measuredAt === measuredAt) : -1;
                                const romIdx = m.menu === 'rom' && measuredAt
                                  ? savedRomReports.findIndex(sr => sr.measuredAt && sr.measuredAt === measuredAt) : -1;
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
                                return (
                                  <div key={j} className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
                                    <div>
                                      <p className="text-xs font-bold text-slate-200">
                                        {r.value != null ? `${r.value}${r.unit}` : '—'} <span className="text-slate-500 font-normal">{r.label}</span>
                                      </p>
                                      <p className="text-[10px] text-slate-500">{String(r.s.recordedAt || '').slice(0, 10)}</p>
                                    </div>
                                    {openable && (
                                      <button onClick={openDetail} className="text-amber-400 text-[11px] font-bold">리포트 →</button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
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
          <ComprehensiveReportSection member={member} dataReady={dataReady} />

          <InterpretationGuideSection guide={interpretationGuide} />

          {msg && <p className="text-center text-xs text-slate-400">{msg}</p>}
        </>
      )}

      {shareCaptureItem && (
        <div
          aria-hidden="true"
          className="fixed top-0 w-[860px] max-w-none overflow-visible bg-slate-950 pointer-events-none"
          style={{ left: '-10000px' }}
        >
          <div ref={shareCaptureRef} className="w-[860px] bg-slate-950">
            <Suspense fallback={<div className="min-h-[1123px] w-[794px] bg-slate-900" />}>
              <ShareCaptureReport item={shareCaptureItem} member={member} />
            </Suspense>
          </div>
        </div>
      )}

      {/* 페이지별 리포트 뷰어 (이전/다음으로 회차 넘김) */}
      {viewerIdx != null && savedReports[viewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <button onClick={() => setViewerIdx(null)} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{viewerIdx + 1} / {savedReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setViewerIdx(i => Math.min(savedReports.length - 1, i + 1))}
                disabled={viewerIdx >= savedReports.length - 1}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setViewerIdx(i => Math.max(0, i - 1))}
                disabled={viewerIdx <= 0}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-400">불러오는 중…</div>}>
            {savedReports[viewerIdx].kind === 'jump'
              ? <JumpReportDashboard report={savedReports[viewerIdx]} onClose={() => setViewerIdx(null)} member={member} />
              : <GaitReportDashboard report={savedReports[viewerIdx]} onClose={() => setViewerIdx(null)} member={member} />}
          </Suspense>
        </div>
      )}
      {romViewerIdx != null && savedRomReports[romViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <button onClick={() => setRomViewerIdx(null)} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{romViewerIdx + 1} / {savedRomReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setRomViewerIdx(i => Math.min(savedRomReports.length - 1, i + 1))}
                disabled={romViewerIdx >= savedRomReports.length - 1}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setRomViewerIdx(i => Math.max(0, i - 1))}
                disabled={romViewerIdx <= 0}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-400">불러오는 중…</div>}>
            <RomReport report={savedRomReports[romViewerIdx]} member={member} />
          </Suspense>
        </div>
      )}
      {postureViewerIdx != null && savedPostureReports[postureViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <button onClick={() => setPostureViewerIdx(null)} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{postureViewerIdx + 1} / {savedPostureReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setPostureViewerIdx(i => Math.min(savedPostureReports.length - 1, i + 1))}
                disabled={postureViewerIdx >= savedPostureReports.length - 1}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setPostureViewerIdx(i => Math.max(0, i - 1))}
                disabled={postureViewerIdx <= 0}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-400">불러오는 중…</div>}>
            <PostureReport
              report={savedPostureReports[postureViewerIdx]}
              member={member}
              heightCm={savedPostureReports[postureViewerIdx]?.heightCm}
              actualAge={savedPostureReports[postureViewerIdx]?.actualAge}
              onClose={() => setPostureViewerIdx(null)}
            />
          </Suspense>
        </div>
      )}
      {liftingViewerIdx != null && savedLiftingSessions[liftingViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <button onClick={() => setLiftingViewerIdx(null)} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{liftingViewerIdx + 1} / {savedLiftingSessions.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setLiftingViewerIdx(i => Math.min(savedLiftingSessions.length - 1, i + 1))}
                disabled={liftingViewerIdx >= savedLiftingSessions.length - 1}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setLiftingViewerIdx(i => Math.max(0, i - 1))}
                disabled={liftingViewerIdx <= 0}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-400">불러오는 중…</div>}>
            <LiftingReportDashboard
              report={savedLiftingSessions[liftingViewerIdx]?.data || {}}
              member={member}
              onClose={() => setLiftingViewerIdx(null)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
