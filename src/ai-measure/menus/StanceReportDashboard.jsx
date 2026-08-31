// ai-measure/menus/StanceReportDashboard.jsx
// ════════════════════════════════════════════════════════════════════════
//  [리포트 통합 2026-08-09] StanceAnalysisHub.jsx(측정 화면)에 인라인으로
//  박혀있던 결과 리포트 화면을 GaitReportDashboard.jsx/JumpReportDashboard.jsx
//  와 같은 방식으로 독립 컴포넌트로 뽑았다 — 그래야 Report.jsx(저장된 리포트
//  다시 보기)에서도 재사용할 수 있다(재구현 없이 그대로 재사용, "결과리포트
//  통합" 프로젝트의 나머지 조각 — posture/rom/gait/jump/lifting은 이미 이
//  방식으로 Report.jsx에서 열람 가능했는데 stance/squat만 저장된 리포트를
//  다시 볼 방법이 아예 없었다).
//
//  onClose: 필수 — 닫기 버튼(측정 화면에선 화면 나가기, Report.jsx 뷰어에선
//    뷰어 인덱스를 null로).
//  onRemeasure: 선택 — 있을 때만 "다시 측정" 버튼을 보여준다(Report.jsx에서
//    저장된 리포트를 다시 볼 땐 "다시 측정"이 의미가 없으므로 안 넘김).
//  onViewInReport: 선택 — 측정 화면에서만 넘어온다("결과리포트에서 보기"
//    버튼, Report.jsx 뷰어 안에서는 이미 그 화면이므로 필요 없음).
// ════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from 'react';
import { MetricCard, UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection } from '../../components/report/UnifiedReportPrimitives';
import { SLST_TUNING, stanceMetricStatus, legMetrics, computeStanceScore } from '../core/singleLegStance';
import { shareReportWithVideo } from '../core/reportShare';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import MomiAutoNote from '../../components/report/MomiAutoNote.jsx';
import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';
import ReportActions from '../../components/report/ReportActions';
import { buildSummaryData } from '../core/unifiedReport';
import { aiStore } from '../../demoData';
import { computeChangeRow, summarizeChanges, reportDateOnly } from '../core/measurementComparison';
import ChangeSummaryPanel from '../../components/report/ChangeSummaryPanel.jsx';
import VideoCompareUpload from '../../components/report/VideoCompareUpload.jsx';

// [전/후 변화 요약 2026-08-31] previousReport는 StanceAnalysisHub.jsx(라이브
// 직후)/Report.jsx(이력 뷰어)가 이미 같은 종류(menu==='stance')로 걸러 넘겨준
// 세션의 data(=이 컴포넌트의 report와 동일한 필드 구조)다. 유지시간은 목표
// 대비 길수록 좋고(higherBetter), 골반 기울기는 작을수록 좋다(lowerBetter).
function buildStanceChangeSummary(report, previousReport) {
  if (!previousReport) return null;
  const curOpen = report.eyesOpen || {}, curClosed = report.eyesClosed || {};
  const prevOpen = previousReport.eyesOpen || {}, prevClosed = previousReport.eyesClosed || {};
  const holdRow = (label, prevLeg, curLeg) => {
    const p = legMetrics(prevLeg).holdMs, c = legMetrics(curLeg).holdMs;
    return computeChangeRow(label, p == null ? null : Math.round(p / 100) / 10, c == null ? null : Math.round(c / 100) / 10, '초', 'higherBetter');
  };
  const avgTilt = (open, closed) => {
    const vals = [open.left, open.right, closed.left, closed.right].map((leg) => legMetrics(leg).pelvicTiltDeg).filter((v) => v != null);
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
  };
  const rows = [
    computeChangeRow('종합 점수', computeStanceScore(previousReport), computeStanceScore(report), '점', 'higherBetter'),
    holdRow('눈뜨고·왼쪽 유지', prevOpen.left, curOpen.left),
    holdRow('눈뜨고·오른쪽 유지', prevOpen.right, curOpen.right),
    holdRow('눈감고·왼쪽 유지', prevClosed.left, curClosed.left),
    holdRow('눈감고·오른쪽 유지', prevClosed.right, curClosed.right),
    computeChangeRow('골반 기울기(평균)', avgTilt(prevOpen, prevClosed), avgTilt(curOpen, curClosed), '°', 'lowerBetter'),
  ];
  return summarizeChanges(rows, reportDateOnly(previousReport));
}

const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' };
const BASIS_KO_STANCE = {
  immediate: '즉시확정',
  reproducibility: '재현성확정',
  single_trial_only: '단일 시행(재측정 권장)',
  no_valid_trial: '측정 무효',
};

// [2026-08-05] 리포트 보완 — 자세/점프/보행 리포트와 동일한 수준으로 실측
// 유지시간·각도·시각화를 담는다. 임계값은 singleLegStance.js의 SLST_TUNING을
// 그대로 가져와 리포트와 판정이 서로 다른 기준을 말하지 않게 한다.
const STATUS_TOKEN = {
  normal: { key: 'normal', label: '정상', color: 'text-emerald-700 dark:text-emerald-300', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-500/12', borderClass: 'border-emerald-400/35', bar: 'bg-emerald-400' },
  caution: { key: 'caution', label: '주의', color: 'text-amber-700 dark:text-amber-300', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-500/12', borderClass: 'border-amber-400/35', bar: 'bg-amber-400' },
  risk: { key: 'risk', label: '위험', color: 'text-red-700 dark:text-red-300', colorClass: 'text-red-700 dark:text-red-300', bgClass: 'bg-red-500/12', borderClass: 'border-red-400/35', bar: 'bg-red-400' },
  observed: { key: 'observed', label: '1회만 관찰(재현 안 됨)', color: 'text-slate-500 dark:text-slate-400', colorClass: 'text-slate-600 dark:text-slate-300', bgClass: 'bg-slate-500/12', borderClass: 'border-slate-400/35', bar: 'bg-slate-500' },
  unknown: { key: 'unknown', label: '측정 안 됨', color: 'text-slate-500', colorClass: 'text-slate-500 dark:text-slate-400', bgClass: 'bg-slate-300/12 dark:bg-slate-600/12', borderClass: 'border-slate-500/35', bar: 'bg-slate-200 dark:bg-slate-700' },
};

function HoldTimeBar({ leg }) {
  const m = legMetrics(leg);
  const status = stanceMetricStatus(leg, 'hold_time_', 'hold_time_insufficient');
  const token = STATUS_TOKEN[status] || STATUS_TOKEN.unknown;
  const targetS = SLST_TUNING.targetHoldMs / 1000;
  const minS = SLST_TUNING.minAcceptableHoldMs / 1000;
  const holdS = m.holdMs == null ? null : Math.round(m.holdMs / 100) / 10;
  const pct = holdS == null ? 0 : Math.max(0, Math.min(100, (holdS / targetS) * 100));
  const minPct = (minS / targetS) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">유지 시간</span>
        <span className={`text-[12px] font-black tabular-nums ${token.color}`}>
          {holdS == null ? '측정 안 됨' : `${holdS}초`} · {token.label}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/70">
        <div className="absolute top-0 h-full bg-red-500/15" style={{ left: 0, width: `${minPct}%` }} />
        <div className="absolute top-0 h-full bg-emerald-500/20" style={{ left: `${minPct}%`, width: `${100 - minPct}%` }} />
        {holdS != null && <div className={`absolute top-0 left-0 h-full rounded-full ${token.bar}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">최소 {minS}초 · 목표 {targetS}초</p>
    </div>
  );
}

function AngleBar({ label, leg, metricKey, flagPrefix, cautionDeg, riskDeg }) {
  const m = legMetrics(leg);
  const value = m[metricKey];
  const status = stanceMetricStatus(leg, flagPrefix);
  const token = STATUS_TOKEN[status] || STATUS_TOKEN.unknown;
  const max = riskDeg * 1.15;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const goodW = (cautionDeg / max) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">{label}</span>
        <span className={`text-[12px] font-black tabular-nums ${token.color}`}>
          {value == null ? '측정 안 됨' : `${value}°`} · {token.label}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/70">
        <div className="absolute top-0 left-0 h-full bg-emerald-500/20" style={{ width: `${goodW}%` }} />
        {value != null && <div className={`absolute top-0 left-0 h-full rounded-full ${token.bar}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">정상 0~{cautionDeg}°</p>
    </div>
  );
}

export default function StanceReportDashboard({ report, member, onClose, onRemeasure, onViewInReport, previousReport }) {
  const [videoShareMsg, setVideoShareMsg] = useState('');
  const reportScore = useMemo(() => computeStanceScore(report), [report]);
  const changeSummary = useMemo(() => buildStanceChangeSummary(report, previousReport), [report, previousReport]);

  const shareVideo = async (blob, label) => {
    setVideoShareMsg('');
    const res = await shareReportWithVideo(null, blob, { baseName: `SLST_${label}`, title: `한다리서기 ${label} 영상` });
    setVideoShareMsg(res.msg || '');
  };

  if (!report) return null;

  const focus = report.problemFocus || {};
  const eyesOpen = report.eyesOpen || {};
  const eyesClosed = report.eyesClosed || {};
  const videoItems = [
    ['눈뜨고 · 왼쪽', report.openLeftPreviewVideoUrl, report.openLeftVideoBlob],
    ['눈뜨고 · 오른쪽', report.openRightPreviewVideoUrl, report.openRightVideoBlob],
    ['눈감고 · 왼쪽', report.closedLeftPreviewVideoUrl, report.closedLeftVideoBlob],
    ['눈감고 · 오른쪽', report.closedRightPreviewVideoUrl, report.closedRightVideoBlob],
  ].filter(([, url]) => !!url);
  const asymmetryAny = !!(eyesOpen.asymmetryFlag || eyesClosed.asymmetryFlag);

  return (
    <UnifiedReportCanvas>
      <div className="mx-auto w-full max-w-[794px] flex items-center justify-between pb-2">
        <button onClick={onClose} className="text-slate-600 dark:text-slate-300 font-bold text-sm">← 닫기</button>
      </div>
      <UnifiedReportPage id="stance-report-sheet" className="mx-auto">
        <UnifiedReportHeader
          eyebrow="SINGLE LEG STANCE TEST"
          badge="SLST"
          title={report.member?.name || '회원'}
          subtitle={`${(report.measuredAt || '').slice(0, 10)} · 한다리서기`}
          score={report.valid === false ? null : reportScore}
          status={report.valid === false ? 'risk' : undefined}
          member={report.member}
        />

        <div className="grid gap-3">
          <ProblemFocusPanel focus={focus} context={report.cross_measure_context} />
          {/* [Axis3 확장 2026-08-08] MomiAutoNote — PostureReport.jsx와 동일 패턴.
              SLST도 리프팅처럼 전용 컬렉션 없이 세션(ai)에 저장되므로 updateSession을 쓴다. */}
          <MomiAutoNote kind="stance" report={report} member={member || report.member}
            onSaved={(patch) => aiStore.updateSession((member || report.member)?.id, report.id, patch)} />
          {/* [Axis4 확장 2026-08-08] MomiAutoNote와 별개로, 필요하면 트레이너가
              직접 물어보고 후속 질문까지 이어갈 수 있는 대화창. */}
          <MomiInsightPanel kind="stance" report={report} member={member || report.member} />

          {asymmetryAny && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                ⚖ 좌우 균형 확인 필요 — 한쪽 다리의 판정 등급이 반대쪽보다 뚜렷하게 낮습니다.
              </p>
            </div>
          )}

          <UnifiedReportSection title="① 핵심 지표" subtitle="유지 시간 · 목표 대비">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['눈뜨고 · 왼쪽', eyesOpen.left],
                ['눈뜨고 · 오른쪽', eyesOpen.right],
                ['눈감고 · 왼쪽', eyesClosed.left],
                ['눈감고 · 오른쪽', eyesClosed.right],
              ].map(([label, leg]) => {
                const holdMs = legMetrics(leg).holdMs;
                const st = stanceMetricStatus(leg, 'hold_time_', 'hold_time_insufficient');
                return (
                  <MetricCard key={label} metric={{
                    key: label, label, displayValue: holdMs == null ? '-' : Math.round(holdMs / 100) / 10,
                    unit: holdMs == null ? '' : '초', description: `목표 ${SLST_TUNING.targetHoldMs / 1000}초`,
                    status: STATUS_TOKEN[st],
                  }} />
                );
              })}
            </div>
          </UnifiedReportSection>

          <UnifiedReportSection title="② 눈뜨고" subtitle="👁 왼쪽 · 오른쪽 비교">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400">왼쪽</p>
                <HoldTimeBar leg={eyesOpen.left} />
                <AngleBar label="골반 기울기" leg={eyesOpen.left} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
              </div>
              <div className="space-y-3">
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400">오른쪽</p>
                <HoldTimeBar leg={eyesOpen.right} />
                <AngleBar label="골반 기울기" leg={eyesOpen.right} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
              </div>
            </div>
          </UnifiedReportSection>

          <UnifiedReportSection title="③ 눈감고" subtitle="🙈 왼쪽 · 오른쪽 비교">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400">왼쪽</p>
                <HoldTimeBar leg={eyesClosed.left} />
                <AngleBar label="골반 기울기" leg={eyesClosed.left} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
              </div>
              <div className="space-y-3">
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400">오른쪽</p>
                <HoldTimeBar leg={eyesClosed.right} />
                <AngleBar label="골반 기울기" leg={eyesClosed.right} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              눈을 감으면 정상인도 유지시간이 짧아지고 흔들림이 커지는 것이 자연스러워, 눈뜨고/눈감고는 서로 다른 기준으로 독립 판정합니다.
            </p>
          </UnifiedReportSection>

          <UnifiedReportSection title="④ 시행별 결과" subtitle="다리마다 2회 반복">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['눈뜨고 · 왼쪽', eyesOpen.left], ['눈뜨고 · 오른쪽', eyesOpen.right],
                ['눈감고 · 왼쪽', eyesClosed.left], ['눈감고 · 오른쪽', eyesClosed.right],
              ].map(([label, leg]) => (
                <div key={label} className="rounded-xl bg-slate-100/70 dark:bg-slate-800/70 border border-slate-300/60 dark:border-slate-700/60 p-3">
                  <p className="text-[10px] text-slate-500">{label}</p>
                  <p className="text-white font-black text-sm">{STATUS_KO[leg?.status] || '-'}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{BASIS_KO_STANCE[leg?.basis] || '-'}</p>
                  {(leg?.trials || []).filter((t) => t.valid).map((t, i) => (
                    <p key={i} className="text-[10px] text-slate-500">
                      {i + 1}회 {t.holdTimeMs != null ? `${Math.round(t.holdTimeMs / 100) / 10}초` : '-'}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </UnifiedReportSection>

          {changeSummary && <ChangeSummaryPanel summary={changeSummary} />}
          <VideoCompareUpload
            currentVideoUrl={videoItems[0]?.[1] || null}
            title="전/후 영상 비교"
          />

          <UnifiedReportSection title="측정 한계">
            <ul className="list-disc pl-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 space-y-1">
              <li>같은 신호가 2회 반복돼야 주의/위험으로 확정합니다. 1회만 관찰된 항목은 "1회만 관찰(재현 안 됨)"으로 별도 표시됩니다.</li>
              <li>균형 상실·스텝아웃·최소 유지시간 미달은 1회만 나와도 즉시 위험으로 확정하며, 이 경우 다른 지표는 별도로 재보지 않아 "측정 안 됨"으로 남을 수 있습니다.</li>
              <li>좌우 비대칭은 질환으로 진단하지 않습니다. 측정된 패턴만 보여주며, 임상 해석은 전문가와 상의하세요.</li>
            </ul>
          </UnifiedReportSection>

          {videoItems.length > 0 && (
            <UnifiedReportSection title="측정 영상">
              <div className="grid grid-cols-2 gap-2">
                {videoItems.map(([label, url, blob]) => (
                  <div key={label} className="space-y-1.5">
                    <p className="text-[10px] text-slate-500">{label}</p>
                    <video src={url} controls playsInline className="w-full rounded-lg bg-black aspect-[3/4] object-contain" />
                    <button onClick={() => shareVideo(blob, label)}
                      className="w-full rounded-lg bg-slate-200 dark:bg-slate-700 text-white font-bold text-xs py-2 active:scale-95">
                      📹 저장/공유
                    </button>
                  </div>
                ))}
              </div>
            </UnifiedReportSection>
          )}
        </div>
      </UnifiedReportPage>

      <div className="w-full max-w-[794px] mx-auto mt-3 space-y-2">
        <ReportActions reportNodeId="stance-report-sheet" baseName={`${report.member?.name || '회원'}_한다리서기`} onMessage={setVideoShareMsg}
          simpleSummary={buildSummaryData(report, { reportType: 'stance' })} simpleMember={member} />
        {videoShareMsg && <p className="text-center text-xs text-emerald-700 dark:text-emerald-400">{videoShareMsg}</p>}
        {!member?.isVirtual && typeof onViewInReport === 'function' && (
          <button
            onClick={onViewInReport}
            className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm py-2.5"
          >
            📊 결과리포트에서 보기
          </button>
        )}
        {typeof onRemeasure === 'function' && (
          <button onClick={onRemeasure} className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 text-white font-bold text-sm py-2.5">← 다시 측정</button>
        )}
      </div>
    </UnifiedReportCanvas>
  );
}
