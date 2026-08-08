// useMomiVoice.js(귀) 수정사항 배선 확인:
//  1) iOS는 continuous:false로 두어 알려진 "세션 멈춤" 버그를 우회한다.
//  2) 인식 결과·에러가 더 이상 조용히 무시되지 않고 콘솔에 남는다(진단용).
// 다른 voice 관련 테스트와 마찬가지로 vitest 환경이 'node'라 정적 소스 패턴을 따른다
// (momi_auto_note.test.js, momi_speech.test.js 참고).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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
    expect(resultBody).toContain("console.log('[모미] 들린 말:', heard);");
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

  it('onWakeOnly·onMismatch·onErrorOccurred 모두 useEffect 의존성 배열에 포함된다', () => {
    expect(src).toContain('}, [onCommand, onWakeOnly, onMismatch, onErrorOccurred]);');
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
    const wakeCheckIdx = src.indexOf('const wakeIndex = heard.indexOf(WAKE_WORD);', resultStart);
    // activated 체크가 웨이크워드 재확인보다 먼저 와야 한다(다시 "모미야" 안 붙여도 되게).
    expect(activatedCheckIdx).toBeGreaterThan(-1);
    expect(activatedCheckIdx).toBeLessThan(wakeCheckIdx);
    const activatedStart = activatedCheckIdx;
    const activatedEnd = src.indexOf('const wakeIndex', activatedStart);
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

// [버그 수정 2026-08-08] "모미야"를 또박또박 말해도 폰·태블릿·키오스크 전부 무반응
// 이라는 문의 대응. 한글은 유니코드 정규화 형태(NFC/NFD)가 갈릴 수 있어, 소스에
// 적힌 WAKE_WORD 리터럴과 음성인식 API가 돌려주는 transcript의 내부 인코딩이
// 달라 겉보기엔 "모미야"가 맞는데도 indexOf가 실패했을 가능성을 방어한다.
describe('useMomiVoice.js — 웨이크워드 비교 전 유니코드(NFC) 정규화(회귀 방지)', () => {
  const src = readSrc('src', 'hooks', 'useMomiVoice.js');

  it("WAKE_WORD 리터럴을 NFC로 정규화한다", () => {
    expect(src).toContain("const WAKE_WORD = '모미야'.normalize('NFC');");
  });

  it('인식된 transcript도 비교 전에 NFC로 정규화한다(양쪽 형태를 맞춰야 비교가 유효함)', () => {
    expect(src).toContain("last[0].transcript.trim().normalize('NFC');");
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
      'if (recognitionRef.current === recognition && shouldRestartRef.current) {'
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
