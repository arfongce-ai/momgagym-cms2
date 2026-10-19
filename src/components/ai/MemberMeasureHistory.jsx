// MemberMeasureHistory.jsx — AI 측정 이력 + 변화율 요약
// Gemini 교차검증 반영:
//   - 카드 나열식 렌더링
//   - 과거 대비 변화 자동 요약 (예: 골격근량 +0.2kg)
//   - try-catch 완비
import { useState, useEffect, useMemo } from 'react';
import { deleteAiSession, calcChanges } from '../../services/aiService';
import { loadMeasureEntries, describeEntry } from '../../services/measureHistoryService';
import { buildMemberTimelines } from '../../services/measureCompareService';
import TrendChart from '../report/TrendChart';
import { useAuth } from '../../contexts/AuthContext';
import { aiStore } from '../../demoData';

const FIELD_LABEL = {
  weight:    { label: '몸무게',   unit: 'kg',   icon: '⚖️'  },
  systolic:  { label: '최고혈압', unit: 'mmHg', icon: '🩸'  },
  diastolic: { label: '최저혈압', unit: 'mmHg', icon: '🩺'  },
};

// ── 변화율 배지 ───────────────────────────────────────────
function ChangeBadge({ diff, unit, field }) {
  if (!diff) return null;
  const { diffStr, trend } = diff;

  // 필드별 '좋은 방향' 판단 (혈압·체중은 낮아지는 쪽이 좋음)
  const isGood =
    field === 'weight'    ? trend === 'down' :
    field === 'systolic'  ? trend === 'down' :
    field === 'diastolic' ? trend === 'down' : true;

  const cls =
    trend === 'same'                                  ? 'text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-700'        :
    isGood                                            ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/20' :
                                                        'text-red-700 dark:text-red-400 bg-red-500/20';

  const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '–';

  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>
      {arrow} {diffStr}{unit}
    </span>
  );
}

// ── 측정 기록 카드 (허브 저장 형식 + 전용 리포트 통합) ───────────────
// [2026-10] 세션(ai)·보행/자세/ROM 전용 리포트를 한 목록으로 합쳐 보여준다.
// 카드마다 대표 지표 · 신뢰도 · 트레이너 확인 상태를 같은 형식으로 표시한다.
const STATUS_CLR = {
  normal:  'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  caution: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  risk:    'bg-red-500/20 text-red-700 dark:text-red-400',
};

function EntryCard({ entry, onDelete, onReview, isAdmin, canReview }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(entry.trainerReview?.note || '');
  const [adj, setAdj] = useState(entry.trainerReview?.adjustedText || '');
  const [saving, setSaving] = useState(false);
  const { metrics, confidence } = describeEntry(entry);
  const rv = entry.trainerReview;

  const submit = async (status) => {
    setSaving(true);
    try { await onReview(entry, { status, note: note.trim(), adjustedText: adj.trim() }); setOpen(false); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold text-sm">{entry.date || '-'}</span>
          <span className="ml-2 text-xs font-bold text-slate-700 dark:text-slate-200">{entry.title}</span>
        </div>
        {isAdmin && entry.sessionId && (
          <button onClick={() => onDelete(entry.sessionId)}
            className="text-slate-600 hover:text-red-700 dark:hover:text-red-400 text-sm transition-colors">
            🗑
          </button>
        )}
      </div>

      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {metrics.map(m => (
            <span key={m.key}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${STATUS_CLR[m.status?.key] || 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
              {m.label}: {m.displayValue}{m.unit}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="text-slate-500">
          신뢰도 {confidence.pct != null ? `${confidence.pct}%` : '미기록'}
        </span>
        {rv ? (
          <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-700 dark:text-sky-400 font-bold">
            트레이너 {rv.status === 'adjusted' ? '보정' : '확인'} 완료
          </span>
        ) : (
          <span className="text-slate-500">트레이너 확인 전</span>
        )}
        {entry.source === 'report' && <span className="text-slate-400">전용 리포트 기록</span>}
      </div>

      {rv && (rv.note || rv.adjustedText) && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {rv.adjustedText ? `보정: ${rv.adjustedText}` : ''}{rv.adjustedText && rv.note ? ' · ' : ''}{rv.note ? `메모: ${rv.note}` : ''}
        </p>
      )}
      {entry.memo && <p className="text-xs text-slate-500 italic">📝 {entry.memo}</p>}

      {canReview && (
        <div>
          <button onClick={() => setOpen(o => !o)} className="text-[11px] underline text-slate-500">
            {rv ? '확인 내용 수정' : '트레이너 확인'}
          </button>
          {open && (
            <div className="mt-2 space-y-2">
              <input value={adj} onChange={e => setAdj(e.target.value)} placeholder="보정한 값이 있으면 입력 (예: 좌 45° / 우 52°)"
                className="w-full text-xs rounded-md px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600" />
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="확인 메모 (선택)"
                className="w-full text-xs rounded-md px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600" />
              <div className="flex gap-2">
                <button disabled={saving} onClick={() => submit('confirmed')}
                  className="text-xs px-3 py-1.5 rounded-md bg-sky-600 text-white disabled:opacity-50">측정값 맞음</button>
                <button disabled={saving || !adj.trim()} onClick={() => submit('adjusted')}
                  className="text-xs px-3 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-50">보정값으로 저장</button>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-slate-500">상세 결과는 리포트 화면에서 확인할 수 있습니다.</p>
    </div>
  );
}

// ── 세션 카드 ─────────────────────────────────────────────
function SessionCard({ session, prevSession, onDelete, isAdmin }) {
  const { measurements: m, analysisResult: r, recordedAt, memo } = session;
  const prevM  = prevSession?.measurements;
  const changes = prevM ? calcChanges(m, prevM) : {};

  const GRADE_CLR = {
    good: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
    warn: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
    bad:  'bg-red-500/20 text-red-700 dark:text-red-400',
  };

  return (
    <div className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-4 space-y-3">
      {/* 날짜 + 삭제 */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold text-sm">{recordedAt}</span>
          {!prevSession && (
            <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold">
              최신
            </span>
          )}
        </div>
        {isAdmin && (
          <button onClick={() => onDelete(session.id)}
            className="text-slate-600 hover:text-red-700 dark:hover:text-red-400 text-sm transition-colors">
            🗑
          </button>
        )}
      </div>

      {/* 측정값 + 변화율 */}
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(FIELD_LABEL).map(([key, meta]) => {
          const val = m[key];
          if (val == null) return null;
          return (
            <div key={key} className="bg-slate-200/50 dark:bg-slate-700/50 rounded-lg p-2 text-center">
              <p className="text-[10px] text-slate-500 mb-0.5">{meta.icon} {meta.label}</p>
              <p className="font-mono font-black text-sm text-slate-800 dark:text-slate-100">
                {val}
                <span className="text-slate-500 text-[10px] font-normal">{meta.unit}</span>
              </p>
              {changes[key] && (
                <div className="mt-0.5">
                  <ChangeBadge diff={changes[key]} unit={meta.unit} field={key} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI 분석 요약 */}
      {r?.items?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.items.map(item => (
            <span key={item.key}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${GRADE_CLR[item.grade] || GRADE_CLR.warn}`}>
              {item.label}: {item.value}{item.unit}
            </span>
          ))}
        </div>
      )}

      {/* 종합 의견 */}
      {r?.summary && (
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-300 dark:border-slate-700 pt-2">
          {r.summary}
        </p>
      )}

      {/* 트레이너 메모 */}
      {memo && (
        <p className="text-xs text-slate-500 italic">📝 {memo}</p>
      )}

      {/* 변화 요약 (이전 기록 있을 때) */}
      {Object.keys(changes).length > 0 && (
        <div className="bg-slate-200/30 dark:bg-slate-700/30 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest mb-1">
            이전 측정 대비
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {Object.entries(changes).map(([key, ch]) => {
              const meta = FIELD_LABEL[key];
              if (!meta) return null;
              const sign  = ch.trend === 'up' ? '▲' : ch.trend === 'down' ? '▼' : '–';
              const color =
                (key === 'weight' || key === 'systolic' || key === 'diastolic') && ch.trend === 'down' ? 'text-emerald-700 dark:text-emerald-400' :
                ch.trend === 'same'                                                                      ? 'text-slate-500'   :
                                                                                                           'text-red-700 dark:text-red-400';
              return (
                <span key={key} className={`mr-3 font-semibold ${color}`}>
                  {sign} {meta.label} {ch.diffStr}{meta.unit}
                </span>
              );
            })}
          </p>
        </div>
      )}
    </div>
  );
}

// ── 회차별 비교 (2026-10, 2단계) ─────────────────────────────
// 종류별로 회차 추이 그래프 + 이전/처음 대비 변화를 보여준다. 판정이 아니라 수치 변화만 표시한다.
const DIR_LABEL = { improved: ['▲ 개선', 'text-emerald-700 dark:text-emerald-400'], worsened: ['▼ 주의', 'text-red-700 dark:text-red-400'], same: ['– 변화 없음', 'text-slate-500'], neutral: ['변화', 'text-slate-500'] };

function ChangeText({ row, prefix }) {
  if (!row) return null;
  const [txt, cls] = DIR_LABEL[row.direction] || DIR_LABEL.neutral;
  return (
    <span className={`mr-3 ${cls}`}>
      {prefix} {row.diff > 0 ? '+' : ''}{row.diff}{row.unit} {txt}
    </span>
  );
}

function CompareSection({ entries }) {
  const timelines = useMemo(() => {
    try { return buildMemberTimelines(entries); } catch (e) { console.warn('[CompareSection]', e?.message); return []; }
  }, [entries]);
  const [open, setOpen] = useState(null);
  const multi = timelines.filter(t => t.count >= 2);
  if (!multi.length) return null;
  return (
    <div className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-4 space-y-2">
      <p className="text-sm font-bold">회차별 비교</p>
      {multi.map(t => (
        <div key={t.type} className="border-t border-slate-300 dark:border-slate-700 pt-2">
          <button onClick={() => setOpen(o => o === t.type ? null : t.type)}
            className="w-full flex items-center justify-between text-xs font-semibold">
            <span>{t.title} · {t.count}회</span><span>{open === t.type ? '접기' : '펼치기'}</span>
          </button>
          {open === t.type && (
            <div className="mt-2 space-y-3">
              {t.metrics.filter(m => m.points.length >= 2).map(m => (
                <div key={m.key} className="space-y-1">
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    <ChangeText row={m.vsPrev} prefix={`${m.label} 이전 대비`} />
                    <ChangeText row={m.vsFirst} prefix="처음 대비" />
                  </p>
                  <TrendChart title={m.label} unit={m.unit} points={m.points.map(p => ({ label: p.date, value: p.value, date: p.date }))} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────
export default function MemberMeasureHistory({ member, onNewMeasure }) {
  const { user }        = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      setLoadError('');
      const list = await loadMeasureEntries(member.id);
      setEntries(list);
      // ensureSessions 는 읽기 실패를 빈 목록으로 삼키므로, 실패 사유를 따로 확인해 안내한다.
      if (list.length === 0 && aiStore._aiLoadError) setLoadError(aiStore._aiLoadError);
    } catch (err) {
      console.error('[MemberMeasureHistory] 로드 오류:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [member.id]);

  // [버그 수정 2026-09] deleteAiSession은 async 함수인데 await 없이 호출하고
  // 바로 load()를 부르고 있었다. deleteAiSession 자체가 내부에서 오류를
  // 잡아 { success:false, error } 형태로 반환하므로(절대 throw하지 않음)
  // 아래 try/catch는 실제로는 아무 것도 못 잡는 죽은 코드였다 — Firestore
  // 삭제가 실패해도 트레이너에게는 아무 안내 없이 조용히 넘어갔다(화면은
  // 이미 낙관적으로 지워진 것처럼 보이지만 실제로는 안 지워졌을 수 있음).
  // await로 결과를 받아 성공 여부를 확인하고, 실패면 알려준 뒤 항상
  // load()로 실제 저장소 상태를 다시 반영한다.
  const handleDelete = async (sid) => {
    if (!window.confirm('이 측정 기록을 삭제하시겠습니까?')) return;
    const result = await deleteAiSession(member.id, sid);
    if (!result.success) {
      alert('삭제 중 오류가 발생했습니다: ' + (result.error || '알 수 없는 오류'));
    }
    load();
  };

  // 트레이너 확인 저장 — 실패하면 알리고, 항상 실제 저장소 상태로 다시 불러온다.
  const handleReview = async (entry, review) => {
    try {
      await aiStore.setTrainerReview(member.id, {
        sessionId: entry.sessionId, reportId: entry.reportId, reportCollection: entry.reportCollection,
      }, { ...review, by: user?.name || user?.email || user?.trainerId || '' });
    } catch (err) {
      alert('트레이너 확인 저장 중 오류가 발생했습니다: ' + (err?.message || '알 수 없는 오류'));
    }
    load();
  };

  return (
    <div className="space-y-4">
      {/* 신규 측정 버튼 */}
      <button
        onClick={onNewMeasure}
        className="w-full py-3 rounded-xl border-2 border-dashed border-amber-500/30
                   text-amber-700 dark:text-amber-400 hover:border-amber-500/60 hover:bg-amber-500/5
                   text-sm font-semibold transition-colors flex items-center justify-center gap-2">
        🤖 + 새 AI 측정 시작
      </button>

      {/* 로딩 중 */}
      {loading && (
        <div className="text-center py-10 text-slate-600">
          <p className="text-sm">측정 이력 불러오는 중…</p>
        </div>
      )}

      {/* 이력 없음 */}
      {!loading && entries.length === 0 && loadError && (
        <div className="text-center py-6 text-red-700 dark:text-red-400">
          <p className="text-sm font-semibold">측정 이력을 불러오지 못했습니다 ({loadError})</p>
          <button onClick={load} className="mt-2 text-xs underline">다시 불러오기</button>
        </div>
      )}

      {!loading && entries.length === 0 && !loadError && (
        <div className="text-center py-10 text-slate-600">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-sm">측정 이력이 없습니다</p>
          <p className="text-xs mt-1">위 버튼으로 첫 측정을 시작해 보세요.</p>
        </div>
      )}

      {!loading && <CompareSection entries={entries} />}

      {/* 카드 나열 */}
      {!loading && entries.map((entry) => {
        if (entry.type === 'body' && entry.session) {
          const bodies = entries.filter(e => e.type === 'body' && e.session);
          const prev = bodies[bodies.findIndex(e => e.id === entry.id) + 1]?.session || null;
          return (
            <SessionCard key={entry.id} session={entry.session} prevSession={prev}
              onDelete={handleDelete} isAdmin={isAdmin} />
          );
        }
        return (
          <EntryCard key={entry.id} entry={entry} onDelete={handleDelete} onReview={handleReview}
            isAdmin={isAdmin} canReview={user?.role === 'admin' || user?.role === 'trainer'} />
        );
      })}
    </div>
  );
}
