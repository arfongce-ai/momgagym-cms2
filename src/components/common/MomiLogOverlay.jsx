// src/components/common/MomiLogOverlay.jsx
// [2026-11-13] 모미 화면 진단 기록 표시(설정 화면 스위치 또는 ?momilog=1 로 켠 기기에서만 보임).
// 터치를 가로채지 않도록 pointer-events를 끈 작은 상자만 그린다.
import { useEffect, useState } from 'react';
import { getMomiLogEntries, hookMomiConsole, isMomiLogEnabled, subscribeMomiLog } from '../../utils/momiLog';

export default function MomiLogOverlay() {
  const [, setTick] = useState(0);
  // 꺼져 있어도 구독은 해 둔다 — 설정 화면에서 켜는 순간 바로 나타나게.
  useEffect(() => subscribeMomiLog(() => setTick((n) => n + 1)), []);
  const enabled = isMomiLogEnabled();
  useEffect(() => {
    if (enabled) hookMomiConsole();
  }, [enabled]);

  if (!enabled) return null;
  const entries = getMomiLogEntries();
  return (
    <div
      style={{
        position: 'fixed', left: 8, bottom: 8, zIndex: 99999, maxWidth: 'min(92vw, 460px)',
        padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.82)', color: '#e5e7eb',
        font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace', pointerEvents: 'none',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}
    >
      <div style={{ color: '#fbbf24' }}>모미 기록 (끄기: 설정 → 모미 화면 기록)</div>
      {entries.length === 0 && <div>아직 기록 없음</div>}
      {entries.map((e, i) => (
        <div key={`${e.time}-${i}`}>{e.time} {e.text}{e.count > 1 ? ` ×${e.count}` : ''}</div>
      ))}
    </div>
  );
}
