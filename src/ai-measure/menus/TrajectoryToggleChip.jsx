// ai-measure/menus/TrajectoryToggleChip.jsx
// 카메라 화면 '손·발 궤적 ON/OFF' 토글 칩 — SkeletonToggleChip과 같은
// 자리에 나란히 배치한다. 스켈레톤 토글과는 완전히 독립된 전역 설정이라
// (trajectoryPref), 스켈레톤이 꺼져 있어도 궤적만 켤 수 있다.
import { useTrajectoryOverlay } from '../core/trajectoryPref';

export default function TrajectoryToggleChip({ className = '' }) {
  const [on, setOn] = useTrajectoryOverlay();
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOn(!on); }}
      aria-pressed={on}
      title="손·발 궤적 켜기/끄기"
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold backdrop-blur transition active:scale-95
        ${on
          ? 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200'
          : 'bg-black/55 border-white/25 text-slate-600 dark:text-slate-300'} ${className}`}
    >
      〜 궤적 {on ? 'ON' : 'OFF'}
    </button>
  );
}
