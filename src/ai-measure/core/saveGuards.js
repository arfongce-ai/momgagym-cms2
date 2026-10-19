// saveGuards.js — 무효·불가능 측정은 저장하지 않는다 (2026-10)
// 점프는 이미 valid !== true 이면 저장을 막는다. 보행·스프린트도 같은 원칙을 적용한다.
// (기존에 저장된 기록은 지우지 않는다. 집계에서만 제외한다.)

export const SPRINT_REACTION_BOUNDS_MS = [50, 2000]; // scripts/measure-topics/core.mjs 의 bounds 와 같다

export function isGaitStorable(data) {
  const v = data?.metrics?.valid ?? data?.valid;
  return v === true;
}

export function isSprintStorable(data) {
  const r = data?.reactionTimeMs;
  if (r == null) return true; // 반응속도를 재지 않은 측정(아질리티 등)
  const n = Number(r);
  return Number.isFinite(n) && n >= SPRINT_REACTION_BOUNDS_MS[0] && n <= SPRINT_REACTION_BOUNDS_MS[1];
}
