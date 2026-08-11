// src/components/report/CombinedAssessmentPanel.jsx
// ════════════════════════════════════════════════════════════════════════
//  트레이너가 회원의 측정 종류를 1~7개 자유롭게 골라 종합 분석·평가를 보는 패널.
//  crossMeasureContext.js의 buildCombinedAssessment()(대칭 결합, 하드코딩 없이
//  어떤 조합이든 처리)를 momiService.js의 loadLatestReportsByKind/
//  buildMemberCombinedAssessment로 감싸 쓴다 — 데이터 조회 로직은 momiService.js
//  하나에 모아, 모미 질문·종합분석 화면이 같은 소스를 공유하게 한다.
//  Report.jsx에는 진입 버튼 하나만 추가하고, 나머지는 이 파일 안에서 독립 처리한다.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect } from 'react';
import { loadLatestReportsByKind, buildMemberCombinedAssessment, askMomiCombined } from '../../services/momiService';

const KIND_KO = {
  posture: '자세·체형', rom: 'ROM', jump: '점프', gait: '보행·러닝',
  lifting: '바벨 리프팅(VBT)', stance: '한다리서기', squat: '오버헤드 스쿼트',
};
const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험' };

export default function CombinedAssessmentPanel({ member, onClose }) {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState({}); // { kind: latestReport }
  const [selected, setSelected] = useState(new Set());
  const [result, setResult] = useState(null);
  const [momiLoading, setMomiLoading] = useState(false);
  const [momiAnswer, setMomiAnswer] = useState(null);
  const [momiError, setMomiError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!member?.id) { setLoading(false); return undefined; }
    setLoading(true);
    loadLatestReportsByKind(member.id).then((avail) => {
      if (!alive) return;
      setAvailable(avail);
      setSelected(new Set(Object.keys(avail))); // 기본값: 있는 것 전부 선택
      setLoading(false);
    });
    return () => { alive = false; };
  }, [member?.id]);

  const toggle = (kind) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
    setResult(null); // 선택이 바뀌면 이전 결과는 무효화(오래된 결과 오인 방지)
    setMomiAnswer(null);
    setMomiError(null);
  };

  const runAnalysis = () => {
    setResult(buildMemberCombinedAssessment(available, [...selected]));
    setMomiAnswer(null);
    setMomiError(null);
  };

  const askMomiGuide = async () => {
    setMomiLoading(true);
    setMomiError(null);
    try {
      const text = await askMomiCombined({ member, result });
      setMomiAnswer(text);
    } catch (e) {
      setMomiError(e.message || '모미에게 물어보는 중 문제가 생겼어요.');
    } finally {
      setMomiLoading(false);
    }
  };

  const availableKinds = Object.keys(available);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">측정 종합 분석</p>
          <p className="text-[11px] text-slate-500 mt-0.5">측정 종류를 골라 하나로 묶어 확인합니다.</p>
        </div>
        {onClose && <button onClick={onClose} className="text-slate-500 dark:text-slate-400 text-sm">닫기 ✕</button>}
      </div>

      {loading && <p className="text-sm text-slate-500 text-center py-4">불러오는 중…</p>}

      {!loading && availableKinds.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-4">이 회원의 저장된 측정 리포트가 아직 없습니다.</p>
      )}

      {!loading && availableKinds.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {availableKinds.map((kind) => (
              <button
                key={kind}
                onClick={() => toggle(kind)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold border transition-colors ${
                  selected.has(kind)
                    ? 'bg-amber-500 border-amber-500 text-slate-950'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}
              >
                {selected.has(kind) ? '✓ ' : ''}{KIND_KO[kind] || kind}
              </button>
            ))}
          </div>

          <button
            onClick={runAnalysis}
            disabled={selected.size === 0}
            className="w-full rounded-xl bg-emerald-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 text-slate-950 font-black py-3"
          >
            {selected.size > 0 ? `선택한 ${selected.size}개 종합 분석` : '1개 이상 선택하세요'}
          </button>
        </>
      )}

      {result && (
        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className={`rounded-xl border p-3 ${
            result.severity === 'risk' ? 'border-red-500/40 bg-red-500/10'
              : result.severity === 'caution' ? 'border-amber-500/40 bg-amber-500/10'
              : 'border-emerald-500/40 bg-emerald-500/10'}`}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">종합 평가</p>
            <p className="text-white font-black text-lg">{STATUS_KO[result.severity] || result.severity}</p>
            <p className="text-slate-600 dark:text-slate-300 text-sm mt-1">{result.evaluation.text}</p>
            <p className="text-[10px] text-slate-500 mt-1">신뢰도 {result.coverageScore}점 ({result.combinedKinds.length}개 측정 결합)</p>
          </div>

          {result.issues.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-black text-slate-600 dark:text-slate-300">확인된 사항</p>
              {result.issues.map((it, i) => (
                <p key={i} className={`text-sm ${it.level === 'risk' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>• {it.text}</p>
              ))}
            </div>
          )}
          {result.strengths.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-black text-slate-600 dark:text-slate-300">양호한 점</p>
              {result.strengths.map((s, i) => <p key={i} className="text-sm text-emerald-700 dark:text-emerald-300">• {s}</p>)}
            </div>
          )}

          <button
            onClick={askMomiGuide}
            disabled={momiLoading}
            className="w-full rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-bold py-2.5 text-sm transition-colors"
          >
            {momiLoading ? '모미가 통합 가이드 만드는 중…' : '🤖 모미에게 통합 가이드 요청'}
          </button>

          {momiError && <p className="text-sm text-red-700 dark:text-red-400">{momiError}</p>}

          {momiAnswer && (
            <div className="rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
              {momiAnswer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
