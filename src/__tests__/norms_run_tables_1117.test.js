import { describe, it, expect } from 'vitest';
import {
  RUN_BOOK_TABLES, RUN_PERCENTILES_2400, RUN_PERCENTILES_12MIN, parseClockSec,
  vo2maxFromRun2400, run2400SecFromVo2max, vo2maxFromRun12, run12mFromVo2max,
  run2400Reference, run12Reference,
} from '../ai-measure/core/norms';

describe('달리기 기준표(연구용) — 교재 값과 공식 검산', () => {
  it('2.4km 교재 표: VO2max ↔ 시간이 George 공식(483/분+3.5)과 맞는다(전 행)', () => {
    for (const [key, rows] of Object.entries(RUN_BOOK_TABLES.run2400)) {
      expect(rows.length).toBe(RUN_PERCENTILES_2400.length);
      for (const [vo2, clock] of rows) {
        const sec = parseClockSec(clock);
        expect(Math.abs(vo2maxFromRun2400(sec) - vo2), `${key} ${clock}`).toBeLessThanOrEqual(0.3);
        expect(Math.abs(run2400SecFromVo2max(vo2) - sec), `${key} ${vo2}`).toBeLessThanOrEqual(4);
      }
    }
  });
  it('2.4km 교재 표는 빠른 시간 → 느린 시간 순서(백분위 99→01)', () => {
    for (const rows of Object.values(RUN_BOOK_TABLES.run2400)) {
      const secs = rows.map(([, c]) => parseClockSec(c));
      expect([...secs].sort((a, b) => a - b)).toEqual(secs);
    }
  });
  it('12분 교재 표는 큰 거리 → 작은 거리 순서이고 Cooper 공식과 Cooper 등급표(남 20-29)가 맞는다', () => {
    for (const km of Object.values(RUN_BOOK_TABLES.run12minKm)) {
      expect(km.length).toBe(RUN_PERCENTILES_12MIN.length);
      expect([...km].sort((a, b) => b - a)).toEqual(km);
    }
    // 남 20-29: 80/60/40 백분위 VO2max 등급 하한 51.1/45.4/41.7 와 12분 거리가 일치
    const m = RUN_BOOK_TABLES.run12minKm['male-20-29'];
    expect(Math.abs(vo2maxFromRun12(m[1] * 1000) - 51.1)).toBeLessThan(0.5);
    expect(Math.abs(vo2maxFromRun12(m[3] * 1000) - 45.4)).toBeLessThan(0.5);
    expect(Math.abs(vo2maxFromRun12(m[5] * 1000) - 41.7)).toBeLessThan(0.5);
  });
  it('남 40-49 12분 표의 90·60 백분위는 miles 열(1.69·1.49)과 맞게 바로잡았다', () => {
    const m = RUN_BOOK_TABLES.run12minKm['male-40-49'];
    expect(m[0]).toBeCloseTo(1.69 * 1.609, 1);
    expect(m[3]).toBeCloseTo(1.49 * 1.609, 1);
  });
  it('여 20-29 2.4km 14:50 은 교재상 40 백분위(VO2 36.1)', () => {
    const r = run2400Reference('female', 25, parseClockSec('14:50'));
    expect(r.source).toBe('book');
    expect(r.percentile).toBe(40);
    expect(r.vo2max).toBeCloseTo(36.1, 0);
  });
  it('교재에 없는 연령·성별은 Cooper 등급표로 계산한 값(derived)이다 — 남 20대·40대 이상', () => {
    const a = run2400Reference('male', 25, parseClockSec('11:00'));
    expect(a.source).toBe('derived');
    const b = run2400Reference('female', 55, parseClockSec('18:00'));
    expect(b.source).toBe('derived');
    expect(run12Reference('male', 62, 2000).source).toBe('derived');
    // 같은 성별·연령에서 더 빨리 달릴수록 백분위가 낮아지지 않는다
    expect(run2400Reference('male', 45, 600).percentile).toBeGreaterThanOrEqual(run2400Reference('male', 45, 900).percentile);
  });
  it('연령·성별이 없거나 범위 밖이면 null(기준을 만들지 않는다)', () => {
    expect(run2400Reference(null, 30, 800)).toBeNull();
    expect(run2400Reference('male', 15, 800)).toBeNull();
    expect(run12Reference('male', 85, 2000)).toBeNull();
    expect(run2400Reference('male', 30, 0)).toBeNull();
  });
  it('12분 환산 왕복이 맞는다', () => {
    expect(run12mFromVo2max(vo2maxFromRun12(2400))).toBeCloseTo(2400, -1);
  });
});
