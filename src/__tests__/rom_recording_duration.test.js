import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ai-measure/menus/RomMeasure.jsx', import.meta.url), 'utf8');

describe('ROM recording duration guard', () => {
  it('starts MediaRecorder without a fixed timeslice', () => {
    expect(source).toMatch(/mr\.start\(\)/);
    expect(source).not.toMatch(/mr\.start\(1000\)/);
  });

  it('auto-stops live recording at 60 seconds', () => {
    expect(source).toContain('MAX_RECORD_MS = 60000');
    expect(source).toContain('maxRecordTimerRef');
    expect(source).toContain('}, MAX_RECORD_MS);');
    expect(source).toContain('if (recordingRef.current) finishRecord();');
  });

  it('keeps a fallback frame loop while recording', () => {
    expect(source).toContain('composeIntervalRef');
    expect(source).toContain('setInterval(draw');
  });

  it('clears the max recording timer when recording finishes', () => {
    expect(source).toContain('if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current)');
  });
});
