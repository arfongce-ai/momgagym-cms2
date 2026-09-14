import { describe, it, expect } from 'vitest';
import {
  angleAt, OneEuroFilter, Resampler, GaitCycleTracker,
  jointAnglesFromPose, AngleAccumulator, pelvisRelativeFeet, cameraAngleQuality,
  detectOrientation, OrientationVoter, BiomechAccumulator, DynamicKneeAlignmentTracker,
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

  // 실제 보행(양발 교대) 스텝 수 검증 — 좌/우 발을 각각 세어 절반 누락되지 않음.
  // 1 stride/sec 를 4초 → 2 steps/sec × 4s = 8 스텝, 케이던스 ≈ 120 spm.
  it('counts BOTH feet in alternating gait (no ~half undercount)', () => {
    const g = new GaitCycleTracker({ minStepIntervalMs: 200, minCutoff: 1.5, beta: 0.02 });
    let ts = 0;
    const altLm = (tt) => {
      const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
      a[23] = { x: 0.45, y: 0.5, visibility: 0.9 }; a[24] = { x: 0.55, y: 0.5, visibility: 0.9 };
      const L = 0.12 * Math.sin(tt * 2 * Math.PI * 1);          // 왼발
      const R = 0.12 * Math.sin(tt * 2 * Math.PI * 1 + Math.PI); // 오른발(180° 위상차)
      a[27] = { x: 0.5 + L, y: 0.75, visibility: 0.9 }; a[28] = { x: 0.5 + R, y: 0.75, visibility: 0.9 };
      a[31] = { x: 0.52 + L, y: 0.82, visibility: 0.9 }; a[32] = { x: 0.52 + R, y: 0.82, visibility: 0.9 };
      a[29] = { x: 0.5 + L, y: 0.8, visibility: 0.9 }; a[30] = { x: 0.5 + R, y: 0.8, visibility: 0.9 };
      return a;
    };
    for (let i = 0; i < 240; i++) { ts += 1000 / 60; g.push(pelvisRelativeFeet(altLm(i / 60)), ts); }
    const s = g.summary();
    // 8 스텝 근처(양발 모두 카운트). 한쪽만 세던 옛 로직이면 ~4 로 절반이 됨.
    expect(s.totalSteps).toBeGreaterThanOrEqual(7);
    expect(s.totalSteps).toBeLessThanOrEqual(9);
    expect(s.averageCadenceSpm).toBeGreaterThan(100);
    expect(s.averageCadenceSpm).toBeLessThan(140);
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

// ── 촬영 방향 감지 (후면 감지 개선) ──
describe('detectOrientation (히스테리시스)', () => {
  // 어깨/골반 너비와 몸통높이로 측면(좁음) vs 후면(넓음) 판정
  const pose = ({ width, vis = 0.95 }) => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: vis }));
    a[11] = { x: 0.5 - width / 2, y: 0.3, visibility: vis };
    a[12] = { x: 0.5 + width / 2, y: 0.3, visibility: vis };
    a[23] = { x: 0.5 - width / 2, y: 0.6, visibility: vis };
    a[24] = { x: 0.5 + width / 2, y: 0.6, visibility: vis };
    return a;
  };

  it('넓은 어깨/골반 → 후면(back)으로 감지', () => {
    const o = detectOrientation(pose({ width: 0.25 })); // ratio ~0.83
    expect(o.view).toBe('back');
  });

  it('좁은 어깨/골반 → 측면(side)으로 감지', () => {
    const o = detectOrientation(pose({ width: 0.03 })); // ratio ~0.1
    expect(o.view).toBe('side');
  });

  it('가시성이 낮으면 unknown (오판 방지)', () => {
    const o = detectOrientation(pose({ width: 0.25, vis: 0.2 }));
    expect(o.view).toBe('unknown');
  });

  it('밴드 내 애매한 값은 직전 판정을 유지(떨림 방지)', () => {
    // 경계 부근 너비 → prevView 따라감
    const amb = pose({ width: 0.12 }); // ratio ~ 0.36 (sideMax 0.30 ~ backMin 0.42 사이)
    const asBack = detectOrientation(amb, 'back');
    const asSide = detectOrientation(amb, 'side');
    expect(asBack.view).toBe('back');
    expect(asSide.view).toBe('side');
  });

  it('OrientationVoter 다수결로 안정 판정', () => {
    const voter = new OrientationVoter();
    for (let i = 0; i < 5; i++) voter.push(pose({ width: 0.25 })); // back
    voter.push(pose({ width: 0.03 })); // side 1회(노이즈)
    expect(voter.decide()).toBe('back');
  });
});

// ── 골반 낙하(Trendelenburg) / 광각 보행(step width) 판정 ──
// 어깨 y=0.3, 발목 y=0.9 → bodyScale=0.6. 골반 y차이·발목 간격을 이 스케일로
// 정규화한 값이 GAIT_TUNING의 pelvicDrop*/stepWidth* 임계값과 비교된다.
describe('BiomechAccumulator.pelvicDropAssessment / stepWidthAssessment', () => {
  const frame = ({ leftHipY = 0.6, rightHipY = 0.6, ankleDx = 0.02 } = {}) => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    a[11] = { x: 0.4, y: 0.3, visibility: 0.9 }; a[12] = { x: 0.6, y: 0.3, visibility: 0.9 };
    a[23] = { x: 0.45, y: leftHipY, visibility: 0.9 }; a[24] = { x: 0.55, y: rightHipY, visibility: 0.9 };
    a[25] = { x: 0.45, y: 0.75, visibility: 0.9 }; a[26] = { x: 0.55, y: 0.75, visibility: 0.9 };
    a[27] = { x: 0.5 - ankleDx / 2, y: 0.9, visibility: 0.9 };
    a[28] = { x: 0.5 + ankleDx / 2, y: 0.9, visibility: 0.9 };
    return a;
  };

  it('normal amplitude/width → both normal', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 10; i++) acc.push(frame());
    const s = acc.summary();
    expect(s.pelvicDropAssessment.level).toBe('normal');
    expect(s.stepWidthAssessment.level).toBe('normal');
  });

  it('caution-level left pelvic drop (~4% amplitude)', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 10; i++) acc.push(frame({ leftHipY: i % 2 === 0 ? 0.624 : 0.6 })); // amp ≈ 4.0%
    const s = acc.summary();
    expect(s.pelvicDropAssessment.level).toBe('caution');
    expect(s.pelvicDropAssessment.side).toBe('left');
  });

  it('risk-level right pelvic drop (~7% amplitude)', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 10; i++) acc.push(frame({ rightHipY: i % 2 === 0 ? 0.642 : 0.6 })); // amp ≈ 7.0%
    const s = acc.summary();
    expect(s.pelvicDropAssessment.level).toBe('risk');
    expect(s.pelvicDropAssessment.side).toBe('right');
  });

  it('caution-level step width (~12% of height)', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 10; i++) acc.push(frame({ ankleDx: 0.07 })); // 0.07/0.6 ≈ 11.7%
    const s = acc.summary();
    expect(s.stepWidthAssessment.level).toBe('caution');
  });

  it('risk-level step width (~18% of height)', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 10; i++) acc.push(frame({ ankleDx: 0.11 })); // 0.11/0.6 ≈ 18.3%
    const s = acc.summary();
    expect(s.stepWidthAssessment.level).toBe('risk');
  });

  it('empty accumulator defaults safely (no push)', () => {
    const acc = new BiomechAccumulator();
    const s = acc.summary();
    expect(s.pelvicDropAssessment.side).toBeNull();
    expect(s.pelvicDropAssessment.level).toBe('normal');
    expect(s.stepWidthAssessment.widthPct).toBeNull();
    expect(s.stepWidthAssessment.level).toBe('normal');
    expect(s.scissoringAssessment.crossedPct).toBeNull();
    expect(s.scissoringAssessment.level).toBe('normal');
  });
});

// ── 가위걸음(Scissoring) — 무릎이 골반 좌우 순서를 뒤집는(교차) 프레임 비율 ──
describe('BiomechAccumulator.scissoringAssessment', () => {
  // 골반(23,24)은 항상 정상 순서로 고정, 무릎(25,26)만 교차 여부를 바꾼다.
  const frame = (crossed) => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    a[23] = { x: 0.45, y: 0.5, visibility: 0.9 }; a[24] = { x: 0.55, y: 0.5, visibility: 0.9 };
    a[25] = crossed ? { x: 0.56, y: 0.7, visibility: 0.9 } : { x: 0.45, y: 0.7, visibility: 0.9 };
    a[26] = crossed ? { x: 0.44, y: 0.7, visibility: 0.9 } : { x: 0.55, y: 0.7, visibility: 0.9 };
    return a;
  };

  it('no crossing frames → normal', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 20; i++) acc.push(frame(false));
    expect(acc.summary().scissoringAssessment.level).toBe('normal');
  });

  it('occasional crossing (~5%) → caution', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 20; i++) acc.push(frame(i === 0)); // 1/20 = 5%
    const s = acc.summary().scissoringAssessment;
    expect(s.level).toBe('caution');
    expect(s.crossedPct).toBeCloseTo(5, 0);
  });

  it('frequent crossing (~15%) → risk', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 20; i++) acc.push(frame(i < 3)); // 3/20 = 15%
    const s = acc.summary().scissoringAssessment;
    expect(s.level).toBe('risk');
  });

  it('empty accumulator defaults safely', () => {
    const acc = new BiomechAccumulator();
    const s = acc.summary().scissoringAssessment;
    expect(s.crossedPct).toBeNull();
    expect(s.level).toBe('normal');
  });
});

// ── 동적 무릎 정렬(외반/내반) — postureMath.classifyLegAlignment 재사용 ──
describe('DynamicKneeAlignmentTracker (postureMath.classifyLegAlignment 재사용)', () => {
  const legFrame = ({ hipW = 0.2, kneeW = 0.2, ankleW = 0.2 } = {}) => {
    const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    a[23] = { x: 0.5 - hipW / 2, y: 0.5, visibility: 0.9 }; a[24] = { x: 0.5 + hipW / 2, y: 0.5, visibility: 0.9 };
    a[25] = { x: 0.5 - kneeW / 2, y: 0.7, visibility: 0.9 }; a[26] = { x: 0.5 + kneeW / 2, y: 0.7, visibility: 0.9 };
    a[27] = { x: 0.5 - ankleW / 2, y: 0.9, visibility: 0.9 }; a[28] = { x: 0.5 + ankleW / 2, y: 0.9, visibility: 0.9 };
    return a;
  };

  it('even widths → normal, no peak recorded', () => {
    const t = new DynamicKneeAlignmentTracker();
    for (let i = 0; i < 20; i++) t.push(legFrame());
    const s = t.summary();
    expect(s.status).toBe('normal');
    expect(s.frames).toBe(20);
  });

  it('captures a transient valgus peak amid mostly-normal frames', () => {
    const t = new DynamicKneeAlignmentTracker();
    for (let i = 0; i < 20; i++) {
      // 딱 한 프레임만 뚜렷한 외반(무릎이 좁고 발목이 넓음)을 순간적으로 보인다 —
      // 평균으로는 씻겨나갈 신호라 peak-tracking이 아니면 놓친다.
      t.push(i === 10 ? legFrame({ hipW: 0.2, kneeW: 0.1, ankleW: 0.3 }) : legFrame());
    }
    const s = t.summary();
    expect(s.status).toBe('risk');
    expect(s.key).toBe('genu_valgum');
    expect(s.maxValgusIndex).toBeGreaterThanOrEqual(35);
    expect(s.flaggedFramePct).toBeLessThan(10);
  });

  it('detects genu varum (knees wide, ankles narrow)', () => {
    const t = new DynamicKneeAlignmentTracker();
    for (let i = 0; i < 5; i++) t.push(legFrame({ hipW: 0.2, kneeW: 0.3, ankleW: 0.1 }));
    const s = t.summary();
    expect(s.key).toBe('genu_varum');
    expect(s.status).not.toBe('normal');
  });

  it('empty tracker defaults safely (no push)', () => {
    const t = new DynamicKneeAlignmentTracker();
    const s = t.summary();
    expect(s.frames).toBe(0);
    expect(s.status).toBe('normal');
  });
});
