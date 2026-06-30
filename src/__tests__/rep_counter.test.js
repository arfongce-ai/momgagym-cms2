import { describe, it, expect } from 'vitest';
import { createRepCounter, countRepsFromSeries } from '../ai-measure/core/repCounter.js';

function squat(reps, noise = 0, seed = 1) {
  // 결정적 의사난수(테스트 안정성).
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  const out = [];
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i <= 10; i++) out.push(0.4 + 0.3 * (i / 10) + rnd() * noise);
    for (let i = 0; i <= 10; i++) out.push(0.7 - 0.3 * (i / 10) + rnd() * noise);
  }
  return out;
}
function deadlift(reps) {
  const out = [];
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i <= 10; i++) out.push(0.6 - 0.3 * (i / 10));
    for (let i = 0; i <= 10; i++) out.push(0.3 + 0.3 * (i / 10));
  }
  return out;
}

describe('렙 자동 카운터 · 정확도', () => {
  it('스쿼트 1·3·5렙 정확', () => {
    expect(countRepsFromSeries(squat(1))).toBe(1);
    expect(countRepsFromSeries(squat(3))).toBe(3);
    expect(countRepsFromSeries(squat(5))).toBe(5);
  });

  it('데드리프트(상승 먼저)도 정확', () => {
    expect(countRepsFromSeries(deadlift(3))).toBe(3);
  });

  it('노이즈가 있어도 안정적', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(countRepsFromSeries(squat(3, 0.02, seed))).toBe(3);
    }
  });
});

describe('렙 자동 카운터 · 허위 카운트 방지(정직성)', () => {
  it('미세 떨림은 0렙', () => {
    const jitter = [];
    let s = 7;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
    for (let i = 0; i < 100; i++) jitter.push(0.4 + rnd() * 0.03);
    expect(countRepsFromSeries(jitter)).toBe(0);
  });

  it('minTravel 미만의 작은 가동범위는 세지 않음', () => {
    const small = [];
    for (let r = 0; r < 5; r++) {
      for (let i = 0; i <= 5; i++) small.push(0.4 + 0.03 * (i / 5));
      for (let i = 0; i <= 5; i++) small.push(0.43 - 0.03 * (i / 5));
    }
    expect(countRepsFromSeries(small)).toBe(0);
  });

  it('빈/잘못된 입력 안전', () => {
    expect(countRepsFromSeries([])).toBe(0);
    expect(countRepsFromSeries(null)).toBe(0);
    expect(countRepsFromSeries([NaN, undefined, 'x'])).toBe(0);
  });
});

describe('렙 카운터 · 실시간 vs 확정', () => {
  it('확정값(count)은 진행 중 반스윙을 빼고 보수적으로 센다', () => {
    const rc = createRepCounter();
    squat(3).forEach(y => rc.push(y));
    // 마지막 상승이 반전 전이라 확정은 2~3.
    expect(rc.count()).toBeGreaterThanOrEqual(2);
    expect(rc.countWithPending()).toBe(3);
  });

  it('reset 후 0', () => {
    const rc = createRepCounter();
    squat(3).forEach(y => rc.push(y));
    rc.reset();
    expect(rc.count()).toBe(0);
    expect(rc.countWithPending()).toBe(0);
  });
});
