import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { estimate1RM, RM_FORMULAS, workingWeight, repPercent } from '../ai-measure/core/strength.js';

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
    expect(r.formulas.filter(f => f.value != null).length).toBe(RM_FORMULAS.length);
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

// ── 개선 7: 이상치 완화(robust) 가중평균 ──
describe('estimate1RM · robustAverage(이상치 완화 평균)', () => {
  it('1회는 robustAverage도 든 무게와 같다', () => {
    const r = estimate1RM(100, 1);
    expect(r.robustAverage).toBe(100);
  });

  it('정상 범위(5회)에서는 robustAverage가 단순평균과 크게 다르지 않다', () => {
    const r = estimate1RM(100, 5);
    expect(Math.abs(r.robustAverage - r.average)).toBeLessThan(2);
  });

  it('각 공식에 가중치(weight)가 부여되고, 중앙값에서 먼 공식일수록 가중치가 낮다', () => {
    const r = estimate1RM(100, 20); // 고반복 — 공식 간 격차 커짐
    const used = r.formulas.filter(f => f.value != null);
    expect(used.every(f => typeof f.weight === 'number')).toBe(true);
    const farthest = [...used].sort((a, b) => Math.abs(b.value - r.median) - Math.abs(a.value - r.median))[0];
    const closest = [...used].sort((a, b) => Math.abs(a.value - r.median) - Math.abs(b.value - r.median))[0];
    expect(farthest.weight).toBeLessThanOrEqual(closest.weight);
  });

  it('median 필드가 유효 공식들의 중앙값이다', () => {
    const r = estimate1RM(100, 5);
    const used = r.formulas.filter(f => f.value != null).map(f => f.value).sort((a, b) => a - b);
    const mid = used[Math.floor(used.length / 2)];
    expect(Math.abs(r.median - mid)).toBeLessThan(5); // 홀/짝 보간 여유
  });
});

// ── 배선(개선 7) 정적 확인 ──
describe('OneRMEstimate 배선 — robustAverage를 대표값으로 사용', () => {
  const src = readFileSync(new URL('../ai-measure/menus/OneRMEstimate.jsx', import.meta.url), 'utf8');
  it('저장·표시 모두 robustAverage를 우선 사용한다', () => {
    expect(src).toContain('result.robustAverage ?? result.average');
  });
});
