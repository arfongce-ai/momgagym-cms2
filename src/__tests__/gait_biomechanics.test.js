import { describe, it, expect } from 'vitest';
import {
  angleAt, MovingAverageFilter, GaitCycleTracker,
  jointAnglesFromPose, AngleAccumulator, hipRelativeFootMetric,
} from '../ai-measure/core/gaitBiomechanics.js';

const rot = (p, deg) => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

describe('angleAt (rotation-invariant)', () => {
  it('computes a right angle', () => {
    expect(Math.round(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }))).toBe(90);
  });
  it('is invariant under camera rotation (handheld tilt)', () => {
    const a = { x: 0, y: 1 }, b = { x: 0, y: 0 }, c = { x: 1, y: 0 };
    const base = angleAt(a, b, c);
    const tilted = angleAt(rot(a, 37), rot(b, 37), rot(c, 37));
    expect(Math.abs(base - tilted)).toBeLessThan(1e-6);
  });
  it('returns null on missing point', () => {
    expect(angleAt(null, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe('MovingAverageFilter', () => {
  it('averages within the window and slides', () => {
    const f = new MovingAverageFilter(3);
    f.push(0); f.push(3);
    expect(f.push(6)).toBe(3);
    expect(f.push(9)).toBe(6);
  });
});

// 2Hz 보행 시뮬: 발끝이 골반 원점 기준 전후로 진동
function makeLandmarks(t, offsetX = 0, offsetY = 0, k = 1) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const sc = (p) => ({ x: (p.x - 0.5) * k + 0.5 + offsetX, y: (p.y - 0.5) * k + 0.5 + offsetY, visibility: 0.9 });
  lm[23] = sc({ x: 0.45, y: 0.5 });
  lm[24] = sc({ x: 0.55, y: 0.5 });
  const swing = 0.12 * Math.sin(t * 2 * Math.PI * 2);
  lm[31] = sc({ x: 0.5 + swing, y: 0.8 });
  lm[32] = sc({ x: 0.5, y: 0.78 });
  return lm;
}

function runSim(offsetX = 0, offsetY = 0, k = 1) {
  const g = new GaitCycleTracker({ windowSize: 3, minStepIntervalMs: 200 });
  let ts = 0;
  for (let i = 0; i < 240; i++) {
    const t = i / 60;
    ts += 1000 / 60;
    g.push(hipRelativeFootMetric(makeLandmarks(t, offsetX, offsetY, k)), ts);
  }
  return g.summary();
}

describe('GaitCycleTracker (environment-agnostic)', () => {
  it('counts ~8 steps for a 2 Hz gait over 4 s', () => {
    const s = runSim();
    expect(s.totalSteps).toBeGreaterThanOrEqual(6);
    expect(s.totalSteps).toBeLessThanOrEqual(10);
  });
  it('produces identical steps when the whole frame is panned (no absolute coords)', () => {
    expect(runSim(0, 0).totalSteps).toBe(runSim(0.3, 0.2).totalSteps);
  });
  it('produces identical steps when the subject is zoomed (pelvis-width normalized)', () => {
    expect(runSim(0, 0).totalSteps).toBe(runSim(0, 0, 1.5).totalSteps);
  });
  it('splits stance/swing to 100% and reports a sane cadence', () => {
    const s = runSim();
    expect(s.stancePct + s.swingPct).toBe(100);
    expect(s.averageCadenceSpm).toBeGreaterThan(90);
    expect(s.averageCadenceSpm).toBeLessThan(150);
  });
});

describe('jointAnglesFromPose / AngleAccumulator', () => {
  it('computes a knee angle from a 33-point array', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    lm[11] = { x: 0.5, y: 0.2, visibility: 0.9 };
    lm[23] = { x: 0.5, y: 0.4, visibility: 0.9 };
    lm[25] = { x: 0.5, y: 0.6, visibility: 0.9 };
    lm[27] = { x: 0.5, y: 0.8, visibility: 0.9 };
    lm[31] = { x: 0.5, y: 0.85, visibility: 0.9 };
    expect(jointAnglesFromPose(lm).left.knee).not.toBeNull();
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
