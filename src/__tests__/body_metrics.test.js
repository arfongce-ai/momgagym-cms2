// body_metrics.test.js
// ════════════════════════════════════════════════════════════════════════
//  services/bodyMetrics.js(resolveBodyMetrics)의 종단 테스트. 여러 AI측정
//  화면(점프 업로드/실시간, 바벨 허브)이 "키·몸무게 필요" 게이트를 각자
//  member.height/weight 직접 필드만 보고 구현하면서, 회원 신체기록(body 탭)에
//  이미 기록된 값을 빠뜨려 "▶ 분석 시작" 화면까지 도달하지 못하던 회귀를
//  막기 위해 이 함수 하나로 모았다 — 실제 store(demoData.js)를 통해 검증한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async () => {},
  deleteDoc: async () => {},
  writeBatch: () => {
    const ops = [];
    return {
      set(ref, data) { ops.push({ type: 'set', ref, data }); },
      delete(ref) { ops.push({ type: 'delete', ref }); },
      async commit() { return ops; },
    };
  },
}));

const { store, initStore } = await import('../demoData.js');
const { resolveBodyMetrics } = await import('../services/bodyMetrics.js');

beforeEach(async () => {
  await initStore({ force: true });
});

describe('resolveBodyMetrics — member 직접 필드 우선', () => {
  it('member 에 height/weight 가 모두 있으면 그대로 반환한다(신체기록 조회 없이)', () => {
    const member = { id: 'm1', height: 175, weight: 70 };
    expect(resolveBodyMetrics(member)).toEqual({ height: 175, weight: 70 });
  });

  it('member 가 없어도(null) fallback 값을 그대로 쓴다', () => {
    expect(resolveBodyMetrics(null, 180, 80)).toEqual({ height: 180, weight: 80 });
  });

  it('아무 정보도 없으면 둘 다 null', () => {
    expect(resolveBodyMetrics({ id: 'm1' })).toEqual({ height: null, weight: null });
  });
});

describe('resolveBodyMetrics — 회원 신체기록(body) 보강 조회', () => {
  it('member 에 height/weight 가 전혀 없어도 신체기록에 있으면 채운다 — 회귀 테스트(가장 최근 기록 우선)', async () => {
    const member = await store.addMember({ name: '김회원', trainerSessions: {} });
    await store.addBodyRecord(member.id, { recordedAt: '2026-06-01', height: 170, weight: 65 });
    await store.addBodyRecord(member.id, { recordedAt: '2026-07-01', height: 172, weight: 68 }); // 더 최근
    const fresh = store.getMembers().find(m => m.id === member.id);
    expect(resolveBodyMetrics(fresh)).toEqual({ height: 172, weight: 68 });
  });

  it('member.height 는 있고 weight 만 없으면, weight 만 신체기록에서 채운다(height 는 member 값 유지)', async () => {
    const member = await store.addMember({ name: '박회원', height: 180, trainerSessions: {} });
    await store.addBodyRecord(member.id, { recordedAt: '2026-07-01', height: 999, weight: 82 }); // height 는 무시돼야 함
    const fresh = store.getMembers().find(m => m.id === member.id);
    expect(resolveBodyMetrics(fresh)).toEqual({ height: 180, weight: 82 });
  });

  it('핵심 회귀 시나리오: member.height 가 비어 있고 weight 만 신체기록에 있으면, height 는 여전히 null이어야 한다(체중만 있다고 키가 채워지면 안 됨)', async () => {
    const member = await store.addMember({ name: '이회원', trainerSessions: {} });
    await store.addBodyRecord(member.id, { recordedAt: '2026-07-01', weight: 60 }); // height 없음
    const fresh = store.getMembers().find(m => m.id === member.id);
    expect(resolveBodyMetrics(fresh)).toEqual({ height: null, weight: 60 });
  });

  it('여러 트레이너/기록 중 recordedAt 이 가장 최근인 값을 우선한다', async () => {
    const member = await store.addMember({ name: '최회원', trainerSessions: {} });
    await store.addBodyRecord(member.id, { recordedAt: '2026-01-01', height: 160, weight: 55 });
    await store.addBodyRecord(member.id, { recordedAt: '2026-05-01', height: 163, weight: 58 });
    await store.addBodyRecord(member.id, { recordedAt: '2026-03-01', height: 161, weight: 56 });
    const fresh = store.getMembers().find(m => m.id === member.id);
    expect(resolveBodyMetrics(fresh)).toEqual({ height: 163, weight: 58 });
  });

  it('member.id 가 없으면(신규/게스트) 신체기록 조회를 시도하지 않고 fallback 을 쓴다', () => {
    const member = { name: '게스트' }; // id 없음
    expect(resolveBodyMetrics(member, 175, 70)).toEqual({ height: 175, weight: 70 });
  });

  it('신체기록이 아예 없는 회원은 fallback 값을 그대로 쓴다', async () => {
    const member = await store.addMember({ name: '정회원', trainerSessions: {} });
    const fresh = store.getMembers().find(m => m.id === member.id);
    expect(resolveBodyMetrics(fresh, 168, null)).toEqual({ height: 168, weight: null });
  });
});
