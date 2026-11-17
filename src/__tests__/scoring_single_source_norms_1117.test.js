import { describe, it, expect } from 'vitest';
import { buildSummaryData } from '../ai-measure/core/unifiedReport';
import { computeStanceScore } from '../ai-measure/core/singleLegStance';
import { computeSquatScore, extractSquatMetrics } from '../ai-measure/core/squatBiomechanics';
import { computeGaitScore, normalizeGaitMetrics, computeJumpScore, capScoreByStatus } from '../ai-measure/core/scoring';
import { vo2maxRating, ageBand } from '../ai-measure/core/norms';

const leg = (status) => ({ status });
const cond = (l, r) => ({ valid: true, left: leg(l), right: leg(r) });

describe('점수 단일 기준 — 상세 화면과 목록(buildSummaryData)이 같은 값', () => {
  it('SLST: 세부 평균 68이어도 종합 판정이 위험이면 59 이하로 상한', () => {
    const rep = { kind: 'stance', valid: true, status: 'risk', eyesOpen: cond('normal', 'normal'), eyesClosed: cond('risk', 'caution') };
    const detail = computeStanceScore(rep);
    expect(detail).toBeLessThanOrEqual(59);
    expect(buildSummaryData(rep).overallScore).toBe(detail);
    expect(buildSummaryData({ menu: 'stance', data: rep }).overallScore).toBe(detail); // 세션 래퍼
  });
  it('스쿼트: 지표가 모두 정상이어도 종합이 위험이면 상한 적용되고 목록과 같다', () => {
    const rep = { kind: 'squat', valid: true, status: 'risk', confirmedFlags: [], unconfirmedFlags: [],
      trials: [{ thighInclineDeg: 68, kneeValgusDeg: 5, pelvicTiltDeg: 2 }, { thighInclineDeg: 60, torsoLeanDeg: 4 }] };
    const detail = computeSquatScore(rep, extractSquatMetrics(rep));
    expect(detail).toBeLessThanOrEqual(59);
    expect(buildSummaryData(rep).overallScore).toBe(detail);
  });
  it('보행·점프도 상세 계산과 동일', () => {
    const gait = { kind: 'gait', orientation: 'side', metrics: { cadence: 170, stancePct: 60, trunkLean: { avg: 8 }, kneeSymmetry: 95 } };
    expect(buildSummaryData(gait).overallScore).toBe(computeGaitScore(normalizeGaitMetrics(gait), 'side'));
    const jump = { kind: 'jump', biomech: { trunkLeanChange: 5, pelvicImbalance: 2 } };
    expect(buildSummaryData(jump).overallScore).toBe(computeJumpScore(jump));
  });
  it('상한 함수', () => {
    expect(capScoreByStatus(90, 'risk')).toBe(59);
    expect(capScoreByStatus(90, 'caution')).toBe(79);
    expect(capScoreByStatus(90, 'normal')).toBe(90);
    expect(capScoreByStatus(null, 'risk')).toBeNull();
  });
});

describe('VO2max 연령·성별 규준(Cooper Institute)', () => {
  it('남 20대 52 → 우수, 여 40대 33 → 보통', () => {
    expect(vo2maxRating(52, 25, 'male').label).toBe('우수');
    expect(vo2maxRating(33, 45, 'female').label).toBe('보통');
  });
  it('경계값과 낮음', () => {
    expect(vo2maxRating(45.4, 29, 'male').label).toBe('양호');
    expect(vo2maxRating(41.6, 29, 'male').label).toBe('낮음');
  });
  it('나이·성별이 없거나 표 밖이면 등급을 만들지 않는다', () => {
    expect(vo2maxRating(50, null, 'male')).toBeNull();
    expect(vo2maxRating(50, 25, null)).toBeNull();
    expect(vo2maxRating(50, 15, 'male')).toBeNull();
    expect(ageBand(80)).toBeNull();
  });
});
