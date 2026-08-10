// [음성 타이머 제어 2026-08-09] functions/api/voice-command.js — control_timer 도구
// 정의와 응답 분기. 다른 voice-command.js 테스트(voice_command_backend.test.js)와
// 같은 정적 소스 패턴을 따른다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');
const src = readSrc('functions', 'api', 'voice-command.js');

describe('voice-command.js — control_timer 도구 정의', () => {
  const toolStart = src.indexOf("{ name: 'control_timer'");
  const toolEnd = src.indexOf('} },\n];', toolStart) > -1
    ? src.indexOf('} },\n];', toolStart)
    : src.indexOf("{ name: 'propose_reservation'", toolStart);
  const body = src.slice(toolStart, toolEnd);

  it('ALL_TOOLS에 control_timer가 있고 tool/action을 필수로 요구한다', () => {
    expect(toolStart).toBeGreaterThan(-1);
    expect(body).toContain("required: ['tool', 'action']");
  });

  it('destinationId가 없다(화면 이동이 아니라 제어 명령이므로 — propose_reservation과 같은 패턴)', () => {
    const lineEnd = src.indexOf('\n', toolStart);
    const line = src.slice(toolStart, lineEnd);
    expect(line).toContain('destinationId: null');
  });

  it('trainer/admin 둘 다 쓸 수 있다(관리자 전용 아님)', () => {
    const lineEnd = src.indexOf('\n', toolStart);
    const line = src.slice(toolStart, lineEnd);
    expect(line).toContain("roles: ['trainer', 'admin']");
  });

  it('tool enum에 4개 도구(stopwatch/countdown/interval/metronome)가 전부 있다', () => {
    for (const t of ['stopwatch', 'countdown', 'interval', 'metronome']) {
      expect(body).toContain(`'${t}'`);
    }
  });

  it('action enum에 start/pause/reset/lap이 전부 있다', () => {
    for (const a of ['start', 'pause', 'reset', 'lap']) {
      expect(body).toContain(`'${a}'`);
    }
  });

  it('seconds·workSec·restSec·rounds·bpm 파라미터를 전부 갖는다', () => {
    for (const field of ['seconds', 'workSec', 'restSec', 'rounds', 'bpm']) {
      expect(body).toContain(`${field}:`);
    }
  });
});

describe('voice-command.js — control_timer 응답 분기', () => {
  it('navigate 매칭(ALL_TOOLS.find)보다 먼저 분기한다(destinationId 없어서 섞이면 안 됨)', () => {
    const branchIdx = src.indexOf("if (toolUse.name === 'control_timer') {");
    const matchedIdx = src.indexOf('const matched = ALL_TOOLS.find((t) => t.name === toolUse.name);');
    expect(branchIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeLessThan(matchedIdx);
  });

  it("type: 'timer_control'로 응답하고 tool/action/seconds/workSec/restSec/rounds/bpm을 전부 담는다", () => {
    const start = src.indexOf("if (toolUse.name === 'control_timer') {");
    const end = src.indexOf('const matched = ALL_TOOLS.find', start);
    const body = src.slice(start, end);
    expect(body).toContain("type: 'timer_control',");
    for (const field of ['tool', 'action', 'seconds', 'workSec', 'restSec', 'rounds', 'bpm']) {
      expect(body).toContain(`toolUse.input?.${field}`);
    }
  });

  it('예약류와 달리 트레이너 확인 절차(propose) 없이 바로 실행 가능한 응답을 준다(저장/삭제 관련 호출 없음)', () => {
    const start = src.indexOf("if (toolUse.name === 'control_timer') {");
    const end = src.indexOf('const matched = ALL_TOOLS.find', start);
    const body = src.slice(start, end);
    expect(body).not.toContain('createScheduleWithDeduction');
    expect(body).not.toContain('deleteScheduleWithRestore');
  });
});
