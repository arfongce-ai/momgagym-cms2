// 연결이 끊긴 상태의 빈 결과가 저장본으로 굳어 회원 일부만·트레이너 '??'로 보이던 문제
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ offline: false, data: {}, writes: 0 }));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_d, name) => ({ name }), doc: (_d, name, id) => ({ name, id }),
  query: (c) => c, where: () => null,
  getDocs: async (c) => {
    const rows = state.offline ? [] : (state.data[c.name] || []);
    const docs = rows.map(x => ({ id: x.id, data: () => ({ ...x }) }));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: state.offline } };
  },
  setDoc: async () => { state.writes += 1; }, deleteDoc: async () => {},
  writeBatch: () => ({ set() { state.writes += 1; }, delete() {}, commit: async () => {} }),
}));

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
};
const full = { members: [{ id: 'm1', name: 'A' }, { id: 'm2', name: 'B' }], trainers: [{ id: 't1', name: 'T' }] };
const snapshot = () => JSON.parse(mem.get('fitcms_snap') || 'null');
const fresh = async () => { vi.resetModules(); return import('../demoData'); };

describe('오프라인 캐시 방어', () => {
  beforeEach(() => { mem.clear(); state.offline = false; state.data = full; state.writes = 0; });

  it('저장본 없이 연결이 끊기면 실패 처리 — 빈 저장본·예시 데이터 쓰기 없음', async () => {
    state.offline = true;
    const { initStore } = await fresh();
    await expect(initStore()).rejects.toMatchObject({ code: 'unavailable' });
    expect(snapshot()).toBeNull();
    expect(state.writes).toBe(0);
  });

  it('트레이너가 0명인 깨진 저장본은 전체를 다시 받는다', async () => {
    const now = Date.now();
    mem.set('fitcms_snap', JSON.stringify({ ver: 'v6.3', data: { members: [{ id: 'm1' }], trainers: [] }, syncedAt: { members: now }, fullSyncAt: now }));
    const { initStore, store } = await fresh();
    await initStore();
    expect(store.getMembers()).toHaveLength(2);
    expect(store.getTrainers()).toHaveLength(1);
  });

  it('정상 저장본이 있으면 연결이 끊겨도 그대로 열고 덮어쓰지 않는다', async () => {
    await (await fresh()).initStore();
    const before = mem.get('fitcms_snap');
    state.offline = true;
    const { initStore, store } = await fresh();
    await initStore();
    expect(store.getMembers()).toHaveLength(2);
    expect(mem.get('fitcms_snap')).toBe(before);
  });

  it('서버 새로고침이 연결 실패면 에러를 알리고 저장본은 남는다', async () => {
    const { initStore, store } = await fresh();
    await initStore();
    const before = mem.get('fitcms_snap');
    state.offline = true;
    await expect(initStore({ force: true })).rejects.toMatchObject({ code: 'unavailable' });
    expect(store.getMembers()).toHaveLength(2);
    expect(mem.get('fitcms_snap')).toBe(before);
  });
});
