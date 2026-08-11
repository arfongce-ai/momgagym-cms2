// src/components/report/MomiInsightPanel.jsx
// 자세·ROM·점프·보행 리포트 화면에 한 줄씩 추가하는 "🤖 모미에게 물어보기" 버튼 + 결과 패널.
// kind/report/member 3개 props만 받는다. 자체 음성 모드는 없음(전역 마이크 GlobalVoiceCommand와
// 충돌 방지 차원에서 제거됨) — 버튼을 눌러 텍스트로만 요청한다.
//
// [Axis4 시작 2026-08-08] 트레이너-모미 양방향 소통의 첫 실물 — 지금까지는 한 번
// 묻고 한 번 답하면 끝(무상태)이었는데, 첫 답변 이후 "후속 질문하기" 입력창이
// 나타나서 그 답변에 이어서 계속 물어볼 수 있다. history 배열(실제 대화 흐름은
// askMomi에 넘기는 history 파라미터가 관리)을 이 컴포넌트가 들고 있다가 매 후속
// 질문마다 통째로 다시 보낸다(Claude의 표준 멀티턴 방식).
// 첫 턴의 "사용자 발화"는 실제 프롬프트 원문(리포트 JSON 전체)이 아니라 고정된
// 짧은 placeholder를 쓴다 — askMomi의 기존 반환 타입(string)을 안 바꾸기 위함이고,
// Claude 입장에선 자기 이전 답변이 history에 있는 것만으로 충분히 맥락을 잇는다.
//
// [라이트모드 2026-08-11] 예전엔 인라인 style={{background:'#f9fafb', ...}}로
// 하드코딩된 밝은 색만 썼다 — 다른 컴포넌트가 전부 dark: variant로 바뀐 지금은
// 이 패널만 다크모드에서 튀는(밝은 박스가 어두운 화면 위에 뜨는) 상태였다.
// 나머지와 똑같이 Tailwind + dark: variant로 통일한다(동작은 그대로, 색만 정리).

import { useState } from 'react';
import { askMomi } from '../../services/momiService';

const INITIAL_USER_TURN = { role: 'user', content: '이 리포트를 분석해줘.' };

export default function MomiInsightPanel({ kind, report, member }) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]); // [{role, content}, ...] — 후속 질문용 대화 맥락
  const [followUpText, setFollowUpText] = useState('');

  const handleAsk = async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await askMomi({ kind, report, member });
      setAnswer(text);
      setHistory([INITIAL_USER_TURN, { role: 'assistant', content: text }]);
    } catch (e) {
      setError(e.message || '모미에게 물어보는 중 문제가 생겼어요.');
    } finally {
      setLoading(false);
    }
  };

  const handleFollowUp = async () => {
    const q = followUpText.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const text = await askMomi({ kind, report, member, question: q, history });
      setHistory((h) => [...h, { role: 'user', content: q }, { role: 'assistant', content: text }]);
      setFollowUpText('');
    } catch (e) {
      setError(e.message || '후속 질문을 처리하는 중 문제가 생겼어요.');
    } finally {
      setLoading(false);
    }
  };

  // 최초 질문 이후의 대화만 화면에 스레드로 보여준다(INITIAL_USER_TURN은 실제
  // 발화가 아니라 placeholder라 굳이 안 보여줌 — answer가 그 자리를 대신함).
  const followUpThread = history.slice(2);

  return (
    <div className="mt-4 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
      <button
        onClick={handleAsk}
        disabled={loading || !report || !member}
        className="px-4 py-2.5 rounded-lg font-semibold text-white bg-slate-900 dark:bg-slate-700 disabled:opacity-60 disabled:cursor-default active:scale-[0.98] transition-transform"
      >
        {loading && history.length === 0 ? '모미가 분석 중이에요...' : '🤖 모미에게 물어보기'}
      </button>

      {error && <p className="mt-3 text-red-600 dark:text-red-400">{error}</p>}

      {answer && (
        <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
          {answer}
        </div>
      )}

      {followUpThread.map((turn, i) => (
        <div
          key={i}
          className={`mt-2 p-3 rounded-lg whitespace-pre-wrap leading-relaxed ${
            turn.role === 'user'
              ? 'bg-indigo-50 dark:bg-indigo-500/10 text-slate-800 dark:text-slate-100'
              : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
          }`}
        >
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {turn.role === 'user' ? '나' : '모미'}
          </span>
          <div>{turn.content}</div>
        </div>
      ))}

      {answer && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFollowUp();
            }}
            placeholder="이어서 물어보기..."
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleFollowUp}
            disabled={loading || !followUpText.trim()}
            className="px-3.5 py-2 rounded-lg font-semibold text-white bg-slate-900 dark:bg-slate-700 disabled:opacity-50 disabled:cursor-default active:scale-[0.98] transition-transform"
          >
            보내기
          </button>
        </div>
      )}
    </div>
  );
}
