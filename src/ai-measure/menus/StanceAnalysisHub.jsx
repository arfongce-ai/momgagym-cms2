// ai-measure/menus/StanceAnalysisHub.jsx
// ════════════════════════════════════════════════════════════════════════
//  한다리서기(SLST) 측정 진입점.
//   1) 눈뜨고: 왼쪽 다리 지지 측정 → 오른쪽 다리 지지 측정
//   2) (눈감아주세요 전환 화면)
//   3) 눈감고: 왼쪽 다리 지지 측정 → 오른쪽 다리 지지 측정
//   → evaluateSingleLegStanceWithEyes()로 종합 판정 → buildProblemFocus()로 요약
//   → MEASURE_FLOW.md 표준 흐름(기록 → 확인·저장 → 기록 확인)
//
//  [2026-08-02] 눈뜨고/눈감고 조건 분리 측정 도입. 기존엔 왼쪽→오른쪽 1회씩만
//  측정했으나, 이제 같은 순서를 눈뜨고/눈감고 두 조건으로 반복해 총 4회 시행을
//  모은다(다리당 시행 횟수 자체는 그대로 1회). 두 조건은 서로 다른 기준(눈감으면
//  정상인도 흔들림이 커지는 게 자연스러움)이라 재현성 신호로 섞지 않고
//  evaluateSingleLegStanceWithEyes()가 조건별로 독립 판정한 뒤 종합한다.
//  [2026-08-02] 키(신장) 입력 요구 제거 — SLST 판정은 각도·비율·유지시간 기반이라
//  cm 환산이 필수가 아니며, 흔들림 경로 cm 환산은 어차피 부가 신호였다.
//
//  JumpAnalysisHub.jsx 와 동일한 저장 책임 분리(Hub가 단일 저장 지점) +
//  동일한 mode 토글 자리(실시간/업로드). 두 방식 모두 singleLegStanceTracker.js
//  하나를 공유하므로 판정 결과는 방식과 무관하게 동일한 로직으로 나온다.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo } from 'react';
import StanceLiveAnalysis from './StanceLiveAnalysis';
import StanceUploadAnalysis from './StanceUploadAnalysis';
import { evaluateSingleLegStanceWithEyes, SLST_TUNING } from '../core/singleLegStance';
import { buildProblemFocus } from '../core/crossMeasureContext';
import { useHardwareBack } from '../core/useHardwareBack';
import { shareReportWithVideo } from '../core/reportShare';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import ReportActions from '../../components/report/ReportActions';
import { MetricCard, UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection } from '../../components/report/UnifiedReportPrimitives';

const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' };
const BASIS_KO_STANCE = {
  immediate: '즉시확정',
  reproducibility: '재현성확정',
  single_trial_only: '단일 시행(재측정 권장)',
  no_valid_trial: '측정 무효',
};

// [2026-08-05] 리포트 보완 — 자세/점프/보행 리포트와 동일한 수준으로 실측
// 유지시간·각도·시각화를 담는다(이전엔 눈뜨고/눈감고 × 좌/우 상태 단어 4개만
// 있어서 "부실하다"는 피드백을 받았다). 임계값은 singleLegStance.js의
// SLST_TUNING을 그대로 가져와 리포트와 판정이 서로 다른 기준을 말하지 않게 한다.
const STATUS_TOKEN = {
  normal: { key: 'normal', label: '정상', color: 'text-emerald-300', colorClass: 'text-emerald-300', bgClass: 'bg-emerald-500/12', borderClass: 'border-emerald-400/35', bar: 'bg-emerald-400' },
  caution: { key: 'caution', label: '주의', color: 'text-amber-300', colorClass: 'text-amber-300', bgClass: 'bg-amber-500/12', borderClass: 'border-amber-400/35', bar: 'bg-amber-400' },
  risk: { key: 'risk', label: '위험', color: 'text-red-300', colorClass: 'text-red-300', bgClass: 'bg-red-500/12', borderClass: 'border-red-400/35', bar: 'bg-red-400' },
  observed: { key: 'observed', label: '1회만 관찰(재현 안 됨)', color: 'text-slate-400', colorClass: 'text-slate-300', bgClass: 'bg-slate-500/12', borderClass: 'border-slate-400/35', bar: 'bg-slate-500' },
  unknown: { key: 'unknown', label: '측정 안 됨', color: 'text-slate-500', colorClass: 'text-slate-400', bgClass: 'bg-slate-600/12', borderClass: 'border-slate-500/35', bar: 'bg-slate-700' },
};

// leg = combineLegTrials() 결과(evaluateSingleLegStanceWithEyes의 eyesOpen.left 등).
// 즉시확정(균형상실/스텝아웃/최소유지시간 미달)은 특정 항목이 원인이라 그 항목만
// risk로 잡고 나머지는 판정 보류(unknown)로 남긴다 — 안 그러면 실제로 재보지도
// 않은 지표까지 risk로 잘못 표시된다.
export function stanceMetricStatus(leg, flagPrefix, immediateKey) {
  if (!leg) return 'unknown';
  if (leg.basis === 'immediate') {
    return immediateKey && leg.immediateReasons?.includes(immediateKey) ? 'risk' : 'unknown';
  }
  const confirmed = (leg.repeatedFlags || []).find((f) => f.startsWith(flagPrefix));
  if (confirmed) return confirmed.endsWith('_high') ? 'risk' : 'caution';
  const unconfirmed = (leg.unconfirmedFlags || []).some((f) => f.startsWith(flagPrefix));
  return unconfirmed ? 'observed' : 'normal';
}

// 같은 다리·조건의 두 시행 중 "더 나쁜 값"을 대표값으로(측정 정직성 원칙 —
// squatBiomechanics.js·squatFms.js와 동일). 유지시간은 짧을수록, 각도는
// 클수록 나쁘다.
export function legMetrics(leg) {
  const trials = (leg?.trials || []).filter((t) => t.valid);
  const worst = (key, dir) => {
    const vals = trials.map((t) => t[key]).filter((v) => v != null);
    if (!vals.length) return null;
    return Math.round((dir === 'min' ? Math.min(...vals) : Math.max(...vals)) * 10) / 10;
  };
  return {
    holdMs: worst('holdTimeMs', 'min'),
    pelvicTiltDeg: worst('pelvicTiltDeg', 'max'),
    kneeValgusDeg: worst('kneeValgusDeg', 'max'),
  };
}

export function computeStanceScore(report) {
  if (report?.valid === false) return 0;
  const scores = [];
  [report?.eyesOpen, report?.eyesClosed].forEach((cond) => {
    if (!cond?.valid) return;
    [cond.left, cond.right].forEach((leg) => {
      if (!leg || leg.status === 'unknown') return;
      scores.push(leg.status === 'normal' ? 100 : leg.status === 'risk' ? 35 : 65);
    });
  });
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}

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
        <span className="text-[12px] font-bold text-slate-300">유지 시간</span>
        <span className={`text-[12px] font-black tabular-nums ${token.color}`}>
          {holdS == null ? '측정 안 됨' : `${holdS}초`} · {token.label}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-700/70">
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
        <span className="text-[12px] font-bold text-slate-300">{label}</span>
        <span className={`text-[12px] font-black tabular-nums ${token.color}`}>
          {value == null ? '측정 안 됨' : `${value}°`} · {token.label}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-700/70">
        <div className="absolute top-0 left-0 h-full bg-emerald-500/20" style={{ width: `${goodW}%` }} />
        {value != null && <div className={`absolute top-0 left-0 h-full rounded-full ${token.bar}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">정상 0~{cautionDeg}°</p>
    </div>
  );
}

export default function StanceAnalysisHub({ member, onBack, onSave, onSaveToFirebase }) {
  const save = onSaveToFirebase || onSave;

  // 요청에 따라 실시간을 기본값으로 (JumpAnalysisHub와 동일한 자리에 동일한 토글 UI)
  const [mode, setMode] = useState('live'); // live | upload
  const [eyesState, setEyesState] = useState('open'); // open | closed
  const [legStep, setLegStep] = useState('left'); // left | right
  const [openLeft, setOpenLeft] = useState(null);
  const [openRight, setOpenRight] = useState(null);
  const [closedLeft, setClosedLeft] = useState(null);
  const [closedRight, setClosedRight] = useState(null);

  const [view, setView] = useState('measure'); // measure | eyes_transition | record | report
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  const combineAndProceed = useCallback((openL, openR, closedL, closedR) => {
    const evalResult = evaluateSingleLegStanceWithEyes({
      open: { left: openL, right: openR },
      closed: { left: closedL, right: closedR },
    });
    const focus = buildProblemFocus('stance', evalResult);
    const reportData = {
      valid: evalResult.valid,
      kind: 'stance',
      ...evalResult,
      problemFocus: focus,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
      // [녹화 통일] 눈뜨고/눈감고 × 좌/우, 라이브 모드에서 녹화된 영상(있으면).
      // 업로드 모드는 영상을 새로 만들지 않으므로 null — hasVideo로 화면에서 분기한다.
      openLeftVideoBlob: openL?.videoBlob || null,
      openRightVideoBlob: openR?.videoBlob || null,
      closedLeftVideoBlob: closedL?.videoBlob || null,
      closedRightVideoBlob: closedR?.videoBlob || null,
      openLeftPreviewVideoUrl: openL?.previewVideoUrl || '',
      openRightPreviewVideoUrl: openR?.previewVideoUrl || '',
      closedLeftPreviewVideoUrl: closedL?.previewVideoUrl || '',
      closedRightPreviewVideoUrl: closedR?.previewVideoUrl || '',
      hasVideo: !!(openL?.videoBlob || openR?.videoBlob || closedL?.videoBlob || closedR?.videoBlob),
    };
    setPending(reportData);
    setSaveState('idle');
    setView('record');
  }, [member]);

  const handleLegComplete = useCallback((summary) => {
    if (eyesState === 'open') {
      if (legStep === 'left') {
        setOpenLeft(summary);
        setLegStep('right');
      } else {
        setOpenRight(summary);
        setView('eyes_transition'); // 눈뜨고 좌/우 완료 — 눈감고 단계로 넘어가는 전환 화면
      }
    } else if (legStep === 'left') {
      setClosedLeft(summary);
      setLegStep('right');
    } else {
      setClosedRight(summary);
      combineAndProceed(openLeft, openRight, closedLeft, summary);
    }
  }, [eyesState, legStep, openLeft, openRight, closedLeft, combineAndProceed]);

  const proceedToClosedPhase = () => {
    setEyesState('closed');
    setLegStep('left');
    setView('measure');
  };

  const persist = useCallback(async (reportData, record = {}) => {
    const withRecord = { ...reportData, note: record.note || '' };
    let saved = withRecord;
    setSaveState('saving');
    // 영상 Blob/blob-URL은 Firestore에 못 넣으므로 저장 페이로드에서 제외한다
    // (ROM과 동일한 패턴). 화면 표시용 report 상태에는 그대로 남긴다.
    const {
      openLeftVideoBlob, openRightVideoBlob, closedLeftVideoBlob, closedRightVideoBlob,
      openLeftPreviewVideoUrl, openRightPreviewVideoUrl, closedLeftPreviewVideoUrl, closedRightPreviewVideoUrl,
      ...persistable
    } = withRecord;
    if (withRecord.valid === true && typeof save === 'function') {
      try {
        const res = await save(persistable);
        if (res && typeof res === 'object') saved = { ...withRecord, ...res };
        setSaveState('saved');
      } catch (e) { setSaveState('error'); }
    } else { setSaveState('saved'); }
    setReport(saved);
    setView('report');
  }, [save]);

  const confirmRecord = useCallback((record) => {
    if (pending) persist(pending, record);
  }, [pending, persist]);

  const backToMeasure = () => {
    setView('measure'); setReport(null); setPending(null); setSaveState('idle');
    setEyesState('open'); setLegStep('left');
    setOpenLeft(null); setOpenRight(null); setClosedLeft(null); setClosedRight(null);
  };
  useHardwareBack((view === 'report' && !!report) || view === 'record', backToMeasure);

  const [videoShareMsg, setVideoShareMsg] = useState('');
  const shareVideo = async (blob, label) => {
    setVideoShareMsg('');
    const res = await shareReportWithVideo(null, blob, { baseName: `SLST_${label}`, title: `한다리서기 ${label} 영상` });
    setVideoShareMsg(res.msg || '');
  };

  const reportScore = useMemo(() => computeStanceScore(report), [report]);

  if (view === 'eyes_transition') {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-2xl p-6 space-y-4 text-center">
          <p className="text-4xl">🙈</p>
          <p className="text-white font-black text-lg">눈감고 측정으로 이동</p>
          <p className="text-slate-400 text-sm leading-relaxed">
            눈뜨고 왼쪽 → 오른쪽 측정이 끝났습니다.<br />
            이어서 같은 순서로 <span className="text-amber-300 font-bold">눈을 감고</span> 진행합니다.
          </p>
          <p className="text-slate-500 text-xs">회원에게 눈을 감아달라고 안내한 뒤 계속을 눌러주세요.</p>
          <button onClick={proceedToClosedPhase}
            className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95">
            준비됐어요 — 계속
          </button>
          <button onClick={onBack} className="text-slate-500 text-xs underline">측정 중단하고 나가기</button>
        </div>
      </div>
    );
  }

  if (view === 'record' && pending) {
    const rows = [
      { label: '눈뜨고 · 왼쪽', value: STATUS_KO[pending.eyesOpen?.left?.status] || '-' },
      { label: '눈뜨고 · 오른쪽', value: STATUS_KO[pending.eyesOpen?.right?.status] || '-' },
      { label: '눈감고 · 왼쪽', value: STATUS_KO[pending.eyesClosed?.left?.status] || '-' },
      { label: '눈감고 · 오른쪽', value: STATUS_KO[pending.eyesClosed?.right?.status] || '-' },
      { label: '종합', value: STATUS_KO[pending.status] || '-' },
    ];
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="max-w-md mx-auto p-4">
          <MeasureRecordConfirm
            title="한다리서기 (SLST)"
            summaryRows={rows}
            noteMode
            onConfirm={confirmRecord}
            onBack={backToMeasure}
            saving={saveState === 'saving'}
            saved={saveState === 'saved'}
            error={saveState === 'error'}
          />
        </div>
      </div>
    );
  }

  if (view === 'report' && report) {
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
          <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 닫기</button>
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

            {asymmetryAny && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs font-bold text-amber-300">
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
                  <p className="text-[11px] font-black text-slate-400">왼쪽</p>
                  <HoldTimeBar leg={eyesOpen.left} />
                  <AngleBar label="골반 기울기" leg={eyesOpen.left} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
                </div>
                <div className="space-y-3">
                  <p className="text-[11px] font-black text-slate-400">오른쪽</p>
                  <HoldTimeBar leg={eyesOpen.right} />
                  <AngleBar label="골반 기울기" leg={eyesOpen.right} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
                </div>
              </div>
            </UnifiedReportSection>

            <UnifiedReportSection title="③ 눈감고" subtitle="🙈 왼쪽 · 오른쪽 비교">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <p className="text-[11px] font-black text-slate-400">왼쪽</p>
                  <HoldTimeBar leg={eyesClosed.left} />
                  <AngleBar label="골반 기울기" leg={eyesClosed.left} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
                </div>
                <div className="space-y-3">
                  <p className="text-[11px] font-black text-slate-400">오른쪽</p>
                  <HoldTimeBar leg={eyesClosed.right} />
                  <AngleBar label="골반 기울기" leg={eyesClosed.right} metricKey="pelvicTiltDeg" flagPrefix="pelvic_tilt_" cautionDeg={SLST_TUNING.pelvicTiltCautionDeg} riskDeg={SLST_TUNING.pelvicTiltRiskDeg} />
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                눈을 감으면 정상인도 유지시간이 짧아지고 흔들림이 커지는 것이 자연스러워, 눈뜨고/눈감고는 서로 다른 기준으로 독립 판정합니다.
              </p>
            </UnifiedReportSection>

            <UnifiedReportSection title="④ 시행별 결과" subtitle="다리마다 2회 반복">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['눈뜨고 · 왼쪽', eyesOpen.left], ['눈뜨고 · 오른쪽', eyesOpen.right],
                  ['눈감고 · 왼쪽', eyesClosed.left], ['눈감고 · 오른쪽', eyesClosed.right],
                ].map(([label, leg]) => (
                  <div key={label} className="rounded-xl bg-slate-800/70 border border-slate-700/60 p-3">
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

            <UnifiedReportSection title="측정 한계">
              <ul className="list-disc pl-4 text-[11px] leading-relaxed text-slate-400 space-y-1">
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
                        className="w-full rounded-lg bg-slate-700 text-white font-bold text-xs py-2 active:scale-95">
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
          <ReportActions reportNodeId="stance-report-sheet" baseName={`${report.member?.name || '회원'}_한다리서기`} onMessage={setVideoShareMsg} />
          {videoShareMsg && <p className="text-center text-xs text-emerald-400">{videoShareMsg}</p>}
          <button onClick={backToMeasure} className="w-full rounded-lg bg-slate-800 text-white font-bold text-sm py-2.5">← 다시 측정</button>
        </div>
      </UnifiedReportCanvas>
    );
  }

  // view === 'measure' — 눈뜨고(왼쪽→오른쪽) → 눈감고(왼쪽→오른쪽) 순서로 진행
  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      <div className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex flex-col items-center gap-1.5 px-3 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/55 backdrop-blur px-3 py-1.5 border border-white/10 shadow-lg">
          <span className={`text-xs font-black ${eyesState === 'open' ? 'text-cyan-300' : 'text-violet-300'}`}>
            {eyesState === 'open' ? '👁 눈뜨고' : '🙈 눈감고'}
          </span>
          <span className="text-slate-500 text-xs">|</span>
          <span className={`text-xs font-black ${legStep === 'left' ? 'text-amber-300' : 'text-emerald-400'}`}>
            {legStep === 'left' ? '① 왼쪽' : '✓ 왼쪽'}
          </span>
          <span className="text-slate-500 text-xs">→</span>
          <span className={`text-xs font-black ${legStep === 'right' ? 'text-amber-300' : 'text-slate-500'}`}>
            ② 오른쪽
          </span>
        </div>
        <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
          {[['live', '🔴 실시간'], ['upload', '📁 영상 업로드']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'live' ? (
        <StanceLiveAnalysis
          // [2026-08-02] key 필수 — 없으면 왼발→오른발로 넘어갈 때 React가 같은
          // 컴포넌트 인스턴스를 재사용한다. 그러면 이전 다리에서 true가 된
          // recordingStartedRef 등 ref들이 그대로 남아 beginRecording()이 즉시
          // return 하고(→ 오른발 녹화 안 됨), 앞 단계에서 stop()으로 꺼진 카메라도
          // 다시 켜지지 않아 화면이 검게 나온다. 다리/눈 조건이 바뀌면 완전히
          // 새 측정이므로 통째로 remount 시킨다.
          key={`live-${eyesState}-${legStep}`}
          member={member}
          stanceLeg={legStep}
          eyesClosed={eyesState === 'closed'}
          onBack={onBack}
          onComplete={handleLegComplete}
        />
      ) : (
        <StanceUploadAnalysis
          key={`upload-${eyesState}-${legStep}`}
          member={member}
          stanceLeg={legStep}
          eyesClosed={eyesState === 'closed'}
          onBack={onBack}
          onComplete={handleLegComplete}
        />
      )}
    </div>
  );
}
