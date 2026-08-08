// KioskVoiceCommand.jsx — 키오스크 전용 "버튼 없는 상시 감지" 배선 확인.
// GlobalVoiceCommand.jsx(momi_speech.test.js 참고)와 명령 처리 로직은 같은
// 패턴이라 정적 소스 패턴 테스트도 같은 방식을 따른다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('KioskVoiceCommand.jsx — 버튼 없이 자동으로 상시 감지를 시작한다', () => {
  const src = readSrc('src', 'components', 'common', 'KioskVoiceCommand.jsx');

  it('useMomiVoice·useMomiSpeech·processVoiceCommand를 불러와서 쓴다', () => {
    expect(src).toContain("from '../../hooks/useMomiVoice'");
    expect(src).toContain("from '../../hooks/useMomiSpeech'");
    expect(src).toContain("from '../../services/voiceCommandService'");
  });

  it('마운트 시 useEffect 안에서 startListening을 자동으로 부른다(클릭 대기 없음)', () => {
    const effectStart = src.indexOf('useEffect(() => {');
    const effectEnd = src.indexOf('}, [supported, startListening]);', effectStart);
    const effectBody = src.slice(effectStart, effectEnd);
    expect(effectBody).toContain('if (supported) startListening();');
  });

  it('버튼(onClick 토글)이 없다 — 표시등만 있고 클릭 핸들러가 없다', () => {
    expect(src).not.toContain('onClick');
    expect(src).not.toContain('<button');
  });

  it('명령 처리 결과를 화면 표시와 동시에 speak()로 읽어준다(GlobalVoiceCommand와 동일 패턴)', () => {
    const handleStart = src.indexOf('const handleCommand = useCallback(');
    const handleEnd = src.indexOf('[role, user, allMembers, navigate, speak]');
    const handleBody = src.slice(handleStart, handleEnd);
    expect(handleBody).toContain('setFeedback(message);');
    expect(handleBody).toContain('speak(message);');
  });

  it('"모미야"만 듣고 명령이 없으면(onWakeOnly) 들었다는 걸 화면 표시+음성으로 알려준다', () => {
    const wakeOnlyStart = src.indexOf('const handleWakeOnly = useCallback(() => {');
    const wakeOnlyEnd = src.indexOf('}, [speak]);', wakeOnlyStart);
    const wakeOnlyBody = src.slice(wakeOnlyStart, wakeOnlyEnd);
    expect(wakeOnlyBody).toContain('setFeedback(message);');
    expect(wakeOnlyBody).toContain('speak(message);');
  });

  it('useMomiVoice에 onCommand·onWakeOnly·onMismatch·onErrorOccurred를 모두 연결한다', () => {
    expect(src).toContain('onCommand: handleCommand,');
    expect(src).toContain('onWakeOnly: handleWakeOnly,');
    expect(src).toContain('onMismatch: handleMismatch,');
    expect(src).toContain('onErrorOccurred: handleErrorOccurred,');
  });

  it('웨이크워드 불일치 시(handleMismatch) 소리내어 읽지는 않는다(상시 감지라 일반 대화도 계속 들어옴)', () => {
    const mismatchStart = src.indexOf('const handleMismatch = useCallback((heard) => {');
    const mismatchEnd = src.indexOf('}, []);', mismatchStart);
    const mismatchBody = src.slice(mismatchStart, mismatchEnd);
    expect(mismatchBody).not.toContain('speak(');
  });

  it('지원 안 하는 브라우저면 null을 반환한다(GlobalVoiceCommand와 동일한 가드)', () => {
    expect(src).toContain('if (!supported) return null;');
  });

  it('unlockSpeech(iOS 전용 트릭)를 호출하지 않는다 — 키오스크는 항상 비-iOS', () => {
    expect(src).not.toContain('unlockSpeech()');
  });

  it('자동 시작 useEffect엔 "모미야" 이전에 speak()를 부르는 진단용 확인이 없다', () => {
    // [2026-08-08] TTS 정상 동작을 실기기 캡처로 이미 확인했고(원인은 웨이크워드
    // 오인식이었음, momi_voice.test.js 참고), 요청하신 흐름엔 그 앞에 아무 발화가
    // 없어야 해서 진단용 확인 문구를 뺐다.
    const effectStart = src.indexOf('useEffect(() => {');
    const effectEnd = src.indexOf('}, [supported, startListening]);', effectStart);
    const effectBody = src.slice(effectStart, effectEnd);
    expect(effectBody).not.toContain("speak('상시 감지를 시작합니다.');");
    expect(effectBody).not.toContain("setFeedback('상시 감지를 시작합니다.');");
  });

  it('"모미야→네,선생님→명령→인지확인→실행" 흐름이 GlobalVoiceCommand와 동일하다', () => {
    const wakeOnlyStart = src.indexOf('const handleWakeOnly = useCallback(() => {');
    const wakeOnlyEnd = src.indexOf('}, [speak]);', wakeOnlyStart);
    expect(src.slice(wakeOnlyStart, wakeOnlyEnd)).toContain("const message = '네, 선생님.';");

    const handleStart = src.indexOf('const handleCommand = useCallback(');
    const processCallIdx = src.indexOf('await processVoiceCommand(', handleStart);
    const preProcessBody = src.slice(handleStart, processCallIdx);
    expect(preProcessBody).toContain("setFeedback('네, 확인했어요.');");
    expect(preProcessBody).toContain("speak('네, 확인했어요.');");
  });
});

describe('AppLayout.jsx — 키오스크에서 KioskVoiceCommand를 불러와서 쓴다', () => {
  const src = readSrc('src', 'components', 'layout', 'AppLayout.jsx');

  it('KioskVoiceCommand를 import한다', () => {
    expect(src).toContain("import KioskVoiceCommand from '../common/KioskVoiceCommand';");
  });
});
