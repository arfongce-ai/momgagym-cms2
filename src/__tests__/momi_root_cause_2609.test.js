// [2026-09-30] 모미 음성인식 근본 원인 재조사 회귀 테스트.
// 실행형: 설치 결과 분류·오류 분류·마이크 판정(순수 함수). 정적: 컴포넌트 배선·진단 페이지 개인정보 경계.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  requestLocalRecognitionInstall,
  isLocalInstallRetryable,
  describeLocalInstallFailure,
  classifyRecognitionError,
  classifyMicMeasurement,
  describeMicDiagnostic,
  hasMicSignal,
} from '../utils/momiDiagnostics';

const read = (p) => readFileSync(join(__dirname, '..', p), 'utf-8');

afterEach(() => vi.useRealTimers());

describe('SpeechRecognition.install() 결과를 원인별로 구분한다', () => {
  it('install이 없으면 unsupported', async () => {
    await expect(requestLocalRecognitionInstall({})).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });

  it('예외 없이 false를 돌려주면 returned-false (스크린샷의 "설치에 실패했습니다" 경로)', async () => {
    const install = vi.fn().mockResolvedValue(false);
    await expect(requestLocalRecognitionInstall({ install })).resolves.toEqual({ ok: false, reason: 'returned-false' });
    expect(install).toHaveBeenCalledWith({ langs: ['ko-KR'], processLocally: true });
  });

  it('true면 성공', async () => {
    await expect(requestLocalRecognitionInstall({ install: async () => true })).resolves.toEqual({ ok: true });
  });

  it('거부(reject)와 동기 예외는 threw + 예외 이름', async () => {
    const rejected = new DOMException('x', 'NotAllowedError');
    await expect(requestLocalRecognitionInstall({ install: () => Promise.reject(rejected) }))
      .resolves.toEqual({ ok: false, reason: 'threw', detail: 'NotAllowedError' });
    await expect(requestLocalRecognitionInstall({ install: () => { throw new TypeError('bad'); } }))
      .resolves.toEqual({ ok: false, reason: 'threw', detail: 'TypeError' });
  });

  it('응답이 없으면 시간 초과로 끝난다(인식기가 꺼진 채 무한 대기하지 않음)', async () => {
    vi.useFakeTimers();
    const pending = requestLocalRecognitionInstall({ install: () => new Promise(() => {}) }, 5000);
    await vi.advanceTimersByTimeAsync(5001);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('사유별 안내 문구가 다르고, 재시도 가치가 없는 사유는 버튼을 숨긴다', () => {
    const texts = ['returned-false', 'timeout', 'threw', 'unsupported', 'fallback'].map((r) => describeLocalInstallFailure(r, 'X'));
    expect(new Set(texts).size).toBe(5);
    expect(isLocalInstallRetryable('returned-false')).toBe(false);
    expect(isLocalInstallRetryable('unsupported')).toBe(false);
    expect(isLocalInstallRetryable('timeout')).toBe(true);
    expect(isLocalInstallRetryable('threw')).toBe(true);
    expect(isLocalInstallRetryable('fallback')).toBe(true);
  });
});

describe('SpeechRecognition 오류 분류 (앱이 만든 오류 vs 브라우저 오류)', () => {
  it('모미가 abort()한 직후의 aborted는 app-abort, 아니면 aborted', () => {
    expect(classifyRecognitionError('aborted', { abortedByApp: true })).toBe('app-abort');
    expect(classifyRecognitionError('aborted', { abortedByApp: false })).toBe('aborted');
  });

  it('network·audio-capture는 브라우저/서비스 오류로 보고한다(앱이 만든 값 아님)', () => {
    expect(classifyRecognitionError('network', { localMode: 'remote' })).toBe('report');
    expect(classifyRecognitionError('audio-capture', {})).toBe('report');
    expect(classifyRecognitionError('no-speech', {})).toBe('no-speech');
  });

  it('로컬 처리 중 language-not-supported/service-not-allowed는 원격으로 되돌린다', () => {
    expect(classifyRecognitionError('language-not-supported', { localMode: 'local' })).toBe('local-fallback');
    expect(classifyRecognitionError('service-not-allowed', { localMode: 'local' })).toBe('local-fallback');
  });

  it('원격 모드에서는 같은 오류가 재시작으로 회복되지 않으므로 중단(fatal)한다', () => {
    expect(classifyRecognitionError('language-not-supported', { localMode: 'remote' })).toBe('fatal');
    expect(classifyRecognitionError('service-not-allowed', { localMode: 'remote' })).toBe('fatal');
    expect(classifyRecognitionError('not-allowed', { localMode: 'local' })).toBe('fatal');
  });
});

describe('마이크 측정 판정', () => {
  it('음소거·컨텍스트 미시작·완전 무음·조기 발화·저신호·정상을 구분한다', () => {
    expect(classifyMicMeasurement({ ambientRms: 0.02, voiceRms: 0.2, trackMuted: true })).toBe('track-muted');
    expect(classifyMicMeasurement({ ambientRms: 0.02, voiceRms: 0.2, contextState: 'suspended' })).toBe('context-not-running');
    expect(classifyMicMeasurement({ ambientRms: 0, voiceRms: 0.0001, contextState: 'running' })).toBe('silent-input');
    expect(classifyMicMeasurement({ ambientRms: 0.05, voiceRms: 0.06, contextState: 'running' })).toBe('ambient-loud-or-early-speech');
    expect(classifyMicMeasurement({ ambientRms: 0.004, voiceRms: 0.005, contextState: 'running' })).toBe('signal-low');
    expect(classifyMicMeasurement({ ambientRms: 0.004, voiceRms: 0.03, contextState: 'running' })).toBe('signal-detected');
    expect(hasMicSignal(0.004, 0.03)).toBe(true);
  });

  it('진단 문구에 측정 수치가 포함돼 사용자가 근거를 볼 수 있다', () => {
    const text = describeMicDiagnostic({ verdict: 'signal-low', ambientRms: 0.004, voiceRms: 0.005 });
    expect(text).toContain('0.0040');
    expect(text).toContain('0.0050');
    expect(describeMicDiagnostic({ reason: 'NotAllowedError' })).toContain('NotAllowedError');
  });
});

describe('배선', () => {
  const hook = read('hooks/useMomiVoice.js');

  it('훅: 로컬 실패 시 processLocally를 실제로 false로 되돌리고 원격 모드로 기록한다', () => {
    const fallback = hook.slice(hook.indexOf("if (errorKind === 'local-fallback') {"));
    expect(fallback.slice(0, 400)).toContain('recognition.processLocally = false;');
    expect(fallback.slice(0, 400)).toContain("localRecognitionModeRef.current = 'remote';");
    expect(fallback.slice(0, 500)).toContain("onRecognitionStatus?.('local-fallback', event.error)");
  });

  it('훅: 앱이 abort()하는 세 경로(TTS 정지·진단·설치)가 abortedByAppRef를 먼저 올린다', () => {
    expect((hook.match(/abortedByAppRef\.current = true;/g) || []).length).toBe(3);
  });

  it('훅: 설치 실패 사유를 상태 콜백으로 전달하고 예외 문구로 뭉개지 않는다', () => {
    expect(hook).toContain("onRecognitionStatus?.('local-install-failed', installed.reason, installed.detail)");
    expect(hook).not.toContain("throw new Error('한국어 음성 팩 설치에 실패했습니다.')");
  });

  it.each(['components/common/GlobalVoiceCommand.jsx', 'components/common/KioskVoiceCommand.jsx'])(
    '%s: 설치 실패 사유는 인식 재시작(onstart)으로 상태가 덮여도 유지된다',
    (file) => {
      const src = read(file);
      expect(src).toContain('const [localInstallFailure, setLocalInstallFailure] = useState(null);');
      expect(src).toContain("if (status === 'local-install-failed') setLocalInstallFailure({ reason, detail });");
      expect(src).toContain('const localInstallText = localInstallFailure');
      expect(src).toContain('describeLocalInstallFailure(localInstallFailure.reason, localInstallFailure.detail)');
      expect(src).toContain('isLocalInstallRetryable(localInstallFailure.reason)');
      expect(src).toContain('describeMicDiagnostic(result)');
    }
  );

  it('/mic-test: 환경 조사·원시/처리 측정·설치 시험을 제공하고 발화 내용은 기록하지 않는다', () => {
    const page = read('pages/MicTest.jsx');
    for (const needle of ['SR.available(', 'measureMicrophone(constraints)', 'requestLocalRecognitionInstall(SR)', 'navigator.clipboard.writeText']) {
      expect(page).toContain(needle);
    }
    expect(page).not.toContain('last[0].transcript}');
    expect(page).not.toContain('fetch(');
    expect(page).not.toContain('XMLHttpRequest');
    expect(page).not.toContain('sendBeacon');
  });
});
