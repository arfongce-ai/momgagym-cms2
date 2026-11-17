import { describe, it, expect } from 'vitest';
import { GaitCycleTracker, dominantCadenceSpm } from '../ai-measure/core/gaitBiomechanics';

// 발마다 2차 봉우리(뒤차기)와 검출 떨림이 있는 보행 신호를 만든다 — 봉우리 수만 세면 분당 걸음수가 2배 가까이 부풀던 상황.
function run(spm, kick, fps = 30, sec = 20) {
  const t = new GaitCycleTracker();
  const f = spm / 2 / 60;
  for (let i = 0; i < fps * sec; i++) {
    const ts = (i / fps) * 1000; const w = 2 * Math.PI * f * (ts / 1000);
    const sh = (p) => Math.sin(p) + kick * Math.sin(2 * p + 1.2);
    const jit = 0.35 * Math.sin(i * 2.3) + 0.2 * Math.sin(i * 5.1);
    t.push({ leftAnkle: { x: 2 * sh(w) + jit }, rightAnkle: { x: 2 * sh(w + Math.PI) - jit } }, ts);
  }
  return t.summary();
}

describe('분당 걸음수(케이던스) 교차검증', () => {
  it.each([100, 118, 150, 170])('2차 봉우리가 있어도 %i spm ±3 이내', (spm) => {
    const s = run(spm, 0.9);
    expect(Math.abs(s.averageCadenceSpm - spm)).toBeLessThanOrEqual(3);
  });
  it('깨끗한 신호는 기존 스텝 카운트를 그대로 쓴다', () => {
    const s = run(118, 0);
    expect(s.cadenceSource).toBe('steps');
    expect(s.averageCadenceSpm).toBe(118);
  });
  it('보정 시 총 스텝도 같은 기준으로 맞춘다(부풀지 않음)', () => {
    const s = run(118, 0.9);
    expect(s.cadenceSource).toBe('frequency');
    expect(s.totalSteps).toBeLessThan(50);
  });
  it('신호가 짧거나 주기가 없으면 null', () => {
    expect(dominantCadenceSpm([])).toBeNull();
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const noise = Array.from({ length: 400 }, (_, i) => [i * 33, rnd()]);
    expect(dominantCadenceSpm(noise)?.strength ?? 0).toBeLessThan(0.4);
  });
});
