// components/report/OlyLiftSection.jsx
// 스내치·클린·클린&저크 구간(시점)과 자세 각도 참고값 표시. 판정하지 않는다.
import { UnifiedReportSection } from './UnifiedReportPrimitives';
import { OLY_REASON_KO } from '../../ai-measure/core/olyLiftAnalysis';

const sec = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`);
const deg = (v) => (v == null ? '—' : `${v}°`);
const num = (v, u = '') => (v == null ? '—' : `${v}${u}`);

const ANGLE_STAGES = [
  ['set', '시작 자세'], ['kneePass', '무릎 통과'], ['dip', '딥'], ['extension', '익스텐션(최고속도)'], ['catch', '캐치'],
];

function LiftBlock({ lift }) {
  const stages = ANGLE_STAGES.filter(([k]) => lift.angles?.[k]);
  const phaseRows = [
    ['출발', sec(lift.startMs)],
    lift.kneePassMs != null ? ['무릎 통과', sec(lift.kneePassMs)] : null,
    ['최고속도', `${sec(lift.peakVelocityMs)} · ${num(lift.peakVelocity, ' m/s')}`],
    lift.catchMs != null ? ['캐치(고관절 최저)', sec(lift.catchMs)] : null,
    lift.dipMs != null ? ['딥', sec(lift.dipMs)] : null,
    ['바 최고점', `${sec(lift.barTopMs)}${lift.barTopHeightCm != null ? ` · +${lift.barTopHeightCm}cm` : lift.barRiseCm != null ? ` · +${lift.barRiseCm}cm` : ''}`],
  ].filter(Boolean);
  const extras = [
    lift.firstPullMs != null && ['1차 풀(출발→무릎)', `${lift.firstPullMs}ms`],
    lift.secondPullMs != null && ['2차 풀(무릎→최고속도)', `${lift.secondPullMs}ms`],
    lift.underBarMs != null && ['바 밑으로 들어가는 시간', `${lift.underBarMs}ms`],
    lift.driveMs != null && ['딥→드라이브', `${lift.driveMs}ms`],
    lift.catchDepthCm != null && ['캐치 깊이(고관절)', `${lift.catchDepthCm}cm`],
    lift.driftAtPeakCm != null && ['최고속도 때 바 수평 이동', `${lift.driftAtPeakCm}cm`],
  ].filter(Boolean);
  return (
    <div className="rounded-xl border border-slate-300 dark:border-slate-700 p-3 space-y-2">
      <p className="text-[13px] font-black text-slate-800 dark:text-slate-100">{lift.name}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {[...phaseRows, ...extras].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">{k}</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{v}</span>
          </div>
        ))}
      </div>
      {stages.length > 0 && (
        <table className="w-full text-[11px] mt-1">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400 text-left">
              <th className="font-bold py-0.5">시점</th><th className="font-bold">무릎</th><th className="font-bold">고관절</th><th className="font-bold">몸통 기울기</th>
            </tr>
          </thead>
          <tbody>
            {stages.map(([k, label]) => {
              const a = lift.angles[k];
              return (
                <tr key={k} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="py-0.5 text-slate-600 dark:text-slate-300">{label}</td>
                  <td className="font-mono">{deg(a.kneeDeg)}</td>
                  <td className="font-mono">{deg(a.hipDeg)}</td>
                  <td className="font-mono">{deg(a.trunkLeanDeg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function OlyLiftSection({ oly }) {
  if (!oly || oly.kind !== 'olympic') return null;
  const reasons = oly.confidence?.reasons || [];
  return (
    <UnifiedReportSection title="동작 구간 · 자세 각도" subtitle="참고값 (정답·판정 아님)">
      <div className="space-y-2" data-testid="oly-section">
        {oly.lifts?.length > 0
          ? oly.lifts.map((l) => <LiftBlock key={l.name} lift={l} />)
          : <p className="text-[11px] text-slate-500 dark:text-slate-400">구간을 나누지 못했습니다.</p>}
        <p className={`text-[11px] font-bold ${oly.confidence?.level === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
          {oly.confidence?.level === 'ok' ? '신뢰도 보통 — 측면 촬영 기준 참고값' : '신뢰도 낮음 — 참고만 해 주세요'}
        </p>
        {reasons.map((r) => (
          <p key={r} className="text-[10px] text-slate-500 dark:text-slate-400">· {OLY_REASON_KO[r] || r}</p>
        ))}
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          카메라 한 대(2D) 관절 인식 기준입니다. 각도는 측면 촬영에서만 의미가 있고, 바 위치는 양 손목 중점으로 근사합니다.
        </p>
      </div>
    </UnifiedReportSection>
  );
}
