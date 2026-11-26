import { describe, it, expect } from 'vitest';
import { getSensorJointTip } from '../ai-measure/core/sensorJointTips';
import { ROM_NORMS } from '../ai-measure/core/bodyMechanics';
describe('발목 안내', () => {
  it('ANKLE 3블록, 교재 수치(발등 굽힘 20, 발바닥 굽힘 50)', () => {
    const t = getSensorJointTip('ANKLE');
    expect(t.blocks.length).toBe(3);
    expect(t.blocks[0].norms).toContain('20');
    expect(t.blocks[0].norms).toContain('50');
    expect(ROM_NORMS.ANKLE.STANDING.dorsiflexion.normal).toBe(20);
  });
  it('안내 없는 관절은 null', () => { expect(getSensorJointTip('SPINE')).toBeNull(); });
});
