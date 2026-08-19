// src/__tests__/squat_stance_gait_share_report_fix.test.js
// ════════════════════════════════════════════════════════════════════════
//  회귀 보호 대상(2026-08-19 — "카카오톡으로 리포트 공유" 시 데이터가 이상하게
//  나옴 신고, 스크린샷 확인):
//   1) SessionShareReport의 "측정 값" 타일(extractSessionDetailTiles)이
//      squat/stance/gait를 처리하는 case가 없어 default(원시 필드 나열)로
//      떨어져 basis/measuredAt/torsoLeanSource/kind 같은 내부 메타 필드가
//      "BASIS"/"MEASUREDAT"/"TORSOLEANSOURCE"/"KIND"로 그대로 노출됐다.
//   2) "평가 지표"(extractKeyMetrics)가 squat/stance에 대해 옛 데이터 모양
//      (trials.0.thighInclineDeg 등)을 range로 재채점했는데, 이 지표들은
//      range가 없어 rangeToStatus가 항상 unknown → 실제 값과 무관하게 모든
//      카드가 "확인 필요"로만 표시됐다(2026-08-02에 종합 점수는 고쳤지만
//      개별 지표 카드는 그대로 남아있었음). 게다가 trials.0.*는 항상 "정면"
//      시행이라, 상체기울기처럼 측면이 권위 소스인 지표는 값 자체도 틀렸다.
//   두 문제 모두 squatBiomechanics.js/singleLegStance.js가 이미 갖고 있던
//   전용 추출 함수(extractSquatMetrics/squatMetricStatus, legMetrics/
//   stanceMetricStatus — SquatReportDashboard.jsx/StanceReportDashboard.jsx가
//   쓰던 것과 동일)를 공유 리포트 경로에도 그대로 재사용해 고친다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { extractSessionDetailTiles } from '../components/report/sessionShare';
import { extractKeyMetrics } from '../ai-measure/core/unifiedReport';
import { evaluateSquatBiomechanics, extractSquatMetrics, squatMetricStatus } from '../ai-measure/core/squatBiomechanics';
import { evaluateSingleLegStance, legMetrics, stanceMetricStatus } from '../ai-measure/core/singleLegStance';

function buildSquatReport() {
  // 무릎외반=위험(20≥15), 상체기울기=주의(측면 30 — 25~35 구간), 깊이=정상.
  // torsoLeanDeg가 front(10)와 side(30)에서 크게 다르므로, "권위 소스(측면
  // 우선)"를 제대로 쓰는지와 "trials[0](정면)만 보는 옛 버그"를 구분할 수 있다.
  return evaluateSquatBiomechanics({
    front: { valid: true, thighInclineDeg: 10, torsoLeanDeg: 10, kneeValgusDeg: 20, pelvicTiltDeg: 2 },
    side: { valid: true, thighInclineDeg: 12, torsoLeanDeg: 30, armDropDeg: 5 },
  });
}

describe('extractSessionDetailTiles — squat/stance/gait이 원시 필드 대신 한글 라벨 타일을 낸다', () => {
  it('squat: BASIS/MEASUREDAT/TORSOLEANSOURCE/KIND 같은 원시 필드 라벨이 나오지 않는다', () => {
    const report = buildSquatReport();
    const tiles = extractSessionDetailTiles('squat', report);
    const labels = tiles.map((t) => t.label);
    expect(labels).not.toContain('basis');
    expect(labels).not.toContain('measuredAt');
    expect(labels).not.toContain('torsoLeanSource');
    expect(labels).not.toContain('kind');
    expect(labels.some((l) => /^[a-zA-Z]+$/.test(l))).toBe(false); // 영문만으로 된 라벨이 없어야 함
    expect(labels).toEqual(expect.arrayContaining(['스쿼트 깊이', '상체 전방 기울기', '무릎 안쪽 쏠림']));
  });

  it('squat: 상체 전방 기울기 타일 값은 정면이 아니라 권위 소스(측면)를 따른다', () => {
    const report = buildSquatReport();
    expect(report.torsoLeanSource).toBe('side');
    const tiles = extractSessionDetailTiles('squat', report);
    const torsoTile = tiles.find((t) => t.label === '상체 전방 기울기');
    expect(torsoTile.value).toBe('30'); // side 값(30), front 값(10)이 아님 — trials[0] 직독 버그 회귀 방지.
  });

  it('stance: 원시 필드 라벨 없이 왼발/오른발 유지시간·골반기울기 타일을 낸다', () => {
    const report = evaluateSingleLegStance({
      left: { trial1: { valid: true, holdTimeMs: 12000, pelvicTiltDeg: 12 }, trial2: { valid: true, holdTimeMs: 11000, pelvicTiltDeg: 11 } },
      right: { trial1: { valid: true, holdTimeMs: 30000, pelvicTiltDeg: 1 }, trial2: { valid: true, holdTimeMs: 29000, pelvicTiltDeg: 1 } },
    });
    const tiles = extractSessionDetailTiles('stance', report);
    const labels = tiles.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['왼발 유지시간', '오른발 유지시간']));
    expect(labels.some((l) => /^[a-zA-Z]+$/.test(l))).toBe(false);
  });

  it('gait: 원시 필드 라벨 없이 케이던스 등 한글 타일을 낸다', () => {
    const tiles = extractSessionDetailTiles('gait', { kind: 'gait', metrics: { cadence: 168, stancePct: 61, pelvicDropAbs: 3, kneeSymmetry: 94 } });
    const labels = tiles.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['케이던스']));
    expect(labels.some((l) => /^[a-zA-Z]+$/.test(l))).toBe(false);
  });
});

describe('extractKeyMetrics — squat/stance 카드가 항상 "확인 필요"가 아니라 실제 판정 상태를 보여준다', () => {
  it('squat: 각 지표 상태가 squatMetricStatus()와 정확히 일치하고, 최소 하나는 unknown이 아니다', () => {
    const report = buildSquatReport();
    const metrics = extractKeyMetrics(report, 'squat');
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));

    expect(byKey.squatKneeValgus.status.key).toBe(squatMetricStatus(report, 'knee_valgus_'));
    expect(byKey.squatKneeValgus.status.key).toBe('risk'); // 20 >= riskDeg(15)
    expect(byKey.squatTorsoLean.status.key).toBe(squatMetricStatus(report, 'torso_lean_'));
    expect(byKey.squatTorsoLean.status.key).toBe('caution'); // side 30 → caution 구간
    expect(byKey.squatDepth.status.key).toBe(squatMetricStatus(report, 'depth_'));

    // 라벨은 humanizeKey 폴백("squat Depth" 같은 camelCase)이 아니라 한글이어야 한다
    // (REPORT_TERM_MAP 미등록 → humanizeKey 폴백이 실제 사용자 신고 스크린샷의 원인이었음).
    expect(byKey.squatDepth.label).toBe('스쿼트 깊이');
    expect(byKey.squatTorsoLean.label).toBe('상체 전방 기울기');
    expect(byKey.squatKneeValgus.label).toBe('무릎 안쪽 쏠림');
  });

  it('squat: extractSquatMetrics()가 뽑은 값과 카드 값이 정확히 일치한다(재계산하지 않는다)', () => {
    const report = buildSquatReport();
    const expected = extractSquatMetrics(report);
    const metrics = extractKeyMetrics(report, 'squat');
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
    expect(byKey.squatDepth.value).toBe(expected.depthDeg);
    expect(byKey.squatTorsoLean.value).toBe(expected.torsoLeanDeg);
    expect(byKey.squatKneeValgus.value).toBe(expected.kneeValgusDeg);
  });

  it('stance: 왼발 골반기울기 카드 상태가 stanceMetricStatus()와 일치하고 unknown 고정이 아니다', () => {
    const report = evaluateSingleLegStance({
      left: { trial1: { valid: true, holdTimeMs: 12000, pelvicTiltDeg: 12 }, trial2: { valid: true, holdTimeMs: 11000, pelvicTiltDeg: 11 } },
      right: { trial1: { valid: true, holdTimeMs: 30000, pelvicTiltDeg: 1 }, trial2: { valid: true, holdTimeMs: 29000, pelvicTiltDeg: 1 } },
    });
    const metrics = extractKeyMetrics(report, 'stance');
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));

    expect(byKey.stancePelvicTiltLeft.status.key).toBe(stanceMetricStatus(report.left, 'pelvic_tilt_'));
    expect(byKey.stancePelvicTiltLeft.status.key).toBe('risk'); // 11~12 반복 확정 >= riskDeg(10)
    expect(byKey.stancePelvicTiltRight.status.key).toBe('normal');
    expect(byKey.stanceHoldTimeLeft.label).toBe('왼발 유지시간');
    expect(byKey.stanceHoldTimeLeft.value).toBe(Math.round(legMetrics(report.left).holdMs / 100) / 10);
  });

  it('squat/stance가 아닌 다른 타입은 기존 range 기반 로직 그대로 동작한다(회귀 방지)', () => {
    const metrics = extractKeyMetrics({ heightCm: 45, peakPower: 3000 }, 'jump');
    const jumpHeight = metrics.find((m) => m.key === 'jumpHeight');
    expect(jumpHeight).toBeTruthy();
    expect(jumpHeight.status.key).not.toBe('observed'); // observed는 squat/stance 전용 상태.
  });
});
