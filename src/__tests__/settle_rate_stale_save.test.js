// settle_rate_stale_save.test.js
// 회귀 테스트: 설정 탭을 오래 열어둔 세션에서 저장해도, 그 사이 다른 세션이 바꾼
// 트레이너별 정산비율(trainerSplitRates)을 되돌리지 않아야 한다.
//  · 실제 버그: ConfigTab의 form을 통째로 store.updateSettings(form)에 넘기던 기존 코드는
//    안 건드린 트레이너의 값까지 마운트 시점 스냅샷으로 덮어써, "6월에 60%로 고정했는데
//    7월에 다시 50%로 보이는" 사고를 일으켰다.
//  · 수정: updateSettings는 저장 직전 서버 최신 settings를 다시 읽고, 그 위에
//    trainerSplitRateChanges(변경된 트레이너만)와 실제로 바뀐 스칼라 필드만 얹는다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let settingsServerDoc = null; // 서버(Firestore)에 실제로 저장된 settings 문서 — 다른 세션의 쓰기를 흉내

vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async (q) => {
    const name = q.__coll || q.name;
    if (name === 'settings' && settingsServerDoc) {
      return { empty: false, docs: [{ data: () => settingsServerDoc }] };
    }
    return { empty: true, docs: [] };
  },
  setDoc: async (ref, data) => {
    if (ref.name === 'settings' && ref.id === 'config') settingsServerDoc = data;
  },
  deleteDoc: async () => {},
  writeBatch: () => ({ set() {}, delete() {}, commit: async () => {} }),
}));

const { store, initStore } = await import('../demoData.js');

beforeEach(async () => {
  settingsServerDoc = null;
  await initStore();
});

describe('정산비율 저장 — 부분 병합으로 다른 트레이너 값을 되돌리지 않는다', () => {
  it('안 건드린 트레이너의 서버 최신 비율을 보존한다', async () => {
    // 다른 세션이 방금 t1을 60%로 고정해 서버에 저장해 둔 상태.
    settingsServerDoc = { id: 'config', trainerSplitRates: { t1: 60 } };

    // 이 세션은 t2만 40%로 새로 지정해서 저장(t1은 이 세션 폼에서 건드리지 않음).
    await store.updateSettings({ trainerSplitRateChanges: { t2: 40 } });

    const s = store.getSettings();
    expect(s.trainerSplitRates.t1).toBe(60); // 되돌아가면 안 됨
    expect(s.trainerSplitRates.t2).toBe(40);
  });

  it('안 건드린 일반 필드도 서버 최신값을 덮어쓰지 않는다', async () => {
    settingsServerDoc = { id: 'config', vatRate: 12, trainerSplitRates: {} };
    await store.updateSettings({ cardFeeRate: 0.5 }); // vatRate는 patch에 없음
    const s = store.getSettings();
    expect(s.vatRate).toBe(12);
    expect(s.cardFeeRate).toBe(0.5);
  });

  it('trainerSplitRateChanges에 null을 주면 해당 트레이너를 자동(키 삭제)으로 되돌린다', async () => {
    settingsServerDoc = { id: 'config', trainerSplitRates: { t1: 60, t2: 50 } };
    await store.updateSettings({ trainerSplitRateChanges: { t1: null } });
    const s = store.getSettings();
    expect(s.trainerSplitRates.t1).toBeUndefined();
    expect(s.trainerSplitRates.t2).toBe(50);
  });
});
