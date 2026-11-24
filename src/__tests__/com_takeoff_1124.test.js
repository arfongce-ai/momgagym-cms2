import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pelvisTakeoffVelocity, buildComTakeoff, COM_TUNING } from '../ai-measure/core/comTakeoff';
import { StandingCalibrator, JumpFlightTracker } from '../ai-measure/core/jumpBiomechanics.js';

// 정규화 y 1.0 = 200cm 라고 두고, 이륙 직전 골반이 v(m/s)로 올라가는 샘플을 만든다.
const SCALE = 200;
const ramp = (v, fps, takeoffMs, n = 8) => {
  const dt = 1000 / fps; const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const tMs = takeoffMs - i * dt;
    out.push({ tMs, y: 0.6 - (v * 100 / SCALE) * ((tMs - takeoffMs) / 1000) });
  }
  return out;
};

describe('CMJ 이륙속도 참고값 (2026-11-24)', () => {
  it('일정 속도로 올라가는 골반에서 속도를 되찾는다(60fps)', () => {
    const r = pelvisTakeoffVelocity(ramp(2.8, 60, 1000), SCALE, 1000);
    expect(r.velocity).toBeCloseTo(2.8, 2);
    expect(r.fps).toBe(60);
  });
  it('체공시간 속도와 비슷하고 60fps 면 신뢰 ok', () => {
    const c = buildComTakeoff(ramp(2.8, 60, 1000), SCALE, 2.7, 1000);
    expect(c.confidence).toBe('ok');
    expect(c.gapPct).toBeLessThan(5);
    expect(c.basis).toBe('pelvis');
  });
  it('30fps 면 값은 나오되 신뢰 낮음(low_fps)', () => {
    const c = buildComTakeoff(ramp(2.8, 30, 1000, 6), SCALE, 2.8, 1000);
    expect(c).not.toBeNull();
    expect(c.confidence).toBe('low');
    expect(c.reasons).toContain('low_fps');
  });
  it('체공시간 속도와 25% 넘게 어긋나면 gap_large', () => {
    const c = buildComTakeoff(ramp(2.0, 60, 1000), SCALE, 3.0, 1000);
    expect(c.reasons).toContain('gap_large');
    expect(c.confidence).toBe('low');
  });
  it('샘플이 부족하거나 위로 안 올라가면 null 또는 low — 0으로 만들지 않는다', () => {
    expect(buildComTakeoff(ramp(2.8, 60, 1000).slice(-2), SCALE, 2.8, 1000)).toBeNull();
    expect(buildComTakeoff([], SCALE, 2.8, 1000)).toBeNull();
    expect(buildComTakeoff(ramp(2.8, 60, 1000), null, 2.8, 1000)).toBeNull();
    const flat = ramp(0, 60, 1000);
    expect(buildComTakeoff(flat, SCALE, 2.8, 1000).reasons).toContain('upward_velocity_missing');
  });
  it('허용 오차는 기존 골반변위 교차검증 값(25%)과 같다', () => {
    expect(COM_TUNING.gapOkPct).toBe(25);
  });
});

describe('JumpFlightTracker — 이륙 직전 골반 샘플을 모아 comTakeoff 를 낸다', () => {
  const lm = (feetY, pelvisY) => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95 }));
    a[0] = { x: 0.5, y: 0.1, visibility: 0.95 };
    a[23] = { x: 0.45, y: pelvisY, visibility: 0.95 };
    a[24] = { x: 0.55, y: pelvisY, visibility: 0.95 };
    a[27] = { x: 0.45, y: feetY, visibility: 0.95 };
    a[28] = { x: 0.55, y: feetY, visibility: 0.95 };
    return a;
  };
  it('60fps 합성 점프에서 comTakeoff 가 만들어지고 valid 판정은 그대로다', () => {
    const calib = new StandingCalibrator({ heightCm: 170 });
    for (let i = 0; i < 12; i++) calib.push(lm(0.9, 0.6));
    const tr = new JumpFlightTracker(calib.result);
    tr.calibHeightCm = 170;
    const dt = 1000 / 60; let t = 0;
    // 서 있기
    for (let i = 0; i < 20; i++) { tr.push(lm(0.9, 0.6), t); t += dt; }
    // 이륙 직전 상승(골반이 올라간다) 후 공중(체공 약 0.5초)
    const scale = calib.result.scaleCmPerY;
    const vUp = 2.4; // m/s
    for (let i = 0; i < 10; i++) { // 골반만 올라가는 구간(발은 아직 지면)
      tr.push(lm(0.9, 0.6 - (vUp * 100 / scale) * (i * dt / 1000)), t); t += dt;
    }
    const flightFrames = Math.round(500 / dt);
    for (let i = 0; i < flightFrames; i++) { tr.push(lm(0.7, 0.45), t); t += dt; }
    for (let i = 0; i < 10; i++) { tr.push(lm(0.9, 0.6), t); t += dt; }
    const sum = tr.summary({ heightCm: 170 });
    expect(sum.valid).toBe(true);
    expect(sum.comTakeoff).toBeTruthy();
    expect(sum.comTakeoff.velocity).toBeGreaterThan(0);
    expect(typeof sum.takeoffVelocity).toBe('number');
  });
  it('저장·표시 연결: CMJ 에서만 저장, 리포트 블록 있음', () => {
    const hub = readFileSync('src/ai-measure/menus/JumpAnalysisHub.jsx', 'utf8');
    expect(hub).toContain("withRecord.jumpSubType !== 'cmj' && 'comTakeoff' in withRecord");
    const dash = readFileSync('src/ai-measure/menus/JumpReportDashboard.jsx', 'utf8');
    expect(dash).toContain('data-testid="com-takeoff-block"');
  });
});
