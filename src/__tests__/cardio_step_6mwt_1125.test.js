import { describe, it, expect } from 'vitest';
import {
  buildCardioRecord, computeCardioResult, createRecorder, getProtocol, protocolsForMachine, queensVo2max, sixMinPredictedM,
} from '../ai-measure/core/cardioTest';

const emptyRec = () => createRecorder();

describe('스텝테스트·6분 걷기 (출처 확인된 식만)', () => {
  it('필드 탭에 두 테스트가 있다', () => {
    const ids = protocolsForMachine('field').map((p) => p.id);
    expect(ids).toContain('field_step');
    expect(ids).toContain('field_6mwt');
    expect(getProtocol('field_step').target.durationSec).toBe(180);
    expect(getProtocol('field_6mwt').target.durationSec).toBe(360);
  });
  it('퀸스칼리지: 남 111.33−0.42×HR, 여 65.81−0.1847×HR', () => {
    expect(queensVo2max({ sex: 'male', hr: 150 })).toBe(48.3);
    expect(queensVo2max({ sex: 'female', hr: 150 })).toBe(38.1);
    expect(queensVo2max({ sex: '', hr: 150 })).toBeNull();
    expect(queensVo2max({ sex: 'male', hr: 30 })).toBeNull();
  });
  it('6분 걷기 예측거리: Enright & Sherrill, 40~80세만', () => {
    // 남 170cm·60세·70kg = 7.57*170 − 5.02*60 − 1.76*70 − 309 = 1286.9−301.2−123.2−309 = 553.5
    expect(sixMinPredictedM({ sex: 'male', age: 60, statureCm: 170, weightKg: 70 })).toBe(554);
    // 여 160cm·60세·60kg = 337.6 − 137.4 − 346.8 + 667 = 520.4
    expect(sixMinPredictedM({ sex: 'female', age: 60, statureCm: 160, weightKg: 60 })).toBe(520);
    expect(sixMinPredictedM({ sex: 'male', age: 30, statureCm: 170, weightKg: 70 })).toBeNull();
    expect(sixMinPredictedM({ sex: 'male', age: 60, statureCm: null, weightKg: 70 })).toBeNull();
  });
  it('스텝: 입력 심박으로 VO2max, 없으면 계산 안 함', () => {
    const base = { protocolId: 'field_step', machineId: 'field', rec: emptyRec(), workEndSec: 180, subject: { age: 25, sex: 'male', weightKg: 70 } };
    const ok = computeCardioResult({ ...base, manual: { hrAfter: 140 } });
    expect(ok.estimates.vo2max.value).toBe(52.5);
    expect(ok.estimates.vo2max.method).toBe('queens');
    const none = computeCardioResult(base);
    expect(none.estimates.vo2max.value).toBeNull();
    expect(none.estimates.vo2max.reason).toContain('입력');
  });
  it('6분 걷기: 거리 입력 시 예측 대비 %, VO2max 는 계산하지 않음, 저장 레코드에 walk6', () => {
    const base = { protocolId: 'field_6mwt', machineId: 'field', rec: emptyRec(), workEndSec: 360, subject: { age: 60, sex: 'male', weightKg: 70, statureCm: 170 } };
    const c = computeCardioResult({ ...base, manual: { distanceM: 500 } });
    expect(c.walk6.predictedM).toBe(554);
    expect(c.walk6.pctPredicted).toBe(90);
    expect(c.estimates.vo2max).toBeNull();
    const rec = buildCardioRecord({ protocolId: 'field_6mwt', machineId: 'field', rec: emptyRec(), computed: c });
    expect(rec.walk6.pctPredicted).toBe(90);
    expect(rec.subject.statureCm).toBe(170);
    const young = computeCardioResult({ ...base, subject: { ...base.subject, age: 30 }, manual: { distanceM: 600 } });
    expect(young.walk6.predictedM).toBeNull();
    expect(young.walk6.distanceM).toBe(600);
    expect(computeCardioResult(base).walk6.distanceM).toBeNull();
  });
});
