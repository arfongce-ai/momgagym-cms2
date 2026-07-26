// src/components/common/GlobalVoiceCommand.jsx
// 앱 전체(홈 포함)에서 항상 떠 있는 마이크 버튼. 기본값은 꺼짐 — 트레이너가 직접 켜야 한다.
// 켜져 있을 때는 화면에 항상 빨간 점으로 표시해 프라이버시를 알린다.
//
// ⚠️ useAuth()의 정확한 훅 이름/반환값은 실제 프로젝트의 인증 컨텍스트에 맞춰 확인해주세요.
// ⚠️ 회원 목록을 어디서 가져오는지도(예: useMembers() 훅 등) 실제 프로젝트 구조에 맞춰 확인해주세요.
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff } from 'lucide-react';
import { useMomiVoice } from '../../hooks/useMomiVoice';
import { processVoiceCommand } from '../../services/voiceCommandService';
import { useAuth } from '../../contexts/AuthContext';

export default function GlobalVoiceCommand({ allMembers = [] }) {
  const navigate = useNavigate();
  const { currentUser, role } = useAuth();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCommand = useCallback(
    async (transcript) => {
      setBusy(true);
      setFeedback('');
      try {
        const result = await processVoiceCommand({
          transcript,
          role,
          currentUser,
          allMembers,
          navigate,
        });
        if (result.type === 'chat') {
          setFeedback(result.text);
        } else {
          setFeedback(
            result.matchedMember
              ? `${result.matchedMember.name}님으로 이동할게요.`
              : '이동할게요.'
          );
        }
      } catch (e) {
        setFeedback('죄송해요, 잘 처리하지 못했어요. 다시 말씀해주세요.');
      } finally {
        setBusy(false);
        setTimeout(() => setFeedback(''), 4000);
      }
    },
    [role, currentUser, allMembers, navigate]
  );

  const { supported, listening, startListening, stopListening } = useMomiVoice({
    onCommand: handleCommand,
  });

  if (!supported) return null;

  const toggle = () => (listening ? stopListening() : startListening());

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 1000 }}>
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
        }}
      >
        {listening ? <Mic size={22} /> : <MicOff size={22} />}
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
