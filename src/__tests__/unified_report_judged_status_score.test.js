// unified_report_judged_status_score.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: stance(SLST)/squat(오버헤드 딥 스쿼트)는 singleLegStance.js/
//  squatBiomechanics.js가 이미 normal/caution/risk로 확정한 결과를 report.status
//  에 담아 내려주는데, buildSummaryData()가 이를 무시하고 METRIC_DEFINITIONS의
//  stanceHoldTime/stanceSway/squat* 지표를 range로 재채점하려 했다. 이 지표들은
//  애초에 range가 정의돼 있지 않아 rangeToStatus가 전부 'unknown'을 반환하고,
//  computeScoreFromMetrics는 채점 가능한(unknown이 아닌) 지표가 하나도 없어 null을
//  반환 → 실제로는 위험/주의인 리포트도 점수 0·상태 "확인 필요"로 표시됐다
//  (리포트 목록 카드·Momi 컨텍스트 등 buildSummaryData를 거치는 모든 화면에 영향).
//  2026-08-02 수정: stance/squat는 raw 지표 재채점 대신 이미 확정된 report.status
//  를 점수로 직접 환산해 우선 사용한다(STATUS[key].score 재사용, 값 일관성 유지).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { buildSummaryData } from '../ai-measure/core/unifiedReport';
import { evaluateSingleLegStance } from '../ai-measure/core/singleLegStance';
import { evaluateSquatBiomechanics } from '../ai-measure/core/squatBiomechanics';

describe('buildSummaryData — stance/squat는 확정된 status를 점수로 직접 반영한다', () => {
  it('SLST: 오른쪽 다리가 즉시확정 risk면 리포트 점수/상태도 risk로 나온다(0/unknown 아님)', () => {
    const evalResult = evaluateSingleLegStance({
      left: { trial1: { valid: true, holdTimeMs: 28000, pelvicTiltDeg: 2 } },
      right: { trial1: { valid: true, holdTimeMs: 9000, pelvicTiltDeg: 12 } },
    });
    expect(evalResult.status).toBe('risk');

    const summary = buildSummaryData({ kind: 'stance', ...evalResult });
    expect(summary.status).toBe('risk');
    expect(summary.overallScore).toBeGreaterThan(0);
    expect(summary.statusLabel).toBe('위험');
  });

  it('SLST: 양쪽 다리 모두 정상이면 리포트도 normal로 나온다', () => {
    const evalResult = evaluateSingleLegStance({
      left: { trial1: { valid: true, holdTimeMs: 30000, pelvicTiltDeg: 1 } },
      right: { trial1: { valid: true, holdTimeMs: 30000, pelvicTiltDeg: 1 } },
    });
    expect(evalResult.status).toBe('normal');

    const summary = buildSummaryData({ kind: 'stance', ...evalResult });
    expect(summary.status).toBe('normal');
    expect(summary.overallScore).toBe(100);
  });

  it('스쿼트: risk 판정이면 리포트 점수/상태도 risk로 나온다(0/unknown 아님)', () => {
    const evalResult = evaluateSquatBiomechanics({
      trial1: { valid: true, thighInclineDeg: 70, torsoLeanDeg: 40, kneeValgusDeg: 5 },
    });
    expect(evalResult.status).toBe('risk');

    const summary = buildSummaryData({ kind: 'squat', ...evalResult });
    expect(summary.status).toBe('risk');
    expect(summary.overallScore).toBeGreaterThan(0);
  });

  it('stance/squat가 아닌 다른 타입은 이 우회 로직의 영향을 받지 않는다(회귀 방지)', () => {
    // report.status='risk'인 임의의 다른 kind가 있어도 stance/squat 전용 우회를
    // 타지 않고 기존 로직(SCORE_PATHS/computeScoreFromMetrics) 그대로 동작해야 한다.
    const summary = buildSummaryData({ kind: 'jump', status: 'risk', valid: false, reason: 'no_flight' });
    // jump는 report.status가 아니라 자체 SCORE_PATHS/지표 기반으로 채점되므로
    // status='risk' 문자열 하나만으로 강제로 risk가 되지 않아야 한다.
    expect(summary.status).not.toBe('risk');
  });
});
