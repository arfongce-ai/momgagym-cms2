// broadjump_live_value_consistency.test.js
// [환산식 단일화 2026-09-17] 라이브 HUD·녹화 오버레이에 "측정 중" 표시되는
// 이동거리와, 측정을 마치고 저장되는 리포트의 distanceCm이 항상 같은 값이어야
// 한다. 예전엔 같은 환산식(|landingX - baselineFeetX| × scaleCmPerY)이
// JumpPrecisionAnalysis.jsx와 jumpBiomechanics.js 두 곳에 따로 적혀 있어서,
// 한쪽만 고치면 "화면에서 본 값"과 "저장된 값"이 조용히 갈라질 수 있었다.
// 지금은 core의 broadJumpDistanceCm 하나만 쓰도록 통일했고, 이 테스트가
// 그 계약(같은 입력 → 같은 값)을 실제로 실행해서 검증한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  StandingCalibrator,
  BroadJumpTracker,
  broadJumpDistanceCm,
} from '../ai-measure/core/jumpBiomechanics.js';

// 측면 촬영 랜드마크 한 프레임. feetX/feetY를 직접 지정해 도약·착지를 모사한다.
// (jump_biomechanics.test.js의 makeLm과 동일한 구조 — 같은 컨벤션 유지)
function makeLm({ feetY = 0.9, feetX = 0.3, headY = 0.1 } = {}) {
  const lm = new Array(33).fill(null).map(() => ({ x: feetX, y: 0.5, visibility: 1 }));
  lm[0] = { x: feetX, y: headY, visibility: 1 };            // 코(머리 꼭대기 근사)
  lm[11] = { x: feetX - 0.02, y: headY + 0.12, visibility: 1 };
  lm[12] = { x: feetX + 0.02, y: headY + 0.12, visibility: 1 };
  lm[23] = { x: feetX - 0.02, y: 0.55, visibility: 1 };     // 골반
  lm[24] = { x: feetX + 0.02, y: 0.55, visibility: 1 };
  lm[25] = { x: feetX - 0.02, y: 0.72, visibility: 1 };     // 무릎
  lm[26] = { x: feetX + 0.02, y: 0.72, visibility: 1 };
  lm[27] = { x: feetX - 0.02, y: feetY, visibility: 1 };    // 발목
  lm[28] = { x: feetX + 0.02, y: feetY, visibility: 1 };
  lm[29] = { x: feetX - 0.02, y: feetY + 0.01, visibility: 1 }; // 뒤꿈치
  lm[30] = { x: feetX + 0.02, y: feetY + 0.01, visibility: 1 };
  lm[31] = { x: feetX - 0.02, y: feetY + 0.02, visibility: 1 }; // 발끝
  lm[32] = { x: feetX + 0.02, y: feetY + 0.02, visibility: 1 };
  return lm;
}

// 실제 측정 한 판을 그대로 모사: 서 있기(캘리브레이션) → 도약 → 착지.
function runOneBroadJump({ startX = 0.3, landX = 0.62, bodyHeightCm = 170 } = {}) {
  const calib = new StandingCalibrator({ heightCm: bodyHeightCm });
  let t = 0;
  // 1) 출발선에 서서 캘리브레이션(락이 걸릴 때까지 충분히)
  for (let i = 0; i < 40; i++) {
    calib.push(makeLm({ feetY: 0.9, feetX: startX }), t);
    t += 33;
  }
  expect(calib.result?.locked ?? calib.locked).toBeTruthy();

  const tracker = new BroadJumpTracker(calib.result);
  // 2) 출발선에서 한 번 더 서 있기(트래커 기준 안정화)
  for (let i = 0; i < 5; i++) { tracker.push(makeLm({ feetY: 0.9, feetX: startX }), t); t += 33; }
  // 3) 공중 — 발이 기준선 위로 뜨면서 앞으로 이동
  for (let i = 0; i < 12; i++) {
    const p = (i + 1) / 12;
    tracker.push(makeLm({ feetY: 0.9 - 0.12, feetX: startX + (landX - startX) * p }), t);
    t += 33;
  }
  // 4) 착지 — 발이 기준선으로 복귀
  for (let i = 0; i < 6; i++) { tracker.push(makeLm({ feetY: 0.9, feetX: landX }), t); t += 33; }
  return { calib, tracker };
}

describe('라이브 HUD 표시값 == 저장되는 리포트 값 (같은 환산식 하나만 사용)', () => {
  it('측정이 실제로 잡히고 distanceCm이 산출된다', () => {
    const { tracker } = runOneBroadJump();
    const sum = tracker.summary({ heightCm: 170 });
    expect(tracker.flights.length).toBeGreaterThan(0);
    expect(sum.valid).toBe(true);
    expect(sum.distanceCm).toBeGreaterThan(0);
  });

  it('HUD가 회차 카드에 쓰는 계산(broadJumpDistanceCm)과 최종 저장값(summary().distanceCm)이 정확히 같다', () => {
    const { tracker } = runOneBroadJump();
    const sum = tracker.summary({ heightCm: 170 });

    // JumpPrecisionAnalysis.jsx의 distanceCmOf가 하는 것과 동일한 호출 —
    // 1회 측정이므로 "이번 회차"가 곧 "최고 기록"이라 두 값이 같아야 한다.
    const latest = tracker.flights.at(-1);
    const hudValue = broadJumpDistanceCm(
      latest.landingX,
      tracker.baselineFeetX,
      tracker.calib?.scaleCmPerY,
    );

    expect(hudValue).not.toBeNull();
    expect(hudValue).toBe(sum.distanceCm);
  });

  it('입력이 비면(캘리브레이션 실패 등) 둘 다 조용히 null — 0cm 같은 가짜 값을 만들지 않는다', () => {
    expect(broadJumpDistanceCm(null, 0.3, 200)).toBeNull();
    expect(broadJumpDistanceCm(0.6, null, 200)).toBeNull();
    expect(broadJumpDistanceCm(0.6, 0.3, null)).toBeNull();
  });

  it('환산식은 |착지X - 출발선X| × 스케일 (방향 무관 — 안쪽/바깥쪽 어느 쪽으로 뛰어도 양수)', () => {
    // 한발멀리뛰기 안쪽/바깥쪽은 좌우 양방향으로 뛴다 — 부호가 아니라 크기를 잰다.
    const right = broadJumpDistanceCm(0.6, 0.3, 200); // 오른쪽으로 0.3
    const left = broadJumpDistanceCm(0.0, 0.3, 200);  // 왼쪽으로 0.3
    expect(right).toBe(60);
    expect(left).toBe(60);
  });
});

describe('환산식이 두 곳에 중복 정의돼 있지 않다(회귀 방지)', () => {
  const hudSrc = readFileSync(
    join(process.cwd(), 'src', 'ai-measure', 'menus', 'JumpPrecisionAnalysis.jsx'),
    'utf8',
  );

  it('JumpPrecisionAnalysis.jsx는 core의 broadJumpDistanceCm을 import해서 쓴다', () => {
    expect(hudSrc).toContain('broadJumpDistanceCm');
    expect(hudSrc).toMatch(/import\s*{[^}]*broadJumpDistanceCm[^}]*}\s*from\s*['"]\.\.\/core\/jumpBiomechanics['"]/s);
  });

  it('화면 쪽에 환산식(× scaleCmPerY)을 다시 적어두지 않는다', () => {
    // distanceCmOf는 core 함수에 위임만 해야 한다 — 직접 곱셈식을 쓰면 중복 재발.
    const idx = hudSrc.indexOf('function distanceCmOf(');
    const body = hudSrc.slice(idx, hudSrc.indexOf('\n}', idx));
    expect(body).toContain('broadJumpDistanceCm(');
    expect(body).not.toMatch(/scaleCmPerY\s*\*/);
    expect(body).not.toMatch(/Math\.abs\([^)]*landingX/);
  });
});
