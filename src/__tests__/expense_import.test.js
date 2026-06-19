// 지출 일괄 가져오기(addExpenseBatch) 검증: 중복 스킵·필수값·합계 정확성
import { describe, it, expect, beforeEach, vi } from 'vitest';

let FAIL = false;
const mem = {};
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: (_db, name, id) => ({ name, id }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async (ref, data) => { if (FAIL) throw new Error('denied'); (mem[ref.name] ||= {})[ref.id] = data; },
  deleteDoc: async (ref) => { if (FAIL) throw new Error('denied'); if (mem[ref.name]) delete mem[ref.name][ref.id]; },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(['set', ref, data]),
      delete: (ref) => ops.push(['del', ref]),
      commit: async () => {
        if (FAIL) throw new Error('batch denied');
        for (const [t, ref, data] of ops) {
          if (t === 'set') (mem[ref.name] ||= {})[ref.id] = data;
          else if (mem[ref.name]) delete mem[ref.name][ref.id];
        }
      },
    };
  },
}));

import { store } from '../demoData';

beforeEach(() => { FAIL = false; });

const sample = [
  { category:'전기세', name:'전기세', ym:'2026-01', amount:414910 },
  { category:'전기세', name:'전기세', ym:'2026-02', amount:408910 },
  { category:'관리비', name:'수도세+관리비', ym:'2026-01', amount:125000 },
];

describe('지출 일괄 가져오기 (addExpenseBatch)', () => {
  it('정상 가져오기: 건수만큼 추가된다', async () => {
    const before = store.getExpenses().length;
    const res = await store.addExpenseBatch(sample);
    expect(res.added).toBe(3);
    expect(res.skipped).toBe(0);
    expect(store.getExpenses().length).toBe(before + 3);
  });

  it('중복 스킵: 같은 내역을 다시 넣으면 건너뛴다', async () => {
    await store.addExpenseBatch(sample);
    const before = store.getExpenses().length;
    const res = await store.addExpenseBatch(sample); // 동일 재시도
    expect(res.added).toBe(0);
    expect(res.skipped).toBe(3);
    expect(store.getExpenses().length).toBe(before);
  });

  it('부분 중복: 새 항목만 추가', async () => {
    await store.addExpenseBatch(sample);
    const before = store.getExpenses().length;
    const res = await store.addExpenseBatch([
      ...sample,
      { category:'전기세', name:'전기세', ym:'2026-03', amount:237580 }, // 신규
    ]);
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(3);
    expect(store.getExpenses().length).toBe(before + 1);
  });

  it('필수값 누락(금액 0 / 귀속월 없음)은 제외', async () => {
    const res = await store.addExpenseBatch([
      { category:'전기세', name:'X', ym:'2026-05', amount:0 },       // 금액0
      { category:'전기세', name:'Y', ym:'', amount:1000 },           // 귀속월 없음
      { category:'전기세', name:'Z', ym:'2026-06', amount:179400 },  // 정상
    ]);
    expect(res.added).toBe(1);
  });

  it('가져온 합계가 원본과 일치(검증용)', async () => {
    // 다른 테스트와 겹치지 않는 고유 연도로 격리
    await store.addExpenseBatch([
      { category:'전기세', name:'전기세', ym:'2099-01', amount:111111 },
      { category:'전기세', name:'전기세', ym:'2099-02', amount:222222 },
    ]);
    const elec2099 = store.getExpenses()
      .filter(e => e.category==='전기세' && e.ym?.startsWith('2099'))
      .reduce((s,e)=>s+e.amount, 0);
    expect(elec2099).toBe(111111 + 222222);
  });

  it('batch 실패 시 롤백(아무것도 안 들어감)', async () => {
    const before = store.getExpenses().length;
    FAIL = true;
    await expect(store.addExpenseBatch([
      { category:'세금', name:'원천세', ym:'2026-03', amount:188780 },
    ])).rejects.toThrow();
    FAIL = false;
    expect(store.getExpenses().length).toBe(before);
  });
});
