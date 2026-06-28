import { describe, expect, it } from 'vitest';
import { analyzeAxialRotation } from '../ai-measure/core/postureRotation';

// 면 analysis 모킹 헬퍼
function view({ shoulderYaw = 0, pelvisYaw = 0, headYaw = 0, lowerYaw = 0 } = {}) {
  return {
    rotations: { segments: { shoulderYawDeg: shoulderYaw, pelvisYawDeg: pelvisYaw } },
    headYawProxyDeg: headYaw,
    lowerYawProxyDeg: lowerYaw,
  };
}

describe('analyzeAxialRotation', () => {
  it('면이 없으면 available=false', () => {
    const r = analyzeAxialRotation({});
    expect(r.available).toBe(false);
  });

  it('정면 어깨/골반 yaw 로 체간·골반 회전을 산출한다', () => {
    const r = analyzeAxialRotation({ front: view({ shoulderYaw: 15, pelvisYaw: 3 }) });
    expect(r.available).toBe(true);
    expect(r.segments.trunk.direction).toBe('right'); // +면 우회전
    expect(r.segments.trunk.level).toBe('marked'); // 15 >= 12
    expect(r.segments.pelvis.level).toBe('none'); // 3 < 6
  });

  it('체간과 골반이 반대로 돌면 축 비틀림 opposing=true', () => {
    const r = analyzeAxialRotation({ front: view({ shoulderYaw: 10, pelvisYaw: -10 }) });
    expect(r.axialTwist).not.toBeNull();
    expect(r.axialTwist.opposing).toBe(true);
    expect(r.axialTwist.absTwist).toBeGreaterThanOrEqual(14);
    expect(r.axialTwist.level).toBe('marked');
  });

  it('면 수가 많을수록 신뢰도가 높다', () => {
    const one = analyzeAxialRotation({ front: view({ shoulderYaw: 8 }) });
    const four = analyzeAxialRotation({
      front: view({ shoulderYaw: 8, pelvisYaw: 6 }),
      back: view({ shoulderYaw: -8, pelvisYaw: -6 }),
      left: view(),
      right: view(),
    });
    expect(four.confidence).toBeGreaterThan(one.confidence);
    expect(four.viewsPresent).toHaveLength(4);
  });

  it('면이 3개 미만이면 보류 안내 note 를 단다', () => {
    const r = analyzeAxialRotation({ front: view({ shoulderYaw: 8 }) });
    expect(r.note).toContain('면이 부족');
  });

  it('후면 yaw 는 부호를 뒤집어 교차검증한다 (정면과 일치 시 신뢰도↑)', () => {
    // 정면 +10, 후면 원본 -10 → negate 후 +10 → 일치
    const r = analyzeAxialRotation({
      front: view({ shoulderYaw: 10, pelvisYaw: 10 }),
      back: view({ shoulderYaw: -10, pelvisYaw: -10 }),
    });
    expect(r.segments.trunk.agreement).toBe(1); // 두 신호 방향 완전 일치
  });
});

describe('yaw 부호 규약 일관성 (회귀 방지)', () => {
  it('머리·어깨·골반·하체 yaw 가 같은 회전에서 동일 부호', async () => {
    const { estimate3DRotation, estimateHeadYawProxy, estimateLowerYawProxy } =
      await import('../ai-measure/core/postureMath');
    // 사람 왼쪽회전: 오른쪽이 카메라 앞(z 음수)
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    lm[11] = { x: 0.42, y: 0.25, z: +0.1, visibility: 0.9 };
    lm[12] = { x: 0.58, y: 0.25, z: -0.1, visibility: 0.9 };
    lm[23] = { x: 0.43, y: 0.52, z: +0.1, visibility: 0.9 };
    lm[24] = { x: 0.57, y: 0.52, z: -0.1, visibility: 0.9 };
    lm[25] = { x: 0.43, y: 0.7, z: +0.1, visibility: 0.9 };
    lm[26] = { x: 0.57, y: 0.7, z: -0.1, visibility: 0.9 };
    lm[27] = { x: 0.43, y: 0.9, z: +0.1, visibility: 0.9 };
    lm[28] = { x: 0.57, y: 0.9, z: -0.1, visibility: 0.9 };
    lm[0] = { x: 0.56, y: 0.08, z: 0, visibility: 0.9 };
    lm[2] = { x: 0.47, y: 0.07, z: 0, visibility: 0.9 };
    lm[5] = { x: 0.53, y: 0.07, z: 0, visibility: 0.9 };
    const rot = estimate3DRotation(lm).segments;
    const head = estimateHeadYawProxy(lm);
    const lower = estimateLowerYawProxy(lm);
    // 모두 왼쪽회전이므로 음수여야 함
    expect(rot.shoulderYawDeg).toBeLessThan(0);
    expect(rot.pelvisYawDeg).toBeLessThan(0);
    expect(head).toBeLessThan(0);
    expect(lower).toBeLessThan(0);
  });
});
