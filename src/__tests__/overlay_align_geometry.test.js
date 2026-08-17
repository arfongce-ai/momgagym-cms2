// overlay_align_geometry.test.js
// ════════════════════════════════════════════════════════════════════════
//  overlayAlign.js(전/후 비교 도구의 발목 기준 자동 정렬 수학)의 순수 함수
//  단위 테스트. 사람이 육안으로 확인하기 어려운 좌표 변환(translate+scale
//  역산)이라, 알려진 입력에서 기대한 출력이 나오는지와 "정변환을 다시 걸면
//  ankleB가 정확히 ankleA 위치에 겹치는지"를 함께 검증한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { clamp, computeContainRect, solveAutoAlign } from '../ai-measure/core/overlayAlign';

function approxEqual(a, b, eps = 0.001) {
  return Math.abs(a - b) < eps;
}

describe('overlayAlign.js — computeContainRect', () => {
  it('세로가 긴 미디어를 4:3 스테이지에 세로 기준으로 맞춘다', () => {
    const rect = computeContainRect(200, 300, 400, 300);
    expect(rect).toEqual({ x: 100, y: 0, w: 200, h: 300 });
  });

  it('가로가 넓은 미디어를 4:3 스테이지에 가로 기준으로 맞춘다', () => {
    const rect = computeContainRect(100, 100, 400, 300);
    expect(rect).toEqual({ x: 50, y: 0, w: 300, h: 300 });
  });
});

describe('overlayAlign.js — solveAutoAlign', () => {
  const stageW = 400;
  const stageH = 300;
  const rectA = computeContainRect(200, 300, stageW, stageH);
  const rectB = computeContainRect(100, 100, stageW, stageH);
  const baseOpts = { stageW, stageH, rectA, rectB, scaleMin: 30, scaleMax: 300, offsetMin: -300, offsetMax: 300 };

  it('두 레이어의 신체 비율(발목~어깨)이 같으면 크기는 그대로, 위치만 보정한다', () => {
    const ankleA = { x: 0.5, y: 0.9 };
    const refA = { x: 0.5, y: 0.3 };
    const ankleB = { x: 0.5, y: 0.8 };
    const refB = { x: 0.5, y: 0.2 };

    const result = solveAutoAlign({ ...baseOpts, ankleA, ankleB, refA, refB, flip: false });
    expect(result.scale).toBe(100);
    expect(result.x).toBe(0);
    expect(result.y).toBe(30);
  });

  it('B의 신체가 로컬 좌표상 절반 크기면 정렬 후 200%로 확대한다', () => {
    const ankleA = { x: 0.5, y: 0.9 };
    const refA = { x: 0.5, y: 0.3 };
    const ankleB = { x: 0.5, y: 0.6 };
    const refB = { x: 0.5, y: 0.3 };

    const result = solveAutoAlign({ ...baseOpts, ankleA, ankleB, refA, refB, flip: false });
    expect(result.scale).toBe(200);
  });

  it('scaleMax를 넘는 배율 요청은 클램프된다', () => {
    const ankleA = { x: 0.5, y: 0.9 };
    const refA = { x: 0.5, y: 0.3 };
    const ankleB = { x: 0.5, y: 0.51 };
    const refB = { x: 0.5, y: 0.5 }; // 로컬 신체 길이가 극히 작아 스케일 요청이 폭발함
    const result = solveAutoAlign({ ...baseOpts, ankleA, ankleB, refA, refB, flip: false });
    expect(result.scale).toBe(300);
  });

  // 핵심 회귀 방지: solveAutoAlign이 돌려준 (x,y,scale)로 실제 CSS 변환
  // (translate 후 scale, 스테이지 중심 기준)을 다시 걸었을 때, ankleB가
  // ankleA 위치에 정확히 겹치는지 순방향으로 재검증한다. flip 유무 둘 다 확인.
  it.each([false, true])('정변환 재검증 — flip=%s이어도 ankleB가 ankleA 위치로 정확히 이동한다', (flip) => {
    const ankleA = { x: 0.5, y: 0.9 };
    const refA = { x: 0.5, y: 0.3 };
    const ankleB = { x: flip ? 0.7 : 0.3, y: 0.8 };
    const refB = { x: flip ? 0.7 : 0.3, y: 0.2 };

    const result = solveAutoAlign({ ...baseOpts, ankleA, ankleB, refA, refB, flip });

    const ankleADisp = { x: rectA.x + ankleA.x * rectA.w, y: rectA.y + ankleA.y * rectA.h };
    const ankleBLocal = { x: rectB.x + ankleB.x * rectB.w, y: rectB.y + ankleB.y * rectB.h };
    const origin = { x: stageW / 2, y: stageH / 2 };
    const s = result.scale / 100;
    const sx = flip ? -s : s;
    const sy = s;
    const transformed = {
      x: origin.x + sx * (ankleBLocal.x - origin.x) + result.x,
      y: origin.y + sy * (ankleBLocal.y - origin.y) + result.y,
    };
    expect(approxEqual(transformed.x, ankleADisp.x)).toBe(true);
    expect(approxEqual(transformed.y, ankleADisp.y)).toBe(true);
  });
});

describe('overlayAlign.js — clamp', () => {
  it('범위 안의 값은 그대로 반환한다', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
  it('범위를 벗어나면 경계값으로 잘린다', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});
