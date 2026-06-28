// ai-measure/AiMeasureHub.jsx
// AI 측정 허브. 메뉴를 고르면 해당 모듈만 lazy 로드해 구동한다(필요 기능만).
import { useState, Suspense } from 'react';
import { MEASURE_MENUS } from './registry';
import { store, aiStore, VIRTUAL_MID } from '../demoData';
import { todayYMD } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { scopeMembersToTrainer, sortByName } from '../utils/memberList';

export default function AiMeasureHub() {
  const { user } = useAuth();
  // 트레이너 모드: 담당 회원만 / 모든 회원은 가나다 순으로 노출.
  const [members] = useState(() => sortByName(scopeMembersToTrainer(store.getMembers(), user)));
  const [memberId, setMemberId] = useState('');
  const [heightOverrides, setHeightOverrides] = useState({});
  const [active, setActive] = useState(null); // 선택된 메뉴 객체
  // 회원 미선택 시 입력하는 '가상회원' 신체정보. 모든 측정에서 저장·출력에 사용된다.
  const [virtual, setVirtual] = useState({ sex: '', birthDate: '', height: '', weight: '' });

  const baseMember = members.find(m => m.id === memberId);
  // 회원의 최근 신체기록에서 키·몸무게를 자동 연동
  const realMember = baseMember ? (() => {
    const records = store.getBodyRecords(baseMember.id) || [];
    const byRecent = [...records].sort((a, b) =>
      String(b.recordedAt).localeCompare(String(a.recordedAt)));
    const latestHeight = byRecent.find(r => r.height)?.height ?? null;
    const latestWeight = byRecent.find(r => r.weight != null)?.weight ?? null;
    return {
      ...baseMember,
      height: heightOverrides[baseMember.id] || baseMember.height || latestHeight || null,
      // 점프 파워(Sayers) 계산에 쓰는 체중 자동 연동 (신체정보 → 측정)
      weight: baseMember.weight ?? latestWeight ?? null,
    };
  })() : null;

  // 가상회원 객체: 신체정보 입력이 하나라도 있으면 구성.
  // 모든 측정 유형에서 저장·출력되며, 회원 이력과 분리된 가상회원 버킷에 보관된다.
  const virtualMember = (() => {
    const hasAny = virtual.sex || virtual.birthDate || virtual.height || virtual.weight;
    if (!hasAny) return null;
    return {
      id: VIRTUAL_MID,       // 가상회원 전용 센티넬 id (회원 이력과 분리 저장)
      isVirtual: true,
      name: '가상회원',
      sex: virtual.sex || null,
      gender: virtual.sex || null,
      birthDate: virtual.birthDate || null,
      height: virtual.height ? Number(virtual.height) : null,
      weight: virtual.weight ? Number(virtual.weight) : null,
    };
  })();

  // 측정에 실제로 넘겨줄 유효 회원: 실제 회원 우선, 없으면 가상회원.
  const member = realMember || virtualMember;

  const rememberMemberHeight = async (heightCm) => {
    if (!member || !heightCm) return;
    setHeightOverrides(prev => ({ ...prev, [member.id]: heightCm }));
    if (member.isVirtual) return; // 가상회원은 신체기록 영구 저장 생략(세션 한정)
    // 신체정보에 키가 전혀 없을 때만 영구 저장(중복 기록 방지) → 다음부터 안 물어봄
    try {
      const recs = store.getBodyRecords(member.id) || [];
      const hasHeight = recs.some(r => r.height);
      if (!hasHeight && typeof store.addBodyRecord === 'function') {
        await store.addBodyRecord(member.id, {
          recordedAt: new Date().toISOString().slice(0, 10),
          height: Number(heightCm),
          note: '점프 측정 시 자동 입력',
        });
      }
    } catch (e) { /* 저장 실패해도 세션 오버라이드로 동작 */ }
  };

  // 측정 저장 — 실제 회원이든 가상회원이든 '모든 측정 유형'에서 저장·출력된다.
  //  • 실제 회원: 회원 측정이력(ai) + 분석 리포트 컬렉션에 누적.
  //  • 가상회원: 회원 이력과 분리된 가상 버킷(__mid=VIRTUAL_MID)에 저장. 모든 신체정보 동봉.
  const handleSave = async (data) => {
    if (!member) { alert('회원을 선택하거나, 가상회원 신체정보를 입력해 주세요.'); return; }
    // 보행 분석은 컴포넌트가 자체 저장 상태 UI(저장 중/✓/실패)를 표시하므로
    // alert 없이 에러를 그대로 throw 해 컴포넌트가 처리하게 한다.
    const isGait = active.id === 'gait';
    const isJump = active.id === 'jump';
    const isPosture = active.id === 'posture';

    // 가상회원이면 모든 저장 페이로드에 신체정보를 동봉(리포트 출력·해석에 사용).
    const memberRef = { id: member.id, name: member.name, isVirtual: member.isVirtual === true };
    const virtualBody = member.isVirtual ? {
      sex: member.sex || null,
      gender: member.gender || null,
      birthDate: member.birthDate || null,
      heightCm: member.height || null,
      weightKg: member.weight || null,
      isVirtualMember: true,
    } : {};

    try {
      // 회원 측정이력(ai): 실제 회원과 가상회원 모두 저장(가상은 분리된 버킷).
      await aiStore.addSession(member.id, {
        menu: active.id,
        menuTitle: active.title,
        recordedAt: todayYMD(), // CV-A: 로컬 날짜
        recordedAtFull: new Date().toISOString(),
        isVirtual: member.isVirtual === true,
        ...virtualBody,
        data,
      });
      // 보행/점프 분석은 전용 컬렉션(gait_reports)에도 정량 리포트를 추가 저장 → 회차별 비교.
      if (isGait) {
        return await aiStore.addGaitReport({ ...virtualBody, ...data, kind: 'gait', member: memberRef });
      }
      if (isJump && data?.valid === true) {
        return await aiStore.addGaitReport({ ...virtualBody, ...data, kind: 'jump', member: memberRef });
      }
      if (isPosture) {
        return await aiStore.addPostureReport({ ...virtualBody, ...data, kind: 'posture', member: memberRef });
      }
      alert(member.isVirtual ? '가상회원 측정이 저장되었습니다.' : '측정이 저장되었습니다.');
    } catch (e) {
      if (isGait || isJump || isPosture) throw e; // 컴포넌트 saveState='error' 로 표시되게 전파
      alert('저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.\n' + (e?.message || ''));
    }
  };

  // 메뉴 구동 화면
  if (active && active.status === 'ready') {
    const Comp = active.component;
    const wideMeasure = active.id === 'gait' || active.id === 'jump' || active.id === 'posture';
    return (
      <div className={`${wideMeasure ? 'max-w-6xl' : 'max-w-md'} mx-auto`}>
        <Suspense fallback={<div className="text-center text-slate-400 py-10 text-sm">모듈 로딩 중…</div>}>
          <Comp member={member} onSave={handleSave} onBack={() => setActive(null)} onMemberHeightChange={rememberMemberHeight} />
        </Suspense>
      </div>
    );
  }

  // 허브(메뉴 목록)
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight">AI 측정 · 분석</h1>
        <p className="text-slate-500 text-sm mt-1">측정 항목을 선택하세요. 항목별로 필요한 기능만 구동됩니다.</p>
      </div>

      {/* 회원 선택 (선택 사항 — 저장하려면 필요) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
          회원 선택 (저장 시 필요)
        </label>
        <select value={memberId} onChange={e => setMemberId(e.target.value)}
          className="input">
          <option value="">선택 안 함 (가상회원으로 측정)</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.phone?.slice(-4)})</option>)}
        </select>

        {/* 회원 미선택 시: 가상회원 신체정보 입력. 모든 측정 유형에서 저장·출력되며
            성별 기준·체형나이 등 측정 정확도를 높인다. */}
        {!realMember && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <p className="text-xs font-semibold text-amber-300/90 mb-2">
              가상회원 신체정보 <span className="text-slate-500 font-normal">(모든 측정에서 저장·출력 — 정확도 향상)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">성별</label>
                <div className="flex gap-1.5">
                  {[['male','남'],['female','여']].map(([val,lbl])=>(
                    <button type="button" key={val}
                      onClick={()=>setVirtual(v=>({...v, sex: v.sex===val ? '' : val}))}
                      className={`flex-1 rounded-lg text-sm font-bold border py-1.5 transition-colors
                        ${virtual.sex===val
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">생년월일</label>
                <input type="date" value={virtual.birthDate}
                  onChange={e=>setVirtual(v=>({...v, birthDate: e.target.value}))}
                  className="input py-1.5 text-sm"/>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">키 (cm)</label>
                <input type="number" inputMode="decimal" value={virtual.height}
                  onChange={e=>setVirtual(v=>({...v, height: e.target.value}))}
                  placeholder="예: 170" className="input py-1.5 text-sm"/>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">몸무게 (kg)</label>
                <input type="number" inputMode="decimal" value={virtual.weight}
                  onChange={e=>setVirtual(v=>({...v, weight: e.target.value}))}
                  placeholder="예: 65" className="input py-1.5 text-sm"/>
              </div>
            </div>
            {virtualMember && (
              <p className="mt-2 text-[11px] text-emerald-300/80">
                가상회원으로 측정·저장합니다{virtualMember.sex ? ` · ${virtualMember.sex==='female'?'여':'남'}` : ''}
                {virtualMember.height ? ` · ${virtualMember.height}cm` : ''}
                {virtualMember.weight ? ` · ${virtualMember.weight}kg` : ''}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* 메뉴 그리드 */}
      <div className="grid grid-cols-2 gap-3">
        {[...MEASURE_MENUS].sort((a, b) => a.no - b.no).map(menu => {
          const ready = menu.status === 'ready';
          return (
            <button key={menu.id}
              onClick={() => ready && setActive(menu)}
              disabled={!ready}
              className={`text-left rounded-2xl p-4 border transition
                ${ready
                  ? 'bg-slate-900 border-amber-500/30 hover:border-amber-500 active:scale-[0.98]'
                  : 'bg-slate-900/50 border-slate-800 opacity-50 cursor-not-allowed'}`}>
              <span className="text-2xl">{menu.icon}</span>
              <p className="font-bold text-sm mt-2">{menu.no}. {menu.title}</p>
              <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{menu.desc}</p>
              <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-semibold
                ${ready ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-500'}`}>
                {ready ? '이용 가능' : '준비 중'}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        측정 항목은 단계적으로 추가됩니다. <strong className="text-slate-300">이용 가능</strong> 표시된 항목만
        구동되며, <strong className="text-slate-300">준비 중</strong> 항목은 작동 검증 후 순차 적용됩니다.
      </p>
    </div>
  );
}
