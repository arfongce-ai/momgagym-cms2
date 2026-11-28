import { describe, expect, it } from 'vitest';
import { createStepCycleCounter, hipHeightSignal } from '../ai-measure/core/stepCycleCounter';

const pose = (hipY) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  lm[11] = { x: 0.5, y: hipY - 0.25, visibility: 0.9 }; lm[12] = { ...lm[11] };
  lm[23] = { x: 0.5, y: hipY, visibility: 0.9 }; lm[24] = { ...lm[23] };
  return lm;
};
describe('스텝 사이클 카운터', () => {
  it('몸이 안 잡히면 신호도 카운트도 없다', () => {
    expect(hipHeightSignal(null)).toBe(null);
    const c = createStepCycleCounter();
    expect(c.push(Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 })), 0).tracked).toBe(false);
  });
  it('골반이 2.5초 주기로 오르내리면 사이클을 센다(15초 ≈ 6회)', () => {
    const c = createStepCycleCounter();
    let snap;
    for (let t = 0; t <= 15000; t += 100) {
      const hipY = 0.6 - 0.09 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 2500)); // 0.51~0.60 (몸통 0.25 대비 폭 0.36)
      snap = c.push(pose(hipY), t);
    }
    expect(snap.count).toBeGreaterThanOrEqual(5);
    expect(snap.count).toBeLessThanOrEqual(7);
  });
  it('움직임 폭이 작으면(서 있기) 세지 않는다', () => {
    const c = createStepCycleCounter();
    let snap;
    for (let t = 0; t <= 10000; t += 100) snap = c.push(pose(0.6 + 0.004 * Math.sin(t / 300)), t);
    expect(snap.count).toBe(0);
  });
});
