// ai-measure/menus/RsiMeasure.jsx
// 메뉴 4: RSI (반응강도지수). 카메라 불필요 — 체공/접지 시간 입력 기반.
import { useState } from 'react';
import { calcRSI } from '../core/performance';

export default function RsiMeasure({ member, onSave, onBack }) {
  const [flight, setFlight] = useState('');
  const [contact, setContact] = useState('');
  const [result, setResult] = useState(null);

  const calc = () => {
    const r = calcRSI(flight, contact);
    if (!r) { alert('체공 시간과 접지 시간을 정확히 입력하세요(초 단위).'); return; }
    if (r.error) { alert(r.message); setResult(null); return; }
    setResult(r);
  };

  const save = () => {
    if (!result) return;
    onSave?.({
      flightTime: Number(flight),
      contactTime: Number(contact),
      rsi: result.rsi,
      heightCm: result.heightCm,
      takeoffVelocity: result.takeoffVelocity,
    });
  };

  // RSI 등급 (체공/접지 비율, 무단위 — 드롭점프 일반 기준)
  const grade = result
    ? result.rsi >= 2.5 ? { label: '매우 우수', color: 'text-blue-400' }
    : result.rsi >= 2.0 ? { label: '우수', color: 'text-emerald-400' }
    : result.rsi >= 1.5 ? { label: '보통', color: 'text-amber-400' }
    : { label: '개선 필요', color: 'text-red-400' }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">RSI · 반응강도지수</h2>
        <span className="w-12" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">체공 시간 (초)</label>
          <input type="number" step="0.01" value={flight} onChange={e => setFlight(e.target.value)}
            placeholder="0.50" className="input-mono" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">접지 시간 (초)</label>
          <input type="number" step="0.01" value={contact} onChange={e => setContact(e.target.value)}
            placeholder="0.20" className="input-mono" />
        </div>
      </div>

      <button onClick={calc} className="btn btn-primary w-full">RSI 계산</button>

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">RSI</p>
            <p className={`text-sm font-bold ${grade.color}`}>{grade.label}</p>
          </div>
          <p className="text-center font-mono font-black text-5xl text-slate-100">{result.rsi}<span className="text-lg text-slate-500"> (체공/접지)</span></p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">점프 높이</p>
              <p className="font-mono font-bold text-slate-200">{result.heightCm} cm</p>
            </div>
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">RSI(높이)</p>
              <p className="font-mono font-bold text-slate-200">{result.rsiHeight} m/s</p>
            </div>
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">이륙 속도</p>
              <p className="font-mono font-bold text-slate-200">{result.takeoffVelocity} m/s</p>
            </div>
          </div>
          {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ RSI = 체공시간 ÷ 접지시간(무단위). 체공/접지 시간은 점프매트·고속카메라로
        측정합니다. 점프 높이는 체공시간 기반 추정값입니다(h = g·t²/8). 카메라 자동
        측정은 점프 탭의 ‘반응 탄성 점프’ 모드에서 지원합니다.
      </p>
    </div>
  );
}
