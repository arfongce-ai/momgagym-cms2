// ai-measure/core/gaitGuide.js
// 보행 & 러닝 메뉴 전용 하체 집중 가이드 (v2 — 미니멀).
// 환경(트레드밀/바닥) 구분과 지면선을 제거했다. 알고리즘이 절대 좌표에
// 의존하지 않으므로 가이드도 '하체 정렬' 한 가지 역할만 한다.
//
// view: 'side' | 'back'

export function drawGaitGuides(ctx, w, h, { view = 'side' } = {}) {
  ctx.save();

  // 하체 타겟 박스 (골반→발목): 중앙 60% 폭, 28%~94% 높이.
  // 손에 들고 패닝하는 상황을 고려해 박스를 약간 키우고 선을 가늘게.
  const boxX = w * 0.20;
  const boxY = h * 0.28;
  const boxW = w * 0.60;
  const boxH = h * 0.66;
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(34,211,238,0.5)';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // 골반/무릎/발목 기준 행 (정렬 가이드)
  ctx.setLineDash([4, 7]);
  ctx.lineWidth = 1;
  const rows = [
    { f: 0.05, label: 'Hip', color: 'rgba(245,158,11,0.65)' },
    { f: 0.5, label: 'Knee', color: 'rgba(34,211,238,0.55)' },
    { f: 0.95, label: 'Ankle', color: 'rgba(52,211,153,0.7)' },
  ];
  ctx.font = `${Math.round(h * 0.018)}px system-ui, sans-serif`;
  for (const r of rows) {
    const y = boxY + boxH * r.f;
    ctx.strokeStyle = r.color;
    ctx.beginPath();
    ctx.moveTo(boxX, y);
    ctx.lineTo(boxX + boxW, y);
    ctx.stroke();
    ctx.fillStyle = r.color;
    ctx.fillText(r.label, boxX + 5, y - 4);
  }

  // 정렬 기준선: 측면=시상면 수직선, 후면=정중선
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = view === 'back' ? 'rgba(245,158,11,0.75)' : 'rgba(245,158,11,0.5)';
  const cx = view === 'back' ? w / 2 : boxX + boxW / 2;
  ctx.beginPath();
  ctx.moveTo(cx, boxY);
  ctx.lineTo(cx, boxY + boxH);
  ctx.stroke();

  ctx.restore();
}
