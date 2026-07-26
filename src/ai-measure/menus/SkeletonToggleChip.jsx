// ai-measure/menus/SkeletonToggleChip.jsx
// 카메라 화면 공통 '스켈레톤 ON/OFF' 토글 칩.
//  - 자세/ROM(CameraStage), 보행, 점프 등 스켈레톤을 그리는 화면 상단에 배치.
//  - 전역 설정(skeletonPref)이라 한 곳에서 끄면 모든 측정 화면에 적용되고
//    localStorage 에 저장돼 다음 방문에도 유지된다.
import { useSkeletonOverlay } from '../core/skeletonPref';

export default function SkeletonToggleChip({ className = '' }) {
  const [on, setOn] = useSkeletonOverlay();
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOn(!on); }}
      aria-pressed={on}
      title="스켈레톤 오버레이 켜기/끄기"
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold backdrop-blur transition active:scale-95
        ${on
          ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-200'
          : 'bg-black/55 border-white/25 text-slate-300'} ${className}`}
    >
      🦴 스켈레톤 {on ? 'ON' : 'OFF'}
    </button>
  );
}
