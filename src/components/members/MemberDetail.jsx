// MemberDetail.jsx — v5
// ✅ 수납 관리 탭 (결제일·금액·수단·미수금)
// ✅ 신체정보 탭 (체중·체지방·근육량 누적)
// ✅ 기본정보 수정 + 세션 재등록
// ✅ 트레이너별 세션 개별 카드
import { useState, useEffect } from 'react';
import { store } from '../../demoData';
import { useAuth } from '../../contexts/AuthContext';
import { ClassTypeCheckbox } from './MemberRegister';
import AiMeasureReport     from '../ai/AiMeasureReport';
import MemberMeasureHistory from '../ai/MemberMeasureHistory';
import { METHOD_LBL, METHOD_CLR } from '../../services/finance';

const INP = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500";
const LBL = "block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5";

export default function MemberDetail({ member:initMember, trainers, onClose, onUpdate }) {
  const { user } = useAuth();
  const [tab, setTab]       = useState('info');
  const [member, setMember] = useState(initMember);
  const [editMode, setEdit] = useState(false);
  const [editForm, setEF]   = useState({ ...initMember });

  // 세션 추가
  const [showAddSess,   setShowAddSess]   = useState(false);
  const [addTrainerId,  setAddTrainerId]  = useState('');
  const [addClassType,  setAddClassType]  = useState('');
  const [addCount,      setAddCount]      = useState(10);
  const [addSessDate,   setAddSessDate]   = useState(new Date().toISOString().slice(0,10));
  // 세션 직접 조정
  const [adjustTid,     setAdjustTid]     = useState(null);
  const [adjustForm,    setAdjustForm]    = useState({ remaining:0, total:0 });

  // 수납
  const [payments,     setPayments]    = useState([]);
  const [showAddPay,   setShowAddPay]  = useState(false);
  const [payForm,      setPayForm]     = useState({ paidAt: new Date().toISOString().slice(0,10), amount:'', method:'pay', isUnpaid:false, note:'', trainerIds:[], isReEnroll:false, isNew:false, category:'normal' });

  // 신체정보
  const [bodyRecords,  setBodyRecords] = useState([]);
  const [showAddBody,  setShowAddBody] = useState(false);
  const [showAiModal,  setShowAiModal]  = useState(false);
  const [aiRefreshKey, setAiRefreshKey] = useState(0);
  const [bodyForm,     setBodyForm]    = useState({ recordedAt: new Date().toISOString().slice(0,10), height:'', weight:'', systolic:'', diastolic:'', note:'' });

  const refresh = () => {
    const fresh = store.getMembers().find(m => m.id === member.id);
    if (fresh) setMember(fresh);
    setPayments(store.getPayments(member.id));
    setBodyRecords(store.getBodyRecords(member.id));
  };
  useEffect(() => { refresh(); }, []);

  const trainerMap  = Object.fromEntries(trainers.map(t => [t.id, t]));
  const sessions    = Object.entries(member.trainerSessions || {});
  const addTrainerCT = trainerMap[addTrainerId]?.classTypes || [];

  // ── 기본정보 저장 ─────────────────────────────────────
  const saveEdit = async () => {
    try {
      await store.updateMember(member.id, {
        name:editForm.name, phone:editForm.phone, phone2:editForm.phone2||'',
        birthDate:editForm.birthDate||'', joinDate:editForm.joinDate||'',
        lastPaymentDate:editForm.lastPaymentDate||'',
        classTypes:editForm.classTypes||[], memo:editForm.memo||'',
      });
      refresh(); setEdit(false); onUpdate?.();
    } catch (e) { alert('저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  // ── 세션 재등록 ───────────────────────────────────────
  const handleAddSession = async () => {
    if (!addTrainerId) { alert('트레이너를 선택해 주세요.'); return; }
    if (!addCount || addCount<1) { alert('세션 수를 입력해 주세요.'); return; }
    const fresh = store.getMembers().find(m=>m.id===member.id);
    const ts    = JSON.parse(JSON.stringify(fresh?.trainerSessions||{}));
    if (ts[addTrainerId]) {
      ts[addTrainerId].total     += Number(addCount);
      ts[addTrainerId].remaining += Number(addCount);
    } else {
      ts[addTrainerId] = { total:Number(addCount), remaining:Number(addCount) };
    }
    const curCT    = fresh?.classTypes||[];
    const upCT     = addClassType&&!curCT.includes(addClassType) ? [...curCT,addClassType] : curCT;
    try {
      await store.updateMember(member.id, { trainerSessions:ts, classTypes:upCT, lastPaymentDate:addSessDate });
      refresh(); setShowAddSess(false);
      setAddTrainerId(''); setAddClassType(''); setAddCount(10);
      setAddSessDate(new Date().toISOString().slice(0,10));
      onUpdate?.();
    } catch (e) { alert('세션 등록에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  // ── 세션 직접 조정 / 복구 ─────────────────────────────
  const startAdjust = (tid, s) => { setAdjustTid(tid); setAdjustForm({ remaining:s.remaining, total:s.total }); };
  const saveAdjust = async (tid) => {
    const remaining = Number(adjustForm.remaining), total = Number(adjustForm.total);
    if (isNaN(remaining) || isNaN(total) || remaining<0 || total<0) { alert('0 이상의 숫자를 입력해 주세요.'); return; }
    if (remaining > total) { alert('잔여 횟수는 총 횟수보다 클 수 없습니다.'); return; }
    const fresh = store.getMembers().find(m=>m.id===member.id);
    const ts = JSON.parse(JSON.stringify(fresh?.trainerSessions||{}));
    ts[tid] = { total, remaining };
    try { await store.updateMember(member.id, { trainerSessions:ts }); refresh(); setAdjustTid(null); onUpdate?.(); }
    catch(e){ alert('수정에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };
  // 차감 복구: 잔여 +1 (총 횟수 한도 내)
  const restoreOne = async (tid) => {
    const fresh = store.getMembers().find(m=>m.id===member.id);
    const ts = JSON.parse(JSON.stringify(fresh?.trainerSessions||{}));
    if (!ts[tid]) return;
    if (ts[tid].remaining >= ts[tid].total) { alert('잔여 횟수가 이미 총 횟수와 같습니다.'); return; }
    ts[tid].remaining += 1;
    try { await store.updateMember(member.id, { trainerSessions:ts }); refresh(); onUpdate?.(); }
    catch(e){ alert('복구에 실패했습니다.'); }
  };
  // 1회 차감
  const deductOne = async (tid) => {
    const fresh = store.getMembers().find(m=>m.id===member.id);
    const ts = JSON.parse(JSON.stringify(fresh?.trainerSessions||{}));
    if (!ts[tid] || ts[tid].remaining<=0) { alert('잔여 횟수가 없습니다.'); return; }
    ts[tid].remaining -= 1;
    try { await store.updateMember(member.id, { trainerSessions:ts }); refresh(); onUpdate?.(); }
    catch(e){ alert('차감에 실패했습니다.'); }
  };
  // 트레이너 세션 카드 삭제
  const removeSession = async (tid) => {
    if (!window.confirm(`${trainerMap[tid]?.name||tid} 세션 정보를 삭제할까요?`)) return;
    const fresh = store.getMembers().find(m=>m.id===member.id);
    const ts = JSON.parse(JSON.stringify(fresh?.trainerSessions||{}));
    delete ts[tid];
    try { await store.updateMember(member.id, { trainerSessions:ts }); refresh(); onUpdate?.(); }
    catch(e){ alert('삭제에 실패했습니다.'); }
  };

  // ── 수납 등록 ─────────────────────────────────────────
  const handleAddPayment = async () => {
    if (!payForm.amount) { alert('금액을 입력해 주세요.'); return; }
    try {
      await store.addPayment(member.id, { ...payForm, amount:Number(payForm.amount) });
      // 결제일 자동 업데이트
      await store.updateMember(member.id, { lastPaymentDate:payForm.paidAt });
      refresh(); setShowAddPay(false);
      setPayForm({ paidAt:new Date().toISOString().slice(0,10), amount:'', method:'pay', isUnpaid:false, note:'', trainerIds:[], isReEnroll:false, isNew:false, category:'normal' });
      onUpdate?.();
    } catch (e) { alert('수납 등록에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  const handleDeletePayment = async pid => {
    if (!window.confirm('이 수납 기록을 삭제하시겠습니까?')) return;
    try { await store.deletePayment(member.id, pid); refresh(); }
    catch (e) { alert('삭제에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  // ── 신체정보 등록 ─────────────────────────────────────
  const handleAddBody = async () => {
    if (!bodyForm.weight) { alert('체중을 입력해 주세요.'); return; }
    try {
      await store.addBodyRecord(member.id, {
        ...bodyForm,
        height:    bodyForm.height    ? Number(bodyForm.height)    : null,
        weight:    Number(bodyForm.weight),
        systolic:  bodyForm.systolic  ? Number(bodyForm.systolic)  : null,
        diastolic: bodyForm.diastolic ? Number(bodyForm.diastolic) : null,
      });
      refresh(); setShowAddBody(false);
      setBodyForm({ recordedAt:new Date().toISOString().slice(0,10), height:'', weight:'', systolic:'', diastolic:'', note:'' });
    } catch (e) { alert('신체정보 저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  const handleDeleteBody = async rid => {
    if (!window.confirm('이 기록을 삭제하시겠습니까?')) return;
    try { await store.deleteBodyRecord(member.id, rid); refresh(); }
    catch (e) { alert('삭제에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  // ── 회원 삭제 ─────────────────────────────────────────
  const handleDelete = async () => {
    if (!window.confirm(`${member.name} 회원을 삭제하시겠습니까?\n관련 스케줄, 수납, 신체정보, AI 측정기록도 함께 삭제됩니다.`)) return;
    try {
      await store.purgeMember(member.id);   // 스케줄·수납·신체·AI·회원 원자적 삭제
      onUpdate?.(); onClose();
    } catch (e) {
      console.error('[회원 삭제 실패]', e);
      alert('삭제에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.\n(데이터는 삭제되지 않았습니다.)');
    }
  };

  const pfe = f => e => setEF(p=>({...p,[f]:e.target.value}));
  const ppf = f => e => setPayForm(p=>({...p,[f]:e.target.value}));
  const pbf = f => e => setBodyForm(p=>({...p,[f]:e.target.value}));

  const TABS = [['info','기본정보'],['sessions','세션'],['payments','수납'],['body','신체정보'],['ai','측정이력'],['memo','메모']];

  return (
    <div className="modal-overlay">
      <div className="modal-box">

        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg flex-shrink-0">
            {member.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold">{member.name}</h2>
            <p className="text-slate-500 text-xs">{member.phone}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl leading-none p-1 flex-shrink-0">×</button>
        </div>

        {/* 탭 — 5개 */}
        <div className="flex border-b border-slate-800 flex-shrink-0 overflow-x-auto">
          {TABS.map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)}
              className={`flex-none px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap transition-colors
                ${tab===t?'text-amber-400 border-b-2 border-amber-400':'text-slate-500 hover:text-slate-300'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="modal-body p-5">

          {/* ━━ 기본정보 탭 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {tab==='info' && (
            !editMode ? (
              <div className="space-y-1">
                {[
                  {l:'이름',       v:member.name},
                  {l:'연락처',     v:member.phone},
                  {l:'연락처 2',   v:member.phone2||'미등록'},
                  {l:'생년월일',   v:member.birthDate||'미등록'},
                  {l:'가입일',     v:member.joinDate||'미등록'},
                  {l:'최근결제일', v:member.lastPaymentDate||'미등록'},
                  {l:'최근출석일', v:member.lastAttendedDate||'미출석'},
                  {l:'수업종류',   v:(member.classTypes||[]).length?member.classTypes.join(', '):'미등록'},
                ].map(row=>(
                  <div key={row.l} className="flex items-center justify-between py-2 border-b border-slate-800">
                    <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold w-24 flex-shrink-0">{row.l}</span>
                    <span className="text-sm font-medium text-right break-all">{row.v}</span>
                  </div>
                ))}
                {member.memo&&(
                  <div className="py-3 border-b border-slate-800">
                    <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold block mb-1">메모</span>
                    <p className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">{member.memo}</p>
                  </div>
                )}
                <div className="flex gap-2 pt-4">
                  <button onClick={()=>{setEF({...member});setEdit(true);}}
                    className="flex-1 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-sm font-semibold transition-colors">
                    ✏️ 정보 수정
                  </button>
                  {user?.role==='admin'&&(
                    <button onClick={handleDelete}
                      className="py-2.5 px-4 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-semibold transition-colors">삭제</button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-amber-400 font-semibold uppercase tracking-widest">✏️ 정보 수정 중</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={LBL}>이름</label><input value={editForm.name||''} onChange={pfe('name')} className={INP}/></div>
                  <div><label className={LBL}>연락처</label><input value={editForm.phone||''} onChange={pfe('phone')} className={INP}/></div>
                </div>
                <div><label className={LBL}>연락처 2 (보호자·비상)</label><input value={editForm.phone2||''} onChange={pfe('phone2')} className={INP}/></div>
                <div><label className={LBL}>생년월일</label><input type="date" value={editForm.birthDate||''} onChange={pfe('birthDate')} className={INP}/></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={LBL}>가입일</label><input type="date" value={editForm.joinDate||''} onChange={pfe('joinDate')} className={INP}/></div>
                  <div><label className={LBL}>최근결제일</label><input type="date" value={editForm.lastPaymentDate||''} onChange={pfe('lastPaymentDate')} className={INP}/></div>
                </div>
                <ClassTypeCheckbox selected={editForm.classTypes||[]} onChange={v=>setEF(f=>({...f,classTypes:v}))}/>
                <div><label className={LBL}>메모</label><textarea rows={2} value={editForm.memo||''} onChange={pfe('memo')} className={INP+" resize-none"}/></div>
                <div className="flex gap-2">
                  <button onClick={()=>setEdit(false)} className="py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">취소</button>
                  <button onClick={saveEdit} className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">저장</button>
                </div>
              </div>
            )
          )}

          {/* ━━ 세션 탭 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {tab==='sessions' && (
            <div className="space-y-4">
              {sessions.length===0
                ? <p className="text-slate-600 text-sm text-center py-6">등록된 세션이 없습니다</p>
                : sessions.map(([tid,s])=>{
                  const t   = trainerMap[tid];
                  const pct = s.total>0?(s.remaining/s.total)*100:0;
                  const bar = pct>30?'#10b981':pct>0?'#f59e0b':'#ef4444';
                  const txt = pct>30?'text-emerald-400':pct>0?'text-amber-400':'text-red-400';
                  return (
                    <div key={tid} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{background:t?.color||'#94a3b8'}}/>
                          <span className="font-bold text-sm">{t?.name||tid}</span>
                        </div>
                        <div className="text-right">
                          <span className={`font-mono font-black text-lg ${txt}`}>{s.remaining}</span>
                          <span className="text-slate-500 text-xs"> / {s.total}회</span>
                        </div>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
                        <div className="h-full rounded-full transition-all duration-700" style={{width:`${pct}%`,background:bar}}/>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>잔여 <strong className={txt}>{s.remaining}회</strong></span>
                        <span>사용 <strong className="text-slate-400">{s.total-s.remaining}회</strong></span>
                        <span>등록 <strong className="text-slate-400">{s.total}회</strong></span>
                      </div>
                      {s.remaining===0&&<div className="mt-2 text-center text-[10px] bg-red-500/10 border border-red-500/20 rounded-lg py-1 text-red-400 font-bold">⚠️ 세션 소진</div>}
                      {s.remaining>0&&s.remaining<=5&&<div className="mt-2 text-center text-[10px] bg-orange-500/10 border border-orange-500/20 rounded-lg py-1 text-orange-400 font-bold">⚡ 잔여 {s.remaining}회</div>}
                      {user?.role==='admin' && (
                        adjustTid===tid ? (
                          <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-500">잔여</label>
                                <input type="number" min="0" value={adjustForm.remaining}
                                  onChange={e=>setAdjustForm(f=>({...f,remaining:e.target.value}))}
                                  className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-2 py-1.5 text-sm font-mono"/>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500">총 등록</label>
                                <input type="number" min="0" value={adjustForm.total}
                                  onChange={e=>setAdjustForm(f=>({...f,total:e.target.value}))}
                                  className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-2 py-1.5 text-sm font-mono"/>
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button onClick={()=>setAdjustTid(null)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5">취소</button>
                              <button onClick={()=>saveAdjust(tid)} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs">저장</button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 pt-3 border-t border-slate-700 flex items-center gap-1.5 flex-wrap">
                            <button onClick={()=>deductOne(tid)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-700 text-slate-200 hover:bg-red-500/20 hover:text-red-400 transition-colors">−1 차감</button>
                            <button onClick={()=>restoreOne(tid)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-700 text-slate-200 hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors">+1 복구</button>
                            <button onClick={()=>startAdjust(tid, s)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-700 text-slate-200 hover:bg-blue-500/20 hover:text-blue-400 transition-colors">직접 수정</button>
                            <button onClick={()=>removeSession(tid)} className="ml-auto px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-red-400 transition-colors">삭제</button>
                          </div>
                        )
                      )}
                    </div>
                  );
                })
              }
              {!showAddSess ? (
                <button onClick={()=>setShowAddSess(true)}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-slate-700 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 text-sm font-semibold transition-colors">
                  + 세션 재등록 / 추가
                </button>
              ) : (
                <div className="bg-slate-800 border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-amber-400 font-bold uppercase tracking-widest">세션 재등록</p>
                  <div>
                    <label className={LBL}>담당 트레이너</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {trainers.map(t=>{
                        const ex=(member.trainerSessions||{})[t.id];
                        return (
                          <div key={t.id} onClick={()=>{setAddTrainerId(t.id);setAddClassType('');}}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors select-none
                              ${addTrainerId===t.id?'border-amber-500/50 bg-amber-500/10 text-amber-300':'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:t.color}}/>
                            <span className="text-xs font-semibold truncate">{t.name}</span>
                            {ex&&<span className="text-[10px] text-slate-500 ml-auto">잔여{ex.remaining}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {addTrainerId&&(
                    <div>
                      <label className={LBL}>수업 종류 (선택)</label>
                      <select value={addClassType} onChange={e=>setAddClassType(e.target.value)} className={INP}>
                        <option value="">선택 안 함</option>
                        {addTrainerCT.map(ct=><option key={ct} value={ct}>{ct}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={LBL}>추가 세션 수</label><input type="number" min="1" max="300" value={addCount} onChange={e=>setAddCount(Number(e.target.value))} className={INP+" font-mono"}/></div>
                    <div><label className={LBL}>결제일 / 첫 수업일</label><input type="date" value={addSessDate} onChange={e=>setAddSessDate(e.target.value)} className={INP}/></div>
                  </div>
                  {addTrainerId&&(
                    <div className="bg-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-400">
                      <span className="text-slate-300 font-semibold">{trainerMap[addTrainerId]?.name}</span>에게{' '}
                      <span className="text-amber-400 font-bold">{addCount}회</span> 추가 → 잔여{' '}
                      <span className="text-amber-400 font-bold">{((member.trainerSessions||{})[addTrainerId]?.remaining||0)+addCount}회</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={()=>{setShowAddSess(false);setAddTrainerId('');}} className="py-2 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">취소</button>
                    <button onClick={handleAddSession} className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-xl text-sm transition-colors">등록</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ━━ 수납 탭 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {tab==='payments' && (
            <div className="space-y-4">
              {/* 미수금 경보 */}
              {payments.some(p=>p.isUnpaid)&&(
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="text-red-400 font-bold text-sm">⚠️ 미수금</span>
                  <span className="text-red-400 text-xs">
                    {payments.filter(p=>p.isUnpaid).reduce((a,p)=>a+p.amount,0).toLocaleString()}원
                  </span>
                </div>
              )}

              {/* 수납 목록 */}
              {payments.length===0
                ? <p className="text-slate-600 text-sm text-center py-6">수납 기록이 없습니다</p>
                : [...payments].sort((a,b)=>b.paidAt.localeCompare(a.paidAt)).map(p=>(
                  <div key={p.id} className={`bg-slate-800 rounded-xl p-3 border ${p.isUnpaid?'border-red-500/30':'border-slate-700'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-base text-slate-100">
                            {p.amount.toLocaleString()}원
                          </span>
                          <span className={`text-xs font-bold ${METHOD_CLR[p.method]}`}>{METHOD_LBL[p.method]}</span>
                          {p.isUnpaid&&<span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold">미수금</span>}
                          {p.isNew&&<span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold">신규</span>}
                          {p.isReEnroll&&<span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded font-bold">재등록</span>}
                          {p.category==='edu_center'&&<span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">센터교육</span>}
                          {p.category==='edu_external'&&<span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">외부활동</span>}
                        </div>
                        <p className="text-slate-500 text-xs mt-0.5">{p.paidAt}</p>
                        {p.trainerIds?.length>0 && (
                          <p className="text-slate-400 text-xs mt-1">
                            담당: {p.trainerIds.map(id=>trainerMap[id]?.name||'?').join(', ')}
                          </p>
                        )}
                        {p.note&&<p className="text-slate-400 text-xs mt-1">{p.note}</p>}
                      </div>
                      {user?.role==='admin'&&(
                        <button onClick={()=>handleDeletePayment(p.id)}
                          className="text-slate-600 hover:text-red-400 text-xs transition-colors flex-shrink-0">🗑</button>
                      )}
                    </div>
                  </div>
                ))
              }

              {/* 수납 등록 폼 */}
              {!showAddPay ? (
                <button onClick={()=>setShowAddPay(true)}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-slate-700 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 text-sm font-semibold transition-colors">
                  + 수납 등록
                </button>
              ) : (
                <div className="bg-slate-800 border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-amber-400 font-bold uppercase tracking-widest">수납 등록</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={LBL}>결제일</label><input type="date" value={payForm.paidAt} onChange={ppf('paidAt')} className={INP}/></div>
                    <div><label className={LBL}>금액 (원)</label><input type="number" min="0" value={payForm.amount} onChange={ppf('amount')} placeholder="500000" className={INP+" font-mono"}/></div>
                  </div>
                  <div>
                    <label className={LBL}>결제 수단</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[['pay','페이'],['transfer','계좌'],['cash','현금'],['cash_receipt','현금영수증'],['card1','카드1'],['card2','카드2']].map(([v,l])=>(
                        <div key={v} onClick={()=>setPayForm(p=>({...p,method:v}))}
                          className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer text-center transition-colors select-none
                            ${payForm.method===v?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                          {l}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={LBL}>담당 트레이너 (다중 선택 가능 · 1/n 정산)</label>
                    <div className="flex flex-wrap gap-2">
                      {trainers.map(t=>{
                        const on = payForm.trainerIds.includes(t.id);
                        return (
                          <div key={t.id} onClick={()=>setPayForm(p=>({...p,
                            trainerIds: on ? p.trainerIds.filter(id=>id!==t.id) : [...p.trainerIds, t.id]}))}
                            className={`px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors select-none flex items-center gap-1.5
                              ${on?'border-amber-500/40 bg-amber-500/10 text-amber-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                            <span className="w-2 h-2 rounded-full" style={{background:t.color||'#94a3b8'}}/>
                            {t.name}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className={LBL}>매출 구분</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[['normal','일반 수업'],['edu_center','센터교육'],['edu_external','외부활동']].map(([v,l])=>(
                        <div key={v} onClick={()=>setPayForm(p=>({...p,category:v}))}
                          className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer text-center transition-colors select-none
                            ${payForm.category===v?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                          {l}
                        </div>
                      ))}
                    </div>
                    {payForm.category!=='normal' &&
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        {payForm.category==='edu_center'?'센터 내 교육 — 트레이너 90% 지급':'외부 활동 — 트레이너 100% 지급'}
                      </p>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div onClick={()=>setPayForm(p=>({...p,isUnpaid:!p.isUnpaid}))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors select-none
                        ${payForm.isUnpaid?'border-red-500/40 bg-red-500/10 text-red-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${payForm.isUnpaid?'bg-red-500 border-red-500':'border-slate-600 bg-slate-800'}`}>
                        {payForm.isUnpaid&&<svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      <span className="text-xs font-semibold">미수금</span>
                    </div>
                    <div onClick={()=>setPayForm(p=>({...p,isNew:!p.isNew, isReEnroll:false}))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors select-none
                        ${payForm.isNew?'border-emerald-500/40 bg-emerald-500/10 text-emerald-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${payForm.isNew?'bg-emerald-500 border-emerald-500':'border-slate-600 bg-slate-800'}`}>
                        {payForm.isNew&&<svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      <span className="text-xs font-semibold">신규등록</span>
                    </div>
                    <div onClick={()=>setPayForm(p=>({...p,isReEnroll:!p.isReEnroll, isNew:false}))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors select-none
                        ${payForm.isReEnroll?'border-blue-500/40 bg-blue-500/10 text-blue-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${payForm.isReEnroll?'bg-blue-500 border-blue-500':'border-slate-600 bg-slate-800'}`}>
                        {payForm.isReEnroll&&<svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      <span className="text-xs font-semibold">재등록</span>
                    </div>
                  </div>
                  <div><label className={LBL}>메모</label><input value={payForm.note} onChange={ppf('note')} placeholder="PT 10회 등록" className={INP}/></div>
                  <div className="flex gap-2">
                    <button onClick={()=>setShowAddPay(false)} className="py-2 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">취소</button>
                    <button onClick={handleAddPayment} className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-xl text-sm transition-colors">등록</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ━━ 신체정보 탭 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {tab==='body' && (
            <div className="space-y-4">
              {bodyRecords.length===0
                ? <p className="text-slate-600 text-sm text-center py-6">신체정보 기록이 없습니다</p>
                : [...bodyRecords].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).map((r,idx)=>(
                  <div key={r.id} className={`bg-slate-800 rounded-xl p-3 border ${idx===0?'border-amber-500/30':'border-slate-700'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-slate-400 font-semibold">{r.recordedAt}</span>
                          {idx===0&&<span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">최신</span>}
                          {r.note&&<span className="text-xs text-slate-500">{r.note}</span>}
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="text-center bg-slate-700/50 rounded-lg p-2">
                            <p className="text-[10px] text-slate-500 mb-0.5">신장</p>
                            <p className="font-mono font-black text-sm text-slate-100">{r.height??'-'}<span className="text-slate-500 text-[10px]">cm</span></p>
                          </div>
                          <div className="text-center bg-slate-700/50 rounded-lg p-2">
                            <p className="text-[10px] text-slate-500 mb-0.5">체중</p>
                            <p className="font-mono font-black text-sm text-slate-100">{r.weight}<span className="text-slate-500 text-[10px]">kg</span></p>
                          </div>
                          <div className="text-center bg-slate-700/50 rounded-lg p-2">
                            <p className="text-[10px] text-slate-500 mb-0.5">최고혈압</p>
                            <p className="font-mono font-black text-sm text-orange-400">{r.systolic??'-'}<span className="text-slate-500 text-[10px]">mmHg</span></p>
                          </div>
                          <div className="text-center bg-slate-700/50 rounded-lg p-2">
                            <p className="text-[10px] text-slate-500 mb-0.5">최저혈압</p>
                            <p className="font-mono font-black text-sm text-blue-400">{r.diastolic??'-'}<span className="text-slate-500 text-[10px]">mmHg</span></p>
                          </div>
                        </div>
                      </div>
                      {user?.role==='admin'&&(
                        <button onClick={()=>handleDeleteBody(r.id)} className="text-slate-600 hover:text-red-400 text-xs ml-2 flex-shrink-0 transition-colors">🗑</button>
                      )}
                    </div>
                  </div>
                ))
              }
              {!showAddBody ? (
                <button onClick={()=>setShowAddBody(true)}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-slate-700 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 text-sm font-semibold transition-colors">
                  + 신체정보 등록
                </button>
              ) : (
                <div className="bg-slate-800 border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-amber-400 font-bold uppercase tracking-widest">신체정보 등록</p>
                  <div><label className={LBL}>측정일</label><input type="date" value={bodyForm.recordedAt} onChange={pbf('recordedAt')} className={INP}/></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={LBL}>신장(cm)</label><input type="number" step="0.1" value={bodyForm.height} onChange={pbf('height')} placeholder="175.0" className={INP+" font-mono"}/></div>
                    <div><label className={LBL}>체중(kg)</label><input type="number" step="0.1" value={bodyForm.weight} onChange={pbf('weight')} placeholder="70.0" className={INP+" font-mono"}/></div>
                    <div><label className={LBL}>최고혈압(mmHg)</label><input type="number" step="1" value={bodyForm.systolic} onChange={pbf('systolic')} placeholder="120" className={INP+" font-mono"}/></div>
                    <div><label className={LBL}>최저혈압(mmHg)</label><input type="number" step="1" value={bodyForm.diastolic} onChange={pbf('diastolic')} placeholder="80" className={INP+" font-mono"}/></div>
                  </div>
                  <div><label className={LBL}>메모</label><input value={bodyForm.note} onChange={pbf('note')} placeholder="최초 측정" className={INP}/></div>
                  <div className="flex gap-2">
                    <button onClick={()=>setShowAddBody(false)} className="py-2 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">취소</button>
                    <button onClick={handleAddBody} className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-xl text-sm transition-colors">등록</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ━━ 측정이력 탭 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {tab==='ai' && (
            <div>
              <MemberMeasureHistory
                key={aiRefreshKey}
                member={member}
                onNewMeasure={() => setShowAiModal(true)}
              />
            </div>
          )}

          {/* ━━ 메모 탭 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {tab==='memo' && (
            <MemoTab member={member} onSave={memo=>{store.updateMember(member.id,{memo});refresh();onUpdate?.();}}/>
          )}
        </div>

        {/* AI 측정 모달 */}
        {showAiModal && (
          <AiMeasureReport
            member={member}
            onClose={() => setShowAiModal(false)}
            onSaved={() => { setAiRefreshKey(k => k+1); setShowAiModal(false); refresh(); }}
          />
        )}
      </div>
    </div>
  );
}

function MemoTab({ member, onSave }) {
  const [editing, setEditing] = useState(false);
  const [memo, setMemo]       = useState(member.memo||'');
  return editing ? (
    <div className="space-y-3">
      <textarea rows={8} value={memo} onChange={e=>setMemo(e.target.value)}
        className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-amber-500"/>
      <div className="flex gap-2">
        <button onClick={()=>{setMemo(member.memo||'');setEditing(false);}} className="py-2 px-4 rounded-xl border border-slate-700 text-slate-300 text-sm font-semibold hover:text-white transition-colors">취소</button>
        <button onClick={()=>{onSave(memo);setEditing(false);}} className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-xl text-sm transition-colors">저장</button>
      </div>
    </div>
  ) : (
    <div className="bg-slate-800 rounded-xl p-4 min-h-36">
      <p className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">{memo||<span className="text-slate-600">메모가 없습니다</span>}</p>
      <button onClick={()=>setEditing(true)} className="mt-4 text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors">✏️ 메모 편집</button>
    </div>
  );
}
