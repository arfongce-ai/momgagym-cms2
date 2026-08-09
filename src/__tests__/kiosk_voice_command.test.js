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
    const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
    const handleBody = src.slice(handleStart, handleEnd);
    expect(handleBody).toContain('setFeedback(diagDetail ? ');
    expect(handleBody).toContain(': message);');
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

  it('지원 안 하는 브라우저면 이유를 화면에 보여준다(예전엔 그냥 null이라 원인 구분 불가)', () => {
    expect(src).toContain('if (!supported) {');
    expect(src).toContain('이 브라우저는 음성인식(SpeechRecognition)을 지원하지 않아요.');
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

  it('명령 처리가 실패하면 실패 원인(diagDetail)을 화면에도 보여준다(회귀 방지)', () => {
    // [버그 수정 2026-08-08] "키오스크에서 반응이 없다"는 문의 대응.
    // GlobalVoiceCommand.jsx와 동일 패턴.
    const handleStart = src.indexOf('const handleCommand = useCallback(');
    const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
    const handleBody = src.slice(handleStart, handleEnd);
    expect(handleBody).toContain('diagDetail = e?.message || String(e);');
    expect(handleBody).toContain(
      "setFeedback(diagDetail ? `${message}\\n[진단] ${diagDetail}` : message);"
    );
    expect(handleBody).not.toContain('speak(diagDetail');
  });
});

// [버그 수정 — 명령 겹침 2026-08-09] useMomiVoice.js의 onresult는 onCommand를
// await 없이 fire-and-forget으로 부른다 — 이전 명령이 아직 처리 중(특히
// 네트워크 응답을 기다리는 동안, awaitReply를 걸기 전)일 때 새 "모미야, [명령]"이
// 겹쳐 들어오면 handleCommand가 두 번 동시에 돌면서 awaitReply 슬롯(훅 안에
// 하나뿐)을 두 번째 호출이 덮어써, 첫 번째 명령의 확인 흐름이 응답을 영영 못
// 받고 멈춰버릴 수 있었다.
describe('KioskVoiceCommand.jsx — 명령 겹침 방지(회귀 방지)', () => {
  const src = readSrc('src', 'components', 'common', 'KioskVoiceCommand.jsx');
  const handleStart = src.indexOf('const handleCommand = useCallback(');
  const handleEnd = src.indexOf('const handleWakeOnly = useCallback(');
  const handleBody = src.slice(handleStart, handleEnd);

  it('handleCommand 맨 앞에서 isHandlingRef를 확인해서 이미 처리 중이면 곧바로 반환한다', () => {
    const guardIdx = handleBody.indexOf('if (isHandlingRef.current) {');
    const asyncIdx = handleBody.indexOf('async (transcript) => {');
    expect(guardIdx).toBeGreaterThan(-1);
    // async 함수 시작 직후여야(다른 로직보다 먼저 검사) 겹침을 확실히 막는다.
    expect(guardIdx).toBeLessThan(handleBody.indexOf('setFeedback', asyncIdx));
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

describe('AppLayout.jsx — 키오스크에서 KioskVoiceCommand를 불러와서 쓴다', () => {
  const src = readSrc('src', 'components', 'layout', 'AppLayout.jsx');

  it('KioskVoiceCommand를 import한다', () => {
    expect(src).toContain("import KioskVoiceCommand from '../common/KioskVoiceCommand';");
  });
});

// [음성 대화형 2026-08-09] "그럼 그건요?" 같은 후속 질문을 알아듣게 하려면
// processVoiceCommand에 history를 넘겨야 하고, chat 응답이 오면 다음 턴을
// 위해 그 왕복을 기록해둬야 한다. 실제 로직은 voice/chatHistory.js(별도
// 테스트됨) — 여기선 이 컴포넌트가 그 함수들을 올바른 시점에 부르는지만
// 확인한다.
describe('KioskVoiceCommand.jsx — 음성 대화형(history) 배선', () => {
  const src = readSrc('src', 'components', 'common', 'KioskVoiceCommand.jsx');
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

  it('예약 생성/취소/변경·타이머 제어·화면 이동처럼 실제 액션이 일어나면 clearHistory로 잡담 맥락을 정리한다', () => {
    const occurrences = (handleBody.match(/clearHistory\(chatHistoryRef, lastChatAtRef\)/g) || []).length;
    // reservation_propose / reservation_cancel_propose / reservation_reschedule_propose /
    // timer_control(음성 타이머 제어 2026-08-09 신규) / navigate(else) = 5곳.
    expect(occurrences).toBe(5);
  });
});
