// 2026-11-25 1RM 영상측정 후 반복 횟수 수동 보정
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { adjustOneRmReps } from '../ai-measure/core/oneRmRepAdjust';
import { estimate1RM } from '../ai-measure/core/strength';

const raw = () => ({
  lift: 'bench', weight: 80, reps: 6, oneRM: estimate1RM(80, 6).average,
  attempts: [
    { attemptNo: 1, weight: 70, reps: 5, oneRM: estimate1RM(70, 5).average },
    { attemptNo: 2, weight: 80, reps: 6, oneRM: estimate1RM(80, 6).average },
  ],
});

describe('1RM 반복 횟수 보정', () => {
  it('횟수를 고치면 1RM·마지막 도전 기록이 다시 계산되고 원본 횟수는 남는다', () => {
    const adj = adjustOneRmReps(raw(), 5);
    expect(adj.reps).toBe(5);
    expect(adj.oneRM).toBe(estimate1RM(80, 5).average);
    expect(adj.attempts[1].reps).toBe(5);
    expect(adj.attempts[1].oneRM).toBe(adj.oneRM);
    expect(adj.attempts[0].reps).toBe(5); // 이전 차수는 그대로
    expect(adj.repsAuto).toBe(6);
    expect(adj.repsAdjusted).toBe(true);
    expect(adj.bestOneRM).toBe(Math.max(adj.attempts[0].oneRM, adj.attempts[1].oneRM));
  });
  it('여러 번 고쳐도 repsAuto 는 처음 자동값 유지, 원래 값으로 돌리면 repsAdjusted=false', () => {
    const a1 = adjustOneRmReps(raw(), 4);
    const a2 = adjustOneRmReps(a1, 7);
    expect(a2.repsAuto).toBe(6);
    expect(a2.repsAdjusted).toBe(true);
    expect(adjustOneRmReps(a2, 6).repsAdjusted).toBe(false);
  });
  it('입력 원본은 바뀌지 않고, 1~100 범위로 제한, 무게 없으면 그대로', () => {
    const r = raw();
    adjustOneRmReps(r, 3);
    expect(r.reps).toBe(6);
    expect(adjustOneRmReps(r, 0).reps).toBe(1);
    expect(adjustOneRmReps(r, 500).reps).toBe(100);
    expect(adjustOneRmReps({ reps: 5 }, 3).reps).toBe(5);
  });
  it('허브 기록 확인 단계에 +/- 보정 UI가 연결돼 있다', () => {
    const hub = readFileSync('src/ai-measure/menus/BarbellLiftingHub.jsx', 'utf8');
    expect(hub).toContain('adjustOneRmReps');
    expect(hub).toContain('data-testid="onerm-rep-minus"');
    expect(hub).toContain('data-testid="onerm-rep-plus"');
    expect(hub).toContain('repsAuto');
  });
});
