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
  calcNet, CARD_METHODS, downloadCSV, computeSessionSettlement, determineSplitRate,
  buildRefreezePlan,
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
  // 이 기간(월)에 환불된 결제 — 환불액을 매출에서 차감
  const refundedThisPeriod = filtered.filter(p=>p.isRefunded && p.refundedAt &&
    (selMonth==='all' || p.refundedAt.slice(0,7)===selMonth));
  const refundTotal = refundedThisPeriod.reduce((s,p)=>s+(Number(p.refundAmount)||0),0);

  const totals = useMemo(()=>{
    let amount=0, cardFee=0, vat=0, net=0;
    paid.forEach(p=>{ const c=calcNet(p,settings); amount+=c.amount; cardFee+=c.cardFee; vat+=c.vat; net+=c.net; });
    net -= refundTotal;   // 환불한 달의 입금액에서 환불액 차감
    return { amount, cardFee, vat, net };
  }, [paid, settings, refundTotal]);

  const totalUnpaid = unpaid.reduce((s,p)=>s+(p.amount||0),0);

  const byMethod = useMemo(()=>{
    const acc={};
    paid.forEach(p=>{
      if (Array.isArray(p.methods) && p.methods.length) {
        p.methods.forEach(m=>{ acc[m.method]=(acc[m.method]||0)+(Number(m.amount)||0); });
      } else {
        acc[p.method]=(acc[p.method]||0)+(p.amount||0);
      }
    });
    return acc;
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
  // 고정비: 특정 월=1회분 / 전체기간=결제가 있는 달 수만큼 합산(정산 합산과 대칭)
  const fixedApplied = selMonth==='all' ? fixedTotal * months.length : fixedTotal;
  const totalExpense = fixedApplied + monthlyExpense;

  // 트레이너 정산 지급액 — 회당단가×횟수 방식과 일치
  //  · 특정 월: 그 달만 계산
  //  · 전체 기간: 결제가 있는 모든 달을 각각 계산해 합산(정산은 월 단위라 단순 합이 불가)
  const settlePayout = useMemo(()=>{
    const grouped = {}; store.getMembers().forEach(m=>{ grouped[m.id]=store.getPayments(m.id); });
    const calcMonth = (ym) => computeSessionSettlement({
      trainers, members: store.getMembers(), schedules: store.getSchedules(),
      payments: grouped, records: store.getPromos(), settings, ym,
      getOverride: (tid,m)=>store.getSettleOverride(tid,m),
    }).reduce((s,b)=>s+b.payout, 0);
    if (selMonth==='all') return months.reduce((s,ym)=>s+calcMonth(ym), 0);
    return calcMonth(selMonth);
  }, [allPayments, trainers, settings, selMonth, months]);

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
  const [query, setQuery] = useState('');
  const refresh = () => { force(n=>n+1); onChange?.(); };

  const METHODS = [['pay','페이'],['transfer','계좌'],['cash','현금'],['cash_receipt','현금영수증'],['card1','카드1'],['card2','카드2']];

  const startEdit = (p) => {
    setEditId(p.id);
    setEdit({
      paidAt:p.paidAt, amount:p.amount, method:p.method, methods:[...(p.methods||[])],
      trainerIds:[...(p.trainerIds||[])], split:[...(p.split||[])],
      splitRateAtPay:{...(p.splitRateAtPay||{})}, note:p.note||'',
      isUnpaid:!!p.isUnpaid, isNew:!!p.isNew, isReEnroll:!!p.isReEnroll,
      consultTrainerId:p.consultTrainerId||'',
      category:p.category||'normal',
    });
  };

  const saveEdit = async (p) => {
    if (!edit.amount) { alert('금액을 입력해 주세요.'); return; }
    try {
      // split 정합성: 다중(2명+)이 아니면 비우고, 트레이너가 바뀌었으면 균등 재분배.
      const total = Math.max(0, Math.round(Number(edit.amount)||0));
      let split = [];
      if (edit.trainerIds.length >= 2) {
        const prev = Object.fromEntries((edit.split||[]).map(s=>[s.trainerId, Number(s.amount)||0]));
        const sameSet = edit.split?.length===edit.trainerIds.length
          && edit.trainerIds.every(id=>prev[id]!=null);
        if (sameSet) {
          // 트레이너 구성 동일 → 금액만 총액에 맞게(비율 유지) 스케일
          const sum = edit.trainerIds.reduce((s,id)=>s+prev[id],0) || total || 1;
          let acc=0;
          split = edit.trainerIds.map((id,i)=>{
            const amt = i===edit.trainerIds.length-1 ? total-acc : Math.round(total*(prev[id]/sum));
            acc+=amt; return { trainerId:id, amount:amt };
          });
        } else {
          // 구성 변경 → 균등(5:5)
          const n=edit.trainerIds.length, base=Math.floor(total/n);
          split = edit.trainerIds.map((id,i)=>({trainerId:id, amount: base+(i===0?total-base*n:0)}));
        }
      }
      // 정산비율 박제값: 현재 선택된 트레이너만 유지
      const splitRateAtPay = {};
      edit.trainerIds.forEach(id => {
        const r = edit.splitRateAtPay?.[id];
        if (r !== undefined && r !== null && r !== '') splitRateAtPay[id] = Number(r);
      });
      await store.updatePayment(p.memberId, p.id, {
        paidAt:edit.paidAt, amount:Number(edit.amount), method:edit.method,
        methods: edit.methods || [],
        trainerIds:edit.trainerIds, split, splitRateAtPay, note:edit.note,
        isUnpaid:edit.isUnpaid, isNew:edit.isNew, isReEnroll:edit.isReEnroll,
        consultTrainerId: edit.isNew ? (edit.consultTrainerId||'') : '',
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

  // 출석 데이터로 진행분(이미 수업한 회차 × 단가) 자동 계산
  const autoUsedAmount = (p) => {
    const mem = store.getMembers().find(m=>m.id===p.memberId);
    const ts = mem?.trainerSessions || {};
    const totalReg = Object.values(ts).reduce((s,v)=>s+(v.total||0),0);
    if (totalReg <= 0) return 0;
    const net = calcNet(p, settings).net;
    const unit = net / totalReg;                 // 단가 = 입금액 ÷ 등록횟수
    // 이 회원의 출석(노쇼 포함) 회차 수 — 결제의 담당 트레이너 기준(없으면 전체)
    const tids = (p.trainerIds && p.trainerIds.length) ? p.trainerIds : Object.keys(ts);
    const attended = store.getSchedules().filter(s =>
      !s.isExternal && s.memberId===p.memberId && tids.includes(s.trainerId) &&
      (s.status==='attended' || s.status==='noshow')
    ).length;
    return Math.round(unit * attended);
  };

  const handleRefund = async (p) => {
    const suggested = autoUsedAmount(p);
    const usedInput = window.prompt(
      `환불 처리 — ${p.memberName}\n총 결제액: ${won(p.amount)}\n\n` +
      `진행분(이미 수업한 회차 × 단가)을 입력하세요 (원):\n` +
      `· 출석 데이터 기준 자동 계산값: ${won(suggested)} (수정 가능)`,
      String(suggested));
    if (usedInput===null) return;
    const usedAmount = Number(usedInput)||0;
    const vat     = p.amount*(settings.vatRate/100);
    const penalty = p.amount*0.10;
    const refund  = Math.max(0, p.amount - vat - penalty - usedAmount);
    if (!window.confirm(
      `환불 산정 (계약서 10조 기준)\n` +
      `총 결제액 ${won(p.amount)}\n− 부가세 ${won(vat)}\n− 위약금 10% ${won(penalty)}\n− 진행분 ${won(usedAmount)}\n` +
      `= 환불액 ${won(refund)}\n\n` +
      `※ 환불은 오늘 날짜(이번 달) 매출에서 차감되고, 이 회원의 잔여 세션은 0으로 정리됩니다.\n` +
      `진행분 수업료는 트레이너 정산에 그대로 남습니다.\n\n이 결제를 환불 처리할까요?`)) return;
    try {
      await store.updatePayment(p.memberId, p.id, {
        isRefunded:true, refundAmount:refund, refundedAt:new Date().toISOString().slice(0,10),
        refundVat:vat, refundPenalty:penalty, refundUsed:usedAmount,
      });
      // 잔여 세션 0으로 자동 정리(진행분은 이미 정산에 반영됨)
      const mem = store.getMembers().find(m=>m.id===p.memberId);
      if (mem?.trainerSessions) {
        const ts = JSON.parse(JSON.stringify(mem.trainerSessions));
        Object.keys(ts).forEach(tid => { ts[tid] = { ...ts[tid], remaining: 0 }; });
        await store.updateMember(p.memberId, { trainerSessions: ts });
      }
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">결제 상세 내역 (관리자 수정)</h2>
        <div className="relative sm:w-64">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
          <input
            value={query}
            onChange={e=>setQuery(e.target.value)}
            placeholder="회원명·메모·수단·트레이너 검색"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-8 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500/40 focus:outline-none"
          />
          {query && (
            <button onClick={()=>setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-sm">✕</button>
          )}
        </div>
      </div>
      {(() => {
        const q = query.trim().toLowerCase();
        const shown = !q ? filtered : filtered.filter(p => {
          const trNames = (p.trainerIds||[]).map(id=>trainerMap[id]?.name||'').join(' ');
          const consult = p.consultTrainerId ? (trainerMap[p.consultTrainerId]?.name||'') : '';
          const methodTxt = Array.isArray(p.methods)&&p.methods.length
            ? p.methods.map(m=>METHOD_LBL[m.method]||m.method).join(' ')
            : (METHOD_LBL[p.method]||p.method||'');
          const hay = [p.memberName, p.note, methodTxt, trNames, consult,
            p.isRefunded?'환불':'', p.isUnpaid?'미수금':'', p.isNew?'신규':'', p.isReEnroll?'재등록':'']
            .join(' ').toLowerCase();
          return hay.includes(q);
        });
        return shown.length===0
          ? <p className="text-slate-600 text-sm text-center py-4">{q?'검색 결과가 없습니다':'내역이 없습니다'}</p>
          : <>
            {q && <p className="text-[11px] text-slate-500 mb-2">"{query}" 검색 — {shown.length}건</p>}
            <div className="space-y-2">
            {shown.map(p=>{
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
                      {METHODS.map(([v,l])=>{
                        const isMulti = (edit.methods||[]).length>=2;
                        const on = isMulti ? (edit.methods||[]).some(x=>x.method===v) : edit.method===v;
                        return (
                          <div key={v} onClick={()=>setEdit({...edit,method:v,methods:[]})}
                            className={`py-1.5 rounded-lg text-xs font-bold border cursor-pointer text-center ${on?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400'}`}>{l}</div>
                        );
                      })}
                    </div>
                    {(edit.methods||[]).length>=2 && (
                      <p className="text-[11px] text-sky-400">복합결제({edit.methods.map(x=>`${METHOD_LBL[x.method]||x.method} ${(Number(x.amount)||0).toLocaleString()}`).join(' · ')}) — 수단을 다시 누르면 단일결제로 바뀝니다.</p>
                    )}
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
                    {/* 정산비율은 정산월 자동판정으로 매달 결정됩니다(결제 건별 비율 지정은 사용 안 함).
                        특정 트레이너를 고정 비율로 두려면 설정 탭의 '트레이너별 정산비율'을 쓰세요. */}
                    <div className="flex flex-wrap gap-1.5">
                      {[['isUnpaid','미수금'],['isNew','신규'],['isReEnroll','재등록']].map(([k,l])=>(
                        <div key={k} onClick={()=>setEdit({...edit,[k]:!edit[k], ...(k==='isNew'&&!edit[k]?{isReEnroll:false}:{}), ...(k==='isReEnroll'&&!edit[k]?{isNew:false}:{})})}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${edit[k]?'border-amber-500/40 bg-amber-500/20 text-amber-400':'border-slate-700 text-slate-400'}`}>{l}</div>
                      ))}
                    </div>
                    {edit.isNew && (
                      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2">
                        <p className="text-[11px] text-slate-400 mb-1.5">상담 트레이너 (신규 인센티브·신규매출 귀속)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {trainers.map(t=>{
                            const on = edit.consultTrainerId===t.id;
                            return (
                              <div key={t.id} onClick={()=>setEdit({...edit, consultTrainerId:on?'':t.id})}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer flex items-center gap-1 ${on?'border-emerald-500/40 bg-emerald-500/10 text-emerald-400':'border-slate-700 text-slate-400'}`}>
                                <span className="w-2 h-2 rounded-full" style={{background:t.color||'#94a3b8'}}/>{t.name}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
                      {Array.isArray(p.methods)&&p.methods.length
                        ? <span className="text-[10px] font-bold flex flex-wrap gap-1">
                            {p.methods.map((mm,i)=>(
                              <span key={i} className={METHOD_CLR[mm.method]||'text-slate-300'}>
                                {METHOD_LBL[mm.method]||mm.method} {(Number(mm.amount)||0).toLocaleString()}{i<p.methods.length-1?' ·':''}
                              </span>
                            ))}
                          </span>
                        : <span className={`text-[10px] font-bold ${METHOD_CLR[p.method]||'text-slate-300'}`}>{METHOD_LBL[p.method]||p.method}</span>}
                      {p.isUnpaid && <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold">미수금</span>}
                      {p.isNew && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold">신규{p.consultTrainerId?` · 상담 ${trainerMap[p.consultTrainerId]?.name||'?'}`:''}</span>}
                      {p.isReEnroll && <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded font-bold">재등록</span>}
                      {p.category==='edu_center' && <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">센터교육</span>}
                      {p.category==='edu_external' && <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">외부활동</span>}
                      {p.isRefunded && <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded font-bold">환불완료</span>}
                    </div>
                    {p.trainerIds?.length>0 &&
                      <p className="text-[11px] text-slate-400 mt-0.5">담당: {p.trainerIds.map(id=>{
                        const r = p.splitRateAtPay?.[id];
                        return `${trainerMap[id]?.name||'?'}${r!=null&&r!==''?` ${r}%`:''}`;
                      }).join(', ')}</p>}
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
            </div>
          </>;
      })()}
    </div>
  );
}

/* ─────────────────────────────── 정산 ─────────────────────────────── */
function SettleTab({ settings, trainers, trainerMap }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [ym, setYm] = useState(thisMonth);

  const allPaymentsGrouped = useMemo(()=>{
    const g = {}; store.getMembers().forEach(m=>{ g[m.id] = store.getPayments(m.id); }); return g;
  }, [refreshKey]);
  const members   = useMemo(()=>store.getMembers(), [refreshKey]);
  const schedules = useMemo(()=>store.getSchedules(), [refreshKey]);
  const records   = useMemo(()=>store.getPromos(), [refreshKey]);

  const blocks = useMemo(()=>computeSessionSettlement({
    trainers, members, schedules, payments: allPaymentsGrouped, records, settings, ym,
    getOverride: (tid, m) => store.getSettleOverride(tid, m),
  }), [trainers, members, schedules, allPaymentsGrouped, records, settings, ym, refreshKey]);

  const monthOptions = useMemo(()=>{
    const set = new Set();
    store.getMembers().forEach(m=>(store.getPayments(m.id)||[]).forEach(p=>p.paidAt&&set.add(p.paidAt.slice(0,7))));
    store.getSchedules().forEach(s=>s.date&&set.add(s.date.slice(0,7)));
    set.add(ym);
    return [...set].sort().reverse();
  }, [ym, refreshKey]);

  // ── 이 달 정산비율 확정(재박제) ───────────────────────────────────
  // 선택한 달(ym)에 결제가 발생한 회원들의 splitRateAtPay를, 그 달 전체 실적으로
  // 다시 판정해 갱신한다. 다른 달 결제는 건드리지 않는다.
  const [freezing, setFreezing] = useState(false);
  const handleRefreeze = async () => {
    const members2 = store.getMembers();
    const grouped = {}; members2.forEach(m=>{ grouped[m.id] = store.getPayments(m.id); });
    const plan = buildRefreezePlan({
      trainers, members: members2, payments: grouped,
      records: store.getPromos(), settings: store.getSettings(), ym,
    });
    if (plan.count === 0) {
      alert(`${ym} 정산비율을 그 달 전체 실적으로 다시 계산했지만, 바뀌는 결제가 없습니다.\n(이미 최종 실적과 일치하거나, 그 달 결제가 없습니다.)`);
      return;
    }
    // 변동 내역 미리보기 (최대 12건)
    const lines = plan.patches.slice(0,12).map(pt=>{
      const involved = Object.keys(pt.splitRateAtPay);
      const desc = involved.map(tid=>{
        const before = pt.prev?.[tid]; const after = pt.splitRateAtPay[tid];
        return `${trainerMap[tid]?.name||tid} ${before??'-'}%→${after}%`;
      }).join(', ');
      return `· ${pt.memberName} (${pt.paidAt}): ${desc}`;
    }).join('\n');
    const more = plan.count > 12 ? `\n…외 ${plan.count-12}건` : '';
    if (!window.confirm(
      `${ym} 정산비율을 그 달 전체 실적 기준으로 확정합니다.\n`+
      `변동되는 결제: ${plan.count}건\n\n${lines}${more}\n\n`+
      `이 작업은 해당 결제의 정산비율을 새로 고정합니다. 진행할까요?`
    )) return;
    setFreezing(true);
    try {
      for (const pt of plan.patches) {
        await store.updatePayment(pt.mid, pt.pid, { splitRateAtPay: pt.splitRateAtPay });
      }
      setRefreshKey(k=>k+1);
      alert(`완료: ${plan.count}건의 정산비율을 ${ym} 최종 실적으로 확정했습니다.`);
    } catch (e) {
      alert('확정 중 오류가 발생했습니다. 네트워크 확인 후 다시 시도하세요.');
    } finally {
      setFreezing(false);
    }
  };

  const grandSession = blocks.reduce((s,b)=>s+b.sessionTotal,0);
  const grandSessionPayout = blocks.reduce((s,b)=>s+(b.sessionPayout??b.sessionTotal),0);
  const grandInc     = blocks.reduce((s,b)=>s+b.promoIncentive,0);
  const grandPayout  = blocks.reduce((s,b)=>s+b.payout,0);            // 세전
  const grandTax     = blocks.reduce((s,b)=>s+(b.tax||0),0);
  const grandNet     = blocks.reduce((s,b)=>s+(b.payoutNet??b.payout),0); // 세후

  const exportCSV = () => {
    const header = ['트레이너','회원','등록횟수','단가','월수업횟수','수업료','정산비율','실지급'];
    const body = [];
    blocks.forEach(b=>{
      b.rows.forEach(r=>body.push([b.trainer.name, r.memberName, r.regTotal, r.unit, r.cnt, r.amount, `${r.rate}%${r.rateFrozen?'(등록월)':''}`, r.payAmount]));
      body.push([b.trainer.name,'수업료 합계','','','', b.sessionTotal, b.rateMixed?'혼합':`${b.splitRate}%`, b.sessionPayout]);
      body.push([b.trainer.name,'블로그','', '', b.blogCount, b.blogInc,'','']);
      body.push([b.trainer.name,'인스타','', '', b.instaCount, b.instaInc,'','']);
      body.push([b.trainer.name,'스터디','', '', b.studyCount, '','','']);
      body.push([b.trainer.name,'합계(세전)','','','','','', b.payout]);
      body.push([b.trainer.name,`원천징수(${b.withholdingRate??3.3}%)`,'','','','','', -b.tax]);
      body.push([b.trainer.name,'세후 실지급','','','','','', b.payoutNet]);
    });
    downloadCSV(`정산_${ym}.csv`, [header, ...body]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="month" value={ym} onChange={e=>setYm(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"/>
        <select value={ym} onChange={e=>setYm(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm">
          {monthOptions.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-[11px] text-slate-500 ml-auto">임금지급일: 매월 {settings.paydayDay||5}일</span>
        <button onClick={handleRefreeze} disabled={freezing}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-500/10 border border-amber-500/40 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40">
          {freezing ? '확정 중…' : '🔒 이 달 정산비율 확정'}
        </button>
        <button onClick={exportCSV} disabled={blocks.length===0}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/40 hover:text-amber-400 transition-colors disabled:opacity-40">
          📄 정산표 내보내기
        </button>
      </div>
      <p className="text-[11px] text-slate-500 -mt-3">
        🔒 “이 달 정산비율 확정”은 선택한 달에 결제가 발생한 회원들의 정산비율을, 그 달 전체 실적(블로그·스터디·매출)으로 다시 판정해 고정합니다. 보통 월말(말일 이후)에 한 번 누르며, 다른 달 결제는 바뀌지 않습니다.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="수업료 합계" value={won(grandSession)} color="text-slate-300"/>
        <Card label="실지급 수업료(비율적용)" value={won(grandSessionPayout)} color="text-emerald-400"/>
        <Card label="인센티브 합계" value={won(grandInc)} color="text-blue-400"/>
        <Card label="총 지급액(세전)" value={won(grandPayout)} color="text-amber-400"/>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card label="세전 합계" value={won(grandPayout)} color="text-slate-300"/>
        <Card label={`원천징수(${settings.withholdingRate??3.3}%)`} value={`- ${won(grandTax)}`} color="text-red-400"/>
        <Card label="세후 실지급 합계" value={won(grandNet)} color="text-amber-400"/>
      </div>

      <p className="text-[11px] text-slate-500 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
        단가·월 수업횟수는 결제·출석 데이터에서 자동 집계됩니다. 단가 = 공제 후 입금금액 ÷ 등록횟수 (카드1·2: 부가세+카드수수료 / 페이·현금영수증: 부가세 / 계좌·현금: 공제 없음) · 출석과 노쇼는 수업 횟수에 포함, 취소·외부·상담은 제외. 셀을 눌러 직접 수정할 수 있어요.
      </p>

      <RecordManager trainers={trainers} period={ym} mode="month"/>

      {blocks.length===0
        ? <p className="text-slate-600 text-sm text-center py-6 bg-slate-900 border border-slate-800 rounded-2xl">해당 월 정산 내역이 없습니다</p>
        : blocks.map(b=>(
          <TrainerSettleCard key={b.trainer.id} block={b} ym={ym} settings={settings}
            onSaved={()=>setRefreshKey(k=>k+1)}/>
        ))}
    </div>
  );
}

// 트레이너별 정산 카드 (회원 단가/횟수 직접 수정 가능)
function TrainerSettleCard({ block: b, ym, settings, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [unitEdits, setUnitEdits] = useState({});   // memberId -> 단가
  const [cntEdits, setCntEdits]   = useState({});   // memberId -> 횟수
  const [blog, setBlog] = useState(b.blogCount);
  const [insta, setInsta] = useState(b.instaCount);
  const [study, setStudy] = useState(b.studyCount);

  const startEdit = () => {
    const u={}, c={};
    b.rows.forEach(r=>{ u[r.memberId]=r.unit; c[r.memberId]=r.cnt; });
    setUnitEdits(u); setCntEdits(c); setBlog(b.blogCount); setInsta(b.instaCount); setStudy(b.studyCount);
    setEditing(true);
  };
  const save = async () => {
    try {
      await store.saveSettleOverride(b.trainer.id, ym, {
        unitPrices: Object.fromEntries(Object.entries(unitEdits).map(([k,v])=>[k,Number(v)||0])),
        sessionCounts: Object.fromEntries(Object.entries(cntEdits).map(([k,v])=>[k,Number(v)||0])),
        blogCount: Number(blog)||0, instaCount: Number(insta)||0, studyCount: Number(study)||0,
      });
      setEditing(false); onSaved?.();
    } catch(e){ alert('저장에 실패했습니다.'); }
  };

  // 편집 중 미리보기: 각 회원 행의 박제비율(r.rate)을 유지하고 단가·횟수만 반영
  const liveRows = b.rows.map(r => {
    const u = editing ? (Number(unitEdits[r.memberId])||0) : r.unit;
    const c = editing ? (Number(cntEdits[r.memberId])||0) : r.cnt;
    const amount = u*c;
    return { ...r, _u:u, _c:c, _amount:amount, _pay: Math.round(amount * (r.rate/100)) };
  });
  const liveSessionTotal  = liveRows.reduce((s,r)=>s+r._amount,0);
  const liveSessionPayout = liveRows.reduce((s,r)=>s+r._pay,0);
  const liveBlendedRate   = liveSessionTotal>0 ? Math.round(liveSessionPayout/liveSessionTotal*100) : b.splitRate;
  const liveTotal = editing
    ? liveSessionPayout
      + Number(blog||0)*settings.promoPerPost
      + Math.min(Number(insta||0), settings.snsInstaMax??8)*settings.promoPerPost
    : b.payout;
  const liveSplit = { rate: editing ? liveBlendedRate : b.splitRate, mode: b.splitMode, reason: b.splitReason };

  const INP = "w-20 bg-slate-900 border border-slate-600 text-slate-100 rounded px-1.5 py-1 text-xs font-mono text-right";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-3 h-3 rounded-full" style={{background:b.trainer.color||'#94a3b8'}}/>
          <span className="font-bold">{b.trainer.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
            liveSplit.rate>=60 ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
            : liveSplit.rate>=50 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
            : 'bg-slate-700/40 text-slate-300 border-slate-600'
          }`} title={liveSplit.reason}>
            정산 {b.rateMixed?`혼합 ${liveSplit.rate}%`:`${liveSplit.rate}%`}{liveSplit.mode==='manual'?' (수동)':liveSplit.mode==='frozen'?' (등록월)':' (자동)'}
          </span>
          {b.hasOverride && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">수정됨</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-mono font-black text-amber-400">{won(liveTotal)}</span>
          {editing
            ? <><button onClick={()=>setEditing(false)} className="text-xs text-slate-400 hover:text-white">취소</button>
                <button onClick={save} className="text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg">저장</button></>
            : <button onClick={startEdit} className="text-xs text-slate-400 hover:text-blue-400">수정</button>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left font-semibold py-1.5">회원</th>
              <th className="text-right font-semibold">등록</th>
              <th className="text-right font-semibold">단가</th>
              <th className="text-right font-semibold">월 횟수</th>
              <th className="text-right font-semibold">수업료</th>
              <th className="text-right font-semibold">비율</th>
              <th className="text-right font-semibold">실지급</th>
            </tr>
          </thead>
          <tbody>
            {liveRows.map(r=>{
              const u = editing ? (unitEdits[r.memberId] ?? r.unit) : r.unit;
              const c = editing ? (cntEdits[r.memberId] ?? r.cnt) : r.cnt;
              return (
                <tr key={r.memberId} className="border-b border-slate-800/50">
                  <td className="py-1.5 text-slate-200">{r.memberName}</td>
                  <td className="text-right text-slate-500">{r.regTotal}회</td>
                  <td className="text-right">
                    {editing
                      ? <input type="number" value={u} onChange={e=>setUnitEdits(s=>({...s,[r.memberId]:e.target.value}))} className={INP}/>
                      : <span className="font-mono text-slate-300">{won(r.unit)}</span>}
                  </td>
                  <td className="text-right">
                    {editing
                      ? <input type="number" value={c} onChange={e=>setCntEdits(s=>({...s,[r.memberId]:e.target.value}))} className={INP}/>
                      : <span className="font-mono text-slate-300">{r.cnt}회{r.cnt!==r.autoCnt?'*':''}</span>}
                  </td>
                  <td className="text-right font-mono text-slate-400">
                    {won(r._amount)}
                  </td>
                  <td className="text-right">
                    <span className={`font-mono text-[11px] px-1 rounded ${r.rateFrozen?'text-violet-300':'text-slate-400'}`}
                      title={r.rateFrozen?'등록월에 고정된 비율':'그 달 자동판정 비율'}>{r.rate}%{r.rateFrozen?'🔒':''}</span>
                  </td>
                  <td className="text-right font-mono font-bold text-emerald-400">
                    {won(r._pay)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">블로그 인센티브</span>
          {editing
            ? <span className="flex items-center gap-1"><input type="number" value={blog} onChange={e=>setBlog(e.target.value)} className="w-12 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-right"/>회</span>
            : <span className="font-mono font-bold text-blue-400">{b.blogCount}회 · {won(b.blogInc)}</span>}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">인스타 인센티브</span>
          {editing
            ? <span className="flex items-center gap-1"><input type="number" value={insta} onChange={e=>setInsta(e.target.value)} className="w-12 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-right"/>회</span>
            : <span className="font-mono font-bold text-pink-400">{b.instaCount}회{b.instaCount>(settings.snsInstaMax??8)?`(지급 ${settings.snsInstaMax??8})`:''} · {won(b.instaInc)}</span>}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">스터디 (50% 조건)</span>
          {editing
            ? <span className="flex items-center gap-1"><input type="number" value={study} onChange={e=>setStudy(e.target.value)} className="w-12 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-right"/>회</span>
            : <span className="font-mono font-bold text-purple-400">{b.studyCount}회</span>}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">블로그 (50% 조건)</span>
          <span className="font-mono font-bold text-blue-400">{editing?Number(blog||0):b.blogCount}회</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">신규매출 인센티브</span>
          <span className="font-mono font-bold text-emerald-400">
            {won(b.newSales)}{b.newInc>0?` · +${won(b.newInc)}`:''}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">재등록매출 인센티브</span>
          <span className="font-mono font-bold text-teal-400">
            {won(b.reEnrollSales)}{b.reInc>0?` · +${won(b.reInc)}`:''}
          </span>
        </div>
        <div className="flex items-center justify-between col-span-2 pt-1.5 border-t border-slate-800/50">
          <span className="text-slate-400 font-semibold">수업료 합계</span>
          <span className="font-mono font-bold text-slate-300">{won(liveSessionTotal)}</span>
        </div>
        <div className="flex items-center justify-between col-span-2">
          <span className="text-slate-400 font-semibold">{b.rateMixed?`정산비율 회원별 혼합(가중 ${liveSplit.rate}%) = 실지급 수업료`:`× 정산비율 ${liveSplit.rate}% = 실지급 수업료`}</span>
          <span className="font-mono font-bold text-emerald-400">{won(liveSessionPayout)}</span>
        </div>
        <p className="col-span-2 text-[10px] text-slate-600 leading-relaxed">
          {b.rateMixed ? '회원마다 등록월에 정해진 비율이 고정 적용됩니다(🔒=등록월 고정).' : liveSplit.reason}
        </p>
        {/* 세전 → 원천징수 → 세후 */}
        <div className="flex items-center justify-between col-span-2 pt-1.5 border-t border-slate-800/50">
          <span className="text-slate-400 font-semibold">총 지급액(세전)</span>
          <span className="font-mono font-bold text-slate-200">{won(liveTotal)}</span>
        </div>
        <div className="flex items-center justify-between col-span-2">
          <span className="text-slate-500">원천징수 ({b.withholdingRate ?? settings.withholdingRate ?? 3.3}%)</span>
          <span className="font-mono font-bold text-red-400">- {won(Math.round(liveTotal*((b.withholdingRate ?? settings.withholdingRate ?? 3.3)/100)))}</span>
        </div>
        <div className="flex items-center justify-between col-span-2">
          <span className="text-amber-400 font-bold">세후 실지급</span>
          <span className="font-mono font-black text-amber-400 text-base">{won(liveTotal - Math.round(liveTotal*((b.withholdingRate ?? settings.withholdingRate ?? 3.3)/100)))}</span>
        </div>
      </div>
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
  const [collapsed, setCollapsed] = useState(true);
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
  const CH = { blog:'블로그', insta:'인스타그램', study:'스터디' };
  const CH_CLR = { blog:'text-blue-400', insta:'text-pink-400', study:'text-purple-400' };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={()=>setCollapsed(c=>!c)} className="flex items-center gap-2 group">
          <span className={`text-slate-500 transition-transform ${collapsed?'':'rotate-90'}`}>▶</span>
          <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 group-hover:text-slate-200">📣 SNS · 스터디 기록</h2>
          <span className="text-[11px] text-slate-500">({list.length}건)</span>
        </button>
        {!collapsed && (
          <button onClick={()=>setOpen(!open)} className="text-xs text-amber-400 hover:text-amber-300 font-semibold">+ 기록 추가</button>
        )}
      </div>
      {!collapsed && <>
      {open && (
        <div className="mb-3 p-3 bg-slate-800 rounded-xl grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <select value={form.trainerId} onChange={e=>setForm({...form,trainerId:e.target.value})}
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm">
            {trainers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-sm">
            <option value="blog">SNS-블로그</option>
            <option value="insta">SNS-인스타그램</option>
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
                  {tMap[p.trainerId]||'?'} · <span className={CH_CLR[p.channel]||'text-slate-400'}>{CH[p.channel]||p.channel}</span> · {p.date}
                  {p.note && <span className="text-slate-500"> · {p.note}</span>}
                </span>
                <button onClick={()=>del(p.id)} className="text-slate-600 hover:text-red-400">삭제</button>
              </div>
            ))}
          </div>}
      <p className="text-[11px] text-slate-600 mt-2">* SNS-블로그: 1회차부터 지급(상한 없음) · SNS-인스타: 최대 8회 · 1건당 1만원 / 50%: 블로그2+스터디1 또는 매출300만 중 1개 · 60%: 둘 다</p>
      </>}
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
        <p className="text-[11px] text-slate-600">공제 규칙 — 카드1·카드2: 부가세+카드수수료 / 페이·현금영수증: 부가세만 / 계좌·현금: 공제 없음</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">정산 비율 (계약서 4조)</h2>
        <p className="text-[11px] text-slate-500">등록월의 트레이너 실적으로 비율을 판정해 그 회원 등록분에 고정 — 조건A(블로그2·스터디1)와 조건B(신규/재등록 매출 임계 이상): 둘 다 충족 60% / 하나만 50% / 모두 미달 40% · 수동은 트레이너 고정</p>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="하한 비율(조건 미달)" k="lowSplitRate" suffix="%" form={form} setForm={setForm}/>
          <NumField label="60% 조건 (신규 또는 재등록 매출)" k="rate60MinSales" suffix="원" form={form} setForm={setForm}/>
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
          <NumField label="SNS 1건당" k="promoPerPost" suffix="원" form={form} setForm={setForm}/>
          <NumField label="인스타 최대" k="snsInstaMax" suffix="회" form={form} setForm={setForm}/>
          <NumField label="신규매출 단위" k="incentivePer" suffix="원" form={form} setForm={setForm}/>
          <NumField label="신규 단위당" k="incentiveAmount" suffix="원" form={form} setForm={setForm}/>
          <NumField label="재등록매출 단위" k="reEnrollPer" suffix="원" form={form} setForm={setForm}/>
          <NumField label="재등록 단위당" k="reEnrollAmount" suffix="원" form={form} setForm={setForm}/>
          <NumField label="임금지급일" k="paydayDay" suffix="일" form={form} setForm={setForm}/>
        </div>
        <p className="text-[11px] text-slate-600">* 신규·재등록 매출 100만원당 1만원 인센티브 / SNS-블로그는 1회차부터 지급(상한 없음), SNS-인스타는 최대 8회</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">세금 (세전/세후)</h2>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="원천징수 세율 (국세+지방세)" k="withholdingRate" suffix="%" form={form} setForm={setForm}/>
        </div>
        <p className="text-[11px] text-slate-600">* 세후 = 세전 − (세전 × 원천징수율). 기본 3.3%. 실제 세액은 매달 세무신고 후 확정되므로 추정치이며, 확정값에 맞춰 조정하세요.</p>
      </div>

      <button onClick={save}
        className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 rounded-2xl transition-colors">
        {saved ? '✓ 저장됨' : '설정 저장'}
      </button>
    </div>
  );
}
