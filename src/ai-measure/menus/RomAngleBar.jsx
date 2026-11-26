// ROM 라이브 오버레이: 측정각(하늘색)과 기준(정상)각(초록)을 한 막대에서 비교한다.
// 기준값이 없으면(몸통 등) 측정각만 표시한다. 막대는 항상(촬영 시작 전에도) 보인다.
export default function RomAngleBar({ value, refRange, label = '' }) {
  const scaleMax = Math.max(60, Math.ceil(((refRange?.max ?? 0) * 1.15 || 90) / 10) * 10, value != null ? Math.ceil((value + 5) / 10) * 10 : 0);
  const pct = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  const has = value != null && Number.isFinite(value);
  const diff = has && refRange ? Math.round(value - refRange.normal) : null;
  return (
    <div className="mx-auto w-full max-w-sm rounded-xl bg-black/55 px-3 py-2 backdrop-blur pointer-events-none select-none" data-testid="rom-angle-bar">
      <div className="mb-1 flex items-baseline justify-between text-[11px] font-bold">
        <span className="text-sky-300">{label} 측정 {has ? `${Math.round(value)}°` : '—'}</span>
        {refRange
          ? <span className="text-emerald-300">기준 {refRange.normal}° <span className="text-emerald-300/70">({refRange.min}~{refRange.max})</span></span>
          : <span className="text-slate-300">기준값 없음</span>}
      </div>
      <div className="relative h-3 rounded-full bg-white/15">
        {refRange && <div className="absolute top-0 h-3 rounded-full bg-emerald-400/35" style={{ left: pct(refRange.min), width: `calc(${pct(refRange.max)} - ${pct(refRange.min)})` }} />}
        {has && <div className="absolute left-0 top-0 h-3 rounded-full bg-sky-400" style={{ width: pct(value) }} />}
        {refRange && <div className="absolute -top-0.5 h-4 w-0.5 bg-emerald-300" style={{ left: pct(refRange.normal) }} />}
      </div>
      {diff != null && <p className="mt-1 text-center text-[10px] font-bold text-slate-200">기준 대비 {diff > 0 ? `+${diff}` : diff}°</p>}
    </div>
  );
}
