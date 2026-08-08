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
    const end = src.indexOf('}\n      const matched', start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'reservation_propose',");
    expect(body).not.toContain('createScheduleWithDeduction');
  });

  it('memberName·trainerName·date·startTime·classType을 전부 응답에 담는다', () => {
    const start = src.indexOf("if (toolUse.name === 'propose_reservation') {");
    const end = src.indexOf('}\n      const matched', start);
    const body = src.slice(start, end);
    for (const field of ['memberName', 'trainerName', 'date', 'startTime', 'classType']) {
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
