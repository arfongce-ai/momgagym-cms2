// squat_front_side_twice_combine.test.js
// ════════════════════════════════════════════════════════════════════════
//  2026-07-31: 운영 방식이 "정면 2회 → 측면 2회"로 확정됐다(직전 설계는 정면
//  1회+측면 1회였음). evaluateSquatBiomechanics()의 새 {front1,front2,side1,side2}
//  입력 검증. 뷰 내부는 combineTrials()로 먼저 재현성 확정하고(2회 반복돼야
//  그 뷰에서 확정), 그 결과를 기존 {front,side} 결합과 동일한 지표별 권위
//  소스 규칙으로 뷰 간 결합한다. 기존 {front,side}·{trial1,trial2} 입력은
//  변경 없이 그대로 동작해야 한다(squat_front_side_combine.test.js가 이미 검증).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { evaluateSquatBiomechanics } from '../ai-measure/core/squatBiomechanics';

const normalTrial = { valid: true, thighInclineDeg: 5, torsoLeanDeg: 5, kneeValgusDeg: 2, pelvicTiltDeg: 1 };

describe('evaluateSquatBiomechanics — 정면 2회 + 측면 2회 결합', () => {
  it('4회 모두 정상이면 종합도 normal, basis는 front_side_combined', () => {
    const r = evaluateSquatBiomechanics({
      front1: normalTrial, front2: normalTrial, side1: normalTrial, side2: normalTrial,
    });
    expect(r.valid).toBe(true);
    expect(r.status).toBe('normal');
    expect(r.basis).toBe('front_side_combined');
  });

  it('trials[0]는 front1이다(unifiedReport.js의 trials.0.* 경로와 하위 호환)', () => {
    const front1 = { ...normalTrial, thighInclineDeg: 7 };
    const r = evaluateSquatBiomechanics({ front1, front2: normalTrial, side1: normalTrial, side2: normalTrial });
    expect(r.trials[0].thighInclineDeg).toBe(7);
  });

  it('무릎외반이 정면 2회 모두에서 반복돼야 확정된다(한 번만 나오면 미확정)', () => {
    const highValgus = { ...normalTrial, kneeValgusDeg: 20 }; // risk 기준(15) 초과
    // 정면 1회만 높음 → 뷰 내부 재현성 실패 → 확정 안 됨
    const onceOnly = evaluateSquatBiomechanics({
      front1: highValgus, front2: normalTrial, side1: normalTrial, side2: normalTrial,
    });
    expect(onceOnly.confirmedFlags).not.toContain('knee_valgus_high');
    expect(onceOnly.status).toBe('normal');

    // 정면 2회 모두 높음 → 확정
    const bothTimes = evaluateSquatBiomechanics({
      front1: highValgus, front2: highValgus, side1: normalTrial, side2: normalTrial,
    });
    expect(bothTimes.confirmedFlags).toContain('knee_valgus_high');
    expect(bothTimes.status).toBe('risk');
  });

  it('상체기울기는 측면 2회의 재현성 결과를 우선 쓴다(정면 값과 달라도)', () => {
    const highLean = { ...normalTrial, torsoLeanDeg: 40 }; // risk 기준(35) 초과
    const r = evaluateSquatBiomechanics({
      front1: normalTrial, front2: normalTrial, // 정면은 정상
      side1: highLean, side2: highLean,          // 측면 2회 모두 위험
    });
    expect(r.torsoLeanSource).toBe('side');
    expect(r.confirmedFlags).toContain('torso_lean_high');
    expect(r.status).toBe('risk');
  });

  it('깊이는 정면·측면 뷰 간에도 반복돼야 확정된다(한쪽 뷰에서만 나오면 미확정 관찰)', () => {
    const shallowFront = { ...normalTrial, thighInclineDeg: 32 }; // risk 기준(30) 초과
    // 정면 2회 모두 얕음(뷰 내부 확정) but 측면 2회는 정상 → 뷰 간 불일치라 미확정
    const r = evaluateSquatBiomechanics({
      front1: shallowFront, front2: shallowFront, side1: normalTrial, side2: normalTrial,
    });
    expect(r.confirmedFlags).not.toContain('depth_high');
    expect(r.unconfirmedFlags).toContain('depth_high');
    expect(r.status).toBe('normal');
  });

  it('즉시확정 신호(balanceLoss)는 4회 중 1회만 나와도 재현성 없이 바로 risk', () => {
    const fall = { ...normalTrial, balanceLoss: true };
    const r = evaluateSquatBiomechanics({ front1: fall, front2: normalTrial, side1: normalTrial, side2: normalTrial });
    expect(r.status).toBe('risk');
    expect(r.basis).toBe('immediate');
  });

  it('측면 2회가 모두 무효(랜드마크 신뢰도 부족)면 정면만으로 단독 판정하고 재측정을 권한다', () => {
    const invalid = { valid: false, reason: 'landmarks_unreliable' };
    const highLean = { ...normalTrial, torsoLeanDeg: 40 };
    const r = evaluateSquatBiomechanics({ front1: highLean, front2: highLean, side1: invalid, side2: invalid });
    expect(r.basis).toBe('single_view_only');
    expect(r.missingView).toBe('side');
    expect(r.torsoLeanSource).toBe('front_fallback');
    expect(r.needsRetest).toBe(true);
  });

  it('기존 {front, side}(1회씩) 입력은 그대로 동작한다(하위 호환)', () => {
    const r = evaluateSquatBiomechanics({ front: normalTrial, side: normalTrial });
    expect(r.basis).toBe('front_side_combined');
    expect(r.trials.length).toBe(2);
  });

  it('기존 {trial1, trial2}(업로드 모드) 입력도 그대로 동작한다(하위 호환)', () => {
    const r = evaluateSquatBiomechanics({ trial1: normalTrial, trial2: normalTrial });
    expect(r.basis).toBe('reproducibility');
    expect(r.status).toBe('normal');
  });
});
