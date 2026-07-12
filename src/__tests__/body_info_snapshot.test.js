import { describe, it, expect } from 'vitest';
import { getLatestBodyInfoSnapshot } from '../services/reportService.js';

describe('getLatestBodyInfoSnapshot — 리포트 자동 등록용 신체정보 스냅샷', () => {
  it('가장 최근(날짜순 마지막) 기록의 값으로 스냅샷을 만든다', () => {
    const snap = getLatestBodyInfoSnapshot([
      { recordedAt: '2026-01-01', weight: 70, height: 175 },
      { recordedAt: '2026-06-01', weight: 68, height: 175, systolic: 118, diastolic: 76 },
    ]);
    expect(snap.date).toBe('2026-06-01');
    expect(snap.weight).toBe(68);
    expect(snap.height).toBe(175);
    expect(snap.systolic).toBe(118);
    expect(snap.diastolic).toBe(76);
  });

  it('키와 몸무게가 모두 있으면 BMI를 계산한다', () => {
    const snap = getLatestBodyInfoSnapshot([{ recordedAt: '2026-01-01', height: 175, weight: 70 }]);
    expect(snap.bmi).toBeCloseTo(22.9, 1);
  });

  it('키 또는 몸무게가 없으면 BMI를 만들지 않는다(측정 정직성 — 값 없으면 계산하지 않음)', () => {
    const snap = getLatestBodyInfoSnapshot([{ recordedAt: '2026-01-01', weight: 70 }]);
    expect(snap.bmi).toBeUndefined();
    expect(snap.height).toBeUndefined();
  });

  it('실측값이 하나도 없으면 null을 반환한다', () => {
    expect(getLatestBodyInfoSnapshot([{ recordedAt: '2026-01-01' }])).toBeNull();
  });

  it('기록이 비어 있으면 null을 반환한다', () => {
    expect(getLatestBodyInfoSnapshot([])).toBeNull();
    expect(getLatestBodyInfoSnapshot()).toBeNull();
  });
});
