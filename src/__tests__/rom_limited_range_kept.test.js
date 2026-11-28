import { describe, it, expect } from 'vitest';
import { RomAccumulator, LM } from '../ai-measure/core/bodyMechanics';
const V = 0.99;
const P = (x, y) => ({ x, y, z: 0, visibility: V });
const rad = (d) => (d * Math.PI) / 180;
function shoulderPose(d) {
  const l = Array.from({ length: 33 }, () => P(0.5, 0.5));
  for (const s of ['LEFT', 'RIGHT']) { const dx = s === 'LEFT' ? 0 : 0.02;
    l[LM[s + '_SHOULDER']] = P(0.5 + dx, 0.2); l[LM[s + '_HIP']] = P(0.5 + dx, 0.5);
    l[LM[s + '_ELBOW']] = P(0.5 + dx + 0.15 * Math.sin(rad(d)), 0.2 + 0.15 * Math.cos(rad(d)));
    l[LM[s + '_WRIST']] = P(0.5 + dx + 0.3 * Math.sin(rad(d)), 0.2 + 0.3 * Math.cos(rad(d))); }
  return l;
}
describe('가동범위가 제한된 회원도 결과가 나온다', () => {
  it('어깨를 90°까지만 올려도 값이 기록된다', () => {
    const acc = new RomAccumulator({ joint: 'SHOULDER', poseMode: 'STANDING' }); let t = 0;
    for (let r = 0; r < 3; r++) { for (let d = 0; d <= 90; d += 3) acc.push(shoulderPose(d), (t += 33)); for (let d = 90; d >= 0; d -= 3) acc.push(shoulderPose(d), (t += 33)); }
    const s = acc.summary();
    expect(s.left_max_rom).toBeGreaterThan(80);
    expect(s.left_max_rom).toBeLessThan(95);
  });
});
