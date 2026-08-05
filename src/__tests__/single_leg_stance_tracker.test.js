import { describe, expect, it } from 'vitest';
import { StandingCalibrator, SingleLegStanceTracker } from '../ai-measure/core/singleLegStanceTracker';
import { evaluateSingleLegStance } from '../ai-measure/core/singleLegStance';

function mkLM({ hipLY = 0.5, hipRY = 0.5, hipLX = 0.45, hipRX = 0.55, ankLY = 0.9, ankRY = 0.9 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  lm[0] = { x: 0.5, y: 0.1, z: 0, visibility: 0.99 };
  lm[23] = { x: hipLX, y: hipLY, z: 0, visibility: 0.99 };
  lm[24] = { x: hipRX, y: hipRY, z: 0, visibility: 0.99 };
  lm[27] = { x: 0.45, y: ankLY, z: 0, visibility: 0.99 };
  lm[28] = { x: 0.55, y: ankRY, z: 0, visibility: 0.99 };
  return lm;
}

function calibrate(heightCm = 170) {
  const calib = new StandingCalibrator({ heightCm });
  for (let i = 0; i < 15; i++) calib.push(mkLM());
  return calib;
}

// 유지 구간을 편하게 밀어넣는 헬퍼. holds(ms) 만큼 오른발을 들고 있다가 내림.
function pushHold(tr, t, holdMs, { sway = false } = {}) {
  const step = 33;
  const steps = Math.round(holdMs / step);
  const baseline = tr.calib.baselineFeetY;
  for (let i = 0; i < steps; i++) {
    const swayOffset = sway ? Math.sin(i / 10) * 0.005 : 0;
    tr.push(mkLM({ ankRY: baseline - 0.15, hipLX: 0.45 + swayOffset, hipRX: 0.55 + swayOffset }), t);
    t += step;
  }
  tr.push(mkLM({ ankRY: baseline }), t); // 발 내림
  t += step;
  return t;
}

// pushHold은 항상 발을 다시 내리는 프레임으로 끝나므로(stepOut:true 시나리오 전용),
// "목표 시간까지 잘 버텨서 트레이너가 정상 종료시킨" 시나리오는 별도 헬퍼로 구분한다.
function pushSuccessfulHold(tr, t, holdMs) {
  const step = 33;
  const steps = Math.round(holdMs / step);
  const baseline = tr.calib.baselineFeetY;
  for (let i = 0; i < steps; i++) {
    tr.push(mkLM({ ankRY: baseline - 0.15 }), t);
    t += step;
  }
  tr.stopManually(t);
  return t;
}

describe('SingleLegStanceTracker (synthetic landmark check)', () => {
  it('1) 정상 완주: 3초 유지 후 수동 종료', () => {
    const calib = calibrate();
    expect(calib.locked).toBe(true);
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = 0;
    tr.push(mkLM(), t); t += 33;
    tr.push(mkLM(), t); t += 33;
    const baseline = calib.result.baselineFeetY;
    for (let i = 0; i < 90; i++) {
      const sway = Math.sin(i / 10) * 0.005;
      tr.push(mkLM({ ankRY: baseline - 0.15, hipLX: 0.45 + sway, hipRX: 0.55 + sway }), t);
      t += 33;
    }
    tr.stopManually(t);
    const s = tr.summary();
    expect(s.trial1.valid).toBe(true);
    expect(s.trial1.stepOut).toBe(false);
    expect(s.trial1.balanceLoss).toBe(false);
    expect(s.trial1.holdTimeMs).toBeGreaterThan(2900);
    expect(s.trial1.holdTimeMs).toBeLessThan(3100);
    expect(s.trial2).toBeUndefined();
  });

  it('2) 조기 스텝아웃: 금방 발을 다시 내림', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = pushHold(tr, 0, 700);
    const s = tr.summary();
    expect(s.trial1.valid).toBe(true);
    expect(s.trial1.stepOut).toBe(true);
  });

  it('3) 균형상실 추정: 유지 중 골반이 급격히 튐', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = 0;
    tr.push(mkLM(), t); t += 33;
    const baseline = calib.result.baselineFeetY;
    for (let i = 0; i < 10; i++) { tr.push(mkLM({ ankRY: baseline - 0.15 }), t); t += 33; }
    tr.push(mkLM({ ankRY: baseline - 0.15, hipLX: 0.9, hipRX: 1.0 }), t); t += 33;
    for (let i = 0; i < 10; i++) { tr.push(mkLM({ ankRY: baseline - 0.15 }), t); t += 33; }
    tr.stopManually(t);
    const s = tr.summary();
    expect(s.trial1.balanceLoss).toBe(true);
  });

  it('4) 아예 들지 않음 -> trial1/trial2 모두 없음', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = 0;
    for (let i = 0; i < 30; i++) { tr.push(mkLM(), t); t += 33; }
    const s = tr.summary();
    expect(s.trial1).toBeUndefined();
    expect(s.trialsFound).toBe(0);
  });

  it('5) 너무 짧게 들었다 내리면 조용히 버리고 다음 시행을 기다린다', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = 0;
    const baseline = calib.result.baselineFeetY;
    // 아주 짧은 블립(노이즈) - minHoldForValidMs=500ms 미만
    tr.push(mkLM({ ankRY: baseline - 0.15 }), t); t += 33;
    tr.push(mkLM({ ankRY: baseline }), t); t += 33;
    // 이어서 진짜 시행(1.5초)
    t = pushHold(tr, t, 1500);
    const s = tr.summary();
    expect(s.trialsFound).toBe(1); // 블립은 카운트 안 됨
    expect(s.trial1.holdTimeMs).toBeGreaterThan(1400);
  });

  it('6) 스트림이 holding 도중 끝남(finalize) -> valid, stepOut=false', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = 0;
    const baseline = calib.result.baselineFeetY;
    for (let i = 0; i < 60; i++) { tr.push(mkLM({ ankRY: baseline - 0.15 }), t); t += 33; }
    tr.finalize(t);
    const s = tr.summary();
    expect(s.trial1.valid).toBe(true);
    expect(s.trial1.stepOut).toBe(false);
  });

  it('7) 시행 요약에는 흔들림(sway) 관련 필드가 전혀 없다(2026-08-02 판정에서 제외)', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = pushHold(tr, 0, 1000, { sway: true });
    const s = tr.summary();
    expect(s.trial1.swayPathCm).toBeUndefined();
    expect(s.trial1.swayPathNorm).toBeUndefined();
    // 유지시간·균형상실 등 나머지 필드는 그대로 채워져야 한다.
    expect(s.trial1.holdTimeMs).toBeGreaterThan(900);
  });

  it('8) 한 영상 안에서 연속 2회 시행 -> trial1, trial2 둘 다 채워짐', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = pushHold(tr, 0, 3000, { sway: true });     // 1차: 3초
    t += 500;                                           // 시행 사이 휴식
    t = pushHold(tr, t, 2500, { sway: true });          // 2차: 2.5초
    const s = tr.summary();
    expect(s.trialsFound).toBe(2);
    expect(s.trial1.holdTimeMs).toBeGreaterThan(2900);
    expect(s.trial2.holdTimeMs).toBeGreaterThan(2400);
    expect(s.trial2.holdTimeMs).toBeLessThan(2600);
  });

  it('9) maxTrials(기본 2) 도달 후 3번째 시행은 무시된다', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = pushHold(tr, 0, 1000);
    t += 300;
    t = pushHold(tr, t, 1000);
    t += 300;
    t = pushHold(tr, t, 1000); // 3번째 - 무시되어야 함
    const s = tr.summary();
    expect(s.trialsFound).toBe(2);
  });

  it('10) 추적기 출력이 evaluateSingleLegStance에 바로 연결된다(end-to-end)', () => {
    // singleLegStance.js의 cautionHoldMs(20s) 기준을 넘겨야 '정상'으로 확정되므로
    // 실제 임상 목표에 맞춰 21초로 시뮬레이션(3초짜리는 즉시 '주의'로 잡히는 게 맞는 동작).
    const calib = calibrate();
    const trLeft = new SingleLegStanceTracker(calib.result, 'left');
    let t = pushSuccessfulHold(trLeft, 0, 21000);
    t += 500;
    pushSuccessfulHold(trLeft, t, 21000);
    const leftSummary = trLeft.summary();

    const report = evaluateSingleLegStance({ left: leftSummary });
    expect(report.valid).toBe(true);
    expect(report.left.status).toBe('normal');
  });

  it('11) 추적기 출력이 판정 모듈의 즉시확정(균형상실) 경로와도 연결된다(end-to-end)', () => {
    const calib = calibrate();
    const trRight = new SingleLegStanceTracker(calib.result, 'right');
    let t = 0;
    const baseline = calib.result.baselineFeetY;
    for (let i = 0; i < 10; i++) { trRight.push(mkLM({ ankLY: baseline - 0.15 }), t); t += 33; }
    trRight.push(mkLM({ ankLY: baseline - 0.15, hipLX: 0.9, hipRX: 1.0 }), t); t += 33;
    for (let i = 0; i < 400; i++) { trRight.push(mkLM({ ankLY: baseline - 0.15 }), t); t += 33; }
    trRight.stopManually(t);
    const rightSummary = trRight.summary();

    const report = evaluateSingleLegStance({ right: rightSummary });
    expect(report.valid).toBe(true);
    expect(report.right.status).toBe('risk');
    expect(report.right.basis).toBe('immediate');
  });

  it('12) elapsedHoldMs로 유지 중 경과시간을 조회할 수 있다(라이브 화면용)', () => {
    const calib = calibrate();
    const tr = new SingleLegStanceTracker(calib.result, 'left');
    let t = 0;
    tr.push(mkLM(), t); t += 33;
    const baseline = calib.result.baselineFeetY;
    tr.push(mkLM({ ankRY: baseline - 0.15 }), t);
    t += 1500;
    tr.push(mkLM({ ankRY: baseline - 0.15 }), t);
    expect(tr.elapsedHoldMs(t)).toBeGreaterThanOrEqual(1490);
    expect(tr.elapsedHoldMs(t)).toBeLessThanOrEqual(1510);
    tr.stopManually(t);
    expect(tr.elapsedHoldMs(t + 1000)).toBe(0);
  });
});
