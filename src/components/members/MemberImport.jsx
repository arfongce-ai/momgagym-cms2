// 회원·결제 엑셀 가져오기 — 파일 업로드 → 미리보기 → 확인 → 일괄 등록
import { useState, useRef, useMemo } from 'react';
import { store } from '../../demoData';
import { parsePaymentSheet, buildMemberImport } from '../../utils/memberImport';
import { loadXLSX } from '../../utils/loadXlsx';

const won = (n) => (n||0).toLocaleString() + '원';

export default function MemberImport({ onClose, onDone }) {
  const trainers = store.getTrainers();
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(null);   // { members, skipped, unmatchedTrainers }
  const [committing, setCommitting] = useState(false);

  // 트레이너 이름 → ID (CMS에 등록된 트레이너 기준)
  const trainerNameToId = useMemo(() => {
    const map = {};
    trainers.forEach(t => { map[(t.name||'').trim()] = t.id; });
    return map;
  }, [trainers]);

  // 약칭(끝글자+T) → 이름 자동 추론: CMS 트레이너 이름의 마지막 글자 2개와 매칭
  // 예: '동규T' → 이름이 '○동규'인 트레이너. 매칭 안 되면 그대로 둠(미매칭 경고).
  const abbrToName = useMemo(() => {
    const map = {};
    trainers.forEach(t => {
      const nm = (t.name||'').trim();
      if (nm.length >= 2) {
        map[nm.slice(-2) + 'T'] = nm;   // 동규T
        map[nm.slice(-2)] = nm;
      }
    });
    return map;
  }, [trainers]);

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setParsed(null);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await loadXLSX();
      // 이 양식은 일부 비표준 rich-format이 있어 cellHTML:false로 읽어야 안전
      const wb = XLSX.read(buf, { type:'array', cellHTML:false, cellStyles:false });
      // '등록회원' 류 시트 우선, 없으면 첫 시트
      const target = wb.SheetNames.find(s => /등록회원/.test(s)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[target], { header:1, raw:true, defval:null });
      const { records, skipped } = parsePaymentSheet(rows, { abbrToName, trainerNameToId });
      if (!records.length) {
        alert('이 파일에서 결제 내역을 찾지 못했습니다.\n매출관리 엑셀(날짜·이름·세션·금액·담당 열)인지 확인해 주세요.');
        setLoading(false); return;
      }
      const members = buildMemberImport(records);
      // 트레이너 매칭 실패(담당이 있는데 ID를 못 찾음) 수집
      const unmatched = new Set();
      records.forEach(r => { if (r.trainerName && !r.trainerId) unmatched.add(r.trainerName); });
      setParsed({ members, skipped, records, unmatched:[...unmatched] });
    } catch (e) {
      alert('파일을 읽는 중 오류가 발생했습니다. .xlsx 파일인지 확인해 주세요.');
    } finally { setLoading(false); }
  };

  const commit = async () => {
    if (!parsed) return;
    const n = parsed.members.length;
    if (!window.confirm(`회원 ${n}명과 결제 내역을 등록합니다.\n이미 등록된 동일 회원(이름+연락처)은 건너뜁니다.\n진행할까요?`)) return;
    setCommitting(true);
    try {
      const res = await store.addMembersBatch(parsed.members);
      alert(`가져오기 완료\n· 회원 추가: ${res.added}명\n· 중복 제외: ${res.skipped}명`);
      onDone && onDone();
    } catch (e) {
      alert('등록 중 오류가 발생했습니다. 네트워크 확인 후 다시 시도하세요.');
    } finally { setCommitting(false); }
  };

  // 미리보기 통계
  const stats = useMemo(() => {
    if (!parsed) return null;
    const ms = parsed.members;
    return {
      members: ms.length,
      payments: parsed.records.length,
      monthly: ms.filter(m => m.monthly).length,
      refunds: parsed.records.filter(r => r.kind === 'refund').length,
      reEnroll: ms.filter(m => m.payments.filter(p=>!p.isRefunded).length > 1).length,
      totalSessions: ms.reduce((s,m)=> s + Object.values(m.trainerSessions||{}).reduce((a,v)=>a+(v.total||0),0), 0),
    };
  }, [parsed]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5 space-y-4"
        onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">회원 · 결제 엑셀 가져오기</h2>
          <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 1단계: 파일 선택 */}
        <div
          onDragOver={e=>{e.preventDefault(); setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]);}}
          onClick={()=>fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragOver ? 'border-amber-400 bg-amber-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-amber-500/50 hover:bg-slate-100/50 dark:hover:bg-slate-800/50'
          }`}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e=>{ handleFile(e.target.files?.[0]); e.target.value=''; }}/>
          <p className="text-sm text-slate-700 dark:text-slate-200 font-semibold">📂 매출관리 엑셀(.xlsx)을 끌어다 놓거나 클릭해서 선택</p>
          <p className="text-[11px] text-slate-500 mt-1">
            ‘등록회원’ 시트의 날짜·이름·세션·금액·담당을 읽어 회원과 결제로 정리합니다. 집계행(총매출·고정지출)은 자동 제외됩니다.
          </p>
          {loading && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2">파일을 분석하는 중…</p>}
        </div>

        {/* 2단계: 미리보기 */}
        {parsed && stats && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="회원" value={`${stats.members}명`} color="text-blue-700 dark:text-blue-400"/>
              <Stat label="결제" value={`${stats.payments}건`} color="text-amber-700 dark:text-amber-400"/>
              <Stat label="총 세션" value={`${stats.totalSessions}회`} color="text-emerald-700 dark:text-emerald-400"/>
              <Stat label="재등록 회원" value={`${stats.reEnroll}명`} color="text-slate-700 dark:text-slate-200"/>
              <Stat label="월회원" value={`${stats.monthly}명`} color="text-blue-700 dark:text-blue-300"/>
              <Stat label="환불" value={`${stats.refunds}건`} color="text-red-700 dark:text-red-400"/>
            </div>

            {parsed.unmatched.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <p className="text-xs font-bold text-red-700 dark:text-red-400">⚠️ 매칭 안 된 담당 트레이너: {parsed.unmatched.join(', ')}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  CMS에 해당 이름의 트레이너가 없어 세션이 연결되지 않았습니다. 트레이너를 먼저 등록하거나 이름을 확인한 뒤 다시 가져오세요.
                </p>
              </div>
            )}

            {/* 회원 목록 미리보기(최대 12명) */}
            <div className="bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-slate-900">
                  <tr className="text-slate-500 text-left">
                    <th className="px-3 py-2">회원</th><th className="px-3 py-2">세션</th>
                    <th className="px-3 py-2">결제</th><th className="px-3 py-2">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.members.slice(0, 50).map((m, i) => {
                    const sess = Object.entries(m.trainerSessions||{}).map(([tid,v])=>{
                      const t = trainers.find(x=>x.id===tid); return `${t?t.name:'?'} ${v.total}`;
                    }).join(', ');
                    const note = [];
                    if (m.monthly) note.push('월회원');
                    if (m.payments.filter(p=>!p.isRefunded).length>1) note.push('재등록');
                    if (m.warnings?.length) note.push(...m.warnings);
                    return (
                      <tr key={i} className="border-t border-slate-200/60 dark:border-slate-800/60">
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 font-semibold">{m.name}</td>
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{sess||'—'}</td>
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{m.payments.length}건</td>
                        <td className="px-3 py-1.5 text-slate-500">{note.join(' · ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {parsed.members.length > 50 && (
                <p className="text-[11px] text-slate-600 text-center py-2">…외 {parsed.members.length - 50}명</p>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={()=>setParsed(null)} className="text-xs text-slate-500 dark:text-slate-400 hover:text-white px-3 py-2">다시 선택</button>
              <button onClick={commit} disabled={committing}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2 rounded-lg text-sm disabled:opacity-40">
                {committing ? '등록 중…' : `${stats.members}명 등록`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-sm font-black ${color}`}>{value}</p>
    </div>
  );
}
