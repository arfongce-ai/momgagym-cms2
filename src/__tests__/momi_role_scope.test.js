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
      "const { authenticated, role: effectiveRole, uid } = await resolveVerifiedRole(request.headers.get('Authorization'));"
    );
    expect(src).toContain('if (!authenticated)');
    expect(src).toContain('enforceMomiRateLimit(env, `momi:${uid}`)');
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
    // [비용 절감 2026-08-11] 프롬프트 캐싱 적용으로 system이 문자열에서
    // "캐싱 가능한 블록 배열"로 바뀌었다 — 담긴 내용(MOMI_SYSTEM_PROMPT+roleSuffix)
    // 자체는 완전히 동일하다.
    expect(src).toContain('system: [{ type: \'text\', text: MOMI_SYSTEM_PROMPT + roleSuffix, cache_control: { type: \'ephemeral\' } }],');
  });

  it('MOMI_SYSTEM_PROMPT 본문 자체는 안 건드린다(suffix로만 덧붙임)', () => {
    // import 구문 그대로 — momiPrompt.js 파일 자체를 수정한 게 아니라는 방증.
    expect(src).toContain("import { MOMI_SYSTEM_PROMPT } from '../_shared/momiPrompt.js';");
  });

  // [비용 절감 2026-08-11] 프롬프트 캐싱 — MOMI_SYSTEM_PROMPT+roleSuffix는
  // 같은 role이면 호출마다 100% 동일한 내용이라(회원 리포트·질문은 messages
  // 쪽에 별도로 들어감) 캐싱 대상이다. 캐싱은 Claude가 "보는" 내용을 전혀
  // 안 바꾼다 — 순수하게 반복되는 입력 토큰의 과금 방식만 낮추는 것이라
  // 답변 품질·정확도에는 영향이 없다.
  it('system이 캐싱 가능한 블록 배열이고 cache_control이 붙어있다', () => {
    expect(src).toContain("cache_control: { type: 'ephemeral' }");
    const idx = src.indexOf('system: [{');
    expect(idx).toBeGreaterThan(-1);
  });

  it('캐싱 블록 안 텍스트는 MOMI_SYSTEM_PROMPT + roleSuffix 그대로다(내용 변경 없음, 과금 방식만 다름)', () => {
    const idx = src.indexOf('system: [{');
    const line = src.slice(idx, src.indexOf('}],', idx) + 3);
    expect(line).toContain('text: MOMI_SYSTEM_PROMPT + roleSuffix');
  });

  // [Axis4 시작 2026-08-08] 트레이너-모미 양방향 소통 — history(이전 대화 턴)가
  // 오면 Claude에 넘기는 messages 배열에 이어붙여서, 매 호출이 무상태였던 예전
  // 구조를 벗어나 "지난 답변에 이어서 물어보기"가 가능해진다.
  it('history 배열을 공용 정규화 함수로 방어적으로 정리한다', () => {
    expect(src).toContain("const { kind, report, member, crossContext, businessContext, question, history } = body || {};");
    expect(src).toContain('const validHistory = normalizeMomiHistory(history);');
  });

  it('history가 있으면(후속 질문) 현재 리포트 컨텍스트를 질문과 함께 다시 담는다', () => {
    const start = src.indexOf('let userMessageContent;');
    const end = src.indexOf('const anthropicRes = await fetch(', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (validHistory.length > 0) {');
    expect(body).toContain('현재 회원·측정 컨텍스트');
    expect(body).toContain('report,');
  });

  it('history가 없으면(첫 턴) 기존처럼 리포트 데이터 전체를 프롬프트에 담는다', () => {
    const start = src.indexOf('let userMessageContent;');
    const end = src.indexOf('const anthropicRes = await fetch(', start);
    const body = src.slice(start, end);
    expect(body).toContain('아래는 회원의 측정 리포트 데이터입니다');
  });

  it('Claude에 보내는 messages 배열이 validHistory + 이번 턴 순서로 이어진다', () => {
    const messagesStart = src.indexOf('messages: [');
    const messagesEnd = src.indexOf('],', messagesStart);
    const body = src.slice(messagesStart, messagesEnd);
    expect(body.indexOf('...validHistory,')).toBeLessThan(body.indexOf('role: \'user\','));
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

  // [매출 데이터 연결 배선 준비 2026-08-08] businessContext가 실제로 admin일 때만
  // 프롬프트에 태워지는지 확인 — 클라이언트가 role 상관없이 항상 같이 보내도,
  // 서버가 검증한 role로 최종 필터링해야 한다(defense in depth).
  it('businessContext는 effectiveRole이 admin일 때만 프롬프트에 포함한다', () => {
    expect(src).toContain(
      "const effectiveBusinessContext = effectiveRole === 'admin' ? businessContext || null : null;"
    );
    expect(src).toContain('businessContext: effectiveBusinessContext,');
  });

  it('body에서 꺼낸 원본 businessContext를 그대로 프롬프트에 넘기지 않는다(필터링된 변수를 씀)', () => {
    const userContentStart = src.indexOf('const userContent = JSON.stringify(');
    const userContentEnd = src.indexOf(');', userContentStart);
    const body = src.slice(userContentStart, userContentEnd);
    // 원본 destructure된 businessContext가 아니라 effectiveBusinessContext를 써야 한다.
    expect(body).toContain('effectiveBusinessContext');
    expect(body).not.toMatch(/businessContext: businessContext/);
  });

  it('토큰 검증 실패는 401로 차단해 외부의 유료 API 사용을 막는다', () => {
    const resolveIdx = src.indexOf('await resolveVerifiedRole(');
    const authGuardIdx = src.indexOf('if (!authenticated)', resolveIdx);
    const roleSuffixIdx = src.indexOf('const roleSuffix =', authGuardIdx);
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(authGuardIdx).toBeGreaterThan(resolveIdx);
    expect(src.slice(authGuardIdx, roleSuffixIdx)).toContain(', 401)');
  });
});
