// ai-measure/menus/RomTrimSlider.jsx
// ════════════════════════════════════════════════════════════════════════
//  개선 4: 사람이 확인하는 보정 단계.
//   측정이 끝나면 트레이너가 궤적 구간을 눈으로 보고, 이상치(드리프트 등)가
//   낀 부분을 잘라낼 수 있게 하는 이중 슬라이더. 값 자체는 계산하지 않고
//   startPct/endPct(0~100)만 상위로 올려준다 — 실제 재계산(trimPathToRange)
//   은 호출부(LiftingMeasure/VbtMeasure)가 담당해 모드별 단위(cm/s 등)에
//   맞게 처리한다.
// ════════════════════════════════════════════════════════════════════════
export default function RomTrimSlider({ startPct, endPct, onChange, sampleCount }) {
  const setStart = (v) => {
    const s = Math.min(Number(v), endPct - 5);
    onChange(Math.max(0, s), endPct);
  };
  const setEnd = (v) => {
    const e = Math.max(Number(v), startPct + 5);
    onChange(startPct, Math.min(100, e));
  };
  const trimmed = startPct > 0 || endPct < 100;

  return (
    <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">구간 보정(이상치 제외)</p>
        {trimmed && (
          <button
            type="button"
            onClick={() => onChange(0, 100)}
            className="text-[10px] font-bold text-cyan-400 underline"
          >
            전체로 되돌리기
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-500 leading-snug">
        아래로 잘못 튄 구간이 보이면 슬라이더로 잘라내고 다시 확인하세요. 저장은 지금 보이는 값으로 됩니다.
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-8 text-[9px] text-slate-500 font-mono">시작</span>
          <input type="range" min={0} max={100} value={startPct}
            onChange={e => setStart(e.target.value)}
            className="flex-1 accent-cyan-400" />
          <span className="w-9 text-[9px] text-slate-400 font-mono text-right">{Math.round(startPct)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 text-[9px] text-slate-500 font-mono">끝</span>
          <input type="range" min={0} max={100} value={endPct}
            onChange={e => setEnd(e.target.value)}
            className="flex-1 accent-cyan-400" />
          <span className="w-9 text-[9px] text-slate-400 font-mono text-right">{Math.round(endPct)}%</span>
        </div>
      </div>
      {sampleCount != null && (
        <p className="text-[9px] text-slate-600 text-right">선택된 샘플 {sampleCount}개</p>
      )}
    </div>
  );
}
