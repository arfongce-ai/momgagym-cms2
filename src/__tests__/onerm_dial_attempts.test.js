import { describe, it, expect } from 'vitest';
import {
  snapWeight, stepWeight, clampReps, repEstimateConfidence,
  appendAttempt, summarizeAttempts, WEIGHT_STEP_KG,
} from '../ai-measure/core/lifting.js';

describe('무게 다이얼 · 0.5kg 단위', () => {
  it('0.5kg 격자에 스냅', () => {
    expect(snapWeight(60.3)).toBe(60.5);
    expect(snapWeight(60.2)).toBe(60);
    expect(snapWeight(60.75)).toBe(61); // 0.75 → 1.0 격자
    expect(WEIGHT_STEP_KG).toBe(0.5);
  });

  it('범위 클램프(음수→0, 과대→상한)', () => {
    expect(snapWeight(-10)).toBe(0);
    expect(snapWeight(99999)).toBe(500);
  });

  it('스텝 증감', () => {
    expect(stepWeight(60, +1)).toBe(60.5);
    expect(stepWeight(60, -1)).toBe(59.5);
    expect(stepWeight(60, +10)).toBe(65);  // 10스텝 = 5kg
    expect(stepWeight(0, -1)).toBe(0);      // 하한 유지
  });

  it('부동소수 오차 없이 0.5 단위 유지', () => {
    let w = 0;
    for (let i = 0; i < 7; i++) w = stepWeight(w, +1); // 0.5*7
    expect(w).toBe(3.5);
  });
});

describe('반복 카운터 · 제한 없음(안전상한 100)', () => {
  it('1 이상 정수로 클램프', () => {
    expect(clampReps(0)).toBe(1);
    expect(clampReps(-3)).toBe(1);
    expect(clampReps(5.4)).toBe(5);
    expect(clampReps(5.6)).toBe(6);
  });
  it('고반복 허용(차단 없음), 100 상한', () => {
    expect(clampReps(20)).toBe(20);
    expect(clampReps(200)).toBe(100);
  });
});

describe('반복수 신뢰도 안내(근거기반 · 차단 아님)', () => {
  it('저반복 높음, 중반복 보통, 고반복 낮음', () => {
    expect(repEstimateConfidence(3).level).toBe('high');
    expect(repEstimateConfidence(6).level).toBe('high');
    expect(repEstimateConfidence(8).level).toBe('medium');
    expect(repEstimateConfidence(10).level).toBe('medium');
    expect(repEstimateConfidence(15).level).toBe('low');
  });
});

describe('도전 차수 누적 기록', () => {
  it('차수가 1부터 증가하며 불변 배열 반환', () => {
    let a = [];
    a = appendAttempt(a, { weight: 80, reps: 5, oneRM: 90 });
    a = appendAttempt(a, { weight: 85, reps: 3, oneRM: 92 });
    a = appendAttempt(a, { weight: 90, reps: 1, oneRM: 90 });
    expect(a).toHaveLength(3);
    expect(a.map(x => x.attemptNo)).toEqual([1, 2, 3]);
    expect(a[1].weight).toBe(85);
    expect(typeof a[0].at).toBe('string');
  });

  it('요약: 최고 1RM과 그 차수, 최고 무게', () => {
    const a = [
      { attemptNo: 1, weight: 80, reps: 5, oneRM: 90 },
      { attemptNo: 2, weight: 85, reps: 3, oneRM: 92 },
      { attemptNo: 3, weight: 90, reps: 1, oneRM: 90 },
    ];
    const s = summarizeAttempts(a);
    expect(s.count).toBe(3);
    expect(s.bestOneRM).toBe(92);
    expect(s.bestAttemptNo).toBe(2);
    expect(s.bestWeight).toBe(90);
  });

  it('빈 기록 안전', () => {
    const s = summarizeAttempts([]);
    expect(s.count).toBe(0);
    expect(s.bestOneRM).toBeNull();
  });
});
