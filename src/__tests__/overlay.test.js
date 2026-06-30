import { describe, it, expect, vi } from 'vitest';
import { drawMeasurementOverlay, formatRecordTime, formatStopwatch } from '../ai-measure/core/recordingOverlay.js';

// 가짜 2D 컨텍스트 — 호출만 검증(렌더 없음). 스켈레톤 없이 텍스트만 그리는지 확인.
function mockCtx() {
  const calls = { fillText: [], arc: 0 };
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(),
    arc: vi.fn(() => { calls.arc++; }),
    fill: vi.fn(), stroke: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn(),
    measureText: vi.fn((t) => ({ width: String(t).length * 8 })),
    fillText: vi.fn((t) => { calls.fillText.push(String(t)); }),
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set strokeStyle(v) {}, get strokeStyle() { return ''; },
    set font(v) {}, get font() { return ''; },
    set lineWidth(v) {}, set textBaseline(v) {}, set textAlign(v) {},
    _calls: calls,
  };
}

describe('drawMeasurementOverlay (스켈레톤 없이 측정값 텍스트만)', () => {
  it('측정값 라벨/값을 텍스트로 그린다', () => {
    const ctx = mockCtx();
    drawMeasurementOverlay(ctx, 540, 960, {
      title: 'GAIT LIVE',
      elapsedMs: 5000,
      metrics: [{ label: 'CADENCE', value: '168 SPM' }, { label: 'STEPS', value: 12 }],
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('GAIT LIVE');
    expect(txt).toContain('168 SPM');
    expect(txt).toContain('CADENCE');
    expect(txt).toContain('12');
  });

  it('값이 없는 지표는 건너뛴다', () => {
    const ctx = mockCtx();
    drawMeasurementOverlay(ctx, 540, 960, {
      title: 'X', metrics: [{ label: 'A', value: null }, { label: 'B', value: '' }],
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('X');
    expect(txt).not.toContain('A');
  });

  it('빈 입력은 아무것도 그리지 않는다', () => {
    const ctx = mockCtx();
    drawMeasurementOverlay(ctx, 540, 960, {});
    expect(ctx._calls.fillText.length).toBe(0);
  });
});

describe('시간 포맷', () => {
  it('formatRecordTime mm:ss', () => {
    expect(formatRecordTime(65)).toBe('01:05');
  });
  it('formatStopwatch mm:ss.cs', () => {
    expect(formatStopwatch(65120)).toBe('01:05.12');
  });
});
