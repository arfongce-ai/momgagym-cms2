import { describe, it, expect } from 'vitest';
import {
  vbtZonePurpose, buildLiftingInterpretation, buildLiftingPayload,
} from '../ai-measure/core/lifting.js';

describe('VBT 트레이닝 존 목적', () => {
  it('속도 구간별 존 분류(Mann 기준)', () => {
    expect(vbtZonePurpose(1.4).label).toBe('스피드·파워');
    expect(vbtZonePurpose(1.1).label).toBe('근파워');
    expect(vbtZonePurpose(0.8).label).toBe('근력·파워');
    expect(vbtZonePurpose(0.6).label).toBe('근비대·근력');
    expect(vbtZonePurpose(0.3).label).toBe('최대근력');
  });
  it('비정상 입력은 null', () => {
    expect(vbtZonePurpose(0)).toBeNull();
    expect(vbtZonePurpose(-1)).toBeNull();
    expect(vbtZonePurpose(NaN)).toBeNull();
  });
});

describe('1RM 리포트 해석 — 무게/강도/도전차수', () => {
  it('강도(%)와 도전 차수를 설명한다', () => {
    const p = buildLiftingPayload({
      mode: 'onerm', exerciseType: 'squat', source: 'manual',
      metrics: { oneRM: 100, confidenceScore: 0.9 },
      metadata: { weight: 80, reps: 5, attemptNo: 2, bestOneRM: 102 },
    });
    const r = buildLiftingInterpretation(p);
    expect(r.headline).toContain('스쿼트');
    expect(r.headline).toContain('100kg');
    const text = r.lines.map(l => `${l.label}:${l.text}`).join('|');
    expect(text).toContain('강도');     // 80/100 = 80%
    expect(text).toContain('80%');
    expect(text).toContain('도전');
    expect(text).toContain('2차');
  });

  it('고반복은 주의로 안내(차단 아님)', () => {
    const p = buildLiftingPayload({
      mode: 'onerm', exerciseType: 'bench_press', source: 'manual',
      metrics: { oneRM: 80 }, metadata: { weight: 50, reps: 15 },
    });
    const r = buildLiftingInterpretation(p);
    expect(r.cautions.some(c => c.includes('15'))).toBe(true);
  });
});

describe('VBT/역도 리포트 해석 — 속도/구간/가동범위', () => {
  it('자동 카운트된 반복을 해석에 표시', () => {
    const p = buildLiftingPayload({
      mode: 'vbt', exerciseType: 'squat', source: 'upload',
      metrics: { meanVelocity: 0.7, rangeOfMotion: 55, confidenceScore: 0.85 },
      metadata: { reps: 5, isCalibrated: true },
    });
    const r = buildLiftingInterpretation(p);
    const line = r.lines.find(l => l.label === '반복');
    expect(line).toBeTruthy();
    expect(line.text).toContain('5회');
  });

  it('load-velocity 프로필 기준점을 해석에 표시', () => {
    const p = buildLiftingPayload({
      mode: 'vbt', exerciseType: 'squat', source: 'upload',
      metrics: { meanVelocity: 0.62, rangeOfMotion: 48, confidenceScore: 0.85 },
      metadata: {
        reps: 3,
        isCalibrated: true,
        loadVelocityPoint: { exerciseType: 'squat', loadKg: 100, meanVelocity: 0.62 },
      },
    });
    const r = buildLiftingInterpretation(p);
    const text = r.lines.map(l => `${l.label}:${l.text}`).join('|');
    expect(text).toContain('프로필 기준점');
    expect(text).toContain('100kg');
    expect(text).toContain('0.62m/s');
  });

  it('평균속도에서 트레이닝 구간을 설명', () => {
    const p = buildLiftingPayload({
      mode: 'vbt', exerciseType: 'squat', source: 'upload',
      metrics: { meanVelocity: 0.8, peakVelocity: 1.2, rangeOfMotion: 55, confidenceScore: 0.85 },
      metadata: { weight: 100, isCalibrated: true },
    });
    const r = buildLiftingInterpretation(p);
    expect(r.headline).toContain('0.8m/s');
    const text = r.lines.map(l => `${l.label}:${l.text}`).join('|');
    expect(text).toContain('근력·파워');   // 0.8 → 근력·파워 존
    expect(text).toContain('최고속도');
    expect(text).toContain('가동범위');
    expect(text).toContain('55cm');
  });

  it('실시간 저fps면 최고속도 미산출을 주의로 안내', () => {
    const p = buildLiftingPayload({
      mode: 'lifting', exerciseType: 'snatch', source: 'live',
      metrics: { meanVelocity: 1.5, peakVelocity: null, peakReason: 'live_fps_too_low', rangeOfMotion: 90 },
      metadata: { isCalibrated: true },
    });
    const r = buildLiftingInterpretation(p);
    expect(r.cautions.some(c => c.includes('고속영상'))).toBe(true);
  });

  it('신뢰도 낮으면 주의 추가', () => {
    const p = buildLiftingPayload({
      mode: 'vbt', exerciseType: 'clean', source: 'live',
      metrics: { meanVelocity: 1.0, confidenceScore: 0.4 },
      metadata: { isCalibrated: false, confidenceReasons: ['no_calibration'] },
    });
    const r = buildLiftingInterpretation(p);
    expect(r.cautions.length).toBeGreaterThan(0);
  });
});
