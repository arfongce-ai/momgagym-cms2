// ai-measure/menus/RunMechanicsCard.jsx
// [2026-11-23] 달리기 분석 보강 카드 — 접지·체공 시간, 오버스트라이드, 팔 스윙 + 쉬운 말 피드백.
// 계산은 core/runMechanics.js. 여기서는 저장된 값만 그린다(없으면 '측정 안 됨'과 이유).
import React, { useMemo } from 'react';
import { buildRunningFeedback } from '../core/runMechanics';
import { resolveGaitMode } from '../core/gaitMode';

const LEVEL_TONE = {
  risk: 'border-red-500/35 bg-red-500/10 text-red-900 dark:text-red-100',
  caution: 'border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-100',
  info: 'border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60 text-slate-800 dark:text-slate-100',
  good: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
};
const LEVEL_LABEL = { risk: '꼭 확인', caution: '확인', info: '참고', good: '좋아요' };

function Tile({ label, value, unit, note, level }) {
  const tone = level === 'risk' ? 'border-red-500/35 bg-red-500/10' : level === 'caution' ? 'border-amber-500/35 bg-amber-500/10' : 'border-slate-300 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/60';
  return (
    <div className={`rounded-xl border p-2.5 ${tone}`}>
      <p className="text-[10px] font-black text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-lg font-black leading-none text-slate-900 dark:text-white">
        {value == null ? <span className="text-xs font-bold text-slate-500">측정 안 됨</span> : <>{value}<span className="ml-0.5 text-[10px] font-bold text-slate-500">{unit}</span></>}
      </p>
      {note && <p className="mt-1 text-[9px] leading-snug text-slate-500">{note}</p>}
    </div>
  );
}

export default function RunMechanicsCard({ metrics, orientation }) {
  const mode = resolveGaitMode(metrics?.cadence, metrics?.gaitMode);
  const feedback = useMemo(() => buildRunningFeedback(metrics, { orientation, mode }), [metrics, orientation, mode]);
  const rm = metrics?.runMechanics || null;
  if (!rm && !feedback.length) return null;
  const ct = rm?.contact; const os = rm?.overstride; const arm = rm?.armSwing;
  const isRun = mode === 'run';

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4" data-testid="run-mechanics-card">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-900 dark:text-white">{isRun ? '달리기 움직임 분석' : '움직임 분석'}</p>
        <span className="text-[10px] font-bold text-slate-500">참고 추정값</span>
      </div>

      {rm && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile label="발이 땅에 닿은 시간(왼/오)"
            value={ct?.leftMs != null && ct?.rightMs != null ? `${ct.leftMs} / ${ct.rightMs}` : null} unit="ms"
            level={ct?.asymmetryLevel} note={ct?.leftMs == null ? ct?.reason : (ct?.asymmetryPct != null ? `좌우 차이 ${ct.asymmetryPct}%` : null)} />
          <Tile label="공중에 떠 있는 시간" value={isRun ? ct?.flightMs ?? null : null} unit="ms"
            note={!isRun ? '달리기에서만 계산' : (ct?.flightMs == null ? (ct?.reason || '체공 장면을 충분히 잡지 못함') : null)} />
          <Tile label="발 닿는 위치(몸보다 앞)" value={os?.avgPct ?? null} unit="%" level={os?.level}
            note={os?.avgPct == null ? os?.reason : `다리 길이 대비 · 정상 ${os.warnPct}% 미만`} />
          <Tile label="팔 앞뒤 흔들림 폭" value={arm?.mainRangeDeg ?? null} unit="°"
            note={arm?.mainRangeDeg == null ? arm?.reason : `${arm.mainSide === 'left' ? '왼팔' : '오른팔'} 기준 · 보통 ${arm.lowDeg}~${arm.highDeg}°`} />
          <Tile label="팔꿈치 각도(평균)" value={arm?.elbowAvgDeg ?? null} unit="°" note={arm?.elbowAvgDeg == null ? (arm?.reason || '팔꿈치를 충분히 잡지 못함') : '보통 60~130°'} />
          <Tile label="프레임 속도" value={ct?.fps ?? null} unit="fps" note={ct?.resolutionMs ? `시간 값은 약 ±${ct.resolutionMs}ms 오차` : null} />
        </div>
      )}

      {feedback.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-black text-slate-700 dark:text-slate-200">쉬운 말 피드백</p>
          {feedback.map((f) => (
            <div key={f.key} className={`rounded-lg border px-3 py-2 ${LEVEL_TONE[f.level] || LEVEL_TONE.info}`}>
              <p className="text-[12px] font-black">
                <span className="mr-1.5 rounded bg-black/10 px-1.5 py-0.5 text-[9px] font-bold dark:bg-white/10">{LEVEL_LABEL[f.level]}</span>
                {f.title}
              </p>
              <p className="mt-0.5 break-keep text-[12px] leading-snug">{f.text}</p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 break-keep text-[10px] leading-snug text-slate-500">
        카메라 한 대로 잰 참고값입니다. 기준값은 센터 현장 보정용 시작값이며 진단이 아닙니다. 같은 속도·같은 각도로 다시 찍어 변화를 비교하는 것이 가장 정확합니다.
      </p>
    </section>
  );
}
