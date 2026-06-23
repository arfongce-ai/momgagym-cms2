import { describe, it, expect } from 'vitest';
import {
  RSI_TUNING, flightToHeightM, rsiGrade, computeRSIFromFlights,
} from '../ai-measure/core/reactiveJump.js';

// flights 사이클 헬퍼: takeoff/landing/다음 takeoff 타임스탬프(ms)를 직접 구성.
// landing[i] → takeoff[i+1] 간격이 곧 접지시간(GCT).
const cycle = (takeoffMs, flightMs) => ({
  takeoffMs,
  landingMs: takeoffMs + flightMs,
  flightMs,
});

describe('reactiveJump · 순수 계산', () => {
  it('flightToHeightM: h = g·t²/8', () => {
    // t=0.5s → 9.81*0.25/8 = 0.3066m
    expect(flightToHeightM(0.5)).toBeCloseTo(0.3066, 3);
    expect(flightToHeightM(0)).toBeNull();
    expect(flightToHeightM(-1)).toBeNull();
  });

  it('rsiGrade: 비율에 따른 등급', () => {
    expect(rsiGrade(3.2).label).toBe('엘리트');
    expect(rsiGrade(2.6).label).toBe('우수');
    expect(rsiGrade(2.1).label).toBe('양호');
    expect(rsiGrade(1.7).label).toBe('보통');
    expect(rsiGrade(0.9).label).toBe('개선 필요');
    expect(rsiGrade(null)).toBeNull();
    expect(rsiGrade(Infinity)).toBeNull();
  });
});

describe('computeRSIFromFlights · 유효성', () => {
  it('사이클 1회는 접지시간 측정 불가 → need_more_cycles', () => {
    const r = computeRSIFromFlights([cycle(0, 500)]);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('need_more_cycles');
  });

  it('빈 배열도 무효', () => {
    expect(computeRSIFromFlights([]).valid).toBe(false);
    expect(computeRSIFromFlights(null).valid).toBe(false);
  });

  it('정상 연속 점프: RSI = 체공/접지', () => {
    // 1차: takeoff 0, flight 480 → landing 480
    // 접지 200ms 후 2차 takeoff 680, flight 500
    const flights = [cycle(0, 480), cycle(680, 500)];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.cycles).toBe(1);
    expect(r.contactTimeMs).toBe(200);           // 680 - 480
    expect(r.flightTimeMs).toBe(500);            // 후속 점프 체공
    // RSI = 0.5 / 0.2 = 2.5
    expect(r.rsi).toBeCloseTo(2.5, 1);
    expect(r.grade.label).toBe('우수');
    expect(r.lowFps).toBe(false);
  });

  it('접지시간이 sanity 범위 밖이면 해당 사이클 제외', () => {
    // 접지 1200ms(>maxContactMs 800) → 멈춤으로 간주, 제외
    const flights = [cycle(0, 480), cycle(1680, 500)];
    const r = computeRSIFromFlights(flights);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('no_valid_contact');
  });

  it('30fps(프레임 간격 33ms)면 lowFps 경고', () => {
    const flights = [cycle(0, 480), cycle(680, 500)];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 33 });
    expect(r.valid).toBe(true);
    expect(r.lowFps).toBe(true);
  });

  it('240fps(4ms)면 lowFps 없음', () => {
    const flights = [cycle(0, 480), cycle(680, 500)];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.lowFps).toBe(false);
  });

  it('여러 사이클: 변동(CV) 크면 평균을 대표값으로 (과대평가 방지)', () => {
    // 3회 점프 → 2개 접지 구간
    // 사이클1: 접지 200ms, 후속체공 500 → RSI 2.5
    // 사이클2: 접지 250ms, 후속체공 450 → RSI 1.8
    // 두 값 차이가 커 CV>15% → 대표값(rsi)은 평균, rsiBest 는 최고값
    const flights = [
      cycle(0, 480),
      cycle(680, 500),    // landing[0]=480 → takeoff[1]=680 : GCT 200
      cycle(1430, 450),   // landing[1]=1180 → takeoff[2]=1430 : GCT 250
    ];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.cycles).toBe(2);
    expect(r.rsiBest).toBeCloseTo(2.5, 1);   // 최고는 보조로 보존
    expect(r.cvPct).toBeGreaterThan(15);     // 변동 큼
    expect(r.rsiBasis).toBe('mean');         // → 대표값은 평균
    expect(r.rsi).toBeCloseTo(r.rsiMean, 2);
    expect(r.rsiMean).toBeGreaterThan(1.5);
    expect(r.rsiMean).toBeLessThan(2.5);
    expect(r.perCycle).toHaveLength(2);
  });

  it('사이클이 안정적이면(CV 작음) 최고값을 대표값으로', () => {
    // 두 사이클 RSI 가 거의 같음 → CV 작음 → rsiBasis='best'
    const flights = [
      cycle(0, 500),
      cycle(700, 500),    // GCT 200, 후속체공 500 → RSI 2.5
      cycle(1410, 510),   // GCT 210, 후속체공 510 → RSI ≈ 2.43
    ];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.cvPct).toBeLessThanOrEqual(15);
    expect(r.rsiBasis).toBe('best');
    expect(r.rsi).toBeCloseTo(r.rsiBest, 2);
  });

  it('측면(side)이 아니면 RSI 측정 거부 — not_side_view', () => {
    const flights = [cycle(0, 480), cycle(680, 500)];
    expect(computeRSIFromFlights(flights, { view: 'back' }).reason).toBe('not_side_view');
    expect(computeRSIFromFlights(flights, { view: 'front' }).reason).toBe('not_side_view');
    expect(computeRSIFromFlights(flights, { view: 'unknown' }).reason).toBe('not_side_view');
    // 측면이면 정상 통과
    expect(computeRSIFromFlights(flights, { view: 'side', frameIntervalMs: 4 }).valid).toBe(true);
    // view 미전달 시 하위호환(가드 건너뜀)
    expect(computeRSIFromFlights(flights, { frameIntervalMs: 4 }).valid).toBe(true);
  });

  it('순서가 뒤섞여도 takeoffMs 기준 정렬 후 계산', () => {
    const flights = [cycle(680, 500), cycle(0, 480)];
    const r = computeRSIFromFlights(flights, { frameIntervalMs: 4 });
    expect(r.valid).toBe(true);
    expect(r.contactTimeMs).toBe(200);
  });
});
