// [2026-11-17] 점수 신뢰도·직전 측정 선정 점검에서 찾은 문제의 회귀 테스트.
import { describe, it, expect } from 'vitest';
import { buildSummaryData } from '../ai-measure/core/unifiedReport';
import { pickPreviousReport } from '../ai-measure/core/measurementComparison';

describe('종합 점수 — 판정 지표 1개로는 점수를 만들지 않는다', () => {
  it('점프: 골반 불균형 1개만 정상이어도 100점 정상이 되지 않는다', () => {
    const s = buildSummaryData({ kind: 'jump', heightCm: 35, peakPower: 3000, biomech: { pelvicImbalance: 2 } });
    expect(s.status).toBe('unknown');
  });
  it('스프린트·ROM·VBT 도 단일 지표 점수 금지', () => {
    expect(buildSummaryData({ kind: 'sprint', totalTimeMs: 2100, deceleration: { decelTimeMs: 300 } }).status).toBe('unknown');
    expect(buildSummaryData({ kind: 'rom', summary: { max_rom: 130, symmetry_index_score: 5 } }).status).toBe('unknown');
    expect(buildSummaryData({ type: 'lifting', mode: 'vbt', metrics: { meanVelocity: 0.6, velocityLoss: 10 } }).status).toBe('unknown');
  });
  it('판정 지표가 2개 이상이면 점수를 만든다(자세·보행)', () => {
    const g = buildSummaryData({ kind: 'gait', metrics: { cadence: 112, pelvicDropAbs: 3, kneeSymmetry: 95 } });
    expect(g.status).not.toBe('unknown');
    const p = buildSummaryData({ kind: 'posture', analysis: { sagittal: { forwardHeadMm: 10 }, frontal: { shoulderHeightDiffMm: 3, pelvisHeightDiffMm: 2 } } });
    expect(p.overallScore).toBe(100);
  });
  it('원본에 이미 점수 필드가 있으면 그대로 쓴다(기존 동작 유지)', () => {
    expect(buildSummaryData({ kind: 'jump', summary: { score: 72 } }).overallScore).toBe(72);
  });
});

describe('pickPreviousReport — 직전 측정 선정', () => {
  const mk = (id, t, extra = {}) => ({ id, measuredAt: t, ...extra });
  const list = [mk('a', '2026-11-01T09:00:00Z'), mk('b', '2026-11-10T09:00:00Z'), mk('c', '2026-11-17T09:00:00Z')];
  it('자기 자신(저장 직후 목록에 포함)은 제외한다', () => {
    expect(pickPreviousReport(list, mk('c', '2026-11-17T09:00:00Z')).id).toBe('b');
  });
  it('id 가 없어도 같은 시각 기록은 직전이 아니다(자세·ROM 자동 저장 직후)', () => {
    expect(pickPreviousReport(list, { measuredAt: '2026-11-17T09:00:00Z' }).id).toBe('b');
  });
  it('지난 기록을 열어 볼 때는 그보다 이른 기록만 비교 대상이다', () => {
    expect(pickPreviousReport(list, mk('b', '2026-11-10T09:00:00Z')).id).toBe('a');
    expect(pickPreviousReport(list, mk('a', '2026-11-01T09:00:00Z'))).toBeNull();
  });
  it('같은 조건(match)끼리만 비교한다', () => {
    const l = [mk('x', '2026-11-01T09:00:00Z', { trackPoint: 'shoulder' }), mk('y', '2026-11-05T09:00:00Z', { trackPoint: 'hip' })];
    const cur = mk('z', '2026-11-17T09:00:00Z', { trackPoint: 'shoulder' });
    expect(pickPreviousReport(l, cur, { match: (r) => (r.trackPoint || 'hip') === (cur.trackPoint || 'hip') }).id).toBe('x');
  });
});
