// Home.jsx — v5: 공지사항 최상단 + 간이 캘린더 요약 뷰
import { useState, useEffect, useMemo } from 'react';
import { store } from '../demoData';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toYMD, todayYMD, daysAgoYMD } from '../utils/dates';
import { isMemberExpired, buildMemberSessionExpiry, summarizeMemberSessionExpiry } from '../services/sessionExpiry';
import { won, METHOD_LBL } from '../services/finance';
import { summarizeDailySettlement, yesterdayPopupSeenKey, settlementOneLine } from '../utils/dailySettlement';

function fmtDate(d) {
  return new Date(d).toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short'});
}

const STATUS_CLR = {
  scheduled:'bg-slate-700 text-slate-300',
  attended: 'bg-emerald-500/20 text-emerald-400',
  canceled: 'bg-red-500/20 text-red-400',
  noshow:   'bg-orange-500/20 text-orange-400',
};
const STATUS_LBL = { scheduled:'예정', attended:'출석', canceled:'취소', noshow:'노쇼' };
const WEEKDAYS   = ['일','월','화','수','목','금','토'];

// 요일 라벨: 선택한 날짜가 오늘이면 '오늘의 수업', 아니면 'N월 N일 (요일) 수업'
function scheduleSectionTitle(dateStr, todayStr) {
  if (dateStr === todayStr) return '오늘의 수업';
  const d  = new Date(dateStr + 'T12:00:00');
  const md = d.toLocaleDateString('ko-KR', { month:'long', day:'numeric' });
  return `${md} (${WEEKDAYS[d.getDay()]}) 수업`;
}

// 간이 캘린더: 이번 주 7일 미니 뷰 — 요일을 누르면 그날 수업을 아래 섹션에서 볼 수 있다
function MiniCalendar({ schedules, selectedDate, onSelectDate }) {
  const today = new Date();
  const todayStr = todayYMD(); // CV-A: 로컬 날짜

  // 이번 주 일~토 (달력 전체 일요일 시작 고정과 일관). getDay() 일=0.
  const weekDates = Array.from({ length:7 }, (_,i) => {
    const d = new Date(today);
    const day = today.getDay();
    d.setDate(today.getDate() - day + i);
    return toYMD(d); // CV-A: 로컬 날짜
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">📅 이번 주</h2>
      <div className="grid grid-cols-7 gap-1">
        {weekDates.map(date => {
          const ds         = schedules.filter(s => s.date === date);
          const isToday    = date === todayStr;
          const isSelected = date === selectedDate;
          const dayNum     = new Date(date+'T12:00:00').getDay();
          return (
            <button type="button" key={date} onClick={()=>onSelectDate(date)}
              aria-pressed={isSelected}
              className={`rounded-xl p-1.5 text-center transition-colors active:scale-[0.95] w-full
                ${isSelected ? 'bg-amber-500/20 border border-amber-500/40'
                  : isToday  ? 'bg-slate-800/60 border border-amber-500/30'
                             : 'bg-slate-800/60 border border-transparent hover:border-slate-700'}`}>
              <p className={`text-[10px] font-bold ${isSelected ? 'text-amber-400' : 'text-slate-500'}`}>
                {WEEKDAYS[dayNum]}
              </p>
              <p className={`text-sm font-mono font-black ${isSelected ? 'text-amber-400' : 'text-slate-300'}`}>
                {parseInt(date.split('-')[2])}
              </p>
              <p className={`text-[10px] font-bold mt-0.5 ${ds.length ? 'text-amber-400' : 'text-slate-700'}`}>
                {ds.length ? `${ds.length}건` : '·'}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 전날 정산내역(관리자 전용)
//  · 오늘의 수업을 홈에서 바로 보여주듯, 전날 입금·등록 현황을 한눈에.
//  · 집계·분류는 순수 함수 summarizeDailySettlement(=정산 로직과 동일 규칙)에 위임.
const KIND_CLR = {
  new: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  re:  'bg-sky-500/20 text-sky-400 border-sky-500/30',
  etc: 'bg-slate-600/40 text-slate-300 border-slate-600/40',
};

function fmtSettleDate(ymd) {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

// 상세 본문(요약 3분할 + 결제수단 + 건별) — 팝업에서 사용
function SettlementDetail({ s }) {
  if (s.count === 0) {
    return <p className="text-slate-600 text-sm text-center py-4">전날 입금·등록 내역이 없습니다</p>;
  }
  return (
    <>
          {/* 요약 3분할: 신규 / 재등록 / 입금액 합계 */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
              <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wide">신규등록</p>
              <p className="text-2xl font-black font-mono text-emerald-400 mt-0.5">{s.newCnt}<span className="text-xs text-slate-500 ml-0.5">건</span></p>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">{won(s.newAmt)}</p>
            </div>
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3">
              <p className="text-[10px] text-sky-400 font-bold uppercase tracking-wide">재등록</p>
              <p className="text-2xl font-black font-mono text-sky-400 mt-0.5">{s.reCnt}<span className="text-xs text-slate-500 ml-0.5">건</span></p>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">{won(s.reAmt)}</p>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wide">입금액</p>
              <p className="text-2xl font-black font-mono text-amber-400 mt-0.5 tabular-nums leading-tight">{s.total.toLocaleString('ko-KR')}</p>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">총 {s.count}건</p>
            </div>
          </div>

          {/* 결제수단별 합계(있는 것만) */}
          {Object.keys(s.methodAmt).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {Object.entries(s.methodAmt).sort((a, b) => b[1] - a[1]).map(([mk, amt]) => (
                <span key={mk} className="text-[10px] bg-slate-800/70 border border-slate-700 text-slate-300 px-2 py-1 rounded-lg font-semibold">
                  {METHOD_LBL[mk] || mk} {amt.toLocaleString('ko-KR')}
                </span>
              ))}
            </div>
          )}

          {/* 건별 상세 */}
          <div className="space-y-2">
            {s.rows.map(r => (
              <div key={r.id} className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl">
                <span className={`text-[10px] font-black px-2 py-1 rounded-lg border flex-shrink-0 ${KIND_CLR[r.kind]}`}>{r.label}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{r.name}</span>
                    <span className="text-slate-500 text-xs flex-shrink-0">· {METHOD_LBL[r.method] || r.method}</span>
                  </div>
                  {r.note && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{r.note}</p>}
                </div>
                <span className="text-sm font-black font-mono text-slate-200 flex-shrink-0 tabular-nums">{r.amount.toLocaleString('ko-KR')}</span>
              </div>
            ))}
          </div>
    </>
  );
}

// 전날 정산 팝업(관리자 전용) — 홈 진입 시 하루 한 번 자동 표시, 카드에서 다시 열기 가능
function YesterdaySettlementPopup({ s, onClose }) {
  return (
    <div className="modal-overlay z-[60]" onClick={onClose}>
      <div className="modal-box max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400">Daily Brief</p>
          <h2 className="text-xl font-black mt-1">💰 전날 등록·수납 정리</h2>
          <p className="text-xs text-slate-500 mt-1">{fmtSettleDate(s.ymd)} · 오늘 하루 한 번만 표시됩니다</p>
        </div>
        <div className="modal-body px-5 py-4">
          <SettlementDetail s={s} />
        </div>
        <div className="px-5 py-4 border-t border-slate-800">
          <button type="button" onClick={onClose} className="btn btn-primary w-full">확인</button>
        </div>
      </div>
    </div>
  );
}

// 홈 카드: 한 줄 요약 + 탭하면 팝업 재열기
function YesterdaySettlement({ s, onOpen }) {
  const line = settlementOneLine(s);
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left bg-slate-900 border border-slate-800 rounded-2xl p-4
        active:scale-[0.98] hover:border-slate-700 transition-all">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">💰 전날 정산내역</h2>
        <span className="text-[11px] text-slate-500 font-semibold">{fmtSettleDate(s.ymd)}</span>
      </div>
      {line
        ? <p className="text-sm font-semibold text-slate-200">{line}</p>
        : <p className="text-sm text-slate-600">전날 입금·등록 내역이 없습니다</p>}
      <p className="text-[10px] text-slate-600 mt-1">누르면 팝업으로 자세히 보기 →</p>
    </button>
  );
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notices,   setNotices]   = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [members,   setMembers]   = useState([]);
  const [showForm,  setShowForm]  = useState(false);
  const [newNotice, setNewNotice] = useState({ title:'', content:'' });
  const [editId,    setEditId]    = useState(null);
  const [editNotice,setEditNotice]= useState({ title:'', content:'' });

  const [showSettlePopup, setShowSettlePopup] = useState(false);
  // 이번 주 미니 캘린더에서 누른 요일(기본값: 오늘) — '오늘의 수업' 섹션이 이 날짜를 따라간다
  const [selectedDate, setSelectedDate] = useState(() => todayYMD());

  // 고정 공지 우선, 그다음 최신순(createdAt 내림차순).
  //  · 기존엔 isPinned만 정렬해 새 공지가 배열 뒤(오래된 순)에 그대로 쌓였다.
  const refreshNotices = () => setNotices(
    [...store.getNotices()].sort((a, b) =>
      (b.isPinned - a.isPinned) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    )
  );

  useEffect(() => {
    refreshNotices();
    setSchedules(store.getSchedules());
    setMembers(store.getMembers());
  }, []);

  const isAdmin = user?.role === 'admin';

  // 전날 등록·수납 요약(관리자 전용) — 팝업·카드가 같은 집계를 공유
  const ySettle = useMemo(() => (
    isAdmin ? summarizeDailySettlement(members, (mid) => store.getPayments(mid), daysAgoYMD(1)) : null
  ), [isAdmin, members]);

  // 관리자 홈 진입 시 전날 정리 팝업 자동 표시(계정별 하루 한 번, 닫을 때 확인 처리)
  useEffect(() => {
    if (!isAdmin || !user?.id) return;
    const key = yesterdayPopupSeenKey(user.id, todayYMD());
    try { if (key && localStorage.getItem(key) === '1') return; } catch { /* noop */ }
    setShowSettlePopup(true);
  }, [isAdmin, user?.id]);

  const closeSettlePopup = () => {
    const key = yesterdayPopupSeenKey(user?.id, todayYMD());
    try { if (key) localStorage.setItem(key, '1'); } catch { /* noop */ }
    setShowSettlePopup(false);
  };

  const addNotice = async () => {
    if (!newNotice.title.trim()) return;
    try {
      await store.addNotice({ ...newNotice, createdAt:new Date().toISOString(), isPinned:false, authorId:user.id });
      refreshNotices();
      setNewNotice({ title:'', content:'' });
      setShowForm(false);
    } catch (e) { alert('공지 등록에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  const startEdit = (n) => {
    setEditId(n.id);
    setEditNotice({ title:n.title, content:n.content||'' });
    setShowForm(false);
  };

  const saveEdit = async () => {
    if (!editNotice.title.trim()) return;
    try {
      await store.updateNotice(editId, { title:editNotice.title, content:editNotice.content });
      refreshNotices();
      setEditId(null);
    } catch (e) { alert('공지 수정에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  const togglePin = async (n) => {
    try {
      await store.updateNotice(n.id, { isPinned: !n.isPinned });
      refreshNotices();
    } catch (e) { alert('고정 변경에 실패했습니다.'); }
  };

  const removeNotice = async (n) => {
    if (!window.confirm(`"${n.title}" 공지를 삭제할까요?`)) return;
    try {
      await store.deleteNotice(n.id);
      refreshNotices();
      if (editId === n.id) setEditId(null);
    } catch (e) { alert('공지 삭제에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  // 트레이너로 로그인한 경우 본인 ID (관리자/직원은 null → 전체 집계)
  const myTrainerId = user?.role === 'trainer' ? (user.trainerId || user.id) : null;

  // 담당 회원만 추리기: 회원의 trainerSessions 키에 내 트레이너 ID가 있으면 담당
  const myMembers = myTrainerId
    ? members.filter(m => Object.keys(m.trainerSessions||{}).includes(myTrainerId))
    : members;

  const todayStr   = todayYMD(); // CV-A: 로컬 날짜
  // 요약 카드(②)의 '오늘 수업' 숫자는 항상 오늘 기준 (미니 캘린더 선택과 무관)
  const todaySched = schedules.filter(s => s.date === todayStr);
  const myTodayCount = myTrainerId
    ? todaySched.filter(s => s.trainerId === myTrainerId).length
    : todaySched.length;
  // ④ 수업 목록 섹션: 이번 주 미니 캘린더에서 누른 날짜를 '오늘의 수업'과 동일한 형태로 보여준다
  const selectedSched = schedules.filter(s => s.date === selectedDate);
  const sectionTitle  = scheduleSectionTitle(selectedDate, todayStr);
  const oneYearAgo = daysAgoYMD(365);
  const settings = store.getSettings();

  // 세션 부족: 트레이너는 본인 슬롯(내 trainerId)의 잔여만, 관리자/직원은 모든 슬롯 중 하나라도
  const lowSession = myMembers.filter(m => {
    const slots = myTrainerId
      ? [m.trainerSessions?.[myTrainerId]].filter(Boolean)
      : Object.values(m.trainerSessions||{});
    return slots.some(s => s.remaining<=5 && s.remaining>0);
  }).length;

  // 세션 등록분(lot)별 유효기간 요약 — 담당(또는 전체) 회원 전원 계산해 두 카드에서 재사용.
  const myMemberExpirySummaries = myMembers.map(m => ({
    member: m,
    summary: summarizeMemberSessionExpiry(
      buildMemberSessionExpiry({ member: m, payments: store.getPayments(m.id), settings })
    ),
  }));
  // 결제 만료: 월정액은 결제예정일 임박·경과, 세션제는 등록분(10회→3개월/20회→6개월)이
  // 실제로 지났는데 잔여가 남은 경우(이용약관 3항) — services/sessionExpiry.js 공용 계산.
  const expiredCnt = myMembers.filter(m => isMemberExpired(m, store.getPayments(m.id), settings)).length;
  // 만료 임박(담당 트레이너 알림, 요구사항): 아직 만료는 아니지만 설정한 기간(기본 30일)
  // 이내에 세션 유효기간이 끝나는 등록분이 있는 회원 수. 이미 '결제 만료'로 잡힌 회원은
  // 중복 집계하지 않는다(그쪽 카드에서 이미 강조됨).
  const expiringSoonCnt = myMemberExpirySummaries
    .filter(({ summary }) => summary.hasWarning && !summary.hasExpired).length;

  return (
    <div className="space-y-5">
      {/* 타이틀 */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">안녕하세요, {user?.name} 님 👋</h1>
        <p className="text-slate-500 text-sm mt-1">
          {new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}
        </p>
      </div>

      {/* ① 공지사항 — 최상단 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">📌 공지사항</h2>
          {user?.role==='admin' && (
            <button onClick={()=>setShowForm(!showForm)}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors font-semibold">
              + 작성
            </button>
          )}
        </div>
        {showForm && (
          <div className="mb-4 p-3 bg-slate-800 rounded-xl space-y-2 border border-slate-700">
            <input value={newNotice.title} onChange={e=>setNewNotice({...newNotice,title:e.target.value})}
              placeholder="제목"
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"/>
            <textarea value={newNotice.content} onChange={e=>setNewNotice({...newNotice,content:e.target.value})}
              placeholder="내용" rows={3}
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 resize-none"/>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setShowForm(false)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors">취소</button>
              <button onClick={addNotice} className="btn btn-primary btn-sm">등록</button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {notices.length===0
            ? <p className="text-slate-600 text-sm text-center py-4">공지사항이 없습니다</p>
            : notices.map(n=>(
              <div key={n.id} className={`p-3 rounded-xl ${n.isPinned?'bg-amber-500/10 border border-amber-500/20':'bg-slate-800/60'}`}>
                {editId===n.id ? (
                  <div className="space-y-2">
                    <input value={editNotice.title} onChange={e=>setEditNotice({...editNotice,title:e.target.value})}
                      placeholder="제목"
                      className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"/>
                    <textarea value={editNotice.content} onChange={e=>setEditNotice({...editNotice,content:e.target.value})}
                      placeholder="내용" rows={3}
                      className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 resize-none"/>
                    <div className="flex gap-2 justify-end">
                      <button onClick={()=>setEditId(null)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors">취소</button>
                      <button onClick={saveEdit} className="btn btn-primary btn-sm">저장</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        {n.isPinned&&<span className="text-[10px] bg-amber-500 text-slate-950 font-black px-1.5 py-0.5 rounded">📌고정</span>}
                        <span className="font-semibold text-sm">{n.title}</span>
                      </div>
                      {user?.role==='admin' && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={()=>togglePin(n)} title="고정/해제"
                            className="text-[11px] text-slate-400 hover:text-amber-400 transition-colors">{n.isPinned?'고정해제':'고정'}</button>
                          <button onClick={()=>startEdit(n)}
                            className="text-[11px] text-slate-400 hover:text-blue-400 transition-colors">수정</button>
                          <button onClick={()=>removeNotice(n)}
                            className="text-[11px] text-slate-400 hover:text-red-400 transition-colors">삭제</button>
                        </div>
                      )}
                    </div>
                    {n.content&&<p className="text-slate-400 text-xs mt-1.5 whitespace-pre-line leading-relaxed">{n.content}</p>}
                    <p className="text-slate-600 text-[10px] mt-1.5">{fmtDate(n.createdAt)}</p>
                  </>
                )}
              </div>
            ))
          }
        </div>
      </div>

      {/* ② 통계 카드 — 누르면 해당 화면으로 바로 이동 (UX: 한눈에 + 한 번에) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: myTrainerId ? '담당 회원' : '전체 회원', value:myMembers.length, icon:'👥', color:'text-blue-400',   to:'/members'  },
          { label:'오늘 수업', value:myTodayCount,       icon:'📅', color:'text-amber-400',  to:'/schedule' },
          { label:'세션 부족', value:lowSession,         icon:'⚠️', color:'text-orange-400', to:'/members'  },
          { label:'만료 임박', value:expiringSoonCnt,    icon:'⏳', color:'text-yellow-400',  to:'/members'  },
          { label:'결제 만료', value:expiredCnt,         icon:'🔴', color:'text-red-400',    to:'/members'  },
        ].map(s=>(
          <button key={s.label} onClick={()=>navigate(s.to)}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-left
              active:scale-[0.97] hover:border-slate-700 transition-all">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{s.label}</span>
              <span className="text-lg">{s.icon}</span>
            </div>
            <p className={`text-3xl font-black font-mono ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-slate-600 mt-1">누르면 이동 →</p>
          </button>
        ))}
      </div>

      {/* ②-a 세션 유효기간 임박 알림(담당 트레이너용, 이용약관 3항) — 30일 이내(설정 가능) 만료
          예정이면서 아직 소진하지 않은 등록분이 있는 회원을 미리 보여준다. 이미 만료된 회원은
          위 '결제 만료' 카드에서 다루므로 여기서는 제외(중복 알림 방지). */}
      {expiringSoonCnt > 0 && (
        <div className="bg-slate-900 border border-yellow-500/20 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm uppercase tracking-widest text-yellow-400">⏳ 세션 유효기간 임박</h2>
            <span className="text-[11px] text-slate-500 font-semibold">{settings.expiryWarnDays||30}일 이내 만료 예정</span>
          </div>
          <div className="space-y-2">
            {myMemberExpirySummaries
              .filter(({ summary }) => summary.hasWarning && !summary.hasExpired)
              .sort((a,b) => (a.summary.nearest?.daysLeft??999) - (b.summary.nearest?.daysLeft??999))
              .slice(0, 5)
              .map(({ member, summary }) => (
                <button key={member.id} type="button" onClick={()=>navigate('/members')}
                  className="w-full flex items-center justify-between gap-3 p-2.5 bg-slate-800/60 rounded-xl text-left hover:bg-slate-800 transition-colors">
                  <span className="font-semibold text-sm text-slate-100 truncate">{member.name}</span>
                  <span className="text-xs text-yellow-400 font-mono flex-shrink-0">
                    D-{summary.nearest.daysLeft} · 잔여 {summary.nearest.remaining}회 · {summary.nearest.expiresAt}까지
                  </span>
                </button>
              ))}
          </div>
          {expiringSoonCnt > 5 && (
            <p className="text-[11px] text-slate-500 mt-2">외 {expiringSoonCnt - 5}명 더 · 회원 관리에서 전체 확인</p>
          )}
        </div>
      )}

      {/* ②-b 전날 정산내역 — 관리자 전용: 홈 진입 시 팝업으로 정리 표시 + 카드로 재열기 */}
      {isAdmin && ySettle && <YesterdaySettlement s={ySettle} onOpen={()=>setShowSettlePopup(true)}/>}
      {isAdmin && ySettle && showSettlePopup && (
        <YesterdaySettlementPopup s={ySettle} onClose={closeSettlePopup}/>
      )}

      {/* ③ 간이 캘린더 요약 뷰 (원본 spec 요구) — 요일을 누르면 아래 ④ 섹션이 그 날짜로 전환 */}
      <MiniCalendar schedules={schedules} selectedDate={selectedDate} onSelectDate={setSelectedDate}/>

      {/* ④ 선택한 날짜의 수업 — 기본은 오늘, 이번 주 캘린더에서 요일을 누르면 그날 수업으로 전환 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">{sectionTitle}</h2>
          {selectedDate !== todayStr && (
            <button type="button" onClick={()=>setSelectedDate(todayStr)}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors font-semibold">
              오늘로
            </button>
          )}
        </div>
        {selectedSched.length===0
          ? <p className="text-slate-600 text-sm text-center py-4">해당 날짜에 예정된 수업이 없습니다</p>
          : (
            <div className="space-y-2">
              {selectedSched.sort((a,b)=>a.startTime.localeCompare(b.startTime)).map(s=>{
                const isExt = s.isExternal||!s.memberId;
                const name  = isExt?(s.memo||'외부 일정'):s.memberName;
                return (
                  <div key={s.id} className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl">
                    <div className="w-1.5 h-10 rounded-full flex-shrink-0" style={{background:s.trainerColor||'#94a3b8'}}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{name}</span>
                        {isExt&&<span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold">외부</span>}
                        <span className="text-slate-500 text-xs">· {s.trainerName}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{s.startTime}–{s.endTime} · {s.classType}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-lg font-semibold flex-shrink-0 ${STATUS_CLR[s.status]}`}>
                      {STATUS_LBL[s.status]}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        }
      </div>
    </div>
  );
}
