// Schedule.jsx — v5
// ✅ 요구사항1: 트레이너별 세션 배지
// ✅ 요구사항2: 회원 기반 트레이너 필터링
// ✅ 요구사항3: 회원 기반 수업종류 필터링
// ✅ 요구사항4: 10분 단위 스냅 + 종료시간 자동 +1hr
// ✅ 요구사항5: 외부 일정 탭 (출강/교육/현장, 자유 시간, memberId=null)
import { useState, useEffect } from 'react';
import { store } from '../demoData';

// ── 시간 유틸 ─────────────────────────────────────────────
// 10분 단위 반올림 스냅
function snapTo10(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const rounded = Math.round(m / 10) * 10;
  if (rounded === 60) {
    const nh = Math.min(h + 1, 23);
    return `${String(nh).padStart(2,'0')}:00`;
  }
  return `${String(h).padStart(2,'0')}:${String(rounded).padStart(2,'0')}`;
}
// 시작 +1시간
function addHour(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const nh = h + 1;
  return nh <= 23 ? `${String(nh).padStart(2,'0')}:${String(m).padStart(2,'0')}` : t;
}

const WEEKDAYS = ['일','월','화','수','목','금','토'];
const weekday  = d => d ? WEEKDAYS[new Date(d+'T12:00:00').getDay()] : '';
const fmt      = d => new Date(d).toISOString().slice(0,10);
const fmtKo    = d => new Date(d+'T12:00:00').toLocaleDateString('ko-KR',{month:'short',day:'numeric',weekday:'short'});
const addD     = (d,n) => { const r=new Date(d+'T12:00:00'); r.setDate(r.getDate()+n); return fmt(r); };

// 회원이름(잔여N) 표시용 — 해당 스케줄의 회원·트레이너 기준 잔여 세션 조회.
// members 배열을 받아 실시간 잔여를 계산(자동 변경 반영).
function remainOf(s, members) {
  if (!s.memberId) return null;
  const m = (members||[]).find(x => x.id === s.memberId);
  if (!m || !m.trainerSessions) return null;
  const ts = m.trainerSessions[s.trainerId];
  return ts ? ts.remaining : null;
}
// 회원이름 + (잔여N) 문자열
function nameWithRemain(s, members) {
  if (s.isConsult || s.classType === '상담') return '상담';
  const base = s.isExternal || !s.memberId ? (s.memo?.slice(0,8) || '외부') : s.memberName;
  const r = remainOf(s, members);
  return r != null ? `${base}(${r})` : base;
}

const STATUS_MAP = {
  scheduled:{ label:'예정', bg:'bg-slate-700 text-slate-300',        dot:'bg-slate-400'   },
  attended: { label:'출석', bg:'bg-emerald-500/20 text-emerald-400', dot:'bg-emerald-400' },
  canceled: { label:'취소', bg:'bg-red-500/20 text-red-400',         dot:'bg-red-400'     },
  noshow:   { label:'노쇼', bg:'bg-orange-500/20 text-orange-400',   dot:'bg-orange-400'  },
};

const SEL = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-40 disabled:cursor-not-allowed";
const INP = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500";
const LBL = "block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5";

// ── 날짜+요일 인풋 ────────────────────────────────────────
function DateWd({ label, value, onChange }) {
  const wd = weekday(value);
  return (
    <div>
      <label className={LBL}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="date" value={value} onChange={e=>onChange(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"/>
        {wd && (
          <span className="text-amber-400 font-black text-sm px-2.5 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl whitespace-nowrap">
            {wd}요일
          </span>
        )}
      </div>
    </div>
  );
}

// ── 세션 차감 (외부 일정 방어 포함) ──────────────────────
async function deductSession(memberId, trainerId, status) {
  if (!memberId) {
    console.log('[세션차감] 외부 일정 — 차감 건너뜀');
    return;
  }
  const member = store.getMembers().find(m=>m.id===memberId);
  if (!member) { console.warn('[세션차감] 회원 없음:', memberId); return; }
  const ts = JSON.parse(JSON.stringify(member.trainerSessions||{}));
  if (ts[trainerId]) {
    ts[trainerId].remaining = Math.max(0, ts[trainerId].remaining - 1);
    console.log('[세션차감] 완료:', trainerId, '잔여:', ts[trainerId].remaining);
  } else {
    console.warn('[세션차감] 트레이너 세션 없음:', trainerId, Object.keys(ts));
  }
  const patch = { trainerSessions: ts };
  if (status==='attended') patch.lastAttendedDate = fmt(new Date());
  await store.updateMember(memberId, patch);
}

// ── 세션 복원 (예약 취소/삭제 시 +1) ──────────────────────
async function restoreSession(memberId, trainerId) {
  if (!memberId) return;
  const member = store.getMembers().find(m=>m.id===memberId);
  if (!member) return;
  const ts = JSON.parse(JSON.stringify(member.trainerSessions||{}));
  if (ts[trainerId]) {
    const cap = ts[trainerId].total ?? Infinity;
    ts[trainerId].remaining = Math.min(cap, ts[trainerId].remaining + 1);
    await store.updateMember(memberId, { trainerSessions: ts });
  }
}

// 주/일 뷰 공통 일정 행 (동일 높이·스타일)
function CompactRow({ s, members, onClick }) {
  const isExt = s.isExternal || !s.memberId;
  const nm = nameWithRemain(s, members);
  const st = STATUS_MAP[s.status] || STATUS_MAP.scheduled;
  return (
    <div onClick={() => onClick(s)}
      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition-colors">
      <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: s.trainerColor || '#94a3b8' }} />
      <div className="flex-shrink-0 w-12 text-[11px] font-mono text-slate-400 leading-tight">{s.startTime}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate text-slate-200">
          {isExt && <span className="text-purple-400 text-[10px] mr-1">[외]</span>}{nm}
        </p>
        <p className="text-[10px] text-slate-500 truncate">{s.trainerName || '트레이너'}{s.classType ? ` · ${s.classType}` : ''}</p>
      </div>
      <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${st.dot}`} />
    </div>
  );
}

// ── 예약 상세/수정/삭제 모달 ─────────────────────────────
function ScheduleDetailModal({ schedule:initS, onClose, onUpdate, onDelete }) {
  const [s, setS]           = useState(initS);
  const [editMode, setEdit] = useState(false);
  const [trainers, setTr]   = useState([]);
  const [members,  setMb]   = useState([]);
  const [form, setForm]     = useState({
    date:initS.date, startTime:initS.startTime, endTime:initS.endTime||'',
    classType:initS.classType, trainerId:initS.trainerId||'',
    memberId:initS.memberId||'', memo:initS.memo||'',
  });

  useEffect(() => {
    setTr(store.getTrainers()); setMb(store.getMembers());
    const fresh = store.getSchedules().find(sc=>sc.id===initS.id);
    if (fresh) setS(fresh);
  }, [initS.id]);

  const st     = STATUS_MAP[s.status] || STATUS_MAP.scheduled;
  const wd     = weekday(s.date);
  const isExt  = s.isExternal || !s.memberId;
  const isConsult = s.isConsult || s.classType === '상담';
  const dispName = isConsult ? '💬 상담' : (isExt ? (s.memo||'외부 일정') : s.memberName);

  const markStatus = async status => {
    const fresh = store.getSchedules().find(sc=>sc.id===s.id);
    if (fresh?.statusFinalized) { alert('이미 처리된 스케줄입니다.'); return; }
    try {
      await store.finalizeSchedule(s.id, status);  // 상태확정+출석일/세션복원 원자적 처리
      onUpdate();
    } catch (e) {
      console.error('[상태 확정 실패]', e);
      alert('처리에 실패했습니다. 네트워크 확인 후 다시 시도하세요.');
    }
  };

  const saveEdit = () => {
    const t = trainers.find(tr=>tr.id===form.trainerId);
    const m = members.find(me=>me.id===form.memberId);
    store.updateSchedule(s.id, {
      date:form.date, startTime:form.startTime, endTime:form.endTime,
      classType:form.classType, trainerId:form.trainerId,
      trainerName:t?.name||s.trainerName, trainerColor:t?.color||s.trainerColor,
      ...(isExt ? { memo:form.memo } : { memberId:form.memberId, memberName:m?.name||s.memberName }),
    });
    setEdit(false); onUpdate();
  };

  const trainerCT = trainers.find(t=>t.id===form.trainerId)?.classTypes||[];
  const pf = f => e => setForm(p=>({...p,[f]:e.target.value}));

  return (
    <div className="modal-overlay">
      <div className="modal-box">

        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="w-3 h-10 rounded-full flex-shrink-0" style={{background:s.trainerColor||'#94a3b8'}}/>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold truncate">{dispName}</h3>
              {isExt && (
                <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold flex-shrink-0">외부</span>
              )}
            </div>
            <p className="text-slate-500 text-xs">{s.trainerName||'트레이너'} · {s.date} ({wd}요일) · {s.startTime}</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-lg font-bold flex-shrink-0 ${st.bg}`}>{st.label}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl leading-none ml-1">×</button>
        </div>

        <div className="modal-body p-5 space-y-4">
          {!editMode ? (
            <>
              {[
                {l: isExt?'메모':'회원',  v: dispName},
                {l:'트레이너',           v: s.trainerName||'-'},
                {l:'날짜',               v: `${s.date} (${wd}요일)`},
                {l:'시간',               v: `${s.startTime} — ${s.endTime}`},
                {l:'수업',               v: s.classType},
              ].map(row=>(
                <div key={row.l} className="flex items-center justify-between py-2 border-b border-slate-800">
                  <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold w-20 flex-shrink-0">{row.l}</span>
                  <span className="text-sm font-medium text-right">{row.v}</span>
                </div>
              ))}

              {/* 처리: 예약 시 차감 완료. 출석=유지, 취소/노쇼=잔여 복원 */}
              {!s.statusFinalized ? (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2">
                    처리 {isExt && <span className="text-purple-400">(외부·세션 차감 없음)</span>}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {['attended','canceled','noshow'].map(status=>(
                      <button key={status} onClick={()=>markStatus(status)}
                        className={`py-3 rounded-xl text-xs font-bold border transition-all active:scale-95 ${STATUS_MAP[status].bg} border-current/20 hover:opacity-80`}>
                        <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${STATUS_MAP[status].dot}`}/>
                        {STATUS_MAP[status].label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={`text-center py-3 rounded-xl text-xs font-bold ${st.bg}`}>
                  ✓ {st.label} 처리 완료
                  {!isExt && (s.status==='canceled'||s.status==='noshow' ? ' · 세션 복원됨' : ' · 세션 차감됨')}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={()=>setEdit(true)}
                  className="btn btn-ghost flex-1">
                  ✏️ 수정
                </button>
                <button onClick={()=>{if(window.confirm('예약을 삭제하시겠습니까?')){
                  // 예약 시 차감했고 아직 확정(출석/취소) 전이면 잔여 복원
                  if(!isExt && s.sessionDeducted && !s.statusFinalized) restoreSession(s.memberId, s.trainerId);
                  store.deleteSchedule(s.id);onDelete();
                }}}
                  className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-semibold transition-colors">
                  🗑 삭제
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-amber-400 font-bold uppercase tracking-widest">✏️ 수정</p>
              {!isExt && (
                <div>
                  <label className={LBL}>회원</label>
                  <select value={form.memberId} onChange={pf('memberId')} className={SEL}>
                    {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
              {isExt && (
                <div>
                  <label className={LBL}>메모</label>
                  <input value={form.memo} onChange={pf('memo')} className={INP}/>
                </div>
              )}
              <div>
                <label className={LBL}>트레이너</label>
                <select value={form.trainerId} onChange={pf('trainerId')} className={SEL}>
                  <option value="">선택 안 함</option>
                  {trainers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <DateWd label="날짜" value={form.date} onChange={v=>setForm(p=>({...p,date:v}))}/>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LBL}>시작</label>
                  <input type="time" step={isExt?undefined:"600"} value={form.startTime}
                    onChange={e=>{
                      const t = isExt ? e.target.value : snapTo10(e.target.value);
                      setForm(p=>({...p, startTime:t, ...(!isExt && {endTime:addHour(t)})}));
                    }} className={INP}/>
                </div>
                <div>
                  <label className={LBL}>종료</label>
                  <input type="time" value={form.endTime} onChange={pf('endTime')} className={INP}/>
                </div>
              </div>
              <div>
                <label className={LBL}>수업 종류</label>
                <select value={form.classType} onChange={pf('classType')} className={SEL}>
                  <option value="">선택</option>
                  {(isExt ? ['출강','교육','현장'] : (trainerCT.length?trainerCT:['트레이닝','선수','재활','외부','컨디셔닝'])).map(ct=>(
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setEdit(false)}
                  className="btn btn-ghost">취소</button>
                <button onClick={saveEdit}
                  className="btn btn-primary flex-1">저장</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 예약 추가 모달 — 5가지 요구사항 통합 ─────────────────
function AddModal({ members, trainers, onAdd, onClose }) {
  const today = fmt(new Date());
  // 탭: 'regular' | 'external'
  const [tab, setTab] = useState('regular');

  const [form, setForm] = useState({
    memberId:'', trainerId:'', date:today,
    startTime:'', endTime:'',
    classType:'', memo:'', externalType:'출강',
    // ★ 외부 일정 기간 모드 — 'single'(하루) | 'range'(여러 날)
    extDateMode:'single', endDate:today,
    // ★ 일반 수업 모드 — 'member'(회원 수업) | 'consult'(상담, 회원 없음)
    regularMode:'member',
  });

  const pf = f => val => setForm(p=>({...p,[f]:val}));
  const pe = f => e  => setForm(p=>({...p,[f]:e.target.value}));

  // 탭 전환 시 폼 리셋
  const switchTab = t => {
    setTab(t);
    setForm({ memberId:'', trainerId:'', date:today, startTime:'', endTime:'', classType:'', memo:'', externalType:'출강', extDateMode:'single', endDate:today, regularMode:'member' });
  };

  // ── 트레이너 먼저 선택 → 담당 회원 필터링 ─────────────────
  const selectedTrainerObj = trainers.find(t=>t.id===form.trainerId);
  // 선택된 트레이너를 담당 트레이너로 둔 회원만 표시
  const filteredMembers = form.trainerId
    ? members.filter(m => Object.keys(m.trainerSessions||{}).includes(form.trainerId))
    : [];
  const selectedMember   = members.find(m=>m.id===form.memberId);
  const memberClassTypes = selectedMember?.classTypes || [];

  // 트레이너 변경 시 회원/수업종류 리셋
  const handleTrainerChange = id => {
    setForm(p=>({...p, trainerId:id, memberId:'', classType:''}));
  };
  // 회원 변경 시 수업종류 리셋
  const handleMemberChange = id => {
    setForm(p=>({...p, memberId:id, classType:''}));
  };

  // ── 요구사항4: 10분 스냅 + 자동 종료 ──────────────────
  const handleStartTimeRegular = e => {
    const snapped = snapTo10(e.target.value);
    setForm(p=>({...p, startTime:snapped, endTime:addHour(snapped)}));
  };
  // 요구사항5: 외부 일정 — 스냅 없이 자유 입력
  const handleStartTimeExternal = e => {
    setForm(p=>({...p, startTime:e.target.value}));
  };

  // 완성 여부
  // 일반 수업: 회원 수업 모드는 회원·수업종류 필수 / 상담 모드는 회원·수업종류 불필요
  const isConsult = form.regularMode === 'consult';
  const canSubmitRegular = isConsult
    ? (form.trainerId && form.date && form.startTime)
    : (form.memberId && form.trainerId && form.date && form.startTime && form.classType);
  // 외부 일정: 기간 모드면 종료 날짜가 시작 날짜 이상이어야 함
  const isRange = form.extDateMode === 'range';
  const rangeValid = !isRange || (form.endDate && form.endDate >= form.date);
  const canSubmitExternal = form.date && form.startTime && form.endTime && form.externalType && rangeValid;

  const handleAdd = () => {
    if (tab === 'regular') {
      if (!canSubmitRegular) return;
      const t = trainers.find(tr=>tr.id===form.trainerId);
      if (isConsult) {
        // ★ 상담: 회원 없음, 세션 차감 없음 (isExternal=true로 차감 방어)
        onAdd({
          memberId:null, memberName:null,
          trainerId:form.trainerId, trainerName:t?.name||'',
          trainerColor:t?.color||'#94a3b8',
          date:form.date, startTime:form.startTime, endTime:form.endTime||addHour(form.startTime),
          classType:'상담', memo:form.memo||'',
          status:'scheduled', sessionDeducted:true, isExternal:true, isConsult:true,
        });
      } else {
        const m = members.find(me=>me.id===form.memberId);
        onAdd({
          memberId:form.memberId, memberName:m?.name||'',
          trainerId:form.trainerId, trainerName:t?.name||'',
          trainerColor:t?.color||'#94a3b8',
          date:form.date, startTime:form.startTime, endTime:form.endTime||addHour(form.startTime),
          classType:form.classType, memo:'',
          status:'scheduled', sessionDeducted:false, isExternal:false,
        });
      }
    } else {
      if (!canSubmitExternal) return;
      const t = trainers.find(tr=>tr.id===form.trainerId);
      // ★ 기간 모드: 시작~종료 날짜 사이 모든 날에 일정 생성
      const dates = [];
      if (isRange) {
        let d = form.date;
        while (d <= form.endDate) { dates.push(d); d = addD(d, 1); }
      } else {
        dates.push(form.date);
      }
      dates.forEach(d => {
        onAdd({
          // ★ memberId = null, sessionDeducted = true (영구 차감 방지)
          memberId:null, memberName:null,
          trainerId:form.trainerId||null, trainerName:t?.name||'외부',
          trainerColor:t?.color||'#a855f7',
          date:d, startTime:form.startTime, endTime:form.endTime,
          classType:form.externalType, memo:form.memo,
          status:'scheduled', sessionDeducted:true, isExternal:true,
        });
      });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-box-large">

        {/* 헤더 + 탭 */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h3 className="font-bold text-base">수업 예약</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl">×</button>
          </div>
          {/* 탭 전환 */}
          <div className="flex mx-5 mb-3 bg-slate-800 rounded-xl p-1">
            {[['regular','📋 일반 수업'],['external','📤 외부 일정']].map(([t,l])=>(
              <button key={t} onClick={()=>switchTab(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${tab===t?'bg-amber-500 text-slate-950':'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body px-5 pb-5 space-y-4">

          {/* ══ 일반 수업 탭 ══════════════════════════════ */}
          {tab==='regular' && (
            <>
              {/* ★ 모드 선택: 회원 수업 / 상담 */}
              <div>
                <label className={LBL}>유형</label>
                <div className="flex gap-2">
                  {[['member','👤 회원 수업'],['consult','💬 상담 (회원 없음)']].map(([m,l])=>(
                    <div key={m} onClick={()=>setForm(p=>({...p, regularMode:m, memberId:'', classType:''}))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border cursor-pointer text-center transition-colors select-none
                        ${form.regularMode===m
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>

              {/* ① 트레이너 선택 */}
              <div>
                <label className={LBL}>① 담당 트레이너 <span className="text-red-400">*</span></label>
                <select value={form.trainerId} onChange={e=>handleTrainerChange(e.target.value)} className={SEL}>
                  <option value="">트레이너를 먼저 선택하세요</option>
                  {trainers.map(t=>(
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {selectedTrainerObj && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div className="w-3 h-3 rounded-full" style={{background:selectedTrainerObj.color}}/>
                    <span className="text-xs text-slate-500">{selectedTrainerObj.name} 트레이너</span>
                  </div>
                )}
              </div>

              {/* ② 회원 선택 — 상담 모드에서는 숨김 */}
              {!isConsult && (
              <div>
                <label className={LBL}>
                  ② 회원 선택
                  {form.trainerId && filteredMembers.length === 0 && (
                    <span className="ml-1 text-red-400 normal-case font-normal">— 담당 회원이 없습니다</span>
                  )}
                  {!form.trainerId && <span className="ml-1 text-slate-600 normal-case font-normal">— 트레이너 선택 후 활성화</span>}
                </label>
                <select value={form.memberId} onChange={e=>handleMemberChange(e.target.value)}
                  disabled={!form.trainerId}
                  className={SEL}>
                  <option value="">회원 선택</option>
                  {filteredMembers.map(m=>(
                    <option key={m.id} value={m.id}>
                      {m.name} (잔여 {m.trainerSessions?.[form.trainerId]?.remaining||0}회)
                    </option>
                  ))}
                </select>
              </div>
              )}

              {/* ③ 날짜 + 요일 */}
              <DateWd label="③ 날짜" value={form.date} onChange={pf('date')}/>

              {/* ④ 시작 시간 — 10분 단위 스냅 */}
              <div>
                <label className={LBL}>
                  ④ 시작 시간
                  <span className="ml-1 text-slate-500 normal-case font-normal">(10분 단위 자동 보정)</span>
                </label>
                <input type="time" step="600" value={form.startTime}
                  onChange={handleStartTimeRegular}
                  className={INP}/>
              </div>

              {/* 종료 시간 — 시작+1시간 자동 + 수정 가능 */}
              <div>
                <label className={LBL}>
                  종료 시간
                  <span className="ml-1 text-slate-500 normal-case font-normal">(시작 +1시간 자동 설정)</span>
                </label>
                <input type="time" step="600" value={form.endTime}
                  onChange={e=>setForm(p=>({...p,endTime:e.target.value}))}
                  className={INP}/>
              </div>

              {/* ⑤ 수업 종류 — 회원 수업 모드에서만, 상담은 '상담' 고정 */}
              {!isConsult ? (
              <div>
                <label className={LBL}>
                  ⑤ 수업 종류
                  {!form.memberId && <span className="ml-1 text-slate-600 normal-case font-normal">— 회원 선택 후 활성화</span>}
                </label>
                <select value={form.classType} onChange={pe('classType')}
                  disabled={!form.memberId}
                  className={SEL}>
                  <option value="">{form.memberId ? '수업 선택' : '회원을 먼저 선택하세요'}</option>
                  {memberClassTypes.map(ct=><option key={ct} value={ct}>{ct}</option>)}
                </select>
                {form.memberId && memberClassTypes.length === 0 && (
                  <p className="text-xs text-orange-400 mt-1">이 회원에게 등록된 수업 종류가 없습니다</p>
                )}
              </div>
              ) : (
              <div>
                <label className={LBL}>일정 내용 메모 (선택)</label>
                <textarea rows={2} value={form.memo} onChange={pe('memo')}
                  placeholder="상담 내용을 입력하세요 (예: 신규 회원 상담)"
                  className={INP+" resize-none"}/>
              </div>
              )}

              {/* 예약 미리보기 */}
              {canSubmitRegular && (
                <div className="bg-slate-800 border border-amber-500/20 rounded-xl p-3 space-y-1">
                  <p className="text-xs text-amber-400 font-semibold">{isConsult ? '상담 확인' : '예약 확인'}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full" style={{background:selectedTrainerObj?.color}}/>
                    {isConsult
                      ? <span className="font-semibold text-amber-300">💬 상담</span>
                      : <span className="font-semibold">{members.find(m=>m.id===form.memberId)?.name}</span>}
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-300">{selectedTrainerObj?.name}</span>
                  </div>
                  <p className="text-slate-400 text-xs">
                    {form.date} ({weekday(form.date)}요일) · {form.startTime} — {form.endTime} · {isConsult ? '상담' : form.classType}
                  </p>
                </div>
              )}
            </>
          )}

          {/* ══ 외부 일정 탭 ══════════════════════════════ */}
          {tab==='external' && (
            <>
              {/* 외부 종류: 출강/교육/현장 */}
              <div>
                <label className={LBL}>외부 일정 종류 <span className="text-red-400">*</span></label>
                <div className="flex gap-2">
                  {['출강','교육','현장'].map(type=>(
                    <div key={type} onClick={()=>setForm(p=>({...p,externalType:type}))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border cursor-pointer text-center transition-colors select-none
                        ${form.externalType===type
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                      {type}
                    </div>
                  ))}
                </div>
              </div>

              {/* 메모 — 회원 대신 */}
              <div>
                <label className={LBL}>일정 내용 메모</label>
                <textarea rows={3} value={form.memo} onChange={pe('memo')}
                  placeholder="외부 일정 내용을 입력하세요&#10;예: ○○짐 출강, 트레이너 교육 세미나 등"
                  className={INP+" resize-none"}/>
              </div>

              {/* 담당 트레이너 (선택사항) */}
              <div>
                <label className={LBL}>트레이너 (선택사항)</label>
                <select value={form.trainerId} onChange={pe('trainerId')} className={SEL}>
                  <option value="">선택 안 함</option>
                  {trainers.map(t=>(
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* ★ 기간 모드 선택: 하루 / 여러 날 */}
              <div>
                <label className={LBL}>기간 설정</label>
                <div className="flex gap-2">
                  {[['single','📅 하루'],['range','🗓 여러 날 (기간)']].map(([m,l])=>(
                    <div key={m} onClick={()=>setForm(p=>({...p, extDateMode:m, endDate:p.date}))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border cursor-pointer text-center transition-colors select-none
                        ${form.extDateMode===m
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>

              {/* 날짜 + 요일 — 하루 모드면 '날짜', 기간 모드면 '시작 날짜' */}
              <DateWd label={isRange ? '시작 날짜' : '날짜'} value={form.date}
                onChange={v=>setForm(p=>({...p, date:v, endDate:(p.endDate < v ? v : p.endDate)}))}/>

              {/* ★ 기간 모드일 때만 종료 날짜 */}
              {isRange && (
                <>
                  <DateWd label="종료 날짜" value={form.endDate} onChange={pf('endDate')}/>
                  {!rangeValid && (
                    <p className="text-xs text-red-400 -mt-2">종료 날짜는 시작 날짜와 같거나 이후여야 합니다</p>
                  )}
                  {rangeValid && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl px-3 py-2 -mt-1">
                      <p className="text-xs text-purple-300 font-semibold">
                        총 {(() => { let n=0,d=form.date; while(d<=form.endDate){n++;d=addD(d,1);} return n; })()}일간 일정이 등록됩니다
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {fmtKo(form.date)} ~ {fmtKo(form.endDate)} · 매일 {form.startTime||'--:--'}~{form.endTime||'--:--'}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* 시작/종료 시간 — 자유 입력 (스냅 없음, 독립 설정) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LBL}>
                    시작 시간
                    <span className="block text-[10px] text-purple-400 normal-case font-normal mt-0.5">자유 입력</span>
                  </label>
                  {/* ★ step 없음, 분 단위 자유 */}
                  <input type="time" value={form.startTime}
                    onChange={handleStartTimeExternal}
                    className={INP}/>
                </div>
                <div>
                  <label className={LBL}>
                    종료 시간
                    <span className="block text-[10px] text-purple-400 normal-case font-normal mt-0.5">독립 입력</span>
                  </label>
                  <input type="time" value={form.endTime}
                    onChange={e=>setForm(p=>({...p,endTime:e.target.value}))}
                    className={INP}/>
                </div>
              </div>

              {/* 안내 */}
              <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl px-3 py-2.5">
                <p className="text-xs text-purple-400 font-semibold mb-1">외부 일정 안내</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  외부 일정은 특정 회원에 종속되지 않으며, 세션 차감이 일어나지 않습니다.
                  {isRange && ' 여러 날 모드에서는 시작~종료 날짜의 모든 날에 같은 시간으로 일정이 만들어집니다.'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* 하단 등록 버튼 */}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-800 flex-shrink-0">
          <button onClick={onClose}
            className="btn btn-ghost">
            취소
          </button>
          <button onClick={handleAdd}
            disabled={tab==='regular' ? !canSubmitRegular : !canSubmitExternal}
            className={`flex-1 font-bold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed
              ${tab==='external'
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'}`}>
            {tab==='regular'
              ? (isConsult ? '상담 등록' : '수업 예약')
              : (isRange ? '기간 일정 등록' : '외부 일정 등록')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스케줄 블록 ───────────────────────────────────────────
function Block({ s, onClick, compact=false, members }) {
  const st    = STATUS_MAP[s.status] || STATUS_MAP.scheduled;
  const isExt = s.isExternal || !s.memberId;
  const name  = nameWithRemain(s, members);
  const bColor = s.trainerColor || '#94a3b8';

  if (compact) return (
    <div onClick={()=>onClick(s)}
      className={`text-[10px] rounded-md px-1.5 py-1 mb-0.5 cursor-pointer hover:opacity-75 transition-opacity border-l-2 ${isExt?'bg-purple-900/30':'bg-slate-800'}`}
      style={{borderColor:bColor}}>
      <div className="flex items-center gap-1">
        {isExt && <span className="text-purple-400 text-[8px] font-bold">외</span>}
        <p className="font-bold truncate text-slate-200 leading-tight">{name}</p>
      </div>
      <p className="text-slate-500 leading-tight">{s.startTime}</p>
      <div className="flex items-center gap-0.5 mt-0.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`}/>
        <span className="text-slate-500">{st.label}</span>
      </div>
    </div>
  );
  return (
    <div onClick={()=>onClick(s)} className="flex items-start gap-3 p-4 hover:bg-slate-800/50 cursor-pointer transition-colors">
      <div className="w-1 min-h-12 rounded-full flex-shrink-0 mt-0.5" style={{background:bColor}}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm">{name}</p>
              {isExt && <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold">외부</span>}
            </div>
            <p className="text-slate-500 text-xs mt-0.5">{s.trainerName||'트레이너'} · {s.classType}</p>
            <p className="text-slate-500 text-xs">{s.startTime} – {s.endTime}</p>
          </div>
          <span className={`text-[10px] px-2 py-1 rounded-lg font-bold flex-shrink-0 ${st.bg}`}>{st.label}</span>
        </div>
      </div>
    </div>
  );
}

// ── 월 뷰 ─────────────────────────────────────────────────
function MonthView({ pivotDate, schedules, onBlockClick, todayStr, members, onDayClick }) {
  const d=new Date(pivotDate+'T12:00:00');
  const y=d.getFullYear(), mo=d.getMonth();
  const first=new Date(y,mo,1).getDay(), days=new Date(y,mo+1,0).getDate();
  const cells=Array.from({length:Math.ceil((first+days)/7)*7},(_,i)=>{
    const day=i-first+1;
    return (day>0&&day<=days)?`${y}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;
  });
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="grid grid-cols-7 text-center text-xs font-bold text-slate-500 border-b border-slate-800">
        {['월','화','수','목','금','토','일'].map(d=><div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date,i)=>{
          if(!date) return <div key={i} className="min-h-16 border-b border-r border-slate-800 opacity-20"/>;
          const ds=schedules.filter(s=>s.date===date), isToday=date===todayStr;
          return (
            <div key={date} onClick={()=>onDayClick&&onDayClick(date)}
              className={`min-h-16 border-b border-r border-slate-800 p-1 cursor-pointer hover:bg-slate-800/40 transition-colors ${isToday?'bg-amber-500/5':''}`}>
              <p className={`text-[10px] font-mono font-bold mb-0.5 ${isToday?'text-amber-400':'text-slate-400'}`}>
                {parseInt(date.split('-')[2])}
              </p>
              {ds.slice(0,2).map(s=>{
                const isExt=s.isExternal||!s.memberId;
                const name=nameWithRemain(s, members);
                return (
                  <div key={s.id} onClick={(e)=>{e.stopPropagation(); onBlockClick(s);}}
                    className="text-[9px] rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer hover:opacity-80 transition-opacity"
                    style={{background:(s.trainerColor||'#94a3b8')+'33', color:(isExt?'#c084fc':s.trainerColor)||'#94a3b8'}}>
                    {isExt?'[외]':''}{name}
                  </div>
                );
              })}
              {ds.length>2&&<p className="text-[9px] text-slate-600">+{ds.length-2}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────
export default function Schedule() {
  const [view, setView]         = useState('week');
  const [pivot, setPivot]       = useState(fmt(new Date()));
  const [schedules, setSchedules] = useState([]);
  const [members,   setMembers]   = useState([]);
  const [trainers,  setTrainers]  = useState([]);
  const [showAdd,   setShowAdd]   = useState(false);
  const [detail,    setDetail]    = useState(null);

  const load = () => {
    setSchedules(store.getSchedules());
    setMembers(store.getMembers());
    setTrainers(store.getTrainers());
  };
  useEffect(load, []);

  const todayStr = fmt(new Date());
  const nav = view==='day'?1:view==='week'?7:30;

  const weekDates = Array.from({length:7},(_,i)=>{
    const base=new Date(pivot+'T12:00:00');
    const day=base.getDay();
    const mon=new Date(base); mon.setDate(base.getDate()-((day+6)%7));
    return addD(fmt(mon),i);
  });

  const forDate = d => schedules.filter(s=>s.date===d).sort((a,b)=>a.startTime.localeCompare(b.startTime));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-black tracking-tight">스케줄</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-800 rounded-xl p-1 text-xs">
            {[['day','일'],['week','주'],['month','월']].map(([v,l])=>(
              <button key={v} onClick={()=>setView(v)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${view===v?'bg-amber-500 text-slate-950':'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={()=>setShowAdd(true)}
            className="btn btn-primary btn-sm">
            + 예약
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={()=>setPivot(addD(pivot,-nav))}
          className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors text-lg">‹</button>
        <span className="text-sm font-semibold flex-1 text-center text-slate-300">
          {view==='week'
            ? `${fmtKo(weekDates[0])} — ${fmtKo(weekDates[6])}`
            : view==='month'
            ? new Date(pivot+'T12:00:00').toLocaleDateString('ko-KR',{year:'numeric',month:'long'})
            : fmtKo(pivot)}
        </span>
        <button onClick={()=>setPivot(addD(pivot,nav))}
          className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors text-lg">›</button>
        <button onClick={()=>setPivot(todayStr)}
          className="text-xs border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors font-semibold">오늘</button>
      </div>

      {view==='week'&&(
        <div className="space-y-2">
          {weekDates.map(date=>{
            const ds=forDate(date), isToday=date===todayStr;
            const dObj=new Date(date+'T12:00:00');
            const wd=dObj.toLocaleDateString('ko-KR',{weekday:'short'});
            const dayNum=dObj.getDate();
            return (
              <div key={date} className={`bg-slate-900 border rounded-xl overflow-hidden ${isToday?'border-amber-500/40':'border-slate-800'}`}>
                {/* 요일 헤더 — 클릭 시 일 뷰로 */}
                <button onClick={()=>{ setPivot(date); setView('day'); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 border-b border-slate-800 hover:bg-slate-800/50 transition-colors ${isToday?'bg-amber-500/5':''}`}>
                  <span className={`font-mono font-black text-lg ${isToday?'text-amber-400':'text-slate-300'}`}>{dayNum}</span>
                  <span className={`text-xs font-bold ${isToday?'text-amber-400':'text-slate-500'}`}>{wd}요일</span>
                  {isToday && <span className="text-[10px] text-amber-400 font-bold">오늘</span>}
                  <span className="ml-auto text-[11px] text-slate-600">{ds.length>0?`${ds.length}건`:'일정 없음'}</span>
                </button>
                {/* 해당 요일 일정 — 내용만큼 표시, 많으면 스크롤 */}
                {ds.length>0 && (
                  <div className="max-h-[40vh] overflow-y-auto divide-y divide-slate-800/60">
                    {ds.map(s=><CompactRow key={s.id} s={s} members={members} onClick={setDetail}/>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view==='day'&&(
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800">
            <p className="font-bold">{fmtKo(pivot)}</p>
            <p className="text-slate-500 text-xs">{forDate(pivot).length}개 일정</p>
          </div>
          {forDate(pivot).length===0
            ? <p className="text-center text-slate-600 py-12 text-sm">예정된 일정이 없습니다</p>
            : <div className="divide-y divide-slate-800 max-h-[65vh] overflow-y-auto">{forDate(pivot).map(s=><CompactRow key={s.id} s={s} members={members} onClick={setDetail}/>)}</div>
          }
        </div>
      )}

      {view==='month'&&(
        <MonthView pivotDate={pivot} schedules={schedules} onBlockClick={setDetail} todayStr={todayStr}
          members={members}
          onDayClick={(date)=>{ setPivot(date); setView('day'); }}/>
      )}

      {showAdd && (
        <AddModal
          members={members}
          trainers={trainers}
          onAdd={async d=>{
            try {
              await store.createScheduleWithDeduction(d);  // 예약+세션차감 원자적 처리
            } catch(e) {
              console.error('[예약 추가 실패]', e);
              alert('예약 저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.');
            }
            setShowAdd(false); load();
          }}
          onClose={()=>setShowAdd(false)}
        />
      )}

      {detail && (
        <ScheduleDetailModal
          schedule={detail}
          onClose={()=>setDetail(null)}
          onUpdate={()=>{load(); setDetail(null);}}
          onDelete={()=>{load(); setDetail(null);}}
        />
      )}
    </div>
  );
}
