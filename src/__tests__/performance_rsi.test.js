import { describe, it, expect } from 'vitest';
import { calcRSI, RSI_INPUT_RANGE } from '../ai-measure/core/performance.js';

describe('calcRSI · 수동 입력 sanity 가드', () => {
  it('정상 범위: 체공 0.5s / 접지 0.2s → RSI 2.5', () => {
    const r = calcRSI(0.5, 0.2);
    expect(r.error).toBeUndefined();
    expect(r.rsi).toBeCloseTo(2.5, 2);
    expect(r.heightCm).toBeGreaterThan(0);
  });

  it('접지시간이 너무 짧으면(불가능) 에러 — 단위 혼동 방지', () => {
    // 0.02s = 20ms, 물리적으로 불가능
    const r = calcRSI(0.5, 0.02);
    expect(r.error).toBe('contact_out_of_range');
    expect(r.message).toContain('접지');
  });

  it('접지시간이 너무 길면(멈춤) 에러', () => {
    const r = calcRSI(0.5, 1.0); // 1초 > 0.8s
    expect(r.error).toBe('contact_out_of_range');
  });

  it('체공시간이 비현실적으로 길면 에러', () => {
    const r = calcRSI(2.5, 0.2); // 2.5s 체공 ≈ 7.6m, 불가능
    expect(r.error).toBe('flight_out_of_range');
  });

  it('0/음수/빈값은 null', () => {
    expect(calcRSI(0, 0.2)).toBeNull();
    expect(calcRSI(0.5, 0)).toBeNull();
    expect(calcRSI(-1, 0.2)).toBeNull();
    expect(calcRSI('', '')).toBeNull();
  });

  it('범위 상수 일관성(ms↔s)', () => {
    // 카메라 모드 80~800ms 와 동일 기준
    expect(RSI_INPUT_RANGE.minContactSec).toBeCloseTo(0.08, 3);
    expect(RSI_INPUT_RANGE.maxContactSec).toBeCloseTo(0.80, 3);
  });
});
