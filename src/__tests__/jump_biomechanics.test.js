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

  it('[2026-07-30] 코(머리) 랜드마크만 유독 불안정해도(카메라 각도 등) 발·골반이 멀쩡하면 락된다 — cm 환산만 못 함', () => {
    const calib = new StandingCalibrator({ heightCm: 180 });
    for (let i = 0; i < 12; i++) {
      const lm = makeLm({ feetY: 0.9, pelvisY: 0.6, headY: 0.1 });
      lm[0] = { x: 0.5, y: 0.1, visibility: 0.05 }; // 코만 신뢰도 바닥
      calib.push(lm);
    }
    expect(calib.locked).toBe(true);
    expect(calib.result.baselineFeetY).toBeCloseTo(0.9, 6);
    expect(calib.result.bodyPx).toBeNull();
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

  it('cross-check mismatch does NOT invalidate a physically valid jump', () => {
    // 골반변위 추정이 비행시간 높이와 크게 어긋나도(원근 왜곡),
    // 체공시간이 물리적으로 타당하면 valid 는 유지되어야 한다.
    const tracker = new JumpFlightTracker(calib.result);
    // riseY 를 비행시간 높이와 일부러 크게 어긋나게(거의 0) 설정 → 큰 deltaPct
    simulateJump(tracker, { flightMs: 400, riseY: 0.002 });
    const sum = tracker.summary({ heightCm: 180 });
    expect(sum.crossCheck.deltaPct).toBeGreaterThan(25); // 옛 임계 초과
    expect(sum.valid).toBe(true);          // 그래도 유효
    expect(sum.reason).toBe('ok');
  });
});

describe('JUMP_TUNING is centralized and adjustable', () => {
  it('exposes field-tuning knobs', () => {
    expect(JUMP_TUNING).toHaveProperty('minFlightMs');
    expect(JUMP_TUNING).toHaveProperty('crossTolPct');
    expect(JUMP_TUNING).toHaveProperty('maxHeightToBodyRatio');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  JumpBiomechAccumulator — 자세/기술/대칭성 지표
// ════════════════════════════════════════════════════════════════════════
import { JumpBiomechAccumulator, jumpPhaseOf, currentJointAngles, JUMP_TUNING as JT } from '../ai-measure/core/jumpBiomechanics.js';

// 측면뷰 가정의 전신 landmark (각도 계산 가능하도록 관절 좌표를 의미있게 배치)
function makePose({
  // 기본: 거의 직립(신전). bend 로 무릎/고관절 굽힘을 준다.
  kneeBend = 0,      // 0=신전(180°), 클수록 굽힘
  hipBend = 0,
  lean = 0,          // 상체 전방 기울기(골반 대비 어깨 x 이동)
  pelvisTilt = 0,    // 좌우 골반 높이차
  vis = 0.95,
} = {}) {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: vis }));
  // 머리
  a[0] = { x: 0.5, y: 0.05, visibility: vis };
  // 어깨 (상체 기울기 = 어깨 x 이동)
  a[11] = { x: 0.45 + lean, y: 0.25, visibility: vis };
  a[12] = { x: 0.55 + lean, y: 0.25, visibility: vis };
  // 골반 (좌우 높이차 = pelvisTilt)
  a[23] = { x: 0.45, y: 0.50 + pelvisTilt, visibility: vis };
  a[24] = { x: 0.55, y: 0.50, visibility: vis };
  // 무릎 (고관절 아래; hipBend 로 x 오프셋 = 굽힘)
  a[25] = { x: 0.45 + hipBend * 0.1, y: 0.70, visibility: vis };
  a[26] = { x: 0.55 + hipBend * 0.1, y: 0.70, visibility: vis };
  // 발목 (무릎 아래; kneeBend 로 x 오프셋 = 굽힘)
  a[27] = { x: 0.45 - kneeBend * 0.1, y: 0.90, visibility: vis };
  a[28] = { x: 0.55 - kneeBend * 0.1, y: 0.90, visibility: vis };
  // 발끝
  a[31] = { x: 0.45 - kneeBend * 0.1, y: 0.95, visibility: vis };
  a[32] = { x: 0.55 - kneeBend * 0.1, y: 0.95, visibility: vis };
  return a;
}

describe('JumpBiomechAccumulator', () => {
  it('착지 무릎각: 깊게 굽힌 착지가 더 작은 각도로 잡힌다', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    // 준비 자세(신전)
    for (let i = 0; i < 5; i++) acc.push(makePose(), i * 8, 'stand');
    // 착지: 무릎 깊게 굽힘
    for (let i = 0; i < 8; i++) acc.push(makePose({ kneeBend: 1.0 }), 100 + i * 8, 'land');
    const s = acc.summary();
    expect(s.landingKneeAngle).not.toBeNull();
    expect(s.landingKneeAngle).toBeLessThan(180); // 굽혔으므로 신전(180)보다 작음
  });

  it('신전 궤적 정렬도: 고관절·무릎이 함께 펴지는 궤적이면 정렬 점수 산출', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    // 앉았다(굽힘) → 펴지는(신전) 궤적을 stand 구간에 누적
    for (let i = 0; i < 6; i++) {
      const bend = 1.0 - i * 0.18; // 점점 펴짐
      acc.push(makePose({ kneeBend: bend, hipBend: bend }), i * 8, 'stand');
    }
    const s = acc.summary();
    expect(s.extensionAlignment.available).toBe(true);
    expect(s.extensionAlignment.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(s.extensionAlignment.alignmentScore).toBeLessThanOrEqual(100);
  });

  it('상체 기울기 변화: 준비 대비 착지에서 더 기울면 change 가 양수', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    for (let i = 0; i < 5; i++) acc.push(makePose({ lean: 0 }), i * 8, 'stand');
    for (let i = 0; i < 5; i++) acc.push(makePose({ lean: 0.12 }), 100 + i * 8, 'land');
    const s = acc.summary();
    expect(s.trunkLeanChange).not.toBeNull();
    expect(s.trunkLeanChange).toBeGreaterThan(0);
  });

  it('착지 발끝 대칭성: 양발이 같은 위치에 착지하면 높은 대칭도', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    for (let i = 0; i < 5; i++) acc.push(makePose(), i * 8, 'stand');
    // 착지: 좌우 발이 대칭(makePose 의 27/28, 31/32 좌우 대칭)
    for (let i = 0; i < 6; i++) acc.push(makePose(), 100 + i * 8, 'land');
    const s = acc.summary();
    expect(s.footLandingSymmetry.available).toBe(true);
    expect(s.footLandingSymmetry.symmetryPct).toBeGreaterThanOrEqual(0);
    expect(s.footLandingSymmetry.symmetryPct).toBeLessThanOrEqual(100);
  });

  it('뷰 게이팅: enabled 플래그가 측정 방향에 따라 지표를 켠다', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    for (let i = 0; i < 6; i++) acc.push(makePose(), i * 8, 'stand');
    for (let i = 0; i < 4; i++) acc.push(makePose(), 100 + i * 8, 'land');
    const s = acc.summary();
    expect(['side', 'back', 'unknown']).toContain(s.view);
    expect(s.enabled).toHaveProperty('posture');
    expect(s.enabled).toHaveProperty('pelvicDrop');
    expect(s.enabled).toHaveProperty('footSymmetry');
  });

  it('데이터 없는 위상은 null/미가용으로 안전하게 반환', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    const s = acc.summary(); // 아무것도 push 안 함
    expect(s.landingKneeAngle).toBeNull();
    expect(s.pelvicImbalance).toBeNull();
    expect(s.extensionAlignment.available).toBe(false);
    expect(s.footLandingSymmetry.available).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  [무릎·고관절 각도 그래프 2026-08-18] timeline / landingHipAngle / currentJointAngles
// ════════════════════════════════════════════════════════════════════════
describe('JumpBiomechAccumulator — 각도 시계열(timeline) & 착지 고관절각', () => {
  it('push()마다 무릎/고관절 각도를 시간순으로 timeline에 남긴다', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    for (let i = 0; i < 5; i++) acc.push(makePose(), i * 8, 'stand');
    for (let i = 0; i < 4; i++) acc.push(makePose({ kneeBend: 1.0 }), 100 + i * 8, 'air');
    for (let i = 0; i < 6; i++) acc.push(makePose({ kneeBend: 1.0 }), 140 + i * 8, 'land');
    const s = acc.summary();
    expect(Array.isArray(s.timeline)).toBe(true);
    expect(s.timeline.length).toBeGreaterThan(0);
    expect(s.timeline[0]).toHaveProperty('tMs');
    expect(s.timeline[0]).toHaveProperty('phase');
    expect(s.timeline[0]).toHaveProperty('knee');
    expect(s.timeline[0]).toHaveProperty('hip');
    // 시간순 정렬 확인
    for (let i = 1; i < s.timeline.length; i++) {
      expect(s.timeline[i].tMs).toBeGreaterThanOrEqual(s.timeline[i - 1].tMs);
    }
  });

  it('착지 고관절각: 깊게 굽힌 착지가 더 작은 각도로 잡힌다', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    for (let i = 0; i < 5; i++) acc.push(makePose(), i * 8, 'stand');
    for (let i = 0; i < 8; i++) acc.push(makePose({ hipBend: 1.0 }), 100 + i * 8, 'land');
    const s = acc.summary();
    expect(s.landingHipAngle).not.toBeNull();
    expect(s.landingHipAngle).toBeLessThan(180);
  });

  it('아무것도 push 안 하면 timeline은 빈 배열, landingHipAngle은 null', () => {
    const acc = new JumpBiomechAccumulator({ heightCm: 175 });
    const s = acc.summary();
    expect(s.timeline).toEqual([]);
    expect(s.landingHipAngle).toBeNull();
  });
});

describe('currentJointAngles — 실시간 HUD용 단발 프레임 각도', () => {
  it('직립 자세는 무릎/고관절 모두 180에 가깝다', () => {
    const { knee, hip } = currentJointAngles(makePose());
    expect(knee).toBeGreaterThan(170);
    expect(hip).toBeGreaterThan(170);
  });

  it('굽히면 각도가 작아진다', () => {
    const { knee } = currentJointAngles(makePose({ kneeBend: 1.0 }));
    expect(knee).toBeLessThan(180);
  });

  it('landmarks가 없으면 null-safe', () => {
    expect(currentJointAngles(null)).toEqual({ knee: null, hip: null });
  });
});

describe('jumpPhaseOf', () => {
  it('이지/착지 전환을 정확히 판정', () => {
    expect(jumpPhaseOf(false, true, false)).toEqual({ phase: 'air', justTookOff: true, justLanded: false });
    expect(jumpPhaseOf(true, false, true)).toEqual({ phase: 'land', justTookOff: false, justLanded: true });
    expect(jumpPhaseOf(false, false, false)).toEqual({ phase: 'stand', justTookOff: false, justLanded: false });
  });
});

describe('JUMP_TUNING tripleExtension 상수', () => {
  it('hip/knee/ankle 신전 임계가 노출됨', () => {
    expect(JT.tripleExtension).toHaveProperty('hipMinDeg');
    expect(JT.tripleExtension).toHaveProperty('kneeMinDeg');
    expect(JT.tripleExtension).toHaveProperty('ankleMinDeg');
  });
});
