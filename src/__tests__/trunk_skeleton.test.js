import { describe, it, expect } from 'vitest';
import { jointAngleByMode, jointMinVisibility, ROM_NORMS, LM } from '../ai-measure/core/bodyMechanics';
import { getSensorJointTip } from '../ai-measure/core/sensorJointTips';
const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
function sideLean(deg, faceRight = true) {
  const lm = blank(); const t = (deg * Math.PI) / 180; const L = 0.3; const f = faceRight ? 1 : -1;
  lm[LM.RIGHT_HIP] = { x: 0.5, y: 0.6, visibility: 0.99 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.5 + f * L * Math.sin(t), y: 0.6 - L * Math.cos(t), visibility: 0.99 };
  lm[LM.NOSE] = { x: 0.5 + f * 0.2, y: 0.25, visibility: 0.99 };
  return lm;
}
function frontLean(deg) {
  const lm = blank(); const t = (deg * Math.PI) / 180; const L = 0.3;
  const sx = 0.5 + L * Math.sin(t), sy = 0.6 - L * Math.cos(t);
  lm[LM.LEFT_SHOULDER] = { x: sx + 0.1, y: sy, visibility: 0.99 }; lm[LM.RIGHT_SHOULDER] = { x: sx - 0.1, y: sy, visibility: 0.99 };
  lm[LM.LEFT_HIP] = { x: 0.55, y: 0.6, visibility: 0.99 }; lm[LM.RIGHT_HIP] = { x: 0.45, y: 0.6, visibility: 0.99 };
  return lm;
}
describe('몸통 스켈레톤 측정', () => {
  it('곧게 서면 0°', () => {
    expect(jointAngleByMode(sideLean(0), 'TRUNK', 'right', 'T_FLEXION').angle).toBeCloseTo(0, 0);
    expect(jointAngleByMode(frontLean(0), 'TRUNK', 'left', 'T_LATERAL').angle).toBeCloseTo(0, 0);
  });
  it('앞으로 40° 숙임 → 굽힘 +40, 폄 모드는 −40 (얼굴 방향 무관)', () => {
    expect(jointAngleByMode(sideLean(40, true), 'TRUNK', 'right', 'T_FLEXION').angle).toBeCloseTo(40, 0);
    expect(jointAngleByMode(sideLean(40, false), 'TRUNK', 'right', 'T_FLEXION').angle).toBeCloseTo(40, 0);
    expect(jointAngleByMode(sideLean(40), 'TRUNK', 'right', 'T_EXTENSION').angle).toBeCloseTo(-40, 0);
  });
  it('옆으로 20° → 좌/우 부호 반대', () => {
    const a = jointAngleByMode(frontLean(20), 'TRUNK', 'left', 'T_LATERAL').angle;
    const b = jointAngleByMode(frontLean(20), 'TRUNK', 'right', 'T_LATERAL').angle;
    expect(Math.abs(a)).toBeCloseTo(20, 0); expect(a).toBeCloseTo(-b, 0);
  });
  it('랜드마크 없으면 null, 기준값 없음(각도만)', () => {
    const lm = sideLean(10); lm[LM.NOSE] = null;
    expect(jointAngleByMode(lm, 'TRUNK', 'right', 'T_FLEXION').angle).toBeNull();
    expect(jointMinVisibility(lm, 'TRUNK', 'right', 'T_FLEXION')).toBeNull();
    expect(ROM_NORMS.TRUNK).toBeUndefined();
  });
  it('센서 안내', () => { expect(getSensorJointTip('TRUNK').blocks.length).toBe(2); });
});
