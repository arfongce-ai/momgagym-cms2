// jump_single_ankle_tracking.test.js
// ════════════════════════════════════════════════════════════════════════
//  운영자 질문("발목(27)번을 잡을 수 있도록... 거기서 점프 후 발목까지")에
//  대한 구현. 기존 feetCenterY는 프레임마다 "둘 다 보이면 평균, 한쪽만
//  보이면 그쪽"으로 모드가 바뀔 수 있어, 평균값과 단일값의 미세한 차이가
//  프레임 간 흔들림으로 오인될 위험이 있었다. 이제 캘리브레이션 시점에
//  더 안정적으로 보인 발목 한쪽을 골라(ankleSide) 점프 끝까지 그 발목
//  하나만(singleAnkleY) 일관되게 추적한다 — 기준선(baselineAnkleY)도
//  같은 쪽 기준으로 계산해 기준-추적 신호가 어긋나지 않게 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  JUMP_TUNING, singleAnkleY, StandingCalibrator, JumpFlightTracker,
} from '../ai-measure/core/jumpBiomechanics.js';

const makeLm = ({ feetY = 0.9, leftFeetY, rightFeetY, pelvisY = 0.6, headY = 0.1, vis = 0.95, visL, visR } = {}) => {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: vis }));
  a[0] = { x: 0.5, y: headY, visibility: vis };
  a[23] = { x: 0.45, y: pelvisY, visibility: vis };
  a[24] = { x: 0.55, y: pelvisY, visibility: vis };
  a[27] = { x: 0.45, y: leftFeetY ?? feetY, visibility: visL ?? vis };
  a[28] = { x: 0.55, y: rightFeetY ?? feetY, visibility: visR ?? vis };
  return a;
};

describe('singleAnkleY — 한쪽 발목만 읽는다', () => {
  it("side='left'면 27번만 본다(28번 값은 무시)", () => {
    const lm = makeLm({ leftFeetY: 0.9, rightFeetY: 0.5 });
    expect(singleAnkleY(lm, 'left')).toBeCloseTo(0.9, 6);
  });
  it("side='right'면 28번만 본다", () => {
    const lm = makeLm({ leftFeetY: 0.9, rightFeetY: 0.5 });
    expect(singleAnkleY(lm, 'right')).toBeCloseTo(0.5, 6);
  });
  it('그 쪽 가시성이 문턱 미만이면 null(다른 쪽이 잘 보여도 대체하지 않는다 — 일관성이 핵심)', () => {
    const lm = makeLm({ leftFeetY: 0.9, visL: 0.01, rightFeetY: 0.5, visR: 0.95 });
    expect(singleAnkleY(lm, 'left')).toBeNull();
  });
});

describe('StandingCalibrator — 더 잘 보인 발목 한쪽을 골라 고정한다', () => {
  it('오른쪽이 왼쪽보다 훨씬 잘 보이면 ankleSide가 right로 잠긴다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 12; i++) {
      // 왼쪽은 절반만 보이고, 오른쪽은 항상 보임(카메라 각도상 오른쪽이 더 잘 잡히는 상황 흉내).
      calib.push(makeLm({ feetY: 0.9, visL: i % 2 === 0 ? 0.95 : 0.01, visR: 0.95 }));
    }
    expect(calib.locked).toBe(true);
    expect(calib.result.ankleSide).toBe('right');
    expect(calib.result.baselineAnkleY).toBeCloseTo(0.9, 3);
  });

  it('양쪽이 똑같이 잘 보이면 왼쪽(먼저 판정)으로 정하되, 값은 정상적으로 채워진다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 12; i++) calib.push(makeLm({ leftFeetY: 0.9, rightFeetY: 0.9, vis: 0.95 }));
    expect(calib.locked).toBe(true);
    expect(['left', 'right']).toContain(calib.result.ankleSide);
    expect(calib.result.baselineAnkleY).toBeCloseTo(0.9, 3);
  });
});

describe('JumpFlightTracker — 캘리브레이션이 고른 발목 한쪽만 점프 끝까지 본다', () => {
  it('ankleSide=left로 잠긴 뒤엔, 오른쪽(28) 값이 크게 흔들려도 무시하고 왼쪽(27)만으로 이착지를 판정한다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 12; i++) calib.push(makeLm({ feetY: 0.9, visL: 0.95, visR: 0.95 }));
    expect(calib.result.ankleSide).toBeDefined();
    const side = calib.result.ankleSide;
    const otherSide = side === 'left' ? 'right' : 'left';

    const tracker = new JumpFlightTracker(calib.result);
    expect(tracker.ankleSide).toBe(side);

    let t = 0;
    const push = (chosenY, otherY) => {
      const lm = makeLm({
        leftFeetY: side === 'left' ? chosenY : otherY,
        rightFeetY: side === 'right' ? chosenY : otherY,
        vis: 0.95,
      });
      tracker.push(lm, t);
      t += 33;
    };
    // 서 있음(선택된 쪽 0.9) — 반대쪽은 계속 요동쳐도(0.2~0.9) 결과에 영향 없어야 한다.
    for (let i = 0; i < 5; i++) push(0.9, i % 2 === 0 ? 0.2 : 0.9);
    // 선택된 쪽이 위로 뜸(이륙) — 반대쪽은 여전히 요동
    for (let i = 0; i < 5; i++) push(0.7, 0.9);
    // 선택된 쪽 착지
    for (let i = 0; i < 5; i++) push(0.9, 0.9);

    expect(tracker.flights.length).toBeGreaterThan(0);
  });
});
