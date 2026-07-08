import { describe, it, expect, vi } from 'vitest';
import { drawMeasurementOverlay, drawBigStatHud, drawGaugeHud, formatRecordTime, formatStopwatch } from '../ai-measure/core/recordingOverlay.js';

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

// ── 대형 시인성 HUD(공통) — ROM/보행/점프/1RM·VBT 녹화 번인용 ──
describe('drawBigStatHud (대형 코너 수치 카드 · 피사체 미가림 배치)', () => {
  it('제목·상태·좌우 라벨·값·단위·보조줄을 그린다', () => {
    const ctx = mockCtx();
    drawBigStatHud(ctx, 720, 1280, {
      title: 'GAIT', status: 'READY', recording: true, elapsedSec: 3.2,
      left: { label: '케이던스', value: 112, unit: 'spm', accent: true },
      right: { label: '입각·유각', value: '62/38', unit: '%' },
      note: '걸음 24',
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('GAIT');
    expect(txt).toContain('READY');
    expect(txt).toContain('3.2s');
    expect(txt).toContain('케이던스');
    expect(txt).toContain('112');
    expect(txt).toContain('spm');
    expect(txt).toContain('62/38');
    expect(txt).toContain('%');
    expect(txt).toContain('걸음 24');
  });

  it('값이 없으면 -- 를 그린다(허위값 없음 · 측정 정직성)', () => {
    const ctx = mockCtx();
    drawBigStatHud(ctx, 720, 1280, {
      title: 'ROM', recording: true,
      left: { label: '좌측 각도', value: null, unit: '°' },
      right: { label: '우측 각도', value: 132, unit: '°' },
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('--');
    expect(txt).toContain('132');
  });

  it('하단 히스토리 카드(#회차·주값·보조값)를 그린다', () => {
    const ctx = mockCtx();
    drawBigStatHud(ctx, 720, 1280, {
      title: 'RSI',
      cards: [
        { top: '#1', main: '1.42', sub: '212ms' },
        { top: '#2', main: '1.51', sub: '198ms', latest: true },
      ],
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('#1');
    expect(txt).toContain('1.42');
    expect(txt).toContain('212ms');
    expect(txt).toContain('#2');
  });

  it('빈 입력은 아무것도 그리지 않는다', () => {
    const ctx = mockCtx();
    drawBigStatHud(ctx, 720, 1280, {});
    expect(ctx._calls.fillText.length).toBe(0);
  });
});

// ── 게이지형 HUD(공통) — 중앙 아크 게이지 + 코너 스탯 ──
describe('drawGaugeHud (아크 게이지 · 코너 스탯 · 회차 카드)', () => {
  it('제목·경과·게이지 라벨/값/단위·코너 스탯을 그린다', () => {
    const ctx = mockCtx();
    drawGaugeHud(ctx, 1080, 1440, {
      title: 'VBT', recording: true, elapsedSec: 4.1, accent: '#22d3ee',
      gauge: { label: '평균속도', value: 0.82, min: 0, max: 1.5, unit: 'm/s' },
      stats: [{ label: '수직이동', value: 56, unit: 'cm' }],
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('VBT');
    expect(txt).toContain('4.1s');
    expect(txt).toContain('평균속도');
    expect(txt).toContain('0.82');
    expect(txt).toContain('m/s');
    expect(txt).toContain('수직이동');
    expect(txt).toContain('56');
    expect(txt).toContain('cm');
    expect(ctx._calls.arc).toBeGreaterThan(0); // 게이지 아크가 실제로 그려짐
  });

  it('게이지 값이 없으면 -- 를 그리고 아크를 채우지 않는다', () => {
    const ctx = mockCtx();
    drawGaugeHud(ctx, 720, 960, {
      title: 'ROM', recording: true,
      gauge: { label: '가동범위', value: null, min: 0, max: 180, unit: '°' },
      stats: [{ label: '좌측', value: null, unit: '°' }, { label: '우측', value: 120, unit: '°' }],
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('--');
    expect(txt).toContain('120');
  });

  it('하단 회차 카드(#·주값·보조)를 그린다', () => {
    const ctx = mockCtx();
    drawGaugeHud(ctx, 1080, 1440, {
      title: 'RSI',
      gauge: { label: 'RSI', value: 1.5, min: 0, max: 3 },
      cards: [
        { top: '#1', main: '1.42', sub: '212ms' },
        { top: '#2', main: '1.51', sub: '198ms', latest: true },
      ],
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('#1');
    expect(txt).toContain('1.42');
    expect(txt).toContain('212ms');
  });

  it('빈 입력은 아무것도 그리지 않는다', () => {
    const ctx = mockCtx();
    drawGaugeHud(ctx, 720, 960, {});
    expect(ctx._calls.fillText.length).toBe(0);
  });

  it('게이지 값이 null 이면 "null" 이 아니라 -- 를 그린다(회귀)', () => {
    const ctx = mockCtx();
    drawGaugeHud(ctx, 1080, 1440, {
      title: 'JUMP', recording: true,
      gauge: { label: '점프 높이', value: null, min: 0, max: 80, unit: 'cm' },
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).not.toContain('null');
    expect(txt).toContain('--');
  });

  it('게이지 값이 0 이면 0 을 정상 표시한다(값 없음과 구분)', () => {
    const ctx = mockCtx();
    drawGaugeHud(ctx, 1080, 1440, {
      title: 'JUMP', gauge: { label: '점프', value: 0, min: 0, max: 80, unit: 'cm' },
    });
    const cells = ctx._calls.fillText;
    expect(cells).toContain('0');
    expect(cells.join('|')).not.toContain('null');
  });
});
