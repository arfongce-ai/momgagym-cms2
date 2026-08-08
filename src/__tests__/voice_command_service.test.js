// voiceCommandService.js — 명령 처리 실패 시 원인(detail)을 그대로 삼키지 않고
// Error 메시지에 담아 넘기는지 확인. 다른 voice 관련 테스트와 마찬가지로 vitest
// 환경이 'node'라 정적 소스 패턴을 따른다(momi_voice.test.js 참고).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

// [버그 수정 2026-08-08] "명령이 실행 안 된다"는 문의 대응 — 예전엔 res.ok가
// false면 상태 코드만 담아 던져서, 백엔드(functions/api/voice-command.js)가
// 실패 응답에 이미 담아 보내주는 detail(예: Anthropic API 크레딧 부족 등 실제
// 원인)이 화면까지 전혀 전달되지 않았다.
describe('voiceCommandService.js — 실패 응답의 detail을 삼키지 않는다(회귀 방지)', () => {
  const src = readSrc('src', 'services', 'voiceCommandService.js');

  it('res.ok가 false면 응답 본문을 읽어서 detail/error를 뽑아낸다', () => {
    const start = src.indexOf('if (!res.ok) {');
    const end = src.indexOf('const data = await res.json();', start);
    const body = src.slice(start, end);
    expect(body).toContain('await res.json()');
    expect(body).toContain('body?.detail || body?.error');
  });

  it('추출한 detail을 Error 메시지에 포함해서 던진다', () => {
    const start = src.indexOf('if (!res.ok) {');
    const end = src.indexOf('const data = await res.json();', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/throw new Error\(`.*\$\{detail/);
  });

  it('응답이 JSON이 아니어도(네트워크 레벨 오류 등) try/catch로 방어해 죽지 않는다', () => {
    const start = src.indexOf('if (!res.ok) {');
    const end = src.indexOf('const data = await res.json();', start);
    const body = src.slice(start, end);
    expect(body).toContain('try {');
    expect(body).toContain('catch (e) {');
  });
});
