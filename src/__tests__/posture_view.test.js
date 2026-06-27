import { describe, expect, it } from 'vitest';
import {
  POSE_LANDMARKS as LM,
  detectPostureView,
  PostureViewVoter,
} from '../ai-measure/core/postureMath';

// 정면 기준 포즈: 어깨가 넓게 펼쳐지고(좌 0.42 < 우 0.58) 얼굴 가시성 높음.
function frontPose(overrides = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  Object.assign(pose[LM.NOSE], { x: 0.5, y: 0.08, visibility: 0.98 });
  Object.assign(pose[LM.LEFT_EYE], { x: 0.47, y: 0.07, visibility: 0.95 });
  Object.assign(pose[LM.RIGHT_EYE], { x: 0.53, y: 0.07, visibility: 0.95 });
  Object.assign(pose[LM.LEFT_EAR], { x: 0.45, y: 0.1, visibility: 0.9 });
  Object.assign(pose[LM.RIGHT_EAR], { x: 0.55, y: 0.1, visibility: 0.9 });
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.42, y: 0.25, z: 0 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.58, y: 0.25, z: 0 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.43, y: 0.52, z: 0 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.57, y: 0.52, z: 0 });
  for (const [index, value] of Object.entries(overrides)) {
    Object.assign(pose[Number(index)], value);
  }
  return pose;
}

// 후면: 정면에서 좌우 어깨 x를 뒤집고(좌 0.58 > 우 0.42) 얼굴 가시성 낮춤.
function backPose() {
  const pose = frontPose();
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.58 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.42 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.57 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.43 });
  [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_EAR, LM.RIGHT_EAR].forEach((i) => {
    pose[i].visibility = 0.15;
  });
  return pose;
}

// 측면: 어깨 x가 거의 겹침(좁은 폭). 코 위치로 좌/우 구분.
function sidePose(noseX) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.5, y: 0.25 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.505, y: 0.25 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.5, y: 0.52 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.505, y: 0.52 });
  Object.assign(pose[LM.NOSE], { x: noseX, y: 0.08, visibility: 0.9 });
  return pose;
}

describe('detectPostureView', () => {
  it('정면을 front 로 판별한다', () => {
    const r = detectPostureView(frontPose());
    expect(r.view).toBe('front');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('후면을 back 으로 판별한다', () => {
    const r = detectPostureView(backPose());
    expect(r.view).toBe('back');
  });

  it('어깨 x부호가 정면형이어도 코·눈이 가려지면 후면으로 판별한다 (실측 회귀)', () => {
    // BlazePose 는 뒤돌아도 해부학 좌/우 어깨를 출력 → 어깨 부호가 정면과 같을 수 있음.
    // 이때 얼굴(코·눈) 가시성이 낮으면 반드시 후면이어야 한다.
    const pose = frontPose(); // 어깨/엉덩이 x 는 정면 배치 그대로 둠
    [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE].forEach((i) => { pose[i].visibility = 0.1; });
    const r = detectPostureView(pose);
    expect(r.view).toBe('back');
  });

  it('어깨가 좁으면 측면으로 판별한다', () => {
    const r = detectPostureView(sidePose(0.7));
    expect(['left', 'right']).toContain(r.view);
  });

  it('코가 어깨중심 오른쪽이면 좌측면(left)', () => {
    expect(detectPostureView(sidePose(0.72)).view).toBe('left');
  });

  it('코가 어깨중심 왼쪽이면 우측면(right)', () => {
    expect(detectPostureView(sidePose(0.28)).view).toBe('right');
  });

  it('랜드마크가 없으면 unknown', () => {
    expect(detectPostureView(null).view).toBe('unknown');
    expect(detectPostureView([]).view).toBe('unknown');
  });
});

describe('PostureViewVoter', () => {
  it('표본이 부족하면 isStable=false', () => {
    const v = new PostureViewVoter({ window: 12 });
    v.push('front'); v.push('front');
    expect(v.isStable('front', { minRatio: 0.7, minFrames: 8 })).toBe(false);
  });

  it('동일 면이 다수면 안정 판정', () => {
    const v = new PostureViewVoter({ window: 12 });
    for (let i = 0; i < 10; i++) v.push('front');
    expect(v.isStable('front', { minRatio: 0.7, minFrames: 8 })).toBe(true);
    expect(v.majority().view).toBe('front');
  });

  it('다른 면이 섞여 비율이 낮으면 불안정', () => {
    const v = new PostureViewVoter({ window: 12 });
    for (let i = 0; i < 5; i++) v.push('front');
    for (let i = 0; i < 5; i++) v.push('right');
    expect(v.isStable('front', { minRatio: 0.7, minFrames: 8 })).toBe(false);
  });

  it('reset 후 버퍼가 비워진다', () => {
    const v = new PostureViewVoter();
    for (let i = 0; i < 5; i++) v.push('back');
    v.reset();
    expect(v.majority().view).toBe('unknown');
  });
});
