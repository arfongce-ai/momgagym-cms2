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
    const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
    const handleBody = src.slice(handleStart, handleEnd);
    // [2026-08-08] 실패 시 진단 상세를 덧붙이는 삼항연산자로 바뀌었지만, 성공
    // 시(diagDetail 없을 때)엔 여전히 순수 message가 화면에 그대로 나간다.
    expect(handleBody).toContain('setFeedback(diagDetail ? ');
    expect(handleBody).toContain(': message);');
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

  it('마이크 켜는 토글엔 "모미야" 이전에 speak()를 부르는 진단용 확인이 없다', () => {
    // [2026-08-08] TTS 정상 동작을 실기기 캡처로 이미 확인했고(원인은 웨이크워드
    // 오인식이었음, momi_voice.test.js 참고), 요청하신 흐름("모미야"→"네,선생님"
    // →...)엔 그 앞에 아무 발화가 없어야 해서 진단용 확인 문구를 뺐다.
    const toggleStart = src.indexOf('const toggle = () => {');
    const toggleEnd = src.indexOf('};', toggleStart);
    const toggleBody = src.slice(toggleStart, toggleEnd);
    expect(toggleBody).not.toContain("speak('듣고 있어요.');");
    expect(toggleBody).not.toContain("setFeedback('듣고 있어요.');");
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
    const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
    const handleBody = src.slice(handleStart, handleEnd);
    // speak(message)가 "네, 확인했어요" 이후 최소 한 번 더(최종 결과용) 나와야 한다.
    const speakCalls = handleBody.match(/speak\(/g) || [];
    expect(speakCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('명령 처리가 실패하면 실패 원인(diagDetail)을 화면에도 보여준다(회귀 방지)', () => {
    // [버그 수정 2026-08-08] "명령이 실행 안 된다"는 문의 대응 — 사과 메시지만
    // 보여주면 진짜 원인(API 크레딧 부족 등)을 알 길이 없었다. 음성으로는 사과
    // 문구만 자연스럽게 읽고, 화면에는 원인도 같이 보여준다.
    const handleStart = src.indexOf('const handleCommand = useCallback(');
    const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
    const handleBody = src.slice(handleStart, handleEnd);
    expect(handleBody).toContain('diagDetail = e?.message || String(e);');
    expect(handleBody).toContain(
      "setFeedback(diagDetail ? `${message}\\n[진단] ${diagDetail}` : message);"
    );
    // 소리로는 원인 문구 없이 사과 메시지만 자연스럽게 읽어야 한다.
    expect(handleBody).toContain('speak(message);');
    expect(handleBody).not.toContain('speak(diagDetail');
  });
});

// [버그 수정 — 명령 겹침 2026-08-09] KioskVoiceCommand.jsx와 동일한 이유 —
// useMomiVoice.js의 onresult가 onCommand를 await 없이 부르기 때문에, 이전
// 명령이 아직 처리 중일 때 새 명령이 겹치면 awaitReply 슬롯이 덮어써져 이전
// 명령의 확인 흐름이 응답을 영영 못 받고 멈출 수 있었다.
describe('GlobalVoiceCommand.jsx — 명령 겹침 방지(회귀 방지)', () => {
  const src = readSrc('src', 'components', 'common', 'GlobalVoiceCommand.jsx');
  const handleStart = src.indexOf('const handleCommand = useCallback(');
  const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
  const handleBody = src.slice(handleStart, handleEnd);

  it('handleCommand 맨 앞에서 isHandlingRef를 확인해서 이미 처리 중이면 곧바로 반환한다(setBusy보다도 먼저)', () => {
    const guardIdx = handleBody.indexOf('if (isHandlingRef.current) {');
    const busyIdx = handleBody.indexOf('setBusy(true);');
    expect(guardIdx).toBeGreaterThan(-1);
    // 겹친 명령은 이전 명령의 busy 상태를 건드리면 안 되므로, setBusy(true)보다
    // 먼저 검사해서 조기 반환해야 한다.
    expect(guardIdx).toBeLessThan(busyIdx);
  });

  it('처리를 시작하기 전에 isHandlingRef를 true로 올린다', () => {
    expect(handleBody).toContain('isHandlingRef.current = true;');
  });

  it('finally에서 항상(성공·실패·예약 확인 분기 모두) isHandlingRef를 false로 내린다', () => {
    const finallyIdx = handleBody.lastIndexOf('} finally {');
    const finallyBody = handleBody.slice(finallyIdx);
    expect(finallyBody).toContain('isHandlingRef.current = false;');
  });
});

// [음성 대화형 2026-08-09] KioskVoiceCommand.jsx와 동일 배선 확인.
describe('GlobalVoiceCommand.jsx — 음성 대화형(history) 배선', () => {
  const src = readSrc('src', 'components', 'common', 'GlobalVoiceCommand.jsx');
  const handleStart = src.indexOf('const handleCommand = useCallback(');
  const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
  const handleBody = src.slice(handleStart, handleEnd);

  it('chatHistory.js의 세 함수를 가져와 쓴다(새로 구현하지 않음)', () => {
    expect(src).toContain(
      "import { getActiveHistory, recordChatTurn, clearHistory } from '../../voice/chatHistory';"
    );
  });

  it('processVoiceCommand 호출 시 getActiveHistory로 직전 대화 맥락을 실어 보낸다', () => {
    expect(handleBody).toContain('history: getActiveHistory(chatHistoryRef, lastChatAtRef),');
  });

  it('chat 응답을 받으면 recordChatTurn으로 왕복을 기록한다', () => {
    const chatBranchIdx = handleBody.indexOf("result.type === 'chat'");
    const nextBranchIdx = handleBody.indexOf('} else {', chatBranchIdx);
    const chatBranch = handleBody.slice(chatBranchIdx, nextBranchIdx);
    expect(chatBranch).toContain('recordChatTurn(chatHistoryRef, lastChatAtRef, transcript, result.text);');
  });

  it('예약 생성/취소/변경·화면 이동처럼 실제 액션이 일어나면 clearHistory로 잡담 맥락을 정리한다', () => {
    const occurrences = (handleBody.match(/clearHistory\(chatHistoryRef, lastChatAtRef\)/g) || []).length;
    expect(occurrences).toBe(4);
  });
});

// [버그 수정 — 웨이크워드 이중 요구 2026-08-09] 실사용 스크린샷 확인 —
// 마이크 버튼을 눌러서 켰는데도 "모미야"가 없으면 명확한 명령("회원 관리
// 들어가 줘" 등)조차 무시됐다. 버튼을 누른 행위 자체가 이미 명시적 신호라
// 웨이크워드를 또 요구할 필요가 없다.
describe('GlobalVoiceCommand.jsx — requireWakeWord: false (버튼으로 켰으니 웨이크워드 중복 요구 안 함)', () => {
  const src = readSrc('src', 'components', 'common', 'GlobalVoiceCommand.jsx');

  it('useMomiVoice에 requireWakeWord: false를 넘긴다', () => {
    const start = src.indexOf('const { supported, listening, startListening, stopListening, awaitReply } = useMomiVoice({');
    const end = src.indexOf('});', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('requireWakeWord: false,');
  });
});
