// [2026-11-17] 제자리 멀리뛰기 '바닥 거리 마크' 보정용 — 영상 위에 드래그 가능한 세로선 2개(0cm / 기준거리).
// 스프린트의 0m/Nm 기준선 조정과 같은 방식. object-contain 으로 그려진 영상의 실제 표시 영역 기준으로 좌표(0~1)를 만든다.
import { useRef } from 'react';

export default function FloorMarkOverlay({ videoRef, x, onChange, knownCm }) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);

  const contentRect = () => {
    const el = boxRef.current; const v = videoRef?.current;
    if (!el || !v?.videoWidth || !v?.videoHeight) return null;
    const r = el.getBoundingClientRect();
    const a = v.videoWidth / v.videoHeight;
    const dw = Math.min(r.width, r.height * a);
    return { left: r.left, ox: (r.width - dw) / 2, dw };
  };
  const move = (e) => {
    const i = dragRef.current; const c = contentRect();
    if (i == null || !c) return;
    const nx = Math.min(1, Math.max(0, (e.clientX - c.left - c.ox) / c.dw));
    onChange((prev) => { const n = [...prev]; n[i] = nx; return n; });
  };
  const up = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  const down = (i) => (e) => {
    e.preventDefault();
    dragRef.current = i;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const c = contentRect();
  return (
    <div ref={boxRef} className="absolute inset-0 pointer-events-none" data-testid="floor-mark-overlay">
      {c && [0, 1].map((i) => (
        <div key={i} onPointerDown={down(i)}
          style={{ position: 'absolute', top: 0, bottom: 0, left: c.ox + x[i] * c.dw - 16, width: 32, touchAction: 'none', cursor: 'ew-resize', display: 'flex', justifyContent: 'center', pointerEvents: 'auto' }}>
          <div style={{ width: 3, height: '100%', background: i === 0 ? '#22d3ee' : '#f97316' }} />
          <span style={{ position: 'absolute', top: '38%', fontSize: 11, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,0.65)', padding: '1px 6px', borderRadius: 8 }}>
            {i === 0 ? '0' : `${knownCm || '?'}cm`}
          </span>
        </div>
      ))}
    </div>
  );
}
