// MemberMeasureHistory.jsx — AI 측정 이력 + 변화율 요약
// Gemini 교차검증 반영:
//   - 카드 나열식 렌더링
//   - 과거 대비 변화 자동 요약 (예: 골격근량 +0.2kg)
//   - try-catch 완비
import { useState, useEffect } from 'react';
import { getAiSessions, loadAiSessions, deleteAiSession, calcChanges } from '../../services/aiService';
import { useAuth } from '../../contexts/AuthContext';

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
    trend === 'same'                                  ? 'text-slate-400 bg-slate-700'        :
    isGood                                            ? 'text-emerald-400 bg-emerald-500/20' :
                                                        'text-red-400 bg-red-500/20';

  const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '–';

  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>
      {arrow} {diffStr}{unit}
    </span>
  );
}

// ── 세션 카드 ─────────────────────────────────────────────
function SessionCard({ session, prevSession, onDelete, isAdmin }) {
  const { measurements: m, analysisResult: r, recordedAt, memo } = session;
  const prevM  = prevSession?.measurements;
  const changes = prevM ? calcChanges(m, prevM) : {};

  const GRADE_CLR = {
    good: 'bg-emerald-500/20 text-emerald-400',
    warn: 'bg-amber-500/20 text-amber-400',
    bad:  'bg-red-500/20 text-red-400',
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
      {/* 날짜 + 삭제 */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold text-sm">{recordedAt}</span>
          {!prevSession && (
            <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">
              최신
            </span>
          )}
        </div>
        {isAdmin && (
          <button onClick={() => onDelete(session.id)}
            className="text-slate-600 hover:text-red-400 text-sm transition-colors">
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
            <div key={key} className="bg-slate-700/50 rounded-lg p-2 text-center">
              <p className="text-[10px] text-slate-500 mb-0.5">{meta.icon} {meta.label}</p>
              <p className="font-mono font-black text-sm text-slate-100">
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
        <p className="text-xs text-slate-400 leading-relaxed border-t border-slate-700 pt-2">
          {r.summary}
        </p>
      )}

      {/* 트레이너 메모 */}
      {memo && (
        <p className="text-xs text-slate-500 italic">📝 {memo}</p>
      )}

      {/* 변화 요약 (이전 기록 있을 때) */}
      {Object.keys(changes).length > 0 && (
        <div className="bg-slate-700/30 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest mb-1">
            이전 측정 대비
          </p>
          <p className="text-xs text-slate-400">
            {Object.entries(changes).map(([key, ch]) => {
              const meta = FIELD_LABEL[key];
              if (!meta) return null;
              const sign  = ch.trend === 'up' ? '▲' : ch.trend === 'down' ? '▼' : '–';
              const color =
                (key === 'weight' || key === 'systolic' || key === 'diastolic') && ch.trend === 'down' ? 'text-emerald-400' :
                ch.trend === 'same'                                                                      ? 'text-slate-500'   :
                                                                                                           'text-red-400';
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

// ── 메인 컴포넌트 ────────────────────────────────────────
export default function MemberMeasureHistory({ member, onNewMeasure }) {
  const { user }        = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      setSessions(await loadAiSessions(member.id));
    } catch (err) {
      console.error('[MemberMeasureHistory] 로드 오류:', err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [member.id]);

  const handleDelete = (sid) => {
    if (!window.confirm('이 측정 기록을 삭제하시겠습니까?')) return;
    try {
      deleteAiSession(member.id, sid);
      load();
    } catch (err) {
      alert('삭제 중 오류가 발생했습니다: ' + err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* 신규 측정 버튼 */}
      <button
        onClick={onNewMeasure}
        className="w-full py-3 rounded-xl border-2 border-dashed border-amber-500/30
                   text-amber-400 hover:border-amber-500/60 hover:bg-amber-500/5
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
      {!loading && sessions.length === 0 && (
        <div className="text-center py-10 text-slate-600">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-sm">측정 이력이 없습니다</p>
          <p className="text-xs mt-1">위 버튼으로 첫 측정을 시작해 보세요.</p>
        </div>
      )}

      {/* 카드 나열 */}
      {!loading && sessions.map((session, idx) => (
        <SessionCard
          key={session.id}
          session={session}
          prevSession={sessions[idx + 1] || null}
          onDelete={handleDelete}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}
