import { describe, it, expect } from 'vitest';
import {
  angleAt, OneEuroFilter, Resampler, GaitCycleTracker,
  jointAnglesFromPose, AngleAccumulator, pelvisRelativeFeet, cameraAngleQuality,
} from '../ai-measure/core/gaitBiomechanics.js';

const rot = (p, deg) => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

describe('angleAt (rotation-invariant, handheld tilt)', () => {
  it('computes a right angle', () => {
    expect(Math.round(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }))).toBe(90);
  });
  it('is invariant under camera rotation', () => {
    const a = { x: 0, y: 1 }, b = { x: 0, y: 0 }, c = { x: 1, y: 0 };
    expect(Math.abs(angleAt(a, b, c) - angleAt(rot(a, 40), rot(b, 40), rot(c, 40)))).toBeLessThan(1e-6);
  });
  it('returns null on a missing point', () => {
    expect(angleAt(null, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe('OneEuroFilter', () => {
  it('converges to the DC level while suppressing jitter', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0.01 });
    let out;
    for (let i = 0; i < 120; i++) out = f.filter(1.0 + (i % 2 ? 0.05 : -0.05), i / 60);
    expect(Math.abs(out - 1.0)).toBeLessThan(0.05);
  });
  it('defends against frame drops (huge dt) without exploding', () => {
    const f = new OneEuroFilter();
    f.filter(0, 0);
    const out = f.filter(1, 5);
    expect(Number.isFinite(out)).toBe(true);
  });
});

describe('Resampler (VFR linear interpolation)', () => {
  it('produces a roughly uniform sample count from jittered input', () => {
    const rs = new Resampler(1000 / 60);
    let count = 0, t = 0;
    for (let i = 0; i < 60; i++) { t += i % 2 ? 10 : 24; count += rs.push(t, t / 1000).length; }
    expect(count).toBeGreaterThanOrEqual(50);
    expect(count).toBeLessThanOrEqual(75);
  });
});

describe('cameraAngleQuality (high-angle warning)', () => {
  const lm = (thighScale) => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    a[11] = { x: 0.4, y: 0.3, visibility: 0.9 }; a[12] = { x: 0.6, y: 0.3, visibility: 0.9 };
    a[23] = { x: 0.45, y: 0.5, visibility: 0.9 }; a[24] = { x: 0.55, y: 0.5, visibility: 0.9 };
    a[25] = { x: 0.45, y: 0.5 + 0.2 * thighScale, visibility: 0.9 };
    a[26] = { x: 0.55, y: 0.5 + 0.2 * thighScale, visibility: 0.9 };
    return a;
  };
  it('accepts a normal side view', () => {
    expect(cameraAngleQuality(lm(1.5)).ok).toBe(true);
  });
  it('warns when the phone is held high (thigh foreshortened)', () => {
    const q = cameraAngleQuality(lm(0.3));
    expect(q.ok).toBe(false);
    expect(q.reason).toBe('high_angle');
  });
});

function gaitLm(tt, offX = 0, k = 1) {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const sc = (p) => ({ x: (p.x - 0.5) * k + 0.5 + offX, y: (p.y - 0.5) * k + 0.5, visibility: 0.9 });

  a[23] = sc({ x: 0.45, y: 0.5 }); a[24] = sc({ x: 0.55, y: 0.5 }); // 골반(Hips)

  const sw = 0.12 * Math.sin(tt * 2 * Math.PI * 2); // 2Hz 진동

  // 업그레이드된 알고리즘이 추적할 '발목(Ankle)' 데이터 애니메이션
  a[27] = sc({ x: 0.5 + sw, y: 0.75 }); // 왼쪽 발목
  a[28] = sc({ x: 0.5, y: 0.75 });      // 오른쪽 발목

  a[29] = sc({ x: 0.5 + sw, y: 0.8 }); a[31] = sc({ x: 0.52 + sw, y: 0.82 }); // 왼쪽 뒤꿈치/발끝
  a[30] = sc({ x: 0.5, y: 0.78 }); a[32] = sc({ x: 0.52, y: 0.8 }); // 오른쪽 뒤꿈치/발끝

  return a;
}

function runSim(offX = 0, k = 1) {
  const g = new GaitCycleTracker({ fps: 60, minStepIntervalMs: 200, minCutoff: 1.5, beta: 0.02 });
  let ts = 0;
  for (let i = 0; i < 240; i++) { ts += 1000 / 60; g.push(pelvisRelativeFeet(gaitLm(i / 60, offX, k)), ts); }
  return g.summary();
}

describe('GaitCycleTracker v3 (IC detection, field-grade)', () => {
  it('detects ~8 initial contacts for a 2 Hz gait over 4 s', () => {
    const s = runSim();
    expect(s.totalSteps).toBeGreaterThanOrEqual(6);
    expect(s.totalSteps).toBeLessThanOrEqual(10);
  });
  it('is environment-agnostic (identical when panned)', () => {
    expect(runSim(0).totalSteps).toBe(runSim(0.3).totalSteps);
  });
  it('is scale-agnostic (identical when zoomed)', () => {
    expect(runSim(0).totalSteps).toBe(runSim(0, 1.5).totalSteps);
  });
  it('splits stance/swing to 100% with a sane cadence', () => {
    const s = runSim();
    expect(s.stancePct + s.swingPct).toBe(100);
    expect(s.averageCadenceSpm).toBeGreaterThan(90);
    expect(s.averageCadenceSpm).toBeLessThan(150);
  });
});

describe('jointAnglesFromPose / AngleAccumulator', () => {
  it('computes a knee angle from a 33-point array', () => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    a[11] = { x: 0.5, y: 0.2, visibility: 0.9 }; a[23] = { x: 0.5, y: 0.4, visibility: 0.9 };
    a[25] = { x: 0.5, y: 0.6, visibility: 0.9 }; a[27] = { x: 0.5, y: 0.8, visibility: 0.9 };
    a[31] = { x: 0.5, y: 0.85, visibility: 0.9 };
    expect(jointAnglesFromPose(a).left.knee).not.toBeNull();
  });
  it('accumulates avg and rom', () => {
    const acc = new AngleAccumulator();
    acc.push({ left: { hip: 170, knee: 160, ankle: 90 }, right: { hip: null, knee: null, ankle: null } });
    acc.push({ left: { hip: 150, knee: 140, ankle: 80 }, right: { hip: null, knee: null, ankle: null } });
    const sum = acc.summary();
    expect(sum.hip.avg).toBe(160);
    expect(sum.hip.rom).toBe(20);
  });
});
