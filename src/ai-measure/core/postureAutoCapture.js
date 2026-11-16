// [자세 자동측정 카운트 늦추기 2026-11-16]
// 현장 피드백: "자세를 바꾸는 중인데 카운트가 너무 빨리 들어간다."
// 원인: 면 판정이 프레임 수(12~14프레임 ≈ 0.5초) 기준이었고, 한 면을 찍은 뒤 1.5초만 쉬고
// 바로 다음 면 판정을 시작해, 몸을 돌리는 도중에 목표 면이 잠깐 맞아도 카운트가 시작됐다.
// 변경: ① 면을 찍은 뒤 돌아설 시간(3초) 동안 판정 쉼 ② 목표 면이 '2초 연속' 유지되고
// ③ 몸이 멈춰 있을 때(어깨·골반 중심 흔들림 작음)만 3-2-1 카운트를 시작한다.
import { LM } from './geometry';

export const AUTO_CAPTURE = Object.freeze({
  turnPauseMs: 3000,    // 면 촬영 후 다음 면으로 돌아서는 시간(판정 쉼)
  stableHoldMs: 2000,   // 목표 면이 연속으로 유지돼야 하는 시간
  lockHoldMs: 2500,     // 면 고정 모드에서 멈춤 유지 시간
  stillWindowMs: 1000,  // 멈춤 확인 구간
  stillTol: 0.012,      // 이 구간 동안 어깨·골반 중심 이동 허용치(화면 비율, 약 1.2%)
});

function mid(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 최근 windowMs 동안 어깨·골반 중심이 tol 이내로 멈춰 있었는가 */
export function isBodyStill(buffer, nowTs, windowMs = AUTO_CAPTURE.stillWindowMs, tol = AUTO_CAPTURE.stillTol) {
  if (!Array.isArray(buffer) || !buffer.length) return false;
  const recent = buffer.filter((f) => nowTs - f.ts <= windowMs);
  // 구간을 거의 다 채운 데이터가 있어야 '멈춤'으로 본다(프레임이 막 쌓이기 시작한 순간 오판 방지)
  if (recent.length < 5 || nowTs - recent[0].ts < windowMs * 0.8) return false;
  const pts = recent.map((f) => {
    const l = f.landmarks;
    const sh = mid(l[LM.LEFT_SHOULDER], l[LM.RIGHT_SHOULDER]);
    const hp = mid(l[LM.LEFT_HIP], l[LM.RIGHT_HIP]);
    return sh && hp ? { x: (sh.x + hp.x) / 2, y: (sh.y + hp.y) / 2 } : null;
  }).filter(Boolean);
  if (pts.length < 5) return false;
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return Math.max(...xs) - Math.min(...xs) <= tol && Math.max(...ys) - Math.min(...ys) <= tol;
}

/**
 * 목표 면 연속 유지 타이머. 매 프레임 update(stable, still, ts) 를 부르면
 * { ready, heldMs, remainMs } 를 돌려준다. 끊기면 0부터 다시.
 */
export function createHoldTimer(holdMs = AUTO_CAPTURE.stableHoldMs) {
  let since = 0;
  return {
    update(ok, ts) {
      if (!ok) { since = 0; return { ready: false, heldMs: 0, remainMs: holdMs }; }
      if (!since) since = ts;
      const heldMs = ts - since;
      return { ready: heldMs >= holdMs, heldMs, remainMs: Math.max(0, holdMs - heldMs) };
    },
    reset() { since = 0; },
  };
}
