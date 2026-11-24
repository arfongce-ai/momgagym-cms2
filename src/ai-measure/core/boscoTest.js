// ai-measure/core/boscoTest.js
// [2026-11-24] 보스코 파워지구력 점프(60초 연속 반동점프) 요약. 순수 함수.
//  · 교재 실습 12.4(Haff & Dumke p.342~343): 15·30·60초 점프 수와 총 체공시간으로 기계적 파워(W/kg)를 구한다.
//  · 폰 영상의 체공시간 합계로 계산한 참고값이다. 연속 60초 구간에서 폰 영상이 체공시간을 얼마나 정확히 잡는지는 검증된 자료를 찾지 못했다.
//  · 시작 시각은 첫 도약(이륙) 시점으로 본다. 교재는 "점프" 신호부터 재지만, 첫 접지 시간 차이는 60초 대비 작다.
//  · 구간 길이를 못 채우면(끝 시각이 구간보다 1.5초 넘게 모자라면) 그 구간 파워는 계산하지 않는다(0으로 만들지 않는다).
import { boscoMechanicalPower, boscoPercentile } from './jumpPower';

export const BOSCO_WINDOWS_SEC = [15, 30, 60];
const TOLERANCE_SEC = 1.5; // 마지막 착지가 구간 끝에서 이만큼까지 모자라도 채운 것으로 본다(점프 한 사이클 정도)
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;

// flights: JumpFlightTracker.flights → [{ takeoffMs, landingMs, flightMs }]
export function buildBoscoSummary(flights, { sex = null, windowsSec = BOSCO_WINDOWS_SEC } = {}) {
  const fl = (Array.isArray(flights) ? flights : [])
    .filter((f) => f && Number.isFinite(f.takeoffMs) && Number.isFinite(f.landingMs) && f.landingMs > f.takeoffMs)
    .sort((a, b) => a.takeoffMs - b.takeoffMs);
  if (!fl.length) return null;
  const startMs = fl[0].takeoffMs;
  const lastMs = fl[fl.length - 1].landingMs;
  const elapsedSec = (lastMs - startMs) / 1000;
  const intervals = windowsSec.map((sec) => {
    const endMs = startMs + sec * 1000;
    const inWin = fl.filter((f) => f.landingMs <= endMs);
    const flightTotalSec = inWin.reduce((a, f) => a + (f.landingMs - f.takeoffMs), 0) / 1000;
    const complete = elapsedSec >= sec - TOLERANCE_SEC;
    return {
      sec,
      jumps: inWin.length,
      flightTotalSec: r3(flightTotalSec),
      complete,
      powerWPerKg: complete ? boscoMechanicalPower(flightTotalSec, inWin.length, sec) : null,
    };
  });
  const main = intervals.find((i) => i.sec === Math.max(...windowsSec)) || intervals[intervals.length - 1];
  let percentile = null; let percentileBelow = false;
  if (main?.powerWPerKg != null && sex) {
    const p = boscoPercentile(sex, main.powerWPerKg);
    if (p) { percentile = p.percentile; percentileBelow = p.below; }
  }
  return {
    windowSec: main.sec,
    jumps: main.jumps,
    flightTotalSec: main.flightTotalSec,
    powerWPerKg: main.powerWPerKg,
    complete: main.complete,
    percentile,
    percentileBelow,
    sexUsed: sex || null,
    elapsedSec: r1(elapsedSec),
    intervals,
    basis: 'book-formula',
  };
}
