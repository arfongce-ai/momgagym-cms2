// ai-measure/menus/JumpMeasure.jsx
// 메뉴 3: 점프 (반동점프). 카메라 불필요 — 체공시간 입력 기반.
import { useState } from 'react';
import { calcJump } from '../core/performance';

export default function JumpMeasure({ member, onSave, onBack }) {
  const [flight, setFlight] = useState('');
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState(null);

  const calc = () => {
    const r = calcJump(flight, weight);
    if (!r) { alert('체공 시간을 정확히 입력하세요(초 단위).'); return; }
    setResult(r);
  };

  const save = () => {
    if (!result) return;
    onSave?.({
      flightTime: Number(flight),
      bodyWeight: weight ? Number(weight) : null,
      heightCm: result.heightCm,
      takeoffVelocity: result.takeoffVelocity,
      peakPower: result.peakPower,
    });
  };

  // 점프 높이 등급 (성인 일반 기준, cm)
  const grade = result
    ? result.heightCm >= 50 ? { label: '매우 우수', color: 'text-blue-400' }
    : result.heightCm >= 40 ? { label: '우수', color: 'text-emerald-400' }
    : result.heightCm >= 30 ? { label: '보통', color: 'text-amber-400' }
    : { label: '개선 필요', color: 'text-red-400' }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">점프 · 반동점프</h2>
        <span className="w-12" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">체공 시간 (초)</label>
          <input type="number" step="0.01" value={flight} onChange={e => setFlight(e.target.value)}
            placeholder="0.50" className="input-mono" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
            체중 (kg) <span className="text-slate-600 normal-case">— 파워 계산 시</span>
          </label>
          <input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)}
            placeholder="70" className="input-mono" />
        </div>
      </div>

      <button onClick={calc} className="btn btn-primary w-full">점프 분석</button>

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">점프 높이</p>
            <p className={`text-sm font-bold ${grade.color}`}>{grade.label}</p>
          </div>
          <p className="text-center font-mono font-black text-5xl text-slate-100">{result.heightCm}<span className="text-lg text-slate-500"> cm</span></p>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">이륙 속도</p>
              <p className="font-mono font-bold text-slate-200">{result.takeoffVelocity} m/s</p>
            </div>
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">최고 파워</p>
              <p className="font-mono font-bold text-slate-200">{result.peakPower != null ? result.peakPower + ' W' : '체중 입력'}</p>
            </div>
          </div>
          {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 높이는 체공시간 기반 추정(h = g·t²/8), 최고파워는 Sayers 공식 추정값입니다.
        체공시간은 점프매트로 측정하며, 카메라 자동측정은 추후 추가됩니다.
      </p>
    </div>
  );
}
