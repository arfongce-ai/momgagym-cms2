// 세션 양도(transferSessions) 시 잔여/총 횟수 총합 보존 검증
import { describe, it, expect } from 'vitest';

// transferSessions 의 세션 이동 부분을 추출한 순수 모델
function transfer(trainerSessions, { fromTid, toTid, count }) {
  const n = Math.floor(Number(count) || 0);
  if (fromTid === toTid) throw new Error('same');
  if (n <= 0) throw new Error('count');
  const ts = JSON.parse(JSON.stringify(trainerSessions));
  const src = ts[fromTid];
  if (!src) throw new Error('no src');
  if (n > (src.remaining ?? 0)) throw new Error('exceeds');
  const origTotal = src.total ?? 0;
  src.remaining -= n;
  src.total = Math.max(src.remaining, origTotal - n);
  if (src.remaining <= 0 && src.total <= 0) delete ts[fromTid];
  if (ts[toTid]) {
    ts[toTid].total = (ts[toTid].total || 0) + n;
    ts[toTid].remaining = (ts[toTid].remaining || 0) + n;
  } else {
    ts[toTid] = { total: n, remaining: n };
  }
  return ts;
}

const sumRemaining = (ts) => Object.values(ts).reduce((a, s) => a + (s.remaining || 0), 0);

describe('세션 양도 총합 보존', () => {
  it('잔여 총합이 양도 전후 동일', () => {
    const before = { a: { total: 30, remaining: 20 }, b: { total: 10, remaining: 5 } };
    const after = transfer(before, { fromTid: 'a', toTid: 'b', count: 8 });
    expect(sumRemaining(after)).toBe(sumRemaining(before)); // 25 유지
    expect(after.a.remaining).toBe(12);
    expect(after.b.remaining).toBe(13);
  });

  it('대상 슬롯이 없으면 새로 생성', () => {
    const before = { a: { total: 30, remaining: 20 } };
    const after = transfer(before, { fromTid: 'a', toTid: 'c', count: 5 });
    expect(after.c).toEqual({ total: 5, remaining: 5 });
    expect(after.a.remaining).toBe(15);
  });

  it('잔여를 초과 양도하면 throw', () => {
    const before = { a: { total: 30, remaining: 3 } };
    expect(() => transfer(before, { fromTid: 'a', toTid: 'b', count: 5 })).toThrow();
  });

  it('전량 양도 시 출발 슬롯이 비면 제거', () => {
    const before = { a: { total: 5, remaining: 5 } };
    const after = transfer(before, { fromTid: 'a', toTid: 'b', count: 5 });
    expect(after.a).toBeUndefined();
    expect(after.b.remaining).toBe(5);
  });

  it('같은 트레이너로 양도 불가', () => {
    expect(() => transfer({ a: { total: 5, remaining: 5 } }, { fromTid: 'a', toTid: 'a', count: 1 })).toThrow();
  });
});
