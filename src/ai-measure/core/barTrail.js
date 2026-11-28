// ai-measure/core/barTrail.js
// 바벨 궤적 "표시" 전용 유틸 (속도·렙 판정에는 관여하지 않는다).
//  1) createOneEuro      : 속도 적응형 저역통과 — 느릴 땐 강하게 눌러 떨림 제거, 빠를 땐 지연 없이 따라감
//  2) createSleeveAnchor : 슬리브(봉 끝) 추적점 ↔ 손목 오프셋 보정 — 추적이 끊겨도 점프 없이 이어감
//  3) createRepTrail     : 한 렙이 끝날 때까지 궤적 유지, 다음 렙 시작 때 새로 시작
//  4) drawSolidBarTrail  : 사라지지 않는 곡선 궤적 렌더링

const TWO_PI = Math.PI * 2;

function alphaFor(cutoffHz, dtSec) {
  const tau = 1 / (TWO_PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

/** One-Euro 필터(2D). 좌표는 정규화(0~1), ts는 ms. */
export function createOneEuro({ minCutoff = 0.8, beta = 7, dCutoff = 1.0 } = {}) {
  let prev = null; // {x,y,ts}
  let dx = 0, dy = 0;
  return {
    filter(pt, ts) {
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return prev ? { x: prev.x, y: prev.y } : null;
      if (!prev || !Number.isFinite(ts) || ts <= prev.ts || ts - prev.ts > 1000) {
        prev = { x: pt.x, y: pt.y, ts: Number.isFinite(ts) ? ts : 0 };
        dx = 0; dy = 0;
        return { x: pt.x, y: pt.y };
      }
      const dt = Math.max(0.001, (ts - prev.ts) / 1000);
      const ad = alphaFor(dCutoff, dt);
      const rawDx = (pt.x - prev.x) / dt, rawDy = (pt.y - prev.y) / dt;
      dx += (rawDx - dx) * ad;
      dy += (rawDy - dy) * ad;
      const speed = Math.hypot(dx, dy);
      const a = alphaFor(minCutoff + beta * speed, dt);
      const x = prev.x + (pt.x - prev.x) * a;
      const y = prev.y + (pt.y - prev.y) * a;
      prev = { x, y, ts };
      return { x, y };
    },
    reset() { prev = null; dx = 0; dy = 0; },
  };
}

/**
 * 슬리브 추적점이 살아있을 땐 그 점을 쓰고, 오프셋(슬리브-손목)을 천천히 학습한다.
 * 추적이 끊기면 "손목 + 마지막 오프셋"으로 이어가 손목↔슬리브 사이 점프를 막는다.
 * 슬리브를 지정하지 않았으면(sleeve==null && 오프셋 없음) 손목을 그대로 쓴다.
 */
export function createSleeveAnchor() {
  let offset = null; // {x,y}
  return {
    resolve({ sleeve, active, wrist }) {
      if (sleeve && active) {
        if (wrist) {
          const o = { x: sleeve.x - wrist.x, y: sleeve.y - wrist.y };
          offset = offset ? { x: offset.x + (o.x - offset.x) * 0.1, y: offset.y + (o.y - offset.y) * 0.1 } : o;
        }
        return { x: sleeve.x, y: sleeve.y, source: 'sleeve' };
      }
      if (wrist && offset) return { x: wrist.x + offset.x, y: wrist.y + offset.y, source: 'wrist+offset' };
      if (wrist && !sleeve) return { x: wrist.x, y: wrist.y, source: 'wrist' };
      if (sleeve) return { x: sleeve.x, y: sleeve.y, source: 'sleeve-hold' };
      return null;
    },
    hasOffset() { return !!offset; },
    reset() { offset = null; },
  };
}

/**
 * 렙 단위 궤적. reps(완료 렙 수)가 늘면 "끝남"으로 표시하고 궤적을 그대로 둔다.
 * 끝난 뒤 다시 움직이기 시작하면(HOLD_MS 경과 + 이동 > RESTART_DIST) 새 궤적을 시작한다.
 */
export function createRepTrail({ holdMs = 600, restartDist = 0.03, maxPoints = 2400, seedMs = 250 } = {}) {
  let pts = [];
  let lastReps = null;
  let finished = false;
  let finishTs = 0;
  let finishPt = null;
  return {
    push(pt, ts, reps) {
      if (!pt || !Number.isFinite(ts)) return pts;
      if (lastReps == null) lastReps = Number.isFinite(reps) ? reps : 0;
      if (Number.isFinite(reps) && reps > lastReps) {
        lastReps = reps;
        finished = true;
        finishTs = ts;
        finishPt = pts.length ? { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y } : { x: pt.x, y: pt.y };
      }
      if (finished) {
        const moved = Math.hypot(pt.x - finishPt.x, pt.y - finishPt.y);
        if (ts - finishTs >= holdMs && moved > restartDist) {
          pts = pts.filter(p => ts - p.ts <= seedMs); // 끊김 없이 이어지도록 직전 몇 프레임만 승계
          finished = false;
        } else {
          return pts; // 렙 종료 후 정지 구간: 궤적 유지(점 추가 안 함)
        }
      }
      pts.push({ x: pt.x, y: pt.y, ts });
      if (pts.length > maxPoints) pts.shift();
      return pts;
    },
    points() { return pts; },
    isFinished() { return finished; },
    reset() { pts = []; lastReps = null; finished = false; finishTs = 0; finishPt = null; },
  };
}

/** 사라지지 않는 곡선 궤적. 중점 보간 2차 곡선으로 각진 떨림을 눈에 띄지 않게 한다. */
export function drawSolidBarTrail(ctx, path, width, height, opts = {}) {
  if (!Array.isArray(path) || path.length < 2) return;
  const rgb = opts.rgb ?? '34,211,238';
  const alpha = opts.alpha ?? 0.95;
  const lineWidth = Math.max(4, width / (opts.minWidthDivisor ?? 160));
  const P = path.map(p => ({ x: p.x * width, y: p.y * height }));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(${rgb},${alpha})`;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(P[0].x, P[0].y);
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2;
    ctx.quadraticCurveTo(P[i].x, P[i].y, mx, my);
  }
  ctx.lineTo(P[P.length - 1].x, P[P.length - 1].y);
  ctx.stroke();
  // 시작점(작은 흰 점) · 현재점(채운 원)
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(P[0].x, P[0].y, lineWidth * 0.7, 0, TWO_PI); ctx.fill();
  const last = P[P.length - 1];
  ctx.fillStyle = `rgba(${rgb},1)`;
  ctx.beginPath(); ctx.arc(last.x, last.y, lineWidth * 1.1, 0, TWO_PI); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
  ctx.restore();
}
