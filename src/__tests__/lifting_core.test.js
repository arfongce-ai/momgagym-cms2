import { describe, it, expect } from 'vitest';
import {
  EXERCISE_TYPES, isValidExerciseType, exerciseLabel, exercisesForMode,
  exerciseToLift1rm, lift1rmToExercise,
  canComputePeakVelocity, computeBarVelocities, estimateMeanPower,
  vbtConfidence, buildLiftingPayload, PEAK_VELOCITY_MIN_FPS,
} from '../ai-measure/core/lifting.js';

describe('lifting · exerciseType 표준화', () => {
  it('표준 종목 키만 유효', () => {
    expect(isValidExerciseType('squat')).toBe(true);
    expect(isValidExerciseType('bench_press')).toBe(true);
    expect(isValidExerciseType('snatch')).toBe(true);
    expect(isValidExerciseType('clean')).toBe(true);
    expect(isValidExerciseType('clean_jerk')).toBe(true);
    expect(isValidExerciseType('weightlifting')).toBe(true); // 레거시 별칭 호환
    expect(isValidExerciseType('bench')).toBe(false);     // 내부 lift 키는 비표준
    expect(isValidExerciseType('unknown')).toBe(false);
  });

  it('라벨 매핑', () => {
    expect(exerciseLabel('squat')).toBe('스쿼트');
    expect(exerciseLabel('bench_press')).toBe('벤치프레스');
    expect(exerciseLabel('snatch')).toBe('스내치');
    expect(exerciseLabel('clean_jerk')).toBe('클린&저크');
    expect(exerciseLabel('weightlifting')).toBe('클린'); // 레거시 → 대표 종목
    expect(exerciseLabel('nope')).toBe('nope'); // 폴백
  });

  it('모드별 종목 구성(역도=올림픽, 1RM=파워3종, VBT=혼합)', () => {
    const onerm = exercisesForMode('onerm').map(e => e.key);
    expect(onerm).toEqual(['squat', 'deadlift', 'bench_press']);
    expect(onerm).not.toContain('snatch'); // 올림픽 리프트는 1RM 추정 대상 아님

    const lifting = exercisesForMode('lifting').map(e => e.key);
    expect(lifting).toEqual(['snatch', 'clean_jerk', 'clean']);

    const vbt = exercisesForMode('vbt').map(e => e.key);
    expect(vbt).toEqual(['squat', 'deadlift', 'bench_press', 'snatch', 'clean']);
  });

  it('내부 lift 키 ↔ 표준 exerciseType 양방향 매핑', () => {
    expect(exerciseToLift1rm('bench_press')).toBe('bench');
    expect(exerciseToLift1rm('squat')).toBe('squat');
    expect(exerciseToLift1rm('snatch')).toBeNull(); // 1RM 없음
    expect(exerciseToLift1rm('clean')).toBeNull();
    expect(lift1rmToExercise('bench')).toBe('bench_press');
    expect(lift1rmToExercise('deadlift')).toBe('deadlift');
  });
});

describe('lifting · peakVelocity 정직성 게이트 (근거기반)', () => {
  it('실시간(live)은 peakVelocity 거부 — 저fps', () => {
    const g = canComputePeakVelocity({ source: 'live' });
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('live_fps_too_low');
  });

  it('고속영상(upload)은 허용', () => {
    expect(canComputePeakVelocity({ source: 'upload' }).allowed).toBe(true);
  });

  it('fps 명시 시 120 이상만 허용', () => {
    expect(canComputePeakVelocity({ fps: 30 }).allowed).toBe(false);
    expect(canComputePeakVelocity({ fps: 119 }).allowed).toBe(false);
    expect(canComputePeakVelocity({ fps: PEAK_VELOCITY_MIN_FPS }).allowed).toBe(true);
    expect(canComputePeakVelocity({ fps: 240 }).allowed).toBe(true);
  });

  it('소스 불명은 안전하게 거부', () => {
    expect(canComputePeakVelocity({}).reason).toBe('unknown_source');
  });

  it('computeBarVelocities: live는 mean만, peak=null', () => {
    const samples = [
      { yCm: 100, ts: 0 }, { yCm: 90, ts: 100 },
      { yCm: 70, ts: 200 }, { yCm: 60, ts: 300 },
    ];
    const r = computeBarVelocities(samples, { source: 'live' });
    expect(r.meanVelocity).not.toBeNull();
    expect(r.peakVelocity).toBeNull();           // 정직성: 저fps에서 미산출
    expect(r.peakReason).toBe('live_fps_too_low');
    expect(r.romCm).toBeCloseTo(40, 1);
  });

  it('computeBarVelocities: upload는 peak도 산출', () => {
    const samples = [
      { yCm: 100, ts: 0 }, { yCm: 90, ts: 8 },   // 240fps ≈ 4.2ms, 여기선 8ms 간격
      { yCm: 60, ts: 16 }, { yCm: 55, ts: 24 },
    ];
    const r = computeBarVelocities(samples, { source: 'upload' });
    expect(r.meanVelocity).not.toBeNull();
    expect(r.peakVelocity).not.toBeNull();
    expect(r.peakVelocity).toBeGreaterThan(0);
    expect(r.peakReason).toBe('ok');
  });

  it('샘플 부족이면 안전한 null', () => {
    expect(computeBarVelocities([], {}).meanVelocity).toBeNull();
    expect(computeBarVelocities([{ yCm: 1, ts: 0 }], {}).peakVelocity).toBeNull();
  });
});

describe('lifting · 평균파워 추정', () => {
  it('P = m·g·v', () => {
    expect(estimateMeanPower(100, 0.5)).toBe(Math.round(100 * 9.81 * 0.5));
  });
  it('무게/속도 없으면 null', () => {
    expect(estimateMeanPower(0, 0.5)).toBeNull();
    expect(estimateMeanPower(100, 0)).toBeNull();
  });
});

describe('lifting · confidenceScore (근거기반 감점)', () => {
  it('완벽 조건이면 1.0', () => {
    const c = vbtConfidence({ isCalibrated: true, lostRatio: 0, durationSec: 1.5, source: 'upload', romCm: 40 });
    expect(c.score).toBe(1);
    expect(c.reasons).toHaveLength(0);
  });

  it('캘리브레이션 없으면 감점 + 사유', () => {
    const c = vbtConfidence({ isCalibrated: false, durationSec: 1.5, source: 'upload', romCm: 40 });
    expect(c.score).toBeLessThan(1);
    expect(c.reasons).toContain('no_calibration');
  });

  it('추적 손실률 높으면 큰 감점', () => {
    const c = vbtConfidence({ isCalibrated: true, lostRatio: 0.5, durationSec: 1.5, source: 'upload', romCm: 40 });
    expect(c.reasons).toContain('high_tracking_loss');
    expect(c.score).toBeLessThanOrEqual(0.8);
  });

  it('실시간 소스 감점', () => {
    const c = vbtConfidence({ isCalibrated: true, lostRatio: 0, durationSec: 1.5, source: 'live', romCm: 40 });
    expect(c.reasons).toContain('live_low_fps');
  });

  it('점수는 0~1 범위로 클램프', () => {
    const c = vbtConfidence({ isCalibrated: false, lostRatio: 1, durationSec: 0.1, source: 'live', romCm: 2 });
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(1);
  });
});

describe('lifting · 통합 저장 페이로드', () => {
  it('표준 규약 구조를 갖춘다', () => {
    const p = buildLiftingPayload({
      mode: 'vbt', exerciseType: 'squat', source: 'live',
      metrics: { meanVelocity: 0.6, confidenceScore: 0.7 },
      metadata: { weight: 100, isCalibrated: true },
    });
    expect(p.type).toBe('lifting');
    expect(p.mode).toBe('vbt');
    expect(p.exerciseType).toBe('squat');
    expect(p.exerciseLabel).toBe('스쿼트');
    expect(p.metrics.meanVelocity).toBe(0.6);
    expect(p.metrics.peakVelocity).toBeNull();  // 명시 안 하면 null
    expect(p.metadata.weight).toBe(100);
    expect(p.metadata.isCalibrated).toBe(true);
    expect(typeof p.recordedAt).toBe('string');
  });

  it('비표준 exerciseType은 모드별 안전 종목으로 폴백', () => {
    const p1 = buildLiftingPayload({ mode: 'lifting', exerciseType: 'garbage', source: 'live' });
    expect(p1.exerciseType).toBe('clean'); // 역도 모드 → 올림픽 리프트 기본
    const p2 = buildLiftingPayload({ mode: 'vbt', exerciseType: 'garbage', source: 'live' });
    expect(p2.exerciseType).toBe('squat'); // 그 외 → squat
  });

  it('레거시 weightlifting 키는 clean으로 정규화 저장', () => {
    const p = buildLiftingPayload({ mode: 'lifting', exerciseType: 'weightlifting', source: 'live' });
    expect(p.exerciseType).toBe('clean');
  });
});
