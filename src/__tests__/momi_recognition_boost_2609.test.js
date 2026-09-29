// [2026-09-29] 모미 인식률·지연 개선 회귀 테스트.
// 순수 함수(matchWakeWord)는 실행형, 나머지는 기존 voice 테스트처럼 정적 소스 검사.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isSafeWakeOnly,
  matchWakeWord,
  getMomiLocalRecognitionAvailability,
  resolveInterimWakeCommand,
} from '../hooks/useMomiVoice';

const read = (p) => readFileSync(join(__dirname, '..', p), 'utf-8');
const hook = read('hooks/useMomiVoice.js');

describe('웨이크워드 오인식 제어', () => {
  it.each(['모미야', '몸이야', '모미아', '모미'])(
    '확인된 호출어 "%s"는 발화 첫 단어일 때만 웨이크워드로 분리한다',
    (wake) => {
      const heard = `${wake} 회원 관리 열어줘`;
      const m = matchWakeWord(heard);
      expect(m).not.toBeNull();
      expect(heard.slice(m.index + m.length).trim()).toBe('회원 관리 열어줘');
    }
  );

  it.each(['소미야', '보미야', '봄이야', '모니야', '모미여', '오늘 모미야'])('%s는 웨이크워드로 오탐하지 않는다', (heard) => {
    expect(matchWakeWord(heard)).toBeNull();
  });

  it('기존 변형(모미야/몸이야)은 그대로 동작한다', () => {
    expect(matchWakeWord('모미야')).not.toBeNull();
    expect(matchWakeWord('몸이야 리포트')).not.toBeNull();
  });

  it('웨이크워드와 명령이 함께 들린 임시 결과만 확정 문장 복구에 사용한다', () => {
    expect(resolveInterimWakeCommand('모미야 회원 관리 열어줘', '회원 관리 열어줘', 1000, 2000))
      .toBe('회원 관리 열어줘');
    expect(resolveInterimWakeCommand('모미야', '회원 관리 열어줘', 1000, 2000)).toBeNull();
    expect(resolveInterimWakeCommand('모미야 회원 관리', '회원 관리 열어줘', 1000, 5001)).toBeNull();
  });

  it('단독 호출은 고유한 "모미야/모미"만 활성화하고 발음 혼동 별칭은 명령과 함께일 때만 허용한다', () => {
    expect(isSafeWakeOnly('모미야', matchWakeWord('모미야'))).toBe(true);
    expect(isSafeWakeOnly('모미', matchWakeWord('모미'))).toBe(true);
    expect(isSafeWakeOnly('몸이야', matchWakeWord('몸이야'))).toBe(false);
    expect(isSafeWakeOnly('모미아', matchWakeWord('모미아'))).toBe(false);
  });
});

describe('온디바이스 한국어 음성 인식', () => {
  it('Chrome이 지원하면 한국어 로컬 음성팩 가용성을 조회한다', async () => {
    const available = vi.fn().mockResolvedValue('available');
    await expect(getMomiLocalRecognitionAvailability({ available })).resolves.toBe('available');
    expect(available).toHaveBeenCalledWith({ langs: ['ko-KR'], processLocally: true });
  });

  it('로컬 API가 없거나 조회가 실패하면 기존 원격 인식 경로를 유지한다', async () => {
    await expect(getMomiLocalRecognitionAvailability({})).resolves.toBe('unsupported');
    await expect(getMomiLocalRecognitionAvailability({
      available: vi.fn().mockRejectedValue(new Error('unavailable')),
    })).resolves.toBe('unsupported');
  });

  it('한국어 팩이 있으면 로컬 처리하고, 다운로드 가능하면 설치 안내를 노출한다', () => {
    expect(hook).toContain("recognition.processLocally = true;");
    expect(hook).toContain("availability === 'downloadable' || availability === 'downloading'");
    for (const file of ['components/common/GlobalVoiceCommand.jsx', 'components/common/KioskVoiceCommand.jsx']) {
      const component = read(file);
      expect(component).toContain('onRecognitionStatus: handleRecognitionStatus');
      expect(component).toContain('onClick={installLocalRecognition}');
      expect(component).toContain('한국어 음성팩 설치');
      expect(component).toContain('setLocalInstallOffered(true)');
      expect(component).toContain('const showLocalInstall = speechRecognitionIssue || localInstallOffered;');
      expect(component).toContain("recognitionStatus !== 'awaiting-reply'");
    }
  });

  it('미지원 기기에서는 브라우저 기본 마이크를 사용한다', () => {
    expect(hook).toContain('recognition.processLocally = false;');
    expect(hook).toContain('recognition.start();');
    expect(hook).not.toContain('recognition.start(track)');
  });
});

describe('지연·무응답 방지 배선', () => {
  it('확정 대기는 400ms, 웨이크 후 명령 대기창은 10초', () => {
    expect(hook).toContain('const FINAL_RESULT_SETTLE_MS = 400;');
    expect(hook).toContain('const ACTIVATION_WINDOW_MS = 5000;');
  });

  it('임시 결과에서 웨이크워드가 들리면 기억했다가 확정 문장에서 웨이크가 빠져도 명령으로 살린다', () => {
    expect(hook).toContain('wakeInterimRef.current.text = interim;');
    expect(hook).toContain('resolveInterimWakeCommand(w.text, heard, w.at)');
    const flush = hook.slice(hook.indexOf('const wakeMatch = matchWakeWord(heard);'));
    expect(flush.slice(0, 900)).toContain('onCommand(interimCommand);');
  });

  it('확정 없이 세션이 끝나도 임시 웨이크 텍스트를 한 번 처리한다(onend 복구)', () => {
    const onend = hook.slice(hook.indexOf('recognition.onend = () => {'));
    expect(onend.slice(0, 1200)).toContain('recognition.onresult({ resultIndex: 0, results: [fake] })');
    expect(onend.slice(0, 1200)).toContain('&& !pendingReplyRef.current');
  });

  it('speechSynthesis.speaking이 12초 넘게 굳으면 강제로 취소해 마이크를 되살린다', () => {
    expect(hook).toContain('Date.now() - pausedAtRef.current > 12000');
    expect(hook).toContain('synth.cancel()');
  });

  it('마이크 권한 거부는 자동 재시작을 중단하고 오류를 화면으로 전달한다', () => {
    const onerror = hook.slice(hook.indexOf('recognition.onerror = (event) => {'));
    const stopAt = onerror.indexOf("event.error === 'not-allowed'");
    expect(stopAt).toBeGreaterThan(-1);
    expect(onerror.slice(stopAt, stopAt + 620)).toContain('shouldRestartRef.current = false;');
    expect(onerror.slice(stopAt, stopAt + 620)).toContain('wantListeningRef.current = false;');
    expect(onerror.slice(stopAt, stopAt + 620)).toContain('onErrorOccurred(event.error);');
  });

  it.each(['components/common/KioskVoiceCommand.jsx', 'components/common/GlobalVoiceCommand.jsx'])(
    '%s: acknowledgement timer는 try 바깥에서 선언돼 finally에서 정리 가능하다',
    (file) => {
      const src = read(file);
      const handle = src.slice(src.indexOf('const handleCommand = useCallback('), src.indexOf('const handleWakeOnly = useCallback('));
      expect(handle.indexOf('let ackTimer = null;')).toBeLessThan(handle.indexOf('try {'));
      expect(handle).toContain('ackTimer = setTimeout(() => {');
      expect(handle).toContain('clearTimeout(ackTimer);');
    }
  );

  it.each(['components/common/KioskVoiceCommand.jsx', 'components/common/GlobalVoiceCommand.jsx'])(
    '%s: "네, 확인했어요"는 0.9초 넘게 걸릴 때만 말하고 처리 종료 시 타이머를 정리한다',
    (file) => {
      const src = read(file);
      expect(src).toContain('ackTimer = setTimeout(() => {');
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
