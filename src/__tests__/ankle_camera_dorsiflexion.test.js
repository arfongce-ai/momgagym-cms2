import { describe, it, expect } from 'vitest';
import { jointAngleByMode, RomAccumulator, LM } from '../ai-measure/core/bodyMechanics';
const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
// 옆모습: 무릎 위, 발목 아래, 발끝은 앞(오른쪽). 정강이가 앞으로 기울면(배측굴곡) 무릎이 발끝 쪽으로
function pose(dorsiDeg) {
  const lm = blank();
  const t = (dorsiDeg * Math.PI) / 180;
  const a = { x: 0.5, y: 0.8 };
  lm[LM.LEFT_ANKLE] = { ...a, z: 0, visibility: 0.99 };
  lm[LM.LEFT_KNEE] = { x: 0.5 + 0.3 * Math.sin(t), y: 0.8 - 0.3 * Math.cos(t), z: 0, visibility: 0.99 };
  lm[LM.LEFT_FOOT_INDEX] = { x: 0.6, y: 0.8, z: 0, visibility: 0.99 }; // 발은 수평
  lm[LM.LEFT_SHOULDER] = { x: 0.5, y: 0.2, z: 0, visibility: 0.99 }; lm[LM.RIGHT_SHOULDER] = { x: 0.52, y: 0.2, z: 0, visibility: 0.99 };
  lm[LM.LEFT_HIP] = { x: 0.5, y: 0.5, z: 0, visibility: 0.99 }; lm[LM.RIGHT_HIP] = { x: 0.52, y: 0.5, z: 0, visibility: 0.99 };
  return lm;
}
describe('발목 카메라 배측굴곡', () => {
  it('정강이를 d° 기울이면 각도도 d° (중립 0)', () => {
    for (const d of [0, 10, 20, 30]) expect(jointAngleByMode(pose(d), 'ANKLE', 'left', 'STANDING').angle).toBeCloseTo(d, 0);
  });
  it('3회 반복 요약값이 실제 범위(≈25°) 근처', () => {
    const acc = new RomAccumulator({ joint: 'ANKLE', poseMode: 'STANDING' });
    let t = 0;
    for (let rep = 0; rep < 3; rep++) { for (let d = 0; d <= 25; d += 2) acc.push(pose(d), (t += 33)); for (let d = 25; d >= 0; d -= 2) acc.push(pose(d), (t += 33)); }
    const s = acc.summary();
    expect(s.left_max_rom).toBeGreaterThan(18);
    expect(s.left_max_rom).toBeLessThan(28);
  });
});
