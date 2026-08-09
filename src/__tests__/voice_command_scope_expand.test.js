// [음성 명령 확장 2026-08-09] "각 탭 열기 / AI측정 8개 페이지 / 회원별 세션·수납·
// 신체정보·측정이력·메모 / 회원별 스케줄 / 초시계·타이머·인터벌·메트로놈 / 회원별
// 리포트 / 매출관리·정산" 전부를 momi 음성 명령으로 처리 가능하게 확장한 작업.
// 다른 voice-command.js 테스트(voice_command_backend.test.js)와 같은 정적 소스
// 패턴을 따른다 — functions/ 는 Cloudflare Pages Function이라 context.env를
// 흉내 내는 것보다 이 방식이 더 간단하고 안전하다(그 파일 상단 주석과 동일 이유).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');
const src = readSrc('functions', 'api', 'voice-command.js');

function toolBlock(name) {
  const start = src.indexOf(`{ name: '${name}'`);
  expect(start, `${name} 도구를 찾지 못함`).toBeGreaterThan(-1);
  // 다음 도구 정의(또는 배열 끝) 전까지를 이 도구의 블록으로 본다.
  const nextToolIdx = src.indexOf("{ name: '", start + 1);
  const arrEnd = src.indexOf('\n];', start);
  const end = nextToolIdx > -1 && nextToolIdx < arrEnd ? nextToolIdx : arrEnd;
  return src.slice(start, end);
}

describe('voice-command.js — go_ai_measure: MEASURE_MENUS 10개 전부를 testId로 지원', () => {
  const body = toolBlock('go_ai_measure');

  it('registry.js의 10개 측정 메뉴 id를 전부 enum에 담는다', () => {
    for (const id of ['body', 'posture', 'rom', 'gait', 'jump', 'lifting', 'stance', 'squat', 'record', 'timer']) {
      expect(body).toContain(`'${id}'`);
    }
  });

  it('초시계·타이머·인터벌·메트로놈은 timer id로 매핑된다(설명에 명시)', () => {
    expect(body).toMatch(/초시계.*타이머.*인터벌.*메트로놈.*timer/);
  });

  it('memberName 파라미터도 여전히 유지된다(회귀 방지)', () => {
    expect(body).toContain('memberName');
  });
});

describe('voice-command.js — go_report: 저장된 리포트 7종 전부를 testId로 지원', () => {
  const body = toolBlock('go_report');

  it('Report.jsx가 openReportKind로 지원하는 7종을 전부 enum에 담는다(body/record/timer 리포트는 없으므로 제외)', () => {
    for (const id of ['posture', 'rom', 'gait', 'jump', 'lifting', 'stance', 'squat']) {
      expect(body).toContain(`'${id}'`);
    }
    expect(body).not.toContain("'body'");
    expect(body).not.toContain("'record'");
    expect(body).not.toContain("'timer'");
  });
});

describe('voice-command.js — go_members: 세션·수납·신체정보·측정이력·메모 tab 지원', () => {
  const body = toolBlock('go_members');

  it('MemberDetail.jsx TABS와 동일한 6개 tab id를 enum으로 갖는다', () => {
    for (const id of ['info', 'sessions', 'payments', 'body', 'ai', 'memo']) {
      expect(body).toContain(`'${id}'`);
    }
  });

  it('memberName 파라미터도 여전히 유지된다(회귀 방지)', () => {
    expect(body).toContain('memberName');
  });
});

describe('voice-command.js — go_schedule: 회원별 스케줄 조회를 위한 memberName 지원', () => {
  const body = toolBlock('go_schedule');

  it('memberName 파라미터가 추가됐다', () => {
    expect(body).toContain('memberName');
  });
});

describe('voice-command.js — go_revenue: 정산 등 tab 지원(관리자 전용 유지)', () => {
  const body = toolBlock('go_revenue');

  it('Revenue.jsx TABS와 동일한 4개 tab id를 enum으로 갖는다', () => {
    for (const id of ['overview', 'settle', 'expense', 'config']) {
      expect(body).toContain(`'${id}'`);
    }
  });

  it('여전히 admin 전용이다(회귀 방지 — 트레이너에게 노출되면 안 됨)', () => {
    const lineEnd = src.indexOf('\n', src.indexOf("{ name: 'go_revenue'"));
    const line = src.slice(src.indexOf("{ name: 'go_revenue'"), lineEnd);
    expect(line).toContain("roles: ['admin']");
  });
});

describe('voice-command.js — navigate 응답에 tab 필드가 실려 나간다', () => {
  it('toolUse.input?.tab을 응답 JSON에 담는다', () => {
    const start = src.indexOf("type: 'navigate',\n          destinationId: matched.destinationId,");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('}),', start);
    const body = src.slice(start, end);
    expect(body).toContain('tab: toolUse.input?.tab || null,');
  });
});
