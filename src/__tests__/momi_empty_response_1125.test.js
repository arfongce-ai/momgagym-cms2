// 호출은 성공(200)인데 모델이 글을 비워 보낸 경우 — 화면에 "분석 결과를 만들지 못했습니다"만 뜨던 문제(2026-11-25) 회귀 방지.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MOMI_EMPTY_TEXT, applyMomiSafetyGuard } from '../../functions/_shared/momiRequest.js';

const src = readFileSync(join(process.cwd(), 'functions', 'api', 'momi.js'), 'utf8');

describe('모미 빈 응답 처리', () => {
  it('빈 글이면 대체 모델로 1번 재시도하고, 그래도 비면 MOMI_EMPTY 오류(502)로 돌려준다', () => {
    expect(src).toContain("if (!modelText.trim() && (usedModel !== FALLBACK_MODEL || data.stop_reason === 'max_tokens'))");
    // 생각(thinking)이 출력 토큰을 다 쓰지 않게 끄고, 한도를 넉넉히 둔다
    expect(src).toContain("thinking: { type: 'disabled' }");
    expect(src).toContain('maxTokens = 4096');
    expect(src).toContain("code: 'MOMI_EMPTY' }, 502");
    expect(src).toContain('종료 사유');
  });
  it('안전 문구(응급·급성)는 빈 응답이어도 그대로 나간다', () => {
    const out = applyMomiSafetyGuard({ kind: 'combined', report: { issues: ['대소변 조절 장애'] }, question: '', text: '' });
    expect(out).not.toBe(MOMI_EMPTY_TEXT);
    expect(out).toContain('응급');
  });
  it('일반 빈 응답은 기본 문구가 나와 서버가 오류로 바꿀 수 있다', () => {
    expect(applyMomiSafetyGuard({ kind: 'combined', report: {}, question: '', text: '' })).toBe(MOMI_EMPTY_TEXT);
  });
});
