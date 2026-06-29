// 통합 리포트 미러링 회귀 테스트 (Vitest)
//   측정 저장 시 users/{mid}/reports/{reportId} 로 표준 규격 문서가 함께 저장되는지,
//   그리고 통합 저장 실패가 본래의 측정 저장을 절대 회귀시키지 않는지(측정 정직성) 검증.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── firebase 모킹 (다중 세그먼트 doc 경로 지원) ──────────────
let MIRROR_FAIL = false;       // users/.../reports 경로 저장만 실패시킴
const mem = {};
const pathKey = (segs) => segs.join('/');

vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  // doc(db, ...segments) — 가변 인자. 마지막을 id, 전체를 path 로 보관.
  doc: (_db, ...segs) => ({ name: segs[0], id: segs[segs.length - 1], path: pathKey(segs), segs }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async (ref, data) => {
    const isMirror = ref.segs && ref.segs[0] === 'users' && ref.segs.includes('reports');
    if (isMirror && MIRROR_FAIL) throw new Error('mirror denied');
    (mem[ref.path] ||= {}); mem[ref.path] = data;
  },
  deleteDoc: async (ref) => { delete mem[ref.path]; },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(['set', ref, data]),
      delete: (ref) => ops.push(['del', ref]),
      commit: async () => { for (const [t, ref, data] of ops) { if (t === 'set') mem[ref.path] = data; else delete mem[ref.path]; } },
    };
  },
}));

const { store, aiStore, initStore } = await import('../demoData.js');

const mirrorDocs = () => Object.entries(mem)
  .filter(([p]) => p.startsWith('users/') && p.includes('/reports/'))
  .map(([, v]) => v);

beforeEach(async () => { MIRROR_FAIL = false; for (const k of Object.keys(mem)) delete mem[k]; await initStore(); });

describe('통합 리포트 미러링', () => {
  it('자세 리포트 저장 시 users/{mid}/reports 에 표준 문서를 미러링한다', async () => {
    const m = await store.addMember({ name: '미러A' });
    await aiStore.addPostureReport({ member: { id: m.id }, analysis: { frontal: { shoulderHeightDiffMm: 5 } } });
    const docs = mirrorDocs();
    expect(docs.length).toBe(1);
    expect(docs[0].schemaVersion).toBe('mg-report-v1');
    expect(docs[0].userId).toBe(m.id);
    expect(docs[0].reportType).toBe('posture');
    // 영상 저장 배제 정책이 문서에 명시된다.
    expect(docs[0].storagePolicy.videoStored).toBe(false);
    expect(docs[0].storagePolicy.storesResultDataOnly).toBe(true);
    // raw/summary 분리.
    expect(docs[0].raw).toBeTruthy();
    expect(docs[0].summary).toBeTruthy();
  });

  it('ROM 리포트도 reportType=rom 으로 미러링한다', async () => {
    const m = await store.addMember({ name: '미러B' });
    await aiStore.addRomReport({ member: { id: m.id }, summary: { max_angle: 120 } });
    const docs = mirrorDocs();
    expect(docs.length).toBe(1);
    expect(docs[0].reportType).toBe('rom');
  });

  it('측정 ai 세션(jump)은 미러링하고 비측정 세션(body)은 미러링하지 않는다', async () => {
    const m = await store.addMember({ name: '미러C' });
    await aiStore.addSession(m.id, { menu: 'jump', data: {}, heightCm: 42 });
    await aiStore.addSession(m.id, { menu: 'body', weight: 70 });
    const types = mirrorDocs().map(d => d.reportType);
    expect(types).toContain('jump');
    expect(types).not.toContain('general');
    expect(mirrorDocs().length).toBe(1);
  });

  it('측정 정직성: 통합 미러 저장이 실패해도 본래의 측정 저장은 성공한다', async () => {
    const m = await store.addMember({ name: '미러D' });
    MIRROR_FAIL = true;
    const r = await aiStore.addRomReport({ member: { id: m.id }, summary: { max_angle: 90 } });
    // 핵심 저장은 정상 반환되고 캐시에 남는다.
    expect(r.id).toBeTruthy();
    expect(aiStore.getRomReports(m.id).some(x => x.id === r.id)).toBe(true);
    // 미러는 저장되지 않았다.
    expect(mirrorDocs().length).toBe(0);
  });
});
