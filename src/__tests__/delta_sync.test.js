// src/__tests__/delta_sync.test.js
// ════════════════════════════════════════════════════════════════════════
//  Firestore 읽기 절감 — 델타 동기화 검증.
//  시나리오: ① 최초 접속(전수 로딩 + 스냅샷 저장)
//           ② 다른 기기에서 일정 1건 수정 + 회원 1건 삭제(톰스톤)
//           ③ 재접속 → 스냅샷 복원 + meta 1건 + 변경 컬렉션만 델타 조회
//  검증: 재접속 읽기 = meta(1) + schedules 델타(1) + deletions(1) 뿐이어야 하며,
//        캐시에는 수정·삭제가 정확히 반영된다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 가짜 localStorage (스냅샷 저장/복원 경로 활성화) ──
const lsBack = {};
globalThis.localStorage = {
  getItem: (k) => (k in lsBack ? lsBack[k] : null),
  setItem: (k, v) => { lsBack[k] = String(v); },
  removeItem: (k) => { delete lsBack[k]; },
};

// ── 가짜 Firestore: 컬렉션별 문서 + where(updatedAt/at >) 지원 ──
const fsData = {};           // { col: { id: data } }
const readLog = [];          // 조회된 컬렉션 이름 기록
function seedDoc(col, id, data) { (fsData[col] ||= {})[id] = { ...data, id: data.id ?? id }; }

vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, name, id) => ({ name, id }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async (q) => {
    const name = q.__coll;
    readLog.push(name);
    let rows = Object.entries(fsData[name] || {});
    for (const c of q.__clauses || []) {
      if (c.op === '>') rows = rows.filter(([, d]) => Number(d[c.field]) > c.value);
      if (c.op === '==') rows = rows.filter(([, d]) => d[c.field] === c.value);
    }
    return {
      empty: rows.length === 0,
      docs: rows.map(([id, d]) => ({ id, data: () => ({ ...d }) })),
    };
  },
  setDoc: async (ref, data) => { (fsData[ref.name] ||= {})[ref.id] = { ...(fsData[ref.name]?.[ref.id] || {}), ...data }; },
  deleteDoc: async (ref) => { if (fsData[ref.name]) delete fsData[ref.name][ref.id]; },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(['set', ref, data]),
      delete: (ref) => ops.push(['del', ref]),
      commit: async () => {
        for (const [t, ref, data] of ops) {
          if (t === 'set') (fsData[ref.name] ||= {})[ref.id] = { ...(fsData[ref.name]?.[ref.id] || {}), ...data };
          else if (fsData[ref.name]) delete fsData[ref.name][ref.id];
        }
      },
    };
  },
}));

function seedBase(now) {
  seedDoc('members', 'm1', { id: 'm1', name: '홍길동', isActive: true, updatedAt: now - 9e6 });
  seedDoc('members', 'm2', { id: 'm2', name: '김영희', isActive: true, updatedAt: now - 9e6 });
  seedDoc('trainers', 't1', { id: 't1', name: '김민준', updatedAt: now - 9e6 });
  seedDoc('schedules', 's1', { id: 's1', memberId: 'm1', date: '2026-07-07', status: 'scheduled', updatedAt: now - 9e6 });
  seedDoc('settings', 'config', { id: 'config', cardFeeRate: 0.4, updatedAt: now - 9e6 });
}

beforeEach(() => {
  for (const k of Object.keys(fsData)) delete fsData[k];
  for (const k of Object.keys(lsBack)) delete lsBack[k];
  readLog.length = 0;
  lsBack.fitcms_seeded = 'v6.1'; // 시드 확인 스킵(읽기 절감 플래그)
  vi.resetModules();
});

describe('델타 동기화 — 재접속은 변경분만 읽는다', () => {
  it('② 변경 없음: 재접속 총 읽기 = meta 1건', async () => {
    const now = Date.now();
    seedBase(now);
    const mod1 = await import('../demoData.js');
    await mod1.initStore();                     // ① 전수 로딩 + 스냅샷
    expect(mod1.store.getMembers().length).toBe(2);

    readLog.length = 0;
    vi.resetModules();
    const mod2 = await import('../demoData.js'); // ③ 재접속(새 세션)
    await mod2.initStore();
    // meta 조회 1회뿐 — 어떤 데이터 컬렉션도 다시 읽지 않는다.
    expect(readLog).toEqual(['meta']);
    expect(mod2.store.getMembers().length).toBe(2); // 스냅샷 복원 정상
  });

  it('②③ 일정 수정 + 회원 삭제가 델타로만 전파된다', async () => {
    const now = Date.now();
    seedBase(now);
    const mod1 = await import('../demoData.js');
    await mod1.initStore();

    // ② 다른 기기에서: s1 상태 변경 + m2 삭제(톰스톤) + meta 갱신
    const t = Date.now() + 1000;
    seedDoc('schedules', 's1', { id: 's1', memberId: 'm1', date: '2026-07-07', status: 'attended', updatedAt: t });
    delete fsData.members.m2;
    seedDoc('deletions', `members_m2_${t}`, { col: 'members', id: 'm2', at: t });
    seedDoc('meta', 'versions', { schedules: t, members: t, deletions: t });

    readLog.length = 0;
    vi.resetModules();
    const mod2 = await import('../demoData.js');
    await mod2.initStore();

    // 읽기: meta + 바뀐 컬렉션(schedules, members 델타) + deletions 뿐.
    expect(readLog.sort()).toEqual(['deletions', 'members', 'meta', 'schedules']);
    // 병합 결과 검증
    const s1 = mod2.store.getSchedules().find(x => x.id === 's1');
    expect(s1.status).toBe('attended');                       // 수정 반영
    expect(mod2.store.getMembers().some(m => m.id === 'm2')).toBe(false); // 삭제 전파
    expect(mod2.store.getMembers().some(m => m.id === 'm1')).toBe(true);
  });

  it('쓰기 래퍼가 updatedAt·meta·톰스톤을 남긴다(다른 기기 전파의 전제)', async () => {
    const now = Date.now();
    seedBase(now);
    const mod = await import('../demoData.js');
    await mod.initStore();

    await mod.store.addSchedule({ memberId: 'm1', memberName: '홍길동', trainerId: 't1', trainerName: '김민준', date: '2026-07-08', startTime: '10:00', endTime: '11:00', classType: '재활', status: 'scheduled' });
    const added = Object.values(fsData.schedules).find(s => s.date === '2026-07-08');
    expect(Number(added.updatedAt)).toBeGreaterThan(0);
    expect(Number(fsData.meta?.versions?.schedules)).toBeGreaterThan(0);

    const victim = mod.store.getMembers()[0];
    await mod.store.deleteMember(victim.id);
    const tombs = Object.values(fsData.deletions || {});
    expect(tombs.some(x => x.col === 'members' && x.id === victim.id)).toBe(true);
    expect(Number(fsData.meta.versions.deletions)).toBeGreaterThan(0);
  });
});
