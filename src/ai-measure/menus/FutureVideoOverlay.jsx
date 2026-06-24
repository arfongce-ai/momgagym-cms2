export default function FutureVideoOverlay({
  mode = 'AI LIVE',
  recording = false,
  intensity = 0.72,
  elapsed = '',
  primary = '',
  secondary = '',
  metrics = [],
  gauges = [],
  ringLabel = '',
}) {
  const clamped = Math.max(0.08, Math.min(1, Number(intensity) || 0.72));
  const bars = (metrics.length ? metrics : [
    { label: 'signal', value: 34 },
    { label: 'pace', value: 58 },
    { label: 'range', value: 82 },
    { label: 'sync', value: 48 },
    { label: 'load', value: 70 },
  ]).slice(0, 5);

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
          <span>{recording ? `REC ${mode}` : mode}</span>
        </div>
        {(elapsed || primary) && (
          <div className="future-readout">
            {elapsed && <strong>{elapsed}</strong>}
            {primary && <span>{primary}</span>}
            {secondary && <em>{secondary}</em>}
          </div>
        )}
        <div className="future-gauge-stack">
          {bars.map((item, i) => {
            const raw = typeof item === 'number' ? item * 100 : Number(item.value);
            const value = Math.max(4, Math.min(100, Number.isFinite(raw) ? raw : 0));
            const label = typeof item === 'number' ? `g${i + 1}` : item.label;
            return (
            <div key={`${label}-${i}`} className="future-bar" title={label}>
              <span style={{ height: `${Math.round(value * clamped)}%` }} />
            </div>
          );})}
        </div>
      </div>

      <div className="future-side future-side-right">
        <div className="future-ring" style={{ '--ring-value': `${Math.round(clamped * 360)}deg` }}>
          <span>{ringLabel || Math.round(clamped * 100)}</span>
        </div>
        {gauges.length > 0 && (
          <div className="future-metric-gauges">
            {gauges.slice(0, 4).map((g, i) => {
              const pct = Math.max(0, Math.min(100, Number(g.percent) || 0));
              return (
                <div key={`${g.label}-${i}`} className={`future-metric-gauge ${g.tone ? `tone-${g.tone}` : ''}`}>
                  <div className="future-metric-gauge-head">
                    <span>{g.label}</span>
                    <strong>{g.value ?? '--'}</strong>
                  </div>
                  <div className="future-metric-track">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="future-micro-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}
