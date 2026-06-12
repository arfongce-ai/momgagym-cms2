// Trainers.jsx — v4
// ✅ ClassTypeCheckbox onClick 버그 수정
// ✅ 색상 선착순 자동 배정
// ✅ 이미 사용 중인 색상 선택 불가 (복수 선택 방지)
import { useState, useEffect } from 'react';
import { todayYMD } from '../utils/dates';
import { store } from '../demoData';
import { useAuth } from '../contexts/AuthContext';
import { downloadCSV } from '../services/finance';

const TRAINER_CLASS_TYPES = ['6대체력','다이어트','선수','재활','노인','외부','임산부','장애인','기저질환','컨디셔닝'];

const COLOR_PALETTE = [
  {hex:'#f59e0b',name:'앰버'},    {hex:'#f97316',name:'오렌지'},  {hex:'#ef4444',name:'레드'},
  {hex:'#f43f5e',name:'로즈'},    {hex:'#ec4899',name:'핑크'},    {hex:'#d946ef',name:'퍼플'},
  {hex:'#a855f7',name:'바이올렛'},{hex:'#8b5cf6',name:'인디고'},  {hex:'#6366f1',name:'블루인디고'},
  {hex:'#3b82f6',name:'블루'},    {hex:'#06b6d4',name:'시안'},    {hex:'#14b8a6',name:'틸'},
  {hex:'#10b981',name:'에메랄드'},{hex:'#22c55e',name:'그린'},    {hex:'#84cc16',name:'라임'},
  {hex:'#eab308',name:'옐로우'}, {hex:'#78716c',name:'스톤'},    {hex:'#64748b',name:'슬레이트'},
  {hex:'#0ea5e9',name:'스카이'}, {hex:'#c084fc',name:'라벤더'},
];

const STATUSES     = {full:'정규', freelance:'프리랜서', resigned:'퇴직'};
const STATUS_STYLE = {full:'bg-emerald-500/20 text-emerald-400', freelance:'bg-amber-500/20 text-amber-400', resigned:'bg-slate-700 text-slate-400'};

const INP = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500";
const LBL = "block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5";

// ── ClassTypeCheckbox (onClick 버그 수정) ──────────────────
function ClassTypeCheckbox({ selected=[], onChange }) {
  const toggle = ct => onChange(selected.includes(ct) ? selected.filter(c=>c!==ct) : [...selected, ct]);
  return (
    <div>
      <label className={LBL}>수업 가능 종류 (복수 선택)</label>
      <div className="grid grid-cols-2 gap-1.5">
        {TRAINER_CLASS_TYPES.map(ct => {
          const on = selected.includes(ct);
          return (
            // ★ onClick 추가 — 핵심 버그 수정
            <div key={ct} onClick={() => toggle(ct)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors select-none
                ${on ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
              <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${on ? 'bg-amber-500 border-amber-500' : 'border-slate-600 bg-slate-800'}`}>
                {on && <svg className="w-2.5 h-2.5 text-slate-950" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>}
              </span>
              <span className="text-sm font-medium">{ct}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 색상 팔레트 (사용 중 색상 비활성화) ──────────────────
function ColorPalette({ value, onChange, usedColors=[] }) {
  return (
    <div>
      <label className={LBL}>
        캘린더 색상
        <span className="ml-1 normal-case text-slate-500 font-normal">(선착순 자동 배정 · 사용 중인 색상 선택 불가)</span>
      </label>
      <div className="grid grid-cols-10 gap-1.5 mb-2">
        {COLOR_PALETTE.map(c => {
          const isMine  = value === c.hex;
          const isUsed  = usedColors.includes(c.hex); // 다른 트레이너가 사용 중
          const isWhite = c.hex === '#ffffff';
          return (
            <button key={c.hex} type="button" title={isUsed ? `사용 중 (${c.name})` : c.name}
              onClick={() => !isUsed && onChange(c.hex)}
              disabled={isUsed}
              className={`w-full aspect-square rounded-lg transition-all duration-150 relative
                ${isUsed ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'}
                ${isMine ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800 scale-110' : !isUsed ? 'hover:scale-110 opacity-80 hover:opacity-100' : ''}
                ${isWhite ? 'border border-slate-600' : ''}`}
              style={{ background: c.hex }}>
              {isMine && (
                <svg className={`w-full h-full p-1.5 ${isWhite?'text-slate-800':'text-white/90'}`} viewBox="0 0 12 10" fill="none">
                  <path d="M1 5l3.5 3.5 6.5-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {/* 사용 중 표시 (X) */}
              {isUsed && (
                <svg className="w-full h-full p-2 text-white/60" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {/* 현재 선택 미리보기 */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded border border-slate-600 flex-shrink-0" style={{background:value||'#94a3b8'}}/>
        <span className="text-xs text-slate-500">
          {COLOR_PALETTE.find(c=>c.hex===value)?.name||'선택 안 됨'}
          {value && <span className="text-slate-600 ml-1 font-mono">{value}</span>}
        </span>
      </div>
    </div>
  );
}

const EMPTY = { name:'', phone:'', birthDate:'', hireDate:'', classTypes:[], status:'full', color:'#f59e0b', memo:'', loginEmail:'', loginPassword:'' };

// 다음 사용 가능한 색상 자동 계산
function getNextColor(usedColors) {
  return COLOR_PALETTE.find(c => !usedColors.includes(c.hex))?.hex || COLOR_PALETTE[0].hex;
}

export default function Trainers() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [trainers,   setTrainers]   = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [showPw,     setShowPw]     = useState({}); // 트레이너별 비번 보기 토글

  const load = () => setTrainers(store.getTrainers());
  useEffect(load, []);

  const pf = f => e => setForm(prev => ({ ...prev, [f]: e.target.value }));

  // 현재 수정 중인 트레이너를 제외한 사용 중인 색상
  const usedColors = trainers
    .filter(t => t.id !== editTarget?.id)
    .map(t => t.color)
    .filter(Boolean);

  const openAdd = () => {
    const allUsed = trainers.map(t => t.color).filter(Boolean);
    const nextColor = getNextColor(allUsed); // ★ 선착순 자동 배정
    setEditTarget(null);
    setForm({ ...EMPTY, color: nextColor });
    setShowForm(true);
  };

  const openEdit = t => {
    setEditTarget(t);
    setForm({ name:t.name, phone:t.phone, birthDate:t.birthDate||'', hireDate:t.hireDate||'',
              classTypes:t.classTypes||[], status:t.status||'full', color:t.color||'#f59e0b', memo:t.memo||'',
              loginEmail:t.loginEmail||'', loginPassword:t.loginPassword||'' });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditTarget(null); };

  const saveTrainer = async () => {
    if (!form.name.trim() || !form.phone.trim()) { alert('이름과 연락처는 필수입니다.'); return; }
    // 로그인 계정을 적었다면 이메일+비번 둘 다 있어야 하고, 이메일이 겹치면 안 됨
    const email = (form.loginEmail||'').trim().toLowerCase();
    if (email || form.loginPassword) {
      if (!email || !form.loginPassword) { alert('로그인 계정을 만들려면 이메일과 비밀번호를 모두 입력하세요.'); return; }
      const dupTrainer = trainers.some(t => t.id!==editTarget?.id && (t.loginEmail||'').trim().toLowerCase()===email);
      if (dupTrainer) { alert('이미 사용 중인 이메일입니다. 다른 이메일을 입력하세요.'); return; }
    }
    try {
      if (editTarget) await store.updateTrainer(editTarget.id, form);
      else await store.addTrainer(form);
      load(); closeForm();
    } catch (e) { alert('저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  const deleteTrainer = async id => {
    if (!window.confirm('트레이너를 삭제하시겠습니까?')) return;
    try { await store.deleteTrainer(id); load(); }
    catch (e) { alert('삭제에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  const exportTrainers = () => {
    const members = store.getMembers();
    const header = ['이름','연락처','생년월일','입사일','구분','담당수업','담당회원수','로그인계정','메모'];
    const body = trainers.map(t=>{
      const memberCount = members.filter(m=>Object.keys(m.trainerSessions||{}).includes(t.id)).length;
      return [
        t.name, t.phone||'', t.birthDate||'', t.hireDate||'',
        STATUSES[t.status]||t.status, (t.classTypes||[]).join('/'),
        memberCount, t.loginEmail||'', t.memo||'',
      ];
    });
    downloadCSV(`트레이너목록_${todayYMD()}.csv`, [header, ...body]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">트레이너 관리</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <button onClick={exportTrainers}
              className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/40 hover:text-amber-400 transition-colors">
              📄 다운로드
            </button>
          )}
          <button onClick={openAdd} className="btn btn-primary btn-sm">+ 트레이너 등록</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {trainers.length===0&&(
          <div className="col-span-2 text-center py-16 text-slate-600"><p className="text-4xl mb-3">💪</p><p className="text-sm">등록된 트레이너가 없습니다</p></div>
        )}
        {trainers.map(t=>(
          <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-slate-950 font-black text-base flex-shrink-0 shadow-lg"
                style={{background:t.color||'#94a3b8'}}>{t.name[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">{t.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${STATUS_STYLE[t.status]||STATUS_STYLE.full}`}>{STATUSES[t.status]||t.status}</span>
                </div>
                <p className="text-slate-500 text-xs mt-0.5">{t.phone}</p>
                {t.birthDate&&<p className="text-slate-600 text-xs">{t.birthDate} 생</p>}
                {t.hireDate&&<p className="text-slate-600 text-xs">입사: {t.hireDate}</p>}
                {(t.classTypes||[]).length>0&&(
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.classTypes.map(ct=><span key={ct} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{ct}</span>)}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <div className="w-3 h-3 rounded-full border border-slate-700" style={{background:t.color||'#94a3b8'}}/>
                  <span className="text-[10px] text-slate-600">{COLOR_PALETTE.find(c=>c.hex===t.color)?.name||''}</span>
                </div>
                {t.memo&&<p className="text-slate-600 text-xs mt-1 truncate">{t.memo}</p>}

                {/* ── 로그인 계정 정보 (관리자만) ── */}
                {isAdmin && t.loginEmail && (
                  <div className="mt-2 p-2 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500 w-12 flex-shrink-0">아이디</span>
                      <span className="text-slate-300 font-mono break-all">{t.loginEmail}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500 w-12 flex-shrink-0">비번</span>
                      <span className="text-slate-300 font-mono">{showPw[t.id] ? t.loginPassword : '••••••••'}</span>
                      <button type="button" onClick={()=>setShowPw(p=>({...p,[t.id]:!p[t.id]}))}
                        className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-white">
                        {showPw[t.id] ? '숨기기' : '보기'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
              <button onClick={()=>openEdit(t)} className="flex-1 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white text-xs font-semibold transition-colors">수정</button>
              <button onClick={()=>deleteTrainer(t.id)} className="flex-1 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-semibold transition-colors">삭제</button>
            </div>
          </div>
        ))}
      </div>

      {showForm&&(
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
              <div>
                <h3 className="font-bold text-base">{editTarget?'트레이너 수정':'트레이너 등록'}</h3>
                {!editTarget&&<p className="text-xs text-amber-500 mt-0.5">캘린더 색상이 자동으로 배정되었습니다</p>}
              </div>
              <button onClick={closeForm} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="modal-body p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LBL}>이름 *</label><input value={form.name} onChange={pf('name')} placeholder="김민준" className={INP}/></div>
                <div><label className={LBL}>연락처 *</label><input value={form.phone} onChange={pf('phone')} placeholder="010-0000-0000" className={INP}/></div>
              </div>
              <div><label className={LBL}>생년월일</label><input type="date" value={form.birthDate} onChange={pf('birthDate')} className={INP}/></div>
              <div><label className={LBL}>입사일</label><input type="date" value={form.hireDate} onChange={pf('hireDate')} className={INP}/></div>

              <div>
                <label className={LBL}>고용 상태</label>
                <div className="flex gap-2">
                  {Object.entries(STATUSES).map(([k,v])=>(
                    <div key={k} onClick={()=>setForm(f=>({...f,status:k}))}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold border cursor-pointer text-center transition-colors select-none
                        ${form.status===k?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {v}
                    </div>
                  ))}
                </div>
              </div>

              {/* ★ ClassTypeCheckbox — onClick 버그 수정 */}
              <ClassTypeCheckbox selected={form.classTypes} onChange={v=>setForm(f=>({...f,classTypes:v}))}/>

              {/* ★ ColorPalette — 사용 중 색상 비활성화 */}
              <ColorPalette value={form.color} onChange={v=>setForm(f=>({...f,color:v}))} usedColors={usedColors}/>

              <div><label className={LBL}>메모</label><textarea rows={2} value={form.memo} onChange={pf('memo')} placeholder="특이사항" className={INP+" resize-none"}/></div>

              {/* ── 로그인 계정 (관리자만 설정) ── */}
              <div className="pt-4 border-t border-slate-800">
                <label className={LBL}>로그인 계정 <span className="normal-case text-slate-500 font-normal">(이 트레이너가 직접 로그인할 때 사용 · 선택)</span></label>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <input value={form.loginEmail} onChange={pf('loginEmail')} placeholder="이메일 (예: trainer-kim@momgagym.com)" className={INP} autoComplete="off"/>
                  </div>
                  <div>
                    <input value={form.loginPassword} onChange={pf('loginPassword')} placeholder="비밀번호" className={INP} autoComplete="off"/>
                    <p className="text-[11px] text-slate-500 mt-1">※ 센터 내부용이라 비밀번호는 관리자가 확인할 수 있게 저장됩니다.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-slate-800 flex-shrink-0">
              <button onClick={closeForm} className="btn btn-ghost">취소</button>
              <button onClick={saveTrainer} className="btn btn-primary flex-1">{editTarget?'수정 완료':'등록'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
