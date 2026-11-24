import { describe, it, expect } from 'vitest';
import { estimate1RM, RM_FORMULAS, workingWeight, repPercent, rmTestPlan, rmNextStep } from '../ai-measure/core/strength.js';

describe('estimate1RM · 7공식 평균', () => {
  it('1회는 든 무게가 곧 1RM', () => {
    const r = estimate1RM(100, 1);
    expect(r.average).toBe(100);
    expect(r.formulas.every(f => f.value === 100)).toBe(true);
  });

  it('정상 범위(5회): 평균이 든 무게보다 큼', () => {
    const r = estimate1RM(100, 5);
    expect(r.average).toBeGreaterThan(100);
    // 모든 공식이 물리적으로 유효(>= w)해야 평균에 포함
    expect(r.formulas.every(f => f.value == null || f.value >= 100)).toBe(true);
    expect(r.formulas.filter(f => f.value != null && !f.refOnly).length).toBe(RM_FORMULAS.filter(f => !f.refOnly).length);
  });

  it('Brzycki 정의역 밖(r≥37)은 평균에서 제외되어 왜곡 없음', () => {
    const r = estimate1RM(100, 40);
    const brz = r.formulas.find(f => f.key === 'brzycki');
    expect(brz.value).toBeNull();          // 비물리적 → 제외
    expect(brz.excluded).toBe(true);
    // 평균은 유효 공식들만으로 계산 → 여전히 >= w
    expect(r.average).toBeGreaterThanOrEqual(100);
  });

  it('비물리적 값을 w로 치환하지 않음(평균 편향 방지)', () => {
    // r=36: Brzycki = 100*36/1 = 3600 (폭주) → 제외되어야 함
    const r = estimate1RM(100, 36);
    const brz = r.formulas.find(f => f.key === 'brzycki');
    expect(brz.value).toBeGreaterThan(100); // 36회면 아직 유효범위(37-36=1)나 매우 큼
    // 평균이 비현실적으로 치솟지 않는지 — 유효 공식 다수가 완충
    expect(r.average).toBeLessThan(brz.value);
  });

  it('workingWeight: 2.5kg 단위 반올림', () => {
    expect(workingWeight(100, 80)).toBe(80);    // 80.0 → 80
    expect(workingWeight(102, 80)).toBe(82.5);  // 81.6 → 82.5
  });
});

describe('교재 RM 테스트 계획·참고식(2026-11-24)', () => {
  it('계획: 테스트 세트 87%, 준비 50/70/90% × 6회, 3분 휴식', () => {
    const p = rmTestPlan(100);
    expect(p.testKg).toBe(87.5);
    expect(p.sets.map(s => s.pct)).toEqual([50, 70, 90, 87]);
    expect(p.sets.slice(0, 3).every(s => s.reps === 6 && s.restSec === 180)).toBe(true);
    expect(p.sets[0].kg).toBe(45);
    expect(rmTestPlan(0)).toBeNull();
  });
  it('다음 행동: 10회 이내 종료, 초과 시 2.5~5% 증량', () => {
    expect(rmNextStep(87.5, 8).done).toBe(true);
    expect(rmNextStep(87.5, 10).done).toBe(true);
    const n = rmNextStep(100, 12);
    expect(n.done).toBe(false);
    expect(n.lowKg).toBe(102.5);
    expect(n.highKg).toBe(105);
  });
  it('Berger·Cummings&Finn은 참고만(평균에서 제외)하고 평균은 기존과 같다', () => {
    const r = estimate1RM(100, 5);
    const cf = r.formulas.find(f => f.key === 'cummings');
    expect(cf.refOnly).toBe(true);
    expect(cf.value).toBeCloseTo(1.175 * 100 + 0.839 * 5 - 4.29787, 1);
    expect(r.formulas.find(f => f.key === 'berger').value).toBeNull(); // 교재 표기대로면 든 무게보다 작아 제외
    const usedAvg = r.formulas.filter(f => f.value != null && !f.refOnly).reduce((s, f) => s + f.value, 0) / r.formulas.filter(f => f.value != null && !f.refOnly).length;
    expect(r.average).toBeCloseTo(usedAvg, 0);
  });
});
