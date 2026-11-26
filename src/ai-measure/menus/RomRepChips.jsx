// 횟수별 각도 칩. 최고값(황금색)·최저값(분홍색) 강조, 평균 표시. 2회 이상이고 값이 다를 때만 강조한다.
import { repSummary } from '../core/romMovementGuide';

export default function RomRepChips({ peaks, title = '횟수별 각도', dark = true }) {
  const s = repSummary(peaks);
  if (!s) return null;
  const base = dark ? 'bg-black/55 text-white' : 'bg-slate-100 text-slate-800';
  return (
    <div className="space-y-1" data-testid="rom-rep-chips">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {s.peaks.map((p, i) => {
          const tone = s.hasRange && i === s.maxIdx ? 'bg-yellow-300 text-slate-950' : s.hasRange && i === s.minIdx ? 'bg-rose-300 text-slate-950' : base;
          return (
            <div key={i} className={`min-w-[52px] rounded-lg px-2 py-1 text-center ${tone}`} data-tone={s.hasRange && i === s.maxIdx ? 'max' : s.hasRange && i === s.minIdx ? 'min' : ''}>
              <p className="text-[9px] font-bold opacity-70">{i + 1}회</p>
              <p className="font-mono text-sm font-black leading-none">{Math.round(p)}°</p>
            </div>
          );
        })}
      </div>
      <p className={`text-center text-[10px] font-bold ${dark ? 'text-slate-200' : 'text-slate-600'}`}>
        {title} · 평균 {s.avg}°{s.hasRange ? ` · 최고 ${s.max}° / 최저 ${s.min}°` : ''}
      </p>
    </div>
  );
}
