// rom_elbow_support.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] ROM(가동범위) 측정에 팔꿈치(ELBOW) 추가.
//  무릎(KNEE)과 동일한 성질(펴면 내각 180°에 가깝고, 굴곡할수록 내각이
//  작아짐)의 경첩 관절이라 KNEE와 같은 변환식(180-내각)을 공유한다.
//  같은 커밋에 KNEE·ELBOW 공통으로 걸려있던 _sanityRange 버그도 함께 고쳤다
//  — 가장 깊이 굽힌(임상적으로 가장 중요한) 표본이 "비정상치"로 필터링되어
//  최대 굴곡각이 실제보다 작게 나오던 문제. 아래 테스트는 기능 추가와
//  버그 수정 두 가지를 모두 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  LM,
  jointAngleByMode,
  normalizePose,
  RomAccumulator,
  ROM_NORMS,
} from '../ai-measure/core/bodyMechanics';
import { generateRomDiagnosis } from '../ai-measure/core/romClinical';

// 표준 직립 포즈 + 팔꿈치·손목 기본 배치(팔을 편 상태: 어깨-팔꿈치-손목 일직선에 가깝게).
function makePose(overrides = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.42, y: 0.25 });
  Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.58, y: 0.25 });
  Object.assign(pose[LM.LEFT_HIP], { x: 0.44, y: 0.52 });
  Object.assign(pose[LM.RIGHT_HIP], { x: 0.56, y: 0.52 });
  Object.assign(pose[LM.LEFT_ELBOW], { x: 0.40, y: 0.40 });
  Object.assign(pose[LM.RIGHT_ELBOW], { x: 0.60, y: 0.40 });
  Object.assign(pose[LM.LEFT_WRIST], { x: 0.38, y: 0.55 }); // 어깨-팔꿈치-손목 거의 일직선(폄)
  Object.assign(pose[LM.RIGHT_WRIST], { x: 0.62, y: 0.55 });
  Object.entries(overrides).forEach(([idx, patch]) => Object.assign(pose[idx], patch));
  return pose;
}

describe('bodyMechanics — ELBOW 관절각 계산', () => {
  it('ROM_NORMS에 STANDING/SEATED 굴곡 기준치가 있다', () => {
    expect(ROM_NORMS.ELBOW.STANDING.flexion.normal).toBe(140);
    expect(ROM_NORMS.ELBOW.SEATED.flexion.normal).toBe(140);
  });

  it('shoulder-elbow-wrist 내각으로 계산한다 — 거의 편 팔은 180°에 가깝다', () => {
    const pose = makePose();
    const { angle } = jointAngleByMode(normalizePose(pose), 'ELBOW', 'left', 'STANDING');
    expect(angle).toBeGreaterThan(150);
  });

  it('손목을 어깨 쪽으로 당기면(굴곡) 내각이 뚜렷이 줄어든다', () => {
    const straight = jointAngleByMode(
      normalizePose(makePose()), 'ELBOW', 'left', 'STANDING',
    ).angle;
    const flexed = jointAngleByMode(
      normalizePose(makePose({ [LM.LEFT_WRIST]: { x: 0.44, y: 0.30 } })), // 손목을 어깨 근처로
      'ELBOW', 'left', 'STANDING',
    ).angle;
    expect(flexed).toBeLessThan(straight - 30);
  });

  it('KNEE와 동일하게 use3d=false(2D 평면각)로 계산한다 — z값이 있어도 결과가 흔들리지 않는다', () => {
    const a = jointAngleByMode(
      normalizePose(makePose({ [LM.LEFT_WRIST]: { x: 0.44, y: 0.30, z: 0 } })), 'ELBOW', 'left', 'STANDING',
    ).angle;
    const b = jointAngleByMode(
      normalizePose(makePose({ [LM.LEFT_WRIST]: { x: 0.44, y: 0.30, z: 0.4 } })), 'ELBOW', 'left', 'STANDING',
    ).angle;
    expect(Math.abs(a - b)).toBeLessThan(1);
  });
});

describe('RomAccumulator — ELBOW는 KNEE와 같은 (180 - 최소내각) 변환을 쓴다', () => {
  it('팔꿈치를 굽혔다 펴는 동작에서 최대 굴곡각을 산출한다', () => {
    const acc = new RomAccumulator({ joint: 'ELBOW', poseMode: 'STANDING' });
    for (let i = 0; i < 20; i++) {
      const bend = Math.sin((i / 19) * Math.PI); // 0(폄)→1(최대굴곡)→0
      const wristX = 0.38 + bend * 0.06;
      const wristY = 0.55 - bend * 0.25; // 손목을 어깨 쪽(위)으로 끌어올림
      const pose = makePose({ [LM.LEFT_WRIST]: { x: wristX, y: wristY } });
      acc.push(pose, i * 40);
    }
    const sum = acc.summary();
    expect(sum.valid).toBe(true);
    expect(sum.left_max_rom).toBeGreaterThan(30); // 의미있는 굴곡이 감지됨
  });

  it('[버그 수정 회귀] 임상 정상범위 근처까지 깊이 굽힌 표본이 "비정상치"로 필터링되지 않는다', () => {
    // ROM_NORMS.ELBOW.STANDING.flexion.max = 155 → raw(내각) 최소값은 180-155 = 25°.
    // 수정 전 _sanityRange는 이 raw 값(25°)에 flexion 공간 min/max(120~155)를 그대로 적용해
    // "25 < 120"으로 판정, 가장 깊이 굽힌 표본을 걸러내 최대굴곡이 실제보다 작게 나왔다.
    const acc = new RomAccumulator({ joint: 'ELBOW', poseMode: 'STANDING' });
    for (let i = 0; i < 24; i++) {
      const bend = Math.sin((i / 23) * Math.PI);
      // 깊은 굴곡(raw 내각 ≈ 28~30°, flexion ≈ 150~152°)까지 도달하도록 손목을 크게 당김.
      const wristX = 0.40 + bend * 0.045;
      const wristY = 0.55 - bend * 0.335;
      const pose = makePose({ [LM.LEFT_WRIST]: { x: wristX, y: wristY } });
      acc.push(pose, i * 40);
    }
    const sum = acc.summary();
    expect(sum.valid).toBe(true);
    // 수정 전이었다면 깊은 굴곡 표본이 필터링되어 이보다 훨씬 낮게(대략 <110) 나왔을 것.
    expect(sum.left_max_rom).toBeGreaterThan(120);
  });

  it('데이터가 부족하면 valid=false(다른 관절과 동일한 정직성 가드)', () => {
    const acc = new RomAccumulator({ joint: 'ELBOW', poseMode: 'STANDING' });
    acc.push(makePose(), 0);
    acc.push(makePose(), 33);
    expect(acc.summary().valid).toBe(false);
  });
});

describe('romClinical — ELBOW 한글 라벨·진단', () => {
  it('관절명이 "주관절"로 표시된다', () => {
    const diag = generateRomDiagnosis(
      { left_max_rom: 140, right_max_rom: 138, symmetry_index_score: 3 },
      { joint: 'ELBOW', poseMode: 'STANDING' },
    );
    expect(diag.headline).toContain('주관절');
  });

  it('정상 범위(120~155°) 안이면 details에 정상 범위 문구가 포함된다', () => {
    const diag = generateRomDiagnosis(
      { left_max_rom: 140, right_max_rom: 138, symmetry_index_score: 2 },
      { joint: 'ELBOW', poseMode: 'STANDING' },
    );
    expect(diag.details.some((d) => d.includes('정상 범위'))).toBe(true);
    expect(diag.grade).toBe('good');
  });
});
