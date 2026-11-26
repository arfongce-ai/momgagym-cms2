import { describe, it, expect } from 'vitest';
import { romDisplayAngle, romRefRange } from '../ai-measure/core/romMovementGuide';
describe('ROM 오버레이 값', () => {
  it('무릎·팔꿈치는 내각을 굽힘각으로 바꾼다', () => {
    expect(romDisplayAngle('KNEE', 170)).toBe(10);
    expect(romDisplayAngle('ELBOW', 40)).toBe(140);
    expect(romDisplayAngle('SHOULDER', 90)).toBe(90);
    expect(romDisplayAngle('HIP', null)).toBeNull();
  });
  it('기준 범위: 있는 관절은 normal/min/max, 몸통은 null', () => {
    expect(romRefRange('ANKLE', 'SEATED').normal).toBe(20);
    expect(romRefRange('KNEE', 'STANDING').normal).toBe(135);
    expect(romRefRange('TRUNK', 'T_FLEXION')).toBeNull();
  });
});
