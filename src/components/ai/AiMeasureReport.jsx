// AiMeasureReport.jsx — AI 측정 통합 모달
// 구조: 상단(측정값 입력) → 중앙(분석 상태) → 하단(결과 리포트 카드)
// Gemini 교차검증 반영:
//   - 상태 기반 카드 UI (정상:green, 경고:yellow, 위험:red)
//   - [상담 메모로 복사], [이미지 공유] 버튼
//   - touch-action:none + 고정 높이 스크롤
//   - try-catch 완비 (측정값 누락 시 분석 중단 없음)
import { useState } from 'react';
import { createAiSession, generateReportText } from '../../services/aiService';

// ── 색상 맵 ──────────────────────────────────────────────
const GRADE_STYLE = {
  good: {
    border:  'border-emerald-500/30',
    bg:      'bg-emerald-500/5',
    badge:   'bg-emerald-500/20 text-emerald-400',
    icon:    '✅',
  },
  warn: {
    border:  'border-amber-500/30',
    bg:      'bg-amber-500/5',
    badge:   'bg-amber-500/20 text-amber-400',
    icon:    '⚠️',
  },
  bad: {
    border:  'border-red-500/30',
    bg:      'bg-red-500/5',
    badge:   'bg-red-500/20 text-red-400',
    icon:    '🔴',
  },
};

// ── 분석 중 진행 애니메이션 ───────────────────────────────
function AnalysisProgress({ step }) {
  const steps = [
    '측정값 검증 중…',
    'BMI 체질량지수 분석 중…',
    '혈압 등급 판정 중…',
    '종합 리포트 생성 중…',
  ];
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="w-14 h-14 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      <div className="space-y-1 text-center">
        {steps.map((s, i) => (
          <p key={s} className={`text-sm transition-all duration-300
            ${i < step  ? 'text-slate-600 line-through' :
              i === step ? 'text-amber-400 font-semibold' :
                           'text-slate-700'}`}>
            {i < step ? '✓' : i === step ? '▶' : '·'} {s}
          </p>
        ))}
      </div>
    </div>
  );
}

// ── 리포트 카드 ───────────────────────────────────────────
function ReportCard({ item }) {
  const style = GRADE_STYLE[item.grade] || GRADE_STYLE.warn;
  return (
    <div className={`border rounded-xl p-3 ${style.border} ${style.bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span>{style.icon}</span>
            <span className="font-semibold text-sm text-slate-200">{item.label}</span>
          </div>
          {item.description && (
            <p className="text-xs text-slate-500 mt-0.5 ml-6">{item.description}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <span className={`text-lg font-black font-mono ${
            item.grade==='good' ? 'text-emerald-400' :
            item.grade==='warn' ? 'text-amber-400'   :
                                  'text-red-400'
          }`}>
            {item.value}
            {item.unit && <span className="text-xs font-normal text-slate-500 ml-0.5">{item.unit}</span>}
          </span>
          <div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${style.badge}`}>
              {item.status || ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────
const INP = `w-full bg-slate-800 border border-slate-700 text-slate-100
  rounded-xl px-3 py-2.5 text-sm font-mono placeholder-slate-500
  focus:outline-none focus:border-amber-500`;

const STEPS = { input: 0, analyzing: 1, result: 2 };

export default function AiMeasureReport({ member, onClose, onSaved }) {
  const [phase, setPhase]     = useState('input');   // input | analyzing | result
  const [analysisStep, setAS] = useState(0);
  const [error, setError]     = useState('');
  const [result, setResult]   = useState(null);

  const [form, setForm] = useState({
    height:    '',
    weight:    '',
    systolic:  '',  // 최고혈압 (수축기)
    diastolic: '',  // 최저혈압 (이완기)
    memo:      '',
  });

  const pf = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  // ── 분석 실행 ─────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!form.weight) { setError('체중은 필수 입력값입니다.'); return; }
    setError(''); setPhase('analyzing');

    // 진행 단계 애니메이션 (각 0.5초)
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 500));
      setAS(i + 1);
    }

    // AI 세션 생성 (try-catch 완비)
    const res = await createAiSession(
      member.id,
      {
        height:    form.height    ? Number(form.height)    : null,
        weight:    Number(form.weight),
        systolic:  form.systolic  ? Number(form.systolic)  : null,
        diastolic: form.diastolic ? Number(form.diastolic) : null,
      },
      form.memo
    );

    if (!res.success) {
      setError(res.error || '저장 중 오류가 발생했습니다.');
      setPhase('input');
      return;
    }

    setResult(res.session);
    setPhase('result');
    onSaved?.();
  };

  // ── 상담 메모 복사 ─────────────────────────────────────
  const handleCopyMemo = async () => {
    if (!result) return;
    try {
      const text = generateReportText(result);
      await navigator.clipboard.writeText(text);
      alert('📋 상담 메모가 클립보드에 복사되었습니다.');
    } catch {
      alert('복사에 실패했습니다. 직접 선택하여 복사해 주세요.');
    }
  };

  // ── 이미지 공유 (Web Share API) ───────────────────────
  const handleShare = async () => {
    if (!result) return;
    const text = generateReportText(result);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${member.name} 체성분 리포트`, text });
      } else {
        handleCopyMemo();
      }
    } catch (err) {
      if (err.name !== 'AbortError') handleCopyMemo();
    }
  };

  const analysisResult = result?.analysisResult;

  return (
    // touch-action:none — 모바일 스크롤 간섭 차단
    <div
      className="modal-overlay"
      style={{ touchAction: 'none' }}
    >
      <div className="modal-box">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div>
            <h2 className="font-bold text-base">
              {phase === 'input'     && '🤖 AI 체성분 측정'}
              {phase === 'analyzing' && '🔬 분석 중…'}
              {phase === 'result'    && '📊 분석 리포트'}
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">{member.name} 회원</p>
          </div>
          <button onClick={onClose}
            className="text-slate-500 hover:text-white text-2xl leading-none p-1">×</button>
        </div>

        {/* ── 고정 높이 스크롤 영역 ── */}
        <div className="modal-body" style={{ touchAction: 'pan-y' }}>

          {/* ─ 상단: 측정값 입력 ─────────────────────── */}
          {phase === 'input' && (
            <div className="p-5 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                <p className="text-xs text-amber-400 font-semibold">
                  💡 체중은 필수, 나머지는 선택 입력입니다
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
                    키 (cm)
                  </label>
                  <input type="number" step="0.1" value={form.height} onChange={pf('height')}
                    placeholder="175.0" className={INP} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
                    몸무게 (kg) <span className="text-red-400">*</span>
                  </label>
                  <input type="number" step="0.1" value={form.weight} onChange={pf('weight')}
                    placeholder="70.0" className={INP} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
                    최고혈압 (mmHg)
                  </label>
                  <input type="number" step="1" value={form.systolic} onChange={pf('systolic')}
                    placeholder="120" className={INP} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
                    최저혈압 (mmHg)
                  </label>
                  <input type="number" step="1" value={form.diastolic} onChange={pf('diastolic')}
                    placeholder="80" className={INP} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
                  트레이너 메모 (선택)
                </label>
                <textarea rows={2} value={form.memo} onChange={pf('memo')}
                  placeholder="측정 시 특이사항, 컨디션 등"
                  className={INP.replace('font-mono', '') + ' resize-none'} />
              </div>

              {error && (
                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </div>
          )}

          {/* ─ 중앙: 분석 진행 ───────────────────────── */}
          {phase === 'analyzing' && (
            <AnalysisProgress step={analysisStep} />
          )}

          {/* ─ 하단: 결과 리포트 ─────────────────────── */}
          {phase === 'result' && analysisResult && (
            <div className="p-5 space-y-4">

              {/* 측정값 요약 */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label:'키',       value: form.height    || '-', unit:'cm'   },
                  { label:'몸무게',   value: form.weight    || '-', unit:'kg'   },
                  { label:'최고혈압', value: form.systolic  || '-', unit:'mmHg' },
                  { label:'최저혈압', value: form.diastolic || '-', unit:'mmHg' },
                ].map(m => (
                  <div key={m.label} className="bg-slate-800 rounded-xl p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">{m.label}</p>
                    <p className="font-mono font-black text-sm text-slate-100">
                      {m.value}
                      <span className="text-[10px] text-slate-500 font-normal">{m.unit}</span>
                    </p>
                  </div>
                ))}
              </div>

              {/* 분석 카드 목록 */}
              {analysisResult.items?.length > 0 ? (
                <div className="space-y-2">
                  {analysisResult.items.map(item => (
                    <ReportCard key={item.key} item={item} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-slate-500 text-sm">
                  분석 가능한 항목이 없습니다. 더 많은 측정값을 입력해 주세요.
                </div>
              )}

              {/* 종합 의견 */}
              <div className={`border rounded-xl p-4 space-y-1 ${
                analysisResult.error
                  ? 'border-slate-700 bg-slate-800/50'
                  : 'border-slate-600 bg-slate-800/40'
              }`}>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">종합 의견</p>
                <p className="text-sm text-slate-300 leading-relaxed">{analysisResult.summary}</p>
              </div>

              {/* 트레이너 메모 */}
              {form.memo && (
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-3">
                  <p className="text-xs text-slate-500 font-semibold mb-1">트레이너 메모</p>
                  <p className="text-sm text-slate-300 whitespace-pre-line">{form.memo}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-slate-800">
          {phase === 'input' && (
            <div className="flex gap-2">
              <button onClick={onClose}
                className="py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors">
                취소
              </button>
              <button onClick={handleAnalyze} disabled={!form.weight}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">
                🔬 AI 분석 시작
              </button>
            </div>
          )}

          {phase === 'analyzing' && (
            <p className="text-center text-xs text-slate-500 animate-pulse">
              분석 중입니다. 잠시 기다려 주세요…
            </p>
          )}

          {phase === 'result' && (
            <div className="space-y-2">
              {/* 상담 메모로 복사 + 이미지 공유 */}
              <div className="flex gap-2">
                <button onClick={handleCopyMemo}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
                  📋 상담 메모로 복사
                </button>
                <button onClick={handleShare}
                  className="flex-1 py-2.5 rounded-xl border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
                  📤 이미지 공유
                </button>
              </div>
              <button onClick={onClose}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                닫기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
