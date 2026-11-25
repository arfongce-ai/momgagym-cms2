import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { momiAnswerCacheKey } from '../services/momiService';

const read = (...s) => readFileSync(join(process.cwd(), ...s), 'utf8');

describe('모미 토큰 절감 (2026-11-25)', () => {
  it('같은 리포트는 같은 캐시 키, 내용이 바뀌면 다른 키', () => {
    const m = { id: 'm1' };
    const a = momiAnswerCacheKey({ kind: 'gait', report: { id: 'r1', v: 1 }, member: m });
    expect(momiAnswerCacheKey({ kind: 'gait', report: { id: 'r1', v: 1 }, member: m })).toBe(a);
    expect(momiAnswerCacheKey({ kind: 'gait', report: { id: 'r1', v: 2 }, member: m })).not.toBe(a);
  });
  it('리포트를 열 때 자동 호출하지 않고 버튼을 눌러야 만든다', () => {
    const src = read('src', 'components', 'report', 'MomiAutoNote.jsx');
    expect(src).toContain('const MOMI_AUTO_NOTE_ON_OPEN = false;');
    expect(src).toContain('if (!requested && !MOMI_AUTO_NOTE_ON_OPEN) return;');
  });
  it('후속 질문은 저렴한 모델을 쓴다', () => {
    const src = read('functions', 'api', 'momi.js');
    expect(src).toContain("const FOLLOWUP_MODEL = 'claude-haiku-4-5-20251001'");
    expect(src).toContain('validHistory.length > 0');
  });
});
