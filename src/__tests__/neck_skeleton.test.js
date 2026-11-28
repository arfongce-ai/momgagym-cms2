import { describe, it, expect } from 'vitest';
import { jointAngleByMode, RomAccumulator, ROM_NORMS, LM } from '../ai-measure/core/bodyMechanics';

const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
// 정면 머리: 귀 두 개, 코, 어깨. tiltDeg>0 이면 머리를 사람의 왼쪽(화면 오른쪽 아래)으로 기울임
function front({ tilt = 0, noseOff = 0 } = {}) {
  const lm = blank();
  const t = (tilt * Math.PI) / 180;
  const cx = 0.5, cy = 0.3, r = 0.08; // 귀 간격 반
  // 사람의 왼쪽 귀는 화면 오른쪽
  lm[LM.LEFT_EAR] = { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), visibility: 0.99 };
  lm[LM.RIGHT_EAR] = { x: cx - r * Math.cos(t), y: cy - r * Math.sin(t), visibility: 0.99 };
  lm[LM.NOSE] = { x: cx + noseOff * r, y: cy + 0.05, visibility: 0.99 };
  lm[LM.LEFT_SHOULDER] = { x: 0.7, y: 0.5, visibility: 0.99 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.3, y: 0.5, visibility: 0.99 };
  return lm;
}
function side(pitchDeg) {
  const lm = blank();
  const p = (pitchDeg * Math.PI) / 180;
  lm[LM.RIGHT_EAR] = { x: 0.5, y: 0.3, visibility: 0.99 };
  lm[LM.LEFT_EAR] = { x: 0.5, y: 0.3, visibility: 0.2 };
  lm[LM.NOSE] = { x: 0.5 + 0.1 * Math.cos(p), y: 0.3 + 0.1 * Math.sin(p), visibility: 0.99 };
  return lm;
}

describe('목 스켈레톤 측정', () => {
  it('중립 정면 → 가쪽 굽힘 0, 돌림 0', () => {
    expect(jointAngleByMode(front(), 'NECK', 'left', 'LATERAL').angle).toBeCloseTo(0, 0);
    expect(jointAngleByMode(front(), 'NECK', 'left', 'ROTATION').angle).toBeCloseTo(0, 0);
  });
  it('머리 기울임 30° → 한쪽만 +30', () => {
    const lm = front({ tilt: 30 });
    const a = jointAngleByMode(lm, 'NECK', 'left', 'LATERAL').angle;
    const b = jointAngleByMode(lm, 'NECK', 'right', 'LATERAL').angle;
    expect(Math.abs(a)).toBeCloseTo(30, 0);
    expect(a).toBeCloseTo(-b, 0);
  });
  it('코가 귀 중점에서 벗어나면 돌림 각 (offset 0.5 → 30°)', () => {
    const a = Math.abs(jointAngleByMode(front({ noseOff: 0.5 }), 'NECK', 'left', 'ROTATION').angle);
    expect(a).toBeCloseTo(30, 0);
  });
  it('귀가 안 보이면 각도를 내지 않음(null)', () => {
    const lm = front({ tilt: 20 }); lm[LM.LEFT_EAR] = null;
    expect(jointAngleByMode(lm, 'NECK', 'left', 'LATERAL').angle).toBeNull();
  });
  it('굽힘: 시작 구간을 0점으로 삼아 숙인 만큼만 나옴', () => {
    const acc = new RomAccumulator({ joint: 'NECK', poseMode: 'FLEXION' });
    let t = 0;
    for (let i = 0; i < 12; i++) acc.push(side(15), (t += 33)); // 중립 자세 귀→코가 15° 아래여도 0점
    for (let d = 15; d <= 60; d += 3) acc.push(side(d), (t += 33)); // 45° 더 숙임
    for (let i = 0; i < 10; i++) acc.push(side(60), (t += 33));
    const s = acc.summary();
    expect(s.right_max_rom).not.toBeNull();
    expect(Math.abs(s.right_max_rom - 45)).toBeLessThan(6);
  });
  it('정상치 등록', () => {
    expect(ROM_NORMS.NECK.FLEXION.flexion.normal).toBe(50);
    expect(ROM_NORMS.NECK.LATERAL.lateral_flexion.normal).toBe(45);
  });
});
