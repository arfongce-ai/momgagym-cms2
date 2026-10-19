import { describe, it, expect } from 'vitest';
import { createRecognitionTracker, frameKeyVisibility } from '../ai-measure/core/recognitionStats.js';
import { normalizeConfidence } from '../services/measureHistoryService.js';

const lm = (vis) => Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: vis }));

describe('recognitionStats', () => {
  it('주요 관절 평균 visibility 를 낸다', () => {
    expect(frameKeyVisibility(lm(0.8))).toBeCloseTo(0.8);
    expect(frameKeyVisibility(null)).toBeNull();
  });
  it('또렷이 인식된 프레임 비율을 센다', () => {
    const t = createRecognitionTracker();
    t.record(lm(0.9)); t.record(lm(0.9)); t.record(lm(0.2)); t.record(null);
    const s = t.snapshot();
    expect(s.frames).toBe(4);
    expect(s.detectedFrames).toBe(3);
    expect(s.goodFrames).toBe(2);
    expect(s.ratio).toBe(0.5);
    expect(s.detectionRatio).toBe(0.75);
  });
  it('프레임이 없으면 null, reset 하면 비운다', () => {
    const t = createRecognitionTracker();
    expect(t.snapshot()).toBeNull();
    t.record(lm(1)); t.reset();
    expect(t.snapshot()).toBeNull();
  });
  it('저장된 recognition.ratio 는 이력 신뢰도 표기로 읽힌다', () => {
    expect(normalizeConfidence({ recognition: { ratio: 0.82 } })).toEqual({ pct: 82, source: 'recognition.ratio' });
    expect(normalizeConfidence({ data: { recognition: { ratio: 1 } } }).pct).toBe(100);
  });
});
