// MemberRegister.jsx — v4
// ✅ 2개 담당트레이너 슬롯 (트레이너→수업종류→세션수 순서)
// ✅ 트레이너 선택안함 시 수업종류 비활성, 세션 0
// ✅ ClassTypeCheckbox onClick 버그 수정
// ✅ 생년월일 type=date
import { useState, useRef, useEffect, useCallback } from 'react';
import { store } from '../../demoData';

const TERMS = `1. 건강 고지 의무\n회원은 부상 및 지병을 등록 전 반드시 고지해야 하며, 미고지 사항으로 인한 사고 및 합병증에 대해 센터는 책임을 지지 않습니다.\n\n2. 예약 및 수업 운영\n당일 취소·변경 불가. 전일 영업 종료 전까지 예약·변경 가능. 당일 취소·노쇼 시 횟수 자동 차감. 지각 시 연장 불가.\n\n3. 유효 기간 및 휴회\n등록일 기준 6개월 이내 소진(경과 시 자동 소멸). 휴회는 유효 기간 내 1회(최대 30일) 가능(사전 협의).\n\n4. 환불 및 양도\n환불 산정: [총 결제액] - [위약금 10%] - [진행 횟수 × 정상가] - [카드 수수료]. 타인 양도 절대 불가.\n\n5. 책임 및 동의\n본인 부주의 사고·분실물 책임 없음. 강사 변경 가능. 홍보 활용(사진·영상은 홍보·연구용).\n\n본인은 위 약관을 숙지하였으며 이에 동의합니다.`;

export const MEMBER_CLASS_TYPES = ['트레이닝','선수','재활','외부','컨디셔닝'];

// ── ClassTypeCheckbox (onClick 버그 수정) ──────────────────
export function ClassTypeCheckbox({ selected=[], onChange, options=MEMBER_CLASS_TYPES }) {
  const toggle = ct => onChange(selected.includes(ct) ? selected.filter(c=>c!==ct) : [...selected, ct]);
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">수업 종류 (복수 선택)</label>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map(ct => {
          const on = selected.includes(ct);
          return (
            // ★ onClick 추가 — 이전 버전의 핵심 버그
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

// ── 담당 트레이너 슬롯 (트레이너 → 수업종류 → 세션수) ─────
function TrainerSlot({ slot, label, trainers, usedIds, onChange }) {
  const trainer    = trainers.find(t => t.id === slot.trainerId);
  const classTypes = trainer?.classTypes || [];
  const inp = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-40";

  const handleTrainerChange = tid => {
    onChange({ trainerId: tid, classType: '', sessionTotal: tid ? 10 : 0 });
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        {slot.trainerId && (
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: trainer?.color || '#94a3b8' }} />
        )}
        <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">{label}</p>
      </div>

      {/* ① 담당 트레이너 */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">담당 트레이너</label>
        <select value={slot.trainerId} onChange={e => handleTrainerChange(e.target.value)} className={inp}>
          <option value="">선택 안 함</option>
          {trainers.map(t => {
            const taken = usedIds.includes(t.id) && t.id !== slot.trainerId;
            return <option key={t.id} value={t.id} disabled={taken}>{t.name}{taken ? ' (이미 선택)' : ''}</option>;
          })}
        </select>
      </div>

      {/* ② 수업 종류 */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">수업 종류</label>
        <select value={slot.classType} onChange={e => onChange({ ...slot, classType: e.target.value })}
          disabled={!slot.trainerId} className={inp}>
          <option value="">{slot.trainerId ? '수업 선택' : '선택 안 함'}</option>
          {classTypes.map(ct => <option key={ct} value={ct}>{ct}</option>)}
        </select>
      </div>

      {/* ③ 등록 세션 수 */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">등록 세션 수</label>
        <input type="number" min="0" max="300"
          value={slot.sessionTotal}
          disabled={!slot.trainerId}
          onChange={e => onChange({ ...slot, sessionTotal: Number(e.target.value) })}
          className={inp + " font-mono"}
          placeholder="0" />
      </div>
    </div>
  );
}

// ── Canvas 서명 훅 ─────────────────────────────────────────
function useSignatureCanvas(canvasRef) {
  const paths=useRef([]); const isDrawing=useRef(false);
  const initCtx=useCallback(ctx=>{ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=2.5;ctx.strokeStyle='#f1f5f9';},[]);
  const redraw=useCallback(()=>{
    const c=canvasRef.current; if(!c)return;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); initCtx(ctx);
    paths.current.forEach(p=>{if(p.length<2)return;ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);p.forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.stroke();});
  },[canvasRef,initCtx]);
  const resize=useCallback(()=>{
    const c=canvasRef.current; if(!c)return;
    const dpr=window.devicePixelRatio||1; const r=c.getBoundingClientRect();
    c.width=Math.floor(r.width*dpr); c.height=Math.floor(r.height*dpr);
    const ctx=c.getContext('2d'); ctx.scale(dpr,dpr); initCtx(ctx); redraw();
  },[canvasRef,initCtx,redraw]);
  useEffect(()=>{resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[resize]);
  const xy=e=>{const r=canvasRef.current.getBoundingClientRect();const s=e.touches?e.touches[0]:e;return{x:s.clientX-r.left,y:s.clientY-r.top};};
  const start=useCallback(e=>{e.preventDefault();isDrawing.current=true;const p=xy(e);paths.current.push([p]);const ctx=canvasRef.current?.getContext('2d');if(!ctx)return;initCtx(ctx);ctx.beginPath();ctx.moveTo(p.x,p.y);},[canvasRef,initCtx]);
  const move=useCallback(e=>{e.preventDefault();if(!isDrawing.current)return;const p=xy(e);paths.current[paths.current.length-1].push(p);const ctx=canvasRef.current?.getContext('2d');if(!ctx)return;ctx.lineTo(p.x,p.y);ctx.stroke();},[canvasRef]);
  const end=useCallback(e=>{e.preventDefault();isDrawing.current=false;},[]);
  const clear=useCallback(()=>{paths.current=[];redraw();},[redraw]);
  const isEmpty=()=>paths.current.every(p=>p.length===0);
  const getDataUrl=()=>canvasRef.current?.toDataURL('image/png');
  return{start,move,end,clear,isEmpty,getDataUrl};
}

const INP = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500";
const LBL = "block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5";

const EMPTY_SLOT = { trainerId:'', classType:'', sessionTotal:0 };

export default function MemberRegister({ trainers=[], onSuccess, onCancel }) {
  const [step, setStep]     = useState('form');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const today = new Date().toISOString().slice(0,10);

  const [form, setForm] = useState({
    name:'', phone:'', birthDate:'',
    joinDate:today, lastPaymentDate:today,
    memo:'',
    // 2개 담당 트레이너 슬롯
    trainerSlots: [{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }],
  });

  const canvasRef = useRef(null);
  const { start, move, end, clear, isEmpty, getDataUrl } = useSignatureCanvas(canvasRef);
  const pf = f => e => setForm(prev => ({ ...prev, [f]: e.target.value }));

  // 이미 선택된 트레이너 ID 목록
  const usedTrainerIds = form.trainerSlots.map(s => s.trainerId).filter(Boolean);

  const updateSlot = (idx, patch) => {
    const slots = form.trainerSlots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    setForm(f => ({ ...f, trainerSlots: slots }));
  };

  const handleNext = e => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) { setError('이름과 연락처는 필수입니다.'); return; }
    setError(''); setStep('terms');
  };

  const handleSubmit = async () => {
    if (isEmpty()) { setError('서명을 입력해 주세요.'); return; }
    setError(''); setLoading(true);
    try {
      await new Promise(r => setTimeout(r, 400));

      // trainerSessions 빌드
      const trainerSessions = {};
      form.trainerSlots.forEach(slot => {
        if (slot.trainerId && slot.sessionTotal > 0) {
          trainerSessions[slot.trainerId] = { total: slot.sessionTotal, remaining: slot.sessionTotal };
        }
      });

      // classTypes: 슬롯에서 선택된 수업 종류 집합 (중복 제거)
      const classTypes = [...new Set(
        form.trainerSlots.map(s => s.classType).filter(Boolean)
      )];

      store.addMember({
        name:form.name, phone:form.phone, birthDate:form.birthDate,
        joinDate:form.joinDate, lastPaymentDate:form.lastPaymentDate,
        lastAttendedDate:null, memo:form.memo,
        classTypes, trainerSessions,
        signatureUrl:getDataUrl(), isActive:true,
        createdAt:new Date().toISOString(),
      });
      setStep('done');
    } catch(err) { setError('오류: '+err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="font-bold text-base">
              {step==='form'&&'기본 정보 입력'}{step==='terms'&&'이용 약관'}{step==='sign'&&'자필 서명'}{step==='done'&&'등록 완료'}
            </h2>
            {step!=='done'&&<p className="text-slate-500 text-xs mt-0.5">{['form','terms','sign'].indexOf(step)+1} / 3 단계</p>}
          </div>
          {step!=='done'&&(
            <div className="flex gap-1.5">
              {[0,1,2].map(i=><div key={i} className={`h-1.5 rounded-full transition-all ${['form','terms','sign'].indexOf(step)>=i?'w-6 bg-amber-500':'w-3 bg-slate-700'}`}/>)}
            </div>
          )}
        </div>

        <div className="modal-body">

          {/* ─ STEP 1: 기본 정보 ──────────────────────── */}
          {step==='form'&&(
            <form onSubmit={handleNext} className="p-5 space-y-4">

              {/* 이름/연락처 */}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LBL}>이름 *</label><input required value={form.name} onChange={pf('name')} placeholder="홍길동" className={INP}/></div>
                <div><label className={LBL}>연락처 *</label><input required value={form.phone} onChange={pf('phone')} placeholder="010-0000-0000" inputMode="tel" className={INP}/></div>
              </div>

              {/* 날짜들 */}
              <div><label className={LBL}>생년월일</label><input type="date" value={form.birthDate} onChange={pf('birthDate')} className={INP}/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LBL}>가입일</label><input type="date" value={form.joinDate} onChange={pf('joinDate')} className={INP}/></div>
                <div><label className={LBL}>최근 결제일</label><input type="date" value={form.lastPaymentDate} onChange={pf('lastPaymentDate')} className={INP}/></div>
              </div>

              {/* 트레이너 슬롯 2개 */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">담당 트레이너 등록 (최대 2명)</p>
                {form.trainerSlots.map((slot, idx) => (
                  <TrainerSlot
                    key={idx}
                    slot={slot}
                    label={`트레이너 ${idx+1}`}
                    trainers={trainers}
                    usedIds={usedTrainerIds.filter(id => id !== slot.trainerId)}
                    onChange={patch => updateSlot(idx, patch)}
                  />
                ))}
              </div>

              {/* 메모 */}
              <div><label className={LBL}>메모</label><textarea rows={2} value={form.memo} onChange={pf('memo')} placeholder="부상 이력, 특이사항" className={INP+" resize-none"}/></div>

              {error&&<p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onCancel} className="py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">취소</button>
                <button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">다음: 약관 확인 →</button>
              </div>
            </form>
          )}

          {/* ─ STEP 2: 약관 ─────────────────────────── */}
          {step==='terms'&&(
            <div className="p-5 space-y-4">
              <div className="h-72 overflow-y-auto bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm text-slate-300 leading-7 whitespace-pre-line">{TERMS}</div>
              <div className="flex gap-2">
                <button onClick={()=>setStep('form')} className="py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">← 이전</button>
                <button onClick={()=>setStep('sign')} className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">동의하고 서명 ✍️</button>
              </div>
            </div>
          )}

          {/* ─ STEP 3: 서명 ─────────────────────────── */}
          {step==='sign'&&(
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-400">아래 영역에 직접 서명해 주세요.</p>
              <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-slate-600 bg-slate-800" style={{height:'200px'}}>
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair" style={{touchAction:'none'}}
                  onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
                  onTouchStart={start} onTouchMove={move} onTouchEnd={end}/>
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-slate-600 pointer-events-none">서명란</span>
              </div>
              {error&&<p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-2">
                <button onClick={()=>setStep('terms')} className="py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">← 이전</button>
                <button onClick={clear} className="py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">지우기</button>
                <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">{loading?'등록 중…':'등록 완료'}</button>
              </div>
            </div>
          )}

          {/* ─ STEP 4: 완료 ─────────────────────────── */}
          {step==='done'&&(
            <div className="p-10 text-center space-y-4">
              <div className="text-6xl">✅</div>
              <h3 className="text-xl font-black">{form.name} 회원 등록 완료!</h3>
              <div className="bg-slate-800 rounded-xl p-3 text-left space-y-1">
                {form.trainerSlots.filter(s=>s.trainerId).map((s,i)=>{
                  const t=trainers.find(tr=>tr.id===s.trainerId);
                  return <p key={i} className="text-xs text-slate-400">• {t?.name||'트레이너'} · {s.classType||'수업 미지정'} · {s.sessionTotal}회</p>;
                })}
              </div>
              <button onClick={onSuccess} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-8 rounded-xl text-sm transition-colors">확인</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
