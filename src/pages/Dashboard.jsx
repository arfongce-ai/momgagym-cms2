// pages/Dashboard.jsx — 9장 "준실시간 그래프뷰 대시보드" (관리자 전용)
// scripts/dashboard-snapshot/sync.mjs가 30분마다 Firestore dashboardSnapshots에
// 쌓아두는 스냅샷을 읽어서 그린다. 완전 실시간이 아니라 5분마다 다시 읽는
// "준실시간" 방식 — 원본 설계 문서(세컨드브레인_CMS연동_수익구조_전략.md 9장)의
// 선택을 그대로 따름.
//
// ⚠️ dashboardSnapshots는 회원 개인정보를 담지 않는 집계 전용 컬렉션이다
//   (firestore.rules: allow write: if false — Admin SDK 스크립트만 쓸 수 있음).
// ⚠️ 트레이너별 "측정 리포트 건수"는 이 컬렉션에 없다(비용 관리를 위해 8장
//   scripts/trainer-stats의 주간 Notion 표로만 제공 — sync.mjs 주석 참고).
import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { won } from '../services/finance';
import { todayYMD } from '../utils/dates';
import { summarizeRange } from '../utils/dashboardRollup';

const REFRESH_MS = 10 * 60 * 1000; // 스냅샷이 30분마다 쌓이므로 10분이면 충분(읽기 절감). 탭이 숨겨져 있으면 건너뜀
const SNAPSHOT_LIMIT = 48; // 30분 간격 × 48 = 최근 24시간(오늘 것만 골라 그림)
const DAILY_LIMIT = 31;    // 일 단위 요약 최근 31일(1주·1달 보기)

function Card({ label, value, sub, color = 'text-slate-800 dark:text-slate-100' }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
      <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</span>
      <p className={`text-xl font-black font-mono mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// 순수 SVG 미니 라인차트 — 이 저장소는 외부 차트 라이브러리 없이
// components/report/TrendChart.jsx 방식(순수 SVG)을 이미 쓰고 있어 그 관례를 그대로 따름.
function MiniLineChart({ points, color = '#f59e0b', width = 640, height = 200, formatY = (v) => v }) {
  if (!points || points.length < 2) {
    return <p className="text-sm text-slate-500 py-10 text-center">그래프를 그리기엔 데이터가 아직 부족해요(스냅샷 2개 이상 필요).</p>;
  }
  const padL = 46, padR = 12, padT = 16, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const values = points.map((p) => p.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  const n = points.length;
  const xAt = (i) => padL + (innerW * i) / (n - 1);
  const yAt = (v) => padT + innerH - ((v - min) / range) * innerH;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(' ');
  const ticks = [min, (min + max) / 2, max];

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {ticks.map((t, i) => {
        const y = yAt(t);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="1" />
            <text x={padL - 6} y={y + 3} fill="currentColor" className="text-slate-400 dark:text-slate-500" fontSize="10" textAnchor="end">
              {formatY(t)}
            </text>
          </g>
        );
      })}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(p.value)} r="3" fill={color} />
      ))}
      <text x={padL} y={height - 4} fill="currentColor" className="text-slate-400 dark:text-slate-500" fontSize="10">
        {points[0].label}
      </text>
      <text x={width - padR} y={height - 4} fill="currentColor" className="text-slate-400 dark:text-slate-500" fontSize="10" textAnchor="end">
        {points[n - 1].label}
      </text>
    </svg>
  );
}

// 트레이너별 오늘 매출 비교 — 순수 SVG 가로 막대
function TrainerRevenueBars({ rows }) {
  if (!rows.length) return <p className="text-sm text-slate-500 py-6 text-center">매출 귀속 데이터가 아직 없어요.</p>;
  const max = Math.max(...rows.map((r) => r.revenueToday), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-slate-500 truncate">{r.name}</span>
          <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-md"
              style={{ width: `${Math.max(2, (r.revenueToday / max) * 100)}%` }}
            />
          </div>
          <span className="w-24 shrink-0 text-xs font-mono text-slate-600 dark:text-slate-300 text-right">{won(r.revenueToday)}</span>
        </div>
      ))}
    </div>
  );
}

const kstYMD = (iso) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const dayLabel = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const timeLabel = (iso) => {
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
};

export default function Dashboard() {
  const [range, setRange] = useState('today'); // today | week | month
  const [snapshots, setSnapshots] = useState([]); // 오래된 → 최신 순
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dailyError, setDailyError] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const q = query(collection(db, 'dashboardSnapshots'), orderBy('timestamp', 'desc'), limit(SNAPSHOT_LIMIT));
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse(); // 오래된 → 최신
      setSnapshots(rows);
      setLastFetchedAt(new Date());
    } catch (e) {
      console.error('[Dashboard] snapshot load failed', e);
      setError(e.message || '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  // 1주·1달 보기용 일 요약 — 해당 탭을 열 때만 읽는다(읽기 절감).
  const loadDaily = useCallback(async () => {
    try {
      setDailyError(null);
      const q = query(collection(db, 'dashboardDaily'), orderBy('date', 'desc'), limit(DAILY_LIMIT));
      const snap = await getDocs(q);
      setDaily(snap.docs.map((d) => d.data()));
    } catch (e) {
      console.error('[Dashboard] daily load failed', e);
      setDailyError(e.message || '불러오기 실패');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (range === 'today') return undefined;
    loadDaily();
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadDaily(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [range, loadDaily]);

  const latest = snapshots[snapshots.length - 1] || null;
  const today = todayYMD();
  const todaySnaps = snapshots.filter((s) => kstYMD(s.timestamp) === today);

  // 마지막 스냅샷이 너무 오래됐으면(수집이 멈춘 것) 알려준다. 새벽(수집 안 하는 시간)엔 제외.
  const nowH = new Date().getHours();
  const staleMin = latest ? Math.round((Date.now() - new Date(latest.timestamp).getTime()) / 60000) : 0;
  const stale = latest && staleMin > 100 && nowH >= 8;

  const activeMembersPoints = todaySnaps.map((s) => ({ value: s.activeMembers || 0, label: timeLabel(s.timestamp) }));
  const revenuePoints = todaySnaps.map((s) => ({ value: s.revenueToday || 0, label: timeLabel(s.timestamp) }));

  const trainerRows = latest
    ? Object.entries(latest.byTrainer || {})
        .map(([id, t]) => ({ id, name: t.name || id, revenueToday: t.revenueToday || 0 }))
        .sort((a, b) => b.revenueToday - a.revenueToday)
    : [];

  const nDays = range === 'week' ? 7 : 30;
  const rs = range === 'today' ? null : summarizeRange(daily, nDays, today);
  const periodName = range === 'week' ? '최근 7일' : '최근 30일';
  const dayPoints = (key) => rs.days.filter((d) => d.has && d[key] != null).map((d) => ({ value: d[key], label: dayLabel(d.date) }));
  const activeDayPoints = rs ? dayPoints('activeMembers') : [];

  const Tab = ({ id, children }) => (
    <button onClick={() => setRange(id)}
      className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors ${range === id
        ? 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300'
        : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>
      {children}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight">📈 대시보드</h1>
          <p className="text-slate-500 text-sm mt-1">
            30분마다 자동 수집(KST 07시~) · 오늘은 시간대별, 1주·1달은 일별 합계
          </p>
        </div>
        {lastFetchedAt && (
          <p className="text-[11px] text-slate-400">
            마지막 새로고침: {lastFetchedAt.toLocaleTimeString('ko-KR', { hour12: false })}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Tab id="today">오늘</Tab>
        <Tab id="week">1주</Tab>
        <Tab id="month">1달</Tab>
      </div>

      {loading && <p className="text-sm text-slate-500 py-10 text-center">불러오는 중…</p>}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-300">
          데이터를 불러오지 못했습니다: {error}
        </div>
      )}

      {!loading && !error && !latest && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          아직 쌓인 스냅샷이 없습니다. GitHub Actions의 <code className="font-mono">dashboard-snapshot</code> 워크플로가
          실행되면(최초 실행까지 최대 30분, 또는 Actions 탭에서 수동 실행) 데이터가 나타납니다.
        </div>
      )}

      {!loading && stale && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          마지막 수집이 {staleMin}분 전입니다. 수집(GitHub Actions)이 멈췄을 수 있어요 — 숫자가 최신이 아닐 수 있습니다.
        </div>
      )}

      {!loading && latest && range === 'today' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="오늘 신규 회원" value={`${latest.newMembersToday ?? 0}명`} />
            <Card label="활성 회원" value={`${latest.activeMembers ?? 0}명`}
              sub={latest.totalMembers != null ? `전체 ${latest.totalMembers} · 만료 ${latest.expiredMembers ?? 0} · 횟수마감 ${latest.exhaustedMembers ?? 0}` : '결제 만료·횟수 마감 제외'} />
            <Card label="오늘 매출" value={won(latest.revenueToday || 0)} color="text-amber-600 dark:text-amber-400" />
            <Card label="오늘 측정 리포트" value={`${latest.reportsToday ?? 0}건`} sub="ai/gait/posture/rom 합계" />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">활성 회원 추이(오늘)</h2>
            <MiniLineChart points={activeMembersPoints} color="#38bdf8" formatY={(v) => Math.round(v)} />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">오늘 누적 매출 추이</h2>
            <MiniLineChart points={revenuePoints} color="#f59e0b" formatY={(v) => won(v)} />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">트레이너별 오늘 매출</h2>
            <TrainerRevenueBars rows={trainerRows} />
          </div>
        </>
      )}

      {!loading && range !== 'today' && (
        <>
          {dailyError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-300">
              일별 데이터를 불러오지 못했습니다: {dailyError}
              (Firestore 규칙에 dashboardDaily 읽기 권한이 게시됐는지 확인하세요)
            </div>
          )}
          {!dailyError && !rs.days.some((d) => d.has) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              일별 요약이 아직 없습니다. 수집이 한 번 돌고 나면(최대 30분) 표시됩니다.
            </div>
          )}
          {!dailyError && rs.days.some((d) => d.has) && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card label={`${periodName} 매출`} value={won(rs.totals.revenue)} sub={`일평균 ${won(rs.avgRevenue)}`} color="text-amber-600 dark:text-amber-400" />
                <Card label={`${periodName} 신규 회원`} value={`${rs.totals.newMembers}명`} />
                <Card label={`${periodName} 측정 리포트`} value={`${rs.totals.reports}건`} sub="ai/gait/posture/rom 합계" />
                <Card label="현재 활성 회원" value={`${latest?.activeMembers ?? 0}명`}
                  sub={latest?.totalMembers != null ? `전체 ${latest.totalMembers}명` : undefined} />
              </div>
              {rs.missing > 0 && (
                <p className="text-[11px] text-slate-500">수집 기록이 없는 {rs.missing}일은 합계에서 제외했습니다.</p>
              )}

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">일별 매출</h2>
                <MiniLineChart points={dayPoints('revenue')} color="#f59e0b" formatY={(v) => won(v)} />
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">일별 신규 회원</h2>
                <MiniLineChart points={dayPoints('newMembers')} color="#34d399" formatY={(v) => Math.round(v)} />
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">일별 측정 리포트</h2>
                <MiniLineChart points={dayPoints('reports')} color="#a78bfa" formatY={(v) => Math.round(v)} />
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">활성 회원 추이(일 마감 기준)</h2>
                <MiniLineChart points={activeDayPoints} color="#38bdf8" formatY={(v) => Math.round(v)} />
                <p className="text-[11px] text-slate-500 mt-1">과거 날짜의 활성 회원 수는 기록이 없어, 수집 시작일부터 표시됩니다.</p>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">트레이너별 {periodName} 매출</h2>
                <TrainerRevenueBars rows={rs.byTrainer.map((t) => ({ id: t.id, name: t.name, revenueToday: Math.round(t.revenue) }))} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
