// slst_lift_detection.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] "SLST에서 한발 들어도 초시계가 작동 안 함" 현장 버그 회귀 테스트.
//
//  원인 두 가지:
//   (1) 문턱값이 화면 높이 고정 비율(liftBandFrac = 0.05)이라, 사람이 화면에
//       작게 잡히면 실제로 요구되는 들어올림 높이가 과도해졌다. 임상 SLST는
//       발을 바닥에서 살짝 떼는 검사라 쉽게 미달됐다.
//       → 다리 길이(골반~발목) 비례 문턱으로 변경.
//   (2) 들린 발목을 "양발 평균 기준선"과 비교해서, 좌우 발목 높이가 조금만
//       달라도(카메라 각도상 흔함) 그 차이가 그대로 문턱에 더해졌다.
//       → 발목별 자기 기준선(baselineAnkleYL/R) 대비로 변경.
//
//  기존 single_leg_stance_tracker.test.js 는 0.15(아주 큰 값)를 들어서 두 버그를
//  모두 지나쳤다. 이 파일은 "현실적으로 살짝 드는" 시나리오를 다룬다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  StandingCalibrator,
  SingleLegStanceTracker,
  SLST_TRACK_TUNING,
} from '../ai-measure/core/singleLegStanceTracker';

function mkLM({ hipLY = 0.5, hipRY = 0.5, ankLY = 0.9, ankRY = 0.9 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  lm[0] = { x: 0.5, y: 0.1, z: 0, visibility: 0.99 };
  lm[23] = { x: 0.45, y: hipLY, z: 0, visibility: 0.99 };
  lm[24] = { x: 0.55, y: hipRY, z: 0, visibility: 0.99 };
  lm[27] = { x: 0.45, y: ankLY, z: 0, visibility: 0.99 };
  lm[28] = { x: 0.55, y: ankRY, z: 0, visibility: 0.99 };
  return lm;
}

function calibrateWith(frameFactory) {
  const calib = new StandingCalibrator({ heightCm: 170 });
  for (let i = 0; i < 15; i++) calib.push(frameFactory());
  return calib.result;
}

// 규약 주의: 생성자의 두 번째 인자는 "지지(버티는) 다리"다. stanceLeg='left'면
// 실제로 들리는 발은 오른발(ankRY)이다 — 아래 시나리오들은 모두 오른발을 든다.

describe('SLST 문턱값 — 다리 길이에 비례한다', () => {
  it('캘리브레이션 결과에 발목별 기준선(baselineAnkleYL/R)이 들어있다', () => {
    const c = calibrateWith(() => mkLM({ ankLY: 0.88, ankRY: 0.92 }));
    expect(c.baselineAnkleYL).toBeCloseTo(0.88, 2);
    expect(c.baselineAnkleYR).toBeCloseTo(0.92, 2);
  });

  it('다리 길이 0.4(정규화)면 문턱은 약 0.024 — 기존 고정값 0.05보다 훨씬 낮다', () => {
    const c = calibrateWith(() => mkLM()); // hip 0.5, ankle 0.9 → legLen 0.4
    const tr = new SingleLegStanceTracker(c, 'left');
    expect(tr.liftBand).toBeCloseTo(0.4 * SLST_TRACK_TUNING.liftBandOfLegFrac, 3);
    expect(tr.liftBand).toBeLessThan(0.05);
  });

  it('문턱은 min/max 사이로 제한된다(다리 길이 추정이 이상해도 폭주하지 않음)', () => {
    // 다리가 비정상적으로 길게 잡힌 경우에도 상한을 넘지 않는다.
    const longLeg = calibrateWith(() => mkLM({ hipLY: 0.05, hipRY: 0.05, ankLY: 0.98, ankRY: 0.98 }));
    const tr = new SingleLegStanceTracker(longLeg, 'left');
    expect(tr.liftBand).toBeLessThanOrEqual(SLST_TRACK_TUNING.liftBandMax);
    expect(tr.liftBand).toBeGreaterThanOrEqual(SLST_TRACK_TUNING.liftBandMin);
  });

  it('내려놓음 문턱(releaseBand)은 들어올림 문턱보다 낮다(히스테리시스)', () => {
    const c = calibrateWith(() => mkLM());
    const tr = new SingleLegStanceTracker(c, 'left');
    expect(tr.releaseBand).toBeLessThan(tr.liftBand);
  });
});

describe('[회귀] 현실적으로 살짝 든 발도 유지시간이 측정된다', () => {
  // 다리 길이의 약 8%(≈0.032) — 다리 90cm 기준 대략 7cm. 임상적으로 충분히
  // "들었다"고 보는 높이지만, 기존 고정 문턱 0.05 에는 미달해 무시됐다.
  const LIFT = 0.032;

  function runHold(tr, holdMs, { base = 0.9 } = {}) {
    const step = 33;
    let t = 0;
    tr.push(mkLM(), t); t += step;          // 양발 서기
    for (let i = 0; i < Math.round(holdMs / step); i++) {
      tr.push(mkLM({ ankRY: base - LIFT }), t);
      t += step;
    }
    tr.push(mkLM({ ankRY: base }), t);      // 발 내림
    return t + step;
  }

  it('3초 유지가 시행으로 기록된다(수정 전에는 아예 감지되지 않았다)', () => {
    const c = calibrateWith(() => mkLM());
    const tr = new SingleLegStanceTracker(c, 'left');
    runHold(tr, 3000);
    const s = tr.summary();
    expect(s.trialsFound).toBeGreaterThanOrEqual(1);
    expect(s.trial1.holdTimeMs).toBeGreaterThan(2500);
  });

  it('발을 다시 딛는 순간 시행이 마감된다(stepOut)', () => {
    const c = calibrateWith(() => mkLM());
    const tr = new SingleLegStanceTracker(c, 'left');
    runHold(tr, 2000);
    expect(tr.summary().trial1.stepOut).toBe(true);
  });

  it('아주 짧게 스친 움직임(300ms)은 시행으로 잡지 않는다(오검출 방지는 유지)', () => {
    const c = calibrateWith(() => mkLM());
    const tr = new SingleLegStanceTracker(c, 'left');
    runHold(tr, 300);
    expect(tr.summary().trialsFound).toBe(0);
  });
});

describe('[회귀] 좌우 발목 높이가 다른 상태에서도 감지된다', () => {
  it('들 발목이 반대쪽보다 원래 낮게 서 있어도(4% 차이) 정상 감지된다', () => {
    // 오른 발목(0.94)이 왼 발목(0.86)보다 아래 = 양발 평균은 0.90.
    // 수정 전에는 오른발을 평균(0.90)보다 위로 올려야 해서 실제로는
    // 0.04 + 0.05 = 0.09 이상 들어야 감지됐다(사실상 불가능).
    const c = calibrateWith(() => mkLM({ ankLY: 0.86, ankRY: 0.94 }));
    const tr = new SingleLegStanceTracker(c, 'left');
    const step = 33;
    let t = 0;
    tr.push(mkLM({ ankLY: 0.86, ankRY: 0.94 }), t); t += step;
    for (let i = 0; i < 90; i++) {
      tr.push(mkLM({ ankLY: 0.86, ankRY: 0.94 - 0.032 }), t);
      t += step;
    }
    tr.push(mkLM({ ankLY: 0.86, ankRY: 0.94 }), t);
    const s = tr.summary();
    expect(s.trialsFound).toBeGreaterThanOrEqual(1);
    expect(s.trial1.holdTimeMs).toBeGreaterThan(2500);
  });

  it('구버전 calib(발목별 기준선 필드 없음)에서도 병합값으로 폴백해 동작한다', () => {
    const c = calibrateWith(() => mkLM());
    delete c.baselineAnkleYL;
    delete c.baselineAnkleYR;
    const tr = new SingleLegStanceTracker(c, 'left');
    const step = 33;
    let t = 0;
    for (let i = 0; i < 90; i++) { tr.push(mkLM({ ankRY: 0.9 - 0.04 }), t); t += step; }
    tr.push(mkLM({ ankRY: 0.9 }), t);
    expect(tr.summary().trialsFound).toBeGreaterThanOrEqual(1);
  });
});

describe('[회귀] 문턱 상수가 실제 판정 코드에 연결돼 있다', () => {
  it('제거된 liftBandFrac을 더는 참조하지 않는다(참조 시 NaN이 되어 전부 미감지)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(process.cwd(), 'src/ai-measure/core/singleLegStanceTracker.js'),
      'utf8',
    );
    // 주석 설명에는 남아 있을 수 있으나, 코드에서 tuning.liftBandFrac 을
    // 읽는 부분은 없어야 한다.
    expect(src).not.toMatch(/this\.tuning\.liftBandFrac/);
    expect(SLST_TRACK_TUNING.liftBandFrac).toBeUndefined();
  });

  it('push()가 새 문턱(liftBand/releaseBand)을 실제로 사용한다', () => {
    const c = calibrateWith(() => mkLM());
    const tr = new SingleLegStanceTracker(c, 'left');
    // 문턱 바로 아래로만 들면 감지되지 않아야 한다 — 문턱이 실제로 쓰이는 증거.
    const justBelow = tr.liftBand * 0.6;
    let t = 0;
    for (let i = 0; i < 60; i++) { tr.push(mkLM({ ankRY: 0.9 - justBelow }), t); t += 33; }
    expect(tr.summary().trialsFound).toBe(0);
    // 문턱을 확실히 넘기면 감지된다.
    const tr2 = new SingleLegStanceTracker(c, 'left');
    const above = tr2.liftBand * 1.5;
    let t2 = 0;
    for (let i = 0; i < 90; i++) { tr2.push(mkLM({ ankRY: 0.9 - above }), t2); t2 += 33; }
    tr2.push(mkLM({ ankRY: 0.9 }), t2);
    expect(tr2.summary().trialsFound).toBeGreaterThanOrEqual(1);
  });
});
