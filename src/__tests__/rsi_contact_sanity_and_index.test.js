// rsi_contact_sanity_and_index.test.js
// ════════════════════════════════════════════════════════════════════════
//  "RSI가 제대로 뜨지 않습니다(16.7, 20.2 같은 비정상 값)" 실사용 리포트에
//  대한 회귀 테스트.
//
//  근본 원인 (JumpPrecisionAnalysis.jsx, 라이브 카드·게이지·녹화 번인 경로):
//   buildRsiCyclePreview()가 reactiveJump.js의 computeRSIFromFlights()와
//   똑같은 "착지→다음 이지 사이 접지시간으로 RSI 산출" 계산을 하면서,
//   접지시간 유효 범위 검증(RSI_TUNING.minContactMs~maxContactMs, 80~800ms)
//   만 빠져 있었다. 포즈 인식이 착지를 순간적으로(예: 20~30ms) 잘못 잡으면
//   분모가 극단적으로 작아져 RSI(=체공/접지)가 10~20대로 튀었다.
//
//  검증 도중 발견된 2차 문제: sanity check를 단순히 "continue로 건너뛰기"
//  방식으로만 추가하면, 무효 구간이 배열에서 통째로 빠지면서 이후 사이클이
//  전부 한 칸씩 밀린다(index shift) — "#3 점프 카드"에 실제로는 "#4 점프"의
//  RSI·접지시간이 표시되는 식. computeRSIFromFlights도 원래 이 패턴이었다.
//  → 무효 구간은 배열에서 빼지 않고 null로 자리를 채워, "flights[i]→[i+1]
//  사이의 사이클"이라는 인덱스 의미를 항상 보존하도록 고쳤다
//  (reactiveJump.js: perCycleByIndex, JumpPrecisionAnalysis.jsx: buildRsiCyclePreview).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeRSIFromFlights, RSI_TUNING } from '../ai-measure/core/reactiveJump';

const jumpSrc = readFileSync(join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'), 'utf8');

describe('reactiveJump.computeRSIFromFlights — 접지시간 sanity check + 인덱스 보존', () => {
  it('노이즈성으로 극단적으로 짧은 접지 구간(30ms)은 무효로 걸러진다(80ms 미만)', () => {
    const flights = [
      { takeoffMs: 0, landingMs: 400, flightMs: 400 },
      { takeoffMs: 430, landingMs: 830, flightMs: 400 }, // 1→2 접지 30ms(무효, <80ms)
      { takeoffMs: 1200, landingMs: 1600, flightMs: 400 }, // 2→3 접지 370ms(정상)
      { takeoffMs: 1900, landingMs: 2300, flightMs: 400 }, // 3→4 접지 300ms(정상)
    ];
    const r = computeRSIFromFlights(flights, { view: 'side' });
    expect(r.valid).toBe(true);
    // 통계용 perCycle에는 무효 구간이 아예 없어야 한다(기존 동작 유지).
    expect(r.perCycle.length).toBe(2);
    expect(r.perCycle.every((c) => c.contactMs >= RSI_TUNING.minContactMs)).toBe(true);
    // 대표 RSI가 30ms발 극단값(400/30≈13.3)일 수 없다 — 정상 범위(≤5 정도)여야 한다.
    expect(r.rsi).toBeLessThan(5);
  });

  it('perCycleByIndex는 무효 구간을 null로 채워 "flights[i]→[i+1]" 위치 의미를 보존한다', () => {
    const flights = [
      { takeoffMs: 0, landingMs: 400, flightMs: 400 },
      { takeoffMs: 430, landingMs: 830, flightMs: 400 }, // idx0: 1→2, 30ms(무효)
      { takeoffMs: 1200, landingMs: 1600, flightMs: 400 }, // idx1: 2→3, 370ms(정상)
      { takeoffMs: 1900, landingMs: 2300, flightMs: 400 }, // idx2: 3→4, 300ms(정상)
    ];
    const r = computeRSIFromFlights(flights, { view: 'side' });
    expect(r.perCycleByIndex).toHaveLength(flights.length - 1); // 항상 flights.length-1
    expect(r.perCycleByIndex[0]).toBeNull(); // 1→2(무효) 자리는 비워짐(스킵되어 당겨지지 않음)
    expect(r.perCycleByIndex[1]?.contactMs).toBe(370); // 2→3
    expect(r.perCycleByIndex[2]?.contactMs).toBe(300); // 3→4
  });

  it('회귀 재현: null 자리채움 없이 그냥 건너뛰면(예전 버그 패턴) 카드 번호가 밀린다', () => {
    // computeRSIFromFlights와 별개로, "continue로만 거르는" 예전 버그 패턴을
    // 그대로 재현해 실제로 인덱스가 밀리는지 확인한다(고정 회귀 스냅샷).
    function buggyCycles(flights) {
      const cycles = [];
      const sorted = [...flights].sort((a, b) => a.takeoffMs - b.takeoffMs);
      for (let i = 0; i < sorted.length - 1; i++) {
        const contactMs = sorted[i + 1].takeoffMs - sorted[i].landingMs;
        const inRange = contactMs >= RSI_TUNING.minContactMs && contactMs <= RSI_TUNING.maxContactMs;
        if (!inRange) continue; // 예전 버그: 그냥 건너뜀 → 인덱스 밀림
        cycles.push({ contactMs });
      }
      return cycles;
    }
    const flights = [
      { takeoffMs: 0, landingMs: 400, flightMs: 400 },
      { takeoffMs: 430, landingMs: 830, flightMs: 400 },
      { takeoffMs: 1200, landingMs: 1600, flightMs: 400 },
      { takeoffMs: 1900, landingMs: 2300, flightMs: 400 },
    ];
    const buggy = buggyCycles(flights);
    // 예전 버그판은 길이가 2(무효 1개가 통째로 빠짐) — 정상판(perCycleByIndex)의 길이 3과 달라야 한다.
    expect(buggy.length).toBe(2);
    const r = computeRSIFromFlights(flights, { view: 'side' });
    expect(r.perCycleByIndex.length).not.toBe(buggy.length);
    // 예전 버그판에서 "3번째 점프(no=3)" 카드가 참조할 buggy[3-1-1]=buggy[1]은 실제로
    // 3→4 사이(300ms) 값인데, 이는 2→3 사이(370ms)여야 정상이다 — 어긋남 확인.
    expect(buggy[1].contactMs).toBe(300); // 잘못 밀려서 들어간 값
    expect(r.perCycleByIndex[1].contactMs).toBe(370); // 수정판은 올바른 위치(idx1=2→3)
  });

  it('접지 3회 미만이면(사이클 부족) 여전히 무효 처리된다(회귀 없음)', () => {
    const flights = [
      { takeoffMs: 0, landingMs: 400, flightMs: 400 },
      { takeoffMs: 700, landingMs: 1100, flightMs: 400 },
    ];
    const r = computeRSIFromFlights(flights, { view: 'side' });
    expect(r.valid).toBe(false);
  });
});

describe('JumpPrecisionAnalysis.jsx — buildRsiCyclePreview(라이브 미리보기)도 동일한 sanity check를 쓴다', () => {
  it('RSI_TUNING을 reactiveJump에서 가져와 재사용한다(중복 상수 아님)', () => {
    expect(jumpSrc).toMatch(/import\s*{\s*computeRSIFromFlights,\s*rsiGrade,\s*RSI_TUNING\s*}\s*from\s*['"]\.\.\/core\/reactiveJump['"]/);
  });

  it('buildRsiCyclePreview 안에서 RSI_TUNING.minContactMs/maxContactMs 범위를 실제로 검사한다', () => {
    const idx = jumpSrc.indexOf('function buildRsiCyclePreview');
    expect(idx).toBeGreaterThan(-1);
    const body = jumpSrc.slice(idx, jumpSrc.indexOf('\n}', idx));
    expect(body).toMatch(/RSI_TUNING\.minContactMs/);
    expect(body).toMatch(/RSI_TUNING\.maxContactMs/);
    // 무효 구간은 그냥 continue 하지 않고 null 자리채움 후 continue — 인덱스 보존.
    expect(body).toMatch(/cycles\.push\(null\)/);
  });

  it('finishMeasure의 perJump 계산은 perCycle이 아니라 perCycleByIndex(인덱스 보존판)를 우선 사용한다', () => {
    expect(jumpSrc).toMatch(/allFlightRows\(tracker\.flights,\s*rsiResult\?\.perCycleByIndex\s*\|\|\s*liveCyclePreview\)/);
    // 예전처럼 perCycle을 직접 쓰는 폴백은 남아있으면 안 된다(인덱스 밀림 재도입 방지).
    expect(jumpSrc).not.toMatch(/allFlightRows\(tracker\.flights,\s*rsiResult\?\.perCycle\s*\|\|/);
  });
});
