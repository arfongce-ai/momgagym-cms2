import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  analyzeOlyLift, angleAt, trunkLeanDeg, pickSideJoints, betterSide, frontalRatio, isOlyType,
} from '../ai-measure/core/olyLiftAnalysis';

const CM = 170; // cmPerRatio (키 170cm = 화면 높이 1.0)
const dt = 33;

// 합성 한 동작: 바 높이(cm) 곡선과 고관절 y(아래로+)를 만든다.
function sample(ts, barCm, hipY, kneeAngleBend = 0) {
  const barY = 0.8 - barCm / CM;            // 시작 높이 0.8(정규화 y)
  const hip = { x: 0.5, y: hipY, v: 0.95 };
  const shoulder = { x: 0.5 + 0.02, y: hipY - 0.3, v: 0.95 };
  const knee = { x: 0.5 + 0.1 * kneeAngleBend, y: hipY + 0.22, v: 0.95 };
  const ankle = { x: 0.5, y: hipY + 0.44, v: 0.95 };
  return { ts, bar: { x: 0.5, y: barY }, j: { s: shoulder, h: hip, k: knee, a: ankle }, frontal: 0.2 };
}
function snatchSamples() {
  const out = []; let t = 0;
  for (let i = 0; i < 10; i++, t += dt) out.push(sample(t, 0, 0.55));            // 세트
  for (let i = 0; i < 15; i++, t += dt) out.push(sample(t, (i + 1) * 3, 0.55 - i * 0.004)); // 1차 풀 0→45cm
  for (let i = 0; i < 8; i++, t += dt) out.push(sample(t, 45 + (i + 1) * 12, 0.5 - i * 0.01)); // 2차 풀 빠르게 +96
  for (let i = 0; i < 12; i++, t += dt) out.push(sample(t, 141 + (i + 1) * 3, 0.42 + i * 0.012)); // 바 밑으로
  for (let i = 0; i < 20; i++, t += dt) out.push(sample(t, 177, 0.56 - i * 0.008));       // 일어섬
  return out;
}

describe('각도 계산', () => {
  it('일직선이면 180°, 직각이면 90°', () => {
    expect(Math.round(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }))).toBe(180);
    expect(Math.round(angleAt({ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 2 }))).toBe(90);
  });
  it('몸통 기울기: 수직 0°, 수평 90°', () => {
    expect(Math.round(trunkLeanDeg({ x: 0, y: 1 }, { x: 0, y: 0 }))).toBe(0);
    expect(Math.round(trunkLeanDeg({ x: 0, y: 1 }, { x: 1, y: 1 }))).toBe(90);
  });
  it('aspect 로 가로를 보정한다', () => {
    const a1 = angleAt({ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 2 }, 1);
    const a2 = angleAt({ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 2 }, 2);
    expect(Math.round(a1)).toBe(90);
    expect(a2).not.toBeNull();
  });
});

describe('analyzeOlyLift — 스내치', () => {
  const r = analyzeOlyLift(snatchSamples(), { exerciseType: 'snatch', cmPerRatio: CM, aspect: 0.75 });
  it('한 동작으로 나누고 시점이 순서대로다', () => {
    expect(r.lifts).toHaveLength(1);
    const l = r.lifts[0];
    expect(l.name).toBe('스내치');
    expect(l.startMs).toBeLessThan(l.peakVelocityMs);
    expect(l.peakVelocityMs).toBeLessThanOrEqual(l.catchMs);
    expect(l.barTopHeightCm).toBeGreaterThan(100);
    expect(l.peakVelocity).toBeGreaterThan(1);
  });
  it('무릎 통과·각도 묶음이 채워진다', () => {
    const l = r.lifts[0];
    expect(l.kneePassMs).not.toBeNull();
    expect(l.angles.set.kneeDeg).toBeGreaterThan(90);
    expect(l.angles.extension).not.toBeNull();
    expect(l.angles.catch).not.toBeNull();
  });
  it('좋은 입력이면 신뢰도 ok', () => {
    expect(r.confidence.level).toBe('ok');
    expect(r.basis).toBe('2d-landmark');
  });
});

describe('analyzeOlyLift — 거절·신뢰도', () => {
  it('올림픽 종목이 아니면 null', () => {
    expect(isOlyType('squat')).toBe(false);
    expect(analyzeOlyLift(snatchSamples(), { exerciseType: 'squat', cmPerRatio: CM })).toBeNull();
  });
  it('샘플 부족/스케일 없음은 구간 없이 이유만', () => {
    expect(analyzeOlyLift(snatchSamples().slice(0, 5), { exerciseType: 'snatch', cmPerRatio: CM }).confidence.reasons).toContain('too_few_samples');
    expect(analyzeOlyLift(snatchSamples(), { exerciseType: 'snatch', cmPerRatio: 0 }).confidence.reasons).toContain('no_scale');
  });
  it('바가 안 올라가면 no_lift_found', () => {
    const flat = Array.from({ length: 30 }, (_, i) => sample(i * dt, 5, 0.55));
    const r = analyzeOlyLift(flat, { exerciseType: 'snatch', cmPerRatio: CM });
    expect(r.lifts).toHaveLength(0);
    expect(r.confidence.reasons).toContain('no_lift_found');
  });
  it('정면 촬영이면 신뢰 낮음', () => {
    const s = snatchSamples().map((x) => ({ ...x, frontal: 0.9 }));
    const r = analyzeOlyLift(s, { exerciseType: 'snatch', cmPerRatio: CM });
    expect(r.confidence.level).toBe('low');
    expect(r.confidence.reasons).toContain('frontal_view');
  });
  it('프레임이 낮으면 low_fps', () => {
    const s = snatchSamples().map((x, i) => ({ ...x, ts: i * 80 }));
    expect(analyzeOlyLift(s, { exerciseType: 'snatch', cmPerRatio: CM }).confidence.reasons).toContain('low_fps');
  });
  it('인식이 낮으면 low_visibility', () => {
    const s = snatchSamples().map((x) => ({ ...x, j: { s: { ...x.j.s, v: 0.2 }, h: { ...x.j.h, v: 0.2 }, k: { ...x.j.k, v: 0.2 }, a: { ...x.j.a, v: 0.2 } } }));
    expect(analyzeOlyLift(s, { exerciseType: 'snatch', cmPerRatio: CM }).confidence.reasons).toContain('low_visibility');
  });
});

describe('analyzeOlyLift — 클린&저크', () => {
  function cjSamples() {
    const out = []; let t = 0;
    for (let i = 0; i < 10; i++, t += dt) out.push(sample(t, 0, 0.55));
    for (let i = 0; i < 12; i++, t += dt) out.push(sample(t, (i + 1) * 4, 0.55 - i * 0.003));
    for (let i = 0; i < 8; i++, t += dt) out.push(sample(t, 48 + (i + 1) * 7, 0.5));      // 클린 → 104cm
    for (let i = 0; i < 20; i++, t += dt) out.push(sample(t, 104, 0.55 - i * 0.002));      // 랙(정지 660ms)
    for (let i = 0; i < 6; i++, t += dt) out.push(sample(t, 104, 0.6 + i * 0.01));         // 딥
    for (let i = 0; i < 10; i++, t += dt) out.push(sample(t, 104 + (i + 1) * 8, 0.55));    // 드라이브 +80
    for (let i = 0; i < 12; i++, t += dt) out.push(sample(t, 184, 0.55));
    return out;
  }
  it('랙 정지를 기준으로 클린과 저크로 나눈다', () => {
    const r = analyzeOlyLift(cjSamples(), { exerciseType: 'clean_jerk', cmPerRatio: CM, aspect: 0.75 });
    expect(r.lifts.map((l) => l.name)).toEqual(['클린', '저크']);
    expect(r.lifts[1].barRiseCm).toBeGreaterThan(50);
    expect(r.lifts[1].angles.dip).not.toBeNull();
  });
  it('정지가 없으면 한 동작으로 처리하고 이유를 남긴다', () => {
    const r = analyzeOlyLift(snatchSamples(), { exerciseType: 'clean_jerk', cmPerRatio: CM });
    expect(r.confidence.reasons).toContain('jerk_not_split');
  });
});

describe('관절 선택·정면도', () => {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  it('좌/우 인덱스', () => {
    expect(pickSideJoints(lms, 'left').s).toEqual({ x: 0.5, y: 0.5, v: 0.9 });
    const l2 = lms.map((p, i) => (i === 11 || i === 23 || i === 25 || i === 27 ? { ...p, visibility: 0.1 } : p));
    expect(betterSide(l2)).toBe('right');
  });
  it('어깨너비가 크면 정면', () => {
    const l = lms.map((p) => ({ ...p }));
    l[11] = { x: 0.3, y: 0.3, visibility: 1 }; l[12] = { x: 0.7, y: 0.3, visibility: 1 };
    l[23] = { x: 0.4, y: 0.6, visibility: 1 }; l[24] = { x: 0.6, y: 0.6, visibility: 1 };
    expect(frontalRatio(l)).toBeGreaterThan(0.5);
  });
});

describe('화면 연결', () => {
  const vbt = fs.readFileSync('src/ai-measure/menus/VbtMeasure.jsx', 'utf8');
  it('VBT 가 궤적선·구간분석을 연결하고 저장 경로에 oly 를 싣는다', () => {
    expect(vbt).toContain('drawSolidBarTrail');
    expect(vbt).toContain('궤적 켜짐');
    expect(vbt).toContain('analyzeOlyLift(olySamplesRef.current');
    expect(vbt).toContain('oly: result.oly ?? null');
    expect(fs.readFileSync('src/ai-measure/menus/BarbellLiftingHub.jsx', 'utf8')).toContain('oly: raw?.oly ?? null');
    expect(fs.readFileSync('src/ai-measure/menus/LiftingReportDashboard.jsx', 'utf8')).toContain('<OlyLiftSection');
  });
});
