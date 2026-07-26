import { describe, expect, it } from 'vitest';
import {
  nextPhase,
  firstPhase,
  phaseDurationSec,
  totalDurationSec,
} from '../ai-measure/core/intervalTimer';

const cfg = { workSec: 30, restSec: 15, rounds: 3, prepSec: 5 };

describe('intervalTimer pure logic', () => {
  it('firstPhase starts with prepare when prepSec > 0', () => {
    expect(firstPhase(cfg)).toEqual({ phase: 'prepare', round: 1 });
  });

  it('firstPhase skips prepare when prepSec is 0', () => {
    expect(firstPhase({ ...cfg, prepSec: 0 })).toEqual({ phase: 'work', round: 1 });
  });

  it('prepare -> work (round 1)', () => {
    expect(nextPhase(cfg, { phase: 'prepare', round: 1 })).toEqual({ phase: 'work', round: 1 });
  });

  it('work -> rest in same round when rest > 0', () => {
    expect(nextPhase(cfg, { phase: 'work', round: 1 })).toEqual({ phase: 'rest', round: 1 });
  });

  it('rest -> work of next round', () => {
    expect(nextPhase(cfg, { phase: 'rest', round: 1 })).toEqual({ phase: 'work', round: 2 });
  });

  it('last rest -> done', () => {
    expect(nextPhase(cfg, { phase: 'rest', round: 3 })).toEqual({ phase: 'done', round: 3 });
  });

  it('work -> next work directly when rest is 0', () => {
    const noRest = { ...cfg, restSec: 0 };
    expect(nextPhase(noRest, { phase: 'work', round: 1 })).toEqual({ phase: 'work', round: 2 });
  });

  it('last work -> done when rest is 0', () => {
    const noRest = { ...cfg, restSec: 0 };
    expect(nextPhase(noRest, { phase: 'work', round: 3 })).toEqual({ phase: 'done', round: 3 });
  });

  it('runs a full 2-round tabata-style cycle to completion', () => {
    const tabata = { workSec: 20, restSec: 10, rounds: 2, prepSec: 0 };
    let state = firstPhase(tabata); // work 1
    const seq = [state];
    for (let i = 0; i < 10 && state.phase !== 'done'; i++) {
      state = nextPhase(tabata, state);
      seq.push(state);
    }
    expect(seq).toEqual([
      { phase: 'work', round: 1 },
      { phase: 'rest', round: 1 },
      { phase: 'work', round: 2 },
      { phase: 'rest', round: 2 },
      { phase: 'done', round: 2 },
    ]);
  });

  it('phaseDurationSec returns the right segment length', () => {
    expect(phaseDurationSec(cfg, 'prepare')).toBe(5);
    expect(phaseDurationSec(cfg, 'work')).toBe(30);
    expect(phaseDurationSec(cfg, 'rest')).toBe(15);
    expect(phaseDurationSec(cfg, 'idle')).toBe(0);
    expect(phaseDurationSec(cfg, 'done')).toBe(0);
  });

  it('totalDurationSec = prep + (work + rest) * rounds', () => {
    // 5 + (30 + 15) * 3 = 140
    expect(totalDurationSec(cfg)).toBe(140);
    // rest 0: 0 + (30 + 0) * 3 = 90
    expect(totalDurationSec({ ...cfg, restSec: 0, prepSec: 0 })).toBe(90);
  });

  it('handles single round', () => {
    const one = { workSec: 60, restSec: 30, rounds: 1, prepSec: 0 };
    expect(nextPhase(one, { phase: 'work', round: 1 })).toEqual({ phase: 'rest', round: 1 });
    expect(nextPhase(one, { phase: 'rest', round: 1 })).toEqual({ phase: 'done', round: 1 });
  });
});
