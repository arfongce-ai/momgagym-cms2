// Revenue.jsx — 매출관리 (관리자 전용)
// 회원별 결제(payments) 데이터를 집계하여 월별/결제수단별 매출과 미수금을 보여줍니다.
import { useState, useMemo } from 'react';
import { store } from '../demoData';
import { useAuth } from '../contexts/AuthContext';

const METHOD_LBL = { card:'카드', cash:'현금', transfer:'계좌이체' };
const won = (n) => n.toLocaleString('ko-KR') + '원';

function monthKey(d) { return new Date(d).toISOString().slice(0,7); }

export default function Revenue() {
  const { user } = useAuth();
  const members = store.getMembers();

  // 모든 결제 평탄화 (회원 이름 부착)
  const allPayments = useMemo(() => {
    const rows = [];
    members.forEach(m => {
      (store.getPayments(m.id) || []).forEach(p => {
        rows.push({ ...p, memberId:m.id, memberName:m.name });
      });
    });
    return rows.sort((a,b) => new Date(b.paidAt) - new Date(a.paidAt));
  }, [members]);

  // 선택 월 목록
  const months = useMemo(() => {
    const set = new Set(allPayments.map(p => monthKey(p.paidAt)));
    return [...set].sort().reverse();
  }, [allPayments]);

  const [selMonth, setSelMonth] = useState('all');

  const filtered = useMemo(() => {
    if (selMonth === 'all') return allPayments;
    return allPayments.filter(p => monthKey(p.paidAt) === selMonth);
  }, [allPayments, selMonth]);

  // 집계: 미수금은 매출에서 제외
  const paid   = filtered.filter(p => !p.isUnpaid);
  const unpaid = filtered.filter(p => p.isUnpaid);

  const totalRevenue = paid.reduce((s,p) => s + (p.amount||0), 0);
  const totalUnpaid  = unpaid.reduce((s,p) => s + (p.amount||0), 0);

  const byMethod = useMemo(() => {
    const acc = {};
    paid.forEach(p => { acc[p.method] = (acc[p.method]||0) + (p.amount||0); });
    return acc;
  }, [paid]);

  // 월별 추이 (전체 기준)
  const byMonth = useMemo(() => {
    const acc = {};
    allPayments.filter(p=>!p.isUnpaid).forEach(p => {
      const k = monthKey(p.paidAt);
      acc[k] = (acc[k]||0) + (p.amount||0);
    });
    return Object.entries(acc).sort((a,b)=>a[0].localeCompare(b[0]));
  }, [allPayments]);

  const maxMonth = Math.max(1, ...byMonth.map(([,v])=>v));

  // 관리자 가드 (라우트에도 있지만 이중 안전장치)
  if (user?.role !== 'admin') {
    return <p className="text-slate-500 text-center py-10">관리자만 접근할 수 있습니다.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">💰 매출관리</h1>
          <p className="text-slate-500 text-sm mt-1">회원 결제 내역 기반 매출 집계 · 관리자 전용</p>
        </div>
        <select value={selMonth} onChange={e=>setSelMonth(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
          <option value="all">전체 기간</option>
          {months.map(m => <option key={m} value={m}>{m.replace('-','년 ')}월</option>)}
        </select>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:'총 매출',   value:won(totalRevenue), color:'text-emerald-400' },
          { label:'미수금',    value:won(totalUnpaid),  color:'text-red-400'     },
          { label:'결제 건수', value:`${paid.length}건`, color:'text-blue-400'    },
          { label:'평균 결제', value:won(paid.length?Math.round(totalRevenue/paid.length):0), color:'text-amber-400' },
        ].map(s=>(
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{s.label}</span>
            <p className={`text-xl font-black font-mono mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 결제수단별 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">결제수단별 매출</h2>
        {Object.keys(byMethod).length===0
          ? <p className="text-slate-600 text-sm text-center py-3">데이터가 없습니다</p>
          : (
            <div className="space-y-2">
              {Object.entries(byMethod).sort((a,b)=>b[1]-a[1]).map(([m,v])=>(
                <div key={m} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{METHOD_LBL[m]||m}</span>
                  <span className="font-mono font-bold text-emerald-400">{won(v)}</span>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* 월별 추이 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">월별 매출 추이</h2>
        {byMonth.length===0
          ? <p className="text-slate-600 text-sm text-center py-3">데이터가 없습니다</p>
          : (
            <div className="space-y-2">
              {byMonth.map(([k,v])=>(
                <div key={k} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 flex-shrink-0">{k}</span>
                  <div className="flex-1 bg-slate-800 rounded-full h-5 overflow-hidden">
                    <div className="h-full bg-amber-500/70 rounded-full" style={{width:`${(v/maxMonth)*100}%`}}/>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-300 w-24 text-right flex-shrink-0">{won(v)}</span>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* 상세 내역 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="font-bold text-sm uppercase tracking-widest text-slate-400 mb-3">결제 상세 내역</h2>
        {filtered.length===0
          ? <p className="text-slate-600 text-sm text-center py-4">내역이 없습니다</p>
          : (
            <div className="space-y-2">
              {filtered.map(p=>(
                <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{p.memberName}</span>
                      <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-bold">{METHOD_LBL[p.method]||p.method}</span>
                      {p.isUnpaid && <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold">미수금</span>}
                    </div>
                    {p.note && <p className="text-xs text-slate-500 mt-0.5">{p.note}</p>}
                    <p className="text-[10px] text-slate-600 mt-0.5">{p.paidAt}</p>
                  </div>
                  <span className={`text-sm font-mono font-black flex-shrink-0 ${p.isUnpaid?'text-red-400':'text-emerald-400'}`}>{won(p.amount||0)}</span>
                </div>
              ))}
            </div>
          )
        }
      </div>
    </div>
  );
}
