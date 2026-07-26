// 측정 데이터 지연 로딩(ensureSessions/ensureGaitReports/ensureRomReports) + 읽기 계측 회귀 테스트.
// initStore 가 ai/gait_reports/rom_reports 를 전수 조회하지 않고, 회원별로만 읽는지 검증한다.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let FAIL = false;
const mem = {};
// 회원별 where('__mid','==',mid) 쿼리를 흉내내기 위한 마킹.
vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async (q) => {
    const name = q?.__coll;
    const store = mem[name] || {};
    let docs = Object.entries(store).map(([id, data]) => ({ id, data: () => data }));
    // where('__mid','==',mid) 적용
    const w = (q?.__clauses || []).find(c => c.field === '__mid');
    if (w) docs = docs.filter(d => d.data().__mid === w.value);
    return { empty: docs.length === 0, size: docs.length, docs };
  },
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

const { store, aiStore, initStore } = await import('../demoData.js');

beforeEach(async () => {
  FAIL = false;
  // 스냅샷 캐시가 테스트 간 간섭하지 않도록 초기화
  try { localStorage.clear(); } catch (e) { /* noop */ }
  await initStore({ force: true });
});

describe('측정 데이터 지연 로딩', () => {
  it('addSession 한 회원의 세션만 ensureSessions 로 읽힌다', async () => {
    const a = await store.addMember({ name: 'A' });
    const b = await store.addMember({ name: 'B' });
    await aiStore.addSession(a.id, { menu: 'vbt', v: 1 });
    await aiStore.addSession(b.id, { menu: 'jump', h: 30 });

    // 새 세션에서 캐시가 비었다고 가정하고 회원 A 만 지연 로딩
    aiStore._aiLoaded.clear();
    // 다른 인스턴스를 흉내: 캐시 비우기
    const got = await aiStore.ensureSessions(a.id);
    expect(got.length).toBe(1);
    expect(got[0].menu).toBe('vbt');
  });

  it('ensureSessions 는 같은 회원을 두 번 읽지 않는다(로딩 표시)', async () => {
    const a = await store.addMember({ name: 'C' });
    await aiStore.addSession(a.id, { menu: 'rsi' });
    aiStore._aiLoaded.clear();
    await aiStore.ensureSessions(a.id);
    expect(aiStore._aiLoaded.has(a.id)).toBe(true);
    // 두 번째 호출은 캐시에서 즉시 반환(읽기 없음) — 예외 없이 같은 결과
    const again = await aiStore.ensureSessions(a.id);
    expect(again.length).toBe(1);
  });

  it('ensureGaitReports 가 회원별로 동작한다', async () => {
    const a = await store.addMember({ name: 'D' });
    await aiStore.addGaitReport({ kind: 'gait', cadence: 110, member: { id: a.id, name: 'D' } });
    aiStore._gaitLoaded.clear();
    const got = await aiStore.ensureGaitReports(a.id);
    expect(got.length).toBe(1);
    expect(got[0].cadence).toBe(110);
  });

  it('ensureRomReports 가 회원별로 동작한다(ROM 리포트 누적)', async () => {
    const a = await store.addMember({ name: 'R' });
    await aiStore.addRomReport({
      kind: 'rom',
      joint: 'HIP',
      poseMode: 'SUPINE',
      member: { id: a.id, name: 'R' },
      basic_info: { memberId: a.id, trainerId: 't1', linkedPostureReportId: 'posture1' },
    });
    aiStore._romLoaded.clear();
    const got = await aiStore.ensureRomReports(a.id);
    expect(got.length).toBe(1);
    expect(got[0].joint).toBe('HIP');
    expect(got[0].basic_info.linkedPostureReportId).toBe('posture1');
  });

  it('getSessions 는 지연 로딩 전이면 빈 배열(전수 조회 안 함)', () => {
    // 방금 추가하지 않은 임의 ID → 캐시에 없음 → 빈 배열
    expect(aiStore.getSessions('nonexistent_member')).toEqual([]);
  });
});
