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

// [역할별 응답 범위 2026-08-08] askMomi류가 Firebase ID 토큰을 Authorization 헤더로
// 보내는지 검증하기 위한 가짜 auth. voiceCommandService.js 테스트와 달리 여기선
// 실제로 로그인된 사용자가 있는 경우의 동작(토큰이 실제로 담기는지)까지 확인한다.
vi.mock('../firebase.js', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('fake-id-token-123'),
    },
  },
}));

import { aiStore } from '../demoData.js';
import { askMomi, loadLatestReportsByKind, buildMemberCombinedAssessment, askMomiCombined } from '../services/momiService.js';

function mockFetchOk(payloadCapture) {
  global.fetch = vi.fn(async (_url, opts) => {
    payloadCapture.body = JSON.parse(opts.body);
    payloadCapture.headers = opts.headers;
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

  // [역할별 응답 범위 2026-08-08] "관리자·트레이너 접근 구분을 모미에도 적용" 요청
  // 대응. 서버(functions/api/momi.js)가 role을 검증하려면 클라이언트가 Firebase ID
  // 토큰을 보내야 한다 — voiceCommandService.js와 동일 패턴.
  it('Firebase ID 토큰을 Authorization 헤더로 함께 보낸다(서버 role 검증용)', async () => {
    const captured = {};
    mockFetchOk(captured);
    await askMomi({ kind: 'posture', report: { analysis: { frontal: {} } }, member: { id: 'm1', name: '홍길동' } });
    expect(captured.headers.Authorization).toBe('Bearer fake-id-token-123');
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

  // [축1 — 트레이너 요청 기반 통합 분석] CombinedAssessmentPanel의 룰 기반 결과를
  // 모미에게 넘겨 통합 가이드를 받는 실제 호출부. buildProblemFocus를 거치지 않고
  // result를 그대로 report로 보내는지가 핵심(momiPrompt.js 섹션 5-2 참고 — 'combined'
  // kind는 buildProblemFocus에 대응 분기가 없어, 만약 거쳤다면 issues/strengths가
  // 빈 배열로 날아가 모미에게 아무 정보도 전달되지 않았을 것이다).
  describe('askMomiCombined', () => {
    it('member 또는 result 없으면 에러', async () => {
      await expect(askMomiCombined({ member: { id: 'm1' } })).rejects.toThrow();
      await expect(askMomiCombined({ result: { severity: 'normal', issues: [], strengths: [] } })).rejects.toThrow();
    });

    it("kind:'combined'로, buildCombinedAssessment 결과를 그대로(재가공 없이) report에 담아 보낸다", async () => {
      const captured = {};
      mockFetchOk(captured);
      const result = {
        severity: 'caution',
        issues: [{ level: 'caution', text: '무릎 밸거스 패턴 확인됨' }],
        strengths: ['가동범위는 양호'],
        evaluation: { text: '전반적으로 주의가 필요합니다.' },
        combinedKinds: ['posture', 'squat'],
        coverageScore: 62,
      };

      await askMomiCombined({ member: { id: 'm1', name: '홍길동' }, result });

      expect(captured.body.kind).toBe('combined');
      expect(captured.body.report.severity).toBe('caution');
      expect(captured.body.report.issues).toEqual(result.issues);
      expect(captured.body.report.strengths).toEqual(result.strengths);
      expect(captured.body.report.combinedKinds).toEqual(['posture', 'squat']);
      expect(captured.body.report.coverageScore).toBe(62);
      expect(captured.body.report.primaryFinding).toBe('무릎 밸거스 패턴 확인됨');
    });

    it('응답 text를 그대로 반환한다', async () => {
      mockFetchOk({});
      const text = await askMomiCombined({
        member: { id: 'm1', name: '홍길동' },
        result: { severity: 'normal', issues: [], strengths: ['양호'] },
      });
      expect(text).toBe('모미 응답');
    });

    it('askMomiCombined도 Authorization 헤더를 함께 보낸다', async () => {
      const captured = {};
      mockFetchOk(captured);
      await askMomiCombined({
        member: { id: 'm1', name: '홍길동' },
        result: { severity: 'normal', issues: [], strengths: ['양호'] },
      });
      expect(captured.headers.Authorization).toBe('Bearer fake-id-token-123');
    });
  });
});
