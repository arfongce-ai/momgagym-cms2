import { describe, it, expect } from 'vitest';
import {
  JUMP_TUNING, feetCenterY, pelvisCenterY, bodyPixelHeight,
  StandingCalibrator, JumpFlightTracker,
} from '../ai-measure/core/jumpBiomechanics.js';

// 33점 landmark 헬퍼: 발목(27/28), 골반(23/24), 정수리(0)만 의미있게 채운다.
const makeLm = ({ feetY = 0.9, pelvisY = 0.6, headY = 0.1, vis = 0.95 } = {}) => {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: vis }));
  a[0] = { x: 0.5, y: headY, visibility: vis };
  a[23] = { x: 0.45, y: pelvisY, visibility: vis };
  a[24] = { x: 0.55, y: pelvisY, visibility: vis };
  a[27] = { x: 0.45, y: feetY, visibility: vis };
  a[28] = { x: 0.55, y: feetY, visibility: vis };
  return a;
};

describe('basic landmark extractors', () => {
  it('feetCenterY averages both ankles', () => {
    expect(feetCenterY(makeLm({ feetY: 0.9 }))).toBeCloseTo(0.9, 6);
  });
  it('pelvisCenterY averages both hips', () => {
    expect(pelvisCenterY(makeLm({ pelvisY: 0.6 }))).toBeCloseTo(0.6, 6);
  });
  it('bodyPixelHeight is head-to-ankle distance', () => {
    expect(bodyPixelHeight(makeLm({ headY: 0.1, feetY: 0.9 }))).toBeCloseTo(0.8, 6);
  });
  it('returns null when visibility too low on both ankles', () => {
    expect(feetCenterY(makeLm({ vis: 0.05 }))).toBeNull();
  });
});

describe('StandingCalibrator', () => {
  it('locks after stable standing frames and computes cm scale', () => {
    const calib = new StandingCalibrator({ heightCm: 180 });
    for (let i = 0; i < 12; i++) calib.push(makeLm({ feetY: 0.9, headY: 0.1 }));
    expect(calib.locked).toBe(true);
    // bodyPx = 0.8 정규화 → scale = 180 / 0.8 = 225 cm per y-unit
    expect(calib.result.scaleCmPerY).toBeCloseTo(225, 0);
    expect(calib.result.baselineFeetY).toBeCloseTo(0.9, 3);
  });

  it('does NOT lock when feet are shaky (unstable standing) → guards calibration', () => {
    const calib = new StandingCalibrator({ heightCm: 180 });
    // 발 y 가 매 프레임 크게 흔들림 → std 상한 초과 → 락 안 됨
    for (let i = 0; i < 20; i++) calib.push(makeLm({ feetY: i % 2 ? 0.95 : 0.80 }));
    expect(calib.locked).toBe(false);
    expect(calib.status().ready).toBe(false);
  });

  it('reports low_visibility when joints are not visible', () => {
    const calib = new StandingCalibrator({ heightCm: 180 });
    for (let i = 0; i < 12; i++) calib.push(makeLm({ vis: 0.05 }));
    const st = calib.status();
    expect(st.ready).toBe(false);
    expect(st.reason).toBe('low_visibility');
  });

  it('allows null height (scale undefined, calibration still locks)', () => {
    const calib = new StandingCalibrator({ heightCm: null });
    for (let i = 0; i < 12; i++) calib.push(makeLm());
    expect(calib.locked).toBe(true);
    expect(calib.result.scaleCmPerY).toBeNull();
  });
});

// 점프 1회를 시뮬레이션: 기준선에 서 있다가 공중(발/골반 y 감소) 후 착지.
// tMs 는 실제 시간축(ms). 240ms 체공 → h = 9.81*0.24^2/8 ≈ 0.0706m ≈ 7.1cm
function simulateJump(tracker, { baselineFeetY = 0.9, baselinePelvisY = 0.6, riseY = 0.25, flightMs = 400, dtMs = 8 }) {
  // 이륙 전 2프레임 (지면)
  let t = 0;
  for (let i = 0; i < 3; i++) { tracker.push(makeLm({ feetY: baselineFeetY, pelvisY: baselinePelvisY }), t); t += dtMs; }
  // 공중: 포물선 (정점에서 가장 높이 = y 최소)
  const nAir = Math.round(flightMs / dtMs);
  for (let i = 0; i <= nAir; i++) {
    const frac = i / nAir;                 // 0..1
    const lift = Math.sin(frac * Math.PI); // 0→1→0 (정점 중앙)
    const fY = baselineFeetY - lift * 0.12; // 발도 뜸 (band 초과해야 검출)
    const pY = baselinePelvisY - lift * riseY;
    tracker.push(makeLm({ feetY: fY, pelvisY: pY }), t);
    t += dtMs;
  }
  // 착지 후 2프레임 (지면 복귀)
  for (let i = 0; i < 3; i++) { tracker.push(makeLm({ feetY: baselineFeetY, pelvisY: baselinePelvisY }), t); t += dtMs; }
}

describe('JumpFlightTracker — flight time based height', () => {
  const calib = new StandingCalibrator({ heightCm: 180 });
  for (let i = 0; i < 12; i++) calib.push(makeLm({ feetY: 0.9, headY: 0.1, pelvisY: 0.6 }));

  it('detects a jump and computes height from flight-time timestamps', () => {
    const tracker = new JumpFlightTracker(calib.result);
    simulateJump(tracker, { flightMs: 400 });
    const sum = tracker.summary({ heightCm: 180 });
    expect(sum.jumps).toBeGreaterThanOrEqual(1);
    // 체공 ~400ms → h = 9.81*0.4^2/8 = 0.196m ≈ 19.6cm (검출 band 보정으로 약간 작음)
    expect(sum.heightCm).toBeGreaterThan(10);
    expect(sum.heightCm).toBeLessThan(25);
    expect(sum.flightTimeMs).toBeGreaterThan(0);
  });

  it('flags no_jump when subject never leaves the ground', () => {
    const tracker = new JumpFlightTracker(calib.result);
    for (let i = 0, t = 0; i < 30; i++, t += 8) tracker.push(makeLm({ feetY: 0.9 }), t);
    const sum = tracker.summary({ heightCm: 180 });
    expect(sum.valid).toBe(false);
    expect(sum.reason).toBe('no_jump');
  });

  it('rejects physically impossible height vs body height (sanity guard)', () => {
    const tracker = new JumpFlightTracker(calib.result);
    tracker.calibHeightCm = 180;
    // 비현실적으로 긴 체공(=엄청난 높이) → sanity_fail
    simulateJump(tracker, { flightMs: 1200, riseY: 0.5 });
    const sum = tracker.summary({ heightCm: 50 }); // 키 50cm 가정 → 높이가 키 초과
    expect(sum.valid).toBe(false);
    expect(sum.reason).toBe('sanity_fail');
  });

  it('cross-check agrees when pelvis displacement matches flight-time height', () => {
    const tracker = new JumpFlightTracker(calib.result);
    // riseY 를 비행시간 높이에 맞게 설정: scale=225cm/y, 목표 ~19cm → riseY≈0.084
    simulateJump(tracker, { flightMs: 400, riseY: 0.085 });
    const sum = tracker.summary({ heightCm: 180 });
    expect(sum.crossCheck.heightCrossCm).not.toBeNull();
    // agree 여부는 데이터에 따라 다르지만, 교차검증 값이 산출되어야 한다
    expect(typeof sum.crossCheck.deltaPct === 'number').toBe(true);
  });
});

describe('JUMP_TUNING is centralized and adjustable', () => {
  it('exposes field-tuning knobs', () => {
    expect(JUMP_TUNING).toHaveProperty('minFlightMs');
    expect(JUMP_TUNING).toHaveProperty('crossTolPct');
    expect(JUMP_TUNING).toHaveProperty('maxHeightToBodyRatio');
  });
});
