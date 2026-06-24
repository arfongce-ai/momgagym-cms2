export default function FutureVideoOverlay({
  mode = 'AI LIVE',
  recording = false,
  intensity = 0.72,
}) {
  const bars = [0.34, 0.58, 0.82, 0.48, 0.7];
  const clamped = Math.max(0.08, Math.min(1, Number(intensity) || 0.72));

  return (
    <div className="future-video-overlay" aria-hidden="true">
      <div className="future-corner future-corner-tl" />
      <div className="future-corner future-corner-tr" />
      <div className="future-corner future-corner-bl" />
      <div className="future-corner future-corner-br" />

      <div className="future-scanline" />
      <div className="future-reticle" />

      <div className="future-side future-side-left">
        <div className="future-chip">
          <span className={recording ? 'future-dot is-recording' : 'future-dot'} />
          <span>{recording ? 'REC' : mode}</span>
        </div>
        <div className="future-gauge-stack">
          {bars.map((v, i) => (
            <div key={i} className="future-bar">
              <span style={{ height: `${Math.round(v * clamped * 100)}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="future-side future-side-right">
        <div className="future-ring" style={{ '--ring-value': `${Math.round(clamped * 360)}deg` }}>
          <span>{Math.round(clamped * 100)}</span>
        </div>
        <div className="future-micro-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}
