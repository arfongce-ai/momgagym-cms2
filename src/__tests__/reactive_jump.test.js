import { describe, it, expect } from 'vitest';
import {
  RSI_TUNING,
  flightToHeightM,
  rsiGrade,
  computeRSIFromFlights,
} from '../ai-measure/core/reactiveJump.js';

const cycle = (takeoffMs, flightMs) => ({
  takeoffMs,
  landingMs: takeoffMs + flightMs,
  flightMs,
});

const validThreeJumpSet = () => [
  cycle(0, 480),
  cycle(680, 500),
  cycle(1390, 510),
];

describe('reactiveJump helpers', () => {
  it('flightToHeightM: h = g*t^2/8', () => {
    expect(flightToHeightM(0.5)).toBeCloseTo(0.3066, 3);
    expect(flightToHeightM(0)).toBeNull();
    expect(flightToHeightM(-1)).toBeNull();
  });

  it('rsiGrade returns the expected grade labels', () => {
    expect(rsiGrade(3.2).label).toBe('엘리트');
    expect(rsiGrade(2.6).label).toBe('우수');
    expect(rsiGrade(2.1).label).toBe('양호');
    expect(rsiGrade(1.7).label).toBe('보통');
    expect(rsiGrade(0.9).label).toBe('개선 필요');
    expect(rsiGrade(null)).toBeNull();
    expect(rsiGrade(Infinity)).toBeNull();
  });
});

describe('computeRSIFromFlights', () => {
  it('requires at least 3 jumps for RSI stability', () => {
    const r = computeRSIFromFlights([cycle(0, 500), cycle(700, 500)]);
    expect(RSI_TUNING.minCycles).toBe(3);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('need_more_cycles');
  });

  it('rejects empty input', () => {
    expect(computeRSIFromFlights([]).valid).toBe(false);
    expect(computeRSIFromFlights(null).valid).toBe(false);
  });

  it('computes RSI from flight and contact time after 3 jumps', () => {
    const r = computeRSIFromFlights(validThreeJumpSet(), { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.cycles).toBe(2);
    expect(r.contactTimeMs).toBe(200);
    expect(r.flightTimeMs).toBe(500);
    expect(r.rsiBest).toBeCloseTo(2.5, 1);
    expect(r.grade.label).toBeTruthy();
    expect(r.lowFps).toBe(false);
  });

  it('excludes contact times outside the sanity range', () => {
    const flights = [cycle(0, 480), cycle(1680, 500), cycle(3380, 500)];
    const r = computeRSIFromFlights(flights);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('no_valid_contact');
  });

  it('warns when frame interval is closer to 30fps', () => {
    const r = computeRSIFromFlights(validThreeJumpSet(), { frameIntervalMs: 33 });
    expect(r.valid).toBe(true);
    expect(r.lowFps).toBe(true);
  });

  it('does not warn at high frame rates', () => {
    const r = computeRSIFromFlights(validThreeJumpSet(), { frameIntervalMs: 4 });
    expect(r.lowFps).toBe(false);
  });

  it('uses mean RSI when cycle variability is high', () => {
    const flights = [
      cycle(0, 480),
      cycle(680, 500),
      cycle(1430, 450),
    ];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.cycles).toBe(2);
    expect(r.rsiBest).toBeCloseTo(2.5, 1);
    expect(r.cvPct).toBeGreaterThan(15);
    expect(r.rsiBasis).toBe('mean');
    expect(r.rsi).toBeCloseTo(r.rsiMean, 2);
    expect(r.perCycle).toHaveLength(2);
  });

  it('uses best RSI when cycle variability is stable', () => {
    const flights = [
      cycle(0, 500),
      cycle(700, 500),
      cycle(1410, 510),
    ];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.cvPct).toBeLessThanOrEqual(15);
    expect(r.rsiBasis).toBe('best');
    expect(r.rsi).toBeCloseTo(r.rsiBest, 2);
  });

  it('rejects non-side views and accepts side or unspecified view', () => {
    const flights = validThreeJumpSet();
    expect(computeRSIFromFlights(flights, { view: 'back' }).reason).toBe('not_side_view');
    expect(computeRSIFromFlights(flights, { view: 'front' }).reason).toBe('not_side_view');
    expect(computeRSIFromFlights(flights, { view: 'unknown' }).reason).toBe('not_side_view');
    expect(computeRSIFromFlights(flights, { view: 'side', frameIntervalMs: 4 }).valid).toBe(true);
    expect(computeRSIFromFlights(flights, { frameIntervalMs: 4 }).valid).toBe(true);
  });

  it('sorts shuffled jumps by takeoff time before calculating', () => {
    const flights = [cycle(1390, 510), cycle(680, 500), cycle(0, 480)];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.contactTimeMs).toBe(200);
  });
});
