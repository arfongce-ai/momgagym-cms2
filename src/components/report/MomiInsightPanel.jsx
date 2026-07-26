// src/components/report/MomiInsightPanel.jsx
// 자세·ROM·점프·보행 리포트 화면에 한 줄씩 추가하는 "🤖 모미에게 물어보기" 버튼 + 결과 패널.
// kind/report/member 3개 props만 받는다. 자체 음성 모드는 없음(전역 마이크 GlobalVoiceCommand와
// 충돌 방지 차원에서 제거됨) — 버튼을 눌러 텍스트로만 요청한다.

import { useState } from 'react';
import { askMomi } from '../../services/momiService';

export default function MomiInsightPanel({ kind, report, member }) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);

  const handleAsk = async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await askMomi({ kind, report, member });
      setAnswer(text);
    } catch (e) {
      setError(e.message || '모미에게 물어보는 중 문제가 생겼어요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 16, padding: 16, borderRadius: 12, border: '1px solid #e5e7eb' }}>
      <button
        onClick={handleAsk}
        disabled={loading || !report || !member}
        style={{
          padding: '10px 16px',
          borderRadius: 8,
          border: 'none',
          background: '#111827',
          color: '#fff',
          fontWeight: 600,
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? '모미가 분석 중이에요...' : '🤖 모미에게 물어보기'}
      </button>

      {error && <p style={{ color: '#dc2626', marginTop: 12 }}>{error}</p>}

      {answer && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            background: '#f9fafb',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.6,
          }}
        >
          {answer}
        </div>
      )}
    </div>
  );
}
