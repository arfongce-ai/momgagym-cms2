import { describe, expect, it } from 'vitest';
import {
  POSE_LANDMARKS as LM,
  detectPostureView,
  PostureViewVoter,
  sanitizeBackLandmarks,
} from '../ai-measure/core/postureMath';

// 정면 기준 포즈: 어깨가 넓게 펼쳐지고(좌 0.42 < 우 0.58), 얼굴 좌우부호 음(-),
// 코가 귀보다 앞(z 작음).
function frontPose(overrides = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  Object.assign(pose[LM.NOSE], { x: 0.5, y: 0.08, z: -0.12, visibility: 0.98 });
  Object.assign(pose[LM.LEFT_EYE], { x: 0.53, y: 0.07, z: -0.05, visibility: 0.95 });
  Object.assign(pose[LM.RIGHT_EYE], { x: 0.47, y: 0.07, z: -0.05, visibility: 0.95 });
  Object.assign(pose[LM.LEFT_EAR], { x: 0.55, y: 0.1, z: 0.02, visibility: 0.9 });
  Object.assign(pose[LM.RIGHT_EAR], { x: 0.45, y: 0.1, z: 0.02, visibility: 0.9 });
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.58, y: 0.25, z: 0 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.42, y: 0.25, z: 0 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.57, y: 0.52, z: 0 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.43, y: 0.52, z: 0 });
  for (const [index, value] of Object.entries(overrides)) {
    Object.assign(pose[Number(index)], value);
  }
  return pose;
}

// 후면: 어깨는 BlazePose 특성상 정면과 같은 배치일 수 있지만(좌 0.42 < 우 0.58),
// 얼굴 좌우부호가 뒤집히고(눈/귀 좌>우), 코가 귀보다 뒤(z 큼). visibility 는 높게 유지
// (BlazePose 가 뒤통수에서도 얼굴 vis 를 높게 주는 실제 동작 반영).
function backPose() {
  const pose = frontPose();
  // 정면 대비 얼굴/어깨 좌우 배치 반전 (등을 보임)
  Object.assign(pose[LM.LEFT_EYE], { x: 0.47 });
  Object.assign(pose[LM.RIGHT_EYE], { x: 0.53 });
  Object.assign(pose[LM.LEFT_EAR], { x: 0.45, z: -0.02 });
  Object.assign(pose[LM.RIGHT_EAR], { x: 0.55, z: -0.02 });
  Object.assign(pose[LM.NOSE], { x: 0.5, z: 0.12 }); // 코가 귀보다 뒤
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.42 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.58 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.43 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.57 });
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

  it('visibility가 높아도(뒤통수) 좌우부호·z깊이로 후면을 판별한다 (실측 회귀)', () => {
    // BlazePose 는 후면에서도 얼굴 visibility 를 높게 출력 → vis 로 속으면 안 됨.
    // backPose 는 vis 0.9+ 를 유지하면서 좌우부호 반전 + 코 z 뒤쪽으로 구성됨.
    const pose = backPose();
    const eyeVis = (pose[LM.LEFT_EYE].visibility + pose[LM.RIGHT_EYE].visibility) / 2;
    expect(eyeVis).toBeGreaterThan(0.8); // 가시성은 높음
    const r = detectPostureView(pose);
    expect(r.view).toBe('back'); // 그래도 후면으로 판별
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

  // [회귀] 실측 케이스: 프로필인데 어깨폭이 애매(0.10~0.16)해 정면/후면으로
  //  오인하던 문제. 어깨 z-깊이 분리가 크면 측면으로 잡아야 한다.
  function sideAmbiguousWidth(noseX) {
    // 어깨폭 비율을 일부러 애매 구간에 둠(0.5 vs 0.63 → trunkH≈0.27 → ratio≈0.13)
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.50, y: 0.30, z: -0.30 });   // 가까운 어깨
    Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.535, y: 0.30, z: 0.30 });  // 먼 어깨(z 큼)
    Object.assign(pose[LM.LEFT_HIP], { x: 0.50, y: 0.57 });
    Object.assign(pose[LM.RIGHT_HIP], { x: 0.535, y: 0.57 });
    Object.assign(pose[LM.NOSE], { x: noseX, y: 0.10, visibility: 0.9 });
    Object.assign(pose[LM.LEFT_EAR], { visibility: 0.95 });
    Object.assign(pose[LM.RIGHT_EAR], { visibility: 0.2 }); // 한쪽 귀만 잘 보임
    return pose;
  }

  it('[회귀] 어깨폭 애매하지만 z-분리 큰 프로필 → 측면으로 인식', () => {
    const r = detectPostureView(sideAmbiguousWidth(0.72));
    expect(['left', 'right']).toContain(r.view);
    expect(r.view).not.toBe('back');
    expect(r.view).not.toBe('front');
  });

  it('[회귀] z-분리 큰 좌측 프로필의 좌/우 방향도 코 위치로 정확', () => {
    expect(detectPostureView(sideAmbiguousWidth(0.72)).view).toBe('left');
    expect(detectPostureView(sideAmbiguousWidth(0.28)).view).toBe('right');
  });

  it('랜드마크가 없으면 unknown', () => {
    expect(detectPostureView(null).view).toBe('unknown');
    expect(detectPostureView([]).view).toBe('unknown');
  });

  it('[회귀] 미러링 없는 후면 카메라: 정면은 해부학 LEFT가 화면 오른쪽(x 큼)이며 front', () => {
    const pose = frontPose();
    expect(pose[LM.LEFT_EYE].x).toBeGreaterThan(pose[LM.RIGHT_EYE].x);
    expect(detectPostureView(pose).view).toBe('front');
  });
  it('[회귀] 미러링 없는 후면 카메라: 등을 보이면 좌우 반전되어 back', () => {
    const pose = backPose();
    expect(pose[LM.LEFT_EYE].x).toBeLessThan(pose[LM.RIGHT_EYE].x);
    expect(detectPostureView(pose).view).toBe('back');
  });
  it('[회귀] 정면/후면이 서로 반대로 일관되게 판정된다', () => {
    expect(detectPostureView(frontPose()).view).toBe('front');
    expect(detectPostureView(backPose()).view).toBe('back');
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

describe('sanitizeBackLandmarks', () => {
  it('후면에서 코·눈은 visibility 0 으로 제거하고 귀는 유지한다', () => {
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
    const out = sanitizeBackLandmarks(pose);
    // 코(0), 눈(2,5) 제거
    expect(out[LM.NOSE].visibility).toBe(0);
    expect(out[LM.NOSE]._removed).toBe(true);
    expect(out[LM.LEFT_EYE].visibility).toBe(0);
    expect(out[LM.RIGHT_EYE].visibility).toBe(0);
    // 귀(7,8)는 유지
    expect(out[LM.LEFT_EAR].visibility).toBe(0.95);
    expect(out[LM.RIGHT_EAR].visibility).toBe(0.95);
    // 어깨 등 몸통은 그대로
    expect(out[LM.LEFT_SHOULDER].visibility).toBe(0.95);
  });

  it('배열이 아니면 그대로 반환', () => {
    expect(sanitizeBackLandmarks(null)).toBeNull();
  });
});
