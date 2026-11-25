// src/__tests__/goniometer_stability.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2611-ROM] 폰 고니오메타 안정화 — 오작동·과민 반응 방지
//   · 천천히 움직이는 중에 자동 확정되지 않는다(표본 속도와 무관).
//   · 확정값은 "유지 구간 중앙값"(순간 튐·가속 스파이크 무시).
//   · 폰 비틀림은 각도별 예상 오차로 판정한다(고정 비율 아님).
//   · 최대각은 창 중앙값 — 한두 표본 튐이 결과가 되지 않는다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createHoldDetector, createPeakTracker, estimateTiltErrorDeg, sensorConfidence,
  alphaForDt, median,
} from '../ai-measure/core/sensorTilt';

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');
const RAD = Math.PI / 180;

// 천천히 움직이는 샘플열을 만들어 발화 여부를 본다(속도 dps, 표본 간격 stepMs)
function slowSweepFires(dps, stepMs, totalMs = 4000) {
  const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
  let fired = false;
  for (let t = 0; t <= totalMs; t += stepMs) {
    if (d.push(20 + (dps * t) / 1000, t).fired) fired = true;
  }
  return fired;
}

describe('createHoldDetector — 시간 기반(표본 속도 무관) 유지 판정', () => {
  it('느리게(초당 10°) 계속 움직이는 동안에는 발화하지 않는다 (60Hz·30Hz·200Hz 동일)', () => {
    expect(slowSweepFires(10, 1000 / 60)).toBe(false);
    expect(slowSweepFires(10, 1000 / 30)).toBe(false);
    expect(slowSweepFires(10, 1000 / 200)).toBe(false);
  });

  it('초당 6°로 천천히 움직이는 중에도 발화하지 않는다 (드리프트 검사)', () => {
    expect(slowSweepFires(6, 1000 / 60)).toBe(false);
  });

  it('거의 멈춘 자세(초당 1°)는 유지로 인정한다', () => {
    expect(slowSweepFires(1, 1000 / 60)).toBe(true);
  });

  it('확정값은 유지 구간의 중앙값 — 구간 안의 한 표본 튐에 끌려가지 않는다', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    let res = null;
    for (let t = 0; t <= 1000; t += 16) {
      const deg = t === 400 ? 93 : 90 + (t % 32 ? 0.3 : -0.3); // 400ms 에 +3° 튐
      const r = d.push(deg, t);
      if (r.fired) res = r;
    }
    expect(res).not.toBeNull();
    expect(res.angle).toBeGreaterThan(89.5);
    expect(res.angle).toBeLessThan(90.5);
  });

  it('유지 중 큰 튐이 나오면 창이 다시 시작되어 곧바로 발화하지 않는다', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    let fired = false;
    for (let t = 0; t <= 700; t += 16) d.push(90, t);
    const r = d.push(110, 716); // 20° 튐
    fired = r.fired;
    expect(fired).toBe(false);
    expect(r.heldMs).toBe(0);
  });

  it('표본이 너무 적으면(센서 끊김) 시간만 지나도 발화하지 않는다', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    expect(d.push(90, 0).fired).toBe(false);
    expect(d.push(90, 900).fired).toBe(false); // 표본 2개뿐
  });

  it('rearm 후에도 바로 재발화하지 않는다', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    for (let t = 0; t <= 900; t += 16) d.push(90, t);
    expect(d.hasFired()).toBe(true);
    d.rearm();
    expect(d.push(90, 920).fired).toBe(false);
  });
});

describe('createPeakTracker — 최대각은 창 중앙값의 최고치', () => {
  it('1~2표본 스파이크는 최대각이 되지 않는다', () => {
    const p = createPeakTracker({ windowMs: 300, minSamples: 5 });
    for (let t = 0; t <= 600; t += 16) {
      const deg = t === 320 || t === 336 ? 140 : 80; // 2표본 튐
      p.push(deg, t);
    }
    expect(p.peak()).toBeCloseTo(80, 5);
  });

  it('실제로 0.3초 이상 도달한 값은 최대각이 된다', () => {
    const p = createPeakTracker({ windowMs: 300, minSamples: 5 });
    for (let t = 0; t <= 800; t += 16) p.push(t < 400 ? 50 : 92, t);
    expect(p.peak()).toBeCloseTo(92, 5);
  });

  it('null(신뢰 불가 구간)은 창을 비운다 — 직후 표본 몇 개로는 갱신되지 않는다', () => {
    const p = createPeakTracker({ windowMs: 300, minSamples: 5 });
    for (let t = 0; t <= 400; t += 16) p.push(50, t);
    p.push(null, 416);
    for (let t = 432; t <= 480; t += 16) p.push(120, t); // 4표본(5표본 미만)
    expect(p.peak()).toBeCloseTo(50, 5);
  });

  it('음수 각(반대 방향)도 크기로 추적한다', () => {
    const p = createPeakTracker({ windowMs: 300, minSamples: 5 });
    for (let t = 0; t <= 400; t += 16) p.push(-70, t);
    expect(p.peak()).toBeCloseTo(70, 5);
  });
});

describe('estimateTiltErrorDeg — 폰 비틀림 예상 오차(각도별)', () => {
  // 폰이 굴러 x축이 φ 만큼 들린 경우의 중력벡터(실제 각 θ)
  const rolled = (thetaDeg, phiDeg, g = 9.8) => {
    const th = thetaDeg * RAD, ph = phiDeg * RAD;
    return [g * Math.sin(th) * Math.sin(ph), g * Math.cos(th), g * Math.sin(th) * Math.cos(ph)];
  };

  it('정렬되어 있으면(gx=0) 오차 0', () => {
    const th = 50 * RAD;
    expect(estimateTiltErrorDeg(0, 9.8 * Math.cos(th), 9.8 * Math.sin(th))).toBeCloseTo(0, 5);
  });

  it('θ=45°·φ=39°(과거 경고 0.45 직전)는 약 7° 오차로 계산된다', () => {
    const [gx, gy, gz] = rolled(45, 39);
    expect(gx / Math.hypot(gx, gy, gz)).toBeLessThan(0.45); // 과거 기준으로는 경고 안 뜸
    const err = estimateTiltErrorDeg(gx, gy, gz);
    expect(err).toBeGreaterThan(6.5);
    expect(err).toBeLessThan(8);
  });

  it('같은 비틀림이라도 각도가 작으면 오차가 작다(각도 의존)', () => {
    const big = estimateTiltErrorDeg(...rolled(60, 25));
    const small = estimateTiltErrorDeg(...rolled(20, 25));
    expect(big).toBeGreaterThan(small);
  });

  it('시작 자세(θ≈0)에서 gx 가 조금 있어도 경고 수준 오차가 나오지 않는다', () => {
    // 폰이 살짝 돌아 놓인 0점 자세: gx/|g| ≈ 0.1
    const err = estimateTiltErrorDeg(0.98, 9.75, 0);
    expect(err).toBeLessThan(1);
  });

  it('무효 표본은 null', () => {
    expect(estimateTiltErrorDeg(0, 0, 0)).toBeNull();
    expect(estimateTiltErrorDeg(NaN, 1, 1)).toBeNull();
  });
});

describe('sensorConfidence / alphaForDt / median', () => {
  it('깨끗한 측정이 흔들린 측정보다 신뢰도가 높고, 1.0 을 넘지 않는다', () => {
    const clean = sensorConfidence({ zeroRange: 0.3, spread: 0.8, tiltErr: 0.5, manual: false });
    const messy = sensorConfidence({ zeroRange: 1.9, spread: 4, tiltErr: 3.5, manual: true });
    expect(clean).toBeGreaterThan(messy);
    expect(clean).toBeLessThanOrEqual(0.95);
    expect(messy).toBeGreaterThanOrEqual(0.3);
  });

  it('수동 확정은 자동(유지 확인)보다 낮다', () => {
    expect(sensorConfidence({ manual: true })).toBeLessThan(sensorConfidence({ manual: false }));
  });

  it('alphaForDt — 공칭 간격에서는 원래 알파, 간격이 짧으면 작아진다(같은 시간상수)', () => {
    expect(alphaForDt(0.08, 16.7)).toBeCloseTo(0.08, 5);
    const a5 = alphaForDt(0.08, 5);
    expect(a5).toBeLessThan(0.08);
    // 5ms 간격으로 16.7/5 번 적용한 결과 ≈ 16.7ms 간격 1번 적용
    expect(1 - Math.pow(1 - a5, 16.7 / 5)).toBeCloseTo(0.08, 4);
  });

  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([null, 5, NaN])).toBe(5);
  });
});

describe('고니오메타 화면 배선 (소스 확인)', () => {
  const g = read('ai-measure/menus/RomSensorGoniometer.jsx');
  const t = read('ai-measure/core/sensorTilt.js');

  it('0점 허용 흔들림은 2° 이하로 좁혔다', () => {
    expect(g).toMatch(/ZERO_MAX_WOBBLE = 2\b/);
  });
  it('최대각은 창 중앙값 추적기, 자동 확정값은 유지 구간 중앙값을 쓴다', () => {
    expect(g).toMatch(/createPeakTracker/);
    expect(g).toMatch(/plateauRef/);
    expect(g).toMatch(/pl\.angle/);
  });
  it('비틀림은 예상 오차(히스테리시스)로, 동작 가속은 0점 기준 편차로 거른다', () => {
    expect(g).toMatch(/TILT_ERR_WARN/);
    expect(g).toMatch(/TILT_ERR_CLEAR/);
    expect(g).toMatch(/ACC_DEV_MAX/);
    expect(g).toMatch(/reliable/);
  });
  it('저장 신뢰도는 고정 1.0 이 아니라 측정 품질에서 산출해 보낸다', () => {
    expect(g).toMatch(/sensorConfidence\(/);
    expect(g).toMatch(/quality: qualityInfo/);
  });
  it('트래커는 표본 간격에 맞춰 평활 알파를 환산한다', () => {
    expect(t).toMatch(/alphaForDt\(gravityAlpha, dtMs\)/);
    expect(t).toMatch(/alphaForDt\(angleAlpha, dtMs\)/);
  });
});
