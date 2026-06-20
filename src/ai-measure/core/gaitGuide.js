// ai-measure/core/gaitGuide.js
// 보행 & 러닝 메뉴 전용 하체 집중 가이드 + 자이로 수평/수직 가이드.
//
// view: 'side' | 'back'   env: 'treadmill' | 'floor'
// tilt: { beta, gamma } | null  (DeviceOrientation, 도 단위) — 시차 오류 방지용 수평계

export function drawGaitGuides(ctx, w, h, { view = 'side', env = 'floor', tilt = null } = {}) {
  ctx.save();

  // 상단 1/3 디밍 → 하체를 하단 2/3 에 프레이밍 유도
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, w, h * 0.33);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.33);
  ctx.lineTo(w, h * 0.33);
  ctx.stroke();

  // 하체 타겟 박스 (골반→발목): 중앙 56% 폭, 33%~92% 높이
  const boxX = w * 0.22;
  const boxY = h * 0.33;
  const boxW = w * 0.56;
  const boxH = h * 0.59;
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(34,211,238,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // 골반/무릎/발목 기준 행
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1.2;
  const rows = [
    { f: 0.06, label: '골반(Hip)', color: 'rgba(245,158,11,0.7)' },
    { f: 0.5, label: '무릎(Knee)', color: 'rgba(34,211,238,0.6)' },
    { f: 0.92, label: '발목(Ankle)', color: 'rgba(52,211,153,0.75)' },
  ];
  ctx.font = `${Math.round(h * 0.02)}px system-ui, sans-serif`;
  for (const r of rows) {
    const y = boxY + boxH * r.f;
    ctx.strokeStyle = r.color;
    ctx.beginPath();
    ctx.moveTo(boxX, y);
    ctx.lineTo(boxX + boxW, y);
    ctx.stroke();
    ctx.fillStyle = r.color;
    ctx.fillText(r.label, boxX + 6, y - 5);
  }
  ctx.setLineDash([]);

  if (view === 'back') {
    ctx.strokeStyle = 'rgba(245,158,11,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2, boxY);
    ctx.lineTo(w / 2, boxY + boxH);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    const y = boxY + boxH * 0.5;
    ctx.beginPath();
    ctx.moveTo(w / 2 - boxW * 0.18, y);
    ctx.lineTo(w / 2 + boxW * 0.18, y);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(245,158,11,0.6)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(boxX + boxW / 2, boxY);
    ctx.lineTo(boxX + boxW / 2, boxY + boxH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 지면선/벨트라인
  const groundY = env === 'treadmill' ? boxY + boxH * 0.97 : boxY + boxH;
  ctx.strokeStyle = 'rgba(52,211,153,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();
  ctx.fillStyle = 'rgba(52,211,153,0.95)';
  ctx.font = `${Math.round(h * 0.02)}px system-ui, sans-serif`;
  ctx.fillText(env === 'treadmill' ? '벨트 라인' : '지면선', 8, groundY - 6);

  // 자이로 수평계 (시차 오류 방지) — 화면 중앙 소형 버블 레벨
  if (tilt && (tilt.beta != null || tilt.gamma != null)) {
    drawLevel(ctx, w, h, tilt);
  }

  ctx.restore();
}

function drawLevel(ctx, w, h, tilt) {
  const cx = w / 2;
  const cy = h * 0.5;
  const R = Math.min(w, h) * 0.07;
  const gamma = Math.max(-30, Math.min(30, tilt.gamma || 0)); // 좌우 기울기
  const beta = Math.max(-30, Math.min(30, (tilt.beta || 0) - 90)); // 전후(세로 기준 보정)
  const offX = (gamma / 30) * R;
  const offY = (beta / 30) * R;
  const level = Math.abs(gamma) < 3 && Math.abs(beta) < 3;
  const col = level ? 'rgba(52,211,153,0.95)' : 'rgba(245,158,11,0.9)';

  ctx.save();
  // 기준 원 + 십자
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.35, cy); ctx.lineTo(cx + R * 0.35, cy);
  ctx.moveTo(cx, cy - R * 0.35); ctx.lineTo(cx, cy + R * 0.35);
  ctx.stroke();
  // 버블
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(cx + offX, cy + offY, R * 0.22, 0, Math.PI * 2); ctx.fill();
  // 라벨
  ctx.fillStyle = col;
  ctx.font = `${Math.round(h * 0.018)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(level ? '수평 OK' : '수평 맞추기', cx, cy + R + Math.round(h * 0.028));
  ctx.restore();
}
