// src/components/report/MomiAutoNote.jsx
// ════════════════════════════════════════════════════════════════════════
//  자비스 로드맵 축3(자동 업데이터)의 첫 실물 — "회원데이터가 바뀌면 자동으로
//  최신 상태 유지"를 가장 작은 범위로 구현한다: 트레이너가 이 리포트를 열면,
//  버튼을 누르지 않아도 모미가 자동으로 짧은 노트를 만들어 리포트 문서에
//  저장한다. 다음에 같은 리포트를 열면 재호출 없이 저장된 노트를 바로 보여준다.
//
//  "완전 백그라운드 자동"(측정 저장 즉시, 아무도 화면을 안 보고 있어도 생성)이
//  아니라 "트레이너가 열면 그 순간 자동"인 이유: 이 프로젝트는 Cloudflare Pages
//  Functions(요청-응답형)로만 배포되고 있고, Firestore 쓰기를 감지해 서버가 스스로
//  깨어나는 트리거 인프라가 없다. 그걸 새로 만드는 건 배포 아키텍처 자체를 바꾸는
//  훨씬 큰 작업이라 — 지금 구조 안에서 "트레이너가 버튼을 누를 필요 없다"는 축3의
//  핵심을 만족하는 가장 작고 안전한 형태를 택했다.
//
//  실패해도 조용히 넘어간다(측정 결과 확인 자체를 막지 않는다) — 무결성검사·
//  종합분석과 같은 원칙: 부가 기능은 실패해도 본 기능(리포트 열람)을 절대 막지 않는다.
// ════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from 'react';
import { askMomi } from '../../services/momiService';

/**
 * @param {string} kind        buildProblemFocus가 아는 kind('posture'|'rom'|'jump'|'gait'|'stance'|'squat')
 * @param {object} report      해당 리포트 원본 객체(반드시 .id 포함)
 * @param {object} member      { id, name, category? }
 * @param {(patch:object)=>Promise} onSaved  생성된 노트를 리포트 문서에 저장하는 함수
 *   (예: (patch) => aiStore.updatePostureReport(member.id, report.id, patch))
 */
export default function MomiAutoNote({ kind, report, member, onSaved }) {
  const [note, setNote] = useState(report?.momiNote || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const triedRef = useRef(false); // 같은 마운트 동안 중복 호출 방지(리렌더로 재요청 안 되게)

  useEffect(() => {
    if (note || triedRef.current) return;
    if (!report?.id || !member?.id) return;
    triedRef.current = true;
    setLoading(true);
    setError(null);
    askMomi({ kind, report, member })
      .then(async (text) => {
        const saved = { text, createdAt: Date.now() };
        setNote(saved);
        if (onSaved) {
          try { await onSaved({ momiNote: saved }); }
          catch (e) { console.warn('[MomiAutoNote] 저장 실패(화면엔 그대로 표시됨):', e?.message || e); }
        }
      })
      .catch((e) => setError(e.message || '모미 노트를 만드는 중 문제가 생겼어요.'))
      .finally(() => setLoading(false));
    // report/member 식별자가 바뀔 때만 재실행 — kind/onSaved는 매 렌더 새 참조라도 상관없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id, member?.id]);

  if (!report?.id || !member?.id) return null;
  if (!loading && !error && !note) return null; // 아직 아무 것도 할 게 없으면 자리 안 차지함

  return (
    <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-3 text-sm">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">🤖 모미 자동 노트</p>
      {loading && <p className="text-slate-500">모미가 확인하고 있어요…</p>}
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {note && <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{note.text}</p>}
    </div>
  );
}
