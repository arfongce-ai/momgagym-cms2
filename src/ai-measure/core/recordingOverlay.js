export function formatStopwatch(ms = 0) {
  const safe = Math.max(0, Number(ms) || 0);
  const cs = Math.floor((safe % 1000) / 10);
  const sec = Math.floor(safe / 1000) % 60;
  const min = Math.floor(safe / 60000);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function formatRecordTime(sec = 0) {
  const safe = Math.max(0, Math.floor(Number(sec) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function drawRecordingHud(ctx, width, height, state = {}) {
  const scale = Math.max(0.75, Math.min(1.35, width / 540));
  const pad = Math.round(16 * scale);
  const topH = Math.round(38 * scale);
  const topW = Math.round(132 * scale);

  ctx.save();
  ctx.textBaseline = 'middle';

  roundRect(ctx, pad, pad, topW, topH, topH / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.50)';
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(pad + 19 * scale, pad + topH / 2, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${14 * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(formatRecordTime(state.recordingElapsed || 0), pad + 34 * scale, pad + topH / 2);

  const panelW = width - pad * 2;
  const panelH = Math.round(74 * scale);
  const panelX = pad;
  const panelY = height - pad - panelH;
  roundRect(ctx, panelX, panelY, panelW, panelH, 18 * scale);
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(1, 1.2 * scale);
  ctx.stroke();

  const isMetro = state.toolTab === 'metronome';
  ctx.fillStyle = 'rgba(245,158,11,0.88)';
  roundRect(ctx, panelX + 12 * scale, panelY + 14 * scale, 78 * scale, 28 * scale, 14 * scale);
  ctx.fill();
  ctx.fillStyle = '#111827';
  ctx.font = `900 ${13 * scale}px system-ui, sans-serif`;
  ctx.fillText(isMetro ? 'METRO' : 'TIME', panelX + 27 * scale, panelY + 28 * scale);

  ctx.fillStyle = '#fbbf24';
  ctx.font = `900 ${isMetro ? 29 * scale : 30 * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const main = isMetro
    ? `${state.metronomeBpm || 100} BPM`
    : formatStopwatch(state.stopwatchElapsed || 0);
  ctx.fillText(main, panelX + 108 * scale, panelY + 30 * scale);

  ctx.fillStyle = 'rgba(255,255,255,0.74)';
  ctx.font = `700 ${11 * scale}px system-ui, sans-serif`;
  const sub = isMetro
    ? (state.metronomePlaying ? 'metronome playing' : 'metronome ready')
    : (state.stopwatchRunning ? 'stopwatch running' : 'stopwatch ready');
  ctx.fillText(sub, panelX + 110 * scale, panelY + 56 * scale);

  ctx.restore();
}
