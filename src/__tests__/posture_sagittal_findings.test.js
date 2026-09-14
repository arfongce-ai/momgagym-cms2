// [시상면 소견 추가 2026-09-14] postureMath.js의 classifySagittalTilt(골반 전방경사
// 의심 — 체간 pitch)와 classifyKyphosis(흉추 후만 경향 — 귀-어깨-골반 각)가
// evaluatePostureRules()의 findings에 정상 반영되는지 검증한다. 두 함수 모두
// 기존에 이미 계산만 되고(estimate3DRotation.pitchDeg, kyphosisProxyDeg) 소견으로
// 연결되지 않았던 값을 재사용한 것이라, "값 계산"보다는 "임계값 판정·라벨링이
// 올바른지"에 초점을 둔다.
import { describe, it, expect } from 'vitest';
import {
  classifySagittalTilt, classifyKyphosis, evaluatePostureRules, POSTURE_STATUS,
} from '../ai-measure/core/postureMath.js';

// 어깨(11,12) y=0.3, 골반(23,24) y=0.6 — dy=0.3 고정. z차이(dz)를 바꿔 pitch를 조절한다.
// pitch = atan2(dz, dy) → dz = dy*tan(pitchDeg).
function pitchFrame(pitchDeg) {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const dz = 0.3 * Math.tan((pitchDeg * Math.PI) / 180);
  a[11] = { x: 0.4, y: 0.3, z: 0, visibility: 0.9 };
  a[12] = { x: 0.6, y: 0.3, z: 0, visibility: 0.9 };
  a[23] = { x: 0.45, y: 0.6, z: dz, visibility: 0.9 };
  a[24] = { x: 0.55, y: 0.6, z: dz, visibility: 0.9 };
  return a;
}

// 귀(7,8)=어깨 바로 위(dx=0)면 귀-어깨-골반 각이 180°(정상). ear를 dx만큼 앞으로
// 밀면 그만큼 각이 180°에서 벗어난다(거북목·흉추후만 경향).
function kyphosisFrame(earDx) {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  a[7] = { x: 0.5 + earDx, y: 0.2, z: 0, visibility: 0.9 };
  a[8] = { x: 0.5 + earDx, y: 0.2, z: 0, visibility: 0.9 };
  a[11] = { x: 0.5, y: 0.3, z: 0, visibility: 0.9 };
  a[12] = { x: 0.5, y: 0.3, z: 0, visibility: 0.9 };
  a[23] = { x: 0.5, y: 0.6, z: 0, visibility: 0.9 };
  a[24] = { x: 0.5, y: 0.6, z: 0, visibility: 0.9 };
  return a;
}

describe('classifySagittalTilt (골반 전방경사 의심 — 체간 pitch 재사용)', () => {
  it('pitch ~0° → normal', () => {
    const f = classifySagittalTilt(pitchFrame(0));
    expect(f.status).toBe(POSTURE_STATUS.NORMAL);
  });
  it('pitch ~10° → caution', () => {
    const f = classifySagittalTilt(pitchFrame(10));
    expect(f.status).toBe(POSTURE_STATUS.CAUTION);
    expect(f.key).toBe('sagittal_tilt');
  });
  it('pitch ~20° → risk', () => {
    const f = classifySagittalTilt(pitchFrame(20));
    expect(f.status).toBe(POSTURE_STATUS.RISK);
  });
});

describe('classifyKyphosis (흉추 후만 경향 — 귀-어깨-골반 각 재사용)', () => {
  it('ear directly above shoulder (180°) → normal', () => {
    const f = classifyKyphosis(kyphosisFrame(0));
    expect(f.status).toBe(POSTURE_STATUS.NORMAL);
  });
  it('ear forward ~18° deviation → caution', () => {
    const f = classifyKyphosis(kyphosisFrame(0.033));
    expect(f.status).toBe(POSTURE_STATUS.CAUTION);
    expect(f.key).toBe('kyphosis');
  });
  it('ear forward ~30° deviation → risk', () => {
    const f = classifyKyphosis(kyphosisFrame(0.058));
    expect(f.status).toBe(POSTURE_STATUS.RISK);
  });
});

describe('evaluatePostureRules — 새 시상면 소견이 findings 배열에 반영된다', () => {
  it('both anterior-tilt and kyphosis findings surface together when both deviate', () => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    // pitch ~20°(위험) 골반/체간
    const dz = 0.3 * Math.tan((20 * Math.PI) / 180);
    a[11] = { x: 0.45, y: 0.3, z: 0, visibility: 0.9 };
    a[12] = { x: 0.55, y: 0.3, z: 0, visibility: 0.9 };
    a[23] = { x: 0.45, y: 0.6, z: dz, visibility: 0.9 };
    a[24] = { x: 0.55, y: 0.6, z: dz, visibility: 0.9 };
    // 귀 전방 이동(흉추후만 경향)
    a[7] = { x: 0.58, y: 0.2, z: 0, visibility: 0.9 };
    a[8] = { x: 0.58, y: 0.2, z: 0, visibility: 0.9 };
    // 무릎/발목은 정상 정렬(하지 정렬 finding이 섞여 들어오지 않도록)
    a[25] = { x: 0.45, y: 0.75, visibility: 0.9 }; a[26] = { x: 0.55, y: 0.75, visibility: 0.9 };
    a[27] = { x: 0.45, y: 0.9, visibility: 0.9 }; a[28] = { x: 0.55, y: 0.9, visibility: 0.9 };

    const rules = evaluatePostureRules(a);
    const keys = rules.findings.map((f) => f.key);
    expect(keys).toContain('sagittal_tilt');
    expect(keys).toContain('kyphosis');
    expect(rules.status).toBe(POSTURE_STATUS.RISK);
  });
});
