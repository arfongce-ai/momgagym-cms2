// 양도 불일치 점검(관리자) — 옛 양도로 결제의 등록횟수(sessionAdds)가 남아 '유령 잔여'를 만들 수 있는 회원을 찾는다.
// 화면 표시는 이미 보정돼 있고, 여기서는 (1) 어디에 있는지 보고 (2) 양도받은 쪽이 분명한 건만 정리한다.
import { useMemo, useState } from 'react';
import { store } from '../../demoData';
import { findSessionAddsMismatches } from '../../services/sessionExpiry';

export default function SessionAddsAudit({ trainers = [], onOpenMember, onClose, onChanged }) {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(null);
  const nameOf = (tid) => trainers.find(t => t.id === tid)?.name || '?(퇴사/삭제)';
  const rows = useMemo(
    () => findSessionAddsMismatches({ members: store.getMembers(), getPayments: (id) => store.getPayments(id) }),
    [tick],
  );

  const repair = async (r) => {
    const to = r.receivers[0];
    if (!window.confirm(
      `${r.memberName} — ${nameOf(r.trainerId)}의 등록횟수 ${r.excess}회를 ${nameOf(to.trainerId)}에게 옮겨 정리합니다.\n` +
      `(결제 금액·세션 잔여는 바꾸지 않고, 결제의 등록횟수 기록만 맞춥니다.)\n진행할까요?`)) return;
    setBusy(r.memberId + r.trainerId);
    try {
      const res = await store.repairSessionAdds(r.memberId, { fromTid: r.trainerId, toTid: to.trainerId, n: r.excess });
      if (!res) alert('정리할 수 없었습니다(옮길 등록횟수가 부족). 회원 상세에서 직접 확인해 주세요.');
      setTick(t => t + 1); onChanged?.();
    } catch (e) { alert('정리에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); }
    setBusy(null);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-amber-500/30 rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-black text-amber-700 dark:text-amber-400">양도 불일치 점검 · {rows.length}건</div>
        <button onClick={onClose} className="text-xs text-slate-500">닫기</button>
      </div>
      <p className="text-[11px] text-slate-500">결제의 등록횟수 합이 세션 카드 총횟수보다 큰 경우입니다. 화면 잔여는 이미 보정되어 있고, 정산 계산을 맞추려면 정리가 필요합니다. 받은 쪽이 한 명으로 분명한 건만 버튼이 나옵니다.</p>
      {rows.length === 0 && <p className="text-xs text-emerald-700 dark:text-emerald-400">불일치가 없습니다.</p>}
      {rows.map(r => (
        <div key={r.memberId + r.trainerId} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <button onClick={() => onOpenMember?.(r.memberId)} className="text-sm font-bold text-slate-800 dark:text-slate-100 underline-offset-2 hover:underline">{r.memberName || r.memberId}</button>
            <p className="text-[11px] text-slate-500">
              {nameOf(r.trainerId)} 등록 {r.addsSum}회 / 카드 {r.total}회 → 초과 {r.excess}회 ·{' '}
              {r.receivers.length === 0 ? '받은 쪽 없음(환불·수기 수정 등 — 직접 확인)'
                : r.receivers.length > 1 ? `받은 쪽 후보 ${r.receivers.map(x => nameOf(x.trainerId)).join('·')} — 직접 확인`
                : `받은 쪽 추정: ${nameOf(r.receivers[0].trainerId)}`}
            </p>
          </div>
          {r.repairable && (
            <button disabled={busy === r.memberId + r.trainerId} onClick={() => repair(r)}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 disabled:opacity-50 flex-shrink-0">정리</button>
          )}
        </div>
      ))}
    </div>
  );
}
