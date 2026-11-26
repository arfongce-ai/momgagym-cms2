// 촬영 위치 선택 칩 + "이 위치에서는 이게 잘 보여요" 설명. 카메라를 켜기 전에 고른다.
import { recommendedViews } from '../core/cameraViewGuide';

export default function CameraViewPicker({ exerciseType, value, onChange }) {
  const { views, why } = recommendedViews(exerciseType);
  const cur = views.find((v) => v.key === value) || views[0];
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2" data-testid="camera-view-picker">
      <p className="text-sm font-bold text-amber-700 dark:text-amber-400">📷 어디서 찍을까요?</p>
      <p className="text-[11px] text-slate-500">{why}</p>
      <div className="flex flex-wrap gap-1.5">
        {views.map((v) => (
          <button key={v.key} type="button" onClick={() => onChange?.(v.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-black ${cur.key === v.key ? 'border-amber-400 bg-amber-400 text-slate-950' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
            {v.icon} {v.label}{v.recommended ? ' (권장)' : ''}
          </button>
        ))}
      </div>
      <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/30 p-3 space-y-1 text-[12px] text-slate-700 dark:text-slate-200">
        <p><b>잘 보이는 것</b> · {cur.sees}</p>
        <p><b>잘 안 보이는 것</b> · {cur.blind}</p>
        <p><b>카메라 위치</b> · {cur.place}</p>
      </div>
    </div>
  );
}
