// functions/api/momi.js — "관리자·트레이너 접근 구분을 모미에도 적용" 요청 대응.
// functions/ 디렉토리는 Cloudflare Pages Function이라 context.env 등을 흉내 내는
// 것보다 다른 voice/momi 관련 테스트와 같은 정적 소스 패턴이 더 간단하고 안전하다
// (momi_voice.test.js 참고).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('functions/api/momi.js — role에 따라 응답 범위가 달라진다(회귀 방지)', () => {
  const src = readSrc('functions', 'api', 'momi.js');

  it('voice-command.js와 동일하게 resolveVerifiedRole로 Authorization 헤더를 직접 검증한다', () => {
    expect(src).toContain("import { resolveVerifiedRole } from '../_shared/verifyFirebaseToken.js';");
    expect(src).toContain(
      "const { role: effectiveRole } = await resolveVerifiedRole(request.headers.get('Authorization'));"
    );
  });

  it('클라이언트가 보낸 role 문자열을 신뢰하지 않는다(body에서 role을 안 꺼내 씀)', () => {
    // body 구조분해 목록에 role이 없어야 한다 — 있으면 클라이언트 값을 신뢰하는 것.
    const destructureLine = src.match(/const \{[^}]*\} = body \|\| \{\};/)?.[0] || '';
    expect(destructureLine).not.toContain('role');
  });

  it('admin과 trainer가 서로 다른 시스템 프롬프트 suffix를 받는다', () => {
    expect(src).toContain('ADMIN_ROLE_SUFFIX');
    expect(src).toContain('TRAINER_ROLE_SUFFIX');
    expect(src).toContain(
      "const roleSuffix = effectiveRole === 'admin' ? ADMIN_ROLE_SUFFIX : TRAINER_ROLE_SUFFIX;"
    );
    expect(src).toContain('system: MOMI_SYSTEM_PROMPT + roleSuffix,');
  });

  it('MOMI_SYSTEM_PROMPT 본문 자체는 안 건드린다(suffix로만 덧붙임)', () => {
    // import 구문 그대로 — momiPrompt.js 파일 자체를 수정한 게 아니라는 방증.
    expect(src).toContain("import { MOMI_SYSTEM_PROMPT } from '../_shared/momiPrompt.js';");
  });

  it('관리자 suffix는 비즈니스·매출 인사이트를 허용하는 문구를 담는다', () => {
    const start = src.indexOf('const ADMIN_ROLE_SUFFIX');
    const end = src.indexOf('const TRAINER_ROLE_SUFFIX', start);
    const body = src.slice(start, end);
    expect(body).toContain('비즈니스');
  });

  it('트레이너 suffix는 비즈니스·매출 관점 언급을 명시적으로 금지한다', () => {
    const start = src.indexOf('const TRAINER_ROLE_SUFFIX');
    const end = src.indexOf('export async function onRequestPost', start);
    const body = src.slice(start, end);
    expect(body).toContain('언급은 하지');
  });

  it('토큰 검증 실패해도(resolveVerifiedRole이 안전하게 trainer 반환) 요청 자체는 계속 처리된다', () => {
    // resolveVerifiedRole 자체가 실패 시 trainer로 안전하게 떨어지는 설계라
    // (verifyFirebaseToken.js), 여기서 별도 에러 처리 없이 곧바로 roleSuffix 선택으로
    // 이어져야 한다(멈추거나 401을 던지지 않음 — 로그인 안 한 상태에서도 최소한
    // 트레이너 수준 응답은 계속 받을 수 있어야 하므로).
    const resolveIdx = src.indexOf('await resolveVerifiedRole(');
    const roleSuffixIdx = src.indexOf('const roleSuffix =');
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(roleSuffixIdx).toBeGreaterThan(resolveIdx);
  });
});
