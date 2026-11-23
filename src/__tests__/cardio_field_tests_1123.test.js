import { describe, it, expect } from 'vitest';
import {
  personalMaxHr, cardioContext, CARDIO_RECORD_KIND, CARDIO_MACHINES, protocolsForMachine, getProtocol, cooper15Vo2max, rockportVo2max,
  computeCardioResult, createRecorder, buildCardioRecord, bruceVo2max, bruceStageAt, hrMaxTanaka, estimateAccuracy,
} from '../ai-measure/core/cardioTest';
import { run15Percentile, vo2maxFromRun12 } from '../ai-measure/core/norms';

const calc = (protocolId, subject, manual) => computeCardioResult({
  protocolId, machineId: 'field', rec: createRecorder(), workEndSec: manual?.timeSec ?? 720, subject, manual,
});

describe('11번 심폐지구력 — 교재 8장 필드 테스트(2026-11-23)', () => {
  it('필드 장비에 3개 테스트가 있고 기존 5개 장비는 그대로', () => {
    expect(CARDIO_MACHINES.field).toBeTruthy();
    expect(protocolsForMachine('field').map((p) => p.id)).toEqual(['field_cooper15', 'field_cooper12', 'field_rockport', 'field_bruce']);
    expect(protocolsForMachine('treadmill').map((p) => p.id)).toEqual(['curved_2400', 'curved_12min', 'free']);
    expect(getProtocol('field_cooper15').basis).toBe('flat');
  });
  it('쿠퍼 1.5마일: 교재 식 손계산 일치(남 70kg 12분 = 46.9, 여 60kg 15분 = 36.6)', () => {
    expect(cooper15Vo2max({ sex: 'male', weightKg: 70, timeSec: 720 })).toBe(46.9);
    expect(cooper15Vo2max({ sex: 'female', weightKg: 60, timeSec: 900 })).toBe(36.6);
    expect(cooper15Vo2max({ sex: '', weightKg: 60, timeSec: 900 })).toBeNull();
  });
  it('표 8.2 백분위: 표 값은 그 백분위, 사이는 보간, 범위 밖은 90이상/10이하, 70세는 null', () => {
    expect(run15Percentile('male', 25, 11 * 60 + 58).percentile).toBe(50);
    expect(run15Percentile('female', 35, 13 * 60 + 41).percentile).toBe(70);
    expect(run15Percentile('male', 55, 14 * 60 + 33).percentile).toBe(50);
    expect(run15Percentile('male', 25, 9 * 60).band).toBe('90이상');
    expect(run15Percentile('female', 65, 30 * 60).band).toBe('10이하');
    const mid = run15Percentile('male', 25, 11 * 60 + 12).percentile; // 11:09(70)~11:27(60) 사이... 10:49(70)와 11:27(60) 사이
    expect(mid).toBeGreaterThanOrEqual(60); expect(mid).toBeLessThanOrEqual(70);
    expect(run15Percentile('male', 70, 600)).toBeNull();
    expect(run15Percentile('male', 19, 600)).toBeNull();
  });
  it('록포트: 18~29세(Dolgener)·30~79세(Kline, 체중 kg 계수) 계산', () => {
    // 남 25세 75kg 13분 HR140: 97.660 − 0.0957×165.35 − 1.4537×13 − 0.1194×140
    expect(rockportVo2max({ sex: 'male', age: 25, weightKg: 75, timeSec: 780, hr: 140 })).toBeCloseTo(97.660 - 0.0957 * 75 * 2.20462 - 1.4537 * 13 - 0.1194 * 140, 1);
    // 남 40세 80kg 14분 HR130 → 44.1 (교재 lb 오기대로 계산하면 ~28 로 비현실적)
    expect(rockportVo2max({ sex: 'male', age: 40, weightKg: 80, timeSec: 840, hr: 130 })).toBe(44.1);
    expect(rockportVo2max({ sex: 'male', age: 40, weightKg: 80, timeSec: 840, hr: 0 })).toBeNull();
    expect(rockportVo2max({ sex: 'female', age: 85, weightKg: 60, timeSec: 900, hr: 120 })).toBeNull();
  });
  it('12분: Cooper 1968 식 사용(2400m → 42.4)', () => {
    expect(vo2maxFromRun12(2400)).toBe(42.4);
    const r = calc('field_cooper12', { age: 30, sex: 'male', weightKg: 70 }, { distanceM: 2400 });
    expect(r.estimates.vo2max.value).toBe(42.4);
    expect(r.notes.join(' ')).toContain('0.0268');
  });
  it('12분: 거리 입력이 없으면 계산하지 않고 이유를 남긴다(저장 차단 없음)', () => {
    const r = calc('field_cooper12', { age: 30, sex: 'male', weightKg: 70 }, null);
    expect(r.estimates.vo2max.value).toBeNull();
    expect(r.estimates.vo2max.reason).toContain('거리');
  });
  it('1.5마일: 입력 시간으로 VO2·백분위·저장 페이로드', () => {
    const subject = { age: 28, sex: 'female', weightKg: 55 };
    const r = calc('field_cooper15', subject, { timeSec: 13 * 60 + 25 });
    expect(r.result.durationSec).toBe(805);
    expect(r.result.distanceM).toBe(2414);
    expect(r.estimates.vo2max.value).toBe(Math.round((88.020 - 0.1656 * 55 - 2.767 * (805 / 60)) * 10) / 10);
    expect(r.fieldRank.percentile).toBe(60);
    const rec = buildCardioRecord({ protocolId: 'field_cooper15', machineId: 'field', rec: createRecorder(), computed: r });
    expect(rec.basis).toBe('flat');
    expect(rec.fieldRank.test).toBe('run1_5mile');
    expect(rec.flatReference).toBeNull();
  });
  it('록포트: 심박 입력 없으면 이유 표시, 입력하면 계산', () => {
    const subject = { age: 45, sex: 'male', weightKg: 80 };
    expect(calc('field_rockport', subject, { timeSec: 840 }).estimates.vo2max.reason).toContain('심박');
    expect(calc('field_rockport', subject, { timeSec: 840, hrAfter: 130 }).estimates.vo2max.value).toBeGreaterThan(30);
  });
  it('브루스: 교재 9장 식(남 10분 = 34.1, 여 10분 = 39.9), 단계 표시, 범위 밖 null', () => {
    expect(bruceVo2max({ sex: 'male', timeSec: 600 })).toBe(34.1);
    expect(bruceVo2max({ sex: 'female', timeSec: 600 })).toBe(39.9);
    expect(bruceVo2max({ sex: 'male', timeSec: 30 })).toBeNull();
    expect(bruceStageAt(0)).toMatchObject({ stage: 1, mph: 1.7 });
    expect(bruceStageAt(185)).toMatchObject({ stage: 2, mph: 2.5 });
    expect(bruceStageAt(2000)).toMatchObject({ stage: 6, mph: 5.5, nextInSec: null });
    const r = calc('field_bruce', { age: 30, sex: 'female', weightKg: 55 }, { timeSec: 600 });
    expect(r.estimates.vo2max.value).toBe(39.9);
  });
  it('최대심박 기본값 Tanaka, 실내·필드 실제 기록은 따로 모은다', () => {
    expect(hrMaxTanaka(40)).toBe(180);
    expect(personalMaxHr({ age: 20 }).value).toBe(194);
    const sessions = [
      { data: { kind: CARDIO_RECORD_KIND, machineId: 'rower', result: { peakHr: 190 } } },
      { data: { kind: CARDIO_RECORD_KIND, machineId: 'field', result: { peakHr: 186 } } },
    ];
    expect(cardioContext('field')).toBe('field');
    expect(cardioContext('bike')).toBe('indoor');
    expect(personalMaxHr({ age: 40, sessions, context: 'indoor' })).toEqual({ value: 190, source: 'observed' });
    expect(personalMaxHr({ age: 40, sessions, context: 'field' })).toEqual({ value: 186, source: 'observed' });
    expect(personalMaxHr({ age: 40, sessions })).toEqual({ value: 190, source: 'observed' });
    const r = calc('field_cooper15', { age: 40, sex: 'male', weightKg: 70 }, { timeSec: 720 });
    expect(r.hrMax).toMatchObject({ value: 180, formula: 'tanaka', context: 'field' });
  });
  it('오차 범위·설명력(교재 4장): 쿠퍼 1.5마일 r=0.90 → r²=81%, ±6%', () => {
    const r = calc('field_cooper15', { age: 28, sex: 'female', weightKg: 55 }, { timeSec: 805 });
    const a = r.estimates.vo2max.accuracy;
    expect(a.r2).toBe(81);
    expect(a.seeHigh).toBeCloseTo(r.estimates.vo2max.value * 0.06, 1);
    expect(a.range68[0]).toBeLessThan(r.estimates.vo2max.value);
    expect(a.range95[1]).toBeGreaterThan(a.range68[1]);
    expect(estimateAccuracy('astrand', 40)).toBeNull();
    expect(estimateAccuracy('bruce', 40, { sex: 'male' }).r2).toBe(96);
  });
});
