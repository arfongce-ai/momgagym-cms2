// ai-measure/menus/OneRMEstimate.jsx
// 메뉴 5: 1RM 추정 (벤치프레스/스쿼트/데드리프트). 카메라/AI 불필요.
//  - 입력: 든 무게(kg) + 반복 횟수(reps)
//  - 공식: Epley, Brzycki (스포츠과학 표준 추정식) 평균
//  - reps 가 1이면 그 무게가 곧 1RM
import { useState } from 'react';
import { estimate1RM, LIFTS } from '../core/strength';

export default function OneRMEstimate({ member, onSave, onBack }) {
  const [lift, setLift] = useState('bench');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [result, setResult] = useState(null);

  const calc = () => {
    const w = Number(weight), r = Number(reps);
    if (!w || !r || w <= 0 || r <= 0) { alert('무게와 횟수를 정확히 입력하세요.'); return; }
    if (r > 12) { alert('반복 횟수가 12회를 넘으면 추정 오차가 큽니다. 12회 이하로 입력하세요.'); return; }
    setResult(estimate1RM(w, r));
  };

  const save = () => {
    if (!result) return;
    onSave?.({
      lift,
      liftLabel: LIFTS.find(l => l.key === lift)?.label,
      weight: Number(weight),
      reps: Number(reps),
      oneRM: result.average,
      epley: result.epley,
      brzycki: result.brzycki,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">1RM 추정</h2>
        <span className="w-12" />
      </div>

      {/* 종목 */}
      <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
        {LIFTS.map(l => (
          <button key={l.key} onClick={() => { setLift(l.key); setResult(null); }}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${lift === l.key ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
            {l.label}
          </button>
        ))}
      </div>

      {/* 입력 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">든 무게 (kg)</label>
          <input type="number" step="2.5" value={weight} onChange={e => setWeight(e.target.value)}
            placeholder="80" className="input-mono" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">반복 횟수</label>
          <input type="number" value={reps} onChange={e => setReps(e.target.value)}
            placeholder="5" className="input-mono" />
        </div>
      </div>

      <button onClick={calc} className="btn btn-primary w-full">1RM 계산</button>

      {/* 결과 */}
      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">추정 1RM</p>
          <p className="text-center font-mono font-black text-5xl text-slate-100">
            {result.average}<span className="text-lg text-slate-500"> kg</span>
          </p>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">Epley</p>
              <p className="font-mono font-bold text-slate-200">{result.epley} kg</p>
            </div>
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">Brzycki</p>
              <p className="font-mono font-bold text-slate-200">{result.brzycki} kg</p>
            </div>
          </div>
          {/* %1RM 표 */}
          <div className="bg-slate-800 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 mb-1.5">강도별 훈련 무게</p>
            <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
              {[90, 80, 70, 60].map(pct => (
                <div key={pct}>
                  <p className="text-slate-500">{pct}%</p>
                  <p className="font-mono font-bold text-amber-400">{Math.round(result.average * pct / 100 / 2.5) * 2.5}</p>
                </div>
              ))}
            </div>
          </div>
          {onSave && (
            <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 추정식은 반복 횟수 1~10회에서 가장 정확합니다. 실제 최대 무게는 컨디션·자세에
        따라 달라지므로 참고용으로 사용하세요.
      </p>
    </div>
  );
}
