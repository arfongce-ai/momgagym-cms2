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

function hexToRgba(hex, alpha = 1) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return `rgba(34,211,238,${alpha})`;
  const [r, g, b] = m.slice(1).map(v => parseInt(v, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawCornerFrame(ctx, width, height, scale, accent) {
  const pad = 18 * scale;
  const len = Math.min(width, height) * 0.105;
  const corners = [
    [pad, pad, 1, 1],
    [width - pad, pad, -1, 1],
    [pad, height - pad, 1, -1],
    [width - pad, height - pad, -1, -1],
  ];

  ctx.save();
  ctx.strokeStyle = hexToRgba(accent, 0.86);
  ctx.lineWidth = Math.max(2, 2.4 * scale);
  ctx.shadowColor = hexToRgba(accent, 0.46);
  ctx.shadowBlur = 14 * scale;
  corners.forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * len, y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawVerticalBars(ctx, x, y, scale, accent, values = [0.42, 0.72, 0.55, 0.88]) {
  const barW = 7 * scale;
  const barH = 54 * scale;
  const gap = 5 * scale;

  ctx.save();
  values.forEach((v, i) => {
    const bx = x + i * (barW + gap);
    roundRect(ctx, bx, y, barW, barH, barW / 2);
    ctx.fillStyle = 'rgba(15,23,42,0.58)';
    ctx.fill();

    const fillH = Math.max(4 * scale, barH * Math.max(0.08, Math.min(1, v)));
    roundRect(ctx, bx, y + barH - fillH, barW, fillH, barW / 2);
    ctx.fillStyle = i % 2 ? hexToRgba(accent, 0.9) : 'rgba(34,211,238,0.9)';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8 * scale;
    ctx.fill();
  });
  ctx.restore();
}

export function drawFutureHud(ctx, width, height, opts = {}) {
  const {
    title = 'AI LIVE',
    elapsedMs = null,
    metrics = [],
    accent = '#22d3ee',
    recording = false,
  } = opts;
  const scale = Math.max(0.72, Math.min(1.45, width / 720));
  const pad = 16 * scale;
  const items = (metrics || []).filter(m => m && m.value != null && m.value !== '').slice(0, 4);

  ctx.save();
  ctx.textBaseline = 'middle';

  drawCornerFrame(ctx, width, height, scale, accent);

  if (typeof ctx.createLinearGradient === 'function') {
    const scan = ctx.createLinearGradient(width * 0.12, height * 0.5, width * 0.88, height * 0.5);
    scan.addColorStop(0, 'rgba(34,211,238,0)');
    scan.addColorStop(0.5, 'rgba(34,211,238,0.44)');
    scan.addColorStop(1, 'rgba(245,158,11,0)');
    ctx.strokeStyle = scan;
  } else {
    ctx.strokeStyle = 'rgba(34,211,238,0.44)';
  }
  ctx.lineWidth = Math.max(1, 1.1 * scale);
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height * 0.5);
  ctx.lineTo(width * 0.88, height * 0.5);
  ctx.stroke();

  const chipW = 128 * scale;
  const chipH = 32 * scale;
  roundRect(ctx, pad, pad, chipW, chipH, chipH / 2);
  ctx.fillStyle = 'rgba(2,6,23,0.58)';
  ctx.fill();
  ctx.strokeStyle = hexToRgba(accent, 0.28);
  ctx.stroke();
  ctx.fillStyle = recording ? '#ef4444' : accent;
  ctx.beginPath();
  ctx.arc(pad + 17 * scale, pad + chipH / 2, 4.8 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ecfeff';
  ctx.font = `900 ${11 * scale}px system-ui, sans-serif`;
  ctx.fillText(String(title || (recording ? 'REC ACTIVE' : 'AI LIVE')).toUpperCase(), pad + 30 * scale, pad + chipH / 2);

  if (elapsedMs != null) {
    const time = formatRecordTime(Math.floor(elapsedMs / 1000));
    const timeW = 96 * scale;
    roundRect(ctx, width - pad - timeW, pad, timeW, chipH, chipH / 2);
    ctx.fillStyle = 'rgba(2,6,23,0.58)';
    ctx.fill();
    ctx.fillStyle = '#fff7ed';
    ctx.font = `800 ${13 * scale}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(time, width - pad - timeW / 2, pad + chipH / 2);
    ctx.textAlign = 'left';
  }

  drawVerticalBars(ctx, pad, height * 0.26, scale, accent);

  const ringR = 28 * scale;
  const ringX = width - pad - ringR;
  const ringY = height * 0.28;
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 6 * scale;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR, -Math.PI / 2, Math.PI * 1.32);
  ctx.strokeStyle = hexToRgba(accent, 0.9);
  ctx.stroke();
  ctx.fillStyle = '#e0f2fe';
  ctx.font = `900 ${12 * scale}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('82', ringX, ringY);
  ctx.textAlign = 'left';

  if (items.length) {
    const panelW = Math.min(width * 0.38, 232 * scale);
    const rowH = 30 * scale;
    const panelH = items.length * rowH + 20 * scale;
    const panelX = pad;
    const panelY = height - pad - panelH;
    roundRect(ctx, panelX, panelY, panelW, panelH, 16 * scale);
    ctx.fillStyle = 'rgba(2,6,23,0.46)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();

    items.forEach((m, i) => {
      const y = panelY + 15 * scale + i * rowH;
      ctx.fillStyle = 'rgba(203,213,225,0.66)';
      ctx.font = `800 ${9 * scale}px system-ui, sans-serif`;
      ctx.fillText(String(m.label || '').toUpperCase(), panelX + 12 * scale, y + 3 * scale);
      ctx.fillStyle = '#f8fafc';
      ctx.font = `900 ${16 * scale}px ui-monospace, Menlo, monospace`;
      ctx.fillText(String(m.value), panelX + 92 * scale, y + 3 * scale);
    });
  }

  ctx.restore();
}

export function drawRecordingHud(ctx, width, height, state = {}) {
  drawFutureHud(ctx, width, height, {
    title: state.toolTab === 'metronome' ? 'METRO' : 'TIMER',
    elapsedMs: (state.recordingElapsed || 0) * 1000,
    recording: true,
    accent: '#f59e0b',
    metrics: [
      { label: 'mode', value: state.toolTab === 'metronome' ? 'BPM' : 'TIME' },
      {
        label: 'value',
        value: state.toolTab === 'metronome'
          ? `${state.metronomeBpm || 100}`
          : formatStopwatch(state.stopwatchElapsed || 0),
      },
    ],
  });
}

export function drawMeasurementOverlay(ctx, width, height, opts = {}) {
  const { title = '', elapsedMs = null, metrics = [], accent = '#fbbf24' } = opts;
  if (!title && !metrics?.length && elapsedMs == null) return;
  drawFutureHud(ctx, width, height, {
    title,
    elapsedMs,
    metrics,
    accent,
    recording: elapsedMs != null,
  });
}
