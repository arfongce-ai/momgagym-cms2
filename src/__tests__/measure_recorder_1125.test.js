import { describe, expect, it } from 'vitest';
import { hudLines, recognitionLabel } from '../ai-measure/core/measureRecorder';

describe('측정 녹화 HUD', () => {
  it('인식률은 값이 없으면 --', () => {
    expect(recognitionLabel(null)).toBe('인식률 --');
    expect(recognitionLabel({ ratio: 0.834, frames: 100 })).toBe('인식률 83%');
  });
  it('초시계·횟수·박자·인식률 줄이 만들어진다', () => {
    const l = hudLines({ elapsedMs: 12340, count: 7, unit: '회', bpm: 60, beat: true, recognition: { ratio: 0.9, frames: 50 }, hr: 120 });
    expect(l.map((x) => x.key)).toEqual(['clock', 'count', 'metro', 'recog', 'hr']);
    expect(l[0].text).toBe('00:12.34');
    expect(l.find((x) => x.key === 'metro').beat).toBe(true);
  });
  it('제한시간 종목은 남은 시간을 보여 준다', () => {
    const l = hudLines({ remainMs: 20000, count: 0 });
    expect(l[0].text).toBe('00:20.00');
    expect(l[1].key).toBe('clockHint');
  });
});
