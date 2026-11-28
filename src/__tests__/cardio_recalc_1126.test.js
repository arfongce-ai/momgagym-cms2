import { describe, it, expect } from 'vitest';
import { createRecorder, recordTick, computeCardioResult, buildCardioRecord, recomputeCardioRecord } from '../ai-measure/core/cardioTest';

function astrandRecord(subject) {
  const rec = createRecorder();
  for (let s = 0; s <= 420; s += 1) recordTick(rec, s, { hr: 140, powerW: 92 });
  const computed = computeCardioResult({ protocolId: 'bike_astrand', machineId: 'bike', rec, workEndSec: 360, subject });
  return buildCardioRecord({ protocolId: 'bike_astrand', machineId: 'bike', startedAt: '2026-11-26T01:00:00Z', rec, computed });
}

describe('저장된 심폐 기록 VO2max 재계산', () => {
  it('체중 없이 저장된 Åstrand 기록은 체중을 채워 다시 계산하면 VO2max 가 생긴다', () => {
    const saved = astrandRecord({ age: 14, sex: 'female', weightKg: null });
    expect(saved.estimates.vo2max.value).toBeNull();
    const patch = recomputeCardioRecord(saved, { subject: { weightKg: 50 } });
    expect(patch.estimates.vo2max.value).toBeGreaterThan(20);
    expect(patch.subject.weightKg).toBe(50);
    expect(patch.subject.sex).toBe('female');
    expect(patch.recalculatedAt).toBeTruthy();
  });
  it('원본 series·RPE 는 patch 에 들어가지 않는다(덮어쓰지 않음)', () => {
    const saved = astrandRecord({ age: 14, sex: 'female', weightKg: null });
    const patch = recomputeCardioRecord(saved, { subject: { weightKg: 50 } });
    expect(patch.series).toBeUndefined();
    expect(patch.rpe).toBeUndefined();
  });
  it('원본 기록(series)이 없으면 null', () => {
    expect(recomputeCardioRecord({ kind: 'cardio_test', result: { durationSec: 360 } })).toBeNull();
    expect(recomputeCardioRecord(null)).toBeNull();
  });
});
