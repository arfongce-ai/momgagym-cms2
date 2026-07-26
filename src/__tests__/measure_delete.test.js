// 측정별/회차별 데이터 삭제 기능 회귀 테스트.
//  · aiStore.deleteGaitReport/deletePostureReport/deleteRomReport 가 캐시+Firestore에서 지운다.
//  · comprehensiveReportService.deleteMeasureRound 가 세션+연결된 전용 리포트를 함께 지운다.
//  · comprehensiveReportService.deleteMeasureType 이 같은 유형의 여러 건을 한 번에 지운다.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mem = {};
const pathKey = (segs) => segs.join('/');

vi.mock('../firebase', () => ({ db: { __mock: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __coll: name }),
  doc: (_db, ...segs) => ({ name: segs[0], id: segs[segs.length - 1], path: pathKey(segs), segs }),
  query: (coll, ...clauses) => ({ ...coll, __clauses: clauses }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async (ref, data) => { mem[ref.path] = data; },
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
const { deleteMeasureRound, deleteMeasureType, DELETE_BY_SOURCE } = await import('../services/comprehensiveReportService.js');

beforeEach(async () => { for (const k of Object.keys(mem)) delete mem[k]; await initStore(); });

describe('aiStore.deleteGaitReport/deletePostureReport/deleteRomReport', () => {
  it('저장된 전용 리포트를 캐시와 Firestore 양쪽에서 지운다', async () => {
    const m = await store.addMember({ name: '삭제A' });
    const rep = await aiStore.addPostureReport({ member: { id: m.id }, analysis: {} });
    expect(aiStore.getPostureReports(m.id).some(r => r.id === rep.id)).toBe(true);
    await aiStore.deletePostureReport(m.id, rep.id);
    expect(aiStore.getPostureReports(m.id).some(r => r.id === rep.id)).toBe(false);
    expect(mem[`posture_reports/${rep.id}`]).toBeUndefined();
  });

  it('ROM/보행 리포트도 동일하게 삭제된다', async () => {
    const m = await store.addMember({ name: '삭제B' });
    const rom = await aiStore.addRomReport({ member: { id: m.id }, summary: { max_rom: 100 } });
    const gait = await aiStore.addGaitReport({ member: { id: m.id }, kind: 'gait' });
    await aiStore.deleteRomReport(m.id, rom.id);
    await aiStore.deleteGaitReport(m.id, gait.id);
    expect(aiStore.getRomReports(m.id).length).toBe(0);
    expect(aiStore.getGaitReports(m.id).length).toBe(0);
  });
});

describe('deleteMeasureRound — 회차 하나 삭제(세션 + 연결된 전용 리포트를 함께)', () => {
  it('세션과 연결된 전용 리포트를 둘 다 지운다(한쪽만 남는 고아 데이터 방지)', async () => {
    const m = await store.addMember({ name: '삭제C' });
    const session = await aiStore.addSession(m.id, { menu: 'posture', recordedAt: '2026-07-01', data: {} });
    const rep = await aiStore.addPostureReport({ member: { id: m.id }, analysis: {} });

    await deleteMeasureRound(m.id, session, { source: 'posture_reports', id: rep.id });

    expect(aiStore.getSessions(m.id).some(s => s.id === session.id)).toBe(false);
    expect(aiStore.getPostureReports(m.id).some(r => r.id === rep.id)).toBe(false);
  });

  it('연결된 전용 리포트가 없으면(예: 바벨 리프팅) 세션만 지운다', async () => {
    const m = await store.addMember({ name: '삭제D' });
    const session = await aiStore.addSession(m.id, { menu: 'lifting', recordedAt: '2026-07-01', data: {} });
    await deleteMeasureRound(m.id, session, null);
    expect(aiStore.getSessions(m.id).some(s => s.id === session.id)).toBe(false);
  });

  it('세션 정보가 없으면 명시적으로 실패한다(측정 정직성 — 조용히 무시하지 않음)', async () => {
    await expect(deleteMeasureRound('m1', null, null)).rejects.toThrow();
  });
});

describe('deleteMeasureType — 유형 전체 일괄 삭제', () => {
  it('같은 유형의 여러 세션 + 각 연결 리포트를 모두 지운다', async () => {
    const m = await store.addMember({ name: '삭제E' });
    const s1 = await aiStore.addSession(m.id, { menu: 'jump', recordedAt: '2026-07-01', data: { heightCm: 30 } });
    const s2 = await aiStore.addSession(m.id, { menu: 'jump', recordedAt: '2026-07-02', data: { heightCm: 32 } });
    const r1 = await aiStore.addGaitReport({ member: { id: m.id }, kind: 'jump' });
    const r2 = await aiStore.addGaitReport({ member: { id: m.id }, kind: 'jump' });

    await deleteMeasureType(m.id, [s1, s2], [
      { source: 'gait_reports', id: r1.id },
      { source: 'gait_reports', id: r2.id },
    ]);

    expect(aiStore.getSessions(m.id).length).toBe(0);
    expect(aiStore.getGaitReports(m.id).length).toBe(0);
  });

  it('회원 정보가 없으면 명시적으로 실패한다', async () => {
    await expect(deleteMeasureType(null, [], [])).rejects.toThrow();
  });
});

describe('DELETE_BY_SOURCE — source→삭제함수 매핑표', () => {
  it('ai/gait_reports/posture_reports/rom_reports 4개 소스를 모두 지원한다', () => {
    expect(Object.keys(DELETE_BY_SOURCE).sort()).toEqual(
      ['ai', 'gait_reports', 'posture_reports', 'rom_reports'].sort()
    );
  });
});
