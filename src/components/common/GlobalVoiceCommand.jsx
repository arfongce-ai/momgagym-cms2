// src/components/common/GlobalVoiceCommand.jsx
// 앱 전체(홈 포함)에서 항상 떠 있는 마이크 버튼. 기본값은 꺼짐 — 트레이너가 직접 켜야 한다.
// 켜져 있을 때는 화면에 항상 빨간 점으로 표시해 프라이버시를 알린다.
import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMomiVoice } from '../../hooks/useMomiVoice';
import { useMomiSpeech } from '../../hooks/useMomiSpeech';
import { processVoiceCommand } from '../../services/voiceCommandService';
import { useAuth } from '../../contexts/AuthContext';
import { store } from '../../demoData';
import { scopeMembersToTrainer, sortByName } from '../../utils/memberList';

export default function GlobalVoiceCommand() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role === 'admin' ? 'admin' : 'trainer';
  const allMembers = useMemo(
    () => sortByName(scopeMembersToTrainer(store.getMembers(), user)),
    [user]
  );
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const { speak, stop: stopSpeaking, unlock: unlockSpeech } = useMomiSpeech();

  const handleCommand = useCallback(
    async (transcript) => {
      setBusy(true);
      setFeedback('');
      // 화면 표시(feedback)와 음성 출력(speak)이 서로 다른 문구로 갈리지 않도록
      // 메시지를 한 곳에서만 만든다.
      let message = '';
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
      } finally {
        setFeedback(message);
        speak(message);
        setBusy(false);
        setTimeout(() => setFeedback(''), 4000);
      }
    },
    [role, user, allMembers, navigate, speak]
  );

  const handleWakeOnly = useCallback(() => {
    // "모미야"까지만 듣고 명령이 안 붙어 왔을 때 — 아무 반응이 없으면 트레이너
    // 입장에선 "불렀는데 반응이 없다"로 보이니, 들었다는 것만이라도 알려준다.
    const message = '네, 말씀하세요.';
    setFeedback(message);
    speak(message);
    setTimeout(() => setFeedback(''), 3000);
  }, [speak]);

  const { supported, listening, startListening, stopListening } = useMomiVoice({
    onCommand: handleCommand,
    onWakeOnly: handleWakeOnly,
  });

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      stopListening();
      // 마이크를 끄면 모미가 말하던 중이어도 같이 멈춘다.
      stopSpeaking();
    } else {
      // iOS Safari 대응: 지금 이 탭 이벤트 안에서 미리 오디오를 잠금 해제해둬야
      // 나중에 "모미야" 응답을 비동기로 speak()할 때 소리가 나온다.
      unlockSpeech();
      startListening();
    }
  };

  return (
    // [버그 수정 2026-07] 데스크탑은 사이드바라 bottom:20이면 충분하지만, 모바일은
    // AppLayout의 하단 탭바(핵심 4개 + "전체")가 화면 맨 아래를 차지하고 있어
    // 마이크 버튼이 그 위에 겹쳐 "전체" 탭을 가렸다. 모바일 하단바 높이(~56px
    // + 아이콘/라벨 여백 + 아이폰 하단 안전영역)만큼 더 띄우고, md 이상(데스크탑)
    // 에서는 기존 20px 그대로 되돌린다 — AppLayout의 하단바 자체도 같은 md 기준으로
    // 나타났다 사라지므로 같은 기준선을 맞춘 것.
    <div
      className="fixed right-5 bottom-[calc(88px+env(safe-area-inset-bottom))] md:bottom-5"
      style={{ zIndex: 1000 }}
    >
      {feedback && (
        <div
          style={{
            marginBottom: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            fontSize: 13,
            maxWidth: 240,
          }}
        >
          {feedback}
        </div>
      )}
      <button
        onClick={toggle}
        aria-label={listening ? '음성 명령 끄기' : '음성 명령 켜기 (모미야)'}
        disabled={busy}
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: 'none',
          background: listening ? '#ef4444' : '#111827',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          position: 'relative',
          cursor: busy ? 'default' : 'pointer',
          fontSize: 22,
          lineHeight: 1,
        }}
      >
        {listening ? '🎙️' : '🔇'}
        {listening && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#f87171',
              boxShadow: '0 0 0 2px #111827',
            }}
          />
        )}
      </button>
    </div>
  );
}
