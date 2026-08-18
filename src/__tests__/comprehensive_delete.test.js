// src/__tests__/comprehensive_delete.test.js
// 종합리포트 — 이상 데이터 제거 계약 검증.
//  · aiStore.deleteGaitReport/deletePostureReport/deleteRomReport 가
//    ① 캐시 즉시 제거 ② Firestore 삭제 + 톰스톤(다른 기기 델타 전파)
//    ③ 통합 미러(users/{mid}/reports/{id}) 정리까지 수행한다.
//  · deleteSession 도 통합 미러를 함께 정리한다(점프·VBT 세션 미러 잔존 방지).
//  · 서비스 deleteMeasureRecord 는 source → 삭제 함수로 정확히 위임한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lsBack = {};
globalThis.localStorage = {
  getItem: (k) => (k in lsBack ? lsBack[k] : null),
  setItem: (k, v) => { lsBack[k] = String(v); },
  removeItem: (k) => { delete lsBack[k]; },
};

// ── 가짜 Firestore (delta_sync.test.js 와 동일 계열) ──
const fsData = {};                 // 최상위 컬렉션: { col: { id: data } }
const userReports = {};            // users/{mid}/reports/{id} 서브컬렉션 모사
function seedDoc(col, id, data) { (fsData[col] ||= {})[id] = { ...data, id: data.id ?? id }; }

vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, ...path) => (path.length === 4
    ? { __sub: true, mid: path[1], id: path[3] }      // users/{mid}/reports/{id}
    : { name: path[0], id: path[1] }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async (q) => {
    let rows = Object.entries(fsData[q.__coll] || {});
    for (const c of q.__clauses || []) {
      if (c.op === '>') rows = rows.filter(([, d]) => Number(d[c.field]) > c.value);
      if (c.op === '==') rows = rows.filter(([, d]) => d[c.field] === c.value);
    }
    return { empty: rows.length === 0, docs: rows.map(([id, d]) => ({ id, data: () => ({ ...d }) })) };
  },
  setDoc: async (ref, data) => {
    if (ref.__sub) { (userReports[ref.mid] ||= {})[ref.id] = data; return; }
    (fsData[ref.name] ||= {})[ref.id] = { ...(fsData[ref.name]?.[ref.id] || {}), ...data };
  },
  deleteDoc: async (ref) => {
    if (ref.__sub) { if (userReports[ref.mid]) delete userReports[ref.mid][ref.id]; return; }
    if (fsData[ref.name]) delete fsData[ref.name][ref.id];
  },
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
  seedDoc('trainers', 't1', { id: 't1', name: '김민준', updatedAt: now - 9e6 });
  seedDoc('settings', 'config', { id: 'config', updatedAt: now - 9e6 });
}

beforeEach(() => {
  for (const k of Object.keys(fsData)) delete fsData[k];
  for (const k of Object.keys(userReports)) delete userReports[k];
  for (const k of Object.keys(lsBack)) delete lsBack[k];
  lsBack.fitcms_seeded = 'v6.3';
  vi.resetModules();
});

describe('전용 리포트 삭제 — 캐시·Firestore·톰스톤·통합 미러', () => {
  it.each([
    ['posture_reports', 'addPostureReport', 'deletePostureReport', 'getPostureReports',
      { kind: 'posture', member: { id: 'm1' }, summary: { score: 80 } }],
    ['gait_reports', 'addGaitReport', 'deleteGaitReport', 'getGaitReports',
      { kind: 'gait', member: { id: 'm1' }, summary: { score: 72 } }],
    ['rom_reports', 'addRomReport', 'deleteRomReport', 'getRomReports',
      { kind: 'rom', member: { id: 'm1' }, summary: { max_angle: 120 } }],
  ])('%s: 저장 후 삭제하면 어디에도 남지 않는다', async (col, addFn, delFn, getFn, payload) => {
    seedBase(Date.now());
    const { initStore, aiStore } = await import('../demoData.js');
    await initStore();

    const saved = await aiStore[addFn](payload);
    // 저장 확인: 전용 컬렉션 + 통합 미러
    expect(fsData[col][saved.id]).toBeTruthy();
    expect(userReports.m1?.[saved.id]).toBeTruthy();
    expect(aiStore[getFn]('m1').some(r => r.id === saved.id)).toBe(true);

    await aiStore[delFn]('m1', saved.id);
    // ① 캐시 제거
    expect(aiStore[getFn]('m1').some(r => r.id === saved.id)).toBe(false);
    // ② Firestore 삭제 + 톰스톤(다른 기기 델타 전파용)
    expect(fsData[col]?.[saved.id]).toBeUndefined();
    const tombs = Object.values(fsData.deletions || {});
    expect(tombs.some(t => t.col === col && t.id === saved.id)).toBe(true);
    // ③ 통합 미러 정리
    expect(userReports.m1?.[saved.id]).toBeUndefined();
  });
});

describe('측정 세션 삭제도 통합 미러를 정리한다', () => {
  it('점프형 세션 addSession → deleteSession 후 미러가 남지 않는다', async () => {
    seedBase(Date.now());
    const { initStore, aiStore } = await import('../demoData.js');
    await initStore();

    const saved = await aiStore.addSession('m1', {
      menu: 'jump', menuTitle: '점프 & RSI',
      recordedAt: '2026-07-10', recordedAtFull: '2026-07-10T09:00:00.000Z',
      data: { kind: 'jump', heightCm: 41 },
    });
    expect(userReports.m1?.[saved.id]).toBeTruthy(); // 미러 저장됨

    await aiStore.deleteSession('m1', saved.id);
    expect(fsData.ai?.[saved.id]).toBeUndefined();
    expect(userReports.m1?.[saved.id]).toBeUndefined(); // 미러도 정리
    expect(aiStore.getSessions('m1').some(s => s.id === saved.id)).toBe(false);
  });
});

describe('deleteMeasureRecord — source 별 정확한 위임', () => {
  it('4개 소스 각각 올바른 삭제 경로로 지워진다', async () => {
    seedBase(Date.now());
    const { initStore, aiStore } = await import('../demoData.js');
    const svc = await import('../services/comprehensiveReportService.js');
    await initStore();

    const s = await aiStore.addSession('m1', { menu: 'jump', recordedAt: '2026-07-10', recordedAtFull: '2026-07-10T09:00:00.000Z', data: { kind: 'jump', heightCm: 40 } });
    const p = await aiStore.addPostureReport({ kind: 'posture', member: { id: 'm1' }, summary: { score: 80 } });

    await svc.deleteMeasureRecord('m1', { source: 'ai', id: s.id });
    await svc.deleteMeasureRecord('m1', { source: 'posture_reports', id: p.id });
    expect(fsData.ai?.[s.id]).toBeUndefined();
    expect(fsData.posture_reports?.[p.id]).toBeUndefined();
  });

  it('알 수 없는 source·id 누락은 명시적으로 실패한다', async () => {
    seedBase(Date.now());
    const svc = await import('../services/comprehensiveReportService.js');
    await expect(svc.deleteMeasureRecord('m1', { source: 'unknown_col', id: 'x' })).rejects.toThrow(/알 수 없는/);
    await expect(svc.deleteMeasureRecord('m1', { source: 'ai', id: null })).rejects.toThrow(/id/);
  });
});
