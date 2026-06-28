import { describe, it, expect } from 'vitest';
import { buildPostureTrend } from '../services/reportService';

const r = (date, score, fh, shoulder, pelvis, bodyAge) => ({
  createdAt: date,
  analysis: {
    score, bodyAge,
    sagittal: { forwardHeadMm: fh },
    frontal: { shoulderHeightDiffMm: shoulder, pelvisHeightDiffMm: pelvis },
  },
});

describe('buildPostureTrend (자세 이력 추세)', () => {
  it('회차별 점수/거북목/높이차를 날짜순으로 모은다', () => {
    const reports = [
      r('2026-03-01', 60, 30, 10, 8, 45),
      r('2026-05-01', 72, 20, 6, 5, 40),
      r('2026-04-01', 66, 25, 8, 6, 42),
    ];
    const t = buildPostureTrend(reports);
    expect(t.count).toBe(3);
    // 날짜순 정렬 확인
    expect(t.score.map(p => p.date)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01']);
    expect(t.score.map(p => p.value)).toEqual([60, 66, 72]);
    expect(t.forwardHead.map(p => p.value)).toEqual([30, 25, 20]);
  });

  it('어깨/골반 높이차는 절대값으로 추세화(좌우 무관)', () => {
    const reports = [r('2026-03-01', 60, 30, -10, 8), r('2026-04-01', 66, 25, 8, -6)];
    const t = buildPostureTrend(reports);
    expect(t.shoulderDiff.map(p => p.value)).toEqual([10, 8]); // 부호 제거
    expect(t.pelvisDiff.map(p => p.value)).toEqual([8, 6]);
  });

  it('빈 입력에 안전', () => {
    const t = buildPostureTrend([]);
    expect(t.count).toBe(0);
    expect(t.score).toEqual([]);
    expect(t.latest).toBeNull();
  });

  it('구버전 구조(analysis 없이 최상위 필드)도 폴백으로 읽음', () => {
    const reports = [{ createdAt: '2026-03-01', postureScore: 55, frontal: { shoulderHeightDiffMm: 12 } }];
    const t = buildPostureTrend(reports);
    expect(t.count).toBe(1);
    expect(t.score[0].value).toBe(55);
  });

  it('일부 지표 누락 시 그 지표만 비고 나머지는 유지', () => {
    const reports = [
      { createdAt: '2026-03-01', analysis: { score: 60 } }, // 거북목/높이차 없음
      r('2026-04-01', 66, 25, 8, 6),
    ];
    const t = buildPostureTrend(reports);
    expect(t.score).toHaveLength(2);
    expect(t.forwardHead).toHaveLength(1); // 첫 회차엔 거북목 없음
  });
});
