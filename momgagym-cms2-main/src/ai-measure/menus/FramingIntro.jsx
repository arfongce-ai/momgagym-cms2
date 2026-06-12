// ai-measure/menus/FramingIntro.jsx
// 측정 전 촬영 위치·거리 안내 카드 — 카메라 켜기 전에 보여준다.
// preset: FRAMING_PRESETS의 한 항목({ title, tips:[] })

export default function FramingIntro({ preset, onStart, startLabel = '카메라 시작' }) {
  if (!preset) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">📐</span>
        <p className="text-sm font-bold text-amber-400">{preset.title}</p>
      </div>
      <ul className="space-y-2">
        {preset.tips.map((t, i) => (
          <li key={i} className="flex gap-2 text-[12px] text-slate-300 leading-relaxed">
            <span className="text-emerald-400 font-bold shrink-0">{i + 1}.</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-500">
        카메라를 켜면 화면 위에 <span className="text-emerald-400 font-bold">초록(좋음)</span> /
        <span className="text-amber-400 font-bold"> 노랑(조정)</span> 표시로 위치가 맞는지 실시간으로 알려줍니다.
      </p>
      <button onClick={onStart} className="btn btn-primary w-full">{startLabel}</button>
    </div>
  );
}
