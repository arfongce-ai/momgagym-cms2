import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src', 'ai-measure', 'menus', 'GaitRunningAnalysis.jsx'), 'utf-8');

describe('보행·러닝(4번) 녹화 최대 시간 — 2026-11-23', () => {
  it('최대 녹화 60초, 자동 종료와 진행바가 같은 상수를 쓴다', () => {
    expect(src).toContain('const GAIT_MAX_RECORD_SEC = 60;');
    expect(src).toContain('recordingTime >= GAIT_MAX_RECORD_SEC');
    expect(src).toContain('recordingTime / GAIT_MAX_RECORD_SEC');
    expect(src).not.toContain('recordingTime >= 15');
  });
  it('최소 5초 기준은 그대로', () => {
    expect(src).toContain('if (recordingTime < 5)');
  });
});
