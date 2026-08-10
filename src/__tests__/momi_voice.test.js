// useMomiVoice.js(귀) 수정사항 배선 확인:
//  1) iOS는 continuous:false로 두어 알려진 "세션 멈춤" 버그를 우회한다.
//  2) 인식 결과·에러가 더 이상 조용히 무시되지 않고 콘솔에 남는다(진단용).
// 이 hook 자체(useMomiVoice)는 실제 DOM/SpeechRecognition에 의존해 다른 voice
// 테스트처럼 정적 소스 패턴을 따르지만, 순수 함수인 matchWakeWord()는 로직이라
// 직접 import해서 실동작으로 검증한다(맨 아래 describe 참고).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { matchWakeWord } from '../hooks/useMomiVoice.js';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('useMomiVoice.js — iOS 대응 + 진단 로그', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it('iPhone/iPad를 유저에이전트로 감지한다', () => {
    expect(src).toContain('/iPad|iPhone|iPod/.test(ua)');
  });

  it('iPadOS 13+(유저에이전트가 MacIntel로 나오는 경우)도 터치 포인트로 감지한다', () => {
    expect(src).toContain("navigator.platform === 'MacIntel'");
    expect(src).toContain('navigator.maxTouchPoints > 1');
  });

  it('iOS에서만 continuous를 false로 둔다(그 외 브라우저는 기존 true 유지)', () => {
    expect(src).toContain('recognition.continuous = !isIOS();');
    // 예전처럼 무조건 true로 고정하는 코드가 되살아나지 않았는지도 함께 확인.
    expect(src).not.toMatch(/recognition\.continuous = true;/);
  });

  it('인식된 텍스트를 콘솔에 남긴다(원인 진단용)', () => {
    const resultStart = src.indexOf('recognition.onresult = (event) => {');
    const resultEnd = src.indexOf('};', resultStart);
    const resultBody = src.slice(resultStart, resultEnd);
    expect(resultBody).toContain("console.log('[모미] 들림 말:', heard);".replace('들림 말', '들린 말'));
  });

  it('인식 오류를 더 이상 무조건 무시하지 않고 원인을 콘솔에 남긴다', () => {
    const errorStart = src.indexOf('recognition.onerror = (event) => {');
    const errorEnd = src.indexOf('};', errorStart);
    const errorBody = src.slice(errorStart, errorEnd);
    expect(errorBody).toContain("console.warn('[모미] 인식 오류:', event.error);");
  });

  it('웨이크워드가 안 잡히면(빈 소리 포함) onMismatch로 화면에도 보여준다(콘솔 접근 불가 대응)', () => {
    const resultStart = src.indexOf('recognition.onresult = (event) => {');
    const resultEnd = src.indexOf('recognition.onerror', resultStart);
    const resultBody = src.slice(resultStart, resultEnd);
    expect(resultBody).toContain('if (onMismatch) onMismatch(heard);');
  });

  it('"모미야"만 듣고 명령이 안 붙으면 onWakeOnly를 호출한다(무반응처럼 보이는 것 방지)', () => {
    const resultStart = src.indexOf('recognition.onresult = (event) => {');
    const resultEnd = src.indexOf('recognition.onerror', resultStart);
    const resultBody = src.slice(resultStart, resultEnd);
    expect(resultBody).toContain('else if (!commandText && onWakeOnly)');
    expect(resultBody).toContain('onWakeOnly();');
  });

  it('인식 오류가 나면 콘솔뿐 아니라 onErrorOccurred로 화면에도 알린다', () => {
    const errorStart = src.indexOf('recognition.onerror = (event) => {');
    const errorEnd = src.indexOf('};', errorStart);
    const errorBody = src.slice(errorStart, errorEnd);
    expect(errorBody).toContain('if (onErrorOccurred) onErrorOccurred(event.error);');
  });

  it('no-speech(정상적인 무음 타임아웃)는 onErrorOccurred로 넘기지 않고 조용히 넘어간다', () => {
    // [버그 수정 2026-08-08] no-speech를 다른 오류와 똑같이 화면에 "[진단] 오류
    // 코드: no-speech"로 띄웠더니, 정상 동작(몇 초 무음 후 자동 재시작)인데도
    // "PC에서 오류가 난다"는 오해를 만들었다. 콘솔 로그는 남기되 화면엔 안 띄운다.
    const errorStart = src.indexOf('recognition.onerror = (event) => {');
    const errorEnd = src.indexOf('};', errorStart);
    const errorBody = src.slice(errorStart, errorEnd);
    expect(errorBody).toContain("if (event.error === 'no-speech') return;");
    expect(errorBody.indexOf("if (event.error === 'no-speech') return;")).toBeLessThan(
      errorBody.indexOf('if (onErrorOccurred) onErrorOccurred(event.error);')
    );
    // console.warn 자체는 no-speech도 여전히 남겨야(콘솔 접근 가능한 경우엔 진단용).
    expect(errorBody.indexOf("console.warn('[모미] 인식 오류:', event.error);")).toBeLessThan(
      errorBody.indexOf("if (event.error === 'no-speech') return;")
    );
  });

  it('onWakeOnly·onMismatch·onErrorOccurred·requireWakeWord 모두 useEffect 의존성 배열에 포함된다', () => {
    expect(src).toContain('}, [onCommand, onWakeOnly, onMismatch, onErrorOccurred, requireWakeWord]);');
  });

  it('"모미야"만 부르면 다음 발화를 기다리는 대기 상태(activated)로 들어간다', () => {
    const resultStart = src.indexOf('recognition.onresult = (event) => {');
    const resultEnd = src.indexOf('recognition.onerror', resultStart);
    const resultBody = src.slice(resultStart, resultEnd);
    expect(resultBody).toContain('activatedRef.current = true;');
    expect(resultBody).toContain('setTimeout(clearActivation, ACTIVATION_WINDOW_MS);');
  });

  it('대기 상태에서 다음 발화가 오면 "모미야" 없이도 그대로 명령으로 처리한다', () => {
    const resultStart = src.indexOf('recognition.onresult = (event) => {');
    const activatedCheckIdx = src.indexOf('if (activatedRef.current) {', resultStart);
    const wakeCheckIdx = src.indexOf('const wakeMatch = matchWakeWord(heard);', resultStart);
    // activated 체크가 웨이크워드 재확인보다 먼저 와야 한다(다시 "모미야" 안 붙여도 되게).
    expect(activatedCheckIdx).toBeGreaterThan(-1);
    expect(activatedCheckIdx).toBeLessThan(wakeCheckIdx);
    const activatedStart = activatedCheckIdx;
    const activatedEnd = src.indexOf('const wakeMatch', activatedStart);
    const activatedBody = src.slice(activatedStart, activatedEnd);
    expect(activatedBody).toContain('onCommand(heard);');
  });

  it('대기 시간이 끝나거나 마이크를 끄면 대기 상태를 초기화한다(무한정 기다리지 않음)', () => {
    expect(src).toContain('const clearActivation = () => {');
    expect(src).toContain('activatedRef.current = false;');
    // stopListening과 useEffect 클린업 양쪽에서 정리돼야 한다.
    const stopListeningStart = src.indexOf('const stopListening = useCallback(() => {');
    const stopListeningEnd = src.indexOf('}, []);', stopListeningStart);
    expect(src.slice(stopListeningStart, stopListeningEnd)).toContain('clearActivation();');
  });
});

// [버그 수정 2026-08-08a] "모미야"를 또박또박 말해도 폰·태블릿·키오스크 전부 무반응
// 이라는 문의 대응. 한글은 유니코드 정규화 형태(NFC/NFD)가 갈릴 수 있어, 소스에
// 적힌 웨이크워드 리터럴과 음성인식 API가 돌려주는 transcript의 내부 인코딩이
// 달라 겉보기엔 "모미야"가 맞는데도 indexOf가 실패했을 가능성을 방어한다.
describe('useMomiVoice.js — 웨이크워드 비교 전 유니코드(NFC) 정규화(회귀 방지)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it('웨이크워드 후보 배열을 NFC로 정규화한다', () => {
    expect(src).toContain(
      "const WAKE_WORD_VARIANTS = ['모미야', '몸이야', '모미', '봄이야'].map((w) => w.normalize('NFC'));"
    );
  });

  it('인식된 transcript도 비교 전에 NFC로 정규화한다(양쪽 형태를 맞춰야 비교가 유효함)', () => {
    expect(src).toContain("last[0].transcript.trim().normalize('NFC');");
  });
});

// [버그 수정 2026-08-08b] 실제 기기 진단 로그로 확인된 원인: 음성인식이 "모미야"를
// "몸이야"로 알아듣고 있었다(한국어 연음법칙 때문에 발음이 사실상 같음). 이 흔한
// 오인식 형태도 웨이크워드로 인정하도록 고쳤는지 확인한다.
describe('useMomiVoice.js — "몸이야"(흔한 오인식)도 웨이크워드로 인정한다(회귀 방지)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it("웨이크워드 후보에 '몸이야'가 포함된다", () => {
    expect(src).toContain(
      "const WAKE_WORD_VARIANTS = ['모미야', '몸이야', '모미', '봄이야'].map((w) => w.normalize('NFC'));"
    );
  });

  it('matchWakeWord가 후보를 순서대로 훑어 첫 매치의 위치·길이를 반환한다', () => {
    const fnStart = src.indexOf('function matchWakeWord(heard) {');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toContain('for (const variant of WAKE_WORD_VARIANTS)');
    expect(fnBody).toContain('heard.indexOf(variant)');
    expect(fnBody).toContain('return { index, length: variant.length };');
  });

  it('onresult가 matchWakeWord를 통해서만 웨이크워드를 판정한다(단일 리터럴 비교로 되돌아가지 않았는지)', () => {
    const resultStart = src.indexOf('recognition.onresult = (event) => {');
    const resultEnd = src.indexOf('recognition.onerror', resultStart);
    const resultBody = src.slice(resultStart, resultEnd);
    expect(resultBody).toContain('const wakeMatch = matchWakeWord(heard);');
    expect(resultBody).not.toContain('heard.indexOf(WAKE_WORD)');
  });
});

// 실제 동작 검증 — 실제 신고된 진단 로그 문구("몸이야 가상 회원 리포트 열어 줘")를
// 그대로 넣어서, 웨이크워드로 인정되고 명령 부분이 올바르게 잘리는지 직접 확인한다.
describe('matchWakeWord() — 실동작 검증(실제 진단 로그로 재현)', () => {
  it("'모미야'를 정확히 찾는다", () => {
    const m = matchWakeWord('모미야');
    expect(m).not.toBeNull();
    expect(m.index).toBe(0);
    expect(m.length).toBe(3);
  });

  it("실제 신고된 오인식 '몸이야'도 웨이크워드로 인정한다", () => {
    const heard = '몸이야 가상 회원 리포트 열어 줘';
    const m = matchWakeWord(heard);
    expect(m).not.toBeNull();
    const commandText = heard.slice(m.index + m.length).trim();
    expect(commandText).toBe('가상 회원 리포트 열어 줘');
  });

  it('웨이크워드가 전혀 없으면 null을 반환한다', () => {
    expect(matchWakeWord('안녕하세요 오늘 날씨 어때요')).toBeNull();
  });

  it("'모미야'만 단독으로 말하면 남는 명령 텍스트가 빈 문자열이다(onWakeOnly 분기 확인용)", () => {
    const m = matchWakeWord('모미야');
    expect('모미야'.slice(m.index + m.length).trim()).toBe('');
  });

  // [버그 수정 2026-08-08c] 현장 배경소음 대응 — 끝음절("야")이 소음에 묻혀 빠지는
  // 경우가 흔해서, 끝음절 빠진 "모미"도 웨이크워드로 인정하도록 확장했다.
  it("배경소음으로 끝음절이 빠진 '모미'도 웨이크워드로 인정한다", () => {
    const heard = '모미 스케줄 열어 줘';
    const m = matchWakeWord(heard);
    expect(m).not.toBeNull();
    const commandText = heard.slice(m.index + m.length).trim();
    expect(commandText).toBe('스케줄 열어 줘');
  });

  it("헬스장 일상 대화 '몸이 안 좋아요'는 웨이크워드로 오인정하지 않는다(오탐 방지)", () => {
    // "몸이"만으로는 매치하지 않아야 한다 — "몸이야"(전체)까지 들려야 매치.
    // 안 그러면 "몸이 안 좋아요/몸이 힘들어요" 같은 흔한 대화에도 계속 반응하게 된다.
    expect(matchWakeWord('몸이 안 좋아요')).toBeNull();
    expect(matchWakeWord('몸이 너무 힘들어요')).toBeNull();
  });

  // [버그 수정 2026-08-08d] 발음이 부정확하면 "봄이야"(ㅂ·ㅁ 양순음 혼동 + 연음)로도
  // 잘못 인식됨을 확인함 — "몸이야"와 같은 종류의 문제.
  it("발음이 부정확할 때 나오는 '봄이야'도 웨이크워드로 인정한다", () => {
    const heard = '봄이야 트레이너 관리 화면 열어 줘';
    const m = matchWakeWord(heard);
    expect(m).not.toBeNull();
    const commandText = heard.slice(m.index + m.length).trim();
    expect(commandText).toBe('트레이너 관리 화면 열어 줘');
  });
});

// [예약 생성 프로젝트 2026-08-08] awaitReply — "모미야" 없이 바로 다음 발화를
// 특정 콜백 하나에 전달하는 범용 즉답 대기 메커니즘. 예약 확인("네/아니요")을
// 시작으로 만들었지만 특정 기능에 종속되지 않게 설계했다.
describe('useMomiVoice.js — awaitReply(즉답 대기, 회귀 방지)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it('pendingReplyRef를 선언한다', () => {
    expect(src).toContain('const pendingReplyRef = useRef(null);');
  });

  it('onresult 맨 앞에서(웨이크워드·activatedRef보다 먼저) pendingReplyRef를 검사한다', () => {
    const onresultStart = src.indexOf('recognition.onresult = (event) => {');
    const pendingCheckIdx = src.indexOf('if (pendingReplyRef.current) {', onresultStart);
    const activatedCheckIdx = src.indexOf('if (activatedRef.current) {', onresultStart);
    const wakeMatchIdx = src.indexOf('const wakeMatch = matchWakeWord(heard);', onresultStart);
    expect(pendingCheckIdx).toBeGreaterThan(onresultStart);
    expect(pendingCheckIdx).toBeLessThan(activatedCheckIdx);
    expect(pendingCheckIdx).toBeLessThan(wakeMatchIdx);
  });

  it('pendingReplyRef가 있으면 콜백을 heard로 정확히 한 번 부르고 즉시 비운다(중복 호출 방지)', () => {
    const start = src.indexOf('if (pendingReplyRef.current) {');
    const end = src.indexOf('return;', start);
    const body = src.slice(start, end);
    expect(body).toContain('const cb = pendingReplyRef.current;');
    expect(body).toContain('pendingReplyRef.current = null;');
    expect(body).toContain('cb(heard);');
    // cb() 호출 전에 ref를 비워야(재진입 시 중복 호출 방지) — 순서 확인.
    expect(body.indexOf('pendingReplyRef.current = null;')).toBeLessThan(body.indexOf('cb(heard);'));
  });

  it('awaitReply는 기존 2단계 명령 대기(activatedRef)를 먼저 정리한다(겹침 방지)', () => {
    const start = src.indexOf('const awaitReply = useCallback((callback, timeoutMs = 12000) => {');
    const end = src.indexOf('}, []);', start);
    const body = src.slice(start, end);
    expect(body).toContain('clearActivation();');
  });

  it('awaitReply는 타임아웃 시(응답 없음) 콜백을 null로 한 번 부른다', () => {
    const start = src.indexOf('const awaitReply = useCallback((callback, timeoutMs = 12000) => {');
    const end = src.indexOf('}, []);', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (cb) cb(null);');
  });

  it('stopListening과 언마운트 둘 다 cancelAwaitReply를 호출한다(마이크 끄면 대기도 같이 정리)', () => {
    const stopStart = src.indexOf('const stopListening = useCallback(() => {');
    const stopEnd = src.indexOf('}, [cancelAwaitReply]);', stopStart);
    expect(src.slice(stopStart, stopEnd)).toContain('cancelAwaitReply();');

    const cleanupStart = src.indexOf('return () => {\n      recognitionRef.current = null;');
    const cleanupEnd = src.indexOf('};', cleanupStart);
    expect(src.slice(cleanupStart, cleanupEnd)).toContain('cancelAwaitReply();');
  });

  it('훅이 awaitReply·cancelAwaitReply를 외부에 노출한다', () => {
    expect(src).toContain(
      'return { supported, listening, startListening, stopListening, awaitReply, cancelAwaitReply };'
    );
  });
});

// [버그 수정 2026-08-08] 마이크 끄기 버튼(stopListening)을 눌러도 recognitionRef.current가
// 그대로 남아있어서, onend의 재시작 조건이 계속 참이 되어 recognition.start()가 곧바로
// 다시 불렸다 — 화면(빨간 점)만 꺼지고 인식은 백그라운드에서 계속 도는 상태였음.
// shouldRestartRef로 "사용자가 듣기를 원하는 상태인지"를 따로 추적해 고쳤다.
describe('useMomiVoice.js — 마이크 끄기 시 실제로 재시작하지 않는다(회귀 방지)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it('shouldRestartRef를 선언한다', () => {
    expect(src).toContain('const shouldRestartRef = useRef(false);');
  });

  it('onend의 재시작 조건이 recognitionRef 비교뿐 아니라 shouldRestartRef도 함께 검사한다', () => {
    const onendStart = src.indexOf('recognition.onend = () => {');
    const onendEnd = src.indexOf('};', onendStart);
    const onendBody = src.slice(onendStart, onendEnd);
    expect(onendBody).toContain(
      'if (recognitionRef.current === recognition && shouldRestartRef.current && !pausedForSpeechRef.current) {'
    );
    // recognitionRef 비교만으로 재시작을 결정하던 예전 버그 조건이 되살아나지 않았는지.
    expect(onendBody).not.toMatch(
      /if \(recognitionRef\.current === recognition\) \{\s*try \{\s*recognition\.start\(\);/
    );
  });

  it('stopListening이 recognition.stop()을 부르기 전에 shouldRestartRef를 false로 내린다', () => {
    const start = src.indexOf('const stopListening = useCallback(() => {');
    const end = src.indexOf('}, []);', start);
    const body = src.slice(start, end);
    const flagIdx = body.indexOf('shouldRestartRef.current = false;');
    const stopIdx = body.indexOf('.stop();');
    expect(flagIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(stopIdx);
  });

  it('startListening이 shouldRestartRef를 true로 올린다', () => {
    const start = src.indexOf('const startListening = useCallback(() => {');
    const end = src.indexOf('}, []);', start);
    const body = src.slice(start, end);
    expect(body).toContain('shouldRestartRef.current = true;');
  });

  it('useEffect 클린업(언마운트)에서도 shouldRestartRef를 false로 내린다', () => {
    const cleanupStart = src.indexOf('return () => {\n      recognitionRef.current = null;');
    const cleanupEnd = src.indexOf('};', cleanupStart);
    const cleanupBody = src.slice(cleanupStart, cleanupEnd);
    expect(cleanupBody).toContain('shouldRestartRef.current = false;');
  });
});

// [버그 수정 2026-08-09] "명령 이후 다음 명령이 안 됩니다" 문의 대응 — onend에서
// recognition.start()가 실패(브라우저가 세션 정리를 아직 안 끝낸 순간과 겹치는
// 흔한 타이밍 경합)하면 예전엔 그냥 조용히 무시하고 끝났다. 그 뒤로는 아무도
// 다시 start()를 불러주지 않아 마이크가 완전히 죽는데, 콘솔에도 화면에도 아무
// 표시가 없어 원인 파악이 어려웠다. 특히 예약 확인 흐름(TTS가 길고 응답을 몇
// 초씩 기다림)에서 이 경합이 훨씬 잦아진다.
describe('useMomiVoice.js — onend 재시작 실패 시 재시도(회귀 방지)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');
  const onendStart = src.indexOf('recognition.onend = () => {');
  const onendEnd = src.indexOf('\n    };', onendStart);
  const onendBody = src.slice(onendStart, onendEnd);

  it('첫 start() 실패를 예전처럼 빈 catch로 조용히 삼키지 않는다', () => {
    expect(onendBody).not.toMatch(/catch \(e\) \{\s*\}/);
  });

  it('첫 시도가 실패하면 setTimeout으로 짧게 재시도한다', () => {
    expect(onendBody).toContain('setTimeout(() => {');
    expect(onendBody).toContain('}, 300);');
  });

  it('재시도 직전에 recognitionRef·shouldRestartRef가 여전히 유효한지 다시 확인한다(그 사이 stop()됐을 수 있으므로)', () => {
    const retryStart = onendBody.indexOf('setTimeout(() => {');
    const retryBody = onendBody.slice(retryStart);
    expect(retryBody).toContain('if (recognitionRef.current !== recognition || !shouldRestartRef.current || pausedForSpeechRef.current) return;');
  });

  it('재시도까지 실패하면 listening 상태를 false로 내려서 화면 표시등이 거짓으로 켜져 있지 않게 한다', () => {
    const retryStart = onendBody.indexOf('setTimeout(() => {');
    const retryBody = onendBody.slice(retryStart);
    expect(retryBody).toContain('setListening(false);');
  });

  it('재시도까지 실패하면 onErrorOccurred로 화면에도 알린다(콘솔만으론 부족)', () => {
    const retryStart = onendBody.indexOf('setTimeout(() => {');
    const retryBody = onendBody.slice(retryStart);
    expect(retryBody).toContain("onErrorOccurred('restart-failed')");
  });
});

// [버그 수정 2026-08-10] "마이크가 아예 반응을 안 해요" 문의 대응 — 키오스크는
// 사람이 계속 화면을 보고 있는 기기가 아니라서, 재시도 1번 만에 포기하고
// "새로고침해주세요" 안내만 띄우면 아무도 못 보고 마이크가 그대로 방치된다.
// 완전히 포기하기 전에 두 번 더(abort()로 세션을 확실히 정리한 뒤) 시도해서
// 일시적 경합은 사람 개입 없이 저절로 풀리게 한다.
describe('useMomiVoice.js — onend 재시작 실패 시 재시도 확대(회귀 방지, 2026-08-10)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');
  const onendStart = src.indexOf('recognition.onend = () => {');
  const onendEnd = src.indexOf('\n    };', onendStart);
  const onendBody = src.slice(onendStart, onendEnd);

  it('300ms 재시도 이후에도 실패하면 곧바로 포기하지 않고 800ms 뒤 한 번 더 시도한다', () => {
    expect(onendBody).toContain('}, 800);');
  });

  it('800ms 재시도 이후에도 실패하면 곧바로 포기하지 않고 2000ms 뒤 마지막으로 한 번 더 시도한다', () => {
    expect(onendBody).toContain('}, 2000);');
  });

  it('800ms·2000ms 재시도 전에는 abort()로 세션 상태를 확실히 정리한 뒤 start()를 부른다', () => {
    const count = (onendBody.match(/recognition\.abort\(\)/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('네 번째(마지막) 시도까지 실패했을 때만 listening을 false로 내리고 restart-failed를 알린다', () => {
    const lastAttemptIdx = onendBody.lastIndexOf('recognition.start();');
    const afterLastAttempt = onendBody.slice(lastAttemptIdx);
    expect(afterLastAttempt).toContain('setListening(false);');
    expect(afterLastAttempt).toContain("onErrorOccurred('restart-failed')");
  });

  it('각 재시도 직전에도 recognitionRef·shouldRestartRef·pausedForSpeechRef 유효성을 다시 확인한다', () => {
    const guardCount = (
      onendBody.match(
        /if \(recognitionRef\.current !== recognition \|\| !shouldRestartRef\.current \|\| pausedForSpeechRef\.current\) return;/g
      ) || []
    ).length;
    // 300ms·800ms·2000ms 재시도 3곳 전부에 동일한 유효성 재확인이 있어야 한다.
    expect(guardCount).toBeGreaterThanOrEqual(3);
  });
});

// [버그 수정 — 웨이크워드 이중 요구 2026-08-09] 실사용 스크린샷으로 확인된 문제:
// GlobalVoiceCommand.jsx는 마이크 버튼을 직접 눌러서 켜는데, 그 뒤에도
// "모미야"를 또 요구해서 "회원 관리 들어가 줘"처럼 명확한 명령도
// "[진단] 들림: ..."만 뜨고 무시됐다. requireWakeWord=false로 이 중복 요구를
// 없앴다 — 버튼 누른 행위 자체가 이미 "나한테 말하는 거야"라는 신호이므로.
describe('useMomiVoice.js — requireWakeWord (웨이크워드 이중 요구 버그 수정)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it('기본값은 true다(KioskVoiceCommand.jsx 등 기존 동작 보존 — 회귀 방지)', () => {
    expect(src).toContain('requireWakeWord = true');
  });

  it('onresult 이펙트의 deps 배열에 requireWakeWord가 들어간다(stale closure 방지)', () => {
    expect(src).toContain('}, [onCommand, onWakeOnly, onMismatch, onErrorOccurred, requireWakeWord]);');
  });

  it('requireWakeWord가 false면 웨이크워드 매칭 없이 들린 말 전체를 곧바로 명령으로 넘긴다', () => {
    const idx = src.indexOf('if (!requireWakeWord) {');
    expect(idx).toBeGreaterThan(-1);
    // activatedRef(2단계 대기)/pendingReplyRef(즉답 대기) 분기보다는 뒤,
    // 웨이크워드 매칭(matchWakeWord)보다는 앞이어야 한다 — 즉답 대기 중엔 그게
    // 항상 우선이고, 웨이크워드 매칭 자체를 건너뛰는 게 이 분기의 목적이므로.
    const pendingReplyIdx = src.indexOf('if (pendingReplyRef.current) {');
    const wakeMatchIdx = src.indexOf('const wakeMatch = matchWakeWord(heard);');
    expect(idx).toBeGreaterThan(pendingReplyIdx);
    expect(idx).toBeLessThan(wakeMatchIdx);
  });

  it('그래도 "모미야"만 딱 말한 경우는(습관적으로) 곧바로 명령으로 넘기지 않고 기존 2단계 대기(onWakeOnly)로 자연스럽게 이어준다', () => {
    const start = src.indexOf('if (!requireWakeWord) {');
    const end = src.indexOf('const wakeMatch = matchWakeWord(heard);', start);
    const body = src.slice(start, end);
    expect(body).toContain('const soloWake = matchWakeWord(heard);');
    expect(body).toContain('activatedRef.current = true;');
  });
});

// [버그 수정 — TTS 재생 중 마이크 충돌 2026-08-09] 실사용 확인: 첫 대화(웨이크
// +명령)는 되는데, 그 이후로는 "모미야"조차 반응이 없어졌다. 모미가 speak()로
// 답하는 동안 인식이 계속 듣고 있어서 자기 목소리를 주워듣거나 마이크·스피커
// 동시 사용으로 인식 세션이 죽는 것으로 추정 — speak() 호출부를 일일이 안
// 고치고 window.speechSynthesis.speaking(전역 상태)을 감시해서 이 훅 하나에서
// 전부 처리한다.
describe('useMomiVoice.js — TTS 재생 중 마이크 일시정지(회귀 방지)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it('speechSynthesis.speaking을 주기적으로 감시하는 effect가 listening 중에만 동작한다', () => {
    const idx = src.indexOf('useEffect(() => {\n    if (!listening) return;\n    const synth =');
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, src.indexOf('}, [listening]);', idx));
    expect(body).toContain('setInterval(');
    expect(body).toContain('clearInterval(timer)');
  });

  it('모미가 말하기 시작하면(speaking 전이) abort()로 즉시 인식을 끊는다(stop 아님 — 자기 목소리 조각이 새어나가지 않도록)', () => {
    const idx = src.indexOf("if (speaking && !pausedForSpeechRef.current) {");
    expect(idx).toBeGreaterThan(-1);
    const end = src.indexOf('} else if (!speaking', idx);
    const body = src.slice(idx, end);
    expect(body).toContain('pausedForSpeechRef.current = true;');
    expect(body).toContain('recognitionRef.current.abort();');
  });

  it('말이 끝나면(speaking 해제) shouldRestartRef가 여전히 켜져 있을 때만 다시 켠다', () => {
    const idx = src.indexOf('} else if (!speaking && pausedForSpeechRef.current) {');
    expect(idx).toBeGreaterThan(-1);
    const end = src.indexOf('}\n    }, 150);', idx);
    const body = src.slice(idx, end);
    expect(body).toContain('pausedForSpeechRef.current = false;');
    expect(body).toContain('if (recognitionRef.current && shouldRestartRef.current) {');
    expect(body).toContain('recognitionRef.current.start();');
  });

  it('onend는 pausedForSpeechRef가 true인 동안 재시작을 시도하지 않는다(감시 effect와 충돌 방지)', () => {
    const onendStart = src.indexOf('recognition.onend = () => {');
    const onendEnd = src.indexOf('};', onendStart);
    const onendBody = src.slice(onendStart, onendEnd);
    expect(onendBody).toContain('&& !pausedForSpeechRef.current) {');
  });

  it('stopListening()은 pausedForSpeechRef도 함께 정리한다(마이크를 끄면 감시 effect도 재시작을 시도하면 안 됨)', () => {
    const start = src.indexOf('const stopListening = useCallback(() => {');
    const end = src.indexOf('}, [cancelAwaitReply]);', start);
    const body = src.slice(start, end);
    expect(body).toContain('pausedForSpeechRef.current = false;');
  });
});
