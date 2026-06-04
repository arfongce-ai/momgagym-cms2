// ai-measure/AiMeasureHub.jsx
// AI 측정 허브. 메뉴를 고르면 해당 모듈만 lazy 로드해 구동한다(필요 기능만).
import { useState, Suspense } from 'react';
import { MEASURE_MENUS } from './registry';
import { store, aiStore } from '../demoData';
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
  const handleSave = (data) => {
    if (!member) { alert('먼저 회원을 선택하세요.'); return; }
    try {
      aiStore.addSession(member.id, {
        menu: active.id,
        menuTitle: active.title,
        recordedAt: new Date().toISOString().slice(0, 10),
        recordedAtFull: new Date().toISOString(),
        data,
      });
      alert('측정이 저장되었습니다.');
    } catch (e) {
      alert('저장 중 오류: ' + e.message);
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
          className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500">
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
        측정 항목은 단계적으로 추가됩니다. 현재 <strong className="text-slate-300">자세·체형 측정</strong>이
        이용 가능하며, 작동 검증 후 다음 항목을 순차 적용합니다.
      </p>
    </div>
  );
}
