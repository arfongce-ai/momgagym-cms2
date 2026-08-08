// 모미 응답을 브라우저 TTS(SpeechSynthesis)로 읽어주는 기능(입) 배선 확인.
// useMomiVoice.js(귀)와 마찬가지로 이 프로젝트 vitest 환경은 'node'라 jsdom 기반
// 실제 마운트 테스트 대신 정적 소스 패턴 테스트 관례를 따른다(momi_auto_note.test.js 참고).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('useMomiSpeech.js — 브라우저 내장 TTS 훅', () => {
  const src = readSrc('src', 'hooks', 'useMomiSpeech.js');

  it('window.speechSynthesis 지원 여부를 감지한다', () => {
    expect(src).toContain('window.speechSynthesis');
  });

  it('말하기 전에 이전 발화를 취소한다(끼어들기 방지)', () => {
    const speakStart = src.indexOf('const speak = useCallback');
    const speakEnd = src.indexOf('}, []);', speakStart);
    const speakBody = src.slice(speakStart, speakEnd);
    expect(speakBody).toContain('synth.cancel();');
    expect(speakBody.indexOf('synth.cancel();')).toBeLessThan(speakBody.indexOf('synth.speak('));
  });

  it("발화 언어를 'ko-KR'로 설정한다", () => {
    expect(src).toContain("utterance.lang = 'ko-KR';");
  });

  it('unlock()은 사용자 탭 이벤트 안에서 무음 발화로 iOS 오디오를 미리 잠금 해제한다', () => {
    const unlockStart = src.indexOf('const unlock = useCallback');
    const unlockEnd = src.indexOf('}, []);', unlockStart);
    const unlockBody = src.slice(unlockStart, unlockEnd);
    expect(unlockBody).toContain('primer.volume = 0;');
    expect(unlockBody).toContain('synth.speak(primer);');
  });

  it('언마운트 시 말하던 중이면 멈춘다', () => {
    const effectStart = src.indexOf('useEffect(() => {');
    const effectEnd = src.indexOf('}, []);', effectStart);
    const effectBody = src.slice(effectStart, effectEnd);
    expect(effectBody).toContain('synthRef.current?.cancel();');
  });

  it('supported·speak·stop·unlock을 반환한다', () => {
    expect(src).toContain('return { supported, speak, stop, unlock };');
  });
});

describe('GlobalVoiceCommand.jsx — TTS 연결 확인', () => {
  const src = readSrc('src', 'components', 'common', 'GlobalVoiceCommand.jsx');

  it('useMomiSpeech를 불러와서 쓴다', () => {
    expect(src).toContain("from '../../hooks/useMomiSpeech'");
    expect(src).toContain('useMomiSpeech()');
  });

  it('handleCommand 결과 메시지를 화면 표시와 동시에 speak()로 읽어준다(문구 불일치 방지)', () => {
    const handleStart = src.indexOf('const handleCommand = useCallback(');
    const handleEnd = src.indexOf('[role, user, allMembers, navigate, speak]');
    const handleBody = src.slice(handleStart, handleEnd);
    expect(handleBody).toContain('setFeedback(message);');
    expect(handleBody).toContain('speak(message);');
  });

  it('마이크를 끄면 말하던 중인 음성도 함께 멈춘다', () => {
    const toggleStart = src.indexOf('const toggle = () => {');
    const toggleEnd = src.indexOf('};', toggleStart);
    const toggleBody = src.slice(toggleStart, toggleEnd);
    expect(toggleBody).toContain('stopSpeaking();');
  });

  it('마이크를 켜는 탭 이벤트 안에서 startListening보다 먼저 오디오를 잠금 해제한다(iOS 대응)', () => {
    const toggleStart = src.indexOf('const toggle = () => {');
    const toggleEnd = src.indexOf('};', toggleStart);
    const toggleBody = src.slice(toggleStart, toggleEnd);
    expect(toggleBody).toContain('unlockSpeech();');
    expect(toggleBody.indexOf('unlockSpeech();')).toBeLessThan(
      toggleBody.indexOf('startListening();')
    );
  });

  it('"모미야"만 듣고 명령이 없으면(onWakeOnly) 들었다는 걸 화면 표시+음성으로 알려준다', () => {
    const wakeOnlyStart = src.indexOf('const handleWakeOnly = useCallback(() => {');
    const wakeOnlyEnd = src.indexOf('}, [speak]);', wakeOnlyStart);
    const wakeOnlyBody = src.slice(wakeOnlyStart, wakeOnlyEnd);
    expect(wakeOnlyBody).toContain('setFeedback(message);');
    expect(wakeOnlyBody).toContain('speak(message);');
  });

  it('useMomiVoice에 onWakeOnly를 handleWakeOnly로 연결한다', () => {
    expect(src).toContain('onWakeOnly: handleWakeOnly,');
  });

  it('웨이크워드 불일치 시(handleMismatch) 들린 말을 화면에 보여주되 소리내어 읽지는 않는다', () => {
    const mismatchStart = src.indexOf('const handleMismatch = useCallback((heard) => {');
    const mismatchEnd = src.indexOf('}, []);', mismatchStart);
    const mismatchBody = src.slice(mismatchStart, mismatchEnd);
    expect(mismatchBody).toContain("heard ? `\"${heard}\"` : '(빈 소리만 인식됨)'");
    expect(mismatchBody).not.toContain('speak(');
  });

  it('인식 오류(handleErrorOccurred)를 사람이 읽을 수 있는 문구로 화면에 보여준다', () => {
    const errorStart = src.indexOf('const handleErrorOccurred = useCallback((errorCode) => {');
    const errorEnd = src.indexOf('}, []);', errorStart);
    const errorBody = src.slice(errorStart, errorEnd);
    expect(errorBody).toContain("'not-allowed': '마이크 권한이 거부돼 있어요.'");
  });

  it('useMomiVoice에 onMismatch·onErrorOccurred를 연결한다', () => {
    expect(src).toContain('onMismatch: handleMismatch,');
    expect(src).toContain('onErrorOccurred: handleErrorOccurred,');
  });

  it('마이크를 켜는 순간(진단용) "듣고 있어요"를 화면+음성으로 바로 확인해준다', () => {
    // [2026-08-08] "모미야" 이후 반응이 없다는 문의 대응 — 이 확인 문구가 안
    // 들리면 웨이크워드 인식이 아니라 이 기기 TTS 자체 문제라는 걸 바로 알 수 있다.
    const toggleStart = src.indexOf('const toggle = () => {');
    const toggleEnd = src.indexOf('};', toggleStart);
    const toggleBody = src.slice(toggleStart, toggleEnd);
    expect(toggleBody).toContain("setFeedback('듣고 있어요.');");
    expect(toggleBody).toContain("speak('듣고 있어요.');");
    // startListening() 이후에 나와야(마이크가 실제로 켜진 다음 확인이라는 순서 보장)
    expect(toggleBody.indexOf('startListening();')).toBeLessThan(
      toggleBody.indexOf("speak('듣고 있어요.');")
    );
  });
});

// [요청 흐름 2026-08-08] "모미야"→"네, 선생님"→(명령)→명령 인지 확인→실행/응답
// 5단계 대화 흐름 배선 확인.
describe('GlobalVoiceCommand.jsx — "모미야→네,선생님→명령→인지확인→실행" 대화 흐름', () => {
  const src = readSrc('src', 'components', 'common', 'GlobalVoiceCommand.jsx');

  it('웨이크워드만 들으면 "네, 선생님"으로 응답한다', () => {
    const wakeOnlyStart = src.indexOf('const handleWakeOnly = useCallback(() => {');
    const wakeOnlyEnd = src.indexOf('}, [speak]);', wakeOnlyStart);
    const wakeOnlyBody = src.slice(wakeOnlyStart, wakeOnlyEnd);
    expect(wakeOnlyBody).toContain("const message = '네, 선생님.';");
  });

  it('실행 명령을 들으면 처리(API 호출)를 시작하기 전에 먼저 "확인했다"고 알려준다', () => {
    const handleStart = src.indexOf('const handleCommand = useCallback(');
    const processCallIdx = src.indexOf('await processVoiceCommand(', handleStart);
    const preProcessBody = src.slice(handleStart, processCallIdx);
    expect(preProcessBody).toContain("setFeedback('네, 확인했어요.');");
    expect(preProcessBody).toContain("speak('네, 확인했어요.');");
  });

  it('명령 인지 확인 뒤에도 최종 처리 결과(이동/응답 메시지)를 별도로 다시 알려준다', () => {
    const handleStart = src.indexOf('const handleCommand = useCallback(');
    const handleEnd = src.indexOf('[role, user, allMembers, navigate, speak]');
    const handleBody = src.slice(handleStart, handleEnd);
    // speak(message)가 "네, 확인했어요" 이후 최소 한 번 더(최종 결과용) 나와야 한다.
    const speakCalls = handleBody.match(/speak\(/g) || [];
    expect(speakCalls.length).toBeGreaterThanOrEqual(2);
  });
});
