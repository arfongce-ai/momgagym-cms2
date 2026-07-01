// Revenue.jsx — 매출관리 (관리자 전용)
// 탭: 개요 / 정산 / 지출 / 설정
//  · 입금금액 = 결제금액 − 카드수수료 − 부가세
//  · 다수 트레이너 결제는 입금금액 1/n 귀속
//  · 정산 = 트레이너별 입금금액 × 정산비율(40/50/60%)
//  · 인센티브 = 홍보 기록 + 개인/재등록 매출 단위
//  · 고정비/월별 지출, 월/년 정산
import { useState, useMemo, useRef } from 'react';
import { store } from '../demoData';
import { useAuth } from '../contexts/AuthContext';
import {
  METHOD_LBL, METHOD_CLR, won, monthKey, yearKey,
  calcNet, downloadCSV, computeSessionSettlement,
  buildRefreezePlan,
} from '../services/finance';
import { todayYMD, thisYM, thisYear } from '../utils/dates';
import { getUserTrainerId } from '../utils/memberList';
import { parseSheetRows, dedupeExpenses, parsePastedText } from '../utils/expenseImport';
import { loadXLSX } from '../utils/loadXlsx';

// CV-A: UTC 기준이라 매월 1일 새벽에 '지난달'로 표시되던 버그 → 로컬 기준으로 수정
const thisMonth = thisYM();

function Card({ label, value, color='text-slate-100', sub }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</span>
      <p className={`text-xl font-black font-mono mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

const settlementPartsOf = (row) =>
  (row?.unitManual || row?.cntManual || row?.rateManual)
    ? []
    : Array.isArray(row?.settlementBreakdown)
    ? row.settlementBreakdown.filter(x => (Number(x.count)||0) > 0)
    : [];

const settlementDetailText = (row) => {
  const parts = settlementPartsOf(row);
  if (!parts.length) return row?.regRound || '등록';
  return parts.map(x => `${x.label} ${x.count}회 × ${won(x.unit)}`).join(' / ');
};

const settlementUnitText = (row) => {
  const parts = settlementPartsOf(row);
  return parts.length ? parts.map(x => won(x.unit)).join(' / ') : row?.unit;
};

const TABS = [['overview','개요'],['settle','정산'],['expense','지출'],['config','설정']];

export default function Revenue() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');

  const settings = store.getSettings();
  const trainers = store.getTrainers();
  const trainerMap = Object.fromEntries(trainers.map(t=>[t.id,t]));

  // 트레이너 모드: 본인 정산 + 본인 SNS·스터디 기록만(보기 전용). 개요·지출·설정 숨김.
  if (user?.role !== 'admin') {
    const myTid = getUserTrainerId(user) || user?.trainerId || null;
    const me = trainers.find(t => t.id === myTid);
    if (!myTid) {
      return <p className="text-slate-500 text-center py-10">정산 정보를 불러올 수 없습니다. 관리자에게 문의하세요.</p>;
    }
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">💰 내 정산</h1>
          <p className="text-slate-500 text-sm mt-1">{me?.name||'트레이너'}님 · {thisMonth} 기준</p>
        </div>
        {/* 추정치 안내 — 확정 지급액이 아님을 명확히 */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <span className="text-lg leading-none">ℹ️</span>
          <p className="text-[13px] text-amber-200/90 leading-relaxed">
            <span className="font-bold text-amber-300">예상 정산액(추정치)</span>입니다. 출석·SNS·매출 데이터로 자동 계산되며,
            월말 확정·정산 검토 과정에서 <span className="font-semibold">실제 지급액과 달라질 수 있습니다.</span>
          </p>
        </div>
        <SettleTab settings={settings} trainers={trainers} trainerMap={trainerMap} scopeTid={myTid} readOnly estimate />
      </div>
    );
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
// 유효한 YYYY-MM 키만 통과(잘못된 날짜로 생긴 'NaN-NaN' 등 제외)
const isValidMonthKey = (k) => /^\d{4}-\d{2}$/.test(k);
const isValidYearKey  = (k) => /^\d{4}$/.test(k);

function OverviewTab({ settings, trainers, trainerMap }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k=>k+1);
  const allPayments = useMemo(()=>store.getAllPayments()
    .sort((a,b)=>new Date(b.paidAt)-new Date(a.paidAt)), [refreshKey]);

  // 결제가 발생한 모든 월/연도(유효한 키만)
  const months = useMemo(()=>{
    const set = new Set(allPayments.map(p=>monthKey(p.paidAt)).filter(isValidMonthKey));
    return [...set].sort().reverse();
  }, [allPayments]);

  const years = useMemo(()=>{
    const set = new Set(allPayments.map(p=>yearKey(p.paidAt)).filter(isValidYearKey));
    return [...set].sort().reverse();
  }, [allPayments]);

  // 기간 선택: 연 단위(YYYY) / 특정 월(YYYY-MM) / 전체(all)
  //  · 기본값은 올해. 올해 데이터가 없으면 가장 최근 연도.
  const defaultYear = years.includes(thisYear()) ? thisYear() : (years[0] || thisYear());
  const [period, setPeriod] = useState(defaultYear);

  // period 해석
  const isAll   = period === 'all';
  const isYear  = isValidYearKey(period);
  const isMonth = isValidMonthKey(period);

  const filtered = useMemo(()=>{
    if (isAll)   return allPayments;
    if (isYear)  return allPayments.filter(p=>yearKey(p.paidAt)===period);
    return allPayments.filter(p=>monthKey(p.paidAt)===period);
  }, [allPayments, period, isAll, isYear]);

  const paid   = filtered.filter(p=>!p.isUnpaid && !p.isRefunded);
  const unpaid = filtered.filter(p=>p.isUnpaid && !p.isRefunded);
  // 이 기간에 환불된 결제 — 환불액을 매출에서 차감(환불일 기준)
  const refundedThisPeriod = allPayments.filter(p=>p.isRefunded && p.refundedAt && (
    isAll ? true
    : isYear ? p.refundedAt.slice(0,4)===period
    : p.refundedAt.slice(0,7)===period
  ));
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

  // 월별 추이 데이터(유효한 키만). 연 단위 선택 시 해당 연도 12개월,
  // 전체/특정월 선택 시 전체 월을 대상으로 한다.
  const byMonth = useMemo(()=>{
    const acc={}; allPayments.filter(p=>!p.isUnpaid && !p.isRefunded).forEach(p=>{
      const k=monthKey(p.paidAt);
      if (!isValidMonthKey(k)) return;
      acc[k]=(acc[k]||0)+calcNet(p,settings).net; });
    return Object.entries(acc).sort((a,b)=>a[0].localeCompare(b[0]));
  }, [allPayments, settings]);

  // 차트에 보일 월 목록
  //  · 연 단위: 그 해 1~12월을 모두 자리 채움(데이터 없으면 0)
  //  · 그 외: 데이터가 있는 월만
  const chartRows = useMemo(()=>{
    if (isYear) {
      const map = Object.fromEntries(byMonth);
      return Array.from({length:12}, (_,i)=>{
        const k = `${period}-${String(i+1).padStart(2,'0')}`;
        return [k, map[k]||0];
      });
    }
    return byMonth;
  }, [byMonth, isYear, period]);
  const maxMonth = Math.max(1, ...chartRows.map(([,v])=>v));

  // 이 기간에 해당하는 월 목록(고정비·정산 합산 기준)
  //  · 특정 월: 그 달 1개 / 연 단위: 그 해에 결제가 있는 달 / 전체: 전 기간
  const periodMonths = useMemo(()=>{
    if (isMonth) return [period];
    if (isYear)  return months.filter(m=>m.slice(0,4)===period);
    return months;
  }, [isMonth, isYear, period, months]);

  // 지출 / 순익 (시트의 총매출→입금→고정지출→순익 흐름)
  const expenses = store.getExpenses();
  const fixedTotal = expenses.filter(e=>e.kind==='fixed').reduce((s,e)=>s+(e.amount||0),0);
  const monthlyExpense = isMonth
    ? expenses.filter(e=>e.kind==='monthly' && e.ym===period).reduce((s,e)=>s+(e.amount||0),0)
    : isYear
    ? expenses.filter(e=>e.kind==='monthly' && (e.ym||'').slice(0,4)===period).reduce((s,e)=>s+(e.amount||0),0)
    : expenses.filter(e=>e.kind==='monthly').reduce((s,e)=>s+(e.amount||0),0);
  // 고정비: 특정 월=1회분 / 연·전체=해당 기간에 결제가 있던 달 수만큼 합산(정산 합산과 대칭)
  const fixedApplied = isMonth ? fixedTotal : fixedTotal * periodMonths.length;
  const totalExpense = fixedApplied + monthlyExpense;

  // 트레이너 정산 지급액 — 회당단가×횟수 방식과 일치
  //  · 특정 월: 그 달만 계산
  //  · 연/전체: 해당 기간의 모든 달을 각각 계산해 합산(정산은 월 단위라 단순 합이 불가)
  const settlePayout = useMemo(()=>{
    const grouped = {}; store.getMembers().forEach(m=>{ grouped[m.id]=store.getPayments(m.id); });
    const calcMonth = (ym) => computeSessionSettlement({
      trainers, members: store.getMembers(), schedules: store.getSchedules(),
      payments: grouped, records: store.getPromos(), settings, ym,
      getOverride: (tid,m)=>store.getSettleOverride(tid,m),
    }).reduce((s,b)=>s+b.payout, 0);
    return periodMonths.reduce((s,ym)=>s+calcMonth(ym), 0);
  }, [allPayments, trainers, settings, periodMonths]);

  const netProfit = totals.net - settlePayout - totalExpense;

  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-2 flex-wrap">
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
          const tag = isAll ? '전체' : isYear ? `${period}년` : period;
          downloadCSV(`매출_${tag}.csv`, [header, ...body]);
        }} disabled={filtered.length===0}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/40 hover:text-amber-400 transition-colors disabled:opacity-40">
          📄 매출내역 내보내기
        </button>
        <select value={period} onChange={e=>setPeriod(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
          {years.length>0 && (
            <optgroup label="연 단위">
              {years.map(y=><option key={y} value={y}>{y}년 전체</option>)}
            </optgroup>
          )}
          {months.length>0 && (
            <optgroup label="월 단위">
              {months.map(m=><option key={m} value={m}>{m.replace('-','년 ')}월</option>)}
            </optgroup>
          )}
          <option value="all">전체 기간</option>
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

      {/* 월별 추이 (입금금액 기준) — 선택한 기간만 강조, 나머지는 접기 */}
      <MonthlyTrend rows={chartRows} maxMonth={maxMonth} period={period} isMonth={isMonth} isYear={isYear}/>

      {/* 순익 요약 (시트: 총매출 → 입금 → 지출 → 순익) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">
          {isAll ? '전체 손익 요약' : isYear ? `${period}년 손익 요약` : `${period} 손익 요약`}
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">총매출</span><span className="font-mono font-bold text-slate-200">{won(totals.amount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">입금금액</span><span className="font-mono font-bold text-emerald-400">{won(totals.net)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">트레이너 정산</span><span className="font-mono font-bold text-red-400">- {won(settlePayout)}</span></div>
          <div className="flex justify-between">
            <span className="text-slate-400">고정지출{!isMonth && periodMonths.length>0 ? ` (${periodMonths.length}개월)` : ''}</span>
            <span className="font-mono font-bold text-red-400">- {won(fixedApplied)}</span>
          </div>
          <div className="flex justify-between"><span className="text-slate-400">{isMonth?'당월 지출':'월별 지출'}</span><span className="font-mono font-bold text-red-400">- {won(monthlyExpense)}</span></div>
          <div className="flex justify-between pt-2 border-t border-slate-800">
            <span className="font-bold text-amber-400">순익</span>
            <span className={`font-mono font-black text-lg ${netProfit>=0?'text-amber-400':'text-red-400'}`}>{won(netProfit)}</span>
          </div>
        </div>
        {!isMonth && <p className="text-[11px] text-slate-600 mt-2">* {isYear?`${period}년`:'전체 기간'} 고정지출은 결제가 발생한 {periodMonths.length}개월분을 합산한 값입니다. 특정 월을 선택하면 그 달 기준으로 보여집니다.</p>}
      </div>

      {/* 상세 + 담당 트레이너 + 환불 */}
      <RefundableList filtered={filtered} settings={settings} trainers={trainers} trainerMap={trainerMap} onChange={refresh}/>
    </div>
  );
}

/* 월별 입금금액 추이 — 선택 기간을 강조하고 나머지는 접었다 펼침
 *  · 특정 월 선택: 그 달만 펼친 채로, 나머지 달은 '다른 달 보기'로 접기
 *  · 연/전체 선택: 전체 표시(연 단위는 1~12월 자리 채움)
 */
function MonthlyTrend({ rows, maxMonth, period, isMonth, isYear }) {
  const [showAll, setShowAll] = useState(false);
  const fmtMonth = (k) => k; // YYYY-MM 그대로

  const Bar = ({ k, v, highlight }) => (
    <div className="flex items-center gap-3">
      <span className={`text-xs w-16 flex-shrink-0 ${highlight?'text-amber-400 font-bold':'text-slate-500'}`}>{fmtMonth(k)}</span>
      <div className="flex-1 bg-slate-800 rounded-full h-5 overflow-hidden">
        <div className={`h-full rounded-full ${highlight?'bg-amber-400':'bg-amber-500/70'}`}
          style={{width:`${(v/maxMonth)*100}%`}}/>
      </div>
      <span className={`text-xs font-mono font-bold w-24 text-right flex-shrink-0 ${highlight?'text-amber-300':'text-slate-300'}`}>{won(v)}</span>
    </div>
  );

  if (rows.length===0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">월별 입금금액 추이</h2>
        <p className="text-slate-600 text-sm text-center py-3">데이터가 없습니다</p>
      </div>
    );
  }

  // 특정 월 선택: 그 달만 보이고 나머지는 접기
  if (isMonth) {
    const sel = rows.find(([k])=>k===period);
    const others = rows.filter(([k])=>k!==period);
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">월별 입금금액 추이</h2>
          {others.length>0 && (
            <button onClick={()=>setShowAll(s=>!s)}
              className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1">
              <span className={`transition-transform ${showAll?'rotate-90':''}`}>▶</span>
              {showAll?'다른 달 접기':`다른 달 보기 (${others.length})`}
            </button>
          )}
        </div>
        <div className="space-y-2">
          {sel
            ? <Bar k={sel[0]} v={sel[1]} highlight/>
            : <p className="text-slate-600 text-sm text-center py-2">{period}월 입금 내역이 없습니다</p>}
          {showAll && others
            .sort((a,b)=>b[0].localeCompare(a[0]))
            .map(([k,v])=><Bar key={k} k={k} v={v}/>)}
        </div>
      </div>
    );
  }

  // 연/전체: 전체 표시 (연 단위는 현재월 강조)
  const curYM = thisYM();
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">
        월별 입금금액 추이{isYear?` · ${period}년`:''}
      </h2>
      <div className="space-y-2">
        {rows.map(([k,v])=><Bar key={k} k={k} v={v} highlight={isYear && k===curYM}/>)}
      </div>
    </div>
  );
}


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
        isRefunded:true, refundAmount:refund, refundedAt:todayYMD(),
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
function SettleTab({ settings, trainers, trainerMap, scopeTid=null, readOnly=false, estimate=false }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [ym, setYm] = useState(thisMonth);
  const [savedOverrides, setSavedOverrides] = useState({});

  const allPaymentsGrouped = useMemo(()=>{
    const g = {}; store.getMembers().forEach(m=>{ g[m.id] = store.getPayments(m.id); }); return g;
  }, [refreshKey]);
  const members   = useMemo(()=>store.getMembers(), [refreshKey]);
  const schedules = useMemo(()=>store.getSchedules(), [refreshKey]);
  const records   = useMemo(()=>store.getPromos(), [refreshKey]);

  const blocksAll = useMemo(()=>computeSessionSettlement({
    trainers, members, schedules, payments: allPaymentsGrouped, records, settings, ym,
    getOverride: (tid, m) => {
      const key = `${tid}_${m}`;
      return Object.prototype.hasOwnProperty.call(savedOverrides, key)
        ? savedOverrides[key]
        : store.getSettleOverride(tid, m);
    },
  }), [trainers, members, schedules, allPaymentsGrouped, records, settings, ym, refreshKey, savedOverrides]);

  const handleSettleOverrideSaved = (trainerId, month, override) => {
    setSavedOverrides(prev => ({ ...prev, [`${trainerId}_${month}`]: override || null }));
    setRefreshKey(k=>k+1);
  };

  // 트레이너 모드: 본인 블록만 노출
  const blocks = useMemo(
    () => scopeTid ? blocksAll.filter(b => b.trainer.id === scopeTid) : blocksAll,
    [blocksAll, scopeTid]
  );

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
    const header = ['트레이너','회원','등록회차','회차횟수','누적횟수','단가','월수업횟수','수업료','정산비율','실지급'];
    const body = [];
    blocks.forEach(b=>{
      b.rows.forEach(r=>body.push([
        b.trainer.name, r.memberName,
        settlementDetailText(r),
        r.regRoundCount??r.regTotal, r.regTotal,
        settlementUnitText(r),
        r.cnt, r.amount,
        `${r.rate}%${r.rateManual?'(수정)':r.rateFrozen?'(등록월)':''}`,
        r.payAmount,
      ]));
      body.push([b.trainer.name,'수업료 합계','','','','','', b.sessionTotal, b.rateMixed?'혼합':`${b.splitRate}%`, b.sessionPayout]);
      body.push([b.trainer.name,'블로그','','','','', b.blogCount, b.blogInc,'','']);
      body.push([b.trainer.name,'인스타','','','','', b.instaCount, b.instaInc,'','']);
      body.push([b.trainer.name,'스터디','','','','', b.studyCount, '','','']);
      body.push([b.trainer.name,'합계(세전)','','','','','','','', b.payout]);
      body.push([b.trainer.name,`원천징수(${b.withholdingRate??3.3}%)`,'','','','','','','', -b.tax]);
      body.push([b.trainer.name,'세후 실지급','','','','','','','', b.payoutNet]);
    });
    downloadCSV(`정산_${ym}.csv`, [header, ...body]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="month" value={ym} onChange={e=>setYm(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"/>
        <span className="text-[11px] text-slate-500 ml-auto">임금지급일: 매월 {settings.paydayDay||5}일</span>
        {!readOnly && (
          <button onClick={handleRefreeze} disabled={freezing}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-500/10 border border-amber-500/40 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40">
            {freezing ? '확정 중…' : '🔒 이 달 정산비율 확정'}
          </button>
        )}
        <button onClick={exportCSV} disabled={blocks.length===0}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/40 hover:text-amber-400 transition-colors disabled:opacity-40">
          📄 정산표 내보내기
        </button>
      </div>
      {!readOnly && (
        <p className="text-[11px] text-slate-500 -mt-3">
          🔒 “이 달 정산비율 확정”은 선택한 달에 결제가 발생한 회원들의 정산비율을, 그 달 전체 실적(블로그·스터디·매출)으로 다시 판정해 고정합니다. 보통 월말(말일 이후)에 한 번 누르며, 다른 달 결제는 바뀌지 않습니다.
        </p>
      )}

      {estimate ? (
        // 트레이너용 간략 요약 — 큰 실지급 숫자 1개 + 한 줄 내역
        <div className="bg-gradient-to-br from-amber-500/15 to-amber-500/5 border border-amber-500/30 rounded-2xl p-5">
          <p className="text-[12px] text-amber-300/80 font-bold tracking-wide">예상 세후 실지급 (추정)</p>
          <p className="text-3xl font-black text-amber-400 mt-1 tabular-nums">{won(grandNet)}</p>
          <div className="mt-3 pt-3 border-t border-amber-500/20 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]">
            <span className="text-slate-400">수업료 <b className="text-emerald-400 font-mono">{won(grandSessionPayout)}</b></span>
            <span className="text-slate-400">인센티브 <b className="text-blue-400 font-mono">{won(grandInc)}</b></span>
            <span className="text-slate-400">세전 <b className="text-slate-200 font-mono">{won(grandPayout)}</b></span>
            <span className="text-slate-400">원천세 <b className="text-red-400 font-mono">- {won(grandTax)}</b></span>
          </div>
        </div>
      ) : (<>
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
      </>)}

      {!estimate && (
        <p className="text-[11px] text-slate-500 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
          단가·월 수업횟수·정산비율은 결제·출석 데이터에서 자동 집계됩니다. 단가 = 공제 후 입금금액 ÷ 등록횟수 (카드1·2: 부가세+카드수수료 / 페이·현금영수증: 부가세 / 계좌·현금: 공제 없음) · 출석과 노쇼는 수업 횟수에 포함, 취소·외부·상담은 제외.{!readOnly && ' 셀을 눌러 직접 수정할 수 있어요.'}
        </p>
      )}

      <RecordManager trainers={trainers} period={ym} mode="month" onChange={()=>setRefreshKey(k=>k+1)}
        scopeTid={scopeTid} readOnly={readOnly}/>

      {blocks.length===0
        ? <p className="text-slate-600 text-sm text-center py-6 bg-slate-900 border border-slate-800 rounded-2xl">해당 월 정산 내역이 없습니다</p>
        : blocks.map(b=>(
          <TrainerSettleCard key={b.trainer.id} block={b} ym={ym} settings={settings}
            readOnly={readOnly} defaultOpen={!!scopeTid} estimate={estimate}
            onSaved={(override)=>handleSettleOverrideSaved(b.trainer.id, ym, override)}/>
        ))}
    </div>
  );
}

// 트레이너별 정산 카드 (회원 단가/횟수 직접 수정 가능 — readOnly면 수정 숨김)
function TrainerSettleCard({ block: b, ym, settings, onSaved, readOnly=false, defaultOpen=false, estimate=false }) {
  const [collapsed, setCollapsed] = useState(!defaultOpen);  // 트레이너 본인 화면이면 펼친 채로
  const [editing, setEditing] = useState(false);
  const [unitEdits, setUnitEdits] = useState({});   // memberId -> 단가
  const [cntEdits, setCntEdits]   = useState({});   // memberId -> 횟수
  const [rateEdits, setRateEdits] = useState({});   // memberId -> 정산비율
  const [rateSeed, setRateSeed] = useState({});     // startEdit 시점의 표시 비율(변경 판정 기준)
  const [blog, setBlog] = useState(b.blogCount);
  const [insta, setInsta] = useState(b.instaCount);
  const [study, setStudy] = useState(b.studyCount);

  const startEdit = () => {
    const u={}, c={}, rates={};
    b.rows.forEach(r=>{ u[r.memberId]=r.unit; c[r.memberId]=r.cnt; rates[r.memberId]=r.rate; });
    setUnitEdits(u); setCntEdits(c); setRateEdits(rates);
    setRateSeed({ ...rates });   // 편집 시작 시점의 표시값 스냅샷(무엇을 바꿨는지 판정용)
    // 홍보 횟수는 실시간 집계(auto)값을 기준으로 보여준다.
    // (과거 override로 고정된 값이 아니라 실제 기록 개수에서 시작 → 안 건드리면 실시간값 유지)
    setBlog(b.autoBlogCount); setInsta(b.autoInstaCount); setStudy(b.autoStudyCount);
    setCollapsed(false);  // 수정하려면 펼쳐야 함
    setEditing(true);
  };
  const save = async () => {
    try {
      // 핵심 원칙: "사용자가 자동집계값과 다르게 바꾼 항목만" override로 저장한다.
      //  · 단가·횟수·정산비율·홍보횟수 모두, 안 건드린 값은 저장에서 제외(또는 null) → 이후
      //    출석/결제/홍보 기록이 바뀌면 정산이 실시간으로 따라간다.
      //  · 예전에는 모든 회원의 단가·횟수를 통째로 박제해서, 한 번 "저장"하면
      //    그 트레이너의 정산이 과거값에 고정되는 버그가 있었다.
      const autoUnit = {}, autoCnt = {}, autoRate = {};
      b.rows.forEach(r => {
        autoUnit[r.memberId] = r.autoUnit;
        autoCnt[r.memberId] = r.autoCnt;
        // 자동 정산비율(override 없을 때 시스템이 산출·표시하는 값). 저장 판정의 기준.
        //  ⚠ baseRate(등록월 박제 기준값)와 다를 수 있어 예전엔 baseRate로 비교해
        //     "수정 후 닫으면 값이 사라지는" 버그가 있었다. 표시값과 저장 판정 기준을
        //     autoRate로 일치시켜 사용자가 바꾼 값이 항상 남고 화면에 보이게 한다.
        autoRate[r.memberId] = r.autoRate ?? r.baseRate ?? r.rate;
      });

      const unitPrices = {};
      Object.entries(unitEdits).forEach(([mid, v]) => {
        const val = Number(v) || 0;
        if (val !== (Number(autoUnit[mid]) || 0)) unitPrices[mid] = val; // 바뀐 것만
      });
      const sessionCounts = {};
      Object.entries(cntEdits).forEach(([mid, v]) => {
        const val = Number(v) || 0;
        if (val !== (Number(autoCnt[mid]) || 0)) sessionCounts[mid] = val; // 바뀐 것만
      });
      const clampRate = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
      };
      const splitRates = {};
      Object.entries(rateEdits).forEach(([mid, v]) => {
        const val = clampRate(v);
        if (val == null) return;
        const seed = Number(rateSeed[mid]);          // 편집 시작 시 표시값
        const auto = Number(autoRate[mid]) || 0;      // override 없을 때 자동값
        const differsFromAuto = val !== auto;         // 자동값과 다름(=override 필요)
        const seedDiffersAuto = Number.isFinite(seed) && seed !== auto; // 시작값이 이미 override였음
        // 저장 규칙(수정 후 값이 사라지던 버그의 근본 수정):
        //  · 최종값이 자동값과 다르면 무조건 override 저장 → 화면에 그대로 남는다.
        //  · 최종값이 자동값과 같아도, 시작값이 override였다면(사용자가 자동으로 되돌린 경우가
        //    아니라 원래 수동값을 유지) 보존한다. 단 자동값과 같으면 굳이 저장할 필요 없음.
        if (differsFromAuto) splitRates[mid] = val;
        else if (seedDiffersAuto && Number(v) === seed) splitRates[mid] = val; // 기존 수동값 유지
      });

      const promoOrNull = (edited, auto) =>
        (Number(edited)||0) === (Number(auto)||0) ? null : (Number(edited)||0);

      const blogCount  = promoOrNull(blog,  b.autoBlogCount);
      const instaCount = promoOrNull(insta, b.autoInstaCount);
      const studyCount = promoOrNull(study, b.autoStudyCount);

      // 실제로 바뀐 항목이 하나도 없으면 override 자체를 삭제(깨끗한 상태 유지 → '수정됨' 배지도 사라짐).
      const nothingOverridden =
        Object.keys(unitPrices).length === 0 &&
        Object.keys(sessionCounts).length === 0 &&
        Object.keys(splitRates).length === 0 &&
        blogCount == null && instaCount == null && studyCount == null;

      if (nothingOverridden) {
        if (b.hasOverride) await store.deleteSettleOverride(b.trainer.id, ym);
        setEditing(false); onSaved?.(null);
      } else {
        const saved = await store.saveSettleOverride(b.trainer.id, ym, {
          unitPrices, sessionCounts, splitRates, blogCount, instaCount, studyCount,
        });
        setEditing(false); onSaved?.(saved);
      }
    } catch(e){ alert('저장에 실패했습니다.'); }
  };

  // 수동 수정값(override) 전체 삭제 → 단가·횟수·정산비율·홍보횟수 모두 실시간 자동집계로 복원.
  // 과거에 통째로 박제돼 정산이 옛 값에 고정된 경우를 한 번에 정리하는 용도.
  const resetOverride = async () => {
    if (!window.confirm(`${b.trainer.name} 트레이너의 이번 달 수동 수정값을 모두 지우고 자동 집계값으로 되돌릴까요?\n(단가·수업횟수·정산비율·SNS/스터디 횟수가 실시간 데이터 기준으로 재계산됩니다.)`)) return;
    try { await store.deleteSettleOverride(b.trainer.id, ym); setEditing(false); onSaved?.(null); }
    catch(e){ alert('복원에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  // 편집 중 미리보기: 단가·횟수·정산비율 변경을 즉시 실지급액에 반영
  const toLiveRate = (value, fallback) => {
    if (value === '' || value === null || value === undefined) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
  };
  const liveRows = b.rows.map(r => {
    if (!editing) {
      return {
        ...r,
        _u:r.unit, _c:r.cnt, _rate:r.rate,
        _amount:r.amount,
        _rateManual:r.rateManual,
        _pay:r.payAmount,
      };
    }
    const u = editing ? (Number(unitEdits[r.memberId])||0) : r.unit;
    const c = editing ? (Number(cntEdits[r.memberId])||0) : r.cnt;
    const rate = editing ? toLiveRate(rateEdits[r.memberId], r.rate) : r.rate;
    // 미리보기의 '수정' 판정도 저장과 동일하게 자동값(autoRate) 기준으로 맞춘다.
    const autoRate = r.autoRate ?? r.baseRate ?? r.rate;
    const amount = u*c;
    return {
      ...r,
      _u:u, _c:c, _rate:rate, _amount:amount,
      _rateManual: editing ? rate !== autoRate : r.rateManual,
      _pay: Math.round(amount * (rate/100)),
    };
  });
  const liveSessionTotal  = liveRows.reduce((s,r)=>s+r._amount,0);
  const liveSessionPayout = liveRows.reduce((s,r)=>s+r._pay,0);
  const liveBlendedRate   = liveSessionTotal>0 ? Math.round(liveSessionPayout/liveSessionTotal*100) : b.splitRate;
  const liveDistinctRates = [...new Set(liveRows.filter(r=>r._amount>0).map(r=>r._rate))];
  const liveRateMixed = liveDistinctRates.length > 1;
  const liveHasManualRate = liveRows.some(r=>r._rateManual);
  const liveBlogInc = Number(blog||0)*settings.promoPerPost;
  const liveInstaInc = Math.min(Number(insta||0), settings.snsInstaMax??8)*settings.promoPerPost;
  const liveSalesInc = Number(b.newInc||0) + Number(b.reInc||0);
  const liveTotal = editing
    ? liveSessionPayout + liveBlogInc + liveInstaInc + liveSalesInc
    : b.payout;
  const liveSplit = {
    rate: editing ? (liveRateMixed ? liveBlendedRate : (liveDistinctRates[0] ?? b.splitRate)) : b.splitRate,
    mode: liveHasManualRate ? 'manual' : b.splitMode,
    reason: liveHasManualRate && editing ? '정산 비율 수동 수정값이 반영된 미리보기입니다.' : b.splitReason,
  };

  const INP = "w-20 bg-slate-900 border border-slate-600 text-slate-100 rounded px-1.5 py-1 text-xs font-mono text-right";
  const RATE_INP = "w-14 bg-slate-900 border border-amber-500/40 text-amber-200 rounded px-1.5 py-1 text-xs font-mono text-right";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <div className={`flex items-center justify-between ${collapsed?'':'mb-3'}`}>
        <button type="button" onClick={()=>setCollapsed(c=>!c)}
          className="flex items-center gap-2 flex-wrap min-w-0 text-left flex-1 group"
          title={collapsed?'펼치기':'접기'} aria-expanded={!collapsed}>
          <span className={`text-slate-500 group-hover:text-amber-400 transition-transform text-xs flex-shrink-0 ${collapsed?'':'rotate-90'}`}>▶</span>
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{background:b.trainer.color||'#94a3b8'}}/>
          <span className="font-bold group-hover:text-amber-400 transition-colors">{b.trainer.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
            liveSplit.rate>=60 ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
            : liveSplit.rate>=50 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
            : 'bg-slate-700/40 text-slate-300 border-slate-600'
          }`} title={liveSplit.reason}>
            정산 {liveRateMixed?`혼합 ${liveSplit.rate}%`:`${liveSplit.rate}%`}{liveSplit.mode==='manual'?' (수동)':liveSplit.mode==='frozen'?' (등록월)':' (자동)'}
          </span>
          {!readOnly && b.hasOverride && (
            <span onClick={(e)=>{e.stopPropagation();resetOverride();}}
              className="text-[10px] bg-blue-500/20 text-blue-400 hover:bg-red-500/20 hover:text-red-400 px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer"
              title="수동 수정값을 지우고 자동 집계값으로 복원">
              수정됨 ✕ 자동복원
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-lg font-mono font-black text-amber-400">{won(liveTotal)}</span>
          {readOnly
            ? null
            : editing
            ? <><button onClick={()=>setEditing(false)} className="text-xs text-slate-400 hover:text-white">취소</button>
                <button onClick={save} className="text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg">저장</button></>
            : <button onClick={startEdit} className="text-xs text-slate-400 hover:text-blue-400">수정</button>}
        </div>
      </div>

      {!collapsed && (<>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left font-semibold py-1.5">회원</th>
              <th className="text-right font-semibold">등록(회차)</th>
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
              const rateValue = editing ? (rateEdits[r.memberId] ?? r.rate) : r.rate;
              const rateChanged = r._rateManual;
              const rateTitle = r.rateManual
                ? `수동 수정된 정산비율 · 자동값 ${r.baseRate ?? r.rate}%`
                : r.rateFrozen
                ? '등록월에 고정된 비율'
                : '그 달 자동판정 비율';
              const breakdown = !editing ? settlementPartsOf(r) : [];
              const showBreakdown = breakdown.length > 0;
              return (
                <tr key={r.memberId} className="border-b border-slate-800/50">
                  <td className="py-1.5 text-slate-200">{r.memberName}</td>
                  <td className="text-right text-slate-500">
                    {showBreakdown
                      ? <div className="space-y-0.5">
                          {breakdown.map((part, idx) => (
                            <div key={`${part.id || part.label}-${idx}`} className="whitespace-nowrap">
                              <span className={part.label?.startsWith('재등록') ? 'text-blue-300 font-bold' : 'text-slate-300'}>
                                {part.label}
                              </span>{' '}
                              <span className="font-mono">{part.count}회</span>
                            </div>
                          ))}
                          {breakdown.length > 1 && <div className="text-[10px] text-slate-600">합계 {r.cnt}회</div>}
                        </div>
                      : r.regRound
                      ? <span title={`이 회차 등록 ${r.regRoundCount}회 · 누적 ${r.regTotal}회`}>
                          <span className="text-slate-400">{r.regRound}</span> <span className="font-mono">{r.regRoundCount}회</span>
                        </span>
                      : <span className="font-mono">{r.regTotal}회</span>}
                  </td>
                  <td className="text-right">
                    {editing
                      ? <input type="number" value={u} onChange={e=>setUnitEdits(s=>({...s,[r.memberId]:e.target.value}))} className={INP}/>
                      : showBreakdown
                      ? <div className="space-y-0.5 font-mono text-slate-300">
                          {breakdown.map((part, idx) => <div key={`${part.id || part.label}-unit-${idx}`}>{won(part.unit)}</div>)}
                        </div>
                      : <span className="font-mono text-slate-300">{won(r.unit)}</span>}
                  </td>
                  <td className="text-right">
                    {editing
                      ? <input type="number" value={c} onChange={e=>setCntEdits(s=>({...s,[r.memberId]:e.target.value}))} className={INP}/>
                      : showBreakdown
                      ? <div className="space-y-0.5 font-mono text-slate-300">
                          {breakdown.map((part, idx) => <div key={`${part.id || part.label}-cnt-${idx}`}>{part.count}회</div>)}
                          {breakdown.length > 1 && <div className="text-[10px] text-slate-600">합계 {r.cnt}회</div>}
                        </div>
                      : <span className="font-mono text-slate-300">{r.cnt}회{r.cnt!==r.autoCnt?'*':''}</span>}
                  </td>
                  <td className="text-right font-mono text-slate-400">
                    {showBreakdown
                      ? <div className="space-y-0.5">
                          {breakdown.map((part, idx) => <div key={`${part.id || part.label}-amount-${idx}`}>{won(part.amount)}</div>)}
                          {breakdown.length > 1 && <div className="text-[10px] text-slate-600">합계 {won(r._amount)}</div>}
                        </div>
                      : won(r._amount)}
                  </td>
                  <td className="text-right">
                    {editing
                      ? <span className="inline-flex items-center justify-end gap-1">
                          <input type="number" min="0" max="100" step="1" value={rateValue}
                            onChange={e=>setRateEdits(s=>({...s,[r.memberId]:e.target.value}))}
                            className={RATE_INP} title="정산 비율 직접 수정"/>
                          <span className="text-[11px] text-slate-500">%</span>
                          {rateChanged && <span className="text-[10px] text-amber-300 font-bold">수정</span>}
                        </span>
                      : showBreakdown
                      ? <div className="space-y-0.5 font-mono text-slate-400">
                          {breakdown.map((part, idx) => (
                            <div key={`${part.id || part.label}-rate-${idx}`} title={part.hasFrozen ? '등록월에 고정된 비율' : rateTitle}>
                              {part.rate}%{part.hasFrozen?'🔒':''}
                            </div>
                          ))}
                        </div>
                      : <span className={`font-mono text-[11px] px-1 rounded ${
                          r.rateManual ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                          : r.rateFrozen ? 'text-violet-300'
                          : 'text-slate-400'
                        }`} title={rateTitle}>
                          {r.rate}%{r.rateManual?' 수정':r.rateFrozen?'🔒':''}
                        </span>}
                  </td>
                  <td className="text-right font-mono font-bold text-emerald-400">
                    {showBreakdown
                      ? <div className="space-y-0.5">
                          {breakdown.map((part, idx) => <div key={`${part.id || part.label}-pay-${idx}`}>{won(part.payAmount)}</div>)}
                          {breakdown.length > 1 && <div className="text-[10px] text-emerald-500/80">합계 {won(r._pay)}</div>}
                        </div>
                      : won(r._pay)}
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
          <span className="text-slate-500">스터디 (60% 조건)</span>
          {editing
            ? <span className="flex items-center gap-1"><input type="number" value={study} onChange={e=>setStudy(e.target.value)} className="w-12 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-right"/>회</span>
            : <span className="font-mono font-bold text-purple-400">{b.studyCount}회</span>}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">블로그 (60% 조건)</span>
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
          <span className="text-slate-400 font-semibold">{liveRateMixed?`정산비율 회원별 혼합(가중 ${liveSplit.rate}%) = 실지급 수업료`:`× 정산비율 ${liveSplit.rate}% = 실지급 수업료`}</span>
          <span className="font-mono font-bold text-emerald-400">{won(liveSessionPayout)}</span>
        </div>
        <p className="col-span-2 text-[10px] text-slate-600 leading-relaxed">
          {liveRateMixed ? (liveHasManualRate ? liveSplit.reason : '회원마다 등록월에 정해진 비율이 고정 적용됩니다(🔒=등록월 고정).') : liveSplit.reason}
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
          <span className="text-amber-400 font-bold">세후 실지급{estimate && <span className="text-amber-400/60 font-normal text-xs"> (추정)</span>}</span>
          <span className="font-mono font-black text-amber-400 text-base">{won(liveTotal - Math.round(liveTotal*((b.withholdingRate ?? settings.withholdingRate ?? 3.3)/100)))}</span>
        </div>
      </div>
      </>)}
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
function RecordManager({ trainers, period, mode, onChange, scopeTid=null, readOnly=false }) {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(!scopeTid); // 트레이너 본인 화면이면 펼친 채로
  const [form, setForm] = useState({ trainerId:trainers[0]?.id||'', channel:'blog', date:todayYMD(), note:'' });

  const inPeriod = (d) => mode==='month' ? monthKey(d)===period : yearKey(d)===period;
  const list = store.getPromos()
    .filter(p=>inPeriod(p.date))
    .filter(p=>!scopeTid || p.trainerId===scopeTid) // 트레이너 모드: 본인 기록만
    .sort((a,b)=>b.date.localeCompare(a.date));

  const add = async () => {
    if (!form.trainerId) { alert('트레이너를 선택하세요.'); return; }
    // 정산비율 판정은 "그 기록이 속한 달"에 반영되므로, 선택한 정산월과
    // 기록 날짜의 달이 다르면 정산에 즉시 반영되지 않음을 안내한다.
    if (mode==='month' && monthKey(form.date) !== period) {
      if (!window.confirm(
        `입력한 날짜(${form.date})는 현재 보고 있는 정산월(${period})과 다른 달입니다.\n`+
        `이 기록은 ${monthKey(form.date)} 정산에 반영됩니다. 계속할까요?`)) return;
    }
    try { await store.addPromo({ ...form }); setForm(f=>({...f, note:'', date:todayYMD()})); force(n=>n+1); onChange?.(); }
    catch(e){ alert('추가 실패'); }
  };
  const del = async (id) => { try { await store.deletePromo(id); force(n=>n+1); onChange?.(); } catch(e){ alert('삭제 실패'); } };

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
        {!collapsed && !readOnly && (
          <button onClick={()=>setOpen(!open)} className="text-xs text-amber-400 hover:text-amber-300 font-semibold">+ 기록 추가</button>
        )}
      </div>
      {!collapsed && <>
      {open && !readOnly && (
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
                {!readOnly && <button onClick={()=>del(p.id)} className="text-slate-600 hover:text-red-400">삭제</button>}
              </div>
            ))}
          </div>}
      <p className="text-[11px] text-slate-600 mt-2">* SNS-블로그: 1회차부터 지급(상한 없음) · SNS-인스타: 최대 8회 · 1건당 1만원 / 60%: 블로그2+스터디1 / 50%: 신규·재등록 매출 300만 이상{readOnly && ' · 기록 입력은 관리자가 합니다'}</p>
      </>}
    </div>
  );
}

/* ─────────────────────────────── 지출 ─────────────────────────────── */
// 가변 지출(매달 내지만 금액이 달라지는 항목) 분류. 연도별 비교의 기준이 된다.
const EXPENSE_CATEGORIES = ['관리비','전기세','수도세','세금','임대료','통신비','기타'];
// 기존 데이터(category 없음) 호환: 항목명으로 분류를 추론한다.
function inferCategory(e) {
  if (e.category) return e.category;
  const n = (e.name||'') + ' ' + (e.note||'');
  if (/전기/.test(n)) return '전기세';
  if (/수도|관리비/.test(n)) return /수도/.test(n) ? '수도세' : '관리비';
  if (/세무|원천|부가|세금|소득세|지방세/.test(n)) return '세금';
  if (/임대|월세|렌트/.test(n)) return '임대료';
  if (/인터넷|통신|폰|cctv/i.test(n)) return '통신비';
  return '기타';
}

function ExpenseTab() {
  const [, force] = useState(0);
  const [selMonth, setSelMonth] = useState(thisMonth);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind:'monthly', category:'관리비', name:'', amount:'', ym:thisMonth, date:todayYMD(), note:'' });

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
        ? { kind:'fixed', category:form.category, name:form.name, amount:Number(form.amount), note:form.note }
        : { kind:'monthly', category:form.category, name:form.name, amount:Number(form.amount), ym:form.ym, date:form.date, note:form.note };
      await store.addExpense(payload);
      setForm({ kind:form.kind, category:form.category, name:'', amount:'', ym:selMonth, date:todayYMD(), note:'' });
      setOpen(false); force(n=>n+1);
    } catch(e){ alert('추가 실패'); }
  };
  const del = async (id) => { if(!window.confirm('삭제할까요?'))return; try{ await store.deleteExpense(id); force(n=>n+1);}catch(e){alert('삭제 실패');} };

  // ── 지출 내보내기 (엑셀에서 열 수 있는 CSV) ──────────────────────────
  const exportCSV = () => {
    const all = store.getExpenses();
    const header = ['종류','분류','항목명','귀속월','지출일','금액','메모'];
    const kindLabel = (k)=> k==='fixed' ? '고정비' : '월별';
    const body = all
      .slice()
      .sort((a,b)=> (b.ym||'').localeCompare(a.ym||'') || (a.category||'').localeCompare(b.category||''))
      .map(e=>[ kindLabel(e.kind), inferCategory(e), e.name||'', e.ym||'', e.date||'', e.amount||0, e.note||'' ]);
    downloadCSV(`지출내역_${todayYMD()}.csv`, [header, ...body]);
  };

  // ── 지출 일괄 가져오기 (엑셀에서 복사한 JSON/표 붙여넣기) ──────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  // 붙여넣은 텍스트를 파싱: JSON 배열 또는 "분류[탭]항목[탭]귀속월(YYYY-MM)[탭]금액" 표 형식 모두 허용
  const parseImport = parsePastedText;
  const runImport = async () => {
    let list;
    try { list = parseImport(importText); }
    catch (e) { alert('형식을 해석할 수 없습니다. JSON 배열이거나, 한 줄에 [분류, 항목, 귀속월(2026-01), 금액] 형태여야 합니다.'); return; }
    if (!list.length) { alert('가져올 내역이 없습니다.'); return; }
    await commitImport(list);
  };

  // ── 엑셀(.xlsx)/CSV 파일 업로드 → 자동 파싱 ──────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const handleFile = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await loadXLSX();                          // CDN 동적 로드(빌드 의존성 없음)
      const wb = XLSX.read(buf, { type:'array', cellHTML:false, cellStyles:false });
      let all = [];
      wb.SheetNames.forEach(sn => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header:1, raw:true, defval:null });
        all = all.concat(parseSheetRows(rows));
      });
      all = dedupeExpenses(all);
      if (!all.length) { alert('파일에서 인식할 지출 내역을 찾지 못했습니다.\n· 월×연도 표 또는 [분류·항목·귀속월·금액] 표 형식을 지원합니다.'); setImporting(false); return; }
      await commitImport(all);
    } catch (e) {
      alert('파일을 읽는 중 오류가 발생했습니다. .xlsx 또는 .csv 파일인지 확인해 주세요.');
    } finally { setImporting(false); }
  };
  // 공통: 확인 후 일괄 등록
  const commitImport = async (list) => {
    if (!window.confirm(`${list.length}건을 가져옵니다. (이미 등록된 동일 내역은 자동으로 건너뜁니다.)\n진행할까요?`)) return;
    setImporting(true);
    try {
      const res = await store.addExpenseBatch(list);
      alert(`가져오기 완료\n· 추가: ${res.added}건\n· 중복 제외: ${res.skipped}건`);
      setImportText(''); setImportOpen(false); force(n=>n+1);
    } catch (e) { alert('가져오기 중 오류가 발생했습니다. 네트워크 확인 후 다시 시도하세요.'); }
    finally { setImporting(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <select value={selMonth} onChange={e=>setSelMonth(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm">
          {months.map(m=><option key={m} value={m}>{m.replace('-','년 ')}월</option>)}
        </select>
        <div className="flex items-center gap-3">
          <button onClick={exportCSV} className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold">📤 내보내기</button>
          <button onClick={()=>setImportOpen(!importOpen)} className="text-xs text-blue-400 hover:text-blue-300 font-semibold">📥 일괄 가져오기</button>
          <button onClick={()=>setOpen(!open)} className="text-xs text-amber-400 hover:text-amber-300 font-semibold">+ 지출 추가</button>
        </div>
      </div>

      {importOpen && (
        <div className="bg-slate-900 border border-blue-500/20 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-blue-400">📥 지출 일괄 가져오기</p>

          {/* 방법 1: 엑셀/CSV 파일 업로드 */}
          <div
            onDragOver={e=>{e.preventDefault(); setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]);}}
            onClick={()=>fileRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver ? 'border-blue-400 bg-blue-500/10' : 'border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/50'
            }`}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e=>{ handleFile(e.target.files?.[0]); e.target.value=''; }}/>
            <p className="text-sm text-slate-200 font-semibold">📂 엑셀(.xlsx) 또는 CSV 파일을 끌어다 놓거나 클릭해서 선택</p>
            <p className="text-[11px] text-slate-500 mt-1">
              월×연도 표(센터 관리비 양식)와 [분류·항목·귀속월·금액] 표를 자동으로 인식합니다. 중복은 자동 제외됩니다.
            </p>
            {importing && <p className="text-[11px] text-blue-400 mt-2">파일을 읽는 중…</p>}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-slate-800"/>
            <span className="text-[10px] text-slate-600">또는 직접 붙여넣기</span>
            <div className="flex-1 h-px bg-slate-800"/>
          </div>

          {/* 방법 2: 텍스트 붙여넣기 */}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            아래 칸에 <b className="text-slate-200">JSON 배열</b>을 붙여넣거나, 한 줄에 <b className="text-slate-200">분류 · 항목명 · 귀속월(2026-01) · 금액</b>을
            탭이나 콤마로 구분해 붙여넣으세요. 이미 등록된 동일 내역(분류·귀속월·항목·금액이 모두 같음)은 자동으로 건너뜁니다.
          </p>
          <textarea value={importText} onChange={e=>setImportText(e.target.value)} rows={6}
            placeholder={'예) 전기세, 301·302호 전기세, 2026-01, 414910\n또는 JSON: [{"category":"전기세","name":"전기세","ym":"2026-01","amount":414910}]'}
            className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-xs font-mono"/>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>setImportOpen(false)} className="text-xs text-slate-400 hover:text-white px-3 py-2">취소</button>
            <button onClick={runImport} disabled={importing}
              className="bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm disabled:opacity-40">
              {importing ? '가져오는 중…' : '가져오기'}
            </button>
          </div>
        </div>
      )}

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
            <div>
              <label className="text-[11px] text-slate-500">분류</label>
              <select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm">
                {EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-500">금액</label>
              <input type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} placeholder="금액"
                className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono"/>
            </div>
          </div>
          <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="항목명 (예: 301호·302호 전기세)"
            className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"/>
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
      {/* 연도별 비교 그래프 (관리비·전기세·세금 등 가변 지출 추세) */}
      <ExpenseYearlyCompare expenses={expenses}/>
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
                  {e.category && <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">{inferCategory(e)}</span>}
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

// 연도별 비교 그래프 — 같은 항목(전기세 등)이 해마다 어떻게 변하는지 월별 라인으로 비교
const YEAR_COLORS = ['#f59e0b','#10b981','#3b82f6','#a855f7','#ef4444','#14b8a6','#eab308','#ec4899','#64748b'];
function ExpenseYearlyCompare({ expenses }) {
  const monthlyExp = useMemo(()=> (expenses||[]).filter(e=>e.kind==='monthly' && e.ym), [expenses]);
  // 분류 목록(데이터에 존재하는 것만) + '전체'
  const cats = useMemo(()=>{
    const s = new Set(monthlyExp.map(inferCategory));
    return ['전체', ...EXPENSE_CATEGORIES.filter(c=>s.has(c))];
  }, [monthlyExp]);
  const [cat, setCat] = useState('전체');

  // year -> month(1~12) -> 합계
  const { years, table, maxVal } = useMemo(()=>{
    const filtered = cat==='전체' ? monthlyExp : monthlyExp.filter(e=>inferCategory(e)===cat);
    const map = {}; // year -> [12]
    filtered.forEach(e=>{
      const [y,m] = e.ym.split('-').map(Number);
      if (!y || !m) return;
      (map[y] = map[y] || Array(12).fill(0))[m-1] += Number(e.amount)||0;
    });
    const years = Object.keys(map).map(Number).sort();
    let maxVal = 0;
    years.forEach(y=>map[y].forEach(v=>{ if(v>maxVal) maxVal=v; }));
    return { years, table: map, maxVal: maxVal||1 };
  }, [monthlyExp, cat]);

  if (monthlyExp.length===0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-2">📊 연도별 비교</h2>
        <p className="text-slate-600 text-sm text-center py-4">월별 지출(관리비·전기세·세금 등)을 추가하면 연도별 추세 그래프가 표시됩니다.</p>
      </div>
    );
  }

  // SVG 좌표
  const W=680, H=240, padL=56, padR=16, padT=16, padB=28;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const x = (m)=> padL + (plotW*(m)/(11));        // m: 0~11
  const y = (v)=> padT + plotH*(1 - v/maxVal);
  const MONTHS = ['1','2','3','4','5','6','7','8','9','10','11','12'];

  // 연도별 합계·평균(0 제외 평균)
  const stat = (arr)=>{
    const sum = arr.reduce((s,v)=>s+v,0);
    const nz = arr.filter(v=>v>0);
    return { sum, avg: nz.length ? Math.round(sum/nz.length) : 0 };
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">📊 연도별 비교 — 월별 추세</h2>
        <select value={cat} onChange={e=>setCat(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-1.5 text-xs">
          {cats.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* 라인 차트 */}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{minWidth:560}}>
          {/* y 그리드 4단계 */}
          {[0,0.25,0.5,0.75,1].map((t,i)=>{
            const gy = padT + plotH*(1-t);
            return (
              <g key={i}>
                <line x1={padL} y1={gy} x2={W-padR} y2={gy} stroke="#1e293b" strokeWidth="1"/>
                <text x={padL-6} y={gy+3} textAnchor="end" fontSize="9" fill="#64748b">
                  {Math.round(maxVal*t/10000)}만
                </text>
              </g>
            );
          })}
          {/* x축 월 라벨 */}
          {MONTHS.map((m,i)=>(
            <text key={m} x={x(i)} y={H-8} textAnchor="middle" fontSize="9" fill="#64748b">{m}</text>
          ))}
          {/* 연도별 라인 */}
          {years.map((yr,idx)=>{
            const arr = table[yr];
            const color = YEAR_COLORS[idx % YEAR_COLORS.length];
            // 0(미입력)은 선을 끊어 잇지 않도록 세그먼트 분리
            const pts = arr.map((v,m)=> v>0 ? `${x(m)},${y(v)}` : null);
            const segs = []; let cur=[];
            pts.forEach(p=>{ if(p){cur.push(p);} else { if(cur.length)segs.push(cur); cur=[]; } });
            if(cur.length) segs.push(cur);
            return (
              <g key={yr}>
                {segs.map((sg,si)=>(
                  <polyline key={si} points={sg.join(' ')} fill="none" stroke={color} strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" opacity="0.9"/>
                ))}
                {arr.map((v,m)=> v>0 ? <circle key={m} cx={x(m)} cy={y(v)} r="2.5" fill={color}/> : null)}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap gap-3">
        {years.map((yr,idx)=>(
          <span key={yr} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="w-3 h-0.5 rounded" style={{background:YEAR_COLORS[idx%YEAR_COLORS.length]}}/>
            {yr}
          </span>
        ))}
      </div>

      {/* 연도별 합계·평균 요약표 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left font-semibold py-1.5">연도</th>
              {MONTHS.map(m=><th key={m} className="text-right font-semibold px-1">{m}월</th>)}
              <th className="text-right font-semibold pl-2">합계</th>
              <th className="text-right font-semibold pl-2">평균</th>
            </tr>
          </thead>
          <tbody>
            {years.map(yr=>{
              const arr = table[yr]; const s = stat(arr);
              return (
                <tr key={yr} className="border-b border-slate-800/50">
                  <td className="py-1.5 text-slate-200 font-bold">{yr}</td>
                  {arr.map((v,m)=>(
                    <td key={m} className="text-right font-mono text-slate-400 px-1">
                      {v>0 ? Math.round(v/10000) : '·'}
                    </td>
                  ))}
                  <td className="text-right font-mono font-bold text-amber-400 pl-2">{Math.round(s.sum/10000)}만</td>
                  <td className="text-right font-mono text-emerald-400 pl-2">{Math.round(s.avg/10000)}만</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-600">* 표 안의 월별 값은 만원 단위 반올림 · 평균은 지출이 있던 달만 계산 · 선이 끊긴 구간은 미입력 월입니다.</p>
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
        <p className="text-[11px] text-slate-500">등록월의 트레이너 실적으로 비율을 판정해 그 회원 등록분에 고정 — 조건A(블로그2·스터디1) 충족 시 60% / 조건A 미충족이고 조건B(신규·재등록 매출 임계 이상)만 충족 시 50% / 모두 미달 40% · 수동 지정은 기준선이며, 조건이 더 높으면 자동 상향(예: 수동 50% + 조건A 충족 → 60%)</p>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="하한 비율(조건 미달)" k="lowSplitRate" suffix="%" form={form} setForm={setForm}/>
          <NumField label="50% 조건 (신규 또는 재등록 매출)" k="rate60MinSales" suffix="원" form={form} setForm={setForm}/>
          <NumField label="60% 조건 (블로그 월)" k="rate50MinBlog" suffix="회" form={form} setForm={setForm}/>
          <NumField label="60% 조건 (스터디 월)" k="rate50MinStudy" suffix="회" form={form} setForm={setForm}/>
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
