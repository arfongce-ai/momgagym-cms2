import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as P from '../ai-measure/core/jumpPower';

describe('jumpPower — Haff & Dumke 12장', () => {
  it('체공시간 → 높이: 0.6s면 약 44.1cm', () => {
    expect(P.flightTimeToHeightCm(0.6)).toBeCloseTo(44.15, 1);
    expect(P.flightTimeToHeightCm(0)).toBeNull();
  });
  it('Sayer는 기존 calcJump와 같은 값(40cm, 70kg)', () => {
    expect(P.sayerPeakPower(40, 70)).toBe(Math.round(60.7 * 40 + 45.3 * 70 - 2055));
  });
  it('Johnson 평균은 본문 상수 +431 사용 — 비현실적인 값이 나오지 않는다', () => {
    expect(P.johnsonPeakPower(40, 70, 170)).toBe(3473);
    expect(P.johnsonAveragePower(40, 70, 170)).toBe(1908);
  });
  it('Harman 값은 책 표기대로 계산', () => {
    expect(P.harmanAveragePower(40, 70)).toBe(1065);
    expect(P.harmanPeakPower(40, 70)).toBe(6818);
  });
  it('필수 입력이 없으면 null(0으로 만들지 않는다)', () => {
    expect(P.johnsonPeakPower(40, 70, null)).toBeNull();
    expect(P.sayerPeakPower(40, null)).toBeNull();
    expect(P.estimateVerticalPowers({ heightCm: 40 }).sayerPeak).toBeNull();
  });
  it('EUR = CMJ/SJ, 규준표 7행', () => {
    expect(P.eccentricUtilizationRatio(44, 40)).toBe(1.1);
    expect(P.eccentricUtilizationRatio(44, 0)).toBeNull();
    expect(P.EUR_NORMS).toHaveLength(7);
    expect(P.EUR_NORMS.find((r) => r.sport === '비훈련자').men.mean).toBe(1.17);
  });
  it('Bosco 연속점프: 책 공식, 표 12.8·12.9 규준', () => {
    // n=50, Tf=25s → 9.81²×25×60 / (4×50×35) = 20.62 W/kg
    expect(P.boscoMechanicalPower(25, 50)).toBeCloseTo(20.62, 1);
    expect(P.boscoMechanicalPower(60, 50)).toBeNull();
    expect(P.BOSCO_GROUP_NORMS).toHaveLength(5);
    expect(P.BOSCO_GROUP_NORMS[0].power.mean).toBe(19.8);
    for (const sx of ['male', 'female']) {
      const t = P.BOSCO_PERCENTILES[sx];
      expect(t.absolute).toHaveLength(19);
      expect(t.relative).toHaveLength(19);
      for (let i = 1; i < 19; i++) {
        expect(t.absolute[i]).toBeLessThanOrEqual(t.absolute[i - 1]);
        expect(t.relative[i]).toBeLessThanOrEqual(t.relative[i - 1]);
      }
    }
    expect(P.boscoPercentile('M', 15.9)).toEqual({ below: false, percentile: 50 });
    expect(P.boscoPercentile('F', 8)).toEqual({ below: true, percentile: null });
    expect(P.boscoPercentile('X', 15)).toBeNull();
  });
  it('보조 공식: 스톱워치 환산, 수평 파워(책 예시 909.1), Margaria-Kalamen', () => {
    expect(P.stopwatchToElectronic(5)).toBeCloseTo(5.28, 2);
    expect(P.horizontalPower(100, 200, 22)).toBeCloseTo(909.09, 1);
    expect(P.margariaKalamenPower(70, 0.6).kgms).toBeCloseTo(122.5, 1);
  });
  it('리포트 파워 구간이 jumpPower를 쓴다', () => {
    const s = readFileSync('src/ai-measure/menus/JumpReportDashboard.jsx', 'utf8');
    expect(s).toContain("from '../core/jumpPower'");
    expect(s).toContain('estimateVerticalPowers');
  });
});
