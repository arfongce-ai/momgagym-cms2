// squat_front_side_combine.test.js
// ════════════════════════════════════════════════════════════════════════
//  evaluateSquatBiomechanics()의 새 {front, side} 결합 규칙 검증.
//  · 무릎외반·골반기울기 = 정면 단독 확정
//  · 상체기울기 = 측면 우선 단독 확정(측면 무효 시 정면 대체)
//  · 깊이 = 같은 공식 → 재현성(둘 다 있으면 양쪽 다 나와야 확정)
//  · 기존 {trial1, trial2}(영상 업로드 모드) 입력은 예전 그대로 동작해야 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { evaluateSquatBiomechanics } from '../ai-measure/core/squatBiomechanics';

const normalTrial = { valid: true, thighInclineDeg: 5, torsoLeanDeg: 5, kneeValgusDeg: 2, pelvicTiltDeg: 1 };

describe('evaluateSquatBiomechanics — 정면+측면 결합', () => {
  it('둘 다 정상이면 종합도 정상', () => {
    const r = evaluateSquatBiomechanics({ front: normalTrial, side: normalTrial });
    expect(r.status).toBe('normal');
    expect(r.basis).toBe('front_side_combined');
  });

  it('repeatedFlags는 confirmedFlags의 별칭이다(crossMeasureContext.js 등 기존 소비자 호환)', () => {
    const front = { ...normalTrial, kneeValgusDeg: 20 };
    const r = evaluateSquatBiomechanics({ front, side: normalTrial });
    expect(r.repeatedFlags).toEqual(r.confirmedFlags);
    expect(r.repeatedFlags).toContain('knee_valgus_high');
  });

  it('무릎외반은 정면 단독으로 확정된다(측면이 정상이어도 정면 소견 그대로 반영)', () => {
    const front = { ...normalTrial, kneeValgusDeg: 20 }; // risk 기준(15) 초과
    const r = evaluateSquatBiomechanics({ front, side: normalTrial });
    expect(r.status).toBe('risk');
    expect(r.confirmedFlags).toContain('knee_valgus_high');
  });

  it('측면 시행에는 애초에 무릎외반이 없어도(관여 안 함) 정면 소견이 묻히지 않는다', () => {
    const front = { ...normalTrial, kneeValgusDeg: 12 }; // caution 기준(10) 초과, risk(15) 미만
    const side = { ...normalTrial, kneeValgusDeg: null }; // 측면은 애초에 이 지표를 안 봄
    const r = evaluateSquatBiomechanics({ front, side });
    expect(r.status).toBe('caution');
    expect(r.confirmedFlags).toContain('knee_valgus_borderline');
  });

  it('상체기울기는 측면을 우선 소스로 단독 확정한다', () => {
    const side = { ...normalTrial, torsoLeanDeg: 40 }; // risk 기준(35) 초과
    const r = evaluateSquatBiomechanics({ front: normalTrial, side });
    expect(r.status).toBe('risk');
    expect(r.confirmedFlags).toContain('torso_lean_high');
    expect(r.torsoLeanSource).toBe('side');
  });

  it('측면 시행이 무효면 상체기울기는 정면 값으로 대체하고 출처를 노출한다', () => {
    const front = { ...normalTrial, torsoLeanDeg: 30 }; // caution 기준(25) 초과
    const side = { valid: false, reason: 'landmarks_unreliable' };
    const r = evaluateSquatBiomechanics({ front, side });
    expect(r.confirmedFlags).toContain('torso_lean_borderline');
    expect(r.torsoLeanSource).toBe('front_fallback');
    expect(r.missingView).toBe('side');
  });

  it('깊이는 같은 공식이라 재현성 방식 — 한쪽에서만 나오면 미확정으로 남는다', () => {
    const front = { ...normalTrial, thighInclineDeg: 40 }; // risk 기준(30) 초과
    const side = { ...normalTrial, thighInclineDeg: 5 }; // 정상
    const r = evaluateSquatBiomechanics({ front, side });
    expect(r.confirmedFlags).not.toContain('depth_high');
    expect(r.unconfirmedFlags).toContain('depth_high');
    expect(r.status).toBe('normal'); // 반복 안 된 소견은 상태를 올리지 않음
  });

  it('깊이는 양쪽에서 반복되면 확정된다', () => {
    const front = { ...normalTrial, thighInclineDeg: 20 }; // caution
    const side = { ...normalTrial, thighInclineDeg: 18 }; // caution
    const r = evaluateSquatBiomechanics({ front, side });
    expect(r.confirmedFlags).toContain('depth_borderline');
    expect(r.status).toBe('caution');
  });

  it('한쪽 시행만 있으면(다른 쪽 통째로 없음) 깊이는 그 시행값으로 단독 확정된다', () => {
    const r = evaluateSquatBiomechanics({ front: { ...normalTrial, thighInclineDeg: 35 }, side: undefined });
    expect(r.confirmedFlags).toContain('depth_high');
    expect(r.missingView).toBe('side');
  });

  it('정면·측면 어느 쪽이든 균형 상실이면 즉시 RISK', () => {
    const r = evaluateSquatBiomechanics({ front: normalTrial, side: { ...normalTrial, balanceLoss: true } });
    expect(r.status).toBe('risk');
    expect(r.basis).toBe('immediate');
  });

  it('둘 다 무효면 unknown', () => {
    const invalid = { valid: false, reason: 'landmarks_unreliable' };
    const r = evaluateSquatBiomechanics({ front: invalid, side: invalid });
    expect(r.status).toBe('unknown');
    expect(r.basis).toBe('no_valid_trial');
  });

  it('무언가 이상 소견 + 한쪽 시행 누락이면 재측정 권장 플래그가 뜬다', () => {
    const r = evaluateSquatBiomechanics({ front: { ...normalTrial, kneeValgusDeg: 20 }, side: undefined });
    expect(r.needsRetest).toBe(true);
  });
});

describe('evaluateSquatBiomechanics — 기존 {trial1, trial2} 입력(영상 업로드 모드) 하위 호환', () => {
  it('정면 2회 입력은 예전과 동일하게 재현성 방식으로 동작한다', () => {
    const t1 = { ...normalTrial, kneeValgusDeg: 20 };
    const t2 = { ...normalTrial, kneeValgusDeg: 20 };
    const r = evaluateSquatBiomechanics({ trial1: t1, trial2: t2 });
    expect(r.basis).toBe('reproducibility');
    expect(r.status).toBe('risk');
  });

  it('한쪽에서만 나온 소견은 예전처럼 미확정으로 남는다', () => {
    const t1 = { ...normalTrial, kneeValgusDeg: 20 };
    const t2 = { ...normalTrial };
    const r = evaluateSquatBiomechanics({ trial1: t1, trial2: t2 });
    expect(r.status).toBe('normal');
    expect(r.unconfirmedFlags).toContain('knee_valgus_high');
  });

  it('입력이 전혀 없으면 invalid', () => {
    const r = evaluateSquatBiomechanics({});
    expect(r.valid).toBe(false);
  });
});
