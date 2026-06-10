// Revenue.jsx — 매출관리 (관리자 전용)
// 탭: 개요 / 정산 / 지출 / 설정
//  · 입금금액 = 결제금액 − 카드수수료 − 부가세
//  · 다수 트레이너 결제는 입금금액 1/n 귀속
//  · 정산 = 트레이너별 입금금액 × 정산비율(40/50/60%)
//  · 인센티브 = 홍보 기록 + 개인/재등록 매출 단위
//  · 고정비/월별 지출, 월/년 정산
import { useState, useMemo } from 'react';
import { store } from '../demoData';
import { useAuth } from '../contexts/AuthContext';
import {
  METHOD_LBL, METHOD_CLR, won, monthKey, yearKey,
  calcNet, splitRate, autoRate, attributePayment, CARD_METHODS, downloadCSV, computeSettlement,
} from '../services/finance';

const thisMonth = new Date().toISOString().slice(0,7);
const thisYear  = new Date().toISOString().slice(0,4);

function Card({ label, value, color='text-slate-100', sub }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</span>
      <p className={`text-xl font-black font-mono mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

const TABS = [['overview','개요'],['settle','정산'],['expense','지출'],['config','설정']];

export default function Revenue() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');

  const settings = store.getSettings();
  const trainers = store.getTrainers();
  const trainerMap = Object.fromEntries(trainers.map(t=>[t.id,t]));

  if (user?.role !== 'admin') {
    return <p className="text-slate-500 text-center py-10">관리자만 접근할 수 있습니다.</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight">💰 매출관리</h1>
        <p className="text-slate-500 text-sm mt-1">매출 · 정산 · 지출 통합 관리 · 관리자 전용</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-2xl p-1">
        {TABS.map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors
              ${tab===k?'bg-amber-500/20 text-amber-400':'text-slate-400 hover:text-white'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab==='overview' && <OverviewTab settings={settings} trainers={trainers} trainerMap={trainerMap}/>}
      {tab==='settle'   && <SettleTab settings={settings} trainers={trainers} trainerMap={trainerMap}/>}
      {tab==='expense'  && <ExpenseTab/>}
      {tab==='config'   && <ConfigTab settings={settings} trainers={trainers}/>}
    </div>
  );
}

/* ─────────────────────────────── 개요 ─────────────────────────────── */
function OverviewTab({ settings, trainers, trainerMap }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k=>k+1);
  const allPayments = useMemo(()=>store.getAllPayments()
    .sort((a,b)=>new Date(b.paidAt)-new Date(a.paidAt)), [refreshKey]);

  const months = useMemo(()=>{
    const set = new Set(allPayments.map(p=>monthKey(p.paidAt)));
    return [...set].sort().reverse();
  }, [allPayments]);

  const [selMonth, setSelMonth] = useState('all');
  const filtered = useMemo(()=>(
    selMonth==='all' ? allPayments : allPayments.filter(p=>monthKey(p.paidAt)===selMonth)
  ), [allPayments, selMonth]);

  const paid   = filtered.filter(p=>!p.isUnpaid && !p.isRefunded);
  const unpaid = filtered.filter(p=>p.isUnpaid && !p.isRefunded);

  const totals = useMemo(()=>{
    let amount=0, cardFee=0, vat=0, net=0;
    paid.forEach(p=>{ const c=calcNet(p,settings); amount+=c.amount; cardFee+=c.cardFee; vat+=c.vat; net+=c.net; });
    return { amount, cardFee, vat, net };
  }, [paid, settings]);

  const totalUnpaid = unpaid.reduce((s,p)=>s+(p.amount||0),0);

  const byMethod = useMemo(()=>{
    const acc={}; paid.forEach(p=>{acc[p.method]=(acc[p.method]||0)+(p.amount||0);}); return acc;
  }, [paid]);

  const byMonth = useMemo(()=>{
    const acc={}; allPayments.filter(p=>!p.isUnpaid && !p.isRefunded).forEach(p=>{
      const k=monthKey(p.paidAt); acc[k]=(acc[k]||0)+calcNet(p,settings).net; });
    return Object.entries(acc).sort((a,b)=>a[0].localeCompare(b[0]));
  }, [allPayments, settings]);
  const maxMonth = Math.max(1, ...byMonth.map(([,v])=>v));

  // 지출 / 순익 (시트의 총매출→입금→고정지출→순익 흐름)
  const expenses = store.getExpenses();
  const fixedTotal = expenses.filter(e=>e.kind==='fixed').reduce((s,e)=>s+(e.amount||0),0);
  const monthlyExpense = selMonth==='all'
    ? expenses.filter(e=>e.kind==='monthly').reduce((s,e)=>s+(e.amount||0),0)
    : expenses.filter(e=>e.kind==='monthly' && e.ym===selMonth).reduce((s,e)=>s+(e.amount||0),0);
  // 전체 기간이면 고정비는 월 수만큼 곱하지 않고 1회분만 참고 표기
  const totalExpense = (selMonth==='all' ? 0 : fixedTotal) + monthlyExpense;

  // 트레이너 정산 지급액 (선택 월 기준) — 시트의 순익 흐름과 일치시키기 위함
  const settlePayout = useMemo(()=>{
    if (selMonth==='all') return 0;
    const inPeriod = (d)=>monthKey(d)===selMonth;
    return computeSettlement(allPayments, store.getPromos(), trainers, settings, inPeriod)
      .reduce((s,r)=>s+r.payout, 0);
  }, [allPayments, trainers, settings, selMonth]);

  const netProfit = totals.net - settlePayout - totalExpense;

  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-2">
        <button onClick={()=>{
          const header=['날짜','이름','금액','결제수단','담당트레이너','입금금액','구분','비고'];
          const body=filtered.map(p=>[
            p.paidAt, p.memberName, p.amount,
            METHOD_LBL[p.method]||p.method,
            (p.trainerIds||[]).map(id=>trainerMap[id]?.name||'').join('/'),
            Math.round(calcNet(p,settings).net),
            p.isRefunded?'환불':p.isUnpaid?'미수금':p.isNew?'신규':p.isReEnroll?'재등록':p.category==='edu_center'?'센터교육':p.category==='edu_external'?'외부활동':'일반',
            p.note||'',
          ]);
          downloadCSV(`매출_${selMonth==='all'?'전체':selMonth}.csv`, [header, ...body]);
        }} disabled={filtered.length===0}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/40 hover:text-amber-400 transition-colors disabled:opacity-40">
          📄 매출내역 내보내기
        </button>
        <select value={selMonth} onChange={e=>setSelMonth(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
          <option value="all">전체 기간</option>
          {months.map(m=><option key={m} value={m}>{m.replace('-','년 ')}월</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="결제 합계" value={won(totals.amount)} color="text-slate-100"/>
        <Card label="입금금액(순매출)" value={won(totals.net)} color="text-emerald-400"
          sub={`카드세 ${won(totals.cardFee)} · 부가세 ${won(totals.vat)} 제외`}/>
        <Card label="미수금" value={won(totalUnpaid)} color="text-red-400"/>
        <Card label="결제 건수" value={`${paid.length}건`} color="text-blue-400"/>
      </div>

      {/* 결제수단별 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">결제수단별</h2>
        {Object.keys(byMethod).length===0
          ? <p className="text-slate-600 text-sm text-center py-3">데이터가 없습니다</p>
          : <div className="space-y-2">
              {Object.entries(byMethod).sort((a,b)=>b[1]-a[1]).map(([m,v])=>(
                <div key={m} className="flex items-center justify-between text-sm">
                  <span className={`font-bold ${METHOD_CLR[m]||'text-slate-300'}`}>{METHOD_LBL[m]||m}</span>
                  <span className="font-mono font-bold text-slate-200">{won(v)}</span>
                </div>
              ))}
            </div>}
      </div>

      {/* 월별 추이 (입금금액 기준) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">월별 입금금액 추이</h2>
        {byMonth.length===0
          ? <p className="text-slate-600 text-sm text-center py-3">데이터가 없습니다</p>
          : <div className="space-y-2">
              {byMonth.map(([k,v])=>(
                <div key={k} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 flex-shrink-0">{k}</span>
                  <div className="flex-1 bg-slate-800 rounded-full h-5 overflow-hidden">
                    <div className="h-full bg-amber-500/70 rounded-full" style={{width:`${(v/maxMonth)*100}%`}}/>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-300 w-24 text-right flex-shrink-0">{won(v)}</span>
                </div>
              ))}
            </div>}
      </div>

      {/* 순익 요약 (시트: 총매출 → 입금 → 지출 → 순익) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">
          {selMonth==='all' ? '전체 손익 요약' : `${selMonth} 손익 요약`}
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">총매출</span><span className="font-mono font-bold text-slate-200">{won(totals.amount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">입금금액</span><span className="font-mono font-bold text-emerald-400">{won(totals.net)}</span></div>
          {selMonth!=='all' && <div className="flex justify-between"><span className="text-slate-400">트레이너 정산</span><span className="font-mono font-bold text-red-400">- {won(settlePayout)}</span></div>}
          {selMonth!=='all' && <div className="flex justify-between"><span className="text-slate-400">고정지출</span><span className="font-mono font-bold text-red-400">- {won(fixedTotal)}</span></div>}
          <div className="flex justify-between"><span className="text-slate-400">{selMonth==='all'?'월별 지출':'당월 지출'}</span><span className="font-mono font-bold text-red-400">- {won(monthlyExpense)}</span></div>
          <div className="flex justify-between pt-2 border-t border-slate-800">
            <span className="font-bold text-amber-400">순익</span>
            <span className={`font-mono font-black text-lg ${netProfit>=0?'text-amber-400':'text-red-400'}`}>{won(netProfit)}</span>
          </div>
        </div>
        {selMonth==='all' && <p className="text-[11px] text-slate-600 mt-2">* 전체 기간은 고정비를 월별로 곱하지 않습니다. 정확한 손익은 월을 선택하세요.</p>}
      </div>

      {/* 상세 + 담당 트레이너 + 환불 */}
      <RefundableList filtered={filtered} settings={settings} trainers={trainers} trainerMap={trainerMap} onChange={refresh}/>
    </div>
  );
}

/* 결제 상세 — 관리자 수정/삭제/환불 */
function RefundableList({ filtered, settings, trainers, trainerMap, onChange }) {
  const [, force] = useState(0);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(null);
  const refresh = () => { force(n=>n+1); onChange?.(); };

  const METHODS = [['pay','페이'],['transfer','계좌'],['cash','현금'],['cash_receipt','현금영수증'],['card1','카드1'],['card2','카드2']];

  const startEdit = (p) => {
    setEditId(p.id);
    setEdit({
      paidAt:p.paidAt, amount:p.amount, method:p.method,
      trainerIds:[...(p.trainerIds||[])], note:p.note||'',
      isUnpaid:!!p.isUnpaid, isNew:!!p.isNew, isReEnroll:!!p.isReEnroll,
      category:p.category||'normal',
    });
  };

  const saveEdit = async (p) => {
    if (!edit.amount) { alert('금액을 입력해 주세요.'); return; }
    try {
      await store.updatePayment(p.memberId, p.id, {
        paidAt:edit.paidAt, amount:Number(edit.amount), method:edit.method,
        trainerIds:edit.trainerIds, note:edit.note,
        isUnpaid:edit.isUnpaid, isNew:edit.isNew, isReEnroll:edit.isReEnroll,
        category:edit.category,
      });
      setEditId(null); refresh();
    } catch(e){ alert('수정에 실패했습니다.'); }
  };

  const del = async (p) => {
    if (!window.confirm(`${p.memberName} · ${won(p.amount)} 결제를 삭제할까요?\n(회원 수납 내역에서도 삭제됩니다)`)) return;
    try { await store.deletePayment(p.memberId, p.id); refresh(); }
    catch(e){ alert('삭제에 실패했습니다.'); }
  };

  const handleRefund = async (p) => {
    const usedInput = window.prompt(
      `환불 처리 — ${p.memberName}\n총 결제액: ${won(p.amount)}\n\n진행 횟수 × 정상가(차감액)를 입력하세요 (원):`, '0');
    if (usedInput===null) return;
    const usedAmount = Number(usedInput)||0;
    const vat     = p.amount*(settings.vatRate/100);
    const penalty = p.amount*0.10;
    const refund  = Math.max(0, p.amount - vat - penalty - usedAmount);
    if (!window.confirm(
      `환불 산정 (계약서 10조 기준)\n` +
      `총 결제액 ${won(p.amount)}\n− 부가세 ${won(vat)}\n− 위약금 10% ${won(penalty)}\n− 진행분 ${won(usedAmount)}\n` +
      `= 환불액 ${won(refund)}\n\n이 결제를 환불 처리할까요?`)) return;
    try {
      await store.updatePayment(p.memberId, p.id, {
        isRefunded:true, refundAmount:refund, refundedAt:new Date().toISOString().slice(0,10),
        refundVat:vat, refundPenalty:penalty, refundUsed:usedAmount,
      });
      refresh();
    } catch(e){ alert('환불 처리에 실패했습니다.'); }
  };

  const cancelRefund = async (p) => {
    if (!window.confirm('환불 처리를 취소(되돌리기)할까요?')) return;
    try { await store.updatePayment(p.memberId, p.id, { isRefunded:false, refundAmount:null }); refresh(); }
    catch(e){ alert('실패했습니다.'); }
  };

  const SEL = "bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">결제 상세 내역 (관리자 수정)</h2>
      {filtered.length===0
        ? <p className="text-slate-600 text-sm text-center py-4">내역이 없습니다</p>
        : <div className="space-y-2">
            {filtered.map(p=>{
              const net = calcNet(p, settings).net;
              if (editId===p.id) {
                return (
                  <div key={p.id} className="p-3 rounded-xl bg-slate-800 border border-amber-500/30 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-400">{p.memberName} 결제 수정</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" value={edit.paidAt} onChange={e=>setEdit({...edit,paidAt:e.target.value})} className={SEL}/>
                      <input type="number" value={edit.amount} onChange={e=>setEdit({...edit,amount:e.target.value})} className={SEL+" font-mono"}/>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {METHODS.map(([v,l])=>(
                        <div key={v} onClick={()=>setEdit({...edit,method:v})}
                          className={`py-1.5 rounded-lg text-xs font-bold border cursor-pointer text-center ${edit.method===v?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400'}`}>{l}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[['normal','일반'],['edu_center','센터교육'],['edu_external','외부활동']].map(([v,l])=>(
                        <div key={v} onClick={()=>setEdit({...edit,category:v})}
                          className={`py-1.5 rounded-lg text-xs font-bold border cursor-pointer text-center ${edit.category===v?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400'}`}>{l}</div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {trainers.map(t=>{
                        const on = edit.trainerIds.includes(t.id);
                        return (
                          <div key={t.id} onClick={()=>setEdit({...edit, trainerIds: on?edit.trainerIds.filter(id=>id!==t.id):[...edit.trainerIds,t.id]})}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer flex items-center gap-1 ${on?'border-amber-500/40 bg-amber-500/10 text-amber-400':'border-slate-700 text-slate-400'}`}>
                            <span className="w-2 h-2 rounded-full" style={{background:t.color||'#94a3b8'}}/>{t.name}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[['isUnpaid','미수금'],['isNew','신규'],['isReEnroll','재등록']].map(([k,l])=>(
                        <div key={k} onClick={()=>setEdit({...edit,[k]:!edit[k], ...(k==='isNew'&&!edit[k]?{isReEnroll:false}:{}), ...(k==='isReEnroll'&&!edit[k]?{isNew:false}:{})})}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${edit[k]?'border-amber-500/40 bg-amber-500/20 text-amber-400':'border-slate-700 text-slate-400'}`}>{l}</div>
                      ))}
                    </div>
                    <input value={edit.note} onChange={e=>setEdit({...edit,note:e.target.value})} placeholder="메모" className={SEL+" w-full"}/>
                    <div className="flex gap-2 justify-end">
                      <button onClick={()=>setEditId(null)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5">취소</button>
                      <button onClick={()=>saveEdit(p)} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs">저장</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl ${p.isRefunded?'bg-slate-800/30 opacity-70':'bg-slate-800/60'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{p.memberName}</span>
                      <span className={`text-[10px] font-bold ${METHOD_CLR[p.method]||'text-slate-300'}`}>{METHOD_LBL[p.method]||p.method}</span>
                      {p.isUnpaid && <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold">미수금</span>}
                      {p.isNew && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold">신규</span>}
                      {p.isReEnroll && <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded font-bold">재등록</span>}
                      {p.category==='edu_center' && <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">센터교육</span>}
                      {p.category==='edu_external' && <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">외부활동</span>}
                      {p.isRefunded && <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded font-bold">환불완료</span>}
                    </div>
                    {p.trainerIds?.length>0 &&
                      <p className="text-[11px] text-slate-400 mt-0.5">담당: {p.trainerIds.map(id=>trainerMap[id]?.name||'?').join(', ')}</p>}
                    {p.note && <p className="text-xs text-slate-500 mt-0.5">{p.note}</p>}
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      {p.paidAt}{!p.isUnpaid && !p.isRefunded && ` · 입금 ${won(net)}`}
                      {p.isRefunded && ` · 환불 ${won(p.refundAmount||0)}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-sm font-mono font-black ${p.isUnpaid?'text-red-400':p.isRefunded?'text-orange-400 line-through':'text-emerald-400'}`}>{won(p.amount||0)}</span>
                    <div className="flex gap-2">
                      <button onClick={()=>startEdit(p)} className="text-[10px] text-slate-500 hover:text-blue-400">수정</button>
                      {!p.isUnpaid && (p.isRefunded
                        ? <button onClick={()=>cancelRefund(p)} className="text-[10px] text-slate-500 hover:text-slate-300">환불취소</button>
                        : <button onClick={()=>handleRefund(p)} className="text-[10px] text-slate-500 hover:text-orange-400">환불</button>)}
                      <button onClick={()=>del(p)} className="text-[10px] text-slate-500 hover:text-red-400">삭제</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>}
    </div>
  );
}

/* ─────────────────────────────── 정산 ─────────────────────────────── */
function SettleTab({ settings, trainers, trainerMap }) {
  const [mode, setMode] = useState('month'); // month | year
  const [period, setPeriod] = useState(thisMonth);

  const setModeAndPeriod = (m) => { setMode(m); setPeriod(m==='month'?thisMonth:thisYear); };

  const allPayments = useMemo(()=>store.getAllPayments(), []);
  const records = store.getPromos(); // channel: 'blog' | 'study'

  const inPeriod = (dateStr) => mode==='month'
    ? monthKey(dateStr)===period : yearKey(dateStr)===period;

  const rows = useMemo(()=>
    computeSettlement(allPayments, records, trainers, settings, inPeriod)
      .filter(r=>r.net>0 || r.eduCenterNet>0 || r.eduExtNet>0 || r.incentive>0),
    [allPayments, records, settings, trainers, period, mode]);

  const periodOptions = useMemo(()=>{
    const set = new Set(allPayments.map(p=>mode==='month'?monthKey(p.paidAt):yearKey(p.paidAt)));
    set.add(period);
    return [...set].sort().reverse();
  }, [allPayments, mode, period]);

  const grandPayout = rows.reduce((s,r)=>s+r.payout,0);
  const grandSettle = rows.reduce((s,r)=>s+r.settle+r.eduSettle,0);
  const grandInc    = rows.reduce((s,r)=>s+r.incentive,0);

  const exportCSV = () => {
    const header = ['트레이너','정산비율(%)','일반입금금액','정산금','신규등록매출','재등록매출',
      '센터교육','외부활동','블로그(회)','스터디(회)','블로그인센티브','매출인센티브','총지급액'];
    const body = rows.map(r=>[
      r.trainer.name, r.rate, Math.round(r.net), Math.round(r.settle),
      Math.round(r.newSales), Math.round(r.reSales),
      Math.round(r.eduCenterNet*(settings.eduCenterRate/100)),
      Math.round(r.eduExtNet*(settings.eduExternalRate/100)),
      r.blogCount, r.studyCount, Math.round(r.promoIncentive),
      Math.round(r.salesIncentive), Math.round(r.payout),
    ]);
    const footer = ['합계','', '','', '','', '','', '','',
      Math.round(grandInc), '', Math.round(grandPayout)];
    downloadCSV(`정산_${period}.csv`, [header, ...body, footer]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
          {[['month','월 정산'],['year','년 정산']].map(([k,l])=>(
            <button key={k} onClick={()=>setModeAndPeriod(k)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${mode===k?'bg-amber-500/20 text-amber-400':'text-slate-400 hover:text-white'}`}>{l}</button>
          ))}
        </div>
        <select value={period} onChange={e=>setPeriod(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
          {periodOptions.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-[11px] text-slate-500 ml-auto">임금지급일: 매월 {settings.paydayDay||5}일</span>
        <button onClick={exportCSV} disabled={rows.length===0}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/40 hover:text-amber-400 transition-colors disabled:opacity-40">
          📄 정산표 내보내기
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card label="정산금 합계" value={won(grandSettle)} color="text-emerald-400"/>
        <Card label="인센티브 합계" value={won(grandInc)} color="text-blue-400"/>
        <Card label="총 지급액" value={won(grandPayout)} color="text-amber-400"/>
      </div>

      <RecordManager trainers={trainers} period={period} mode={mode}/>

      {rows.length===0
        ? <p className="text-slate-600 text-sm text-center py-6 bg-slate-900 border border-slate-800 rounded-2xl">해당 기간 정산 내역이 없습니다</p>
        : rows.map(r=>(
          <div key={r.trainer.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-3 h-3 rounded-full" style={{background:r.trainer.color||'#94a3b8'}}/>
                <span className="font-bold">{r.trainer.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${r.rate===60?'bg-emerald-500/20 text-emerald-400':r.rate===50?'bg-blue-500/20 text-blue-400':'bg-slate-700 text-slate-300'}`}>
                  {r.rate}% {r.auto?'(자동)':'(수동)'}
                </span>
              </div>
              <span className="text-lg font-mono font-black text-amber-400">{won(r.payout)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Line l="일반 입금금액" v={won(r.net)}/>
              <Line l={`정산금 (${r.rate}%)`} v={won(r.settle)} c="text-emerald-400"/>
              <Line l="신규등록 매출" v={won(r.newSales)}/>
              <Line l="재등록 매출" v={won(r.reSales)}/>
              {(r.eduCenterNet>0||r.eduExtNet>0) && <>
                <Line l={`센터교육(${settings.eduCenterRate}%)`} v={won(r.eduCenterNet*(settings.eduCenterRate/100))} c="text-amber-400"/>
                <Line l={`외부활동(${settings.eduExternalRate}%)`} v={won(r.eduExtNet*(settings.eduExternalRate/100))} c="text-amber-400"/>
              </>}
              <Line l={`블로그 ${r.blogCount}회`} v={won(r.promoIncentive)} c="text-blue-400"/>
              <Line l="매출 인센티브" v={won(r.salesIncentive)} c="text-blue-400"/>
            </div>
            {r.auto && (
              <p className="text-[11px] text-slate-600 mt-2">
                {r.rate===60 ? '✓ 월 매출 300만원 이상 → 60%'
                 : r.rate===50 ? `✓ 블로그 ${r.blogCount}회·스터디 ${r.studyCount}회 → 50%`
                 : `기본 40% (50% 조건: 블로그 ${settings.rate50MinBlog}회+스터디 ${settings.rate50MinStudy}회 / 60% 조건: 매출 ${won(settings.rate60MinSales)})`}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}

function Line({ l, v, c='text-slate-200' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{l}</span>
      <span className={`font-mono font-bold ${c}`}>{v}</span>
    </div>
  );
}

/* 블로그/스터디 기록 관리 (정산 탭 내) — 계약서 4·5조 */
function RecordManager({ trainers, period, mode }) {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ trainerId:trainers[0]?.id||'', channel:'blog', date:new Date().toISOString().slice(0,10), note:'' });

  const inPeriod = (d) => mode==='month' ? monthKey(d)===period : yearKey(d)===period;
  const list = store.getPromos().filter(p=>inPeriod(p.date)).sort((a,b)=>b.date.localeCompare(a.date));

  const add = async () => {
    if (!form.trainerId) { alert('트레이너를 선택하세요.'); return; }
    try { await store.addPromo({ ...form }); setForm(f=>({...f, note:'', date:new Date().toISOString().slice(0,10)})); force(n=>n+1); }
    catch(e){ alert('추가 실패'); }
  };
  const del = async (id) => { try { await store.deletePromo(id); force(n=>n+1); } catch(e){ alert('삭제 실패'); } };

  const tMap = Object.fromEntries(trainers.map(t=>[t.id,t.name]));
  const CH = { blog:'블로그', study:'스터디' };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">📣 블로그 · 스터디 기록</h2>
        <button onClick={()=>setOpen(!open)} className="text-xs text-amber-400 hover:text-amber-300 font-semibold">+ 기록 추가</button>
      </div>
      {open && (
        <div className="mb-3 p-3 bg-slate-800 rounded-xl grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <select value={form.trainerId} onChange={e=>setForm({...form,trainerId:e.target.value})}
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm">
            {trainers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm">
            <option value="blog">블로그</option>
            <option value="study">스터디</option>
          </select>
          <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm"/>
          <input value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="확인 메모(선택)"
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm"/>
          <button onClick={add} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-lg text-sm">추가</button>
        </div>
      )}
      {list.length===0
        ? <p className="text-slate-600 text-xs text-center py-2">기록 없음</p>
        : <div className="space-y-1.5">
            {list.map(p=>(
              <div key={p.id} className="flex items-center justify-between text-xs bg-slate-800/60 rounded-lg px-3 py-2">
                <span className="text-slate-300">
                  {tMap[p.trainerId]||'?'} · <span className={p.channel==='blog'?'text-blue-400':'text-purple-400'}>{CH[p.channel]||p.channel}</span> · {p.date}
                  {p.note && <span className="text-slate-500"> · {p.note}</span>}
                </span>
                <button onClick={()=>del(p.id)} className="text-slate-600 hover:text-red-400">삭제</button>
              </div>
            ))}
          </div>}
      <p className="text-[11px] text-slate-600 mt-2">* 블로그 1건당 1만원(상한 없음) · 50% 승급 조건: 블로그 월2회 + 스터디 월1회 이상</p>
    </div>
  );
}

/* ─────────────────────────────── 지출 ─────────────────────────────── */
function ExpenseTab() {
  const [, force] = useState(0);
  const [selMonth, setSelMonth] = useState(thisMonth);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind:'monthly', name:'', amount:'', ym:thisMonth, date:new Date().toISOString().slice(0,10), note:'' });

  const expenses = store.getExpenses();
  const fixed   = expenses.filter(e=>e.kind==='fixed');
  const monthly = expenses.filter(e=>e.kind==='monthly' && e.ym===selMonth);

  const fixedTotal   = fixed.reduce((s,e)=>s+(e.amount||0),0);
  const monthlyTotal = monthly.reduce((s,e)=>s+(e.amount||0),0);

  const months = useMemo(()=>{
    const set = new Set(expenses.filter(e=>e.kind==='monthly').map(e=>e.ym));
    set.add(selMonth);
    return [...set].sort().reverse();
  }, [expenses, selMonth]);

  const add = async () => {
    if (!form.name.trim() || !form.amount) { alert('항목명과 금액을 입력하세요.'); return; }
    try {
      const payload = form.kind==='fixed'
        ? { kind:'fixed', name:form.name, amount:Number(form.amount), note:form.note }
        : { kind:'monthly', name:form.name, amount:Number(form.amount), ym:form.ym, date:form.date, note:form.note };
      await store.addExpense(payload);
      setForm({ kind:form.kind, name:'', amount:'', ym:selMonth, date:new Date().toISOString().slice(0,10), note:'' });
      setOpen(false); force(n=>n+1);
    } catch(e){ alert('추가 실패'); }
  };
  const del = async (id) => { if(!window.confirm('삭제할까요?'))return; try{ await store.deleteExpense(id); force(n=>n+1);}catch(e){alert('삭제 실패');} };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <select value={selMonth} onChange={e=>setSelMonth(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm">
          {months.map(m=><option key={m} value={m}>{m.replace('-','년 ')}월</option>)}
        </select>
        <button onClick={()=>setOpen(!open)} className="text-xs text-amber-400 hover:text-amber-300 font-semibold">+ 지출 추가</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card label="고정비" value={won(fixedTotal)} color="text-orange-400" sub="매월 반복"/>
        <Card label={`${selMonth} 월 지출`} value={won(monthlyTotal)} color="text-red-400"/>
        <Card label="합계" value={won(fixedTotal+monthlyTotal)} color="text-amber-400"/>
      </div>

      {open && (
        <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-4 space-y-3">
          <div className="flex gap-2">
            {[['monthly','월별 지출'],['fixed','고정비']].map(([k,l])=>(
              <button key={k} onClick={()=>setForm({...form,kind:k})}
                className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${form.kind===k?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400'}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="항목명 (예: 임대료)"
              className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"/>
            <input type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} placeholder="금액"
              className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono"/>
          </div>
          {form.kind==='monthly' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-500">귀속 월</label>
                <input type="month" value={form.ym} onChange={e=>setForm({...form,ym:e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"/>
              </div>
              <div>
                <label className="text-[11px] text-slate-500">지출일</label>
                <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"/>
              </div>
            </div>
          )}
          <input value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="메모 (선택)"
            className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"/>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>setOpen(false)} className="text-xs text-slate-400 hover:text-white px-3 py-2">취소</button>
            <button onClick={add} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm">추가</button>
          </div>
        </div>
      )}

      {/* 고정비 목록 */}
      <ExpenseList title="🔁 고정비 (매월 반복)" items={fixed} onDelete={del}/>
      {/* 월별 지출 목록 */}
      <ExpenseList title={`📅 ${selMonth} 월별 지출`} items={monthly} onDelete={del} showDate/>
    </div>
  );
}

function ExpenseList({ title, items, onDelete, showDate }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">{title}</h2>
      {items.length===0
        ? <p className="text-slate-600 text-sm text-center py-3">내역이 없습니다</p>
        : <div className="space-y-2">
            {items.map(e=>(
              <div key={e.id} className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl">
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm">{e.name}</span>
                  {showDate && e.date && <span className="text-[11px] text-slate-500 ml-2">{e.date}</span>}
                  {e.note && <p className="text-xs text-slate-500 mt-0.5">{e.note}</p>}
                </div>
                <span className="text-sm font-mono font-black text-red-400 flex-shrink-0">{won(e.amount)}</span>
                <button onClick={()=>onDelete(e.id)} className="text-slate-600 hover:text-red-400 text-xs flex-shrink-0">🗑</button>
              </div>
            ))}
          </div>}
    </div>
  );
}

/* ─────────────────────────────── 설정 ─────────────────────────────── */
function NumField({ label, k, suffix, form, setForm }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" value={form[k] ?? ''} step="any"
          onChange={e=>setForm(f=>({...f,[k]:Number(e.target.value)}))}
          className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono"/>
        {suffix && <span className="text-xs text-slate-500 flex-shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

function ConfigTab({ settings, trainers }) {
  const [form, setForm] = useState({ ...settings, trainerSplitRates:{...(settings.trainerSplitRates||{})} });
  const [saved, setSaved] = useState(false);

  // 자동/수동 토글: 수동이면 비율 지정, 자동이면 키 제거
  const setManual = (tid, v) => setForm(f=>({...f, trainerSplitRates:{...(f.trainerSplitRates||{}), [tid]:v}}));
  const clearManual = (tid) => setForm(f=>{ const n={...(f.trainerSplitRates||{})}; delete n[tid]; return {...f, trainerSplitRates:n}; });

  const save = async () => {
    try { await store.updateSettings(form); setSaved(true); setTimeout(()=>setSaved(false),2000); }
    catch(e){ alert('저장 실패'); }
  };

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">수수료 / 부가세</h2>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="카드 수수료" k="cardFeeRate" suffix="%" form={form} setForm={setForm}/>
          <NumField label="부가세" k="vatRate" suffix="%" form={form} setForm={setForm}/>
        </div>
        <p className="text-[11px] text-slate-600">입금금액 = 결제금액 − 카드수수료 − 부가세 (카드성 결제: 페이·카드1·카드2)</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">정산 비율 (계약서 4조)</h2>
        <p className="text-[11px] text-slate-500">자동: 조건에 따라 40→50→60% 판정 · 수동: 고정 비율 지정</p>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="기본 비율" k="defaultSplitRate" suffix="%" form={form} setForm={setForm}/>
          <NumField label="60% 조건 (월 매출)" k="rate60MinSales" suffix="원" form={form} setForm={setForm}/>
          <NumField label="50% 조건 (블로그 월)" k="rate50MinBlog" suffix="회" form={form} setForm={setForm}/>
          <NumField label="50% 조건 (스터디 월)" k="rate50MinStudy" suffix="회" form={form} setForm={setForm}/>
        </div>
        <div className="space-y-2 pt-2 border-t border-slate-800">
          {trainers.map(t=>{
            const manual = form.trainerSplitRates?.[t.id];
            const isManual = manual !== undefined && manual !== null && manual !== '';
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{background:t.color||'#94a3b8'}}/>{t.name}
                </span>
                <div className="flex gap-1 items-center">
                  <button onClick={()=>clearManual(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors
                      ${!isManual?'bg-emerald-500/20 border-emerald-500/40 text-emerald-400':'border-slate-700 text-slate-400'}`}>자동</button>
                  {[40,50,60].map(v=>(
                    <button key={v} onClick={()=>setManual(t.id, v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors
                        ${isManual&&manual===v?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400'}`}>{v}%</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">교육활동 매출 (계약서 8조)</h2>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="센터 내 교육" k="eduCenterRate" suffix="%" form={form} setForm={setForm}/>
          <NumField label="외부 활동" k="eduExternalRate" suffix="%" form={form} setForm={setForm}/>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">인센티브 규칙 (계약서 5조)</h2>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="블로그 1건당" k="promoPerPost" suffix="원" form={form} setForm={setForm}/>
          <NumField label="신규등록 단위" k="incentivePer" suffix="원" form={form} setForm={setForm}/>
          <NumField label="신규 단위당" k="incentiveAmount" suffix="원" form={form} setForm={setForm}/>
          <NumField label="재등록 단위" k="reEnrollPer" suffix="원" form={form} setForm={setForm}/>
          <NumField label="재등록 단위당" k="reEnrollAmount" suffix="원" form={form} setForm={setForm}/>
          <NumField label="임금지급일" k="paydayDay" suffix="일" form={form} setForm={setForm}/>
        </div>
        <p className="text-[11px] text-slate-600">* 신규상담 등록·재등록 매출 100만원당 1만원 / 블로그 1건당 1만원(상한 없음)</p>
      </div>

      <button onClick={save}
        className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 rounded-2xl transition-colors">
        {saved ? '✓ 저장됨' : '설정 저장'}
      </button>
    </div>
  );
}
