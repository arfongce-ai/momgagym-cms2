// MemberRegister.jsx — v4
// ✅ 2개 담당트레이너 슬롯 (트레이너→수업종류→세션수 순서)
// ✅ 트레이너 선택안함 시 수업종류 비활성, 세션 0
// ✅ ClassTypeCheckbox onClick 버그 수정
// ✅ 생년월일 type=date
import { useState, useRef, useEffect, useCallback } from 'react';
import { store } from '../../demoData';
import { todayYMD, addMonthsYMD } from '../../utils/dates';

// [2026-07-28 갱신] 3항: "등록일 기준 6개월 이내 소진" → 실제 운영 기준(10회/20회 등록 시
// 소진 기한 차등)으로 변경하고, 회원이 놓치기 쉬운 핵심 조항이라 빨간 굵은 글씨로 강조한다.
// 4항: 환불 산식에 [부가세] 항목을 추가한다. "정상가" 문구는 그대로 둔다 — 실제 계산은
// finance.js의 computeRefundEstimate/autoRefundUsedAmount가 이미 "정상가"가 아니라 실제
// 결제 단가(결제가) 기준으로 하도록 바뀌었지만(회원에게 불리하지 않은 방향), 계약서 표기
// 자체는 바꾸지 않기로 확정됨(refund_flow.test.js '정상가 설정 제거 확인' 스펙 기준).
// TERMS_SECTIONS: 항목별로 { text } 또는(강조가 필요하면) { prefix, highlight, suffix } 형태.
export const TERMS_SECTIONS = [
  { text: '1. 건강 고지 의무\n회원은 부상 및 지병을 등록 전 반드시 고지해야 하며, 미고지 사항으로 인한 사고 및 합병증에 대해 센터는 책임을 지지 않습니다.' },
  { text: '2. 예약 및 수업 운영\n당일 취소·변경 불가. 전일 영업 종료 전까지 예약·변경 가능. 당일 취소·노쇼 시 횟수 자동 차감. 지각 시 연장 불가.' },
  {
    prefix: '3. 유효 기간 및 휴회\n',
    highlight: '10회 등록 시 최대 3개월, 20회 등록 시 최대 6개월 이내 소진(경과 시 자동 소멸)',
    suffix: '. 휴회는 유효 기간 내 1회(최대 30일) 가능(사전 협의).',
  },
  { text: '4. 환불 및 양도\n환불 산정: [총 결제액] - [위약금 10%] - [진행 횟수 × 정상가] - [카드 수수료] - [부가세]. 타인 양도 절대 불가.' },
  { text: '5. 책임 및 동의\n본인 부주의 사고·분실물 책임 없음. 강사 변경 가능. 홍보 활용(사진·영상은 홍보·연구용).' },
  { text: '본인은 위 약관을 숙지하였으며 이에 동의합니다.' },
];

// 파생 플레인 텍스트(서명·동의 기록 등 기존에 문자열 하나를 쓰던 곳과 호환용).
export const TERMS = TERMS_SECTIONS
  .map(s => (s.highlight != null ? `${s.prefix || ''}${s.highlight}${s.suffix || ''}` : s.text))
  .join('\n\n');

export const MEMBER_CLASS_TYPES = ['트레이닝','선수','재활','외부','컨디셔닝'];

// ── ClassTypeCheckbox (onClick 버그 수정) ──────────────────
export function ClassTypeCheckbox({ selected=[], onChange, options=MEMBER_CLASS_TYPES }) {
  const toggle = ct => onChange(selected.includes(ct) ? selected.filter(c=>c!==ct) : [...selected, ct]);
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">수업 종류 (복수 선택)</label>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map(ct => {
          const on = selected.includes(ct);
          return (
            // ★ onClick 추가 — 이전 버전의 핵심 버그
            <div key={ct} onClick={() => toggle(ct)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors select-none
                ${on ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300' : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>
              <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${on ? 'bg-amber-500 border-amber-500' : 'border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800'}`}>
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
  const inp = "w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-40";

  const handleTrainerChange = tid => {
    onChange({ trainerId: tid, classTypes: [], sessionTotal: tid ? 10 : 0 });
  };

  const toggleClassType = ct => {
    const cur = slot.classTypes || [];
    const next = cur.includes(ct) ? cur.filter(c => c !== ct) : [...cur, ct];
    onChange({ ...slot, classTypes: next });
  };

  return (
    <div className="bg-slate-100/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        {slot.trainerId && (
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: trainer?.color || '#94a3b8' }} />
        )}
        <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">{label}</p>
      </div>

      {/* ① 담당 트레이너 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">담당 트레이너</label>
        <select value={slot.trainerId} onChange={e => handleTrainerChange(e.target.value)} className={inp}>
          <option value="">선택 안 함</option>
          {trainers.map(t => {
            const taken = usedIds.includes(t.id) && t.id !== slot.trainerId;
            return <option key={t.id} value={t.id} disabled={taken}>{t.name}{taken ? ' (이미 선택)' : ''}</option>;
          })}
        </select>
      </div>

      {/* ② 수업 종류 — 다중 선택 (체크박스) */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">수업 종류 (복수 선택)</label>
        {!slot.trainerId ? (
          <p className="text-xs text-slate-500 px-1 py-2">트레이너를 먼저 선택하세요</p>
        ) : classTypes.length === 0 ? (
          <p className="text-xs text-slate-500 px-1 py-2">이 트레이너에 등록된 수업 종류가 없습니다</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {classTypes.map(ct => {
              const on = (slot.classTypes || []).includes(ct);
              return (
                <div key={ct} onClick={() => toggleClassType(ct)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors select-none
                    ${on ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300' : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>
                  <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${on ? 'bg-amber-500 border-amber-500' : 'border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800'}`}>
                    {on && <svg className="w-2.5 h-2.5 text-slate-950" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>}
                  </span>
                  <span className="text-sm font-medium">{ct}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ③ 등록 세션 수 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">등록 세션 수</label>
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
  return{start,move,end,clear,isEmpty,getDataUrl,resize};
}

const INP = "w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500";
const LBL = "block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5";

const EMPTY_SLOT = { trainerId:'', classTypes:[], sessionTotal:0 };

export default function MemberRegister({ trainers=[], onSuccess, onCancel }) {
  const [step, setStep]     = useState('form');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  // [2026-08-10 추가] 등록 완료 후 만든 회원을 기억해뒀다가 onSuccess에 실어
  // 보낸다 — 기존 호출부(Members.jsx)는 인자를 안 받으므로 그대로 무해하고,
  // 새 호출부(양도 화면의 "신규 회원" 흐름)는 이 값으로 바로 대상 회원을 잡는다.
  const [createdMember, setCreatedMember] = useState(null);
  const today = todayYMD(); // CV-A: 로컬 날짜

  const [form, setForm] = useState({
    name:'', gender:'', phone:'', phone2:'', birthDate:'', address:'', job:'',
    joinDate:today, lastPaymentDate:null,
    memo:'',
    // 월정액 병행 등록 (세션 슬롯과 독립적으로 함께 보유 가능)
    monthlyOn:false,
    monthlyFee:'',
    monthlyDueDate: addMonthsYMD(1, today),
    // 2개 담당 트레이너 슬롯 (세션 수업)
    trainerSlots: [{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }],
  });

  const canvasRef = useRef(null);
  const { start, move, end, clear, isEmpty, getDataUrl, resize } = useSignatureCanvas(canvasRef);
  const pf = f => e => setForm(prev => ({ ...prev, [f]: e.target.value }));

  // 서명 단계 진입 시 캔버스 크기를 실제 표시 크기에 맞춰 재설정
  // (조건부 렌더링이라 캔버스가 이때 처음 나타나므로 반드시 다시 측정해야 정확히 그려짐)
  useEffect(() => {
    if (step === 'sign') {
      const id = requestAnimationFrame(() => resize());
      return () => cancelAnimationFrame(id);
    }
  }, [step, resize]);

  // 이미 선택된 트레이너 ID 목록
  const usedTrainerIds = form.trainerSlots.map(s => s.trainerId).filter(Boolean);

  const updateSlot = (idx, patch) => {
    const slots = form.trainerSlots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    setForm(f => ({ ...f, trainerSlots: slots }));
  };

  const handleNext = e => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) { setError('이름과 연락처는 필수입니다.'); return; }
    if (!form.gender) { setError('성별을 선택해 주세요. (자세·체형 측정의 성별 기준 적용에 필요)'); return; }
    if (!form.birthDate) { setError('생년월일을 입력해 주세요. (체형나이·연령대 기준 적용에 필요)'); return; }
    setError(''); setStep('terms');
  };

  const handleSubmit = async () => {
    if (isEmpty()) { setError('서명을 입력해 주세요.'); return; }
    setError(''); setLoading(true);
    try {
      await new Promise(r => setTimeout(r, 400));

      // 세션 수업 trainerSessions 빌드 (항상 처리 — 월정액과 독립)
      const trainerSessions = {};
      form.trainerSlots.forEach(slot => {
        if (slot.trainerId && slot.sessionTotal > 0) {
          trainerSessions[slot.trainerId] = { total: slot.sessionTotal, remaining: slot.sessionTotal };
        }
      });

      // classTypes: 모든 슬롯에서 선택된 수업 종류 집합 (중복 제거)
      const classTypes = [...new Set(
        form.trainerSlots.flatMap(s => s.classTypes || [])
      )];

      // 월정액 병행 등록 (켜진 경우에만)
      const monthly = form.monthlyOn
        ? { active:true, fee:Number(form.monthlyFee)||0, dueDate:form.monthlyDueDate, startDate:form.joinDate }
        : null;

      const newMember = await store.addMember({
        name:form.name, gender:form.gender, phone:form.phone, phone2:form.phone2,
        birthDate:form.birthDate, address:form.address, job:form.job,
        joinDate:form.joinDate,
        lastPaymentDate: monthly ? form.joinDate : null,
        monthly,
        lastAttendedDate:null, memo:form.memo,
        classTypes, trainerSessions,
        signatureUrl:getDataUrl(), isActive:true,
        createdAt:new Date().toISOString(),
      });
      setCreatedMember(newMember);
      setStep('done');
    } catch(err) { setError('오류: '+err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-box-large">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div>
            <h2 className="font-bold text-base">
              {step==='form'&&'기본 정보 입력'}{step==='terms'&&'이용 약관'}{step==='sign'&&'자필 서명'}{step==='done'&&'등록 완료'}
            </h2>
            {step!=='done'&&<p className="text-slate-500 text-xs mt-0.5">{['form','terms','sign'].indexOf(step)+1} / 3 단계</p>}
          </div>
          {step!=='done'&&(
            <div className="flex gap-1.5">
              {[0,1,2].map(i=><div key={i} className={`h-1.5 rounded-full transition-all ${['form','terms','sign'].indexOf(step)>=i?'w-6 bg-amber-500':'w-3 bg-slate-200 dark:bg-slate-700'}`}/>)}
            </div>
          )}
        </div>

        <div className="modal-body">

          {/* ─ STEP 1: 기본 정보 ──────────────────────── */}
          {step==='form'&&(
            <form onSubmit={handleNext} className="p-5 space-y-4">

              {/* 1줄: 이름 + 성별 (이름칸 넓게) */}
              <div>
                <label className={LBL}>이름 * <span className="text-amber-700 dark:text-amber-400/80">/ 성별 *</span></label>
                <div className="flex gap-2">
                  <input required value={form.name} onChange={pf('name')} placeholder="홍길동" className={INP + " flex-1"}/>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {[['male','남'],['female','여']].map(([val,lbl])=>(
                      <button type="button" key={val}
                        onClick={()=>setForm(f=>({...f, gender: f.gender===val ? '' : val}))}
                        className={`w-14 rounded-xl text-sm font-bold border transition-colors
                          ${form.gender===val
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300'
                            : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-500'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2줄: 연락처1 + 연락처2 */}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LBL}>연락처 *</label><input required value={form.phone} onChange={pf('phone')} placeholder="010-0000-0000" inputMode="tel" className={INP}/></div>
                <div><label className={LBL}>연락처 2 (보호자·비상)</label><input value={form.phone2} onChange={pf('phone2')} placeholder="010-0000-0000 (선택)" inputMode="tel" className={INP}/></div>
              </div>

              {/* 3줄: 생년월일 + 직업(선택) */}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LBL}>생년월일 *</label><input type="date" value={form.birthDate} onChange={pf('birthDate')} className={INP}/></div>
                <div><label className={LBL}>직업 (선택)</label><input value={form.job} onChange={pf('job')} placeholder="직업 (선택)" className={INP}/></div>
              </div>

              {/* 주소 (선택) */}
              <div><label className={LBL}>주소 (선택)</label><input value={form.address} onChange={pf('address')} placeholder="주소를 입력하세요 (선택)" className={INP}/></div>

              {/* 가입일 (최근 결제일은 '수납 등록' 시 자동 연동되므로 여기서 입력하지 않음) */}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LBL}>가입일</label><input type="date" value={form.joinDate} onChange={pf('joinDate')} className={INP}/></div>
                <div>
                  <label className={LBL}>최근 결제일</label>
                  <div className={INP+" text-slate-500 flex items-center"}>수납 등록 시 자동 입력</div>
                </div>
              </div>

              {/* 트레이너 슬롯 2개 (세션 수업) */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">담당 트레이너 · 세션 수업 (최대 2명)</p>
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
                <p className="text-[11px] text-slate-500">세션이 없는 회원(월정액만)이라면 비워 두세요.</p>
              </div>

              {/* 월정액 병행 등록 (세션과 동시 보유 가능) */}
              <div className="space-y-2.5 bg-violet-500/5 border border-violet-500/20 rounded-xl p-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span onClick={()=>setForm(f=>({...f, monthlyOn:!f.monthlyOn}))}
                    className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${form.monthlyOn?'bg-violet-500 border-violet-500':'border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800'}`}>
                    {form.monthlyOn && <svg className="w-3 h-3 text-white" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </span>
                  <span className="text-sm font-bold text-violet-700 dark:text-violet-300" onClick={()=>setForm(f=>({...f, monthlyOn:!f.monthlyOn}))}>월정액 등록 (세션과 별개)</span>
                </label>
                {form.monthlyOn && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className={LBL}>월 회비 (원)</label>
                      <input type="number" value={form.monthlyFee} onChange={pf('monthlyFee')} placeholder="예: 100000" className={INP+" font-mono"}/>
                    </div>
                    <div>
                      <label className={LBL}>다음 결제 예정일</label>
                      <input type="date" value={form.monthlyDueDate} onChange={pf('monthlyDueDate')} className={INP}/>
                    </div>
                    <p className="col-span-2 text-[11px] text-slate-500">
                      월정액은 수업 횟수가 차감되지 않고, <b className="text-slate-600 dark:text-slate-300">트레이너 정산에 포함되지 않습니다</b>(센터 수익으로 합산).
                      결제 예정일 7일 전부터 “결제 만료”에 표시됩니다.
                    </p>
                  </div>
                )}
              </div>

              {/* 메모 */}
              <div><label className={LBL}>메모</label><textarea rows={2} value={form.memo} onChange={pf('memo')} placeholder="부상 이력, 특이사항" className={INP+" resize-none"}/></div>

              {error&&<p className="text-red-700 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onCancel} className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-white text-sm font-semibold transition-colors">취소</button>
                <button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">다음: 약관 확인 →</button>
              </div>
            </form>
          )}

          {/* ─ STEP 2: 약관 ─────────────────────────── */}
          {step==='terms'&&(
            <div className="p-5 flex flex-col" style={{minHeight:'60vh'}}>
              <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-600 dark:text-slate-300 leading-7 whitespace-pre-line mb-4" style={{minHeight:'45vh'}}>
                {TERMS_SECTIONS.map((s, i) => (
                  <p key={i} className={i>0 ? 'mt-4' : ''}>
                    {s.highlight != null
                      ? <>{s.prefix}<strong className="text-red-700 dark:text-red-400 font-extrabold">{s.highlight}</strong>{s.suffix}</>
                      : s.text}
                  </p>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setStep('form')} className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-white text-sm font-semibold transition-colors">← 이전</button>
                <button onClick={()=>setStep('sign')} className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">동의하고 서명 ✍️</button>
              </div>
            </div>
          )}

          {/* ─ STEP 3: 서명 ─────────────────────────── */}
          {step==='sign'&&(
            <div className="p-5 flex flex-col" style={{minHeight:'60vh'}}>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">아래 영역에 직접 서명해 주세요.</p>
              <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 flex-1 mb-4" style={{minHeight:'40vh'}}>
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair" style={{touchAction:'none'}}
                  onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
                  onTouchStart={start} onTouchMove={move} onTouchEnd={end}/>
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-slate-600 pointer-events-none">서명란</span>
              </div>
              {error&&<p className="text-red-700 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">{error}</p>}
              <div className="flex gap-2">
                <button onClick={()=>setStep('terms')} className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-white text-sm font-semibold transition-colors">← 이전</button>
                <button onClick={clear} className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-white text-sm font-semibold transition-colors">지우기</button>
                <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">{loading?'등록 중…':'등록 완료'}</button>
              </div>
            </div>
          )}

          {/* ─ STEP 4: 완료 ─────────────────────────── */}
          {step==='done'&&(
            <div className="p-10 text-center space-y-4">
              <div className="text-6xl">✅</div>
              <h3 className="text-xl font-black">{form.name} 회원 등록 완료!</h3>
              <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-3 text-left space-y-1">
                {form.trainerSlots.filter(s=>s.trainerId).map((s,i)=>{
                  const t=trainers.find(tr=>tr.id===s.trainerId);
                  const cts = (s.classTypes||[]).join(', ') || '수업 미지정';
                  return <p key={i} className="text-xs text-slate-500 dark:text-slate-400">• {t?.name||'트레이너'} · {cts} · {s.sessionTotal}회</p>;
                })}
              </div>
              <button onClick={() => onSuccess?.(createdMember)} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-8 rounded-xl text-sm transition-colors">확인</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
