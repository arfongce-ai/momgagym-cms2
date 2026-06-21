// ai-measure/AiMeasureHub.jsx
// AI 측정 허브. 메뉴를 고르면 해당 모듈만 lazy 로드해 구동한다(필요 기능만).
import { useState, Suspense } from 'react';
import { MEASURE_MENUS } from './registry';
import { store, aiStore } from '../demoData';
import { todayYMD } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';

export default function AiMeasureHub() {
  const { user } = useAuth();
  const [members] = useState(() => store.getMembers());
  const [memberId, setMemberId] = useState('');
  const [active, setActive] = useState(null); // 선택된 메뉴 객체

  const baseMember = members.find(m => m.id === memberId);
  // 회원의 최근 신체기록에서 키를 자동 연동
  const member = baseMember ? (() => {
    const records = store.getBodyRecords(baseMember.id) || [];
    const withHeight = records.filter(r => r.height);
    const latestHeight = withHeight.length
      ? withHeight.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0].height
      : null;
    return { ...baseMember, height: baseMember.height || latestHeight || null };
  })() : null;

  // 측정 저장 (회원 선택 시 측정이력에 누적)
  const handleSave = async (data) => {
    if (!member) { alert('먼저 회원을 선택하세요.'); return; }
    // 보행 분석은 컴포넌트가 자체 저장 상태 UI(저장 중/✓/실패)를 표시하므로
    // alert 없이 에러를 그대로 throw 해 컴포넌트가 처리하게 한다.
    const isGait = active.id === 'gait';
    try {
      await aiStore.addSession(member.id, {
        menu: active.id,
        menuTitle: active.title,
        recordedAt: todayYMD(), // CV-A: 로컬 날짜
        recordedAtFull: new Date().toISOString(),
        data,
      });
      // 보행 분석은 전용 컬렉션(gait_reports)에도 정량 리포트를 추가 저장 → 데이터 일원화.
      if (isGait) {
        await aiStore.addGaitReport({ ...data, member: { id: member.id, name: member.name } });
        return; // 컴포넌트가 ✓ 표시
      }
      alert('측정이 저장되었습니다.');
    } catch (e) {
      if (isGait) throw e; // 컴포넌트 saveState='error' 로 표시되게 전파
      alert('저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.\n' + (e?.message || ''));
    }
  };

  // 메뉴 구동 화면
  if (active && active.status === 'ready') {
    const Comp = active.component;
    return (
      <div className="max-w-md mx-auto">
        <Suspense fallback={<div className="text-center text-slate-400 py-10 text-sm">모듈 로딩 중…</div>}>
          <Comp member={member} onSave={handleSave} onBack={() => setActive(null)} />
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
          <option value="">선택 안 함 (측정만)</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.phone?.slice(-4)})</option>)}
        </select>
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
