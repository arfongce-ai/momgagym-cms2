// src/__tests__/rep_freeze.test.js
// ════════════════════════════════════════════════════════════════════════
//  반복 카드 동결 계약(applyRepFreeze) — 렙/점프 공통.
//  "확정된(최신이 아닌) 카드는 이후 값이 바뀌어도 불변" 을 검증.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { applyRepFreeze } from '../ai-measure/core/repFreeze';

describe('applyRepFreeze · 반복 카드 동결', () => {
  it('최신이 아닌 카드는 처음 값으로 고정되고, 이후 재계산에도 불변', () => {
    const freeze = new Map();
    // 1차: 점프 3개(1·2 는 확정, 3 은 최신)
    const pass1 = applyRepFreeze(
      [{ no: 1, rsi: 1.5 }, { no: 2, rsi: 1.6 }, { no: 3, rsi: 1.7 }],
      freeze, 3,
    );
    expect(pass1.map(r => r.rsi)).toEqual([1.5, 1.6, 1.7]);
    // 2차: 트래커 보정으로 1·2 값이 달라진 채 다시 들어와도 동결값 유지.
    const pass2 = applyRepFreeze(
      [{ no: 1, rsi: 9.9 }, { no: 2, rsi: 9.9 }, { no: 3, rsi: 1.71 }],
      freeze, 4, // 이제 4번째가 생겨 3번도 확정됨
    );
    expect(pass2[0].rsi).toBe(1.5); // 동결
    expect(pass2[1].rsi).toBe(1.6); // 동결
    expect(pass2[2].rsi).toBe(1.71); // 3번은 방금 확정 → 이 값으로 동결
  });

  it('최신(마지막) 카드는 동결하지 않고 최신 계산값을 통과시킨다', () => {
    const freeze = new Map();
    const a = applyRepFreeze([{ no: 1, v: 10 }], freeze, 1);
    expect(a[0].v).toBe(10);
    // 아직 최신이라 미동결 → 값이 갱신되면 반영됨
    const b = applyRepFreeze([{ no: 1, v: 12 }], freeze, 1);
    expect(b[0].v).toBe(12);
    // 뒤에 항목이 생기면 그 시점 값으로 고정
    const c = applyRepFreeze([{ no: 1, v: 13 }, { no: 2, v: 20 }], freeze, 2);
    expect(c[0].v).toBe(13);
    const d = applyRepFreeze([{ no: 1, v: 99 }, { no: 2, v: 21 }], freeze, 2);
    expect(d[0].v).toBe(13); // 동결
    expect(d[1].v).toBe(21); // 2는 아직 최신 → 갱신
  });

  it('빈 입력/비정상 항목에 안전', () => {
    const freeze = new Map();
    expect(applyRepFreeze(null, freeze, 0)).toEqual([]);
    expect(applyRepFreeze(undefined, freeze, 0)).toEqual([]);
    const rows = [null, { no: 1, v: 1 }, { foo: 'bar' }];
    const out = applyRepFreeze(rows, freeze, 2);
    expect(out[0]).toBeNull();
    expect(out[1].v).toBe(1);
    expect(out[2]).toEqual({ foo: 'bar' });
  });
});
