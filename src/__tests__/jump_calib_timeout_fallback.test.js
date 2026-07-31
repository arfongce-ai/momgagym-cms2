// jump_calib_timeout_fallback.test.js
// ════════════════════════════════════════════════════════════════════════
//  운영자 제안("선을 잡지 말고 그냥 발목으로 기준을 잡자")에 대한 절충안.
//  정상 경로(안정성+가시비율 확인 후 잠금)를 그대로 두되, calibTimeoutMs
//  (4초) 안에 정상 잠금이 안 되면 지금까지 모인 표본(최소 1개)의 평균으로
//  강제 잠금한다 — 카메라 상태가 좋은 날은 기존과 동일하게 정확한 잠금을
//  쓰고, 정말 안 잡히는 상황에서만 폴백이 개입해 최소한 측정은 진행되게
//  한다. result.basis로 어느 경로였는지 구분 가능하다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JUMP_TUNING, StandingCalibrator } from '../ai-measure/core/jumpBiomechanics.js';

const makeLm = ({ feetY = 0.9, pelvisY = 0.6, headY = 0.1, vis = 0.95 } = {}) => {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: vis }));
  a[0] = { x: 0.5, y: headY, visibility: vis };
  a[23] = { x: 0.45, y: pelvisY, visibility: vis };
  a[24] = { x: 0.55, y: pelvisY, visibility: vis };
  a[27] = { x: 0.45, y: feetY, visibility: vis };
  a[28] = { x: 0.55, y: feetY, visibility: vis };
  return a;
};

describe('StandingCalibrator — 타임아웃 폴백(정상 잠금이 계속 실패할 때만 개입)', () => {
  it('가시성이 좋으면 타임스탬프를 넘겨도 정상 경로(basis: normal)로 잠긴다 — 폴백이 끼어들지 않는다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    let t = 0;
    for (let i = 0; i < 15; i++) { calib.push(makeLm({ vis: 0.95 }), t); t += 33; }
    expect(calib.locked).toBe(true);
    expect(calib.result.basis).toBe('normal');
  });

  it('가시성이 문턱(0.12) 근처라 정상 경로로는 안 잠기지만 표본은 쌓이면, 타임아웃 후 그 표본 평균으로 강제 잠긴다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    let t = 0;
    const step = 33; // ~30fps
    let lockedBefore = false;
    // 가시성 0.15(문턱 0.12는 넘어 표본은 쌓이지만, 60% 가시비율 요구 등
    // 다른 조건으로 정상 경로가 계속 실패하는 상황을 흔들림으로 흉내낸다).
    while (t < JUMP_TUNING.calibTimeoutMs - step) {
      const wobble = (t / step) % 2 === 0 ? 0.9 : 0.94; // 흔들림으로 std 초과시켜 정상 잠금 방해
      calib.push(makeLm({ vis: 0.15, feetY: wobble }), t);
      t += step;
      if (calib.locked) { lockedBefore = true; break; }
    }
    expect(lockedBefore).toBe(false);
    expect(calib.locked).toBe(false);
    calib.push(makeLm({ vis: 0.15, feetY: 0.9 }), t + step * 2);
    expect(calib.locked).toBe(true);
    expect(calib.result.basis).toBe('timeout_fallback');
  });

  it('가시성이 아예 0(문턱조차 못 넘어 정식 표본이 하나도 없음)이어도, 타임아웃 후 가시성 무시 원시값으로 강제 잠긴다("그냥 발목으로 기준을 잡자")', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    let t = 0;
    const step = 33;
    while (t < JUMP_TUNING.calibTimeoutMs - step) {
      calib.push(makeLm({ vis: 0 }), t); // 가시성 완전 0 — 정식 표본 절대 안 쌓임
      t += step;
    }
    expect(calib.locked).toBe(false);
    calib.push(makeLm({ vis: 0 }), t + step * 2);
    expect(calib.locked).toBe(true);
    expect(calib.result.basis).toBe('timeout_fallback_raw');
    expect(calib.result.baselineFeetY).toBeCloseTo(0.9, 3);
  });

  it('타임스탬프를 안 넘기면(tMs 생략) 폴백이 절대 발동하지 않는다 — 기존 호출부·테스트와 완전히 하위 호환', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 500; i++) calib.push(makeLm({ vis: 0.01 })); // tMs 없음
    expect(calib.locked).toBe(false); // 아무리 여러 번 불러도 폴백 없이 계속 대기
  });

  it('발목 랜드마크 자체가 존재하지 않으면(원시값도 없음) 타임아웃이 지나도 강제 잠금하지 않는다(평균 낼 데이터가 아예 없음)', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    const badLm = () => {
      const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
      a[27] = undefined; a[28] = undefined; // 발목 자체가 검출 안 됨 — 원시값도 못 만든다
      return a;
    };
    let t = 0;
    for (let i = 0; i < 200; i++) { calib.push(badLm(), t); t += 33; }
    expect(calib.locked).toBe(false);
  });
});
