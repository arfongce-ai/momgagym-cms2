import { describe, it, expect } from 'vitest';
import { RunMechanicsTracker, buildRunningFeedback } from '../ai-measure/core/runMechanics';

// 30fps 측면 달리기 합성 데이터: 발 접지 250ms, 주기 706ms(케이던스 약 170spm), 위팔 ±25°
function frame(t, { contactMsL = 250, contactMsR = 250, overstride = 0.05, period = 706, armDeg = 25 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95 }));
  lm[23] = { x: 0.5, y: 0.55, visibility: 0.95 }; lm[24] = { x: 0.5, y: 0.55, visibility: 0.95 };
  lm[11] = { x: 0.5, y: 0.30, visibility: 0.95 }; lm[12] = { x: 0.5, y: 0.30, visibility: 0.95 };
  const foot = (phase, contactMs) => {
    const c = contactMs / period;
    if (phase < c) return { y: 0.92, x: 0.5 + overstride - 0.12 * (phase / c) };
    const u = (phase - c) / (1 - c);
    return { y: 0.92 - 0.14 * Math.sin(Math.PI * u), x: 0.5 - 0.12 + 0.12 * u + overstride * u };
  };
  const set = (a, h, tt, f) => {
    lm[a] = { x: f.x, y: f.y - 0.02, visibility: 0.95 };
    lm[h] = { x: f.x - 0.02, y: f.y, visibility: 0.95 };
    lm[tt] = { x: f.x + 0.04, y: f.y, visibility: 0.95 };
  };
  set(27, 29, 31, foot((t % period) / period, contactMsL));
  set(28, 30, 32, foot(((t + period / 2) % period) / period, contactMsR));
  const ang = Math.sin((2 * Math.PI * t) / period) * (armDeg * Math.PI) / 180;
  lm[13] = { x: 0.5 + 0.12 * Math.sin(ang), y: 0.30 + 0.12 * Math.cos(ang), visibility: 0.95 };
  lm[14] = { x: 0.5 - 0.12 * Math.sin(ang), y: 0.30 + 0.12 * Math.cos(ang), visibility: 0.95 };
  lm[15] = { x: lm[13].x + 0.1, y: lm[13].y, visibility: 0.95 };
  lm[16] = { x: lm[14].x + 0.1, y: lm[14].y, visibility: 0.95 };
  return lm;
}
function run(opts = {}, { fpsStepMs = 33.3, ms = 10000 } = {}) {
  const tr = new RunMechanicsTracker();
  for (let t = 0; t < ms; t += fpsStepMs) tr.push(frame(t, opts), t);
  return tr;
}

describe('RunMechanicsTracker — 접지·체공·오버스트라이드·팔 스윙 (2026-11-23)', () => {
  it('접지 시간은 실제(250ms)에 프레임 1~2장 이내로 잡힌다', () => {
    const s = run().summary({ orientation: 'side' });
    expect(s.contact.avgMs).toBeGreaterThan(200);
    expect(s.contact.avgMs).toBeLessThan(300);
    expect(s.contact.flightMs).toBeGreaterThan(40);
    expect(s.contact.asymmetryLevel).toBe('normal');
    expect(s.contact.resolutionMs).toBe(33);
  });
  it('오른발 접지가 길면 좌우 차이를 잡는다', () => {
    const s = run({ contactMsL: 220, contactMsR: 330 }).summary({ orientation: 'side' });
    expect(s.contact.rightMs).toBeGreaterThan(s.contact.leftMs);
    expect(['caution', 'risk']).toContain(s.contact.asymmetryLevel);
  });
  it('발이 몸보다 훨씬 앞에 닿으면 오버스트라이드 위험, 거의 아래면 정상', () => {
    expect(run({ overstride: 0.15 }).summary({ orientation: 'side' }).overstride.level).toBe('risk');
    expect(run({ overstride: 0.0 }).summary({ orientation: 'side' }).overstride.level).toBe('normal');
  });
  it('측면이 아니면 오버스트라이드·팔 스윙은 계산하지 않고 이유를 남긴다(접지는 계산)', () => {
    const s = run().summary({ orientation: 'back' });
    expect(s.overstride.avgPct).toBeNull();
    expect(s.overstride.reason).toContain('측면');
    expect(s.armSwing.mainRangeDeg).toBeNull();
    expect(s.contact.avgMs).not.toBeNull();
  });
  it('팔 스윙 폭이 실제(±25°=50°)에 가깝게 나온다', () => {
    const a = run().summary({ orientation: 'side' }).armSwing;
    expect(a.mainRangeDeg).toBeGreaterThan(35);
    expect(a.mainRangeDeg).toBeLessThan(60);
    expect(a.elbowAvgDeg).toBeGreaterThan(80);
    expect(a.elbowAvgDeg).toBeLessThan(100);
  });
  it('프레임 속도가 너무 낮으면(10fps) 접지·체공 시간을 계산하지 않는다', () => {
    const s = run({}, { fpsStepMs: 100 }).summary({ orientation: 'side' });
    expect(s.contact.avgMs).toBeNull();
    expect(s.contact.reason).toContain('프레임');
  });
  it('서 있는 사람(발이 안 움직임)은 접지로 세지 않는다', () => {
    const tr = new RunMechanicsTracker();
    for (let t = 0; t < 5000; t += 33.3) tr.push(frame(0, { contactMsL: 706, contactMsR: 706 }), t);
    const s = tr.summary({ orientation: 'side' });
    expect(s.contact.avgMs).toBeNull();
  });
});

describe('buildRunningFeedback — 쉬운 말 피드백', () => {
  const base = { cadence: 170, trunkLean: { avg: 5 }, verticalOscillation: 7, kneeSymmetry: 96 };
  it('값이 없으면(측정 안 됨) 말하지 않는다', () => {
    expect(buildRunningFeedback({}, { orientation: 'side', mode: 'run' })).toEqual([]);
  });
  it('위험 항목이 먼저, 최대 5개', () => {
    const m = { ...base, trunkLean: { avg: 18 }, trunkLeanAssessment: { level: 'risk' }, kneeSymmetry: 80,
      runMechanics: { contact: { avgMs: 320, asymmetryPct: 20, asymmetryLevel: 'risk' }, overstride: { avgPct: 30, level: 'risk' }, armSwing: { mainRangeDeg: 10, elbowAvgDeg: 150 } } };
    const out = buildRunningFeedback(m, { orientation: 'side', mode: 'run' });
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out[0].level).toBe('risk');
    expect(out.map((o) => o.key)).toContain('overstride');
    expect(out.every((o) => o.text.length > 10)).toBe(true);
  });
  it('몸통 기울기는 측면 촬영일 때만, 골반은 후면일 때만 말한다', () => {
    const m = { ...base, trunkLean: { avg: 18 }, trunkLeanAssessment: { level: 'risk' }, pelvicDropAssessment: { level: 'risk' } };
    expect(buildRunningFeedback(m, { orientation: 'back', mode: 'run' }).map((o) => o.key)).toEqual(['pelvis']);
    expect(buildRunningFeedback(m, { orientation: 'side', mode: 'run' }).map((o) => o.key)).toEqual(['trunk']);
  });
});
