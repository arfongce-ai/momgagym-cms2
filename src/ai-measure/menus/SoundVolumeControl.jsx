// ai-measure/menus/SoundVolumeControl.jsx
// ════════════════════════════════════════════════════════════════════════
//  측정 사운드 볼륨 조절 — 카운트다운·렙·메트로놈·인터벌·타이머 공통.
//  전역(localStorage) 설정이라 한 곳에서 바꾸면 모든 측정 화면에 적용된다.
//  스피커 버튼: 탭하면 음소거 토글 + 미리듣기 톤으로 현재 크기를 확인.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useRef } from 'react';
import { getSoundVolume, setSoundVolume, subscribeSoundVolume, beepConfirm } from '../core/audioCue';

export default function SoundVolumeControl({ compact = false }) {
  const [vol, setVol] = useState(getSoundVolume);
  const lastNonZeroRef = useRef(vol > 0 ? vol : 1);

  useEffect(() => subscribeSoundVolume(setVol), []);

  const apply = (v, preview = false) => {
    if (v > 0) lastNonZeroRef.current = v;
    setSoundVolume(v);
    if (preview && v > 0) beepConfirm(); // 현재 크기 미리듣기
  };

  const toggleMute = () => {
    apply(vol > 0 ? 0 : lastNonZeroRef.current, true);
  };

  const icon = vol === 0 ? '🔇' : vol < 0.45 ? '🔉' : '🔊';

  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'rounded-xl bg-slate-100/80 dark:bg-slate-800/80 border border-white/10 px-3 py-2'}`}>
      <button onClick={toggleMute} className="text-lg leading-none active:scale-90" aria-label="음소거">
        {icon}
      </button>
      <input
        type="range" min="0" max="100" step="5"
        value={Math.round(vol * 100)}
        onChange={(e) => apply(Number(e.target.value) / 100)}
        onPointerUp={() => { if (vol > 0) beepConfirm(); }}
        className="flex-1 h-1.5 accent-amber-500 min-w-[72px]"
        aria-label="사운드 볼륨"
      />
      <span className="font-mono text-[10px] font-bold text-slate-600 dark:text-slate-300 w-8 text-right">{Math.round(vol * 100)}%</span>
    </div>
  );
}
