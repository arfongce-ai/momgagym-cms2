// squat_joint_angles.test.js
// ════════════════════════════════════════════════════════════════════════
//  squatJointAngles.js 기하 계산 검증. 실측 스쿼트 자세 대신, 각도가 명확히
//  검증 가능한 단순 합성 좌표(일직선=180°, 직각=90°)로 계산식 자체의 정확성만
//  확인한다(임상적 "정상 범위" 판단은 이 파일의 범위가 아님 — squatBiomechanics.js
//  의 몫이고, 이 함수들은 아직 거기 연결되지 않았다).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  shoulderFlexionDeg, hipFlexionDeg, kneeFlexionDeg, ankleFlexionDeg,
  cogOverAnkleDeg, elbowExtensionDeg, headTiltDeg, earShoulderGap,
  cogTiltFrontDeg, computeDisplayAngles,
} from '../ai-measure/core/squatJointAngles';

// 33점 배열 뼈대 — 필요한 관절만 채운다.
function baseLm() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
}

describe('squatJointAngles — 기하 계산 정확성', () => {
  it('무릎이 완전히 펴진(일직선) 다리는 kneeFlexionDeg ≈ 180°', () => {
    const lm = baseLm();
    lm[23] = { x: 0.5, y: 0.5 };  // hip
    lm[25] = { x: 0.5, y: 0.7 };  // knee (hip 바로 아래)
    lm[27] = { x: 0.5, y: 0.9 };  // ankle (knee 바로 아래, 일직선)
    expect(kneeFlexionDeg(lm, 'left')).toBeCloseTo(180, 0);
  });

  it('무릎이 직각으로 굽으면 kneeFlexionDeg ≈ 90°', () => {
    const lm = baseLm();
    lm[23] = { x: 0.5, y: 0.5 };  // hip (무릎 바로 위)
    lm[25] = { x: 0.5, y: 0.7 };  // knee
    lm[27] = { x: 0.7, y: 0.7 };  // ankle (무릎에서 수평으로 꺾임 → 직각)
    expect(kneeFlexionDeg(lm, 'left')).toBeCloseTo(90, 0);
  });

  it('엉덩이가 일직선(선 자세)이면 hipFlexionDeg ≈ 180°', () => {
    const lm = baseLm();
    lm[11] = { x: 0.5, y: 0.2 };  // shoulder
    lm[23] = { x: 0.5, y: 0.5 };  // hip
    lm[25] = { x: 0.5, y: 0.8 };  // knee (일직선)
    expect(hipFlexionDeg(lm, 'left')).toBeCloseTo(180, 0);
  });

  it('어깨가 몸통과 일직선(완전히 위로 든 팔)이면 shoulderFlexionDeg ≈ 180°', () => {
    const lm = baseLm();
    lm[23] = { x: 0.5, y: 0.6 };  // hip
    lm[11] = { x: 0.5, y: 0.3 };  // shoulder
    lm[13] = { x: 0.5, y: 0.0 };  // elbow (어깨 위로 일직선 — 팔을 위로 뻗음)
    expect(shoulderFlexionDeg(lm, 'left')).toBeCloseTo(180, 0);
  });

  it('팔꿈치가 완전히 펴지면(일직선) elbowExtensionDeg ≈ 180°', () => {
    const lm = baseLm();
    lm[11] = { x: 0.5, y: 0.3 };  // shoulder
    lm[13] = { x: 0.5, y: 0.0 };  // elbow
    lm[15] = { x: 0.5, y: -0.3 }; // wrist (일직선으로 더 위)
    expect(elbowExtensionDeg(lm, 'left')).toBeCloseTo(180, 0);
  });

  it('팔꿈치가 직각으로 굽으면 elbowExtensionDeg ≈ 90°', () => {
    const lm = baseLm();
    lm[11] = { x: 0.5, y: 0.3 };  // shoulder
    lm[13] = { x: 0.5, y: 0.0 };  // elbow
    lm[15] = { x: 0.8, y: 0.0 }; // wrist (수평으로 꺾임)
    expect(elbowExtensionDeg(lm, 'left')).toBeCloseTo(90, 0);
  });

  it('CoG가 발목 바로 위(수직)면 cogOverAnkleDeg ≈ 0°', () => {
    const lm = baseLm();
    lm[11] = { x: 0.5, y: 0.2 };  // shoulder
    lm[23] = { x: 0.5, y: 0.5 };  // hip (CoG 근사 = 0.5,0.35)
    lm[27] = { x: 0.5, y: 0.9 };  // ankle (같은 x → 수직)
    expect(Math.abs(cogOverAnkleDeg(lm, 'left'))).toBeCloseTo(0, 0);
  });

  it('CoG가 발목보다 앞으로 쏠리면 cogOverAnkleDeg 절댓값이 커진다', () => {
    const lm = baseLm();
    lm[11] = { x: 0.65, y: 0.2 };
    lm[23] = { x: 0.65, y: 0.5 };
    lm[27] = { x: 0.5, y: 0.9 };
    expect(Math.abs(cogOverAnkleDeg(lm, 'left'))).toBeGreaterThan(10);
  });

  it('양쪽 귀가 수평이면 headTiltDeg ≈ 0°', () => {
    const lm = baseLm();
    lm[7] = { x: 0.6, y: 0.2 };  // left ear
    lm[8] = { x: 0.4, y: 0.2 };  // right ear (같은 y → 수평)
    expect(Math.abs(headTiltDeg(lm))).toBeCloseTo(0, 0);
  });

  it('정면 CoG가 발목 중점 바로 위면 cogTiltFrontDeg ≈ 0°', () => {
    const lm = baseLm();
    lm[11] = { x: 0.55, y: 0.2 }; lm[12] = { x: 0.45, y: 0.2 }; // shoulders
    lm[23] = { x: 0.55, y: 0.5 }; lm[24] = { x: 0.45, y: 0.5 }; // hips
    lm[27] = { x: 0.55, y: 0.9 }; lm[28] = { x: 0.45, y: 0.9 }; // ankles (같은 중점 x=0.5)
    expect(Math.abs(cogTiltFrontDeg(lm))).toBeCloseTo(0, 0);
  });

  it('랜드마크가 없으면 null(화면에 표시만 생략, 에러 없음)', () => {
    expect(kneeFlexionDeg(null, 'left')).toBeNull();
    expect(shoulderFlexionDeg([], 'left')).toBeNull();
    expect(cogTiltFrontDeg(baseLm().slice(0, 5))).toBeNull();
  });

  it('earShoulderGap은 거리(정규화)를 반환한다', () => {
    const lm = baseLm();
    lm[7] = { x: 0.6, y: 0.2 };
    lm[11] = { x: 0.6, y: 0.3 };
    expect(earShoulderGap(lm, 'left')).toBeCloseTo(0.1, 6);
  });

  it('computeDisplayAngles(side)는 5개 값을 반환한다', () => {
    const lm = baseLm();
    lm[11] = { x: 0.5, y: 0.2 }; lm[13] = { x: 0.5, y: 0.0 };
    lm[23] = { x: 0.5, y: 0.5 }; lm[25] = { x: 0.5, y: 0.7 };
    lm[27] = { x: 0.5, y: 0.9 }; lm[31] = { x: 0.6, y: 0.9 };
    const out = computeDisplayAngles(lm, 'side');
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(['shoulderFlexion', 'hipFlexion', 'kneeFlexion', 'ankleFlexion', 'cogOverAnkle']),
    );
  });

  it('computeDisplayAngles(front)는 6개 값을 반환한다', () => {
    const lm = baseLm();
    const out = computeDisplayAngles(lm, 'front');
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(['cogTilt', 'elbowExtL', 'elbowExtR', 'headTilt', 'earShoulderGapL', 'earShoulderGapR']),
    );
  });

  it('lm이 없으면 computeDisplayAngles는 null', () => {
    expect(computeDisplayAngles(null, 'front')).toBeNull();
  });
});
