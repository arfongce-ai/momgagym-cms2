// [음성 명령 확장 2026-08-09] voiceCommandService.js — 목적지별로 data.testId/
// data.tab을 서로 다른 pendingVoiceTarget 필드로 매핑하는지 확인.
// 이전엔 destination과 무관하게 항상 testId로만 저장해서, Report.jsx(openReportKind
// 를 읽음)로 갈 때는 값이 버려지는 버그가 있었다(pending_voice_target_report_kind.test.js
// 가 지키는 openReportKind 자체 동작과는 별개로, "누가 그 필드를 채우는지"를
// 여기서 확인한다). 다른 voiceCommandService 테스트와 같은 정적 소스 패턴을 따른다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');
const src = readSrc('src', 'services', 'voiceCommandService.js');

describe('voiceCommandService.js — navigate 응답에서 목적지별로 다른 필드에 저장한다', () => {
  const start = src.indexOf('setPendingVoiceTarget({\n    memberName:');
  const end = src.indexOf('});', start);
  const body = src.slice(start, end);

  it('setPendingVoiceTarget 호출부를 찾는다', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('ai_measure 목적지일 때만 testId를 채운다', () => {
    expect(body).toContain("testId: destination.id === 'ai_measure' ? data.testId || null : null,");
  });

  it('report 목적지일 때는 testId 값을 openReportKind로 옮겨 담는다(핵심 버그 수정)', () => {
    expect(body).toContain("openReportKind: destination.id === 'report' ? data.testId || null : null,");
  });

  it('members 목적지일 때는 data.tab을 memberTab으로 옮겨 담는다', () => {
    expect(body).toContain("memberTab: destination.id === 'members' ? data.tab || null : null,");
  });

  it('revenue 목적지일 때는 data.tab을 revenueTab으로 옮겨 담는다', () => {
    expect(body).toContain("revenueTab: destination.id === 'revenue' ? data.tab || null : null,");
  });
});
