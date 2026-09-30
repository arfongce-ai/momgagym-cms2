// src/pages/MicTest.jsx
// 앱의 나머지 부분(인증·회원 데이터·모미 로직)과 완전히 분리된 독립 진단 페이지.
// /mic-test 로 접속하면 로그인 없이 바로 뜬다. 목적은 딱 하나 — 지금 이 기기의
// 브라우저가 SpeechRecognition을 실제로 어떻게 다루는지, 이벤트 단위로 전부
// 화면에 실시간으로 찍어서 원격 디버깅 없이도 원인을 좁힐 수 있게 하는 것.
// [2026-09-30] 환경 조사·마이크 신호 측정(원시/처리 비교)·음성팩 설치 시험·결과 복사를 추가.
// 개인정보: 인식된 문장은 저장·표시하지 않고 글자 수만 남긴다. 오디오는 브라우저 안에서 숫자로만
// 요약하며 어디에도 전송·저장하지 않는다. "복사"는 사용자가 누를 때 클립보드에만 복사한다.
// (useMomiVoice.js와는 별개 코드 — 여기서 뭘 고쳐도 실제 모미 기능엔 영향 없음)

import { useEffect, useRef, useState } from 'react';
// 앱 상태와 무관한 순수 유틸(useMomiVoice의 앱 안 진단과 같은 판정 로직을 공유한다).
import {
  requestLocalRecognitionInstall,
  describeLocalInstallFailure,
  describeMicDiagnostic,
  measureMicrophone,
} from '../utils/momiDiagnostics';


export default function MicTest() {
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const recognitionRef = useRef(null);
  const startedAtRef = useRef(0);
  const [mode, setMode] = useState('default'); // default | local | remote
  const [env, setEnv] = useState([]);
  const [busy, setBusy] = useState(false);
  // [버그 수정 2026-08-08] useMomiVoice.js와 같은 버그: "마이크 끄기"를 눌러도
  // recognitionRef.current가 그대로라 onend가 재시작해버렸다. 사용자가 원하는
  // 상태를 이 ref로 따로 추적한다.
  const shouldRestartRef = useRef(false);

  const addLog = (text, isErr = false) => {
    const time = new Date().toLocaleTimeString('ko-KR');
    const elapsed = startedAtRef.current ? ` +${Date.now() - startedAtRef.current}ms` : '';
    setLogs((prev) => [{ time, text: `${text}${elapsed}`, isErr }, ...prev].slice(0, 200));
  };

  const SR =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  // 환경 조사: 지원 여부와 온디바이스 한국어 가용성. available()은 조회만 하며 설치하지 않는다.
  useEffect(() => {
    const lines = [];
    const brands = navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(', ');
    lines.push(`브라우저: ${brands || navigator.userAgent}`);
    lines.push(`플랫폼: ${navigator.userAgentData?.platform || navigator.platform} / 온라인: ${navigator.onLine} / 보안컨텍스트: ${window.isSecureContext}`);
    lines.push(`SpeechRecognition: ${SR ? '있음' : '없음'} / install(): ${typeof SR?.install === 'function' ? '있음' : '없음'} / available(): ${typeof SR?.available === 'function' ? '있음' : '없음'}`);
    setEnv(lines);
    if (typeof SR?.available === 'function') {
      Promise.all([true, false].map((processLocally) => Promise.resolve()
        .then(() => SR.available({ langs: ['ko-KR'], processLocally }))
        .then((v) => `${v}`, (e) => `예외(${e?.name || 'Error'})`)))
        .then(([local, remote]) => setEnv((prev) => [...prev, `available(ko-KR) 로컬처리=${local} / 원격=${remote}`]));
    }
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => setEnv((prev) => [...prev, `오디오 입력 장치 수: ${devices.filter((d) => d.kind === 'audioinput').length}`]))
      .catch(() => {});
  }, [SR]);

  const stopRecognition = () => {
    shouldRestartRef.current = false;
    try { recognitionRef.current?.stop(); } catch (e) { /* no-op */ }
    setRunning(false);
  };

  // 마이크 신호 측정: 원시(처리 끔)와 처리(에코·잡음·자동게인 켬)를 순서대로 잰다.
  const runMicMeasure = async () => {
    if (busy) return;
    if (running) stopRecognition();
    setBusy(true);
    startedAtRef.current = 0;
    try {
      for (const [label, constraints] of [
        ['원시', { echoCancellation: false, noiseSuppression: false, autoGainControl: false }],
        ['처리', { echoCancellation: true, noiseSuppression: true, autoGainControl: true }],
      ]) {
        addLog(`[${label}] 5초 측정 시작 — 처음 2초는 조용히, 다음 3초는 말해 주세요`);
        try {
          const r = await measureMicrophone(constraints);
          addLog(`[${label}] ${describeMicDiagnostic(r)}`, !r.ok);
          addLog(`[${label}] 판정=${r.verdict} 장치="${r.deviceLabel || '이름 없음'}" 음소거=${r.trackMuted} 컨텍스트=${r.contextState} ${r.sampleRate}Hz 적용옵션=${JSON.stringify(r.settings)}`);
        } catch (e) {
          addLog(`[${label}] 측정 실패: ${e?.name || 'Error'}`, true);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  // 한국어 음성팩 설치 시험(사용자가 직접 누름). 반환값을 원인별로 기록한다.
  const runInstallTest = () => {
    if (busy || !SR) return;
    setBusy(true);
    startedAtRef.current = Date.now();
    addLog('음성팩 install() 호출');
    requestLocalRecognitionInstall(SR).then((r) => {
      addLog(r.ok ? 'install() 성공' : `install() 실패: 사유=${r.reason}${r.detail ? `(${r.detail})` : ''} — ${describeLocalInstallFailure(r.reason, r.detail)}`, !r.ok);
      setBusy(false);
    });
  };

  const copyResult = async () => {
    const text = [...env, '', ...[...logs].reverse().map((l) => `[${l.time}] ${l.text}`)].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      addLog('결과를 클립보드에 복사했습니다(발화 내용 없음)');
    } catch (e) {
      addLog('복사 실패 — 화면을 캡처해 주세요', true);
    }
  };

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
    if (mode === 'local') recognition.processLocally = true;
    if (mode === 'remote') recognition.processLocally = false;
    startedAtRef.current = Date.now();
    addLog(`인식기 생성 (processLocally=${mode === 'default' ? '미지정' : mode === 'local'})`);
    recognition.continuous = true;
    recognition.interimResults = true; // 중간결과까지 다 보여준다(여기선 진단이 목적).

    recognition.onstart = () => addLog('▶ 인식 시작됨 (onstart)');
    recognition.onaudiostart = () => addLog('🎤 오디오 캡처 시작 (onaudiostart)');
    recognition.onspeechstart = () => addLog('🗣 말소리 감지 (onspeechstart)');
    recognition.onspeechend = () => addLog('말소리 끝남 (onspeechend)');
    recognition.onaudioend = () => addLog('오디오 캡처 종료 (onaudioend)');
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      // 발화 내용은 기록하지 않고 글자 수·신뢰도만 남긴다.
      const length = last[0].transcript.length;
      const conf = Number.isFinite(last[0].confidence) ? last[0].confidence.toFixed(2) : '-';
      addLog(`결과(${last.isFinal ? '최종' : '중간'}): ${length}글자, 신뢰도 ${conf}`);
    };
    recognition.onerror = (event) => addLog(`에러: ${event.error}${event.message ? ` (${event.message})` : ''}`, true);
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
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <label>
          인식 모드{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={running}>
            <option value="default">브라우저 기본</option>
            <option value="local">로컬(온디바이스) 강제</option>
            <option value="remote">원격(온라인) 강제</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={runMicMeasure} disabled={busy} style={{ padding: '8px 12px' }}>마이크 신호 측정(원시/처리)</button>
        <button onClick={runInstallTest} disabled={busy || !SR} style={{ padding: '8px 12px' }}>한국어 음성팩 설치 시험</button>
        <button onClick={copyResult} style={{ padding: '8px 12px' }}>결과 복사</button>
      </div>
      <div style={{ background: '#eef2ff', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: 'monospace' }}>
        {env.map((line, i) => <div key={i}>{line}</div>)}
      </div>
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
