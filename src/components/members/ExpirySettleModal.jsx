// 만료 정산 선택 창 — 만료 등록분마다 '트레이너 정산' / '센터 귀속'을 고른 뒤 처리한다.
//  · 기본값은 선택 없음(실수 방지). 고르지 않은 건은 그대로 남는다.
//  · targets: [{ key, member, lot, est:{sessions,unit,rate,amount}, trainerName }]
import { useState } from 'react';

const won = (n) => `${Number(n || 0).toLocaleString()}원`;

export default function ExpirySettleModal({ targets, onConfirm, onClose }) {
  const [choice, setChoice] = useState({});
  const [saving, setSaving] = useState(false);
  const picked = targets.filter(t => choice[t.key]).map(t => ({ ...t, disposition: choice[t.key] }));
  const trainerSum = picked.filter(t => t.disposition === 'trainer').reduce((a, t) => a + t.est.amount, 0);
  const centerSum = picked.filter(t => t.disposition === 'center').reduce((a, t) => a + t.est.unit * t.est.sessions, 0);
  const canTrainer = (t) => t.est.amount > 0;
  const chooseAll = (d) => setChoice(Object.fromEntries(
    targets.filter(t => d === 'center' || canTrainer(t)).map(t => [t.key, d])
  ));
  const toggle = (key, d) => setChoice(c => ({ ...c, [key]: c[key] === d ? undefined : d }));

  const submit = async () => {
    if (!picked.length || saving) return;
    setSaving(true);
    await onConfirm(picked);
  };

  const btn = (on, color) => `flex-1 rounded-lg border px-2 py-2 text-xs font-bold disabled:opacity-40 ${on ? color : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`;
  const onTrainer = 'bg-emerald-600 border-emerald-600 text-white';
  const onCenter = 'bg-amber-500 border-amber-500 text-slate-950';

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div role="dialog" aria-label="만료 정산" className="w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">만료 정산 ({targets.length}건)</h3>
          <p className="text-xs text-slate-500 mt-1">처리하면 남은 횟수가 정리됩니다. 화면에서 되돌릴 수 없습니다.</p>
          {targets.length > 1 && (
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => chooseAll('trainer')} className={btn(false)}>전체 트레이너 정산</button>
              <button type="button" onClick={() => chooseAll('center')} className={btn(false)}>전체 센터 귀속</button>
            </div>
          )}
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {targets.map(t => (
            <div key={t.key} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{t.member.name} · {t.trainerName}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                만료일 {t.lot.expiresAt || '-'} · 남은 {t.est.sessions}회 × {won(t.est.unit)}
              </p>
              <div className="flex gap-2 mt-2">
                <button type="button" disabled={!canTrainer(t)} aria-pressed={choice[t.key] === 'trainer'}
                  onClick={() => toggle(t.key, 'trainer')} className={btn(choice[t.key] === 'trainer', onTrainer)}>
                  트레이너 정산<br />{won(t.est.amount)} ({t.est.rate}%)
                </button>
                <button type="button" aria-pressed={choice[t.key] === 'center'}
                  onClick={() => toggle(t.key, 'center')} className={btn(choice[t.key] === 'center', onCenter)}>
                  센터 귀속<br />트레이너 0원
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-600 dark:text-slate-300 mb-3">
            선택 {picked.length}건 · 트레이너 지급 {won(trainerSum)} · 센터 귀속 {won(centerSum)}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className={btn(false)}>취소</button>
            <button type="button" onClick={submit} disabled={!picked.length || saving}
              className="flex-1 rounded-lg bg-red-600 text-white text-sm font-bold py-2 disabled:opacity-40">
              {saving ? '처리 중...' : `${picked.length}건 처리`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
