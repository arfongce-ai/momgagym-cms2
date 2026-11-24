import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildBoscoSummary } from '../ai-measure/core/boscoTest';
import { JUMP_SUBTYPES, requiredJumpsFor, engineOf } from '../ai-measure/core/jumpTypes';
import { MULTI_TRIAL_JUMP_SUBTYPES } from '../ai-measure/core/jumpBiomechanics';
import { buildSummaryData } from '../ai-measure/core/unifiedReport';

// n번 점프: 사이클 cycleMs 마다 체공 flightMs
const makeFlights = (n, cycleMs, flightMs, startMs = 1000) =>
  Array.from({ length: n }, (_, i) => {
    const takeoffMs = startMs + i * cycleMs;
    return { takeoffMs, landingMs: takeoffMs + flightMs, flightMs };
  });

describe('보스코 60초 연속점프 요약 (2026-11-24)', () => {
  it('60초 동안 50회, 회당 체공 0.5초 → 책 공식 값 20.62 W/kg', () => {
    // 사이클 1200ms × 50회 = 60초 (마지막 착지 ≈ 59.3초 → 허용 오차 안)
    const b = buildBoscoSummary(makeFlights(50, 1200, 500), { sex: 'male' });
    expect(b.complete).toBe(true);
    expect(b.jumps).toBe(50);
    expect(b.flightTotalSec).toBeCloseTo(25, 2);
    expect(b.powerWPerKg).toBeCloseTo(20.62, 1);
    expect(b.intervals.map((i) => i.sec)).toEqual([15, 30, 60]);
    expect(b.percentile).not.toBeNull();
  });
  it('구간별(15·30초) 점프 수와 체공 합계', () => {
    const b = buildBoscoSummary(makeFlights(50, 1200, 500));
    const i15 = b.intervals.find((i) => i.sec === 15);
    // 13번째 착지 = 시작 + 12×1.2초 + 0.5초 = 14.9초 ≤ 15초 → 13회
    expect(i15.jumps).toBe(13);
    expect(i15.flightTotalSec).toBeCloseTo(i15.jumps * 0.5, 3);
  });
  it('60초를 못 채우면 60초 파워를 계산하지 않는다(null) — 0으로 만들지 않는다', () => {
    const b = buildBoscoSummary(makeFlights(20, 1200, 500));
    expect(b.complete).toBe(false);
    expect(b.powerWPerKg).toBeNull();
    expect(b.percentile).toBeNull();
    expect(b.intervals.find((i) => i.sec === 15).powerWPerKg).not.toBeNull();
    expect(b.intervals.find((i) => i.sec === 30).complete).toBe(false);
  });
  it('성별이 없으면 파워는 나오지만 백분위는 비운다', () => {
    const b = buildBoscoSummary(makeFlights(50, 1200, 500));
    expect(b.powerWPerKg).not.toBeNull();
    expect(b.percentile).toBeNull();
  });
  it('점프가 하나도 없으면 null', () => {
    expect(buildBoscoSummary([])).toBeNull();
    expect(buildBoscoSummary(null)).toBeNull();
  });
  it('세부 종류 등록: power 엔진, 최소 10회, 1~3회 평균 대상이 아니다', () => {
    expect(JUMP_SUBTYPES.bosco.code).toBe('BOSCO');
    expect(engineOf('bosco')).toBe('power');
    expect(requiredJumpsFor('bosco')).toBe(10);
    expect(requiredJumpsFor('cmj')).toBe(1);
    expect(MULTI_TRIAL_JUMP_SUBTYPES).not.toContain('bosco');
  });
  it('통합 분석 요약에 연속점프 지표가 들어온다', () => {
    const b = buildBoscoSummary(makeFlights(50, 1200, 500), { sex: 'female' });
    const keys = buildSummaryData({ kind: 'jump', jumpSubType: 'bosco', heightCm: 30, bosco: b, measuredAt: '2026-11-24T05:00:00.000Z' }).keyMetrics.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['boscoPower', 'boscoJumps']));
  });
  it('라이브·업로드 리포트 조립과 대시보드에 연결돼 있다', () => {
    const live = readFileSync('src/ai-measure/menus/JumpPrecisionAnalysis.jsx', 'utf8');
    const up = readFileSync('src/ai-measure/menus/JumpUploadAnalysis.jsx', 'utf8');
    for (const s of [live, up]) {
      expect(s).toContain("jumpSubType === 'bosco'");
      expect(s).toContain('buildBoscoSummary(');
    }
    const dash = readFileSync('src/ai-measure/menus/JumpReportDashboard.jsx', 'utf8');
    expect(dash).toContain('<BoscoSection report={report} />');
    expect(dash).toContain('data-testid="bosco-intervals"');
  });
});
