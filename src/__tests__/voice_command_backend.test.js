// functions/api/voice-command.js — [예약 생성 프로젝트 2026-08-08]
// 다른 functions/ 테스트(momi_role_scope.test.js)와 같은 정적 소스 패턴을 따른다.
// 이 파일 자체에 대한 전용 테스트가 이전에 없었다("정밀 디버깅" 때 지적된
// functions/ 커버리지 0 문제) — propose_reservation 추가를 계기로 만든다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');
const src = readSrc('functions', 'api', 'voice-command.js');

describe('voice-command.js — propose_reservation 도구 정의', () => {
  it('ALL_TOOLS에 propose_reservation이 있고 date/startTime을 필수로 요구한다', () => {
    const toolStart = src.indexOf("{ name: 'propose_reservation'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(toolStart).toBeGreaterThan(-1);
    expect(body).toContain("required: ['date', 'startTime']");
  });

  it('trainerName·memberName은 필수가 아니다(추측하지 않고 언급 없으면 생략)', () => {
    const toolStart = src.indexOf("{ name: 'propose_reservation'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(body).toContain('trainerName');
    expect(body).toContain('memberName');
    // required 배열엔 이 둘이 없어야 한다.
    const requiredMatch = body.match(/required:\s*\[([^\]]*)\]/);
    expect(requiredMatch[1]).not.toContain('trainerName');
    expect(requiredMatch[1]).not.toContain('memberName');
  });

  it('trainer/admin 둘 다 이 도구를 쓸 수 있다(관리자 전용 아님)', () => {
    const toolStart = src.indexOf("{ name: 'propose_reservation'");
    const lineEnd = src.indexOf('\n', toolStart);
    const line = src.slice(toolStart, lineEnd);
    expect(line).toContain("roles: ['trainer', 'admin']");
  });
});

describe('voice-command.js — 오늘 날짜(KST) 계산', () => {
  it('UTC 서버 시각을 KST(UTC+9)로 보정한 뒤 날짜만 뽑는다(자정 근처 하루 밀림 방지)', () => {
    expect(src).toContain(
      "const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);"
    );
  });

  it('계산한 오늘 날짜를 시스템 프롬프트에 실제로 넣는다(Claude가 상대 날짜를 계산할 근거)', () => {
    expect(src).toContain('오늘 날짜는 ${todayKST}');
  });
});

describe('voice-command.js — propose_reservation 응답 분기', () => {
  it('propose_reservation 호출을 navigate 매칭보다 먼저 분기한다(destinationId 없어서 섞이면 안 됨)', () => {
    const branchIdx = src.indexOf("if (toolUse.name === 'propose_reservation') {");
    const matchedIdx = src.indexOf("const matched = ALL_TOOLS.find((t) => t.name === toolUse.name);");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeLessThan(matchedIdx);
  });

  it('type: reservation_propose로 응답하고 저장 관련 필드(id 등)는 만들지 않는다(제안만, 저장은 클라이언트 확인 후)', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_reservation') {");
    const end = src.indexOf("if (toolUse.name === 'propose_cancel_reservation') {", start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'reservation_propose',");
    expect(body).not.toContain('createScheduleWithDeduction');
  });

  it('memberName·trainerName·date·startTime·classType을 전부 응답에 담는다', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_reservation') {");
    const end = src.indexOf("if (toolUse.name === 'propose_cancel_reservation') {", start);
    const body = src.slice(start, end);
    for (const field of ['memberName', 'trainerName', 'date', 'startTime', 'classType']) {
      expect(body).toContain(`toolUse.input?.${field}`);
    }
  });
});

// [예약 생성 프로젝트 3단계 2026-08-09] propose_reservation과 대칭되는 취소 도구.
describe('voice-command.js — propose_cancel_reservation 도구 정의', () => {
  it('ALL_TOOLS에 propose_cancel_reservation이 있고 date/startTime을 필수로 요구한다', () => {
    const toolStart = src.indexOf("{ name: 'propose_cancel_reservation'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(toolStart).toBeGreaterThan(-1);
    expect(body).toContain("required: ['date', 'startTime']");
  });

  it('trainer/admin 둘 다 이 도구를 쓸 수 있다(관리자 전용 아님)', () => {
    const toolStart = src.indexOf("{ name: 'propose_cancel_reservation'");
    const lineEnd = src.indexOf('\n', toolStart);
    const line = src.slice(toolStart, lineEnd);
    expect(line).toContain("roles: ['trainer', 'admin']");
  });

  it('classType 필드는 없다(취소엔 필요 없음 — 만들기 도구와 스키마를 그대로 복붙하지 않았는지 확인)', () => {
    const toolStart = src.indexOf("{ name: 'propose_cancel_reservation'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(body).not.toContain('classType');
  });
});

describe('voice-command.js — propose_cancel_reservation 응답 분기', () => {
  it('propose_reservation 분기 바로 다음, navigate 매칭보다 먼저 온다', () => {
    const proposeIdx = src.indexOf("if (toolUse.name === 'propose_reservation') {");
    const cancelIdx = src.indexOf("if (toolUse.name === 'propose_cancel_reservation') {");
    const matchedIdx = src.indexOf("const matched = ALL_TOOLS.find((t) => t.name === toolUse.name);");
    expect(cancelIdx).toBeGreaterThan(proposeIdx);
    expect(cancelIdx).toBeLessThan(matchedIdx);
  });

  it('type: reservation_cancel_propose로 응답하고 실제 삭제 관련 호출은 안 한다(제안만)', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_cancel_reservation') {");
    const end = src.indexOf("if (toolUse.name === 'propose_reschedule_reservation') {", start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'reservation_cancel_propose',");
    expect(body).not.toContain('deleteScheduleWithRestore');
  });

  it('memberName·trainerName·date·startTime을 응답에 담는다', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_cancel_reservation') {");
    const end = src.indexOf("if (toolUse.name === 'propose_reschedule_reservation') {", start);
    const body = src.slice(start, end);
    for (const field of ['memberName', 'trainerName', 'date', 'startTime']) {
      expect(body).toContain(`toolUse.input?.${field}`);
    }
  });
});

// [예약 생성 프로젝트 4단계 2026-08-09] 취소·만들기와 대칭되는 변경(시간 이동) 도구.
describe('voice-command.js — propose_reschedule_reservation 도구 정의', () => {
  it('ALL_TOOLS에 propose_reschedule_reservation이 있고 oldDate/oldStartTime/newDate/newStartTime을 필수로 요구한다', () => {
    const toolStart = src.indexOf("{ name: 'propose_reschedule_reservation'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(toolStart).toBeGreaterThan(-1);
    expect(body).toContain("required: ['oldDate', 'oldStartTime', 'newDate', 'newStartTime']");
  });

  it('trainer/admin 둘 다 이 도구를 쓸 수 있다(관리자 전용 아님)', () => {
    const toolStart = src.indexOf("{ name: 'propose_reschedule_reservation'");
    const lineEnd = src.indexOf('\n', toolStart);
    const line = src.slice(toolStart, lineEnd);
    expect(line).toContain("roles: ['trainer', 'admin']");
  });

  it('기존 시간(old)과 새 시간(new) 필드가 이름부터 명확히 분리돼 있다(Claude가 헷갈려 하나로 합치지 않도록)', () => {
    const toolStart = src.indexOf("{ name: 'propose_reschedule_reservation'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    for (const field of ['oldDate', 'oldStartTime', 'newDate', 'newStartTime']) {
      expect(body).toContain(field);
    }
  });
});

describe('voice-command.js — propose_reschedule_reservation 응답 분기', () => {
  it('propose_cancel_reservation 분기 바로 다음, navigate 매칭보다 먼저 온다', () => {
    const cancelIdx = src.indexOf("if (toolUse.name === 'propose_cancel_reservation') {");
    const rescheduleIdx = src.indexOf("if (toolUse.name === 'propose_reschedule_reservation') {");
    const matchedIdx = src.indexOf("const matched = ALL_TOOLS.find((t) => t.name === toolUse.name);");
    expect(rescheduleIdx).toBeGreaterThan(cancelIdx);
    expect(rescheduleIdx).toBeLessThan(matchedIdx);
  });

  it('type: reservation_reschedule_propose로 응답하고 실제 변경 관련 호출은 안 한다(제안만)', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_reschedule_reservation') {");
    const end = src.indexOf('const matched', start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'reservation_reschedule_propose',");
    expect(body).not.toContain('updateSchedule');
  });

  it('memberName·trainerName·oldDate·oldStartTime·newDate·newStartTime을 응답에 담는다', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_reschedule_reservation') {");
    const end = src.indexOf('const matched', start);
    const body = src.slice(start, end);
    for (const field of ['memberName', 'trainerName', 'oldDate', 'oldStartTime', 'newDate', 'newStartTime']) {
      expect(body).toContain(`toolUse.input?.${field}`);
    }
  });
});

describe('voice-command.js — 기존 navigate 동작은 그대로 유지된다(회귀 방지)', () => {
  it('go_report 등 기존 도구는 여전히 destinationId로 매칭된다', () => {
    expect(src).toContain("destinationId: 'report'");
    expect(src).toContain("destinationId: matched.destinationId,");
  });

  it('role 필터링(트레이너에게 관리자 전용 도구 안 줌)은 그대로 남아있다', () => {
    expect(src).toContain('const tools = ALL_TOOLS.filter((t) => t.roles.includes(effectiveRole))');
  });
});

// [음성 대화형 2026-08-09] "그럼 그건 어떻게 해요?" 같은 자연스러운 후속 질문을
// 알아듣게 하는 핵심 배선. functions/api/momi.js의 Axis4(양방향 소통)와 완전히
// 같은 패턴을 재사용한다 — 새 메커니즘을 만들지 않았는지 이름 그대로 확인한다.
describe('voice-command.js — 멀티턴 대화(history) 지원', () => {
  it('요청 바디에서 history를 받는다', () => {
    expect(src).toContain('const { history } = body || {};');
    expect(src).toContain('const transcript = clampText(body?.transcript, 1000);');
  });

  it('momi.js와 동일하게 role/content 형식이 아닌 항목은 방어적으로 걸러낸다', () => {
    expect(src).toContain('const validHistory = normalizeMomiHistory(history);');
  });

  it('history가 있으면 현재 발화 앞에 이어붙여서 Claude에 보낸다(대화 연속성)', () => {
    expect(src).toContain('messages: [...validHistory, { role: \'user\', content: transcript }],');
  });

  it('history가 없어도(빈 배열) 기존처럼 단발성 발화로 정상 동작한다(회귀 방지)', () => {
    // validHistory가 빈 배열이면 스프레드 결과가 그대로 [{role:'user',...}] 하나뿐 —
    // 별도 분기 없이 항상 같은 코드 경로를 타는지(if history else 같은 분기가 없어야
    // 함 — 분기가 있으면 한쪽만 테스트되고 다른 쪽은 놓칠 위험이 있음).
    const idx = src.indexOf('messages: [...validHistory,');
    expect(idx).toBeGreaterThan(-1);
    // 같은 함수 안에 messages를 만드는 조건 분기가 따로 없어야 한다.
    const bodyBefore = src.slice(0, idx);
    expect(bodyBefore).not.toMatch(/if \(validHistory/);
  });
});

// [무료 확장 2026-08-10] 관리자 전용 화면(트레이너관리·매출관리)도 "이동 동사 +
// 목적지 키워드"면 Claude를 안 거치고 무료로 처리한다. [보안] 이 분기가 안전한
// 이유: role은 클라이언트 값이 아니라 resolveVerifiedRole()이 서버에서 직접
// 검증한 값이고, 그 검증 이후에만(가드) 규칙 기반 판단이 실행된다 — 보안 경계
// 자체는 옮기거나 낮추지 않고, "뻔한 문장을 Claude에게 또 안 물어본다"는 비용
// 최적화만 얹은 것이다.
describe('voice-command.js — 관리자 화면 무료 규칙 기반 이동(2026-08-10)', () => {
  it('resolveVerifiedRole로 role을 검증한 뒤에만(그 아래에) 관리자 규칙 기반 분기가 있다(순서 회귀 방지)', () => {
    const roleIdx = src.indexOf('const { authenticated, role: effectiveRole, uid } = await resolveVerifiedRole(');
    const authGuardIdx = src.indexOf('if (!authenticated)', roleIdx);
    const adminBranchIdx = src.indexOf("if (effectiveRole === 'admin') {");
    const claudeCallIdx = src.indexOf("await fetch('https://api.anthropic.com/v1/messages'");
    expect(roleIdx).toBeGreaterThan(-1);
    expect(authGuardIdx).toBeGreaterThan(roleIdx);
    expect(adminBranchIdx).toBeGreaterThan(authGuardIdx);
    expect(claudeCallIdx).toBeGreaterThan(adminBranchIdx);
  });

  it('effectiveRole이 admin일 때만 관리자 규칙 기반 매칭을 시도한다(트레이너는 절대 이 분기를 안 탐)', () => {
    const idx = src.indexOf("if (effectiveRole === 'admin') {");
    const end = src.indexOf('\n    }\n\n    // role에 안 맞는 도구', idx);
    const body = src.slice(idx, end);
    expect(body).toContain('matchAdminRuleBasedDestination(transcript)');
  });

  it('매치되면 Claude를 호출하지 않고 바로 navigate 응답을 반환한다(return으로 아래 fetch에 안 도달)', () => {
    const idx = src.indexOf("if (effectiveRole === 'admin') {");
    const claudeCallIdx = src.indexOf("await fetch('https://api.anthropic.com/v1/messages'");
    const body = src.slice(idx, claudeCallIdx);
    expect(body).toContain('return jsonResponse(navBody);');
  });

  it('트레이너관리·매출관리 키워드를 모두 인식한다', () => {
    const start = src.indexOf('const ADMIN_DESTINATION_KEYWORDS = [');
    const end = src.indexOf('];', start);
    const body = src.slice(start, end);
    expect(body).toContain("id: 'trainers'");
    expect(body).toContain("id: 'revenue'");
  });

  it('이동 동사가 없으면 관리자 규칙 기반도 매치하지 않는다(코칭 질문 등과 혼동 방지, 목적지 매칭과 동일 원칙)', () => {
    const fnStart = src.indexOf('function matchAdminRuleBasedDestination(transcript) {');
    const fnEnd = src.indexOf('\n}', fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain('ADMIN_NAV_VERBS.some(');
  });

  it('매출관리는 tab(개요/정산/지출/설정)까지 규칙 기반으로 뽑아서 응답에 포함한다', () => {
    const idx = src.indexOf("if (adminDestId === 'revenue') {");
    const end = src.indexOf('}', idx);
    const body = src.slice(idx, end);
    expect(body).toContain('matchRevenueTab(transcript)');
    expect(body).toContain('navBody.tab = tab;');

    const tabFnStart = src.indexOf('const REVENUE_TAB_KEYWORDS = [');
    const tabFnEnd = src.indexOf('];', tabFnStart);
    const tabBody = src.slice(tabFnStart, tabFnEnd);
    expect(tabBody).toContain("id: 'settle'");
    expect(tabBody).toContain("id: 'expense'");
    expect(tabBody).toContain("id: 'config'");
    expect(tabBody).toContain("id: 'overview'");
  });

  it('트레이너관리는 tab이 없다(go_trainers 도구 자체에 tab 파라미터가 없음 — 배선하지 않았는지 확인)', () => {
    const idx = src.indexOf("const navBody = { type: 'navigate', destinationId: adminDestId };");
    const end = src.indexOf("return new Response", idx);
    const body = src.slice(idx, end);
    // revenue일 때만 tab을 채우는 조건문이어야 하고, trainers는 그 분기를 안 탐.
    expect(body).toContain("if (adminDestId === 'revenue') {");
  });
});

// [비용 절감 2026-08-11] 프롬프트 캐싱 — tools(도구 15개 정의)와 system의
// 고정불변 부분(MOMI_SYSTEM_PROMPT)은 같은 role이면 호출마다 100% 동일한
// 내용이다(사용자 발화·오늘 날짜는 여기 안 섞이고 messages/시스템의 별도
// 블록에 들어감). 캐싱은 Claude가 실제로 받는 내용을 전혀 안 바꾼다 —
// 반복되는 입력 토큰의 과금 방식만 낮추는 순수 비용 최적화라 답변 품질에는
// 영향이 없다.
describe('functions/api/voice-command.js — 프롬프트 캐싱(2026-08-11, 비용 절감)', () => {
  const src = readSrc('functions', 'api', 'voice-command.js');

  it('tools 배열의 마지막 항목에만 cache_control을 붙인다(도구 목록 전체를 캐싱 — 하나에만 붙이면 그 앞까지 전부 캐싱됨)', () => {
    const idx = src.indexOf('if (tools.length > 0) {');
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, src.indexOf('};', idx) + 2);
    expect(body).toContain("tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } };");
  });

  it('system은 두 블록으로 나뉘어 있다 — 고정불변인 음성 전용 프롬프트만 캐싱하고, 오늘 날짜가 들어가 매일 바뀌는 뒷부분은 캐싱하지 않는다', () => {
    const idx = src.indexOf('system: [');
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, src.indexOf('tools,', idx));
    expect(body).toContain("{ type: 'text', text: MOMI_VOICE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }");
    // 날짜가 들어가는 두 번째 블록에는 cache_control이 없어야 한다(매일 바뀌는 내용 캐싱 방지).
    const secondBlockStart = body.indexOf('todayKST');
    const secondBlockRegionStart = body.lastIndexOf('{', secondBlockStart);
    const secondBlockRegionEnd = body.indexOf('},', secondBlockStart);
    const secondBlock = body.slice(secondBlockRegionStart, secondBlockRegionEnd);
    expect(secondBlock).not.toContain('cache_control');
  });

  it('캐싱 적용 전후로 Claude에게 전달되는 실제 지시문 내용(MOMI_SYSTEM_PROMPT·라우터 모드 설명·오늘 날짜)은 그대로다 — 과금 방식만 바뀌었을 뿐 프롬프트 문구 자체는 안 건드림', () => {
    expect(src).toContain('[음성 명령 라우터 모드] 사용자가 "모미야" 다음에 한 말이');
    expect(src).toContain('오늘 날짜는 ${todayKST}(한국 시간 기준)입니다.');
  });
});

describe('functions/api/voice-command.js — 저비용 음성 전용 모델', () => {
  const src = readSrc('functions', 'api', 'voice-command.js');

  it('음성 라우팅은 Haiku 4.5와 짧은 출력 한도를 사용한다', () => {
    expect(src).toContain("const MODEL = 'claude-haiku-4-5-20251001';");
    expect(src).toContain('max_tokens: 256');
    expect(src).toContain('MOMI_VOICE_SYSTEM_PROMPT');
  });
});

// [안전장치 일원화 2026-08-18] momi.js(리포트 코칭 경로)는 applyMomiSafetyGuard로
// 응급·급성 레드플래그 발화를 코드 레벨에서 강제로 안전 문구로 바꾸는데, 이
// 음성 경로의 자유 질문(코칭 Q&A) 응답에는 그 가드가 빠져 있었다(프롬프트
// 지시문에만 의존 — momi_speech.test.js 등 기존 테스트는 이 누락을 못 잡았음).
// momi.js와 동일한 함수를 재사용해 두 경로의 안전 수준을 맞췄는지 확인한다.
describe('functions/api/voice-command.js — 자유 질문 응답 안전장치(momi.js와 수준 통일)', () => {
  const src = readSrc('functions', 'api', 'voice-command.js');

  it('momiRequest.js에서 applyMomiSafetyGuard를 import한다', () => {
    const importLine = src.split('\n').find((line) => line.includes("from '../_shared/momiRequest.js'"));
    expect(importLine).toBeDefined();
    expect(importLine).toContain('applyMomiSafetyGuard');
  });

  it('textBlock 기반 채팅 응답을 만들기 전에 applyMomiSafetyGuard를 호출한다(원문 textBlock.text를 그대로 응답 JSON에 넣지 않는다)', () => {
    const idx = src.indexOf('const textBlock = (data.content || []).find(');
    const returnIdx = src.indexOf("type: 'chat'", idx);
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, returnIdx + 200);
    expect(body).toContain('applyMomiSafetyGuard(');
    // 응답 JSON의 text 필드가 textBlock.text 원문이 아니라 안전장치를 거친
    // 변수(safeChatText)를 참조해야 한다 — 가드를 호출만 하고 결과를 안 쓰는
    // 회귀를 막는다.
    expect(body).toMatch(/text:\s*safeChatText/);
  });

  it('report가 없는 경로이므로 report:null로 호출하고, question에는 사용자 발화(transcript)를 그대로 넘긴다(추측 데이터 주입 방지)', () => {
    const callIdx = src.indexOf('applyMomiSafetyGuard({');
    const callEnd = src.indexOf('});', callIdx);
    const call = src.slice(callIdx, callEnd);
    expect(call).toContain('report: null');
    expect(call).toContain('question: transcript');
  });
});
