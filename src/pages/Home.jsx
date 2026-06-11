// Home.jsx — v5: 공지사항 최상단 + 간이 캘린더 요약 뷰
import { useState, useEffect } from 'react';
import { store } from '../demoData';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toYMD, todayYMD, daysAgoYMD } from '../utils/dates';

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

// 간이 캘린더: 이번 주 7일 미니 뷰
function MiniCalendar({ schedules }) {
  const today = new Date();
  const todayStr = todayYMD(); // CV-A: 로컬 날짜

  // 이번 주 월~일
  const weekDates = Array.from({ length:7 }, (_,i) => {
    const d = new Date(today);
    const day = today.getDay();
    d.setDate(today.getDate() - ((day+6)%7) + i);
    return toYMD(d); // CV-A: 로컬 날짜
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">📅 이번 주</h2>
      <div className="grid grid-cols-7 gap-1">
        {weekDates.map(date => {
          const ds      = schedules.filter(s => s.date === date);
          const isToday = date === todayStr;
          const dayNum  = new Date(date+'T12:00:00').getDay();
          return (
            <div key={date} className={`rounded-xl p-1.5 text-center transition-colors
              ${isToday ? 'bg-amber-500/20 border border-amber-500/40' : 'bg-slate-800/60'}`}>
              <p className={`text-[10px] font-bold ${isToday ? 'text-amber-400' : 'text-slate-500'}`}>
                {WEEKDAYS[dayNum]}
              </p>
              <p className={`text-sm font-mono font-black ${isToday ? 'text-amber-400' : 'text-slate-300'}`}>
                {parseInt(date.split('-')[2])}
              </p>
              <p className={`text-[10px] font-bold mt-0.5 ${ds.length ? 'text-amber-400' : 'text-slate-700'}`}>
                {ds.length ? `${ds.length}건` : '·'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
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

  const refreshNotices = () => setNotices(store.getNotices().sort((a,b) => b.isPinned - a.isPinned));

  useEffect(() => {
    refreshNotices();
    setSchedules(store.getSchedules());
    setMembers(store.getMembers());
  }, []);

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

  const todayStr   = todayYMD(); // CV-A: 로컬 날짜
  const todaySched = schedules.filter(s => s.date === todayStr);
  const oneYearAgo = daysAgoYMD(365);
  const lowSession  = members.filter(m => Object.values(m.trainerSessions||{}).some(s=>s.remaining<=5&&s.remaining>0)).length;
  const expiredCnt  = members.filter(m => m.lastPaymentDate && m.lastPaymentDate < oneYearAgo).length;

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:'전체 회원', value:members.length,    icon:'👥', color:'text-blue-400',   to:'/members'  },
          { label:'오늘 수업', value:todaySched.length,  icon:'📅', color:'text-amber-400',  to:'/schedule' },
          { label:'세션 부족', value:lowSession,         icon:'⚠️', color:'text-orange-400', to:'/members'  },
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

      {/* ③ 간이 캘린더 요약 뷰 (원본 spec 요구) */}
      <MiniCalendar schedules={schedules}/>

      {/* ④ 오늘의 수업 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">오늘의 수업</h2>
        {todaySched.length===0
          ? <p className="text-slate-600 text-sm text-center py-4">오늘 예정된 수업이 없습니다</p>
          : (
            <div className="space-y-2">
              {todaySched.sort((a,b)=>a.startTime.localeCompare(b.startTime)).map(s=>{
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
