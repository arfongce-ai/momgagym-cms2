// Members.jsx — v5
// ✅ 요구사항1: 잔여 횟수 트레이너별 분리 배지 표시 (총합 금지)
import { useState, useEffect, useCallback } from 'react';
import { store } from '../demoData';
import { todayYMD, daysAgoYMD, isMemberExpired, isMonthlyActive, monthlyDueOf } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import MemberRegister from '../components/members/MemberRegister';
import MemberDetail   from '../components/members/MemberDetail';
import MemberImport   from '../components/members/MemberImport';
import TrainerBadge   from '../components/common/TrainerBadge';
import { downloadCSV } from '../services/finance';
import { sortExpiredLast, getUserTrainerId } from '../utils/memberList';

function getChosung(str) {
  const cs=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  return [...str].map(c=>{const code=c.charCodeAt(0)-0xAC00;return code>=0&&code<=11171?cs[Math.floor(code/588)]:c;}).join('');
}

// CV: 미사용 컴포넌트(SessionBadges) 제거 — 동일 기능이 행 내부에 직접 구현되어 있음

export default function Members() {
  const { user } = useAuth();
  const [members,  setMembers]  = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [search,   setSearch]   = useState('');
  const [phoneFilter, setPhoneFilter]     = useState('');
  const [trainerFilter, setTrainerFilter] = useState('');
  const [lowSession,    setLowSession]    = useState(false);
  const [expiredFilter, setExpiredFilter] = useState(false);
  const [showRegister,  setShowRegister]  = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  const [selected,      setSelected]      = useState(null);

  const load = useCallback(() => {
    setMembers(store.getMembers());
    setTrainers(store.getTrainers());
  }, []);
  useEffect(() => { load(); }, [load]);

  const oneYearAgo = daysAgoYMD(365); // CV-A: 로컬 날짜
  const myTrainerId = getUserTrainerId(user);

  const filtered = members.filter(m => {
    // 트레이너 로그인 시: 본인 담당 회원만 노출 (관리자/직원은 전체)
    if (myTrainerId && !Object.keys(m.trainerSessions||{}).includes(myTrainerId)) return false;
    const cs = getChosung(m.name);
    if (search && !m.name.includes(search) && !cs.includes(search.toUpperCase())) return false;
    if (phoneFilter && !m.phone.replace(/-/g,'').endsWith(phoneFilter.replace(/-/g,''))) return false;
    if (trainerFilter && !Object.keys(m.trainerSessions||{}).includes(trainerFilter)) return false;
    if (lowSession && !Object.values(m.trainerSessions||{}).some(s => s.remaining<=5 && s.remaining>0)) return false;
    if (expiredFilter && !isMemberExpired(m)) return false;
    return true;
  });

  // 가나다 순 정렬 후 결제 만료 회원은 하단으로 모음
  const sorted = sortExpiredLast(filtered);

  const isExpired = m => isMemberExpired(m);

  const trainerMap = Object.fromEntries(trainers.map(t=>[t.id,t.name]));
  const exportMembers = () => {
    const header = ['이름','성별','연락처','연락처2','생년월일','주소','가입일','월정액','다음결제예정일','월회비','최근결제일','담당트레이너/잔여세션','총결제액','수업종류','메모','상태'];
    const body = sorted.map(m=>{
      const sessions = Object.entries(m.trainerSessions||{})
        .map(([tid,s])=>`${trainerMap[tid]||'?'} ${s.remaining}/${s.total}`).join(' | ');
      const totalPaid = (store.getPayments(m.id)||[])
        .filter(p=>!p.isUnpaid && !p.isRefunded).reduce((s,p)=>s+(p.amount||0),0);
      return [
        m.name, m.gender==='male'?'남':m.gender==='female'?'여':'',
        m.phone||'', m.phone2||'', m.birthDate||'', m.address||'',
        m.joinDate||'',
        isMonthlyActive(m)?'월정액':'',
        isMonthlyActive(m)?(monthlyDueOf(m)||''):'',
        isMonthlyActive(m)?(m.monthly?.fee||''):'',
        m.lastPaymentDate||'',
        sessions,
        totalPaid, (m.classTypes||[]).join('/'), m.memo||'',
        isExpired(m)?'결제만료':'정상',
      ];
    });
    downloadCSV(`회원목록_${todayYMD()}.csv`, [header, ...body]);
  };

  const handleZeroSessions = async () => {
    if (!window.confirm('만료 회원의 모든 잔여 세션을 0으로 처리하시겠습니까?')) return;
    try {
      await Promise.all(members.filter(isExpired).map(m => {
        const ts = {};
        Object.entries(m.trainerSessions||{}).forEach(([k,v]) => { ts[k] = {...v, remaining:0}; });
        return store.updateMember(m.id, { trainerSessions: ts });
      }));
      load();
    } catch (e) { alert('일부 회원 처리에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); load(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">회원 관리</h1>
        <div className="flex gap-2">
          {user?.role==='admin' && (
            <button onClick={exportMembers}
              className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/40 hover:text-amber-400 transition-colors">
              📄 다운로드
            </button>
          )}
          {user?.role==='admin' && (
            <button onClick={() => setShowImport(true)}
              className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-blue-500/40 hover:text-blue-400 transition-colors">
              📥 엑셀 가져오기
            </button>
          )}
          <button onClick={() => setShowRegister(true)}
            className="btn btn-primary btn-sm">
            + 신규 등록
          </button>
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름 / 초성 검색"
            className="bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500 col-span-2 md:col-span-1"/>
          <input value={phoneFilter} onChange={e=>setPhoneFilter(e.target.value)} placeholder="연락처 뒷자리"
            className="bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"/>
          <select value={trainerFilter} onChange={e=>setTrainerFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
            <option value="">전체 트레이너</option>
            {trainers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={()=>setLowSession(!lowSession)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${lowSession?'bg-orange-500/20 border-orange-500/40 text-orange-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
              세션≤5
            </button>
            <button onClick={()=>setExpiredFilter(!expiredFilter)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${expiredFilter?'bg-red-500/20 border-red-500/40 text-red-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
              결제만료
            </button>
          </div>
        </div>
        {expiredFilter && user?.role==='admin' && (
          <div className="flex items-center justify-between bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            <span className="text-red-400 text-xs font-semibold">⚠️ {filtered.length}명 결제 만료 회원</span>
            <button onClick={handleZeroSessions}
              className="text-xs bg-red-600 hover:bg-red-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors">
              세션 일괄 0 처리
            </button>
          </div>
        )}
        <p className="text-slate-500 text-xs">{filtered.length}명</p>
      </div>

      {/* 회원 목록 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-slate-600">
            <p className="text-4xl mb-3">👥</p><p className="text-sm">검색 결과가 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {sorted.map(m => {
              const expired = isExpired(m);
              const classes = (m.classTypes||[]).length ? m.classTypes.join(', ') : '수업미지정';
              return (
                <div key={m.id} onClick={() => setSelected(m)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/60 cursor-pointer transition-colors">
                  {/* 아바타 */}
                  <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {m.name[0]}
                  </div>

                  {/* 이름·연락처·수업종류 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold text-sm ${expired ? 'text-red-400' : 'text-slate-100'}`}>
                        {m.name}{expired && ' ⚠️'}
                      </span>
                      {isMonthlyActive(m) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold border border-violet-500/30">월정액</span>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5 truncate">{m.phone} · {classes}</p>
                  </div>

                  {/* 오른쪽: 세션 잔여 배지 + (월정액이면) 다음 결제일 */}
                  <div className="flex-shrink-0 text-right space-y-0.5">
                    {Object.keys(m.trainerSessions||{}).length>0 && (
                      <TrainerBadge trainerSessions={m.trainerSessions} trainers={trainers} compact />
                    )}
                    {isMonthlyActive(m) && (
                      <p className={`text-[11px] font-mono ${expired?'text-red-400':'text-violet-300'}`}>
                        월정액 결제일 {monthlyDueOf(m) || '-'}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showRegister && (
        <MemberRegister trainers={trainers}
          onSuccess={() => { load(); setShowRegister(false); }}
          onCancel={() => setShowRegister(false)} />
      )}
      {showImport && (
        <MemberImport
          onClose={() => setShowImport(false)}
          onDone={() => { load(); setShowImport(false); }} />
      )}
      {selected && (
        <MemberDetail
          member={members.find(m=>m.id===selected.id) || selected}
          trainers={trainers}
          onClose={() => setSelected(null)}
          onUpdate={() => load()} />
      )}
    </div>
  );
}
