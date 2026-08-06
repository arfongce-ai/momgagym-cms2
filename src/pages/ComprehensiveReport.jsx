// pages/ComprehensiveReport.jsx — 종합리포트
//  각 측정 결과 리포트(자세·ROM·보행·점프·바벨·신체정보)를 통합 분석해
//  같은 일 / 같은 주(일요일 시작) / 같은 월 단위로 종합리포트 + 데이터 통계를 보여준다.
//  이상 데이터(사유 표시)는 확인 후 개별/일괄 삭제할 수 있다.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { store } from '../demoData';
import { scopeMembersToTrainer, sortByName } from '../utils/memberList';
import MemberPicker from '../components/common/MemberPicker';
import {
  buildComprehensiveReport, findAnomalies,
} from '../ai-measure/core/comprehensiveReport';
import { loadAllMeasureRecords, deleteMeasureRecord } from '../services/comprehensiveReportService';

const UNITS = [
  { key: 'day', label: '일' },
  { key: 'week', label: '주' },
  { key: 'month', label: '월' },
];

const STATUS_COLOR = {
  good: 'text-emerald-400', normal: 'text-sky-400',
  caution: 'text-amber-400', bad: 'text-red-400', unknown: 'text-slate-500',
};

function ScorePill({ score, statusKey, statusLabel }) {
  if (score == null) return <span className="text-xs text-slate-500">점수 없음</span>;
  return (
    <span className={`text-xs font-bold font-mono ${STATUS_COLOR[statusKey] || STATUS_COLOR.unknown}`}>
      {score}<span className="text-slate-500">/100</span>
      {statusLabel ? <span className="ml-1 font-sans">{statusLabel}</span> : null}
    </span>
  );
}

// 유형별 통계 카드
function TypeStatCard({ ts }) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-black text-slate-100">{ts.typeLabel}</div>
        <div className="text-xs text-slate-500 font-bold">{ts.count}회</div>
      </div>
      {ts.score ? (
        <div className="text-xs text-slate-400 mb-2">
          점수 평균 <b className="text-slate-200 font-mono">{ts.score.avg}</b>
          <span className="text-slate-600"> · </span>
          최저 <span className="font-mono">{ts.score.min}</span>
          <span className="text-slate-600"> · </span>
          최고 <span className="font-mono">{ts.score.max}</span>
          {ts.score.count >= 2 && (
            <span className={`ml-2 font-bold font-mono ${ts.score.delta > 0 ? 'text-emerald-400' : ts.score.delta < 0 ? 'text-red-400' : 'text-slate-500'}`}>
              {ts.score.delta > 0 ? '▲' : ts.score.delta < 0 ? '▼' : '—'} {Math.abs(ts.score.delta)}
            </span>
          )}
        </div>
      ) : <div className="text-xs text-slate-600 mb-2">점수형 지표 없음</div>}
      {ts.metrics.length > 0 && (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-bold py-1">지표</th>
              <th className="text-right font-bold">평균</th>
              <th className="text-right font-bold">최저</th>
              <th className="text-right font-bold">최고</th>
              <th className="text-right font-bold">변화</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {ts.metrics.map(m => (
              <tr key={m.label} className="border-t border-slate-800/60 text-slate-300">
                <td className="py-1 font-sans">{m.label}<span className="text-slate-600 ml-0.5">{m.unit}</span></td>
                <td className="text-right">{m.avg}</td>
                <td className="text-right text-slate-500">{m.min}</td>
                <td className="text-right text-slate-500">{m.max}</td>
                <td className={`text-right font-bold ${m.delta > 0 ? 'text-emerald-400' : m.delta < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                  {m.count >= 2 ? (m.delta > 0 ? `+${m.delta}` : m.delta) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function ComprehensiveReport() {
  const { user } = useAuth();
  const [members] = useState(() => sortByName(scopeMembersToTrainer(store.getMembers(), user)));
  const [memberId, setMemberId] = useState('');
  const [unit, setUnit] = useState('week');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [deleting, setDeleting] = useState(null); // 삭제 중인 레코드 id
  const [error, setError] = useState('');

  const member = members.find(m => m.id === memberId) || null;

  const reload = useCallback(async () => {
    if (!memberId) { setRecords([]); return; }
    setLoading(true); setError('');
    try { setRecords(await loadAllMeasureRecords(memberId)); }
    catch (e) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [memberId]);

  useEffect(() => { reload(); setSelectedKey(null); }, [reload]);
  useEffect(() => { setSelectedKey(null); }, [unit]);

  const report = useMemo(() => buildComprehensiveReport(records, unit), [records, unit]);
  const anomalies = useMemo(() => findAnomalies(records), [records]);
  const selected = report.periods.find(p => p.key === selectedKey) || report.periods[0] || null;

  const handleDelete = async (record, why = '') => {
    const label = `${record.dateYMD || '날짜없음'} · ${record.typeLabel} · ${record.sourceLabel}`;
    const reason = why ? `\n사유: ${why}` : '';
    if (!window.confirm(`이 기록을 삭제할까요?\n${label}${reason}\n\n삭제하면 통합 리포트 사본까지 함께 제거되며 되돌릴 수 없습니다.`)) return;
    setDeleting(record.id);
    try {
      await deleteMeasureRecord(memberId, record);
      setRecords(prev => prev.filter(r => !(r.id === record.id && r.source === record.source)));
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
        await deleteMeasureRecord(memberId, a.record);
        setRecords(prev => prev.filter(r => !(r.id === a.record.id && r.source === a.record.source)));
      } catch (e) { alert(`삭제 실패(${a.record.id}): ${e?.message || e}`); break; }
    }
    setDeleting(null);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      {/* ── 상단: 회원 선택 + 기간 단위 ── */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1">
          <div className="text-xs font-bold text-slate-500 mb-1.5">회원 선택</div>
          <MemberPicker members={members} value={memberId} onChange={setMemberId} placeholder="종합리포트를 볼 회원 선택" />
        </div>
        <div>
          <div className="text-xs font-bold text-slate-500 mb-1.5">기간 단위</div>
          <div className="flex rounded-xl overflow-hidden border border-slate-700">
            {UNITS.map(u => (
              <button key={u.key} onClick={() => setUnit(u.key)}
                className={`px-4 py-2 text-sm font-bold transition-colors
                  ${unit === u.key ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-white'}`}>
                {u.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="text-xs text-red-300 bg-red-950/40 border border-red-900 rounded-xl p-3">{error}</div>}

      {!member ? (
        <div className="text-center text-slate-500 text-sm py-16 border border-dashed border-slate-800 rounded-2xl">
          회원을 선택하면 모든 측정 결과를 통합한 종합리포트가 표시됩니다.
        </div>
      ) : loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-slate-400 text-sm">측정 데이터를 통합하는 중…</div>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-16 border border-dashed border-slate-800 rounded-2xl">
          이 회원의 측정 기록이 아직 없습니다.
        </div>
      ) : (
        <>
          {/* ── 전체 요약 ── */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 flex flex-wrap gap-x-6 gap-y-2 items-center">
            <div className="text-sm font-black text-slate-100">{member.name} 님 종합</div>
            <div className="text-xs text-slate-400">총 <b className="text-slate-200 font-mono">{report.totalRecords}</b>회 측정</div>
            <div className="text-xs text-slate-400">측정 유형 <b className="text-slate-200 font-mono">{report.overall.typeCount}</b>종</div>
            {report.overall.score && (
              <div className="text-xs text-slate-400">전체 평균 점수 <b className="text-amber-400 font-mono">{report.overall.score.avg}</b>/100</div>
            )}
            {anomalies.length > 0 && (
              <div className="text-xs font-bold text-red-400">이상 데이터 {anomalies.length}건 ↓</div>
            )}
          </div>

          {/* ── 기간 목록 (가로 스크롤 칩) ── */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {report.periods.map(p => (
              <button key={p.key} onClick={() => setSelectedKey(p.key)}
                className={`shrink-0 px-3 py-2 rounded-xl border text-xs font-bold transition-colors
                  ${selected?.key === p.key
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}>
                {p.label}
                <span className="ml-1.5 font-mono text-slate-500">{p.records.length}건</span>
              </button>
            ))}
          </div>

          {/* ── 선택 기간 종합리포트 ── */}
          {selected && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="text-base font-black text-slate-100">{selected.label}</div>
                  <div className="text-xs text-slate-500">{selected.range.start}{selected.range.start !== selected.range.end ? ` ~ ${selected.range.end}` : ''}</div>
                  <div className="text-xs text-slate-400">측정 <b className="text-slate-200 font-mono">{selected.stats.total}</b>회 · 유형 <b className="text-slate-200 font-mono">{selected.stats.typeCount}</b>종</div>
                  {selected.stats.score && (
                    <div className="text-xs text-slate-400">기간 평균 <b className="text-amber-400 font-mono">{selected.stats.score.avg}</b>/100
                      {selected.stats.score.count >= 2 && (
                        <span className={`ml-1.5 font-bold font-mono ${selected.stats.score.delta > 0 ? 'text-emerald-400' : selected.stats.score.delta < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                          기간 내 {selected.stats.score.delta > 0 ? '+' : ''}{selected.stats.score.delta}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 유형별 통계 */}
              <div className="grid sm:grid-cols-2 gap-3">
                {selected.stats.typeStats.map(ts => <TypeStatCard key={ts.type} ts={ts} />)}
              </div>

              {/* 기간 내 기록 목록 + 개별 삭제 */}
              <div className="rounded-2xl bg-slate-900 border border-slate-800 divide-y divide-slate-800/70">
                <div className="px-4 py-2.5 text-xs font-black text-slate-400">기간 내 기록 ({selected.records.length})</div>
                {selected.records.map(r => (
                  <div key={`${r.source}_${r.id}`} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-200 truncate">{r.typeLabel}
                        <span className="text-xs text-slate-500 font-normal ml-1.5">{r.sourceLabel}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">{r.dateYMD}{r.measuredAt ? ` ${String(r.measuredAt).slice(11, 16)}` : ''}</div>
                    </div>
                    <ScorePill score={r.score} statusKey={r.statusKey} statusLabel={r.statusLabel} />
                    <button onClick={() => handleDelete(r)} disabled={deleting === r.id}
                      className="text-[11px] font-bold text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1.5 active:scale-95 transition-transform disabled:opacity-40">
                      {deleting === r.id ? '삭제 중…' : '삭제'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 이상 데이터 패널 ── */}
          {anomalies.length > 0 && (
            <div className="rounded-2xl bg-red-950/20 border border-red-900/50">
              <div className="px-4 py-3 flex items-center gap-3 border-b border-red-900/40">
                <div className="flex-1">
                  <div className="text-sm font-black text-red-300">이상 데이터 {anomalies.length}건</div>
                  <div className="text-[11px] text-red-400/70">사유를 확인하고 잘못 저장된 결과데이터·리포트를 제거하세요.</div>
                </div>
                <button onClick={handleDeleteAllAnomalies}
                  className="text-[11px] font-bold text-red-300 border border-red-500/40 rounded-lg px-2.5 py-1.5 active:scale-95 transition-transform">
                  일괄 삭제
                </button>
              </div>
              <div className="divide-y divide-red-900/30">
                {anomalies.map(a => (
                  <div key={`${a.record.source}_${a.record.id}`} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-200">{a.record.typeLabel}
                        <span className="text-xs text-slate-500 font-normal ml-1.5">{a.record.sourceLabel} · {a.record.dateYMD || '날짜 없음'}</span>
                      </div>
                      <div className="text-[11px] text-red-400">{a.reasons.join(' · ')}</div>
                    </div>
                    <ScorePill score={a.record.score} statusKey={a.record.statusKey} statusLabel={a.record.statusLabel} />
                    <button onClick={() => handleDelete(a.record, a.reasons.join(', '))} disabled={deleting === a.record.id}
                      className="text-[11px] font-bold text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1.5 active:scale-95 transition-transform disabled:opacity-40">
                      {deleting === a.record.id ? '삭제 중…' : '삭제'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
