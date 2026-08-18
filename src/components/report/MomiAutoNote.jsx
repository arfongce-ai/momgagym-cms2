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
import { askMomi, MOMI_PROMPT_VERSION } from '../../services/momiService';

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
  const attemptedKeyRef = useRef(null);
  const activeKeyRef = useRef(null);

  useEffect(() => {
    if (!report?.id || !member?.id) return;
    const sourceUpdatedAt = report.analysisUpdatedAt || report.updatedAt || report.measuredAt || report.createdAt || report.recordedAt || null;
    const requestKey = `${member.id}:${report.id}:${sourceUpdatedAt || 'undated'}:${MOMI_PROMPT_VERSION}`;
    activeKeyRef.current = requestKey;

    const storedNote = report.momiNote || null;
    const storedIsCurrent = Boolean(
      storedNote?.text &&
      storedNote.promptVersion === MOMI_PROMPT_VERSION &&
      (sourceUpdatedAt == null || storedNote.sourceUpdatedAt === sourceUpdatedAt)
    );
    if (storedIsCurrent) {
      setNote(storedNote);
      setLoading(false);
      setError(null);
      attemptedKeyRef.current = requestKey;
      return;
    }
    if (attemptedKeyRef.current === requestKey) return;
    attemptedKeyRef.current = requestKey;
    setNote(null);
    setLoading(true);
    setError(null);
    askMomi({ kind, report, member })
      .then(async (text) => {
        if (activeKeyRef.current !== requestKey) return;
        const saved = {
          text,
          createdAt: Date.now(),
          promptVersion: MOMI_PROMPT_VERSION,
          sourceUpdatedAt,
        };
        setNote(saved);
        if (onSaved) {
          try { await onSaved({ momiNote: saved }); }
          catch (e) { console.warn('[MomiAutoNote] 저장 실패(화면엔 그대로 표시됨):', e?.message || e); }
        }
      })
      .catch((e) => {
        if (activeKeyRef.current === requestKey) setError(e.message || '모미 노트를 만드는 중 문제가 생겼어요.');
      })
      .finally(() => {
        if (activeKeyRef.current === requestKey) setLoading(false);
      });
    // 리포트 식별자·원본 갱신 시각·저장 노트가 바뀔 때 최신성 재검사.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id, member?.id, report?.analysisUpdatedAt, report?.updatedAt, report?.measuredAt, report?.createdAt, report?.recordedAt, report?.momiNote]);

  if (!report?.id || !member?.id) return null;
  if (!loading && !error && !note) return null; // 아직 아무 것도 할 게 없으면 자리 안 차지함

  return (
    <div className="rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 p-3 text-sm">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">🤖 모미 자동 노트</p>
      {loading && <p className="text-slate-500">모미가 확인하고 있어요…</p>}
      {error && <p className="text-red-700 dark:text-red-400 text-xs">{error}</p>}
      {note && <p className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{note.text}</p>}
    </div>
  );
}
