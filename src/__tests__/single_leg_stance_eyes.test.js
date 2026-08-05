// single_leg_stance_eyes.test.js
// ════════════════════════════════════════════════════════════════════════
//  2026-08-02: SLST가 눈뜨고 1회 + 눈감고 1회(다리당)로 확장됨에 따라
//  evaluateSingleLegStanceWithEyes()를 추가. 눈뜨고/눈감고는 서로 다른
//  조건이라 재현성 신호로 섞이지 않고 각각 독립 판정되는지, 종합 status가
//  더 나쁜 쪽으로 취합되는지, 기존 { left, right, asymmetryFlag } 소비처와의
//  하위 호환이 유지되는지 확인한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { evaluateSingleLegStanceWithEyes, evaluateSingleLegStance } from '../ai-measure/core/singleLegStance';

const normalTrial = { valid: true, holdTimeMs: 30000, pelvicTiltDeg: 1 };
// 눈감고 조건에서 유지시간이 짧아지는 건 정상인도 흔히 보이는 자연스러운 패턴 —
// cautionHoldMs(20s) 미만으로 구성해 hold_time_borderline으로 caution을 유발한다.
const closedNormalTrial = { valid: true, holdTimeMs: 15000, pelvicTiltDeg: 2 };
const riskTrial = { valid: true, holdTimeMs: 9000, pelvicTiltDeg: 12 };

describe('evaluateSingleLegStanceWithEyes', () => {
  it('눈뜨고/눈감고 둘 다 정상이면 종합 status도 normal이다', () => {
    const result = evaluateSingleLegStanceWithEyes({
      open: { left: { trial1: normalTrial }, right: { trial1: normalTrial } },
      closed: { left: { trial1: normalTrial }, right: { trial1: normalTrial } },
    });
    expect(result.valid).toBe(true);
    expect(result.status).toBe('normal');
    expect(result.eyesOpen.status).toBe('normal');
    expect(result.eyesClosed.status).toBe('normal');
  });

  it('눈뜨고는 정상이어도 눈감고에서 risk가 나오면 종합 status는 risk로 취합된다', () => {
    const result = evaluateSingleLegStanceWithEyes({
      open: { left: { trial1: normalTrial }, right: { trial1: normalTrial } },
      closed: { left: { trial1: normalTrial }, right: { trial1: riskTrial } },
    });
    expect(result.eyesOpen.status).toBe('normal');
    expect(result.eyesClosed.status).toBe('risk');
    expect(result.status).toBe('risk');
  });

  it('눈뜨고/눈감고는 서로 다른 조건이라 재현성 신호로 섞이지 않는다(눈감고 caution이 눈뜨고 판정에 영향 없음)', () => {
    const result = evaluateSingleLegStanceWithEyes({
      open: { left: { trial1: normalTrial }, right: { trial1: normalTrial } },
      closed: { left: { trial1: closedNormalTrial }, right: { trial1: closedNormalTrial } },
    });
    // 눈감고 조건 자체는 유지시간 경계로 caution이 나올 수 있지만,
    expect(result.eyesClosed.status).toBe('caution');
    // 눈뜨고 조건은 그 신호와 무관하게 독립적으로 normal을 유지해야 한다.
    expect(result.eyesOpen.status).toBe('normal');
  });

  it('하위 호환: 최상위 left/right/asymmetryFlag는 눈뜨고 조건을 대표값으로 노출한다', () => {
    const result = evaluateSingleLegStanceWithEyes({
      open: { left: { trial1: normalTrial }, right: { trial1: riskTrial } },
      closed: { left: { trial1: normalTrial }, right: { trial1: normalTrial } },
    });
    const openOnly = evaluateSingleLegStance({ left: { trial1: normalTrial }, right: { trial1: riskTrial } });
    expect(result.left).toEqual(openOnly.left);
    expect(result.right).toEqual(openOnly.right);
    expect(result.asymmetryFlag).toBe(openOnly.asymmetryFlag);
  });

  it('둘 다 데이터가 없으면 valid:false를 반환한다', () => {
    const result = evaluateSingleLegStanceWithEyes({});
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_trials');
  });

  it('기존 evaluateSingleLegStance()는 이 함수 추가로 인한 동작 변화가 없다', () => {
    const result = evaluateSingleLegStance({ left: { trial1: normalTrial }, right: { trial1: normalTrial } });
    expect(result.valid).toBe(true);
    expect(result.status).toBe('normal');
    expect(result.eyesOpen).toBeUndefined();
    expect(result.eyesClosed).toBeUndefined();
  });
});
