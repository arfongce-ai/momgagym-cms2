import { describe, it, expect } from 'vitest';
import { buildAnalysisTrend } from '../services/reportService.js';

describe('buildAnalysisTrend', () => {
  it('점프 리포트들을 날짜순 높이 시계열로 만든다', () => {
    const reports = [
      { kind: 'jump', createdAt: '2026-02-01T10:00:00Z', heightCm: 38, flightTimeMs: 560, peakPower: 3000 },
      { kind: 'jump', createdAt: '2026-01-15T10:00:00Z', heightCm: 35, flightTimeMs: 535, peakPower: 2800 },
      { kind: 'jump', createdAt: '2026-03-01T10:00:00Z', heightCm: 42, flightTimeMs: 585, peakPower: 3200 },
    ];
    const { jump } = buildAnalysisTrend(reports);
    expect(jump.count).toBe(3);
    // 날짜 오름차순 정렬 확인
    expect(jump.height.map(p => p.value)).toEqual([35, 38, 42]);
    expect(jump.height[0].date).toBe('2026-01-15');
    expect(jump.peakPower.length).toBe(3);
  });

  it('biomech 착지 대칭/무릎각도 시계열을 추출한다', () => {
    const reports = [
      { kind: 'jump', createdAt: '2026-01-01', heightCm: 40, flightTimeMs: 570,
        biomech: { footLandingSymmetry: { symmetryPct: 92 }, landingKneeAngle: 130 } },
      { kind: 'jump', createdAt: '2026-02-01', heightCm: 41, flightTimeMs: 575,
        biomech: { footLandingSymmetry: { symmetryPct: 95 }, landingKneeAngle: 128 } },
    ];
    const { jump } = buildAnalysisTrend(reports);
    expect(jump.footSym.map(p => p.value)).toEqual([92, 95]);
    expect(jump.landKnee.map(p => p.value)).toEqual([130, 128]);
  });

  // [무릎·고관절 각도 그래프 / 지면반력 대체 지표 2026-08-18]
  it('biomech 착지 고관절각 시계열을 추출한다', () => {
    const reports = [
      { kind: 'jump', createdAt: '2026-01-01', heightCm: 40, flightTimeMs: 570,
        biomech: { landingHipAngle: 145 } },
      { kind: 'jump', createdAt: '2026-02-01', heightCm: 41, flightTimeMs: 575,
        biomech: { landingHipAngle: 150 } },
    ];
    const { jump } = buildAnalysisTrend(reports);
    expect(jump.landHip.map(p => p.value)).toEqual([145, 150]);
  });

  it('RSI 리포트의 접지시간(GCT) 시계열을 추출한다', () => {
    const reports = [
      { kind: 'jump', createdAt: '2026-01-01', heightCm: 12, flightTimeMs: 300, rsi: { rsi: 1.8, contactTimeMs: 210 } },
      { kind: 'jump', createdAt: '2026-02-01', heightCm: 14, flightTimeMs: 320, rsi: { rsi: 2.1, contactTimeMs: 190 } },
    ];
    const { jump } = buildAnalysisTrend(reports);
    expect(jump.gct.map(p => p.value)).toEqual([210, 190]);
  });

  it('rsi/biomech가 없는 파워 점프 리포트는 landHip/gct가 비어있다(측정 정직성)', () => {
    const reports = [
      { kind: 'jump', createdAt: '2026-01-01', heightCm: 40, flightTimeMs: 570 },
    ];
    const { jump } = buildAnalysisTrend(reports);
    expect(jump.landHip).toEqual([]);
    expect(jump.gct).toEqual([]);
  });

  it('보행 리포트들을 케이던스/골반/무릎대칭 시계열로 만든다', () => {
    const reports = [
      { kind: 'gait', createdAt: '2026-01-10', cadence: 165, pelvicDropAbs: 3.2, kneeSymmetry: 94 },
      { kind: 'gait', createdAt: '2026-02-10', cadence: 170, pelvicDropAbs: 2.8, kneeSymmetry: 96 },
    ];
    const { gait } = buildAnalysisTrend(reports);
    expect(gait.count).toBe(2);
    expect(gait.cadence.map(p => p.value)).toEqual([165, 170]);
    expect(gait.pelvicDrop.map(p => p.value)).toEqual([3.2, 2.8]);
  });

  it('구버전 보행 데이터(metrics 중첩)도 폴백 처리', () => {
    const reports = [
      { createdAt: '2026-01-10', metrics: { cadence: 160, kneeSymmetry: 90 } },
    ];
    const { gait } = buildAnalysisTrend(reports);
    expect(gait.cadence[0].value).toBe(160);
    expect(gait.kneeSym[0].value).toBe(90);
  });

  it('빈 입력은 안전하게 0건 반환', () => {
    const { jump, gait } = buildAnalysisTrend([]);
    expect(jump.count).toBe(0);
    expect(gait.count).toBe(0);
    expect(jump.height).toEqual([]);
  });
});
