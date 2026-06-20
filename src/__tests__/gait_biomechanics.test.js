import { describe, it, expect } from 'vitest';
import {
  angleAt, MovingAverageFilter, GaitCycleTracker,
  jointAnglesFromPose, AngleAccumulator, supportFootY,
} from '../ai-measure/core/gaitBiomechanics.js';

describe('angleAt', () => {
  it('computes a right angle', () => {
    expect(Math.round(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }))).toBe(90);
  });
  it('computes a straight angle', () => {
    expect(Math.round(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }))).toBe(180);
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
  it('ignores null', () => {
    const f = new MovingAverageFilter(2);
    f.push(4);
    expect(f.push(null)).toBe(4);
  });
});

describe('GaitCycleTracker', () => {
  it('detects steps and splits stance/swing on a 2 Hz gait sim', () => {
    const g = new GaitCycleTracker({ windowSize: 3, minStepIntervalMs: 200 });
    let ts = 0;
    for (let i = 0; i < 240; i++) {
      const y = 0.6 + 0.15 * Math.sin((i / 60) * 2 * Math.PI * 2);
      ts += 1000 / 60;
      g.push(y, ts);
    }
    const s = g.summary();
    expect(s.totalSteps).toBeGreaterThanOrEqual(6);
    expect(s.totalSteps).toBeLessThanOrEqual(10);
    expect(s.stancePct + s.swingPct).toBe(100);
    expect(s.averageCadenceSpm).toBeGreaterThan(90);
    expect(s.averageCadenceSpm).toBeLessThan(150);
  });
  it('handles variable frame timing without distorting the ratio', () => {
    const g = new GaitCycleTracker({ windowSize: 3 });
    let ts = 0;
    for (let i = 0; i < 180; i++) {
      const dt = i % 2 ? 12 : 22; // jittered fps
      ts += dt;
      g.push(0.6 + 0.15 * Math.sin((ts / 1000) * 2 * Math.PI * 2), ts);
    }
    const s = g.summary();
    expect(s.stancePct + s.swingPct).toBe(100);
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

describe('supportFootY', () => {
  it('returns the lower foot index y', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    lm[27] = { x: 0.5, y: 0.7, visibility: 0.9 }; // left ankle lower
    lm[28] = { x: 0.5, y: 0.5, visibility: 0.9 };
    lm[31] = { x: 0.5, y: 0.75, visibility: 0.9 };
    lm[32] = { x: 0.5, y: 0.55, visibility: 0.9 };
    expect(supportFootY(lm)).toBe(0.75);
  });
});
