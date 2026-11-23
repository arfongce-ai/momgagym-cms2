import { describe, it, expect } from 'vitest';
import { cardioChangeSummary } from '../ai-measure/core/cardioTest';

const rec = (over = {}) => ({
  kind: 'cardio_test', machineId: 'rower', protocolId: 'rower_2k', startedAt: '2026-11-01T10:00:00Z',
  confirmedVo2max: 40, estimates: { maxPower: { value: 300 } },
  result: { durationSec: 480, distanceM: 2000, avgPowerW: 150, avgHr: 160 }, recovery: { drop60: 25 }, ...over,
});

describe('심폐지구력 일반 테스트 전·후 비교 — 2026-11-23', () => {
  it('같은 장비·테스트면 변화 행과 문장을 만든다(시간은 짧을수록 개선)', () => {
    const prev = rec();
    const cur = rec({ startedAt: '2026-11-23T10:00:00Z', confirmedVo2max: 42, result: { durationSec: 465, distanceM: 2000, avgPowerW: 160, avgHr: 158 } });
    const s = cardioChangeSummary(cur, prev);
    expect(s.previousDate).toBe('2026-11-01');
    const by = Object.fromEntries(s.rows.map((r) => [r.label, r]));
    expect(by['VO2max(참고)'].direction).toBe('improved');
    expect(by['기록 시간'].direction).toBe('improved');
    expect(by['평균 심박'].direction).toBe('improved');
    expect(s.narrative).toContain('개선');
  });
  it('장비나 테스트가 다르면 비교하지 않는다', () => {
    expect(cardioChangeSummary(rec(), rec({ protocolId: 'free' }))).toBeNull();
    expect(cardioChangeSummary(rec(), rec({ machineId: 'bike' }))).toBeNull();
    expect(cardioChangeSummary(rec(), null)).toBeNull();
  });
  it('자유 기록은 평균 심박을 비교하지 않는다(부하가 달라 의미 없음)', () => {
    const a = rec({ protocolId: 'free' }); const b = rec({ protocolId: 'free', result: { avgHr: 150 } });
    const s = cardioChangeSummary(b, a);
    expect(s?.rows.some((r) => r.label === '평균 심박') ?? false).toBe(false);
  });
});
