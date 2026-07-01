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
export function drawMeasurementOverlay(ctx, width, height, opts = {}) {
  const { title = '', elapsedMs = null, metrics = [], accent = '#fbbf24' } = opts;
  const items = (metrics || []).filter(m => m && m.value != null && m.value !== '');
  if (!title && !items.length && elapsedMs == null) return;

  // 데이터-only HUD: 좌상단 제목칩 + 경과시간, 좌하단 측정값 패널. 장식 없음.
  const scale = Math.max(0.72, Math.min(1.45, width / 720));
  const pad = 16 * scale;
  const measureW = (s) => {
    try { return ctx.measureText ? ctx.measureText(s).width : String(s).length * 8 * scale; }
    catch (e) { return String(s).length * 8 * scale; }
  };
  ctx.save();
  ctx.textBaseline = 'top';

  // 상단: 제목 + (선택)경과시간.
  const chipH = 30 * scale;
  const titleStr = String(title || (elapsedMs != null ? 'REC' : 'LIVE')).toUpperCase();
  ctx.font = `800 ${12 * scale}px system-ui, sans-serif`;
  const titleW = measureW(titleStr) + 34 * scale;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(pad, pad, titleW, chipH);
  if (elapsedMs != null) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(pad + 14 * scale, pad + chipH / 2, 4.6 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f1f5f9';
  ctx.textBaseline = 'middle';
  ctx.fillText(titleStr, pad + 24 * scale, pad + chipH / 2);

  if (elapsedMs != null) {
    const time = formatRecordTime(Math.floor(elapsedMs / 1000));
    ctx.font = `800 ${13 * scale}px ui-monospace, Menlo, monospace`;
    const tW = measureW(time) + 20 * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(width - pad - tW, pad, tW, chipH);
    ctx.fillStyle = '#fff7ed';
    ctx.textAlign = 'center';
    ctx.fillText(time, width - pad - tW / 2, pad + chipH / 2);
    ctx.textAlign = 'left';
  }

  // 하단: 측정값 패널(라벨 + 값). 실제 데이터만.
  if (items.length) {
    const rowH = 30 * scale;
    const panelW = Math.min(width * 0.6, 300 * scale);
    const panelH = items.length * rowH + 16 * scale;
    const panelX = pad;
    const panelY = height - pad - panelH;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    items.slice(0, 4).forEach((m, i) => {
      const y = panelY + 8 * scale + i * rowH + rowH / 2;
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${10 * scale}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(203,213,225,0.82)';
      ctx.textAlign = 'left';
      ctx.fillText(String(m.label || '').toUpperCase(), panelX + 12 * scale, y);
      ctx.font = `800 ${15 * scale}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = i === 0 ? accent : '#f8fafc';
      ctx.textAlign = 'right';
      ctx.fillText(String(m.value), panelX + panelW - 12 * scale, y);
      ctx.textAlign = 'left';
    });
  }
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅 데이터-only HUD (장식 없음 · 측정 필수값만 영상에 번인)
//   · drawRomHud 와 동일 철학: 반투명 박스 + 실제 측정 수치만.
//   · 코너 프레임/스캔라인/가짜 게이지/링 등 SF 장식은 일절 그리지 않는다.
//   · 표시 항목: 수직이동(cm) · 평균속도(m/s) · 경과시간(s). 값이 없으면 '--'.
//   (바벨 궤적선은 이 함수가 아니라 호출부에서 실제 추적 경로를 그린다.)
// ════════════════════════════════════════════════════════════════════════
export function drawLiftingDataHud(ctx, width, height, data = {}) {
  const { romCm = null, meanVelocity = null, elapsedSec = null, recording = false } = data;
  const pad = Math.round(width * 0.03);
  const fs = Math.max(15, Math.round(width / 30));
  const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

  ctx.save();
  ctx.textBaseline = 'top';

  // 좌상단: REC 점 + 경과시간(녹화 중일 때만 점 표시).
  const timeStr = Number.isFinite(elapsedSec) ? `${elapsedSec.toFixed(1)}s` : '0.0s';

  const lines = [
    { label: '수직이동', value: r2(romCm) == null ? '--' : `${r2(romCm)} cm` },
    { label: '평균속도', value: r2(meanVelocity) == null ? '--' : `${r2(meanVelocity)} m/s` },
    { label: '경과', value: timeStr },
  ];

  const boxW = Math.round(width * 0.5);
  const rowH = fs + 8;
  const boxH = pad + lines.length * rowH;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(pad, pad, boxW, boxH);

  // 녹화 표시 점.
  if (recording) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(pad + 12, pad + 12, Math.max(4, fs * 0.28), 0, Math.PI * 2);
    ctx.fill();
  }

  lines.forEach((ln, i) => {
    const y = pad + 6 + i * rowH;
    ctx.font = `600 ${Math.round(fs * 0.72)}px sans-serif`;
    ctx.fillStyle = 'rgba(203,213,225,0.85)';
    ctx.fillText(ln.label, pad + (recording && i === 0 ? 30 : 12), y + 2);
    ctx.font = `800 ${fs}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = i === 1 ? 'rgba(251,191,36,0.97)' : 'rgba(248,250,252,0.97)';
    ctx.textAlign = 'right';
    ctx.fillText(String(ln.value), pad + boxW - 12, y);
    ctx.textAlign = 'left';
  });

  ctx.restore();
}

/**
 * 바벨 궤적선을 녹화 캔버스에 그린다(실제 추적 경로 · 장식 아님).
 * @param {Array<{x:number,y:number}>} path 정규화(0~1) 좌표 배열
 */
export function drawBarPathToRecord(ctx, path, width, height) {
  if (!Array.isArray(path) || path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(34,211,238,0.95)';
  ctx.lineWidth = Math.max(4, width / 160);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  path.forEach((q, i) => {
    const X = q.x * width, Y = q.y * height;
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
  });
  ctx.stroke();
  ctx.restore();
}

export function drawCogOverlay(ctx, width, height, cog, opts = {}) {
  if (!ctx || !cog || !Number.isFinite(cog.x) || !Number.isFinite(cog.y)) return;
  const { label = 'COG', strong = false } = opts;
  const x = cog.x * width;
  const y = cog.y * height;
  const supportX = Number.isFinite(cog.supportX) ? cog.supportX * width : x;
  const r = Math.max(strong ? 9 : 7, width / 110);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, width / 260);
  ctx.strokeStyle = cog.sideView ? 'rgba(52,211,153,0.92)' : 'rgba(251,191,36,0.82)';
  ctx.setLineDash([8, 7]);
  ctx.beginPath();
  ctx.moveTo(x, Math.max(0, y - height * 0.28));
  ctx.lineTo(supportX, Math.min(height, y + height * 0.34));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = cog.sideView ? 'rgba(52,211,153,0.95)' : 'rgba(251,191,36,0.95)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(15,23,42,0.9)';
  ctx.stroke();

  const text = `${label}${cog.confidence != null ? ` ${Math.round(cog.confidence * 100)}%` : ''}`;
  ctx.font = `800 ${Math.max(11, width / 56)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText ? ctx.measureText(text).width : text.length * 8;
  const bx = Math.min(width - tw - 18, Math.max(8, x + r + 8));
  const by = Math.min(height - 16, Math.max(16, y));
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(bx - 6, by - 13, tw + 12, 26);
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(text, bx, by);
  ctx.restore();
}
