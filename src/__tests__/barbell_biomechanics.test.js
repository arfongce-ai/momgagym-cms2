// src/__tests__/barbell_biomechanics.test.js
// ════════════════════════════════════════════════════════════════════════
//  실시간 바벨 생체역학 엔진(barbellBiomechanics) 테스트.
//  점프/보행 테스트와 동일 철학: 합성 궤적으로 렙 분절·속도·정직성 게이트 검증.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  BarbellAccumulator, BARBELL_TUNING,
  smoothedPeakRatioPerSec, velocityToPct1Rm, estimateOneRmFromMeanVelocity,
} from '../ai-measure/core/barbellBiomechanics';
import { generateLiftingDiagnosis, relativeStrengthLevel, velocityLossInterpretation } from '../ai-measure/core/barbellClinical';

// ── 합성 궤적 생성기: 30fps, 시작 y0 에서 하강 amp → 상승 amp 를 reps 회 ──
//  speedScale <1 이면 상승이 빨라짐(속도↑), repSlow 배열로 렙별 감속 지정 가능.
function pushSquatSet(acc, {
  reps = 3, amp = 0.25, y0 = 0.4, fps = 30,
  downSec = 1.0, upSecs = null, drift = 0,
} = {}) {
  let t = 0;
  const dt = 1000 / fps;
  const push = (y, x = 0.5) => { acc.push({ x, y }, t); t += dt; };
  // 정지 0.3s
  for (let i = 0; i < fps * 0.3; i++) push(y0);
  for (let r = 0; r < reps; r++) {
    const upSec = upSecs ? upSecs[r] : 0.8;
    const nDown = Math.round(fps * downSec);
    const nUp = Math.round(fps * upSec);
    for (let i = 1; i <= nDown; i++) push(y0 + amp * (i / nDown));           // 하강
    for (let i = 1; i <= nUp; i++) {
      const frac = i / nUp;
      push(y0 + amp * (1 - frac), 0.5 + drift * Math.sin(Math.PI * frac));   // 상승(+수평 드리프트)
    }
    for (let i = 0; i < fps * 0.2; i++) push(y0);                            // 렙 사이 정지
  }
  return t;
}

describe('BarbellAccumulator · 실시간 렙 분절', () => {
  it('스쿼트 3회(하강→상승)를 정확히 3렙으로 센다', () => {
    const acc = new BarbellAccumulator();
    pushSquatSet(acc, { reps: 3 });
    const s = acc.summary({ cmPerRatio: 170, source: 'live' });
    expect(s.valid).toBe(true);
    expect(s.repCount).toBe(3);
    expect(s.reps).toHaveLength(3);
  });

  it('데드리프트(상승 먼저)도 상승 구간을 렙으로 센다 — 반전 없이 끝나도 finish 로 반영', () => {
    const acc = new BarbellAccumulator();
    let t = 0; const dt = 1000 / 30;
    const push = (y) => { acc.push({ x: 0.5, y }, t); t += dt; };
    for (let i = 0; i < 9; i++) push(0.7);                       // 바닥 정지
    for (let i = 1; i <= 30; i++) push(0.7 - 0.25 * (i / 30));   // 1초 상승 후 종료
    const s = acc.summary({ cmPerRatio: 170, source: 'live' });
    expect(s.valid).toBe(true);
    expect(s.repCount).toBe(1);
  });

  it('미세 떨림(노이즈)만 있는 데이터는 렙 0 + rom_too_small 로 거부(정직성)', () => {
    const acc = new BarbellAccumulator();
    let t = 0;
    for (let i = 0; i < 90; i++) { acc.push({ x: 0.5, y: 0.5 + Math.sin(i) * 0.004 }, t); t += 33; }
    const s = acc.summary({ cmPerRatio: 170 });
    expect(s.valid).toBe(false);
    expect(s.reason).toBe('rom_too_small');
  });

  it('샘플이 거의 없으면 insufficient_samples 로 거부', () => {
    const acc = new BarbellAccumulator();
    acc.push({ x: 0.5, y: 0.5 }, 0);
    acc.push({ x: 0.5, y: 0.4 }, 33);
    const s = acc.summary({ cmPerRatio: 170 });
    expect(s.valid).toBe(false);
    expect(s.reason).toBe('insufficient_samples');
  });
});

describe('BarbellAccumulator · 실시간 속도(컨센트릭 기준)', () => {
  it('평균속도 = 상승 변위 ÷ 상승 시간(하강·정지 미포함) — 물리값과 근사', () => {
    const acc = new BarbellAccumulator();
    // 상승 0.8s, amp 0.25 비율, 키 스케일 170cm/비율 → 42.5cm/0.8s ≈ 0.53m/s
    pushSquatSet(acc, { reps: 2, amp: 0.25, upSecs: [0.8, 0.8] });
    const s = acc.summary({ cmPerRatio: 170, source: 'live' });
    expect(s.meanVelocity).toBeGreaterThan(0.4);
    expect(s.meanVelocity).toBeLessThan(0.65);
  });

  it('마지막 렙이 느려지면 velocityLossPct 가 양수로 잡힌다(실시간 피로 지표)', () => {
    const acc = new BarbellAccumulator();
    pushSquatSet(acc, { reps: 3, upSecs: [0.6, 0.8, 1.2] }); // 점점 감속
    const s = acc.summary({ cmPerRatio: 170 });
    expect(s.velocityLossPct).toBeGreaterThan(15);
    expect(s.repVelocityCompat.summary.velocityLossPct).toBe(s.velocityLossPct);
  });

  it('키 미입력(스케일 없음)이면 m/s 값 대신 no_calibration — 그럴듯한 가짜값 금지', () => {
    const acc = new BarbellAccumulator();
    pushSquatSet(acc, { reps: 2 });
    const s = acc.summary({ cmPerRatio: null });
    expect(s.valid).toBe(true);
    expect(s.meanVelocity).toBeNull();
    expect(s.peakVelocity).toBeNull();
    expect(s.peakReason).toBe('no_calibration');
  });
});

describe('실시간 평활 피크속도(정직성 게이트)', () => {
  it('충분한 샘플(30fps·0.8s 상승)이면 sg_ok 로 피크 산출 — 평균 이상, 물리 상한 이하', () => {
    const acc = new BarbellAccumulator();
    pushSquatSet(acc, { reps: 2, upSecs: [0.8, 0.8] });
    const s = acc.summary({ cmPerRatio: 170 });
    expect(s.peakReason).toBe('sg_ok');
    expect(s.peakVelocity).toBeGreaterThanOrEqual(s.meanVelocity);
    expect(s.peakVelocity).toBeLessThan(3);
  });

  it('상승 샘플 밀도가 기준 미만이면 피크 산출 거부(insufficient_samples)', () => {
    const pts = [];
    for (let i = 0; i < 4; i++) pts.push({ x: 0.5, y: 0.6 - i * 0.08, ts: i * 33 });
    const r = smoothedPeakRatioPerSec(pts);
    expect(r.peakRatioPerSec).toBeNull();
    expect(r.quality).toBe('insufficient_samples');
  });

  it('튜닝 상수는 한 곳(BARBELL_TUNING)에 모여 있다', () => {
    expect(BARBELL_TUNING.peakMinSamples).toBeGreaterThan(BARBELL_TUNING.peakWindow * 2);
    expect(BARBELL_TUNING.minRepRomRatio).toBeGreaterThan(0);
  });
});

describe('바 궤적(드리프트/효율) — 역도 평가 근거', () => {
  it('수직 상승은 드리프트≈0·효율≈100%, 수평 이탈을 주면 드리프트가 잡힌다', () => {
    const clean = new BarbellAccumulator();
    pushSquatSet(clean, { reps: 2, drift: 0 });
    const sClean = clean.summary({ cmPerRatio: 170 });
    expect(sClean.barPath.maxDriftCm).toBeLessThan(2);
    expect(sClean.barPath.avgEfficiency).toBeGreaterThan(0.9);

    const drifty = new BarbellAccumulator();
    pushSquatSet(drifty, { reps: 2, drift: 0.08 }); // 화면 8% 수평 이탈
    const sDrift = drifty.summary({ cmPerRatio: 170 });
    expect(sDrift.barPath.maxDriftCm).toBeGreaterThan(sClean.barPath.maxDriftCm + 5);
  });
});

describe('속도 기반 1RM 실시간 추정(근거 테이블)', () => {
  it('벤치 0.42m/s ≈ 80% → 100kg 세트면 e1RM ≈ 125kg', () => {
    const pct = velocityToPct1Rm('bench_press', 0.42);
    expect(pct).toBe(80);
    const est = estimateOneRmFromMeanVelocity({ exerciseType: 'bench_press', loadKg: 100, meanVelocity: 0.42 });
    expect(est.oneRm).toBe(125);
    expect(est.reason).toBe('ok');
  });

  it('테이블 범위 밖 속도는 외삽하지 않고 거부(velocity_out_of_range)', () => {
    const est = estimateOneRmFromMeanVelocity({ exerciseType: 'squat', loadKg: 100, meanVelocity: 2.5 });
    expect(est.oneRm).toBeNull();
    expect(est.reason).toBe('velocity_out_of_range');
  });

  it('올림픽 리프트 등 미지원 종목은 unsupported_exercise', () => {
    const est = estimateOneRmFromMeanVelocity({ exerciseType: 'snatch', loadKg: 80, meanVelocity: 1.0 });
    expect(est.reason).toBe('unsupported_exercise');
  });

  it('데드리프트는 신뢰도 low 로 표기(연구 편차 — 정직성)', () => {
    const est = estimateOneRmFromMeanVelocity({ exerciseType: 'deadlift', loadKg: 140, meanVelocity: 0.48 });
    expect(est.confidence).toBe('low');
    expect(est.oneRm).toBeGreaterThan(140);
  });
});

describe('barbellClinical · AI 자동 평가', () => {
  it('데이터 부족이면 평가 보류(insufficient) — 가짜 결론 금지', () => {
    const d = generateLiftingDiagnosis({ mode: 'vbt', metrics: {} });
    expect(d.grade).toBe('insufficient');
    expect(d.flags).toContain('insufficient_data');
  });

  it('VBT: 존/속도저하/일관성을 근거로 평가한다', () => {
    const d = generateLiftingDiagnosis({
      mode: 'vbt', exerciseType: 'squat',
      metrics: { meanVelocity: 0.62, velocityLoss: 35, confidenceScore: 0.9 },
      consistencyCvPct: 4,
    });
    expect(d.flags).toContain('high_velocity_loss');
    expect(d.details.join(' ')).toContain('속도저하 35%');
  });

  it('역도: 큰 바 드리프트는 needs_work 로 강등', () => {
    const d = generateLiftingDiagnosis({
      mode: 'lifting', exerciseType: 'clean',
      metrics: { meanVelocity: 1.1, confidenceScore: 0.9 },
      barPath: { maxDriftCm: 12, avgEfficiency: 0.7 },
    });
    expect(d.grade).toBe('needs_work');
    expect(d.flags).toContain('large_bar_drift');
  });

  it('1RM: 속도 교차검증이 크게 어긋나면 플래그', () => {
    const d = generateLiftingDiagnosis({
      mode: 'onerm', exerciseType: 'squat',
      metrics: { oneRM: 100, confidenceScore: 0.9 },
      metadata: { reps: 5, velocityCheck: { oneRm: 130 } },
    });
    expect(d.flags).toContain('velocity_formula_mismatch');
  });

  it('상대근력 수준 — 체중 없으면 null(추정 금지), 있으면 등급', () => {
    expect(relativeStrengthLevel('squat', 150, null)).toBeNull();
    const rel = relativeStrengthLevel('squat', 150, 80);
    expect(rel.ratio).toBe(1.88);
    expect(rel.level).toBe('상급');
  });

  it('속도저하 해석 밴드(Pareja-Blanco 근거)', () => {
    expect(velocityLossInterpretation(8).band).toBe('fresh');
    expect(velocityLossInterpretation(18).band).toBe('strength');
    expect(velocityLossInterpretation(28).band).toBe('hypertrophy');
    expect(velocityLossInterpretation(40).band).toBe('fatigue');
  });
});
