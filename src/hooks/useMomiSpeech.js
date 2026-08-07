// src/hooks/useMomiSpeech.js
// 모미 응답(텍스트)을 브라우저 내장 음성합성(Web Speech API, SpeechSynthesis)으로
// 읽어준다. useMomiVoice.js(귀)와 짝을 이루는 입 쪽 훅 — 마찬가지로 완전히 무료이고
// 별도 서버·API 키 없이 동작한다.
//
// 주의: 기기·브라우저별로 설치된 한국어 목소리 품질이 다를 수 있다. 콘솔에서
// speechSynthesis.getVoices().filter(v => v.lang.startsWith('ko'))로 확인 가능.
// 품질이 부족하면 이 훅의 speak()만 유료 TTS 호출로 교체하면 된다(호출부는 안 바뀜).

import { useCallback, useEffect, useRef } from 'react';

function getSpeechSynthesis() {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis || null;
}

export function useMomiSpeech() {
  const supported = !!getSpeechSynthesis();
  const synthRef = useRef(null);

  useEffect(() => {
    synthRef.current = getSpeechSynthesis();
    return () => {
      // 화면 이동 등으로 언마운트될 때 말하던 중이면 멈춘다.
      synthRef.current?.cancel();
    };
  }, []);

  const speak = useCallback((text) => {
    const synth = synthRef.current;
    if (!synth || !text) return;
    // 이전 발화가 아직 끝나지 않았으면 먼저 끊고 새 응답을 말한다.
    // (트레이너가 모미 말이 끝나기 전에 다음 명령을 말하는 경우 방지)
    synth.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    synth.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    synthRef.current?.cancel();
  }, []);

  return { supported, speak, stop };
}
