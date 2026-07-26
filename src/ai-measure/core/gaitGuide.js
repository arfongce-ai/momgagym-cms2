// ai-measure/core/gaitGuide.js
// 보행 & 러닝 가이드 (v3 — Center Safe Zone + Calibration Lock).
//
// 광각 렌즈 왜곡은 화면 가장자리에서 가장 심하므로, 상하좌우 15% 여백을 둔
// '중앙 세이프 존' 안에서만 촬영하도록 얇은 타겟 박스를 그린다.
//
// opts:
//   view: 'side' | 'back'
//   locked: boolean   — 캘리브레이션 완료(2초 안정) 시 true → 박스 녹색
//   armingPct: 0~1    — 안정화 진행률(없으면 0)

export function drawGaitGuides(ctx, w, h, { view = 'side', locked = false, armingPct = 0 } = {}) {
  ctx.save();

  // 중앙 세이프 존: 상하좌우 15% 여백
  const m = 0.15;
  const bx = w * m, by = h * m, bw = w * (1 - 2 * m), bh = h * (1 - 2 * m);

  const green = 'rgba(52,211,153,0.95)';
  const amber = 'rgba(245,158,11,0.85)';
  const cyan = 'rgba(34,211,238,0.55)';
  const main = locked ? green : cyan;

  // 얇은 타겟 박스 (모서리 강조 + 가는 외곽)
  ctx.lineWidth = locked ? 2.5 : 1.6;
  ctx.strokeStyle = main;
  ctx.setLineDash(locked ? [] : [10, 8]);
  ctx.strokeRect(bx, by, bw, bh);

  // 모서리 ㄱ자 마커
  ctx.setLineDash([]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = main;
  const c = Math.min(w, h) * 0.045;
  const corner = (x, y, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x + dx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * c);
    ctx.stroke();
  };
  corner(bx, by, 1, 1); corner(bx + bw, by, -1, 1);
  corner(bx, by + bh, 1, -1); corner(bx + bw, by + bh, -1, -1);

  // 하체 정렬 기준선 (Hip/Knee/Ankle) — 세이프존 내부, 아주 얇게
  ctx.setLineDash([3, 8]);
  ctx.lineWidth = 1;
  const rows = [
    { f: 0.08, label: 'Hip' },
    { f: 0.5, label: 'Knee' },
    { f: 0.92, label: 'Ankle' },
  ];
  ctx.font = `${Math.round(h * 0.016)}px system-ui, sans-serif`;
  for (const r of rows) {
    const y = by + bh * r.f;
    ctx.strokeStyle = locked ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); ctx.stroke();
    ctx.fillStyle = locked ? 'rgba(52,211,153,0.7)' : 'rgba(255,255,255,0.5)';
    ctx.fillText(r.label, bx + 5, y - 4);
  }

  // 정렬 수직선: 측면=시상면 중앙, 후면=정중선
  ctx.setLineDash([6, 9]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = locked ? 'rgba(52,211,153,0.5)' : amber;
  const cx = view === 'back' ? w / 2 : bx + bw / 2;
  ctx.beginPath(); ctx.moveTo(cx, by); ctx.lineTo(cx, by + bh); ctx.stroke();

  // 캘리브레이션 진행 게이지 (상단 변을 따라 차오름)
  if (!locked && armingPct > 0) {
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = green;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + bw * Math.max(0, Math.min(1, armingPct)), by);
    ctx.stroke();
  }

  ctx.restore();
}
