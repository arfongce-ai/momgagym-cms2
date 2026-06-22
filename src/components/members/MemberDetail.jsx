// MemberDetail.jsx — v5
// ✅ 수납 관리 탭 (결제일·금액·수단·미수금)
// ✅ 신체정보 탭 (체중·체지방·근육량 누적)
// ✅ 기본정보 수정 + 세션 재등록
// ✅ 트레이너별 세션 개별 카드
import { useState, useEffect } from 'react';
import { store } from '../../demoData';
import { todayYMD, addMonthsYMD } from '../../utils/dates';
import { useAuth } from '../../contexts/AuthContext';
import { ClassTypeCheckbox } from './MemberRegister';
import AiMeasureReport     from '../ai/AiMeasureReport';
import MemberMeasureHistory from '../ai/MemberMeasureHistory';
import { METHOD_LBL, METHOD_CLR, computeMonthRates } from '../../services/finance';

const INP = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500";
const LBL = "block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5";
const makePayForm = () => ({
  paidAt: todayYMD(),
  amount: '',
  method: 'pay',
  isUnpaid: false,
  note: '',
  trainerIds: [],
  split: [],
  methodList: [],
  sessionAdds: [],
  isReEnroll: false,
  reEnrollNo: '',
  isNew: false,
  consultTrainerId: '',
  category: 'normal',
});

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
  const [addSessDate,   setAddSessDate]   = useState(todayYMD());
  // 세션 직접 조정
  const [adjustTid,     setAdjustTid]     = useState(null);
  const [adjustForm,    setAdjustForm]    = useState({ remaining:0, total:0 });
  // 세션 양도 / 부분양도
  const [transferTid,   setTransferTid]   = useState(null); // 양도 출발 트레이너
  const [transferForm,  setTransferForm]  = useState({ toTid:'', count:1 });

  // 수납
  const [payments,     setPayments]    = useState([]);
  const [showAddPay,   setShowAddPay]  = useState(false);
  const [payForm,      setPayForm]     = useState(makePayForm);

  // 신체정보
  const [bodyRecords,  setBodyRecords] = useState([]);
  const [showAddBody,  setShowAddBody] = useState(false);
  const [showAiModal,  setShowAiModal]  = useState(false);
  const [aiRefreshKey, setAiRefreshKey] = useState(0);
  const [bodyForm,     setBodyForm]    = useState({ recordedAt: todayYMD(), height:'', weight:'', systolic:'', diastolic:'', note:'' });

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
        name:editForm.name, gender:editForm.gender||'',
        phone:editForm.phone, phone2:editForm.phone2||'',
        birthDate:editForm.birthDate||'', address:editForm.address||'',
        joinDate:editForm.joinDate||'',
        // 최근결제일은 '수납 등록' 시에만 자동 갱신됨 — 기본정보 저장에서 건드리지 않는다.
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
      setAddSessDate(todayYMD());
      onUpdate?.();
    } catch (e) { alert('세션 등록에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
  };

  // ── 세션 직접 조정 / 복구 ─────────────────────────────
  const startAdjust = (tid, s) => { setAdjustTid(tid); setAdjustForm({ remaining:s.remaining, total:s.total }); setTransferTid(null); };
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

  // ── 세션 양도 / 부분양도 ──────────────────────────────
  const startTransfer = (tid, s) => {
    setTransferTid(tid);
    setTransferForm({ toTid:'', count: s.remaining > 0 ? 1 : 0 });
    setAdjustTid(null); // 다른 인라인 폼 닫기
  };
  const saveTransfer = async (fromTid) => {
    const { toTid, count } = transferForm;
    if (!toTid) { alert('양도받을 트레이너를 선택하세요.'); return; }
    const fresh = store.getMembers().find(m=>m.id===member.id);
    const src = (fresh?.trainerSessions||{})[fromTid];
    const fromName = trainerMap[fromTid]?.name || fromTid;
    const toName   = trainerMap[toTid]?.name   || toTid;
    const isFull   = Number(count) >= (src?.remaining ?? 0);
    const msg = isFull
      ? `${fromName} → ${toName}\n잔여 ${src?.remaining ?? 0}회 전체를 양도합니다. 진행할까요?`
      : `${fromName} → ${toName}\n${count}회를 양도합니다. 진행할까요?`;
    if (!window.confirm(msg)) return;
    try {
      await store.transferSessions(member.id, { fromTid, toTid, count:Number(count) });
      refresh(); setTransferTid(null); onUpdate?.();
    } catch (e) {
      alert('양도에 실패했습니다.\n' + (e?.message || ''));
    }
  };

  // ── 다중 트레이너 금액 분배(split) 유틸 ─────────────────────
  // split = [{ trainerId, amount }] — 다중(2명 이상)일 때만 사용.
  // 총금액을 트레이너들에게 균등(기본 5:5)으로 나누되, 나머지는 첫 트레이너에 몰아준다.
  const evenSplit = (tids, total) => {
    const n = tids.length;
    if (n === 0) return [];
    const t = Math.max(0, Math.round(Number(total) || 0));
    const base = Math.floor(t / n);
    return tids.map((tid, i) => ({ trainerId: tid, amount: base + (i === 0 ? t - base * n : 0) }));
  };
  // trainerIds 또는 총금액이 바뀔 때 split을 재구성.
  //  · 다중이 아니면 split 비움
  //  · 이미 있던 트레이너의 금액은 유지(가능하면), 새로 추가된 트레이너만 균등 채움
  const rebuildSplit = (tids, total, prevSplit) => {
    if (tids.length < 2) return [];
    const prevMap = Object.fromEntries((prevSplit||[]).map(s => [s.trainerId, Number(s.amount)||0]));
    const known = tids.filter(id => prevMap[id] != null);
    // 이전 값이 전혀 없으면(처음 다중 진입) 균등 분배(5:5)
    if (known.length === 0) return evenSplit(tids, total);
    // 일부만 알고 있으면: 알던 합을 빼고 나머지를 새 트레이너들에 균등 배분
    const usedSum = known.reduce((s,id)=>s+prevMap[id],0);
    const fresh = tids.filter(id => prevMap[id] == null);
    const rest = Math.max(0, (Number(total)||0) - usedSum);
    const freshSplit = Object.fromEntries(evenSplit(fresh, rest).map(s=>[s.trainerId, s.amount]));
    return tids.map(id => ({ trainerId: id, amount: prevMap[id] != null ? prevMap[id] : (freshSplit[id]||0) }));
  };
  const defaultClassTypeFor = (tid) => {
    const current = member.classTypes?.[0] || '';
    const trainerTypes = trainerMap[tid]?.classTypes || [];
    return current && (!trainerTypes.length || trainerTypes.includes(current))
      ? current
      : (trainerTypes[0] || current || '');
  };
  const syncSessionAdds = (tids, prevAdds=[]) => tids.map(tid => {
    const prev = prevAdds.find(x => x.trainerId === tid);
    return {
      trainerId: tid,
      count: prev?.count ?? '',
      classType: prev?.classType ?? defaultClassTypeFor(tid),
    };
  });
  const updatePaySessionAdd = (tid, patch) => setPayForm(p => ({
    ...p,
    sessionAdds: syncSessionAdds(p.trainerIds, p.sessionAdds).map(x =>
      x.trainerId === tid ? { ...x, ...patch } : x
    ),
  }));

  // 트레이너 토글: 선택/해제 후 split 재구성
  const togglePayTrainer = (tid) => setPayForm(p => {
    const on = p.trainerIds.includes(tid);
    const tids = on ? p.trainerIds.filter(id=>id!==tid) : [...p.trainerIds, tid];
    return {
      ...p,
      trainerIds: tids,
      split: rebuildSplit(tids, p.amount, p.split),
      sessionAdds: syncSessionAdds(tids, p.sessionAdds),
    };
  });
  // 총금액 변경: 다중이면 split도 함께 재구성(기존 비율 유지하며 합계 맞춤)
  const onAmountChange = (val) => setPayForm(p => {
    // 복합결제(2개 이상)면 수단별 금액도 기존 비율 유지하며 새 총액에 맞춰 스케일
    let methodList = p.methodList || [];
    if (methodList.length >= 2) {
      const t = Math.max(0, Math.round(Number(val)||0));
      const sum = methodList.reduce((s,x)=>s+(Number(x.amount)||0),0) || t || 1;
      let acc=0;
      methodList = methodList.map((x,i)=>{
        const amt = i===methodList.length-1 ? t-acc : Math.round(t*((Number(x.amount)||0)/sum));
        acc+=amt; return { method:x.method, amount:amt };
      });
    }
    const tids = p.trainerIds;
    if (tids.length < 2) return { ...p, amount: val, split: [], methodList };
    const prev = p.split || [];
    const prevSum = prev.reduce((s,x)=>s+(Number(x.amount)||0),0);
    let next;
    if (prevSum > 0) {
      // 기존 비율 유지하며 새 총액에 맞춰 스케일
      const t = Math.max(0, Math.round(Number(val)||0));
      let acc = 0;
      next = tids.map((id, i) => {
        const cur = Number(prev.find(s=>s.trainerId===id)?.amount)||0;
        const amt = i === tids.length-1 ? t - acc : Math.round(t * (cur/prevSum));
        acc += amt; return { trainerId: id, amount: amt };
      });
    } else {
      next = evenSplit(tids, val); // 기본 5:5
    }
    return { ...p, amount: val, split: next, methodList };
  });
  // 개별 트레이너 금액 직접 수정(다른 트레이너 금액은 그대로, 총액은 합으로 표시)
  const onSplitAmount = (tid, val) => setPayForm(p => {
    const split = p.trainerIds.map(id =>
      ({ trainerId: id, amount: id===tid ? Math.max(0, Math.round(Number(val)||0))
                                          : (Number(p.split.find(s=>s.trainerId===id)?.amount)||0) }));
    const total = split.reduce((s,x)=>s+x.amount,0);
    return { ...p, split, amount: String(total) };
  });
  // 비율(%) 직접 수정 → 총액 기준 금액 자동 산출
  const onSplitRatio = (tid, pct) => setPayForm(p => {
    const total = Math.max(0, Math.round(Number(p.amount)||0));
    const ratio = Math.min(100, Math.max(0, Number(pct)||0));
    const others = p.trainerIds.filter(id=>id!==tid);
    const thisAmt = Math.round(total * ratio/100);
    const rest = Math.max(0, total - thisAmt);
    // 나머지는 다른 트레이너들에게 균등 배분
    const restSplit = Object.fromEntries(evenSplit(others, rest).map(s=>[s.trainerId, s.amount]));
    const split = p.trainerIds.map(id => ({ trainerId:id, amount: id===tid ? thisAmt : (restSplit[id]||0) }));
    return { ...p, split };
  });

  // ── 복합 결제수단(methodList) 유틸 ─────────────────────────
  // methodList = [{ method, amount }] — 2개 이상이면 복합결제.
  // 총금액(payForm.amount)을 수단들에 분배. 1개면 그 수단이 전액.
  const evenMethods = (methods, total) => {
    const n = methods.length;
    if (n === 0) return [];
    const t = Math.max(0, Math.round(Number(total)||0));
    const base = Math.floor(t/n);
    return methods.map((mth,i)=>({ method:mth, amount: base + (i===0 ? t-base*n : 0) }));
  };
  // 수단 토글: 선택/해제 후 금액 재분배(기존 금액 유지, 새 수단은 나머지 균등)
  const toggleMethod = (mv) => setPayForm(p => {
    const cur = (p.methodList && p.methodList.length) ? p.methodList : [{ method:p.method, amount:Number(p.amount)||0 }];
    const has = cur.some(x=>x.method===mv);
    let list;
    if (has) {
      list = cur.filter(x=>x.method!==mv);
      if (list.length === 0) list = [{ method:mv, amount:Number(p.amount)||0 }]; // 최소 1개 유지
    } else {
      list = [...cur, { method:mv, amount:0 }];
    }
    // 1개면 전액, 2개 이상이면 기존 유지 + 새 수단에 나머지 균등
    if (list.length === 1) {
      list = [{ method:list[0].method, amount:Math.max(0,Math.round(Number(p.amount)||0)) }];
    } else {
      const total = Math.max(0,Math.round(Number(p.amount)||0));
      const knownSum = list.filter(x=>x.amount>0).reduce((s,x)=>s+x.amount,0);
      const fresh = list.filter(x=>!(x.amount>0));
      if (fresh.length) {
        const rest = Math.max(0, total-knownSum);
        const per = Math.floor(rest/fresh.length);
        let fi=0;
        list = list.map(x=> x.amount>0 ? x
          : { method:x.method, amount: per + (fi++===0 ? rest-per*fresh.length : 0) });
      }
    }
    return { ...p, methodList:list, method:list[0].method };
  });
  // 복합결제 각 수단 금액 직접 수정 → 총액은 합으로 갱신(트레이너 분배도 따라 재계산)
  const onMethodAmount = (mv, val) => setPayForm(p => {
    const list = (p.methodList||[]).map(x=> x.method===mv
      ? { method:mv, amount:Math.max(0,Math.round(Number(val)||0)) } : x);
    const total = list.reduce((s,x)=>s+x.amount,0);
    const split = p.trainerIds.length>=2 ? rebuildSplit(p.trainerIds, total, p.split) : [];
    return { ...p, methodList:list, amount:String(total), method:list[0]?.method||p.method, split };
  });


  // ── 수납 등록 폼 열기: 담당 트레이너 자동 선택 ──────────────
  //  · 2명이면 둘 다 자동 선택(자동 5:5 분배) · 1명이면 그 1명 자동 선택
  const openAddPay = () => {
    const registered = Object.keys(member.trainerSessions || {});
    setPayForm(p => ({
      ...p,
      trainerIds: registered,
      split: rebuildSplit(registered, p.amount, []),
      sessionAdds: syncSessionAdds(registered, p.sessionAdds),
    }));
    setShowAddPay(true);
  };
  // ── 수납 등록 ─────────────────────────────────────────
  const handleAddPayment = async () => {
    if (!payForm.amount) { alert('금액을 입력해 주세요.'); return; }
    try {
      // 재등록일 때만 회차 저장(숫자), 아니면 회차 비움
      const reEnrollNo = payForm.isReEnroll && payForm.reEnrollNo
        ? Number(payForm.reEnrollNo) : null;
      // 다중(2명 이상)일 때만 split 저장. 선택된 트레이너만, 금액 정수화.
      const split = payForm.trainerIds.length >= 2
        ? payForm.trainerIds.map(id => ({
            trainerId: id,
            amount: Math.max(0, Math.round(Number(payForm.split.find(x=>x.trainerId===id)?.amount)||0)),
          }))
        : [];
      // 복합결제(2개 이상)일 때만 methods 저장. 단일이면 method만(구조 단순 유지).
      const methods = payForm.methodList.length >= 2
        ? payForm.methodList.map(x=>({ method:x.method, amount:Math.max(0,Math.round(Number(x.amount)||0)) }))
        : [];
      const primaryMethod = methods.length ? methods[0].method : payForm.method;
      const sessionAdds = syncSessionAdds(payForm.trainerIds, payForm.sessionAdds)
        .map(x => ({
          trainerId: x.trainerId,
          count: Math.max(0, Math.round(Number(x.count)||0)),
          classType: x.classType || '',
        }))
        .filter(x => x.count > 0);
      const { methodList, sessionAdds: _sessionAdds, ...rest } = payForm;
      // 신규일 때만 상담 트레이너 저장(아니면 비움)
      const consultTrainerId = payForm.isNew ? (payForm.consultTrainerId || '') : '';
      const newPayment = { ...rest, method:primaryMethod, methods, amount:Number(payForm.amount), split, sessionAdds, reEnrollNo, consultTrainerId };

      // ── 결제월 정산비율 박제(snapshot) ──────────────────────────
      // 이 결제가 이뤄진 달(paidAt의 YYYY-MM) 기준 비율을 계산해 결제 건에 고정한다.
      // 이후 설정/실적이 바뀌어도 이 결제의 비율은 변하지 않는다(결제월 고정).
      const ym = (payForm.paidAt || '').slice(0,7);
      const involved = payForm.trainerIds.length ? payForm.trainerIds
        : Object.keys(member.trainerSessions || {});
      const trainersInvolved = trainers.filter(t => involved.includes(t.id));
      // 그 달 결제 모음(이 신규 결제 포함) — 비율 판정 입력
      const monthPayments = {};
      store.getMembers().forEach(mm => {
        const list = (store.getPayments(mm.id)||[]).filter(p => (p.paidAt||'').slice(0,7) === ym);
        monthPayments[mm.id] = mm.id === member.id ? [...list, newPayment] : list;
      });
      const rateMap = computeMonthRates({
        trainers: trainersInvolved.length ? trainersInvolved : trainers,
        members: store.getMembers(),
        payments: monthPayments,
        records: store.getPromos(),
        settings: store.getSettings(),
        ym,
      });
      const splitRateAtPay = {};
      (involved.length ? involved : trainers.map(t=>t.id)).forEach(tid => {
        if (rateMap[tid]) splitRateAtPay[tid] = rateMap[tid].rate;
      });
      newPayment.splitRateAtPay = splitRateAtPay;

      const memberPatch = { lastPaymentDate:payForm.paidAt };
      // 월정액 회원: 결제하면 다음 결제 예정일을 한 달 뒤로 갱신 (monthly 객체 갱신)
      if (member.monthly && member.monthly.active) {
        const curDue = member.monthly.dueDate;
        const base = (curDue && curDue >= payForm.paidAt) ? curDue : payForm.paidAt;
        memberPatch.monthly = { ...member.monthly, dueDate: addMonthsYMD(1, base) };
      }
      if (sessionAdds.length) {
        const fresh = store.getMembers().find(m=>m.id===member.id);
        const ts = JSON.parse(JSON.stringify(fresh?.trainerSessions||{}));
        const curCT = fresh?.classTypes || [];
        const classTypeSet = new Set(curCT);
        sessionAdds.forEach(({ trainerId, count, classType }) => {
          if (ts[trainerId]) {
            ts[trainerId].total = Math.max(0, Number(ts[trainerId].total)||0) + count;
            ts[trainerId].remaining = Math.max(0, Number(ts[trainerId].remaining)||0) + count;
          } else {
            ts[trainerId] = { total:count, remaining:count };
          }
          if (classType) classTypeSet.add(classType);
        });
        memberPatch.trainerSessions = ts;
        memberPatch.classTypes = [...classTypeSet];
      }
      // 수납 기록과 회원 세션을 한 번에 저장해 정산 기준 데이터가 어긋나지 않게 한다.
      await store.addPaymentWithMemberUpdate(member.id, newPayment, memberPatch);
      refresh(); setShowAddPay(false);
      setPayForm(makePayForm());
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
      setBodyForm({ recordedAt:todayYMD(), height:'', weight:'', systolic:'', diastolic:'', note:'' });
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
                  {l:'성별',       v:member.gender==='male'?'남':member.gender==='female'?'여':'미등록'},
                  {l:'연락처',     v:member.phone},
                  {l:'연락처 2',   v:member.phone2||'미등록'},
                  {l:'생년월일',   v:member.birthDate||'미등록'},
                  {l:'주소',       v:member.address||'미등록'},
                  {l:'가입일',     v:member.joinDate||'미등록'},
                  ...(member.monthly?.active
                    ? [{l:'월정액', v:`${(member.monthly.fee||0).toLocaleString()}원 · 다음결제 ${member.monthly.dueDate||'미등록'}`}] : []),
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
                  <div>
                    <label className={LBL}>이름</label>
                    <input value={editForm.name||''} onChange={pfe('name')} className={INP}/>
                    <div className="flex gap-2 mt-2">
                      {[['male','남'],['female','여']].map(([val,lbl])=>(
                        <button type="button" key={val}
                          onClick={()=>setEF(f=>({...f, gender: f.gender===val ? '' : val}))}
                          className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors
                            ${editForm.gender===val
                              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                              : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div><label className={LBL}>연락처</label><input value={editForm.phone||''} onChange={pfe('phone')} className={INP}/></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={LBL}>생년월일</label><input type="date" value={editForm.birthDate||''} onChange={pfe('birthDate')} className={INP}/></div>
                  <div><label className={LBL}>연락처 2 (보호자·비상)</label><input value={editForm.phone2||''} onChange={pfe('phone2')} className={INP}/></div>
                </div>
                <div><label className={LBL}>주소 (선택)</label><input value={editForm.address||''} onChange={pfe('address')} placeholder="주소를 입력하세요 (선택)" className={INP}/></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={LBL}>가입일</label><input type="date" value={editForm.joinDate||''} onChange={pfe('joinDate')} className={INP}/></div>
                  <div>
                    <label className={LBL}>최근결제일</label>
                    <div className={INP+" text-slate-400 flex items-center"}>
                      {editForm.lastPaymentDate || '수납 등록 시 자동 입력'}
                    </div>
                  </div>
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
                        transferTid===tid ? (
                          <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400">
                              세션 양도 · {t?.name||tid} → ?
                            </p>
                            <div>
                              <label className="text-[10px] text-slate-500">양도받을 트레이너</label>
                              <select value={transferForm.toTid}
                                onChange={e=>setTransferForm(f=>({...f,toTid:e.target.value}))}
                                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-2 py-1.5 text-sm">
                                <option value="">선택하세요</option>
                                {trainers.filter(tt=>tt.id!==tid).map(tt=>(
                                  <option key={tt.id} value={tt.id}>
                                    {tt.name}{member.trainerSessions?.[tt.id] ? ` (잔여${member.trainerSessions[tt.id].remaining})` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500">양도 세션 수 (최대 {s.remaining}회)</label>
                              <div className="flex items-center gap-2">
                                <input type="number" min="1" max={s.remaining} value={transferForm.count}
                                  onChange={e=>setTransferForm(f=>({...f,count:e.target.value}))}
                                  className="flex-1 bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-2 py-1.5 text-sm font-mono"/>
                                <button type="button" onClick={()=>setTransferForm(f=>({...f,count:s.remaining}))}
                                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 text-slate-200 hover:bg-blue-500/20 hover:text-blue-400 transition-colors whitespace-nowrap">
                                  전체 양도
                                </button>
                              </div>
                            </div>
                            {transferForm.toTid && (
                              <div className="bg-slate-700/50 rounded-lg px-3 py-2 text-[11px] text-slate-400">
                                <span className="text-slate-300 font-semibold">{t?.name||tid}</span> →{' '}
                                <span className="text-blue-300 font-semibold">{trainerMap[transferForm.toTid]?.name}</span>{' '}
                                <span className="text-blue-400 font-bold">{transferForm.count||0}회</span> 이동
                                {Number(transferForm.count) >= s.remaining && <span className="text-amber-400 font-bold ml-1">(전체 양도 → 출발 세션 제거)</span>}
                              </div>
                            )}
                            <div className="flex gap-2 justify-end">
                              <button onClick={()=>setTransferTid(null)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5">취소</button>
                              <button onClick={()=>saveTransfer(tid)} className="bg-blue-500 hover:bg-blue-400 text-white font-bold px-4 py-1.5 rounded-lg text-xs">양도 실행</button>
                            </div>
                          </div>
                        ) : adjustTid===tid ? (
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
                            {s.remaining>0 && !s.monthly && trainers.length>1 && (
                              <button onClick={()=>startTransfer(tid, s)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-700 text-slate-200 hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors">↔ 양도</button>
                            )}
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
                          {Array.isArray(p.methods)&&p.methods.length
                            ? <span className="text-xs font-bold flex flex-wrap gap-1">
                                {p.methods.map((mm,i)=>(
                                  <span key={i} className={METHOD_CLR[mm.method]||'text-slate-300'}>
                                    {METHOD_LBL[mm.method]||mm.method} {(Number(mm.amount)||0).toLocaleString()}{i<p.methods.length-1?' ·':''}
                                  </span>
                                ))}
                              </span>
                            : <span className={`text-xs font-bold ${METHOD_CLR[p.method]}`}>{METHOD_LBL[p.method]}</span>}
                          {p.isUnpaid&&<span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold">미수금</span>}
                          {p.isNew&&<span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold">신규{p.consultTrainerId?` · 상담 ${trainerMap[p.consultTrainerId]?.name||'?'}`:''}</span>}
                          {p.isReEnroll&&<span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded font-bold">재등록{p.reEnrollNo?` ${p.reEnrollNo}회차`:''}</span>}
                          {p.category==='edu_center'&&<span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">센터교육</span>}
                          {p.category==='edu_external'&&<span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">외부활동</span>}
                        </div>
                        <p className="text-slate-500 text-xs mt-0.5">{p.paidAt}</p>
                        {p.trainerIds?.length>0 && (
                          <p className="text-slate-400 text-xs mt-1">
                            담당: {Array.isArray(p.split)&&p.split.length
                              ? p.split.map(s=>`${trainerMap[s.trainerId]?.name||'?'} ${(Number(s.amount)||0).toLocaleString()}원`).join(' · ')
                              : p.trainerIds.map(id=>trainerMap[id]?.name||'?').join(', ')}
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
                <button onClick={openAddPay}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-slate-700 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 text-sm font-semibold transition-colors">
                  + 수납 등록
                </button>
              ) : (
                <div className="bg-slate-800 border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-amber-400 font-bold uppercase tracking-widest">수납 등록</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={LBL}>결제일</label><input type="date" value={payForm.paidAt} onChange={ppf('paidAt')} className={INP}/></div>
                    <div><label className={LBL}>금액 (원)</label><input type="number" min="0" value={payForm.amount} onChange={e=>onAmountChange(e.target.value)} placeholder="500000" className={INP+" font-mono"}/></div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={LBL+" mb-0"}>결제 수단 (복합 선택 가능)</label>
                      {payForm.methodList.length>=2 && (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold border bg-sky-500/20 text-sky-300 border-sky-500/40">
                          복합 {payForm.methodList.length}수단
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[['pay','페이'],['transfer','계좌'],['cash','현금'],['cash_receipt','현금영수증'],['card1','카드1'],['card2','카드2']].map(([v,l])=>{
                        const on = payForm.methodList.length
                          ? payForm.methodList.some(x=>x.method===v)
                          : payForm.method===v;
                        return (
                          <div key={v} onClick={()=>toggleMethod(v)}
                            className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer text-center transition-colors select-none
                              ${on?'bg-amber-500/20 border-amber-500/40 text-amber-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                            {l}
                          </div>
                        );
                      })}
                    </div>
                    {/* 복합결제(2개 이상)일 때만 — 수단별 금액 입력 */}
                    {payForm.methodList.length>=2 && (() => {
                      const mTotal = payForm.methodList.reduce((s,x)=>s+(Number(x.amount)||0),0);
                      return (
                        <div className="mt-2 bg-slate-900/60 border border-sky-500/20 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-400 font-semibold">수단별 금액 (예: 카드 80만 + 페이 20만)</span>
                            <button type="button"
                              onClick={()=>setPayForm(p=>({...p, methodList: evenMethods(p.methodList.map(x=>x.method), p.amount)}))}
                              className="text-[11px] px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:text-sky-300 hover:border-sky-500/40">균등</button>
                          </div>
                          {payForm.methodList.map(x=>(
                            <div key={x.method} className="flex items-center gap-2">
                              <span className={`text-xs font-bold w-20 flex-shrink-0 ${METHOD_CLR[x.method]||'text-slate-300'}`}>{METHOD_LBL[x.method]||x.method}</span>
                              <input type="number" min="0" value={x.amount}
                                onChange={e=>onMethodAmount(x.method, e.target.value)}
                                className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1.5 text-xs font-mono text-right"/>
                              <span className="text-[11px] text-slate-500 flex-shrink-0">원</span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-xs">
                            <span className="text-slate-500">수단 합계</span>
                            <span className={`font-mono font-bold ${mTotal===(Number(payForm.amount)||0)?'text-emerald-400':'text-amber-400'}`}>
                              {mTotal.toLocaleString()}원
                              {mTotal!==(Number(payForm.amount)||0) && ` (총액 ${(Number(payForm.amount)||0).toLocaleString()}원)`}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    {(() => {
                      const registered = Object.keys(member.trainerSessions || {});
                      const sel = payForm.trainerIds;
                      const mode = sel.length >= 2 ? '다중' : (sel.length === 1 ? '단독' : '미선택');
                      const modeClr = sel.length >= 2
                        ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
                        : sel.length === 1
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-red-500/20 text-red-300 border-red-500/40';
                      return (
                        <>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className={LBL+" mb-0"}>담당 트레이너 · 정산</label>
                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${modeClr}`}>
                              {mode}{sel.length >= 2 ? ` · 1/${sel.length} 정산` : sel.length === 1 ? ' 정산' : ''}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mb-2">
                            등록된 담당 트레이너가 자동 선택됩니다. 결제 전 단독/다중 여부를 확인하고 조정하세요.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {trainers.map(t=>{
                              const on  = sel.includes(t.id);
                              const reg = registered.includes(t.id);
                              return (
                                <div key={t.id} onClick={()=>togglePayTrainer(t.id)}
                                  className={`px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors select-none flex items-center gap-1.5
                                    ${on?'border-amber-500/40 bg-amber-500/10 text-amber-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                                  <span className="w-2 h-2 rounded-full" style={{background:t.color||'#94a3b8'}}/>
                                  {t.name}
                                  {reg && <span className="text-[10px] px-1 rounded bg-slate-700/70 text-slate-300">담당</span>}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* 다중(2명 이상)일 때만 — 트레이너별 금액/비율 분배 (기본 5:5) */}
                  {payForm.trainerIds.length >= 2 && (() => {
                    const total = payForm.trainerIds.reduce((s,id)=>
                      s + (Number(payForm.split.find(x=>x.trainerId===id)?.amount)||0), 0);
                    return (
                      <div className="bg-slate-900/60 border border-violet-500/20 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className={LBL+" mb-0"}>트레이너별 분배 (기본 5:5 · 비율/금액 조정)</label>
                          <button type="button"
                            onClick={()=>setPayForm(p=>({...p, split: evenSplit(p.trainerIds, p.amount)}))}
                            className="text-[11px] px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:text-violet-300 hover:border-violet-500/40">
                            5:5 균등
                          </button>
                        </div>
                        {payForm.trainerIds.map(id=>{
                          const t = trainerMap[id];
                          const amt = Number(payForm.split.find(x=>x.trainerId===id)?.amount)||0;
                          const pct = total>0 ? Math.round(amt/total*100) : 0;
                          return (
                            <div key={id} className="flex items-center gap-2">
                              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-200 w-24 flex-shrink-0">
                                <span className="w-2 h-2 rounded-full" style={{background:t?.color||'#94a3b8'}}/>
                                {t?.name||'?'}
                              </span>
                              <div className="flex items-center gap-1">
                                <input type="number" min="0" max="100" value={pct}
                                  onChange={e=>onSplitRatio(id, e.target.value)}
                                  className="w-14 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1.5 text-xs font-mono text-right"/>
                                <span className="text-[11px] text-slate-500">%</span>
                              </div>
                              <div className="flex items-center gap-1 flex-1">
                                <input type="number" min="0" value={amt}
                                  onChange={e=>onSplitAmount(id, e.target.value)}
                                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1.5 text-xs font-mono text-right"/>
                                <span className="text-[11px] text-slate-500 flex-shrink-0">원</span>
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-xs">
                          <span className="text-slate-500">분배 합계</span>
                          <span className={`font-mono font-bold ${total===(Number(payForm.amount)||0)?'text-emerald-400':'text-amber-400'}`}>
                            {total.toLocaleString()}원
                            {total!==(Number(payForm.amount)||0) && ` (총액 ${(Number(payForm.amount)||0).toLocaleString()}원)`}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                  {payForm.trainerIds.length > 0 && (
                    <div className="bg-slate-900/60 border border-emerald-500/20 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className={LBL+" mb-0"}>세션 자동 추가</label>
                        <span className="text-[11px] text-emerald-300 font-bold">
                          수납 저장 시 같이 반영
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        입력한 회차만 총 세션과 잔여 세션에 자동 추가됩니다. 0회 또는 빈칸은 세션 변경 없이 수납만 저장됩니다.
                      </p>
                      <div className="space-y-2">
                        {syncSessionAdds(payForm.trainerIds, payForm.sessionAdds).map(row => {
                          const t = trainerMap[row.trainerId];
                          const typeOptions = t?.classTypes?.length ? t.classTypes : (member.classTypes || []);
                          return (
                            <div key={row.trainerId} className="grid grid-cols-1 sm:grid-cols-[minmax(88px,1fr)_96px_minmax(110px,1.2fr)] gap-2 items-center">
                              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-200 min-w-0">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:t?.color||'#94a3b8'}}/>
                                <span className="truncate">{t?.name||'트레이너'}</span>
                              </span>
                              <div className="flex items-center gap-1">
                                <input type="number" min="0" value={row.count}
                                  onChange={e=>updatePaySessionAdd(row.trainerId, { count:e.target.value })}
                                  placeholder="0"
                                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1.5 text-xs font-mono text-right"/>
                                <span className="text-[11px] text-slate-500 flex-shrink-0">회</span>
                              </div>
                              <select value={row.classType}
                                onChange={e=>updatePaySessionAdd(row.trainerId, { classType:e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1.5 text-xs">
                                <option value="">수업종류</option>
                                {typeOptions.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                    <div onClick={()=>setPayForm(p=>{
                      const turningOn = !p.isReEnroll;
                      // 켤 때: 기존 재등록 결제 건수 + 1을 자동 제안(첫 기입 후 자동 적용)
                      const nextNo = (payments.filter(x=>x.isReEnroll).length) + 1;
                      return { ...p, isReEnroll:turningOn, isNew:false,
                        reEnrollNo: turningOn ? (p.reEnrollNo || String(nextNo)) : '' };
                    })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors select-none
                        ${payForm.isReEnroll?'border-blue-500/40 bg-blue-500/10 text-blue-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${payForm.isReEnroll?'bg-blue-500 border-blue-500':'border-slate-600 bg-slate-800'}`}>
                        {payForm.isReEnroll&&<svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      <span className="text-xs font-semibold">재등록</span>
                    </div>
                  </div>

                  {/* 신규등록 — 상담 트레이너(신규 인센티브·신규매출 귀속 대상) 1명 선택 */}
                  {payForm.isNew && (
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-3 py-2.5">
                      <label className={LBL}>상담 트레이너 (신규 인센티브 귀속)</label>
                      <div className="flex flex-wrap gap-2">
                        {trainers.map(t=>{
                          const on = payForm.consultTrainerId===t.id;
                          return (
                            <div key={t.id} onClick={()=>setPayForm(p=>({...p, consultTrainerId: on?'':t.id}))}
                              className={`px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer select-none flex items-center gap-1.5
                                ${on?'border-emerald-500/40 bg-emerald-500/10 text-emerald-400':'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                              <span className="w-2 h-2 rounded-full" style={{background:t.color||'#94a3b8'}}/>{t.name}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1.5">신규 인센티브와 60% 정산비율의 '신규매출'은 이 상담 트레이너에게 귀속됩니다(담당과 별개).</p>
                    </div>
                  )}

                  {/* 재등록 회차 — 체크 시에만 표시, 자동 제안값 수정 가능 */}
                  {payForm.isReEnroll && (
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-3 py-2.5">
                      <label className={LBL}>재등록 회차</label>
                      <div className="flex items-center gap-2">
                        <input type="number" min="1" value={payForm.reEnrollNo}
                          onChange={ppf('reEnrollNo')}
                          className={INP+" font-mono w-24"}/>
                        <span className="text-sm text-blue-400 font-bold">회차</span>
                        <span className="text-[11px] text-slate-500">
                          (자동 제안: {payments.filter(x=>x.isReEnroll).length + 1}회차 · 수정 가능)
                        </span>
                      </div>
                    </div>
                  )}
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
