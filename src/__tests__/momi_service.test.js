import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../demoData.js', () => ({
  store: { getBodyRecords: vi.fn(() => []) },
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

import { aiStore, store } from '../demoData.js';
import { askMomi, loadLatestReportsByKind, buildMemberCombinedAssessment, askMomiCombined, buildConditionTrend, compactReportForMomi } from '../services/momiService.js';

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

  // [매출 데이터 연결 배선 준비 2026-08-08] businessContext를 항상 같이 보낸다 —
  // role에 따른 최종 필터링은 서버(momi.js)가 한다(momi_role_scope.test.js 참고).
  it('회원에 이용권/출석 정보가 있으면 businessContext를 페이로드에 포함한다', async () => {
    const captured = {};
    mockFetchOk(captured);
    await askMomi({
      kind: 'posture',
      report: { analysis: { frontal: {} } },
      member: { id: 'm1', name: '홍길동', trainerSessions: { t1: { total: 10, remaining: 2 } } },
    });
    expect(captured.body.businessContext).not.toBeNull();
    expect(captured.body.businessContext.signals.lowSessionBalance).toBe(true);
  });

  it('회원에 참고할 이용권/출석 정보가 전혀 없으면 businessContext는 null', async () => {
    const captured = {};
    mockFetchOk(captured);
    await askMomi({ kind: 'posture', report: { analysis: { frontal: {} } }, member: { id: 'm1', name: '홍길동' } });
    expect(captured.body.businessContext).toBeNull();
  });

  // [Axis4 시작 2026-08-08] 후속 질문(history 있음)이면 crossContext/businessContext
  // 재계산을 건너뛰고(loadCrossReports 등 Firestore 조회 반복 방지), history를 그대로
  // 페이로드에 담아 보낸다.
  describe('history(후속 질문) 지원', () => {
    it('history가 없으면(첫 턴) crossContext/businessContext를 계산해서 보낸다', async () => {
      const captured = {};
      mockFetchOk(captured);
      await askMomi({
        kind: 'posture',
        report: { analysis: { frontal: {} } },
        member: { id: 'm1', name: '홍길동' },
      });
      expect(captured.body.history).toBeNull();
      // crossContext는 세션이 비어있어도 buildCrossMeasureIntegration이 호출됐다는 것 자체가
      // 확인 포인트 — null이든 객체든, 최소한 businessContext 키가 존재해야 한다(첫 턴 로직 탐).
      expect('businessContext' in captured.body).toBe(true);
    });

    it('history가 있어도 현재 교차 측정 컨텍스트를 다시 붙인다(캐시 기반 ensure 호출)', async () => {
      const captured = {};
      mockFetchOk(captured);
      await askMomi({
        kind: 'posture',
        report: { analysis: { frontal: {} } },
        member: { id: 'm1', name: '홍길동' },
        question: '그럼 다음 세션엔 뭘 해야 할까요?',
        history: [
          { role: 'user', content: '이 리포트를 분석해줘.' },
          { role: 'assistant', content: '어깨 정렬이 양호합니다.' },
        ],
      });
      expect(aiStore.ensureSessions).toHaveBeenCalledWith('m1');
    });

    it('history가 있으면 그대로 페이로드에 담아 보낸다', async () => {
      const captured = {};
      mockFetchOk(captured);
      const history = [
        { role: 'user', content: '이 리포트를 분석해줘.' },
        { role: 'assistant', content: '어깨 정렬이 양호합니다.' },
      ];
      await askMomi({
        kind: 'posture',
        report: { analysis: { frontal: {} } },
        member: { id: 'm1', name: '홍길동' },
        question: '골반은요?',
        history,
      });
      expect(captured.body.history).toEqual(history);
      expect(captured.body.question).toBe('골반은요?');
    });

    it('후속 질문에서도 report/member는 그대로 보낸다(서버 필수값 검증 통과용)', async () => {
      const captured = {};
      mockFetchOk(captured);
      await askMomi({
        kind: 'posture',
        report: { analysis: { frontal: {} }, id: 'r1' },
        member: { id: 'm1', name: '홍길동' },
        question: '골반은요?',
        history: [{ role: 'user', content: '이 리포트를 분석해줘.' }, { role: 'assistant', content: '...' }],
      });
      expect(captured.body.report).toBeTruthy();
      expect(captured.body.report.measurements.id).toBe('r1');
      expect(captured.body.report.summary).toBeTruthy();
      expect(captured.body.member.name).toBe('홍길동');
    });
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
    const stance = captured.body.crossContext.cross_measure_context.sources.find((s) => s.kind === 'stance');
    expect(stance.findings.primaryFinding).toBeTruthy();
    expect(stance.qualityScore).toBeGreaterThan(0);
  });

  it('원본 리포트 압축 시 수치는 남기고 영상·랜드마크·URL은 제거한다', () => {
    const compact = compactReportForMomi({ angle: 12, videoBlob: 'huge', landmarks: [1, 2], reportUrl: 'https://example.com', nested: { status: 'risk' } });
    expect(compact).toEqual({ angle: 12, nested: { status: 'risk' } });
  });

  it('컨디션 추이는 최근 N건이 아니라 실제 최근 N일만 포함한다', () => {
    store.getBodyRecords.mockReturnValue([
      { recordedAt: '2026-08-14T09:00:00+09:00', fatigue: 4, conditionStatus: 'caution' },
      { recordedAt: '2026-08-14T18:00:00+09:00', painNrs: 2, conditionStatus: 'normal' },
      { recordedAt: '2026-08-01T09:00:00+09:00', fatigue: 5, conditionStatus: 'risk' },
    ]);
    const trend = buildConditionTrend({ id: 'm1' }, { days: 7, now: new Date('2026-08-14T23:00:00+09:00') });
    expect(trend.entries).toHaveLength(2);
    expect(trend.summary).toContain('1일 기록');
    expect(trend.summary).toContain('주의 이상 1건');
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
