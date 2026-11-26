// 교재 6장 엉덩관절 반영 — 고관절 서서 벌림(정면) + 센서 안내 데이터
import { describe, it, expect } from 'vitest';
import { LM, ROM_NORMS, jointAngleByMode, RomAccumulator } from '../ai-measure/core/bodyMechanics';
import { getSensorJointTip } from '../ai-measure/core/sensorJointTips';
import { generateRomDiagnosis } from '../ai-measure/core/romClinical';

// 정면: 왼쪽 골반 (0.42,0.6) 오른쪽 골반 (0.58,0.6). 오른다리를 수직 아래에서 deg만큼 옆(+) 또는 안쪽(-)으로.
const mk = (deg) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  lm[LM.LEFT_SHOULDER] = { x: 0.4, y: 0.3, z: 0, visibility: 0.99 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.6, y: 0.3, z: 0, visibility: 0.99 };
  lm[LM.LEFT_HIP] = { x: 0.42, y: 0.6, z: 0, visibility: 0.99 };
  lm[LM.RIGHT_HIP] = { x: 0.58, y: 0.6, z: 0, visibility: 0.99 };
  const r = (deg * Math.PI) / 180;
  lm[LM.RIGHT_KNEE] = { x: 0.58 + 0.25 * Math.sin(r), y: 0.6 + 0.25 * Math.cos(r), z: 0, visibility: 0.99 };
  lm[LM.LEFT_KNEE] = { x: 0.42 - 0.25 * Math.sin(r), y: 0.6 + 0.25 * Math.cos(r), z: 0, visibility: 0.99 };
  return lm;
};

describe('고관절 서서 벌림(ABDUCTION)', () => {
  it('다리 내림=0°, 바깥으로 들면 +각', () => {
    for (const a of [0, 20, 45]) {
      for (const side of ['left', 'right']) {
        const got = jointAngleByMode(mk(a), 'HIP', side, 'ABDUCTION').angle;
        expect(Math.abs(got - a)).toBeLessThan(1);
      }
    }
  });
  it('안쪽(모음)은 음수로 구분된다', () => {
    const got = jointAngleByMode(mk(-20), 'HIP', 'right', 'ABDUCTION').angle;
    expect(got).toBeLessThan(-15);
  });
  it('반대쪽 골반이 안 보이면 각도를 내지 않는다', () => {
    const lm = mk(30);
    lm[LM.LEFT_HIP] = { x: 0.42, y: 0.6, z: 0, visibility: 0.05 };
    expect(jointAngleByMode(lm, 'HIP', 'right', 'ABDUCTION').angle).toBeNull();
  });
  it('기준은 교재 벌림 45°, 누적기 요약에 정면 판정이 적용된다', () => {
    expect(ROM_NORMS.HIP.ABDUCTION.abduction.normal).toBe(45);
    const acc = new RomAccumulator({ joint: 'HIP', poseMode: 'ABDUCTION' });
    for (let i = 0; i < 40; i++) acc.push(mk(22 + 22 * Math.sin(i / 4)), i * 100);
    const s = acc.summary();
    expect(s.right_max_rom).toBeGreaterThan(38);
    expect(s.stability.view.ok).toBe(true);
    const dx = generateRomDiagnosis(s, { joint: 'HIP', poseMode: 'ABDUCTION' });
    expect(dx.headline).toContain('서서 벌림');
  });
});

describe('센서 안내 — 고관절(교재 6장)', () => {
  it('굴곡·벌림·돌림·PSLR 안내와 교재 수치가 있다', () => {
    const tip = getSensorJointTip('HIP');
    expect(tip.blocks.length).toBe(4);
    const all = JSON.stringify(tip);
    for (const n of ['120°', '30°', '45°', '80°']) expect(all).toContain(n);
  });
  it('누운 벌림은 센서로 못 잰다고 정직하게 안내한다', () => {
    const b = getSensorJointTip('HIP').blocks.find((x) => x.title.includes('벌림'));
    expect(b.mount).toContain('수직');
  });
  it('안내가 없는 관절은 null(기존 화면과 동일)', () => {
    expect(getSensorJointTip('KNEE')).toBeNull();
  });
});
