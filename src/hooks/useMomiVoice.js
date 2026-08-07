// src/hooks/useMomiVoice.js
// 브라우저 내장 음성인식(Web Speech API)으로 "모미야" 웨이크워드를 감지하고,
// 그 다음에 들린 말(transcript)을 콜백으로 전달한다.
//
// 주의: Chrome·Edge·최신 Safari에서만 동작(Firefox 미지원). 기본값은 꺼짐이며,
// 트레이너가 직접 마이크 버튼으로 켜고 꺼야 한다(GlobalVoiceCommand.jsx 참고).

import { useRef, useState, useCallback, useEffect } from 'react';

const WAKE_WORD = '모미야';

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

export function useMomiVoice({ onCommand, onWakeOnly } = {}) {
  const [listening, setListening] = useState(false);
  const [supported] = useState(() => !!getSpeechRecognition());
  const recognitionRef = useRef(null);

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
      const wakeIndex = heard.indexOf(WAKE_WORD);
      if (wakeIndex === -1) return;
      const commandText = heard.slice(wakeIndex + WAKE_WORD.length).trim();
      if (commandText && onCommand) {
        onCommand(commandText);
      } else if (!commandText && onWakeOnly) {
        // "모미야"만 말하고 명령을 같이 안 붙인 경우 — 듣긴 들었다는 걸 알려준다.
        // (이게 없으면 트레이너 입장에선 "불렀는데 반응이 없다"로 느껴짐)
        onWakeOnly();
      }
    };

    recognition.onerror = (event) => {
      // [진단용] 이전엔 전부 조용히 무시해서 마이크 권한 거부 같은 심각한 에러도
      // 화면상 "듣고 있음" 상태로 보였다. 최소한 콘솔에는 원인을 남긴다.
      // (not-allowed=권한 거부, no-speech=일정 시간 무음, audio-capture=마이크 없음,
      //  network=네트워크 문제 — Chrome 인식은 온라인 필요)
      console.warn('[모미] 인식 오류:', event.error);
    };

    recognition.onend = () => {
      // continuous:true 브라우저도 가끔 세션이 끊기고, iOS는 위에서 아예
      // continuous:false로 두기 때문에 매 발화마다 항상 여기로 온다.
      // 두 경우 다 꺼진 상태가 아니면 즉시 재시작해서 "계속 듣는" 것처럼 이어붙인다.
      if (recognitionRef.current === recognition) {
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
      try {
        recognition.stop();
      } catch (e) {
        // no-op
      }
    };
  }, [onCommand, onWakeOnly]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      setListening(true);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch (e) {
      // no-op
    }
    setListening(false);
  }, []);

  return { supported, listening, startListening, stopListening };
}
