// ai-measure/core/cameraGuide.js
// 카메라 측정 공통 가이드라인 오버레이. 모든 카메라 측정 메뉴가 재사용.
// 캔버스에 수평·수직 중심선 + 3분할 격자 + 중앙 십자를 그린다.

export function drawGuides(ctx, w, h, opts = {}) {
  const {
    color = 'rgba(34,211,238,0.35)',   // 청록 반투명
    centerColor = 'rgba(245,158,11,0.6)', // 중심 십자(앰버)
    thirds = true,
  } = opts;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);

  // 3분할 격자선
  if (thirds) {
    ctx.strokeStyle = color;
    // 세로 1/3, 2/3
    for (const fx of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(w * fx, 0);
      ctx.lineTo(w * fx, h);
      ctx.stroke();
    }
    // 가로 1/3, 2/3
    for (const fy of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(0, h * fy);
      ctx.lineTo(w, h * fy);
      ctx.stroke();
    }
  }

  // 중앙 수직선(중심 정렬용) + 수평선
  ctx.setLineDash([]);
  ctx.strokeStyle = centerColor;
  ctx.lineWidth = 1.5;
  // 수직 중심선
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  // 수평 중심선
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // 중앙 십자 마커
  const cx = w / 2, cy = h / 2, s = Math.min(w, h) * 0.03;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
  ctx.stroke();

  ctx.restore();
}
