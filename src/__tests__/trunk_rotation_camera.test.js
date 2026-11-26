import { describe, it, expect } from 'vitest';
import { jointAngleByMode, jointMinVisibility, RomAccumulator, LM } from '../ai-measure/core/bodyMechanics';
const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
// 정면 촬영: 어깨선을 shDeg, 골반선을 hipDeg 만큼 (사람의 왼쪽으로) 돌린 자세
function rotated(shDeg, hipDeg = 0) {
  const lm = blank();
  const put = (l, r, hw, y, deg) => {
    const t = (deg * Math.PI) / 180;
    lm[l] = { x: 0.5 + hw * Math.cos(t), y, z: hw * Math.sin(t), visibility: 0.99 };
    lm[r] = { x: 0.5 - hw * Math.cos(t), y, z: -hw * Math.sin(t), visibility: 0.99 };
  };
  put(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, 0.1, 0.35, shDeg);
  put(LM.LEFT_HIP, LM.RIGHT_HIP, 0.08, 0.6, hipDeg);
  return lm;
}
describe('몸통 돌림(카메라, 정면)', () => {
  it('정면이면 0°', () => {
    expect(jointAngleByMode(rotated(0), 'TRUNK', 'left', 'T_ROTATION').angle).toBeCloseTo(0, 0);
  });
  it('어깨를 왼쪽으로 30° → 왼쪽 +30, 오른쪽 −30', () => {
    expect(jointAngleByMode(rotated(30), 'TRUNK', 'left', 'T_ROTATION').angle).toBeCloseTo(30, 0);
    expect(jointAngleByMode(rotated(30), 'TRUNK', 'right', 'T_ROTATION').angle).toBeCloseTo(-30, 0);
  });
  it('카메라가 비껴 어깨·골반이 같이 20° 돌아 보여도 상체 돌림은 0°', () => {
    expect(jointAngleByMode(rotated(20, 20), 'TRUNK', 'left', 'T_ROTATION').angle).toBeCloseTo(0, 0);
  });
  it('골반은 10° 돌고 어깨가 50° → 상대 돌림 40°', () => {
    expect(jointAngleByMode(rotated(50, 10), 'TRUNK', 'left', 'T_ROTATION').angle).toBeCloseTo(40, 0);
  });
  it('점이 가려지면 null, 가시성은 어깨·고관절 4점', () => {
    const lm = rotated(10); lm[LM.RIGHT_HIP] = null;
    expect(jointAngleByMode(lm, 'TRUNK', 'left', 'T_ROTATION').angle).toBeNull();
    expect(jointMinVisibility(lm, 'TRUNK', 'left', 'T_ROTATION')).toBeNull();
    expect(jointMinVisibility(rotated(10), 'TRUNK', 'left', 'T_ROTATION')).toBeGreaterThan(0.9);
  });
  it('누적기: 시작 0점 보정(처음에 5° 치우쳐 있어도) 후 40° 돌리면 왼쪽 최대 ≈ 40', () => {
    const acc = new RomAccumulator({ joint: 'TRUNK', poseMode: 'T_ROTATION' });
    let t = 0;
    for (let i = 0; i < 12; i++) acc.push(rotated(5), (t += 33));
    for (let d = 5; d <= 45; d += 2) { for (let k = 0; k < 3; k++) acc.push(rotated(d), (t += 33)); }
    for (let k = 0; k < 12; k++) acc.push(rotated(45), (t += 33));
    const s = acc.summary();
    expect(s.left_max_rom).toBeGreaterThan(34);
    expect(s.left_max_rom).toBeLessThan(46);
  });
});
