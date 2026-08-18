// src/hooks/useMomiVoice.js
// 브라우저 내장 음성인식(Web Speech API)으로 "모미야" 웨이크워드를 감지하고,
// 그 다음에 들린 말(transcript)을 콜백으로 전달한다.
//
// 주의: Chrome·Edge·최신 Safari에서만 동작(Firefox 미지원). 기본값은 꺼짐이며,
// 트레이너가 직접 마이크 버튼으로 켜고 꺼야 한다(GlobalVoiceCommand.jsx 참고).

import { useRef, useState, useCallback, useEffect } from 'react';

// [버그 수정 2026-08-08a] "모미야"를 또박또박 말해도 전혀 반응이 없다는 문의로
// 화면 진단 로그를 확인해보니, 음성인식이 "모미야"를 "몸이야"로 알아듣고 있었다.
// 기기 문제가 아니라 한국어 연음법칙 때문이다 — "몸이야"를 발음하면 받침 ㅁ이
// 다음 음절 "이"로 넘어가("모미야"와) 발음이 사실상 같아진다. 인식 엔진 입장에서도
// "몸이야"(실존하는 흔한 표현, 특히 헬스장 맥락에서 "몸"이 자주 나옴)가 "모미야"
// (사전에 없는 이름)보다 더 그럴듯한 후보라 그쪽으로 인식하는 경향으로 보인다.
// 그래서 "모미야"뿐 아니라 이 흔한 오인식 형태도 웨이크워드로 함께 인정한다.
// (양쪽 다 NFC로 정규화 — 유니코드 표현 형태가 갈려도 항상 같은 형태로 비교되도록.)
//
// [2026-08-08c] 현장 배경소음(음악·운동기구 등) 대응 — 노이즈가 섞이면 인식 결과
// 끝음절이 잘리는 경우가 흔하다("모미야"의 마지막 "야"가 소음에 묻혀 인식 결과에서
// 빠지는 식). 그래서 끝음절이 빠진 "모미"도 인정한다.
// "몸이"(마찬가지로 끝음절만 뺀 형태)는 일부러 안 넣었다 — 헬스장 맥락에서
// "몸이 안 좋아요/몸이 힘들어요" 같은 일상 대화에 실제로 자주 나오는 표현이라,
// 이걸 넣으면 트레이너·회원의 평범한 대화에도 계속 오작동(오탐)할 위험이 크다.
// "모미"는 사전에 없는 말이라 그런 위험이 훨씬 낮다.
//
// [2026-08-08d] 발음이 부정확할 때 "봄이야"(봄+이야 = "it's spring")로도 인식됨을
// 확인함. "몸이야"와 같은 구조의 문제다 — ㅂ·ㅁ은 둘 다 입술소리(양순음)라
// 발음이 뭉개지면 서로 헷갈리기 쉽고, "봄이"도 연음되면 "보미"로 들려 결국
// "모미야"와 사실상 같은 소리가 된다. "봄이야"는 "몸이야"보다 헬스장 대화에서
// 나올 일이 훨씬 적어(계절 얘기 정도) 오탐 위험이 낮다고 보고 그대로 추가한다.
const WAKE_WORD_VARIANTS = ['모미야', '몸이야', '보미야', '봄이야', '모미아', '모미'].map((w) => w.normalize('NFC'));

/** heard 안에서 웨이크워드(또는 흔한 오인식 형태)를 찾는다. 없으면 null. */
export function matchWakeWord(heard) {
  const normalized = (heard || '').normalize('NFC');
  for (const variant of WAKE_WORD_VARIANTS) {
    const index = normalized.indexOf(variant);
    if (index !== -1) return { index, length: variant.length };
  }
  // 음성 엔진이 이름 사이에 공백을 끼우는 경우("모 미야", "몸 이 야")도 허용한다.
  const flexible = /모\s*미\s*(?:야|아)|몸\s*이\s*야|보\s*미\s*야|봄\s*이\s*야/u.exec(normalized);
  if (flexible) return { index: flexible.index, length: flexible[0].length };
  return null;
}

function bestAlternative(result, preferWakeWord) {
  if (!result?.length) return '';
  const alternatives = Array.from(result)
    .map((item) => (item?.transcript || '').trim().normalize('NFC'))
    .filter(Boolean);
  if (preferWakeWord) {
    const wakeCandidate = alternatives.find((text) => matchWakeWord(text));
    if (wakeCandidate) return wakeCandidate;
  }
  return alternatives[0] || '';
}

/** 한 이벤트에 여러 조각으로 도착한 한국어 문장을 잃지 않고 합친다. */
export function collectRecognitionText(event, { finalOnly = false, preferWakeWord = false } = {}) {
  const parts = [];
  const start = Number.isInteger(event?.resultIndex) ? event.resultIndex : 0;
  for (let index = start; index < (event?.results?.length || 0); index += 1) {
    const result = event.results[index];
    if (finalOnly && !result?.isFinal) continue;
    const text = bestAlternative(result, preferWakeWord);
    if (text) parts.push(text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
// "모미야"만 부른 뒤(onWakeOnly) 이 시간 안에 다음 발화가 오면, 그걸 "모미야"
// 없이도 바로 명령으로 처리한다. 실사용 테스트에서 "모미야" → "네, 말씀하세요"
// 응답 → 그 다음 명령을 따로 말하는 자연스러운 2단계 대화로 쓰길 원했는데,
// 예전 코드는 매 발화마다 "모미야"가 다시 붙어있어야만 반응해서 이 흐름이
// 전부 무시되고 있었다(콘솔 대신 화면에 찍은 진단 로그로 확인됨).
const ACTIVATION_WINDOW_MS = 8000;

// 삼성 인터넷/안드로이드 Web Speech API는 한 문장을 말하는 동안
// "몸이야" → "몸이야 회원" → "몸이야 회원 관리 열어 줘"처럼 길어지는
// 여러 결과를 모두 isFinal=true로 보내는 경우가 있다. 첫 조각을 즉시 실행하면
// 완성된 명령이 도착하기 전에 웨이크워드만 처리되어 실제 CMS가 반응하지 않는다.
// 마지막 결과가 도착한 뒤 잠깐 기다렸다가 가장 완성된 문장 한 번만 실행한다.
const FINAL_RESULT_SETTLE_MS = 700;

export function chooseMoreCompleteTranscript(previous = '', next = '') {
  const previousText = String(previous).trim();
  const nextText = String(next).trim();
  return nextText.length >= previousText.length ? nextText : previousText;
}

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// iOS Safari(아이폰·아이패드)는 continuous:true에서 세션이 응답 없이 멈추는(마이크는
// 켜진 채 결과가 전혀 안 올라오는) 알려진 버그가 있다. iOS에서만 continuous:false로
// 짧게 끊어 듣고, 매번 onend에서 재시작해 이어붙이는 방식으로 우회한다.
// iPadOS 13+는 navigator.platform이 'MacIntel'로 나와 유저에이전트만으론 구분이
// 안 되고, 터치 포인트 유무로 실제 Mac 데스크탑과 구분해야 한다.
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIPhoneOrIPad = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS13Plus = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIPhoneOrIPad || isIPadOS13Plus;
}

// [아이폰 음성인식 진단 2026-08-11] "아이폰에서는 음성인식 안 됨" 문의 대응.
// 애플이 iOS 홈 화면에 추가한 앱(PWA, manifest.json display:standalone)을
// 실행하는 WKWebView 컨테이너는, 같은 기기의 일반 Safari 탭과 달리 마이크·
// 음성인식류 웹 API 지원이 몇 년째 불완전하다(iPhone 자체가 아니라 "홈 화면
// 아이콘으로 실행"이라는 실행 방식 자체의 애플 플랫폼 제약 — 코드로 완전히
// 우회할 방법이 없다). SpeechRecognition 생성자 자체는 존재해서(supported
// 검사는 통과) 버튼은 눌리는데 결과가 전혀 안 올라오는 형태로 나타나는 게
// 특징이라, 아래에서 "지원 안 함" 여부와 별개로 이 조합 자체를 감지해서
// 미리 알려준다 — 실기기로 직접 확인은 못 했지만, 최소한 "왜 안 되는지 전혀
// 모른 채 조용히 막히는" 것보다는 원인 후보와 우회법(Safari 앱에서 직접 열기)
// 을 안내하는 쪽이 안전하다.
export function isIOSStandalone() {
  if (!isIOS()) return false;
  if (typeof window === 'undefined') return false;
  return window.navigator?.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

// [버그 수정 — 웨이크워드 이중 요구 2026-08-09] 실사용 스크린샷으로 확인된 문제:
// GlobalVoiceCommand.jsx(마이크 버튼을 직접 눌러서 켜는 방식)에서도 이 훅이
// "모미야"를 요구해서, 버튼을 눌러 켠 뒤 "회원 관리 들어가 줘"라고 명확하게
// 말해도 "[진단] 들림: ..."만 뜨고 아무 동작도 안 했다 — 버튼을 누른 행위
// 자체가 이미 "지금부터 나한테 말하는 거야"라는 명시적 신호인데, 그 위에
// "모미야"까지 요구하는 건 중복이었다. 반면 KioskVoiceCommand.jsx(항상 켜진
// 공용 기기, 버튼 없음)는 계속 웨이크워드가 필요하다 — 안 그러면 옆에서 하는
// 잡담까지 명령으로 오작동한다. requireWakeWord=false(GlobalVoiceCommand
// 전용)면 들린 말 전체를 그대로 명령으로 넘긴다 — 습관적으로 "모미야"를
// 붙여도(예: "모미야 회원 관리 열어줘") 그 뒤 키워드 매칭이 부분 문자열
// 방식이라 그대로 잘 동작한다(깨지지 않음).
export function useMomiVoice({ onCommand, onWakeOnly, onMismatch, onInterim, onErrorOccurred, requireWakeWord = true } = {}) {
  const [listening, setListening] = useState(false);
  const [supported] = useState(() => !!getSpeechRecognition());
  const recognitionRef = useRef(null);
  // "모미야"만 듣고 다음 명령을 기다리는 중인지(2단계 대화 흐름용).
  const activatedRef = useRef(false);
  const activationTimerRef = useRef(null);
  // [버그 수정 2026-08-08] onend에서 "재시작해도 되는 상태인지"를 recognitionRef만으로
  // 판단했더니, stopListening()을 불러도 recognitionRef.current는 그대로 남아있어서
  // onend가 곧바로 recognition.start()를 다시 불러버렸다 — 마이크 끄기 버튼을 눌러도
  // 화면(빨간 점)만 꺼지고 실제 인식은 백그라운드에서 계속 도는 상태였음(프라이버시 문제).
  // 이제 "사용자가 듣기를 원하는 상태인지"를 이 ref로 따로 추적해서, 의도적으로 끈
  // 경우(stopListening)엔 onend가 재시작하지 않도록 한다.
  const shouldRestartRef = useRef(false);
  // [버그 수정 — TTS 재생 중 마이크 충돌 2026-08-09] 실사용 확인: 첫 번째
  // 명령·응답은 정상 동작하지만, 그 이후로는 "모미야"조차 반응이 없어졌다.
  // 원인 추정: 모미가 speak()로 답을 말하는 동안에도 인식은 계속 듣고 있어서,
  // (1) 모미 자신의 목소리를 사용자 발화로 잘못 주워듣거나, (2) 마이크·스피커를
  // 동시에 쓰면서 기기 오디오 장치가 충돌해 인식 세션이 죽고, 그 뒤로는
  // 아무것도 못 알아듣는 상태가 됐을 가능성이 높다. speak()·useMomiSpeech.js는
  // 별도 훅이라 여기서 직접 그 호출을 가로챌 수 없지만, window.speechSynthesis.speaking
  // 은 브라우저 전역 상태라 어디서 말을 걸든 여기서 그대로 감지할 수 있다 —
  // 그래서 각 speak() 호출부(20곳 넘음)를 일일이 손 안 대고 이 훅 하나에서
  // "모미가 말하는 동안엔 잠깐 끄고, 끝나면 다시 켠다"를 전부 처리한다.
  const pausedForSpeechRef = useRef(false);

  const clearActivation = () => {
    activatedRef.current = false;
    if (activationTimerRef.current) {
      clearTimeout(activationTimerRef.current);
      activationTimerRef.current = null;
    }
  };

  // [예약 생성 프로젝트 2026-08-08] "모미야" 없이 바로 "네/아니요" 같은 즉답을
  // 받아야 하는 경우(예: 예약 제안 후 확인) — activatedRef(2단계 명령 대기)와는
  // 성격이 다르다. activatedRef는 "다음 발화 = 명령"이고, 이건 "다음 발화 =
  // 특정 콜백 하나에 한 번만 전달"이다. 재사용 가능하게 범용으로 만든다 —
  // 앞으로 다른 확인·후속답변이 필요한 기능에도 같은 방식으로 쓸 수 있다.
  const pendingReplyRef = useRef(null); // ((heard: string|null) => void) | null
  const pendingReplyTimerRef = useRef(null);
  const pendingFinalTextRef = useRef('');
  const finalResultTimerRef = useRef(null);
  // [버그 수정 — 짧은 대답(네/아니요) 유실 2026-08-18] "예약 확인 질문 후 '네'라고
  // 답해도 아무 반응이 없다"는 문의 대응. "네"처럼 아주 짧은 한 마디는 음성엔진이
  // isFinal(확정) 신호를 주기 전에 인식 세션이 그냥 끝나버리는 경우가 실제로 있다
  // (특히 짧은 발화 + 그 직후 조용해지는 조합에서 흔함) — 그러면 heard가 끝내
  // 확정되지 않아 pendingReplyRef 콜백이 영영 안 불리고, 12초 타임아웃까지
  // 조용히 흘러간다(사용자 입장에선 "말했는데 완전 무반응"으로 보임).
  // 아래 lastInterimSinceAwaitRef에 awaitReply() 대기 중 들어온 미확정(interim)
  // 텍스트를 잠깐 담아뒀다가, 확정 없이 인식 세션이 끝나면(onend) 그 텍스트를
  // "확정된 것처럼" 대신 써서 콜백을 살려낸다 — 예/아니요처럼 초단문 답변만
  // 기다리는 좁은 창(awaitReply)에서만 쓰므로, 일반 명령 인식에는 영향 없다.
  const lastInterimSinceAwaitRef = useRef('');

  const clearPendingFinal = useCallback(() => {
    if (finalResultTimerRef.current) {
      clearTimeout(finalResultTimerRef.current);
      finalResultTimerRef.current = null;
    }
    pendingFinalTextRef.current = '';
  }, []);

  const cancelAwaitReply = useCallback(() => {
    if (pendingReplyTimerRef.current) {
      clearTimeout(pendingReplyTimerRef.current);
      pendingReplyTimerRef.current = null;
    }
    pendingReplyRef.current = null;
    lastInterimSinceAwaitRef.current = '';
  }, []);

  // callback은 다음 발화의 heard 텍스트로 정확히 한 번 불린다. timeoutMs 안에
  // 아무 말도 없으면 heard=null로 한 번 불린다(시간 초과). "모미야"·웨이크워드
  // 매칭을 전부 건너뛰므로, 이걸 거는 동안은 무슨 말을 하든 이 콜백으로만 간다
  // — 짧게, 확인이 끝나는 즉시 반드시 해제(cancelAwaitReply 또는 콜백 자체
  // 호출로 자동 해제됨)되어야 한다.
  const awaitReply = useCallback((callback, timeoutMs = 12000) => {
    clearActivation(); // 기존 2단계 명령 대기 상태와 겹치지 않게 먼저 정리.
    if (pendingReplyTimerRef.current) clearTimeout(pendingReplyTimerRef.current);
    lastInterimSinceAwaitRef.current = ''; // 새로 기다리기 시작하므로 이전 흔적을 지운다.
    pendingReplyRef.current = callback;
    pendingReplyTimerRef.current = setTimeout(() => {
      const cb = pendingReplyRef.current;
      pendingReplyRef.current = null;
      pendingReplyTimerRef.current = null;
      if (cb) cb(null);
    }, timeoutMs);
  }, []);

  useEffect(() => {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ko-KR';
    // [iOS 대응] 위 isIOS() 설명 참고 — iOS만 false, 그 외(Windows/Android Chrome
    // 등 지금까지 문제없던 조합)는 기존 그대로 true 유지.
    recognition.continuous = !isIOS();
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      const interim = collectRecognitionText(event, { preferWakeWord: requireWakeWord });
      const heard = collectRecognitionText(event, { finalOnly: true, preferWakeWord: requireWakeWord });
      if (!heard) {
        const isAddressed = !requireWakeWord || activatedRef.current || pendingReplyRef.current || matchWakeWord(interim);
        if (interim && isAddressed && onInterim) onInterim(interim);
        // [버그 수정 — 짧은 대답 유실 2026-08-18] awaitReply 대기 중에는 아직
        // 확정(isFinal) 안 된 이 조각도 잠깐 기억해둔다 — 세션이 끝날 때까지
        // 끝내 확정되지 않으면(흔한 엔진 결함) onend에서 이걸 대신 쓴다.
        if (pendingReplyRef.current && interim) lastInterimSinceAwaitRef.current = interim;
        return;
      }
      // 삼성 인터넷은 완성 중인 여러 조각에도 isFinal=true를 붙인다. 마지막 조각이
      // 올 때마다 타이머를 다시 시작하고, 가장 긴 문장을 화면에 보여주면서 기다린다.
      pendingFinalTextRef.current = chooseMoreCompleteTranscript(pendingFinalTextRef.current, heard);
      if (onInterim) onInterim(pendingFinalTextRef.current);
      if (finalResultTimerRef.current) clearTimeout(finalResultTimerRef.current);
      finalResultTimerRef.current = setTimeout(() => {
        const heard = pendingFinalTextRef.current;
        pendingFinalTextRef.current = '';
        finalResultTimerRef.current = null;
        if (!heard) return;
        if (onInterim) onInterim('');
        // [진단용] 실제로 뭘로 인식했는지 항상 콘솔에 남긴다 — "모미야"가 다른 말로
        // 잘못 인식되고 있는 건지, 아예 안 들리고 있는 건지 구분하기 위함.
        console.log('[모미] 들린 말:', heard);

      // [예약 생성 프로젝트 2026-08-08] 즉답 대기 중이면(awaitReply) 웨이크워드도
      // 2단계 명령 대기도 전부 건너뛰고 이 발화를 그 콜백 하나에만 전달한다 —
      // 가장 먼저 검사해야 한다(활성화 상태보다도 우선).
      if (pendingReplyRef.current) {
        const cb = pendingReplyRef.current;
        pendingReplyRef.current = null;
        lastInterimSinceAwaitRef.current = ''; // 정상적으로 확정됐으니 임시 기억분은 필요 없다.
        if (pendingReplyTimerRef.current) {
          clearTimeout(pendingReplyTimerRef.current);
          pendingReplyTimerRef.current = null;
        }
        cb(heard);
        return;
      }

      // "모미야"만 부른 직후 대기 중이면, 이번에 들린 말 전체를 곧바로 명령으로
      // 처리한다 — 매번 "모미야"를 다시 붙일 필요 없는 자연스러운 대화 흐름.
      if (activatedRef.current) {
        clearActivation();
        if (heard && onCommand) {
          onCommand(heard);
        } else if (onMismatch) {
          onMismatch(heard);
        }
        return;
      }

      // [버그 수정 — 웨이크워드 이중 요구 2026-08-09] 위 requireWakeWord 설명 참고.
      // 버튼으로 명시적으로 켠 경우(GlobalVoiceCommand)엔 웨이크워드 매칭 자체를
      // 건너뛰고 들린 말 전체를 곧바로 명령으로 넘긴다. 다만 습관적으로 "모미야"
      // 딱 한 마디만 말한 경우까지 그대로 명령으로 넘기면("모미야"라는 문장을
      // Claude에 보내는 꼴) 어색하므로, 그 경우만 기존 2단계 흐름(다음 발화
      // 대기)으로 자연스럽게 이어준다.
      if (!requireWakeWord) {
        const soloWake = matchWakeWord(heard);
        if (soloWake && !heard.slice(soloWake.index + soloWake.length).trim()) {
          if (onWakeOnly) {
            activatedRef.current = true;
            if (activationTimerRef.current) clearTimeout(activationTimerRef.current);
            activationTimerRef.current = setTimeout(clearActivation, ACTIVATION_WINDOW_MS);
            onWakeOnly();
          }
          return;
        }
        if (heard && onCommand) {
          onCommand(heard);
        } else if (onMismatch) {
          onMismatch(heard);
        }
        return;
      }

      const wakeMatch = matchWakeWord(heard);
      if (!wakeMatch) {
        // [진단용] 원격 디버깅(콘솔)에 접근 못 하는 상황을 위해, 웨이크워드가 안
        // 잡혔을 때 실제로 뭘로 들렸는지 화면에도 잠깐 보여준다. heard가 완전
        // 빈 문자열(최종 결과인데 내용이 없는 경우)이어도 그 자체가 진단 정보라
        // onMismatch로 알려준다.
        if (onMismatch) onMismatch(heard);
        return;
      }
      const commandText = heard.slice(wakeMatch.index + wakeMatch.length).trim();
      if (commandText && onCommand) {
        onCommand(commandText);
      } else if (!commandText && onWakeOnly) {
        // "모미야"만 말한 경우 — 다음 발화를 명령으로 기다린다(ACTIVATION_WINDOW_MS
        // 동안). 그 안에 안 오면 다시 "모미야"부터 시작해야 하도록 원상복귀.
        activatedRef.current = true;
        if (activationTimerRef.current) clearTimeout(activationTimerRef.current);
        activationTimerRef.current = setTimeout(clearActivation, ACTIVATION_WINDOW_MS);
        onWakeOnly();
      }
      }, FINAL_RESULT_SETTLE_MS);
    };

    recognition.onerror = (event) => {
      // [진단용] 이전엔 전부 조용히 무시해서 마이크 권한 거부 같은 심각한 에러도
      // 화면상 "듣고 있음" 상태로 보였다. 콘솔뿐 아니라 화면에도 원인을 남긴다
      // (원격 디버깅이 안 되는 기기가 많아서 콘솔만으론 부족함).
      // (not-allowed=권한 거부, no-speech=일정 시간 무음, audio-capture=마이크 없음,
      //  network=네트워크 문제 — Chrome 인식은 온라인 필요)
      console.warn('[모미] 인식 오류:', event.error);
      if (onInterim) onInterim('');
      // [버그 수정 2026-08-08] no-speech는 진짜 오류가 아니라 몇 초간 무음일 때
      // 항상 나는 정상적인 타임아웃이다 — 상시 듣기 중엔 자주 발생하고, 뒤이어
      // onend가 오면 shouldRestartRef가 알아서 재시작해줘서 동작엔 지장이 없다.
      // 그런데도 화면에 "[진단] 오류 코드: no-speech"가 매번 떠서, 실제로는
      // 정상 동작인데 "PC에서 오류가 난다"는 오해를 만들었다. 실제 조치가
      // 필요한 오류(권한 거부·마이크 없음·네트워크)만 화면에 띄운다.
      // aborted는 모미가 답변(TTS)을 시작하거나 사용자가 마이크를 끌 때
      // recognition.abort()를 의도적으로 호출해 생기는 정상 종료 신호다.
      // 오류로 노출하면 정상 대화 때마다 "오류 코드: aborted"가 떠버린다.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (onErrorOccurred) onErrorOccurred(event.error);
    };

    recognition.onend = () => {
      // [버그 수정 — 짧은 대답(네/아니요) 유실 2026-08-18] "예약 확인 질문에
      // '네'라고 답했는데 아무 반응이 없다" 문의 대응. awaitReply로 즉답을
      // 기다리는 중인데(pendingReplyRef.current) 그 발화가 끝내 isFinal로
      // 확정되지 못한 채 이 인식 세션이 여기서 끝나버리면, 원래는 12초
      // 타임아웃까지 조용히 아무 일도 안 일어났다 — 사용자 입장에선 "말했는데
      // 완전 무반응"으로 보이는 게 바로 이 경우다. 위 onresult에서 미리 담아둔
      // 미확정 조각(lastInterimSinceAwaitRef)이 있으면 그걸 확정된 것처럼
      // 대신 써서 콜백을 살려낸다 — 아래 재시작 로직과 별개로, 세션이 어떤
      // 이유로 끝나든(재시작 여부 무관) 항상 먼저 확인한다.
      if (recognitionRef.current === recognition && pendingReplyRef.current && lastInterimSinceAwaitRef.current.trim()) {
        const cb = pendingReplyRef.current;
        const fallbackHeard = lastInterimSinceAwaitRef.current.trim();
        pendingReplyRef.current = null;
        lastInterimSinceAwaitRef.current = '';
        if (pendingReplyTimerRef.current) {
          clearTimeout(pendingReplyTimerRef.current);
          pendingReplyTimerRef.current = null;
        }
        console.log('[모미] 짧은 대답이 확정되지 않은 채 세션이 끝나 미확정 조각을 대신 사용:', fallbackHeard);
        cb(fallbackHeard);
      }
      // continuous:true 브라우저도 가끔 세션이 끊기고, iOS는 위에서 아예
      // continuous:false로 두기 때문에 매 발화마다 항상 여기로 온다.
      // 두 경우 다 꺼진 상태가 아니면(shouldRestartRef) 즉시 재시작해서 "계속 듣는"
      // 것처럼 이어붙인다. stopListening()으로 의도적으로 끈 경우엔 재시작 안 함.
      // [버그 수정 — TTS 재생 중 마이크 충돌 2026-08-09] 모미가 말하는 중이라
      // 일부러 세션을 끈 경우(pausedForSpeechRef)에도 여기서 재시작하면 안 된다
      // — 그러면 이 pause 자체가 무력화되고 곧바로 다시 자기 목소리를 듣게
      // 된다. 재시작은 아래 speechSynthesis 감시 effect가 말이 끝난 뒤 직접 한다.
      if (recognitionRef.current === recognition && shouldRestartRef.current && !pausedForSpeechRef.current) {
        try {
          recognition.start();
        } catch (e) {
          // [버그 수정 2026-08-09] "명령 이후 다음 명령이 안 됩니다" 문의 대응.
          // 원인: onend 직후 start()를 다시 부르면 브라우저가 세션을 아직 완전히
          // 정리하지 못한 순간과 겹쳐 "이미 시작됨" 계열 에러를 던지는 경우가
          // 있는데, 예전엔 이걸 그냥 무시하고 끝냈다 — 그러면 그 뒤로는 아무도
          // 다시 start()를 불러주지 않아서 마이크가 조용히 완전히 죽는다(콘솔에도
          // 화면에도 아무 표시가 없어서 원인 파악이 어려웠음). 특히 예약 확인
          // 흐름처럼 TTS가 길게 끼어들고 응답을 몇 초씩 기다리는 구간에서 이
          // 타이밍 경합이 훨씬 잦아진다(TTS 재생과 인식 세션 종료/재시작 타이밍이
          // 겹칠 여지가 커짐). 짧게 한 번 더 재시도하면 대부분 그 사이 브라우저의
          // 정리가 끝나 있어 성공한다.
          console.warn('[모미] 재시작 실패, 짧게 재시도:', e?.message || e);
          setTimeout(() => {
            if (recognitionRef.current !== recognition || !shouldRestartRef.current || pausedForSpeechRef.current) return;
            try {
              recognition.start();
            } catch (e2) {
              // [버그 수정 2026-08-10] "마이크가 아예 반응을 안 해요" 문의 대응.
              // 예전엔 재시도가 이번 1번뿐이라, 여기서도 실패하면 바로 포기하고
              // "새로고침해주세요" 안내만 띄운 채 끝났다 — 그런데 키오스크는
              // 사람이 화면을 계속 보고 있는 기기가 아니라서, 그 안내를 아무도
              // 못 보고 마이크가 그대로 죽어있는 채 방치되는 경우가 실제로
              // 생겼다. OS 오디오 장치가 잠깐 바빴던 것처럼 조금 더 기다리면
              // 저절로 풀리는 일시적 경합도 있어서, 완전히 포기하기 전에 두
              // 번 더 시도한다 — 이번엔 abort()로 세션 상태를 확실히 정리한
              // 뒤 start()를 불러서, "이미 시작된 것으로 착각한 상태"처럼
              // start()만 반복해서는 안 풀리는 경우도 같이 커버한다.
              console.warn('[모미] 재시작 재시도도 실패, 한 번 더 시도:', e2?.message || e2);
              setTimeout(() => {
                if (recognitionRef.current !== recognition || !shouldRestartRef.current || pausedForSpeechRef.current) return;
                try {
                  recognition.abort();
                } catch (eAbort) {
                  // no-op — 이미 멈춰 있는 상태일 수 있다.
                }
                try {
                  recognition.start();
                } catch (e3) {
                  console.warn('[모미] 세 번째 재시도도 실패, 마지막으로 한 번 더:', e3?.message || e3);
                  setTimeout(() => {
                    if (recognitionRef.current !== recognition || !shouldRestartRef.current || pausedForSpeechRef.current) return;
                    try {
                      recognition.abort();
                    } catch (eAbort2) {
                      // no-op
                    }
                    try {
                      recognition.start();
                    } catch (e4) {
                      // 네 번 다 실패하면 그때는 진짜 문제(권한 철회·기기 분리
                      // 등)일 가능성이 높다 — 예전처럼 조용히 넘어가지 않고,
                      // listening 상태를 실제 상태(꺼짐)에 맞게 내려서 화면
                      // 표시등이 거짓으로 "듣고 있음"을 보여주지 않게 하고,
                      // 사용자가 원인을 알 수 있게 알린다.
                      console.warn('[모미] 재시작 재시도 모두 실패:', e4?.message || e4);
                      setListening(false);
                      if (onErrorOccurred) onErrorOccurred('restart-failed');
                    }
                  }, 2000);
                }
              }, 800);
            }
          }, 300);
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognitionRef.current = null;
      shouldRestartRef.current = false;
      clearPendingFinal();
      clearActivation();
      cancelAwaitReply();
      try {
        recognition.stop();
      } catch (e) {
        // no-op
      }
    };
  }, [onCommand, onWakeOnly, onMismatch, onInterim, onErrorOccurred, requireWakeWord, clearPendingFinal]);

  // [버그 수정 — TTS 재생 중 마이크 충돌 2026-08-09] 위 pausedForSpeechRef 설명
  // 참고. window.speechSynthesis.speaking을 짧은 주기로 확인해서, 모미가 말을
  // 시작하면 인식을 잠깐 끄고(자기 목소리를 듣지 않도록), 말이 끝나면 다시
  // 켠다. speak()가 어느 컴포넌트·훅에서 불렸든 상관없이 이 하나의 감시
  // 루프가 전부 처리한다(호출부 20여 곳을 일일이 손 안 대도 됨).
  useEffect(() => {
    if (!listening) return;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) return;
    const timer = setInterval(() => {
      const speaking = synth.speaking;
      if (speaking && !pausedForSpeechRef.current) {
        pausedForSpeechRef.current = true;
        if (recognitionRef.current) {
          try {
            // abort()는 stop()과 달리 처리 중이던 오디오를 즉시 버린다 — 방금
            // 막 들어온, Momi 자신의 목소리일 수 있는 조각이 onresult로 새어
            // 나가지 않도록 딱 잘라 끊는 편이 안전하다.
            recognitionRef.current.abort();
          } catch (e) {
            // no-op
          }
        }
      } else if (!speaking && pausedForSpeechRef.current) {
        pausedForSpeechRef.current = false;
        if (recognitionRef.current && shouldRestartRef.current) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            // 여기서 실패해도 괜찮다 — abort()가 유발한 onend가 이미 지나갔거나
            // 곧 오는데, pausedForSpeechRef가 막 false로 바뀌었으니 그 onend
            // 처리(또는 다음 onend)가 정상적으로 재시작을 이어받는다.
          }
        }
      }
    }, 150);
    return () => clearInterval(timer);
  }, [listening]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    shouldRestartRef.current = true;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      setListening(true);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    // [버그 수정 2026-08-08] 이걸 먼저 false로 내려놔야, stop()이 비동기로 유발하는
    // onend가 재시작하지 않는다(위 onend 핸들러 참고).
    shouldRestartRef.current = false;
    pausedForSpeechRef.current = false; // TTS 감시 루프도 재시작 시도를 멈추도록.
    clearPendingFinal();
    try {
      recognitionRef.current.stop();
    } catch (e) {
      // no-op
    }
    clearActivation();
    cancelAwaitReply();
    setListening(false);
  }, [cancelAwaitReply, clearPendingFinal]);

  return { supported, listening, startListening, stopListening, awaitReply, cancelAwaitReply };
}
