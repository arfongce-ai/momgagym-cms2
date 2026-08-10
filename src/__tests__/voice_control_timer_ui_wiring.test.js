// [음성 타이머 제어 2026-08-09] GlobalVoiceCommand.jsx/KioskVoiceCommand.jsx —
// timer_control 응답을 받았을 때 예약류처럼 확인 절차 없이 바로 결과를 안내하는지
// 확인. 다른 momi_speech.test.js/kiosk_voice_command.test.js와 같은 정적 소스
// 패턴 컨벤션을 따른다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe.each([
  ['GlobalVoiceCommand.jsx', 'src/components/common/GlobalVoiceCommand.jsx'],
  ['KioskVoiceCommand.jsx', 'src/components/common/KioskVoiceCommand.jsx'],
])('%s — timer_control 결과 처리', (label, path) => {
  const src = readSrc(path);

  it('buildTimerControlMessage를 voiceCommandService에서 가져온다', () => {
    expect(src).toContain('buildTimerControlMessage');
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/services\/voiceCommandService['"]/);
  });

  it("result.type === 'timer_control' 분기가 있고 buildTimerControlMessage로 message를 만든다", () => {
    const idx = src.indexOf("result.type === 'timer_control'");
    expect(idx).toBeGreaterThan(-1);
    const nextBranch = src.indexOf('} else if', idx) > -1 ? src.indexOf('} else if', idx) : src.indexOf('} else {', idx);
    const branchBody = src.slice(idx, nextBranch);
    expect(branchBody).toContain('message = buildTimerControlMessage(result.cmd);');
  });

  it('예약류와 마찬가지로 잡담 맥락(chatHistory)을 정리한다(도구를 실제로 조작했으므로)', () => {
    const idx = src.indexOf("result.type === 'timer_control'");
    const nextBranch = src.indexOf('} else if', idx) > -1 ? src.indexOf('} else if', idx) : src.indexOf('} else {', idx);
    const branchBody = src.slice(idx, nextBranch);
    expect(branchBody).toContain('clearHistory(chatHistoryRef, lastChatAtRef);');
  });

  it('예약류(handledSeparately)와 달리 확인 대기 없이 바로 message를 세팅해 finally에서 자동으로 읽힌다', () => {
    const idx = src.indexOf("result.type === 'timer_control'");
    const nextBranch = src.indexOf('} else if', idx) > -1 ? src.indexOf('} else if', idx) : src.indexOf('} else {', idx);
    const branchBody = src.slice(idx, nextBranch);
    expect(branchBody).not.toContain('handledSeparately = true;');
  });
});
