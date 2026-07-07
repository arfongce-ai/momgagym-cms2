// src/__tests__/goniometer_auto.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2607-5] 고니오메타 자동 측정 — 끝범위에서 각도 변화 없이 0.8초 유지 시
//  자동 확정. 민감도 낮춤(넓은 band)으로 잔떨림엔 리셋되지 않는다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHoldDetector } from '../ai-measure/core/sensorTilt';

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');

describe('createHoldDetector — 끝범위 유지 자동 감지', () => {
  it('band 안에서 holdMs 이상 유지되면 fired=true (0.8초)', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    let fired = false;
    // 90° 근처에서 미세 잔떨림(±1°)으로 900ms 유지
    for (let t = 0; t <= 900; t += 90) {
      const jitter = (t / 90) % 2 ? 0.8 : -0.9; // band(2.5°) 안의 흔들림
      const r = d.push(90 + jitter, t);
      if (r.fired) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('유지 시간이 모자라면 발화하지 않는다', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    let fired = false;
    for (let t = 0; t <= 500; t += 90) {
      const r = d.push(90, t);
      if (r.fired) fired = true;
    }
    expect(fired).toBe(false);
  });

  it('band 를 벗어나면(동작 계속) 창이 리셋되어 발화하지 않는다', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    let fired = false;
    // 매 표본이 band 를 넘게 계속 증가 → 끝범위 유지 아님
    for (let t = 0, deg = 10; t <= 1200; t += 90, deg += 5) {
      const r = d.push(deg, t);
      if (r.fired) fired = true;
    }
    expect(fired).toBe(false);
  });

  it('시작자세(작은 각)에서는 minAbsDeg 미만이라 자동 확정 안 함', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    let fired = false;
    for (let t = 0; t <= 1200; t += 90) {
      const r = d.push(2, t); // |2| < 5
      if (r.fired) fired = true;
    }
    expect(fired).toBe(false);
  });

  it('민감도 낮춤: 넓은 band 는 좁은 band 보다 잔떨림에 강하다', () => {
    const wobble = (t) => 90 + Math.sin(t / 30) * 2; // ±2° 흔들림
    const wide = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    const narrow = createHoldDetector({ band: 0.5, holdMs: 800, minAbsDeg: 5 });
    let wF = false, nF = false;
    for (let t = 0; t <= 1000; t += 90) {
      if (wide.push(wobble(t), t).fired) wF = true;
      if (narrow.push(wobble(t), t).fired) nF = true;
    }
    expect(wF).toBe(true);   // 넓은 band: 유지로 인정 → 자동 확정
    expect(nF).toBe(false);  // 좁은 band: 잔떨림마다 리셋 → 확정 안 됨
  });

  it('null 표본은 유지 창을 끊는다(측정면 이탈 등)', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    let fired = false;
    for (let t = 0; t <= 1000; t += 90) {
      const deg = t === 450 ? null : 90; // 중간에 신호 끊김
      const r = d.push(deg, t);
      if (r.fired) fired = true;
    }
    expect(fired).toBe(false);
  });

  it('reset 후 다시 유지하면 재확정 가능', () => {
    const d = createHoldDetector({ band: 2.5, holdMs: 800, minAbsDeg: 5 });
    for (let t = 0; t <= 900; t += 90) d.push(90, t);
    expect(d.hasFired()).toBe(true);
    d.reset();
    expect(d.hasFired()).toBe(false);
  });
});

describe('[2607-5] 고니오메타 UI 자동 측정 배선', () => {
  const g = read('ai-measure/menus/RomSensorGoniometer.jsx');
  it('자동 측정 토글(autoMode)과 0.8초 유지 상수를 갖는다', () => {
    expect(g).toMatch(/const \[autoMode, setAutoMode\] = useState\(true\)/);
    expect(g).toMatch(/AUTO_HOLD_MS = 800/);
    expect(g).toMatch(/createHoldDetector/);
  });
  it('넓은 band 로 민감도를 낮춘다', () => {
    expect(g).toMatch(/AUTO_BAND = 2\.5/);
    expect(g).toMatch(/band: AUTO_BAND/);
  });
  it('유지 완료 시 자동으로 측정완료를 트리거한다', () => {
    expect(g).toMatch(/r\.fired/);
    expect(g).toMatch(/autoFinishRef\.current\?\.\(\)/);
    expect(g).toMatch(/finishMeasurement\(true\)/);
  });
  it('자동 확정 진행률(holdPct) 표시가 있다', () => {
    expect(g).toMatch(/holdPct/);
    expect(g).toMatch(/끝범위 유지 중/);
  });
  it('수동 완료 경로도 유지된다(자동/수동 병행)', () => {
    expect(g).toMatch(/finishMeasurement\(false\)/);
  });
});
