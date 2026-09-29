// [2026-09-29] 모미 인식률·지연 개선 회귀 테스트.
// 순수 함수(matchWakeWord)는 실행형, 나머지는 기존 voice 테스트처럼 정적 소스 검사.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { matchWakeWord } from '../hooks/useMomiVoice';

const read = (p) => readFileSync(join(__dirname, '..', p), 'utf-8');
const hook = read('hooks/useMomiVoice.js');

describe('웨이크워드 오인식 변형 추가', () => {
  it.each(['모임이야', '모이야', '오미야', '모니야', '무미야', '머미야', '마미야', '모비야'])(
    '"%s 회원 관리 열어줘"를 웨이크워드 + 명령으로 분리한다',
    (wake) => {
      const heard = `${wake} 회원 관리 열어줘`;
      const m = matchWakeWord(heard);
      expect(m).not.toBeNull();
      expect(heard.slice(m.index + m.length).trim()).toBe('회원 관리 열어줘');
    }
  );

  it('"모미여"는 뒤의 "여"가 명령으로 남지 않게 통째로 인정한다', () => {
    const heard = '모미여 스케줄 열어줘';
    const m = matchWakeWord(heard);
    expect(heard.slice(m.index + m.length).trim()).toBe('스케줄 열어줘');
  });

  it('기존 변형(모미야/몸이야)은 그대로 동작한다', () => {
    expect(matchWakeWord('모미야')).not.toBeNull();
    expect(matchWakeWord('몸이야 리포트')).not.toBeNull();
  });
});

describe('지연·무응답 방지 배선', () => {
  it('확정 대기는 400ms, 웨이크 후 명령 대기창은 10초', () => {
    expect(hook).toContain('const FINAL_RESULT_SETTLE_MS = 400;');
    expect(hook).toContain('const ACTIVATION_WINDOW_MS = 10000;');
  });

  it('임시 결과에서 웨이크워드가 들리면 기억했다가 확정 문장에서 웨이크가 빠져도 명령으로 살린다', () => {
    expect(hook).toContain('wakeInterimRef.current.text = interim;');
    expect(hook).toContain('WAKE_INTERIM_MEMORY_MS');
    const flush = hook.slice(hook.indexOf('const wakeMatch = matchWakeWord(heard);'));
    expect(flush.slice(0, 700)).toContain('onCommand(heard);');
  });

  it('확정 없이 세션이 끝나도 임시 웨이크 텍스트를 한 번 처리한다(onend 복구)', () => {
    const onend = hook.slice(hook.indexOf('recognition.onend = () => {'));
    expect(onend.slice(0, 1200)).toContain('recognition.onresult({ resultIndex: 0, results: [fake] })');
  });

  it('speechSynthesis.speaking이 12초 넘게 굳으면 강제로 취소해 마이크를 되살린다', () => {
    expect(hook).toContain('Date.now() - pausedAtRef.current > 12000');
    expect(hook).toContain('synth.cancel()');
  });

  it.each(['components/common/KioskVoiceCommand.jsx', 'components/common/GlobalVoiceCommand.jsx'])(
    '%s: "네, 확인했어요"는 0.9초 넘게 걸릴 때만 말하고 처리 종료 시 타이머를 정리한다',
    (file) => {
      const src = read(file);
      expect(src).toContain('const ackTimer = setTimeout(() => {');
      expect(src).toContain('}, 900);');
      expect(src).toContain('clearTimeout(ackTimer);');
    }
  );

  it('서버 음성 명령 호출은 12초 타임아웃(AbortController)으로 끝나 isHandlingRef가 영구 잠기지 않는다', () => {
    const svc = read('services/voiceCommandService.js');
    expect(svc).toContain('const VOICE_API_TIMEOUT_MS = 12000;');
    expect(svc).toContain('signal: controller.signal');
    expect(svc).toContain("throw new Error('음성 명령 응답 시간 초과')");
  });
});
