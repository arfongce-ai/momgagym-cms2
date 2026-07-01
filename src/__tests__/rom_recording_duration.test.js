import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../ai-measure/menus/RomMeasure.jsx', import.meta.url), 'utf8');

describe('ROM 녹화 길이 — 60초까지 저장', () => {
  it('타임슬라이스 없이 mr.start() 로 시작한다', () => {
    expect(src).toMatch(/mr\.start\(\)/);
    expect(src).not.toMatch(/mr\.start\(1000\)/);
  });
  it('최대 녹화 60초(MAX_RECORD_MS) 안전 자동 종료가 있다', () => {
    expect(src).toContain('MAX_RECORD_MS = 60000');
    expect(src).toContain('maxRecordTimerRef');
    expect(src).toContain('}, MAX_RECORD_MS);');
    expect(src).toContain('if (recordingRef.current) finishRecord();');
  });
  it('rAF 스로틀 대비 setInterval 합성 폴백이 있다', () => {
    expect(src).toContain('composeIntervalRef');
    expect(src).toContain('setInterval(draw');
  });
  it('finishRecord 가 최대녹화 타이머를 해제한다', () => {
    expect(src).toContain('if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current)');
  });
});
