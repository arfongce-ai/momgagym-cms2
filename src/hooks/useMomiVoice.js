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

export function useMomiVoice({ onCommand } = {}) {
  const [listening, setListening] = useState(false);
  const [supported] = useState(() => !!getSpeechRecognition());
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
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
      // continuous 모드라도 브라우저가 세션을 끊는 경우가 있어, 꺼진 상태가 아니면 재시작한다.
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
  }, [onCommand]);

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
