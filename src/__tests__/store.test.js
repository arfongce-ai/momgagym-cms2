// store/aiStore/예약 원자성 회귀 테스트 (Vitest)
// firebase를 모킹해 Firestore 없이 저장 실패·롤백·원자성을 검증한다.
//   실행: npm test
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── firebase 모킹 ──────────────────────────────────────
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

const { store, aiStore, initStore } = await import('../demoData.js');
const setFail = (v) => { FAIL = v; };

beforeEach(async () => { FAIL = false; await initStore(); });

describe('저장 실패 전파 및 롤백 (CV-02)', () => {
  it('정상 추가 시 id를 반환한다', async () => {
    const m = await store.addMember({ name: 'A' });
    expect(m.id).toBeTruthy();
  });
  it('쓰기 실패 시 예외를 던지고 캐시를 롤백한다', async () => {
    const before = store.getMembers().length;
    setFail(true);
    await expect(store.addMember({ name: 'B' })).rejects.toThrow();
    expect(store.getMembers().length).toBe(before);
  });
});

describe('회원 파기 원자성 (CV-04/CV-06)', () => {
  it('purgeMember가 AI 기록까지 모두 삭제한다', async () => {
    const m = await store.addMember({ name: 'C' });
    await aiStore.addSession(m.id, { type: 'vbt' });
    await store.purgeMember(m.id);
    expect(store.getMembers().find(x => x.id === m.id)).toBeUndefined();
    expect(aiStore.getSessions(m.id).length).toBe(0);
  });
  it('purge 실패 시 캐시를 보존한다(부분삭제 없음)', async () => {
    const m = await store.addMember({ name: 'D' });
    setFail(true);
    await expect(store.purgeMember(m.id)).rejects.toThrow();
    expect(store.getMembers().find(x => x.id === m.id)).toBeTruthy();
  });
});

describe('예약 원자성 (NEW-03)', () => {
  it('예약 생성 시 세션을 1 차감하고 플래그를 세운다', async () => {
    const m = await store.addMember({ name: 'E', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const sch = await store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false });
    expect(sch.sessionDeducted).toBe(true);
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(4);
  });
  it('예약 batch 실패 시 세션 차감도 스케줄도 남지 않는다', async () => {
    const m = await store.addMember({ name: 'F', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const before = store.getSchedules().length;
    setFail(true);
    await expect(store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false })).rejects.toThrow();
    setFail(false);
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(5);
    expect(store.getSchedules().length).toBe(before);
  });
  it('취소 시 세션을 복원한다', async () => {
    const m = await store.addMember({ name: 'G', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    const sch = await store.createScheduleWithDeduction({ memberId: m.id, trainerId: 't1', isExternal: false });
    await store.finalizeSchedule(sch.id, 'canceled');
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(5);
  });
  it('외부 일정은 세션을 차감하지 않는다', async () => {
    const m = await store.addMember({ name: 'H', trainerSessions: { t1: { total: 10, remaining: 5 } } });
    await store.createScheduleWithDeduction({ memberId: null, trainerId: 't1', isExternal: true });
    expect(store.getMembers().find(x => x.id === m.id).trainerSessions.t1.remaining).toBe(5);
  });
});
