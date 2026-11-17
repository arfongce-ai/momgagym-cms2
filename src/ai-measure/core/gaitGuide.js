// ai-measure/core/gaitGuide.js
// 보행 & 러닝 가이드 (v3 — Center Safe Zone + Calibration Lock).
//
// 광각 렌즈 왜곡은 화면 가장자리에서 가장 심하므로, 상하좌우 15% 여백을 둔
// '중앙 세이프 존' 안에서만 촬영하도록 얇은 타겟 박스를 그린다.
//
// opts:
//   view: 'side' | 'back' | 'front'
//   locked: boolean   — 캘리브레이션 완료(2초 안정) 시 true → 박스 녹색
//   armingPct: 0~1    — 안정화 진행률(없으면 0)
//
// [정면뷰 추가 2026-09-14] 'front'는 정중선 계산이 'back'과 동일(화면 중앙,
// w/2)하므로 별도 분기 없이 back과 같은 경로를 탄다 — 관상면(정면) 촬영 시
// 골반·무릎 좌우 정렬을 보기 위한 중앙 기준선이라는 점에서 후면과 목적이 같다.

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

  // [2026-11-17] 예전 Hip/Knee/Ankle 가로선은 박스 높이의 고정 비율(8%·50%·92%)일 뿐 사람의 실제 위치와 무관해 의미가 없었다.
  //  대신 박스 위·아래 변이 곧 기준이다: 윗변=머리 끝, 아랫변=발바닥(트레드밀 바닥). 전신이 두 변 사이에 들어오게 맞춘다.
  ctx.setLineDash([]);
  ctx.font = `${Math.round(h * 0.016)}px system-ui, sans-serif`;
  ctx.fillStyle = locked ? 'rgba(52,211,153,0.8)' : 'rgba(255,255,255,0.65)';
  ctx.fillText('머리 끝', bx + 6, by + Math.round(h * 0.022));
  ctx.fillText('발바닥', bx + 6, by + bh - 6);

  // 정렬 수직선: 측면=시상면 중앙, 후면/정면=정중선
  ctx.setLineDash([6, 9]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = locked ? 'rgba(52,211,153,0.5)' : amber;
  const cx = (view === 'back' || view === 'front') ? w / 2 : bx + bw / 2;
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
