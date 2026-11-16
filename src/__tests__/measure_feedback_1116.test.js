import { describe, it, expect } from 'vitest';
import { sessionRows } from '../components/report/SessionDataSheet';
import { AUTO_CAPTURE, isBodyStill, createHoldTimer } from '../ai-measure/core/postureAutoCapture';

describe('SessionDataSheet.sessionRows (결과 열람 2026-11-16)', () => {
  it('숫자·짧은 문자만 남기고 좌표·시계열·사진은 뺀다', () => {
    const rows = sessionRows({ oneRM: 82.5, liftLabel: '스쿼트', landmarks: [{ x: 1 }], series: [1, 2, 3], snapshotUrl: 'data:image/jpeg;base64,xx', nested: { score: 77 } });
    const keys = rows.map((r) => r[0]);
    expect(keys).toEqual(expect.arrayContaining(['oneRM', 'liftLabel', 'nested.score']));
    expect(keys).not.toContain('landmarks');
    expect(keys).not.toContain('series');
    expect(keys).not.toContain('snapshotUrl');
  });
  it('빈 데이터도 안전', () => { expect(sessionRows(null)).toEqual([]); });
});

describe('postureAutoCapture (카운트 늦추기 2026-11-16)', () => {
  const lm = (dx = 0) => { const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 })); a[11] = { x: 0.4 + dx, y: 0.3 }; a[12] = { x: 0.6 + dx, y: 0.3 }; a[23] = { x: 0.43 + dx, y: 0.55 }; a[24] = { x: 0.57 + dx, y: 0.55 }; return a; };
  const frames = (n, step, dxFn) => Array.from({ length: n }, (_, i) => ({ landmarks: lm(dxFn(i)), ts: i * step }));
  it('가만히 있으면 멈춤', () => { const b = frames(40, 33, () => 0); expect(isBodyStill(b, b.at(-1).ts)).toBe(true); });
  it('돌아서는 중(계속 이동)이면 멈춤 아님', () => { const b = frames(40, 33, (i) => i * 0.01); expect(isBodyStill(b, b.at(-1).ts)).toBe(false); });
  it('프레임이 모자라면 멈춤 아님', () => { const b = frames(3, 33, () => 0); expect(isBodyStill(b, b.at(-1).ts)).toBe(false); });
  it('유지 타이머는 2초 연속이어야 ready, 끊기면 리셋', () => {
    const t = createHoldTimer(AUTO_CAPTURE.stableHoldMs);
    expect(t.update(true, 0).ready).toBe(false);
    expect(t.update(true, 1900).ready).toBe(false);
    expect(t.update(false, 2000).ready).toBe(false);
    expect(t.update(true, 2100).ready).toBe(false);
    expect(t.update(true, 4200).ready).toBe(true);
  });
});

// [2026-11-16] 최소 촬영 거리 · 측면 인식
import { assessFraming, fillMinForDistanceMm, MIN_CAMERA_DISTANCE_MM } from '../ai-measure/core/framingGuide';
import { detectPostureView, aspectCorrectLandmarks, isSideLikePose } from '../ai-measure/core/postureMath';
describe('최소 촬영 거리', () => {
  it('자세·한발서기 1,800mm / 바벨 3,200mm', () => {
    expect(MIN_CAMERA_DISTANCE_MM.posture).toBe(1800);
    expect(MIN_CAMERA_DISTANCE_MM.stance).toBe(1800);
    expect(MIN_CAMERA_DISTANCE_MM.lifting).toBe(3200);
  });
  it('가까운 최소거리일수록 요구 비율이 높고, 3.2m는 낮아 바벨 거리에서 멀다고 안 나온다', () => {
    expect(fillMinForDistanceMm(1800)).toBeGreaterThan(fillMinForDistanceMm(3200));
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
    lm[0] = { x: 0.5, y: 0.3, visibility: 1 }; lm[27] = { x: 0.48, y: 0.68, visibility: 1 }; lm[28] = { x: 0.52, y: 0.68, visibility: 1 };
    lm[11] = { x: 0.45, y: 0.4, visibility: 1 }; lm[12] = { x: 0.55, y: 0.4, visibility: 1 };
    expect(assessFraming(lm, { minDistanceMm: 3200 }).message).not.toContain('멉니다'); // 사람 38% 차지
    // 1.8m 기준에서도 사람 38%(≈2.4m 거리)는 홍보용으로 허용 — 최소거리는 하한일 뿐
    expect(assessFraming(lm, { minDistanceMm: 1800 }).message).not.toContain('멀어');
    // 사람이 아주 작아지면(약 4m 이상) 그때만 멀다고 알린다
    const far = lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.4, y: 0.5 + (p.y - 0.5) * 0.4 }));
    expect(assessFraming(far, { minDistanceMm: 1800 }).message).toContain('멀어');
  });
});
describe('옆모습 인식', () => {
  it('어깨폭이 좁고 얼굴이 또렷해도(코 이탈 20%) 측면으로 본다', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    lm[11] = { x: 0.50, y: 0.40, z: -0.1, visibility: 1 }; lm[12] = { x: 0.52, y: 0.40, z: 0.1, visibility: 1 };
    lm[23] = { x: 0.50, y: 0.65, z: -0.05, visibility: 1 }; lm[24] = { x: 0.52, y: 0.65, z: 0.05, visibility: 1 };
    lm[0] = { x: 0.56, y: 0.30, z: -0.1, visibility: 1 }; // 코가 몸통높이의 약 20% 앞
    const r = detectPostureView(lm);
    expect(['left', 'right']).toContain(r.view);
  });
});

describe('가로 웹캠(PC 키오스크) 옆모습 인식', () => {
  // 폰 세로 기준 코 이탈 0.20 인 옆모습을 16:9 가로 프레임에선 x 가 0.5625배로 줄어든 값으로 본다.
  const side = (k) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    const x = (v) => 0.5 + (v - 0.5) * k;
    lm[11] = { x: x(0.50), y: 0.40, z: -0.1, visibility: 1 }; lm[12] = { x: x(0.52), y: 0.40, z: 0.1, visibility: 1 };
    lm[23] = { x: x(0.50), y: 0.65, z: -0.05, visibility: 1 }; lm[24] = { x: x(0.52), y: 0.65, z: 0.05, visibility: 1 };
    lm[0] = { x: x(0.56), y: 0.30, z: -0.1, visibility: 1 };
    return lm;
  };
  it('보정 없이는 정면으로 오판, 보정하면 측면', () => {
    const wide = side(0.5625 / 1);
    expect(['front', 'back']).toContain(detectPostureView(wide).view);
    expect(['left', 'right']).toContain(detectPostureView(aspectCorrectLandmarks(wide, 16 / 9)).view);
  });
  it('폰 세로(9:16)는 보정 없음', () => {
    const lm = side(1);
    expect(aspectCorrectLandmarks(lm, 9 / 16)).toBe(lm);
  });
});

describe('측면 너그러운 판정(isSideLikePose)', () => {
  // 실제 길이 기준으로 만든 자세를 화면(폭/높이=aspect) 좌표로 옮긴다. trunk = 화면 높이의 20%
  const pose = (rotDegFromFront, aspect) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    const half = (0.68 * 0.2 * Math.cos((rotDegFromFront * Math.PI) / 180)) / 2 / aspect; // 어깨폭 = 몸통의 68%
    lm[11] = { x: 0.5 + half, y: 0.4, z: 0, visibility: 1 }; lm[12] = { x: 0.5 - half, y: 0.4, z: 0, visibility: 1 };
    lm[23] = { x: 0.5 + half * 0.5, y: 0.6, z: 0, visibility: 1 }; lm[24] = { x: 0.5 - half * 0.5, y: 0.6, z: 0, visibility: 1 };
    return lm;
  };
  it('폰 세로·PC 가로 모두: 옆모습에서 20° 덜 돌아도 측면, 정면·45°는 측면 아님', () => {
    [9 / 16, 16 / 9, 4 / 3].forEach((a) => {
      expect(isSideLikePose(pose(90, a), a)).toBe(true);
      expect(isSideLikePose(pose(70, a), a)).toBe(true);
      expect(isSideLikePose(pose(45, a), a)).toBe(false);
      expect(isSideLikePose(pose(0, a), a)).toBe(false);
    });
  });
  it('예전 기준은 70°(옆에서 20° 덜 돈 자세)를 정면으로 봤다 — 회귀 확인용', () => {
    expect(['front', 'back', 'unknown']).toContain(detectPostureView(pose(70, 9 / 16)).view);
  });
  it('반대쪽 어깨가 가려져도 측면', () => {
    const lm = pose(0, 9 / 16); lm[12] = { ...lm[12], visibility: 0.05 };
    expect(isSideLikePose(lm, 9 / 16)).toBe(true);
  });
});
