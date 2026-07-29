import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../demoData.js', () => ({
  store: {},
  aiStore: {
    ensurePostureReports: vi.fn(),
    ensureRomReports: vi.fn(),
    ensureGaitReports: vi.fn(),
    ensureSessions: vi.fn(),
  },
}));

import { aiStore } from '../demoData.js';
import { askMomi, loadLatestReportsByKind, buildMemberCombinedAssessment } from '../services/momiService.js';

function mockFetchOk(payloadCapture) {
  global.fetch = vi.fn(async (_url, opts) => {
    payloadCapture.body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ text: '모미 응답' }) };
  });
}

describe('momiService — stance/squat/lifting 확장', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiStore.ensurePostureReports.mockResolvedValue([]);
    aiStore.ensureRomReports.mockResolvedValue([]);
    aiStore.ensureGaitReports.mockResolvedValue([]);
    aiStore.ensureSessions.mockResolvedValue([]);
  });

  it('report/member 없으면 에러', async () => {
    await expect(askMomi({ kind: 'posture' })).rejects.toThrow();
  });

  it('세션 목록에서 menu 필드로 stance/squat/lifting을 걸러 crossContext에 채운다', async () => {
    aiStore.ensureSessions.mockResolvedValue([
      { menu: 'stance', data: { kind: 'stance', status: 'normal' }, recordedAtFull: '2026-07-27' },
      { menu: 'squat', data: { kind: 'squat', status: 'caution' }, recordedAtFull: '2026-07-26' },
      { menu: 'lifting', data: { mode: 'vbt', metrics: {} }, recordedAtFull: '2026-07-25' },
      { menu: 'body', data: { height: 170 }, recordedAtFull: '2026-07-24' }, // 측정 아님 — 걸러져야 함
    ]);
    const captured = {};
    mockFetchOk(captured);

    await askMomi({ kind: 'posture', report: { analysis: { frontal: {} } }, member: { id: 'm1', name: '홍길동' } });

    const kinds = captured.body.crossContext.cross_measure_context.sources.map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['stance', 'squat', 'lifting']));
  });

  it('세션이 없는 measure(예: body)는 stance/squat/lifting 소스에 섞이지 않는다', async () => {
    aiStore.ensureSessions.mockResolvedValue([
      { menu: 'body', data: { height: 170 }, recordedAtFull: '2026-07-24' },
    ]);
    const captured = {};
    mockFetchOk(captured);
    await askMomi({ kind: 'posture', report: { analysis: { frontal: {} } }, member: { id: 'm2' } });
    const kinds = captured.body.crossContext.cross_measure_context.sources.map((s) => s.kind);
    expect(kinds).not.toContain('lifting');
    expect(kinds).not.toContain('stance');
  });

  describe('loadLatestReportsByKind / buildMemberCombinedAssessment', () => {
    it('종류별 최신 1건씩만 뽑는다', async () => {
      aiStore.ensureSessions.mockResolvedValue([
        { menu: 'stance', data: { kind: 'stance', status: 'normal' }, recordedAtFull: '2026-07-20' },
        { menu: 'stance', data: { kind: 'stance', status: 'risk' }, recordedAtFull: '2026-07-27' }, // 최신
      ]);
      const byKind = await loadLatestReportsByKind('m3');
      expect(byKind.stance.status).toBe('risk');
    });

    it('트레이너가 고른 종류만 결합 평가에 들어간다', async () => {
      aiStore.ensurePostureReports.mockResolvedValue([{ id: 'p1', createdAt: '2026-07-20', analysis: { frontal: {} } }]);
      aiStore.ensureSessions.mockResolvedValue([
        { menu: 'stance', data: { kind: 'stance', status: 'risk' }, recordedAtFull: '2026-07-27' },
      ]);
      const byKind = await loadLatestReportsByKind('m4');
      const combinedAll = buildMemberCombinedAssessment(byKind);
      expect(combinedAll.combinedKinds).toEqual(expect.arrayContaining(['posture', 'stance']));

      const combinedPostureOnly = buildMemberCombinedAssessment(byKind, ['posture']);
      expect(combinedPostureOnly.combinedKinds).toEqual(['posture']);
    });

    it('아무 측정도 없으면 null', async () => {
      const byKind = await loadLatestReportsByKind('m5');
      expect(buildMemberCombinedAssessment(byKind)).toBeNull();
    });
  });
});
