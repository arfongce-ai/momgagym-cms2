import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOneEuro, createSleeveAnchor, createRepTrail } from '../ai-measure/core/barTrail';

const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);

describe('barTrail 1128', () => {
  it('떨림 필터: 정지 상태의 노이즈 폭이 줄어든다', () => {
    const f = createOneEuro();
    const raw = [], out = [];
    for (let i = 0; i < 120; i++) {
      const p = { x: 0.5 + (rnd() - 0.5) * 0.01, y: 0.5 + (rnd() - 0.5) * 0.01 };
      raw.push(p); out.push(f.filter(p, i * 33));
    }
    const span = a => Math.max(...a.slice(30).map(p => p.y)) - Math.min(...a.slice(30).map(p => p.y));
    expect(span(out)).toBeLessThan(span(raw) * 0.5);
  });
  it('떨림 필터: 빠른 이동은 크게 뒤처지지 않는다', () => {
    const f = createOneEuro();
    let o;
    for (let i = 0; i < 30; i++) o = f.filter({ x: 0.5, y: 0.9 - i * 0.02 }, i * 33);
    expect(Math.abs(o.y - (0.9 - 29 * 0.02))).toBeLessThan(0.05);
  });
  it('슬리브 앵커: 추적이 끊기면 손목+오프셋으로 이어간다(점프 없음)', () => {
    const a = createSleeveAnchor();
    const r1 = a.resolve({ sleeve: { x: 0.4, y: 0.7 }, active: true, wrist: { x: 0.5, y: 0.6 } });
    expect(r1.source).toBe('sleeve');
    const r2 = a.resolve({ sleeve: { x: 0.4, y: 0.7 }, active: false, wrist: { x: 0.5, y: 0.5 } });
    expect(r2.source).toBe('wrist+offset');
    expect(r2.x).toBeCloseTo(0.4, 2); expect(r2.y).toBeCloseTo(0.6, 2);
    expect(createSleeveAnchor().resolve({ sleeve: null, active: false, wrist: { x: 1, y: 2 } }).source).toBe('wrist');
  });
  it('렙 궤적: 렙이 끝나도 유지되고, 다음 렙 움직임에서 새로 시작', () => {
    const t = createRepTrail();
    for (let i = 0; i < 30; i++) t.push({ x: 0.5, y: 0.8 - i * 0.01 }, i * 33, 0);
    expect(t.points().length).toBe(30);
    t.push({ x: 0.5, y: 0.5 }, 1000, 1); // 렙 완료
    expect(t.isFinished()).toBe(true);
    for (let i = 0; i < 20; i++) t.push({ x: 0.5, y: 0.5 }, 1100 + i * 33, 1); // 정지: 유지
    expect(t.points().length).toBe(30);
    for (let i = 0; i < 10; i++) t.push({ x: 0.5, y: 0.5 + i * 0.01 }, 2000 + i * 33, 1); // 재시작
    expect(t.isFinished()).toBe(false);
    expect(t.points().length).toBeLessThan(15);
  });
  it('VbtMeasure: 사라지는 잔상 대신 고정 궤적·슬리브 지정을 쓴다', () => {
    const src = fs.readFileSync('src/ai-measure/menus/VbtMeasure.jsx', 'utf8');
    expect(src).not.toMatch(/drawFadingBarPath/);
    expect(src).toMatch(/drawSolidBarTrail/);
    expect(src).toMatch(/capRef\.current\.seed\(v, nx, ny\)/);
  });
});
