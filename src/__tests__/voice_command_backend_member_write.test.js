// functions/api/voice-command.js — [momi 쓰기 권한 확장 2026-08-10]
// propose_add_member_memo / propose_adjust_session_count / propose_update_member_info
// voice_command_backend.test.js(예약 3종)와 완전히 같은 정적 소스 패턴을 따른다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');
const src = readSrc('functions', 'api', 'voice-command.js');

describe('voice-command.js — propose_add_member_memo 도구 정의', () => {
  it('ALL_TOOLS에 있고 memberName/memoText를 필수로 요구한다', () => {
    const toolStart = src.indexOf("{ name: 'propose_add_member_memo'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(toolStart).toBeGreaterThan(-1);
    expect(body).toContain("required: ['memberName', 'memoText']");
  });

  it('trainer/admin 둘 다 쓸 수 있다(관리자 전용 아님)', () => {
    const toolStart = src.indexOf("{ name: 'propose_add_member_memo'");
    const lineEnd = src.indexOf('\n', toolStart);
    expect(src.slice(toolStart, lineEnd)).toContain("roles: ['trainer', 'admin']");
  });
});

describe('voice-command.js — propose_adjust_session_count 도구 정의', () => {
  it('ALL_TOOLS에 있고 memberName/delta를 필수로 요구한다(trainerName은 선택)', () => {
    const toolStart = src.indexOf("{ name: 'propose_adjust_session_count'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(toolStart).toBeGreaterThan(-1);
    expect(body).toContain("required: ['memberName', 'delta']");
    const requiredMatch = body.match(/required:\s*\[([^\]]*)\]/);
    expect(requiredMatch[1]).not.toContain('trainerName');
  });

  it('delta는 number 타입이다(추가는 양수/차감은 음수로 Claude가 채우도록)', () => {
    const toolStart = src.indexOf("{ name: 'propose_adjust_session_count'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(body).toContain("delta: { type: 'number'");
  });
});

describe('voice-command.js — propose_update_member_info 도구 정의', () => {
  it('ALL_TOOLS에 있고 세 필드 전부 필수다', () => {
    const toolStart = src.indexOf("{ name: 'propose_update_member_info'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(toolStart).toBeGreaterThan(-1);
    expect(body).toContain("required: ['memberName', 'field', 'newValue']");
  });

  it('field는 phone/phone2로만 제한된다(이름 등 다른 필드는 아직 미지원)', () => {
    const toolStart = src.indexOf("{ name: 'propose_update_member_info'");
    const toolEnd = src.indexOf('} },\n];', toolStart);
    const body = src.slice(toolStart, toolEnd);
    expect(body).toContain("enum: ['phone', 'phone2']");
  });
});

describe('voice-command.js — 3종 응답 분기 (navigate 매칭보다 먼저, 저장은 하지 않는다)', () => {
  const matchedIdx = src.indexOf('const matched = ALL_TOOLS.find((t) => t.name === toolUse.name);');

  it('propose_add_member_memo 분기가 navigate 매칭보다 먼저 온다', () => {
    const idx = src.indexOf("if (toolUse.name === 'propose_add_member_memo') {");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(matchedIdx);
  });

  it('propose_add_member_memo는 type: memo_add_propose로 응답하고 실제 저장 함수(updateMember)는 호출하지 않는다', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_add_member_memo') {");
    const end = src.indexOf("if (toolUse.name === 'propose_adjust_session_count') {", start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'memo_add_propose',");
    expect(body).not.toContain('updateMember');
    expect(body).toContain('toolUse.input?.memberName');
    expect(body).toContain('toolUse.input?.memoText');
  });

  it('propose_adjust_session_count 분기가 memo 분기 바로 다음, navigate 매칭보다 먼저 온다', () => {
    const memoIdx = src.indexOf("if (toolUse.name === 'propose_add_member_memo') {");
    const sessionIdx = src.indexOf("if (toolUse.name === 'propose_adjust_session_count') {");
    expect(sessionIdx).toBeGreaterThan(memoIdx);
    expect(sessionIdx).toBeLessThan(matchedIdx);
  });

  it('propose_adjust_session_count는 type: session_adjust_propose로 응답하고 delta 타입을 number로 방어적으로 재검증한다', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_adjust_session_count') {");
    const end = src.indexOf("if (toolUse.name === 'propose_update_member_info') {", start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'session_adjust_propose',");
    expect(body).toContain("typeof toolUse.input?.delta === 'number'");
    expect(body).not.toContain('updateMember');
  });

  it('propose_update_member_info 분기가 session 분기 바로 다음, navigate 매칭보다 먼저 온다', () => {
    const sessionIdx = src.indexOf("if (toolUse.name === 'propose_adjust_session_count') {");
    const infoIdx = src.indexOf("if (toolUse.name === 'propose_update_member_info') {");
    expect(infoIdx).toBeGreaterThan(sessionIdx);
    expect(infoIdx).toBeLessThan(matchedIdx);
  });

  it('propose_update_member_info는 type: member_info_update_propose로 응답하고 실제 저장은 안 한다', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_update_member_info') {");
    const end = src.indexOf("if (toolUse.name === 'control_timer') {", start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'member_info_update_propose',");
    expect(body).not.toContain('updateMember');
    expect(body).toContain('toolUse.input?.field');
    expect(body).toContain('toolUse.input?.newValue');
  });
});

describe('voice-command.js — 기존 예약·타이머·navigate 분기는 그대로 유지된다(회귀 방지)', () => {
  it('propose_reservation·control_timer 분기가 여전히 존재하고 새 3종보다 뒤에 있다(삽입 위치 확인)', () => {
    const infoIdx = src.indexOf("if (toolUse.name === 'propose_update_member_info') {");
    const timerIdx = src.indexOf("if (toolUse.name === 'control_timer') {");
    expect(timerIdx).toBeGreaterThan(infoIdx);
  });

  it('ALL_TOOLS 배열 안에 예약 3종·타이머·새 3종이 전부 공존한다(개수 누락 방지)', () => {
    for (const name of [
      'propose_reservation', 'propose_cancel_reservation', 'propose_reschedule_reservation',
      'control_timer',
      'propose_add_member_memo', 'propose_adjust_session_count', 'propose_update_member_info',
    ]) {
      expect(src).toContain(`name: '${name}'`);
    }
  });
});
