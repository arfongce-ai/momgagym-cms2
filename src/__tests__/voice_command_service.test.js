// voiceCommandService.js — 명령 처리 실패 시 원인(detail)을 그대로 삼키지 않고
// Error 메시지에 담아 넘기는지 확인. 다른 voice 관련 테스트와 마찬가지로 vitest
// 환경이 'node'라 정적 소스 패턴을 따른다(momi_voice.test.js 참고). 단, 이 파일의
// matchRuleBasedDestination·extractMemberNameFromText는 firebase.js를 통째로
// import해도 vitest 'node' 환경에서 문제없이 동작함을 확인해서(zzz_import_check로
// 검증 후 제거), matchWakeWord와 마찬가지로 실제 함수를 직접 불러와 검증한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  matchRuleBasedDestination,
  extractMemberNameFromText,
} from '../services/voiceCommandService.js';

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

// [무료 우선 2026-08-08] Claude(유료) 호출 전에 규칙 기반(키워드)으로 먼저 처리해서
// 목적지가 명확한 명령은 API 비용 없이 $0으로 끝낸다. 실제 신고된 명령
// 문장들("가상 회원 리포트 열어 줘" 등)로 검증한다.
describe('matchRuleBasedDestination() — 무료 규칙 기반 목적지 매칭', () => {
  it('실제 신고된 문장 "가상 회원 리포트 열어 줘"는 report로 간다(회원이 아니라)', () => {
    // "회원"도 들어있지만 "리포트"가 우선순위가 높아야 한다 — 실제 의도는 리포트 조회.
    expect(matchRuleBasedDestination('가상 회원 리포트 열어 줘')).toBe('report');
  });

  it('실제 신고된 문장 "종합 리포트 열어 줘"는 report로 간다', () => {
    expect(matchRuleBasedDestination('종합 리포트 열어 줘')).toBe('report');
  });

  it('"가상 회원 결과 리포트 띄워 줘"(다른 이동 동사)도 report로 간다', () => {
    expect(matchRuleBasedDestination('가상 회원 결과 리포트 띄워 줘')).toBe('report');
  });

  it('"회원관리 열어줘"는 members로 간다', () => {
    expect(matchRuleBasedDestination('회원관리 열어줘')).toBe('members');
  });

  it('"스케줄 보여줘"는 schedule로 간다', () => {
    expect(matchRuleBasedDestination('스케줄 보여줘')).toBe('schedule');
  });

  it('"AI측정 화면 열어줘"는 ai_measure로 간다', () => {
    expect(matchRuleBasedDestination('AI측정 화면 열어줘')).toBe('ai_measure');
  });

  it('이동 동사가 없으면(의도 불명확) null — Claude로 넘어감', () => {
    expect(matchRuleBasedDestination('리포트')).toBeNull();
    expect(matchRuleBasedDestination('회원')).toBeNull();
  });

  it('목적지 키워드가 전혀 없으면 null — Claude로 넘어감(코칭 질문 등)', () => {
    expect(matchRuleBasedDestination('오늘 컨디션 어때요')).toBeNull();
  });

  it('[보안] 관리자 전용 화면(트레이너관리·매출관리)은 이동 동사가 있어도 null — 반드시 Claude(서버 검증) 경로로 보낸다', () => {
    // 여기서 role 없이도 매치를 안 시켜야 한다 — 클라이언트 role은 조작 가능해서
    // 규칙 기반 경로에서 그냥 통과시키면 안 됨(verifyFirebaseToken.js가 지키는 것과 같은 이유).
    expect(matchRuleBasedDestination('트레이너 관리 화면 열어 줘')).toBeNull();
    expect(matchRuleBasedDestination('매출관리 열어줘')).toBeNull();
  });

  it('코칭 질문에 목적지 키워드가 우연히 섞여도(이동 동사 없으면) 오작동 안 함', () => {
    expect(matchRuleBasedDestination('이 회원한테 어떤 운동을 추천해야 할까요')).toBeNull();
  });
});

describe('extractMemberNameFromText() — 명령 텍스트에서 등록된 회원 이름 추출', () => {
  const members = [
    { name: '김철수' },
    { name: '김철수민' }, // 부분 문자열 겹침 케이스(더 긴 쪽을 골라야 함)
    { name: '박영희' },
  ];

  it('명령 안에 포함된 회원 이름을 찾는다', () => {
    expect(extractMemberNameFromText('김철수님 리포트 열어줘', members)).toBe('김철수');
  });

  it('여러 이름이 부분적으로 겹치면 더 긴(더 구체적인) 쪽을 고른다', () => {
    expect(extractMemberNameFromText('김철수민님 리포트 열어줘', members)).toBe('김철수민');
  });

  it('일치하는 이름이 없으면 null', () => {
    expect(extractMemberNameFromText('가상 회원 리포트 열어줘', members)).toBeNull();
  });

  it('회원 목록이 비어있으면 null(에러 없이)', () => {
    expect(extractMemberNameFromText('김철수님 리포트 열어줘', [])).toBeNull();
  });
});
