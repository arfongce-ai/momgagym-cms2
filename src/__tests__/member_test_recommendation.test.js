import { describe, expect, it } from 'vitest';
import { buildMemberTestRecommendations, TEST_RECOMMENDATION_VERSION } from '../ai-measure/core/memberTestRecommendation';

const NOW = new Date('2026-08-15T03:00:00.000Z');

function build(input = {}) {
  return buildMemberTestRecommendations({
    member: { id: 'm1', name: '홍길동', ...input.member },
    bodyRecords: input.bodyRecords || [],
    reportsByKind: input.reportsByKind || {},
    now: NOW,
  });
}

describe('회원별 추천 테스트 엔진', () => {
  it('측정 이력이 없는 회원은 신체 정보 확인을 최우선으로 추천한다', () => {
    const result = build();
    expect(result.engineVersion).toBe(TEST_RECOMMENDATION_VERSION);
    expect(result.recommendations[0].id).toBe('body');
    expect(result.recommendations[0].reasons.join(' ')).toContain('컨디션');
  });

  it('러닝 목적 회원은 보행 측정 우선순위가 올라간다', () => {
    const result = build({
      member: { classTypes: ['러닝 퍼포먼스'] },
      bodyRecords: [{ recordedAt: '2026-08-14', weight: 70, painNrs: 0 }],
      reportsByKind: { body: [{ recordedAt: '2026-08-14' }] },
    });
    expect(result.recommendations.map((item) => item.id)).toContain('gait');
    expect(result.candidates.find((item) => item.id === 'gait').reasons.join(' ')).toContain('러닝');
  });

  it('최근 중등도 통증이면 점프와 리프팅은 트레이너 확인 대상으로 둔다', () => {
    const result = build({ bodyRecords: [{ recordedAt: '2026-08-14', painNrs: 5 }] });
    expect(result.candidates.find((item) => item.id === 'jump').safety).toBe('review');
    expect(result.candidates.find((item) => item.id === 'lifting').safety).toBe('review');
    expect(result.safetySummary.latestPainNrs).toBe(5);
  });

  it('최근 높은 통증이면 점프와 리프팅을 추천 후보에서 제외한다', () => {
    const result = build({ bodyRecords: [{ recordedAt: '2026-08-14', painNrs: 8 }] });
    expect(result.candidates.find((item) => item.id === 'jump').safety).toBe('blocked');
    expect(result.candidates.find((item) => item.id === 'lifting').safety).toBe('blocked');
    expect(result.recommendations.map((item) => item.id)).not.toContain('jump');
    expect(result.recommendations.map((item) => item.id)).not.toContain('lifting');
  });

  it('최근 측정은 중복 감점하고 90일 이상 지난 측정은 재검사 점수를 올린다', () => {
    const result = build({
      bodyRecords: [{ recordedAt: '2026-08-14', painNrs: 0 }],
      reportsByKind: {
        body: [{ recordedAt: '2026-08-14' }],
        posture: [{ createdAt: '2026-08-14T03:00:00.000Z' }],
        rom: [{ createdAt: '2026-04-01T03:00:00.000Z' }],
      },
    });
    const posture = result.candidates.find((item) => item.id === 'posture');
    const rom = result.candidates.find((item) => item.id === 'rom');
    expect(rom.score).toBeGreaterThan(posture.score);
    expect(rom.reasons.join(' ')).toContain('일이 지났습니다');
  });

  it('주의 자세 결과가 있으면 ROM·스쿼트 교차 확인 이유를 만든다', () => {
    const result = build({
      bodyRecords: [{ recordedAt: '2026-08-14', painNrs: 0 }],
      reportsByKind: {
        body: [{ recordedAt: '2026-08-14' }],
        posture: [{
          createdAt: '2026-08-13T03:00:00.000Z',
          analysis: { rules: { findings: [{ level: 'caution', message: '골반 기울기 확인이 필요합니다.' }] } },
        }],
      },
    });
    expect(result.candidates.find((item) => item.id === 'rom').reasons.join(' ')).toContain('교차 확인');
  });
});
