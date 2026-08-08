// src/hooks/useMomiVoice.js
// 브라우저 내장 음성인식(Web Speech API)으로 "모미야" 웨이크워드를 감지하고,
// 그 다음에 들린 말(transcript)을 콜백으로 전달한다.
//
// 주의: Chrome·Edge·최신 Safari에서만 동작(Firefox 미지원). 기본값은 꺼짐이며,
// 트레이너가 직접 마이크 버튼으로 켜고 꺼야 한다(GlobalVoiceCommand.jsx 참고).

import { useRef, useState, useCallback, useEffect } from 'react';

const WAKE_WORD = '모미야';
// "모미야"만 부른 뒤(onWakeOnly) 이 시간 안에 다음 발화가 오면, 그걸 "모미야"
// 없이도 바로 명령으로 처리한다. 실사용 테스트에서 "모미야" → "네, 말씀하세요"
// 응답 → 그 다음 명령을 따로 말하는 자연스러운 2단계 대화로 쓰길 원했는데,
// 예전 코드는 매 발화마다 "모미야"가 다시 붙어있어야만 반응해서 이 흐름이
// 전부 무시되고 있었다(콘솔 대신 화면에 찍은 진단 로그로 확인됨).
const ACTIVATION_WINDOW_MS = 8000;

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// iOS Safari(아이폰·아이패드)는 continuous:true에서 세션이 응답 없이 멈추는(마이크는
// 켜진 채 결과가 전혀 안 올라오는) 알려진 버그가 있다. iOS에서만 continuous:false로
// 짧게 끊어 듣고, 매번 onend에서 재시작해 이어붙이는 방식으로 우회한다.
// iPadOS 13+는 navigator.platform이 'MacIntel'로 나와 유저에이전트만으론 구분이
// 안 되고, 터치 포인트 유무로 실제 Mac 데스크탑과 구분해야 한다.
function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIPhoneOrIPad = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS13Plus = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIPhoneOrIPad || isIPadOS13Plus;
}

export function useMomiVoice({ onCommand, onWakeOnly, onMismatch, onErrorOccurred } = {}) {
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

  const clearActivation = () => {
    activatedRef.current = false;
    if (activationTimerRef.current) {
      clearTimeout(activationTimerRef.current);
      activationTimerRef.current = null;
    }
  };

  useEffect(() => {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ko-KR';
    // [iOS 대응] 위 isIOS() 설명 참고 — iOS만 false, 그 외(Windows/Android Chrome
    // 등 지금까지 문제없던 조합)는 기존 그대로 true 유지.
    recognition.continuous = !isIOS();
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (!last || !last.isFinal) return;
      const heard = last[0].transcript.trim();
      // [진단용] 실제로 뭘로 인식했는지 항상 콘솔에 남긴다 — "모미야"가 다른 말로
      // 잘못 인식되고 있는 건지, 아예 안 들리고 있는 건지 구분하기 위함.
      console.log('[모미] 들린 말:', heard);

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

      const wakeIndex = heard.indexOf(WAKE_WORD);
      if (wakeIndex === -1) {
        // [진단용] 원격 디버깅(콘솔)에 접근 못 하는 상황을 위해, 웨이크워드가 안
        // 잡혔을 때 실제로 뭘로 들렸는지 화면에도 잠깐 보여준다. heard가 완전
        // 빈 문자열(최종 결과인데 내용이 없는 경우)이어도 그 자체가 진단 정보라
        // onMismatch로 알려준다.
        if (onMismatch) onMismatch(heard);
        return;
      }
      const commandText = heard.slice(wakeIndex + WAKE_WORD.length).trim();
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
    };

    recognition.onerror = (event) => {
      // [진단용] 이전엔 전부 조용히 무시해서 마이크 권한 거부 같은 심각한 에러도
      // 화면상 "듣고 있음" 상태로 보였다. 콘솔뿐 아니라 화면에도 원인을 남긴다
      // (원격 디버깅이 안 되는 기기가 많아서 콘솔만으론 부족함).
      // (not-allowed=권한 거부, no-speech=일정 시간 무음, audio-capture=마이크 없음,
      //  network=네트워크 문제 — Chrome 인식은 온라인 필요)
      console.warn('[모미] 인식 오류:', event.error);
      if (onErrorOccurred) onErrorOccurred(event.error);
    };

    recognition.onend = () => {
      // continuous:true 브라우저도 가끔 세션이 끊기고, iOS는 위에서 아예
      // continuous:false로 두기 때문에 매 발화마다 항상 여기로 온다.
      // 두 경우 다 꺼진 상태가 아니면(shouldRestartRef) 즉시 재시작해서 "계속 듣는"
      // 것처럼 이어붙인다. stopListening()으로 의도적으로 끈 경우엔 재시작 안 함.
      if (recognitionRef.current === recognition && shouldRestartRef.current) {
        try {
          recognition.start();
        } catch (e) {
          // 이미 시작된 상태에서 start()를 다시 부르면 에러가 나는 브라우저가 있어 무시
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognitionRef.current = null;
      shouldRestartRef.current = false;
      clearActivation();
      try {
        recognition.stop();
      } catch (e) {
        // no-op
      }
    };
  }, [onCommand, onWakeOnly, onMismatch, onErrorOccurred]);

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
    try {
      recognitionRef.current.stop();
    } catch (e) {
      // no-op
    }
    clearActivation();
    setListening(false);
  }, []);

  return { supported, listening, startListening, stopListening };
}
