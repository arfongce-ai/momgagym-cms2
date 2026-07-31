// single_leg_stance_single_trial.test.js
// ════════════════════════════════════════════════════════════════════════
//  2026-07-31: 운영 방식이 "다리당 1회 지지(왼발 1회 → 오른발 1회)"로 확정됐다
//  (기존 라이브 화면은 다리당 2회를 기다리고 있어 "인식이 안 된다"로 이어졌다).
//  singleLegStance.js의 combineLegTrials()는 원래 trial2가 없을 때를 위한
//  'single_trial_only' 경로를 이미 갖고 있었다(둘 중 하나만 유효한 랜드마크였던
//  경우를 위한 방어 코드) — 이 테스트는 그 경로가 "의도적으로 1회만 측정한
//  정상 케이스"에서도 올바르게 동작함을 고정한다. trial2를 아예 넘기지 않는
//  것(undefined)이 실제 StanceLiveAnalysis.jsx의 summary() 출력과 동일한 형태다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { evaluateSingleLegStance } from '../ai-measure/core/singleLegStance';

const normalTrial = { valid: true, holdTimeMs: 30000, swayPathCm: 3, pelvicTiltDeg: 1, kneeValgusDeg: 2 };
const borderlineSwayTrial = { valid: true, holdTimeMs: 30000, swayPathCm: 10, pelvicTiltDeg: 1, kneeValgusDeg: 2 }; // swayCautionCm=8 이상
const balanceLossTrial = { valid: true, holdTimeMs: 12000, balanceLoss: true, swayPathCm: 3, pelvicTiltDeg: 1 };

describe('evaluateSingleLegStance — 다리당 시행 1회(trial2 없음)', () => {
  it('양쪽 모두 정상 1회씩이면 전체 normal, single_trial_only, needsRetest=false', () => {
    const result = evaluateSingleLegStance({
      left: { trial1: normalTrial },
      right: { trial1: normalTrial },
    });
    expect(result.valid).toBe(true);
    expect(result.status).toBe('normal');
    expect(result.left.basis).toBe('single_trial_only');
    expect(result.left.confirmed).toBe(false);
    expect(result.left.needsRetest).toBe(false);
    expect(result.right.basis).toBe('single_trial_only');
  });

  it('단일 시행이 경계성 신호(sway borderline)면 caution + needsRetest=true(재현성 미확인이므로 재측정 권장)', () => {
    const result = evaluateSingleLegStance({
      left: { trial1: borderlineSwayTrial },
      right: { trial1: normalTrial },
    });
    expect(result.left.status).toBe('caution');
    expect(result.left.basis).toBe('single_trial_only');
    expect(result.left.needsRetest).toBe(true);
    expect(result.status).toBe('caution'); // 전체 상태는 더 나쁜 쪽을 따라간다
  });

  it('단일 시행에서 즉시확정 신호(balanceLoss)가 나오면 재현성 확인 없이 바로 risk로 확정된다', () => {
    const result = evaluateSingleLegStance({
      left: { trial1: balanceLossTrial },
      right: { trial1: normalTrial },
    });
    expect(result.left.status).toBe('risk');
    expect(result.left.basis).toBe('immediate');
    expect(result.left.confirmed).toBe(true); // 즉시확정은 1회만으로도 이미 확정
  });

  it('trial2가 undefined로 명시적으로 넘어와도 trial2 생략과 동일하게 동작한다(summary() 실제 출력 형태)', () => {
    const withUndefined = evaluateSingleLegStance({
      left: { trial1: normalTrial, trial2: undefined },
      right: { trial1: normalTrial, trial2: undefined },
    });
    const withoutKey = evaluateSingleLegStance({
      left: { trial1: normalTrial },
      right: { trial1: normalTrial },
    });
    expect(withUndefined.left.basis).toBe(withoutKey.left.basis);
    expect(withUndefined.status).toBe(withoutKey.status);
  });
});
