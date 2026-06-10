// ai-measure/menus/VbtMeasure.jsx
// 메뉴 7: VBT (속도 기반 트레이닝). 카메라 불필요 — 거리/시간 입력 기반.
import { useState } from 'react';
import { calcVBT, VBT_ZONES } from '../core/performance';

const ZONE_COLOR = {
  blue:   'text-blue-400',
  green:  'text-emerald-400',
  yellow: 'text-amber-400',
  orange: 'text-orange-400',
  red:    'text-red-400',
};

export default function VbtMeasure({ member, onSave, onBack }) {
  const [distance, setDistance] = useState('');
  const [time, setTime] = useState('');
  const [result, setResult] = useState(null);

  const calc = () => {
    const r = calcVBT(distance, time);
    if (!r) { alert('이동 거리(m)와 시간(초)을 정확히 입력하세요.'); return; }
    setResult(r);
  };

  const save = () => {
    if (!result) return;
    onSave?.({
      distance: Number(distance),
      time: Number(time),
      meanVelocity: result.meanVelocity,
      zone: result.zone?.label,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">VBT · 속도기반</h2>
        <span className="w-12" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">바벨 이동 거리 (m)</label>
          <input type="number" step="0.01" value={distance} onChange={e => setDistance(e.target.value)}
            placeholder="0.60" className="input-mono" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">추진 시간 (초)</label>
          <input type="number" step="0.01" value={time} onChange={e => setTime(e.target.value)}
            placeholder="0.50" className="input-mono" />
        </div>
      </div>

      <button onClick={calc} className="btn btn-primary w-full">속도 계산</button>

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">평균 속도</p>
            {result.zone && <p className={`text-sm font-bold ${ZONE_COLOR[result.zone.color]}`}>{result.zone.label}</p>}
          </div>
          <p className="text-center font-mono font-black text-5xl text-slate-100">{result.meanVelocity}<span className="text-lg text-slate-500"> m/s</span></p>

          {/* 속도 존 표 */}
          <div className="bg-slate-800 rounded-xl p-3 space-y-1">
            <p className="text-[10px] text-slate-500 mb-1">속도 구간별 훈련 목적</p>
            {VBT_ZONES.map((z, i) => {
              const active = result.zone && z.label === result.zone.label;
              return (
                <div key={i} className={`flex justify-between text-[11px] px-2 py-1 rounded ${active ? 'bg-slate-700' : ''}`}>
                  <span className={active ? ZONE_COLOR[z.color] + ' font-bold' : 'text-slate-500'}>
                    {z.min}{z.max === Infinity ? '+' : `~${z.max}`} m/s
                  </span>
                  <span className={active ? 'text-slate-100 font-bold' : 'text-slate-500'}>{z.label}</span>
                </div>
              );
            })}
          </div>
          {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 거리·시간은 선형 엔코더나 영상 분석으로 측정합니다. 평균속도 기반 추정이며,
        최고속도(peak)는 별도 센서가 필요합니다. 카메라 자동측정은 추후 추가됩니다.
      </p>
    </div>
  );
}
