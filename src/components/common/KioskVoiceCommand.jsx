// src/components/common/KioskVoiceCommand.jsx
// 키오스크 모드 전용 음성 명령 — GlobalVoiceCommand.jsx(버튼식)와 달리 버튼이
// 없다. 화면이 뜨는 즉시 자동으로 "모미야" 상시 감지를 시작해서, 트레이너가
// 회원 스팟 중이라 손이 자유롭지 않은 키오스크의 핵심 시나리오에 맞춘다.
// 명령 처리·음성 응답 로직 자체는 GlobalVoiceCommand.jsx와 동일(같은
// useMomiVoice/useMomiSpeech/processVoiceCommand 조합) — 언제·어떻게
// 켜지는지(자동 vs 클릭)와 화면 표시(상태 표시등 vs 클릭 버튼)만 다르다.
//
// iOS 오디오 잠금 트릭(GlobalVoiceCommand의 unlockSpeech)은 여기서 안 쓴다 —
// 키오스크는 항상 게이밍 노트북(Windows/Chrome)이라 해당 없음.
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMomiVoice } from '../../hooks/useMomiVoice';
import { useMomiSpeech } from '../../hooks/useMomiSpeech';
import { processVoiceCommand } from '../../services/voiceCommandService';
import { useAuth } from '../../contexts/AuthContext';
import { store } from '../../demoData';
import { scopeMembersToTrainer, sortByName } from '../../utils/memberList';

export default function KioskVoiceCommand() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role === 'admin' ? 'admin' : 'trainer';
  const allMembers = useMemo(
    () => sortByName(scopeMembersToTrainer(store.getMembers(), user)),
    [user]
  );
  const [feedback, setFeedback] = useState('');

  const { speak } = useMomiSpeech();

  const handleCommand = useCallback(
    async (transcript) => {
      // [요청 흐름 2026-08-08] "모미야"→"네, 선생님"→(명령)→명령 인지 확인→
      // 실행/응답. GlobalVoiceCommand.jsx와 동일 패턴.
      setFeedback('네, 확인했어요.');
      speak('네, 확인했어요.');
      let message = '';
      // [진단용 2026-08-08] "키오스크에서 반응이 없다"는 문의 대응 — 실패 원인을
      // 화면에도 보여준다. GlobalVoiceCommand.jsx와 동일 패턴.
      let diagDetail = '';
      try {
        const result = await processVoiceCommand({
          transcript,
          role,
          currentUser: user,
          allMembers,
          navigate,
        });
        if (result.type === 'chat') {
          message = result.text;
        } else {
          message = result.matchedMember
            ? `${result.matchedMember.name}님으로 이동할게요.`
            : '이동할게요.';
        }
      } catch (e) {
        message = '죄송해요, 잘 처리하지 못했어요. 다시 말씀해주세요.';
        diagDetail = e?.message || String(e);
        console.warn('[모미] 명령 처리 실패:', diagDetail);
      } finally {
        setFeedback(diagDetail ? `${message}\n[진단] ${diagDetail}` : message);
        speak(message);
        setTimeout(() => setFeedback(''), diagDetail ? 8000 : 4000);
      }
    },
    [role, user, allMembers, navigate, speak]
  );

  const handleWakeOnly = useCallback(() => {
    const message = '네, 선생님.';
    setFeedback(message);
    speak(message);
    setTimeout(() => setFeedback(''), 3000);
  }, [speak]);

  const handleMismatch = useCallback((heard) => {
    // 상시 감지라 트레이너·회원 사이의 일반 대화도 계속 들어온다 — 진단 표시를
    // 버튼식보다 짧게 둔다. [2026-08-08] 다만 "모미야" 무반응 문의 대응으로
    // 2초→5초로 늘렸다 — 너무 짧으면 원인 파악에 필요한 이 문구 자체를 놓친다.
    const shown = heard ? `"${heard}"` : '(빈 소리만 인식됨)';
    setFeedback(`[진단] 들림: ${shown}`);
    setTimeout(() => setFeedback(''), 5000);
  }, []);

  const handleErrorOccurred = useCallback((errorCode) => {
    const KNOWN = {
      'not-allowed': '마이크 권한이 거부돼 있어요.',
      'audio-capture': '마이크 장치를 못 찾았어요.',
      network: '인터넷 연결을 확인해주세요.',
    };
    const readable = KNOWN[errorCode] || `오류 코드: ${errorCode}`;
    setFeedback(`[진단] ${readable}`);
    setTimeout(() => setFeedback(''), 4000);
  }, []);

  const { supported, listening, startListening } = useMomiVoice({
    onCommand: handleCommand,
    onWakeOnly: handleWakeOnly,
    onMismatch: handleMismatch,
    onErrorOccurred: handleErrorOccurred,
  });

  // [자동 시작] 버튼 클릭을 기다리지 않고 마운트되자마자 감지를 시작한다.
  // useMomiVoice 내부의 onend 자동 재시작(shouldRestartRef)이 계속 이어붙여주므로
  // 이후로도 계속 "상시 감지" 상태가 유지된다.
  // [2026-08-08] 시작 즉시 "상시 감지를 시작합니다"로 알려주던 진단용 확인은
  // 뺐다 — TTS 정상 동작을 실기기로 이미 확인했고(웨이크워드 오인식이 진짜
  // 원인이었음, useMomiVoice.js 참고), 요청하신 흐름엔 "모미야" 앞에 아무
  // 발화가 없어야 해서다.
  useEffect(() => {
    if (supported) startListening();
  }, [supported, startListening]);

  if (!supported) {
    // [진단용 2026-08-08] "키오스크에서 반응이 없다"는 문의 대응 — 예전엔 미지원
    // 브라우저면 그냥 아무것도 안 그려서(return null), 반응이 없는 게 "미지원
    // 때문"인지 "지원은 하는데 다른 문제"인지 화면만 보고는 구분이 안 됐다.
    // 최소한 이유는 보이게 한다.
    return (
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1000,
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.85)',
          color: '#fbbf24',
          fontSize: 13,
          fontWeight: 500,
          maxWidth: 240,
        }}
      >
        [진단] 이 브라우저는 음성인식(SpeechRecognition)을 지원하지 않아요.
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 8 }}
    >
      {feedback && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 500,
            maxWidth: 280,
            whiteSpace: 'pre-line',
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
          }}
        >
          {feedback}
        </div>
      )}
      {/* 버튼이 아니라 표시등 — 클릭 대상 아님. 상시 감지 중임을 알리는 프라이버시 고지 목적. */}
      <div
        aria-label={listening ? '"모미야" 상시 감지 중' : '마이크 대기 중'}
        title={listening ? '"모미야" 상시 감지 중' : '마이크 대기 중'}
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: listening ? '#ef4444' : '#9ca3af',
          boxShadow: listening ? '0 0 0 4px rgba(239,68,68,0.25)' : 'none',
        }}
      />
    </div>
  );
}
