// src/pages/MicTest.jsx
// 앱의 나머지 부분(인증·회원 데이터·모미 로직)과 완전히 분리된 독립 진단 페이지.
// /mic-test 로 접속하면 로그인 없이 바로 뜬다. 목적은 딱 하나 — 지금 이 기기의
// 브라우저가 SpeechRecognition을 실제로 어떻게 다루는지, 이벤트 단위로 전부
// 화면에 실시간으로 찍어서 원격 디버깅 없이도 원인을 좁힐 수 있게 하는 것.
// (useMomiVoice.js와는 별개 코드 — 여기서 뭘 고쳐도 실제 모미 기능엔 영향 없음)

import { useRef, useState } from 'react';

export default function MicTest() {
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const recognitionRef = useRef(null);
  // [버그 수정 2026-08-08] useMomiVoice.js와 같은 버그: "마이크 끄기"를 눌러도
  // recognitionRef.current가 그대로라 onend가 재시작해버렸다. 사용자가 원하는
  // 상태를 이 ref로 따로 추적한다.
  const shouldRestartRef = useRef(false);

  const addLog = (text, isErr = false) => {
    const time = new Date().toLocaleTimeString('ko-KR');
    setLogs((prev) => [{ time, text, isErr }, ...prev].slice(0, 100));
  };

  const SR =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggle = () => {
    if (running) {
      shouldRestartRef.current = false;
      recognitionRef.current?.stop();
      setRunning(false);
      return;
    }
    if (!SR) {
      addLog('이 브라우저는 SpeechRecognition을 지원하지 않음', true);
      return;
    }

    const recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true; // 중간결과까지 다 보여준다(여기선 진단이 목적).

    recognition.onstart = () => addLog('▶ 인식 시작됨 (onstart)');
    recognition.onaudiostart = () => addLog('🎤 오디오 캡처 시작 (onaudiostart)');
    recognition.onspeechstart = () => addLog('🗣 말소리 감지 (onspeechstart)');
    recognition.onspeechend = () => addLog('말소리 끝남 (onspeechend)');
    recognition.onaudioend = () => addLog('오디오 캡처 종료 (onaudioend)');
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const text = last[0].transcript;
      addLog(`결과(${last.isFinal ? '최종' : '중간'}): "${text}"`);
    };
    recognition.onerror = (event) => addLog(`에러: ${event.error}`, true);
    recognition.onend = () => {
      addLog('■ 세션 종료 (onend)');
      if (recognitionRef.current === recognition && shouldRestartRef.current) {
        try {
          recognition.start();
          addLog('↻ 자동 재시작함');
        } catch (e) {
          addLog(`재시작 실패: ${e.message}`, true);
        }
      }
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    try {
      recognition.start();
      setRunning(true);
    } catch (e) {
      addLog(`시작 실패: ${e.message}`, true);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>마이크 진단 (독립 페이지)</h2>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        모미 기능이랑 코드가 완전히 분리된 순수 테스트 페이지. 여기서 나는 로그가
        곧 이 기기·브라우저의 실제 동작임.
      </p>
      <button
        onClick={toggle}
        style={{
          fontSize: 18,
          padding: '14px 24px',
          borderRadius: 8,
          border: 'none',
          background: running ? '#ef4444' : '#111827',
          color: '#fff',
          marginBottom: 16,
        }}
      >
        {running ? '마이크 끄기' : '마이크 시작'}
      </button>
      <div
        style={{
          background: '#f3f4f6',
          borderRadius: 8,
          padding: 12,
          minHeight: 200,
          fontSize: 14,
          fontFamily: 'monospace',
        }}
      >
        {logs.length === 0 && <div style={{ color: '#999' }}>버튼 누르면 여기 실시간으로 찍힘...</div>}
        {logs.map((log, i) => (
          <div key={i} style={{ color: log.isErr ? '#dc2626' : '#111827', marginBottom: 4 }}>
            [{log.time}] {log.text}
          </div>
        ))}
      </div>
    </div>
  );
}
