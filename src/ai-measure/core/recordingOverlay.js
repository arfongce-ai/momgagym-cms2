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

// ════════════════════════════════════════════════════════════════════════
//  [공통] 측정값 텍스트 오버레이 — 모든 카메라 측정에서 재사용.
//  스켈레톤은 그리지 않고, 실시간 측정값만 영상에 합성한다(요구사항 13).
//  보행·점프·자세·ROM·RSI·VBT·역도·스윙 등 향후 측정도 metrics 배열만
//  넘기면 동일한 룩으로 합성된다.
//
//  drawMeasurementOverlay(ctx, w, h, {
//    title: 'GAIT LIVE',
//    elapsedMs: 1234,
//    metrics: [{ label:'SPM', value:168 }, { label:'STANCE', value:'62%' }, ...],
//    accent: '#fbbf24'
//  })
// ════════════════════════════════════════════════════════════════════════
export function drawMeasurementOverlay(ctx, width, height, opts = {}) {
  const { title = '', elapsedMs = null, metrics = [], accent = '#fbbf24' } = opts;
  const items = metrics.filter(m => m && m.value != null && m.value !== '');
  if (!title && !items.length && elapsedMs == null) return;

  const scale = Math.max(0.75, Math.min(1.4, width / 540));
  const pad = Math.round(16 * scale);

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ── 상단: 녹화시간(있으면) ──
  if (elapsedMs != null) {
    const topH = Math.round(34 * scale), topW = Math.round(120 * scale);
    roundRect(ctx, pad, pad, topW, topH, topH / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.50)'; ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(pad + 18 * scale, pad + topH / 2, 5 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${13 * scale}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(formatRecordTime(Math.floor(elapsedMs / 1000)), pad + 32 * scale, pad + topH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // ── 하단: 측정값 패널 ──
  if (title || items.length) {
    const titleH = title ? Math.round(22 * scale) : 0;
    const rowH = Math.round(34 * scale);
    const cols = items.length <= 2 ? items.length || 1 : items.length <= 4 ? 2 : 3;
    const rows = Math.ceil(items.length / cols);
    const panelW = width - pad * 2;
    const panelH = titleH + rows * rowH + Math.round(20 * scale);
    const panelX = pad;
    const panelY = height - pad - panelH;

    roundRect(ctx, panelX, panelY, panelW, panelH, 18 * scale);
    ctx.fillStyle = 'rgba(15,23,42,0.72)'; ctx.fill();
    ctx.strokeStyle = accent.replace(')', ',0.6)').replace('rgb', 'rgba'); // best-effort
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = Math.max(1, 1.2 * scale); ctx.stroke();

    let cy = panelY + Math.round(14 * scale);
    if (title) {
      ctx.fillStyle = accent;
      ctx.font = `800 ${Math.round(13 * scale)}px system-ui, sans-serif`;
      ctx.fillText(title, panelX + Math.round(16 * scale), cy + Math.round(11 * scale));
      cy += titleH;
    }
    const cellW = (panelW - Math.round(24 * scale)) / cols;
    items.forEach((m, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = panelX + Math.round(16 * scale) + col * cellW;
      const yy = cy + row * rowH;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `700 ${Math.round(10 * scale)}px system-ui, sans-serif`;
      ctx.fillText(String(m.label || ''), cx, yy + Math.round(11 * scale));
      ctx.fillStyle = '#f8fafc';
      ctx.font = `900 ${Math.round(20 * scale)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(String(m.value), cx, yy + Math.round(30 * scale));
    });
  }
  ctx.restore();
}
