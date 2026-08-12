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
//  대형 시인성 HUD (측정 공통 · 녹화 영상 번인용)
//   · 요구사항: 핵심 정보만 크게, 직관적으로. 피사체(중앙)를 가리지 않도록
//     화면 가장자리(상단 코너 + 하단 스트립)에만 배치한다.
//   · 상단: 제목 칩(REC 점·상태) + 경과시간 칩 → 그 아래 좌/우 대형 수치 카드.
//   · 하단: 회차(렙·점프) 히스토리 카드 스트립(선택).
//   · 값이 없으면 '--' — 허위값을 그리지 않는다(측정 정직성).
// ════════════════════════════════════════════════════════════════════════
export function drawGaugeHud(ctx, width, height, opts = {}) {
  const {
    title = '', status = '', recording = false, elapsedSec = null,
    gauge = null, stats = [], cards = null, accent = '#22d3ee',
  } = opts;
  if (!title && !gauge && (!stats || !stats.length) && elapsedSec == null) return;

  const u = Math.max(0.6, Math.min(2.4, width / 720));
  const pad = Math.round(18 * u);
  const measureW = (s) => {
    try { return ctx.measureText ? ctx.measureText(s).width : String(s).length * 8 * u; }
    catch (e) { return String(s).length * 8 * u; }
  };

  ctx.save();

  // ── 상단 칩: 제목(+REC·상태) / 경과 ──
  const chipH = Math.round(36 * u);
  if (title || recording || status) {
    ctx.font = `800 ${Math.round(15 * u)}px system-ui, sans-serif`;
    const titleStr = String(title || 'LIVE').toUpperCase();
    const statusStr = status ? String(status) : '';
    const tW = measureW(titleStr);
    const sW = statusStr ? measureW(statusStr) + 10 * u : 0;
    const chipW = Math.round((recording ? 40 : 16) * u + tW + sW + 16 * u);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRectPath(ctx, pad, pad, chipW, chipH, Math.round(10 * u));
    ctx.fill();
    if (recording) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(pad + 18 * u, pad + chipH / 2, 6 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8fafc';
    const tx = pad + (recording ? 32 : 12) * u;
    ctx.fillText(titleStr, tx, pad + chipH / 2 + 1);
    if (statusStr) {
      ctx.fillStyle = accent;
      ctx.fillText(statusStr, tx + tW + 10 * u, pad + chipH / 2 + 1);
    }
  }
  if (elapsedSec != null && Number.isFinite(elapsedSec)) {
    const t = `${Math.max(0, elapsedSec).toFixed(1)}s`;
    ctx.font = `800 ${Math.round(17 * u)}px ui-monospace, Menlo, monospace`;
    const tw = measureW(t) + 24 * u;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRectPath(ctx, width - pad - tw, pad, tw, chipH, Math.round(10 * u));
    ctx.fill();
    ctx.fillStyle = '#fff7ed';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, width - pad - tw / 2, pad + chipH / 2 + 1);
    ctx.textAlign = 'left';
  }

  // ── 하단 회차 스트립(카드) — 게이지 위에 겹치지 않도록 먼저 자리 확보 ──
  let bottomReserve = pad;
  if (Array.isArray(cards) && cards.length > 0) {
    const list = cards.slice(-6);
    const cardFs = Math.max(15, Math.round(width / 26));
    const gap = Math.round(width * 0.012);
    const cW = Math.round((width - pad * 2 - gap * (list.length - 1)) / Math.max(5, list.length));
    const cH = Math.round(cardFs * 3.0);
    const y0 = height - pad - cH;
    list.forEach((c, i) => {
      const x0 = pad + i * (cW + gap);
      const latest = !!c.latest;
      ctx.fillStyle = latest ? 'rgba(34,211,238,0.92)' : 'rgba(0,0,0,0.5)';
      roundRectPath(ctx, x0, y0, cW, cH, Math.round(cardFs * 0.35));
      ctx.fill();
      const textMain = latest ? 'rgba(2,6,23,0.95)' : 'rgba(248,250,252,0.97)';
      const textSub = latest ? 'rgba(2,6,23,0.6)' : 'rgba(203,213,225,0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${Math.round(cardFs * 0.6)}px system-ui, sans-serif`;
      ctx.fillStyle = textSub;
      if (c.top) ctx.fillText(String(c.top), x0 + cW / 2, y0 + Math.round(cH * 0.10));
      ctx.font = `900 ${cardFs}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = textMain;
      ctx.fillText(c.main != null ? String(c.main) : '\u2013', x0 + cW / 2, y0 + Math.round(cH * 0.36));
      ctx.font = `700 ${Math.round(cardFs * 0.56)}px system-ui, sans-serif`;
      ctx.fillStyle = textSub;
      if (c.sub) ctx.fillText(String(c.sub), x0 + cW / 2, y0 + Math.round(cH * 0.70));
    });
    ctx.textAlign = 'left';
    bottomReserve = cH + pad * 2;
  }

  // ── 좌우 코너 보조 스탯 카드(최대 4: 상단 좌/우, 하단 좌/우) ──
  const list = (stats || []).filter(s => s && s.label).slice(0, 4);
  const scardW = Math.round(width * 0.27);
  const scLabelFs = Math.round(13 * u);
  const scValFs = Math.round(30 * u);
  const scardH = Math.round(scLabelFs + scValFs + 22 * u);
  const topY = pad + chipH + Math.round(10 * u);
  const botY = height - bottomReserve - scardH;
  const anchors = [
    { x: pad, y: topY },
    { x: width - pad - scardW, y: topY },
    { x: pad, y: botY },
    { x: width - pad - scardW, y: botY },
  ];
  list.forEach((s, i) => {
    const a = anchors[i];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRectPath(ctx, a.x, a.y, scardW, scardH, Math.round(13 * u));
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `700 ${scLabelFs}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(203,213,225,0.85)';
    ctx.fillText(String(s.label), a.x + 12 * u, a.y + 9 * u);
    const valStr = (s.value == null || s.value === '') ? '--' : String(s.value);
    ctx.font = `900 ${scValFs}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = s.tone || '#f8fafc';
    ctx.fillText(valStr, a.x + 12 * u, a.y + 9 * u + scLabelFs + 4 * u);
    if (s.unit) {
      const vw = measureW(valStr);
      ctx.font = `800 ${Math.round(scValFs * 0.5)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(226,232,240,0.75)';
      ctx.fillText(String(s.unit), a.x + 12 * u + vw + 5 * u, a.y + 9 * u + scLabelFs + 4 * u + scValFs * 0.42);
    }
  });

  // ── 중앙 주값(아크는 상한 명확한 값 전용: gauge.arc) ──
  // [2026-08-12] 상단 배치를 잠깐 시도했다가(피사체 미가림 목적) 몸가짐운동센터
  // 요청으로 다시 정중앙 배치로 되돌렸다 — 겹침보다 "주지표를 크고 눈에 띄게"
  // 쪽을 택한 의도적 선택. 접지시간·진행 등 보조 스탯은 그대로 코너에 남는다.
  if (gauge && gauge.label !== undefined) {
    const cx = width / 2;
    const gaugeR = Math.round(Math.min(width, height) * 0.20);
    const cy = Math.round(height * 0.5);
    const lw = Math.max(8, Math.round(gaugeR * 0.16));
    const start = Math.PI * 0.75;         // 좌하 (135°)
    const end = Math.PI * 2.25;           // 우하 (405° = 45°), 총 270°
    const gv = gauge.value;
    const min = Number.isFinite(gauge.min) ? gauge.min : 0;
    const max = Number.isFinite(gauge.max) ? gauge.max : 1;
    // null/undefined/'' 는 '값 없음' → '--' (Number(null)===0 유출 방지).
    const hasV = gv != null && gv !== '' && Number.isFinite(Number(gv));
    const v = hasV ? Number(gv) : NaN;
    // 아크는 상한이 생리학적으로 명확한 값(속도·RSI)에만. 무게·각도 등은 숫자만.
    const useArc = gauge.arc === true;
    const frac = useArc && hasV && max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;

    if (useArc) {
      ctx.beginPath();
      ctx.arc(cx, cy, gaugeR, start, end);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.stroke();
      if (frac > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, gaugeR, start, start + (end - start) * frac);
        ctx.strokeStyle = accent;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
    // 중앙 값 + 라벨/단위 (아크 유무와 무관하게 동일한 크기·위치)
    const valFs = useArc ? gaugeR * 0.62 : gaugeR * 0.78;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (gauge.label) {
      ctx.font = `800 ${Math.round(gaugeR * 0.18)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(226,232,240,0.85)';
      ctx.fillText(String(gauge.label), cx, cy - gaugeR * 0.42);
    }
    ctx.font = `900 ${Math.round(valFs)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(hasV ? String(gauge.value) : '--', cx, cy + gaugeR * 0.02);
    if (gauge.unit) {
      ctx.font = `800 ${Math.round(gaugeR * 0.2)}px system-ui, sans-serif`;
      ctx.fillStyle = accent;
      ctx.fillText(String(gauge.unit), cx, cy + gaugeR * 0.42);
    }
    ctx.textAlign = 'left';
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
  const {
    romCm = null, meanVelocity = null, elapsedSec = null,
    recording = false, repList = null, title = 'LIFT',
  } = data;
  const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

  // 렙별 속도 카드(하단) — RSI 점프별 기록처럼 녹화 영상에도 렙마다 남긴다.
  const cards = (Array.isArray(repList) && repList.length > 0)
    ? repList.slice(-6).map((r, i, arr) => ({
        top: `#${r.repNo}`,
        main: r.meanVelocity != null ? String(r.meanVelocity) : '\u2013',
        sub: (r.lossPct != null && r.lossPct > 0) ? `-${r.lossPct}%`
          : (r.romCm != null ? `${r.romCm}cm` : 'm/s'),
        latest: i === arr.length - 1,
      }))
    : null;

  drawGaugeHud(ctx, width, height, {
    title,
    recording,
    elapsedSec: Number.isFinite(elapsedSec) ? elapsedSec : 0,
    accent: '#22d3ee',
    gauge: { label: '평균속도', value: r1(meanVelocity), unit: 'm/s', arc: true, min: 0, max: 1.5 },
    stats: [
      { label: '수직이동', value: r1(romCm), unit: 'cm' },
    ],
    cards,
  });
}

// 둥근 사각형 경로(HUD 카드용).
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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
