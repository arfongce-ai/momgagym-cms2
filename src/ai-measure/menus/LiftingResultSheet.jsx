// ai-measure/menus/LiftingResultSheet.jsx
// ════════════════════════════════════════════════════════════════════════
//  바벨 측정 결과 시트 — UI/UX 전면 재설계 (역도·VBT 공용).
//  구성(위→아래):
//   ① 등급 히어로 — AI 평가 등급 배지 + 헤드라인 + 존 칩
//   ② 대형 평균속도 + ROM·시간·반복 인라인 요약
//   ③ 렙별 속도 바 차트 — 최고 렙 강조, 속도저하(%) 캡션
//   ④ 지표 칩(평활 최고속도 · 바 이탈/효율 · COG 이격 · 신호 교차검증)
//   ⑤ AI 평가 상세(근거 문장)
//   ⑥ 저장/영상 버튼
//  측정 정직성: 값이 없는 지표는 칩 자체를 렌더하지 않는다(빈 값·가짜 값 없음).
// ════════════════════════════════════════════════════════════════════════
import { generateLiftingDiagnosis, GRADE_LABEL } from '../core/barbellClinical';

const GRADE_STYLE = {
  excellent:   { badge: 'from-emerald-400 to-teal-500 text-slate-950', border: 'border-emerald-400/40' },
  good:        { badge: 'from-cyan-400 to-sky-500 text-slate-950',     border: 'border-cyan-400/40' },
  fair:        { badge: 'from-amber-400 to-orange-500 text-slate-950', border: 'border-amber-400/40' },
  needs_work:  { badge: 'from-rose-500 to-red-500 text-white',         border: 'border-rose-500/40' },
  insufficient:{ badge: 'from-slate-500 to-slate-600 text-white',      border: 'border-slate-500/40' },
};

function Chip({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'bg-white/[0.06] border-white/10 text-slate-800 dark:text-slate-100',
    cyan: 'bg-cyan-400/10 border-cyan-400/25 text-cyan-100',
    amber: 'bg-amber-400/10 border-amber-400/25 text-amber-100',
    fuchsia: 'bg-fuchsia-400/10 border-fuchsia-400/25 text-fuchsia-100',
  };
  return (
    <div className={`rounded-2xl border px-3 py-2 ${tones[tone]}`}>
      <p className="text-[9px] font-bold opacity-70 tracking-wide">{label}</p>
      <p className="font-mono font-black text-sm leading-tight">
        {value}{sub && <span className="text-[9px] font-bold opacity-60"> {sub}</span>}
      </p>
    </div>
  );
}

/** 렙별 속도 바 차트 — 최고 렙 강조. */
function RepBars({ reps, lossPct }) {
  const vals = reps.map(r => Number(r.meanVelocity)).filter(v => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  const max = Math.max(...vals);
  const showNum = reps.length <= 7;
  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] font-black text-slate-600 dark:text-slate-300 tracking-widest">렙별 평균속도</p>
        {lossPct != null && (
          <p className={`text-[10px] font-black ${lossPct > 20 ? 'text-rose-700 dark:text-rose-400' : lossPct > 10 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
            속도저하 −{lossPct}%
          </p>
        )}
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 72 }}>
        {reps.map((r) => {
          const v = Number(r.meanVelocity);
          const ok = Number.isFinite(v) && v > 0;
          const h = ok ? Math.max(14, (v / max) * 100) : 10;
          const isBest = ok && v === max;
          return (
            <div key={r.repNo} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1 h-full">
              {showNum && <span className={`font-mono text-[9px] font-bold ${isBest ? 'text-cyan-700 dark:text-cyan-300' : 'text-slate-500 dark:text-slate-400'}`}>{ok ? v : '–'}</span>}
              <div
                className={`w-full rounded-t-md ${isBest
                  ? 'bg-gradient-to-t from-cyan-500 to-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                  : 'bg-gradient-to-t from-slate-600 to-slate-400'}`}
                style={{ height: `${h}%` }}
              />
              <span className="text-[8px] font-bold text-slate-500">{r.repNo}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * @param {object} p
 * @param {'lifting'|'vbt'} p.mode
 * @param {object} p.result   측정 종료 결과(computeResult 산출)
 * @param {object|null} p.zone velocityZone 결과(VBT)
 */
export default function LiftingResultSheet({
  mode, exerciseType, result, zone = null,
  onSave, videoBlob, onSaveVideo, savingVideo, videoSavedMsg,
}) {
  if (!result) return null;
  const mean = result.meanVelocity ?? result.velocity ?? null;
  const time = result.timeSec ?? result.sec ?? null;
  const diag = generateLiftingDiagnosis({ ...result, meanVelocity: mean }, { mode, exerciseType });
  const gs = GRADE_STYLE[diag.grade] || GRADE_STYLE.insufficient;
  const cv = result.crossValidation;
  const cog = result.cogGap;

  return (
    <div className={`mx-auto max-w-md w-full rounded-3xl bg-slate-50/85 dark:bg-slate-950/85 backdrop-blur-xl border ${gs.border} p-4 space-y-3 animate-fade-in shadow-2xl`}>
      {/* ① 등급 히어로 */}
      <div className="flex items-center gap-3">
        <span className={`shrink-0 rounded-2xl bg-gradient-to-br ${gs.badge} px-3 py-2 text-center`}>
          <span className="block text-[8px] font-black opacity-80 tracking-widest">AI 평가</span>
          <span className="block text-sm font-black leading-none mt-0.5">{GRADE_LABEL[diag.grade]}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-black text-slate-800 dark:text-slate-100 leading-snug break-keep">{diag.headline}</p>
          {zone && <p className="text-[10px] font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">{zone.label} 존</p>}
        </div>
      </div>

      {/* ② 속도 히어로 + 인라인 요약 */}
      <div className="text-center">
        <p className="font-mono font-black text-slate-50 leading-none" style={{ fontSize: 52 }}>
          {mean != null ? mean : '—'}
          <span className="text-lg text-slate-500 font-bold"> m/s</span>
        </p>
        <p className="mt-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {result.romCm != null && <>ROM <span className="text-slate-700 dark:text-slate-200 font-mono">{result.romCm}cm</span></>}
          {time != null && <> · 시간 <span className="text-slate-700 dark:text-slate-200 font-mono">{time}s</span></>}
          {result.reps != null && result.reps > 0 && <> · 반복 <span className="text-slate-700 dark:text-slate-200 font-mono">{result.reps}회</span></>}
        </p>
      </div>

      {/* ③ 렙 바 차트 */}
      {result.repVelocity?.reps?.length > 1 && (
        <RepBars reps={result.repVelocity.reps} lossPct={result.velocityLoss} />
      )}

      {/* ④ 지표 칩 — 값 있는 것만 */}
      <div className="grid grid-cols-2 gap-2">
        {result.peakVelocity != null && (
          <Chip tone="cyan" label="평활 최고속도(실시간)" value={`${result.peakVelocity} m/s`} />
        )}
        {result.barPath?.maxDriftCm != null && (
          <Chip tone="amber" label="바 수평 이탈"
            value={`${result.barPath.maxDriftCm} cm`}
            sub={result.barPath.avgEfficiency != null ? `효율 ${Math.round(result.barPath.avgEfficiency * 100)}%` : null} />
        )}
        {cog?.available && (
          <Chip tone="fuchsia" label="바-무게중심 이격"
            value={cog.medianCm != null ? `${cog.medianCm} cm` : `${cog.medianRatio}`}
            sub={cog.maxCm != null ? `최대 ${cog.maxCm}cm` : null} />
        )}
        {cv?.totalFrames > 0 && (
          <Chip label="신호 교차검증"
            value={cv.avgAgreement != null ? `${Math.round(cv.avgAgreement * 100)}%` : '—'}
            sub={cv.assistRatio > 0 ? `보완 ${Math.round(cv.assistRatio * 100)}%` : null} />
        )}
      </div>

      {/* ⑤ AI 평가 상세 */}
      {diag.details?.length > 0 && (
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 space-y-1">
          {diag.details.slice(0, 4).map((d, i) => (
            <p key={i} className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed break-keep">· {d}</p>
          ))}
        </div>
      )}

      {/* ⑥ 액션 */}
      {onSave && (
        <button onClick={onSave}
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-[15px] active:scale-[0.98] shadow-lg shadow-amber-500/25">
          이 측정 저장 →
        </button>
      )}
      {videoBlob && (
        <button onClick={onSaveVideo} disabled={savingVideo}
          className="w-full h-10 rounded-2xl bg-white/[0.06] border border-white/10 text-slate-700 dark:text-slate-200 font-bold text-xs active:scale-[0.98] disabled:opacity-50">
          {savingVideo ? '저장 중…' : '🎥 녹화 영상 폰에 저장'}
        </button>
      )}
      {videoSavedMsg && <p className="text-center text-[11px] text-emerald-700 dark:text-emerald-400">{videoSavedMsg}</p>}
    </div>
  );
}
