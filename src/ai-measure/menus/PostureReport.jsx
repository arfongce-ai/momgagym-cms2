import React, { useMemo } from 'react';
import {
  POSTURE_STATUS_KO,
  POSE_LANDMARKS,
  POSTURE_THRESHOLDS,
  analyzePostureFromLandmarks,
} from '../core/postureMath';
import { buildClinicalInterpretation } from '../core/postureClinical';
import { analyzeAxialRotation, ROTATION_DIRECTION_KO, ROTATION_LEVEL_KO } from '../core/postureRotation';
import { buildProblemFocus } from '../core/crossMeasureContext';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import MomiAutoNote from '../../components/report/MomiAutoNote.jsx';
import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';
import { aiStore } from '../../demoData';
import {
  MetricCard,
  UnifiedEmptyState,
  UnifiedReportCanvas,
  UnifiedReportHeader,
  UnifiedReportPage,
} from '../../components/report/UnifiedReportPrimitives';
import { scoreToStatus } from '../core/unifiedReport';

// 'risk'|'caution'|'normal' 문자열 판정을 공용 MetricCard가 쓰는 상태 토큰으로 변환.
//  · scoreToStatus 임계값(>=80 정상/>=60 주의/그 외 위험)과 동일한 대표 점수를 사용해
//    다른 리포트(ROM 등)와 같은 배지 색상 규칙을 공유한다.
function statusToken(key) {
  if (key === 'risk') return scoreToStatus(35);
  if (key === 'caution') return scoreToStatus(65);
  if (key === 'normal') return scoreToStatus(90);
  return scoreToStatus(null);
}

const LM = POSE_LANDMARKS;

const SKELETON_CONNECTIONS = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL],
  [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],
  [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
];

const STATUS_STYLE = {
  normal: {
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    stroke: '#34d399',
    ring: 'ring-emerald-500/30',
  },
  caution: {
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    stroke: '#fbbf24',
    ring: 'ring-amber-500/30',
  },
  risk: {
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    stroke: '#f87171',
    ring: 'ring-red-500/30',
  },
};

export default function PostureReport({
  id = 'posture-report-sheet',
  report,
  currentLandmarks,
  previousLandmarks,
  currentImageUrl,
  previousImageUrl,
  perViewSnapshots,
  member,
  actualAge,
  heightCm,
  onClose,
}) {
  const currentPose = currentLandmarks || report?.rawLandmarks || report?.landmarks || report?.rawPose?.landmarks;
  const previousPose = previousLandmarks || report?.comparison?.previousLandmarks;
  const analysis = useMemo(() => {
    if (report?.analysis) return report.analysis;
    if (!currentPose) return null;
    return analyzePostureFromLandmarks(currentPose, {
      heightCm: heightCm ?? report?.heightCm ?? member?.heightCm,
      actualAge: actualAge ?? report?.actualAge ?? member?.age,
    });
  }, [actualAge, currentPose, heightCm, member?.age, member?.heightCm, report]);

  // 임상 해석(부위별 진단·근육 추정·위험 Top3) — 측정값 기반, 비단정.
  // [훅 규칙] 아래 두 useMemo 는 반드시 조기 return(분석 불가) 이전에 호출해야 한다.
  //  landmarks 가 나중에 도착해 분석 불가 → 가능으로 바뀔 때 훅 순서가 달라지면
  //  React 가 'Rendered more hooks' 오류로 리포트 화면 전체가 죽는다.
  const clinical = useMemo(() => {
    if (!analysis) return null;
    const perViewAnalysis = report?.perViewAnalysis || {};
    // 단일 면만 있는 과거 데이터 호환: front 가 없으면 현재 분석을 front 로 사용.
    const pv = Object.keys(perViewAnalysis).length
      ? perViewAnalysis
      : { front: analysis };
    return buildClinicalInterpretation({
      perViewAnalysis: pv,
      bodyInfo: {
        heightCm: heightCm ?? report?.heightCm ?? member?.heightCm,
        actualAge: actualAge ?? report?.actualAge ?? member?.age,
        sex: member?.sex || member?.gender || report?.sex,
      },
    });
  }, [report, analysis, heightCm, actualAge, member]);

  // 전신 종합 회전(축 정렬) 분석 — 4면 종합
  const axialRotation = useMemo(() => {
    if (!analysis) return null;
    const pv = report?.perViewAnalysis && Object.keys(report.perViewAnalysis).length
      ? report.perViewAnalysis
      : { front: analysis };
    return analyzeAxialRotation(pv);
  }, [report, analysis]);

  if (!analysis) {
    return (
      <UnifiedEmptyState onClose={onClose}>분석 가능한 BlazePose 랜드마크가 없습니다.</UnifiedEmptyState>
    );
  }

  const statusStyle = STATUS_STYLE[analysis.status] || STATUS_STYLE.caution;
  const memberName = member?.name || report?.memberName || '회원';
  const measuredAt = (report?.measuredAt || report?.createdAt || new Date().toISOString()).slice(0, 10);
  const bodyAge = analysis.bodyAge ?? report?.bodyAge;
  const score = analysis.score ?? report?.postureScore ?? 0;
  const findings = analysis.rules?.findings?.length ? analysis.rules.findings : [];
  const problemFocus = report?.problem_focus || buildProblemFocus('posture', { ...report, analysis });

  return (
    <UnifiedReportCanvas>
      <UnifiedReportPage id={id} className="mx-auto flex flex-col gap-4">
        <UnifiedReportHeader
          eyebrow="POSTURE & ALIGNMENT REPORT"
          badge="POSTURE"
          title={memberName}
          subtitle={measuredAt}
          score={score}
          onClose={onClose}
          compact
          member={member}
        />

        <MetadataStrip metadata={clinical.metadata} viewsMeasured={report?.viewsMeasured} />
        <ProblemFocusPanel focus={problemFocus} context={report?.cross_measure_context} />
        <MomiAutoNote kind="posture" report={report} member={member}
          onSaved={(patch) => aiStore.updatePostureReport(member.id, report.id, patch)} />
        {/* [Axis4 확장 2026-08-08] MomiAutoNote(자동 노트)와 별개로, 필요하면
            트레이너가 직접 물어보고 후속 질문까지 이어갈 수 있는 대화창. */}
        <MomiInsightPanel kind="posture" report={report} member={member} />

        <section className="grid gap-3 sm:grid-cols-[240px_1fr_1fr]">
          <ScoreDial score={score} status={analysis.status} />
          <MetricPanel title="체형 나이" value={bodyAge ?? '-'} unit={bodyAge ? '세' : ''} status={analysis.status}>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              실제 나이 대비 자세 편차, 비대칭, 위험 규칙을 반영한 기능적 체형 나이입니다.
            </p>
          </MetricPanel>
          <MetricPanel title="가상 무게중심" value={analysis.cog?.available ? `${Math.abs(analysis.cog.offsetPct)}%` : '-'} unit="" status={analysis.cog?.status}>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {analysis.cog?.message || 'CoG/BoS 계산을 위한 발목, 골반, 어깨 랜드마크가 부족합니다.'}
            </p>
          </MetricPanel>
        </section>

        <section className="grid gap-4 sm:grid-cols-[1.3fr_0.9fr]">
          <GhostingViewer
            currentImageUrl={currentImageUrl || report?.imageUrl || report?.image_urls?.front || report?.image_urls?.current?.front}
            previousImageUrl={previousImageUrl || report?.comparison?.previousImageUrl || report?.comparison?.image_urls?.front || report?.image_urls?.before?.front}
            currentLandmarks={currentPose}
            previousLandmarks={previousPose}
            cog={analysis.cog}
            status={analysis.cog?.status || analysis.status}
          />

          <div className="flex flex-col gap-3">
            <Panel title="정렬 지표">
              <div className="grid grid-cols-2 gap-2">
                <MetricCard metric={{ key:'asi', label:'좌우 비대칭', displayValue: analysis.asymmetry?.averageAsi ?? '-', unit:'%',
                  status: statusToken(analysis.asymmetry?.averageAsi >= 12 ? 'risk' : analysis.asymmetry?.averageAsi >= 7 ? 'caution' : 'normal') }} />
                <MetricCard metric={{ key:'roll', label:'좌우 기울기', displayValue: analysis.rotations?.rollDeg ?? '-', unit:'°',
                  status: statusToken(Math.abs(analysis.rotations?.rollDeg || 0) >= 5 ? 'caution' : 'normal') }} />
                <MetricCard metric={{ key:'pitch', label:'앞뒤 기울기', displayValue: analysis.rotations?.pitchDeg ?? '-', unit:'°',
                  status: statusToken(Math.abs(analysis.rotations?.pitchDeg || 0) >= 8 ? 'caution' : 'normal') }} />
                <MetricCard metric={{ key:'yaw', label:'몸통 틀어짐', displayValue: analysis.rotations?.yawDeg ?? '-', unit:'°',
                  status: statusToken(Math.abs(analysis.rotations?.yawDeg || 0) >= 8 ? 'caution' : 'normal') }} />
              </div>
            </Panel>

            <Panel title="뷰별 핵심 지표">
              <div className="grid grid-cols-2 gap-2">
                <MetricCard metric={{ key:'shoulder', label:'어깨 높이', displayValue: absValue(analysis.frontal?.shoulderHeightDiffMm), unit:'mm',
                  status: statusToken(mmStatus(analysis.frontal?.shoulderHeightDiffMm, ...POSTURE_THRESHOLDS.shoulderDiffMm)) }} />
                <MetricCard metric={{ key:'pelvis', label:'골반 높이', displayValue: absValue(analysis.frontal?.pelvisHeightDiffMm), unit:'mm',
                  status: statusToken(mmStatus(analysis.frontal?.pelvisHeightDiffMm, ...POSTURE_THRESHOLDS.pelvisDiffMmNeutral)) }} />
                <MetricCard metric={{ key:'fhead', label:'거북목 거리', displayValue: absValue(analysis.sagittal?.forwardHeadMm), unit:'mm',
                  status: statusToken(mmStatus(analysis.sagittal?.forwardHeadMm, ...POSTURE_THRESHOLDS.forwardHeadMm)) }} />
                <MetricCard metric={{ key:'knee', label:'무릎 펴짐 각도', displayValue: analysis.sagittal?.kneeExtensionProxyDeg ?? '-', unit:'°',
                  status: statusToken(kneeExtensionStatus(analysis.sagittal?.kneeExtensionProxyDeg)) }} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                골반 패턴: {pelvisPatternLabel(analysis.frontal?.pelvisPattern)} · 신뢰도 {analysis.reliability?.validCount ?? 0}/{analysis.reliability?.requiredCount ?? 8}
              </p>
            </Panel>

            <Panel title="항목별 체크 결과">
              <div className="space-y-2">
                {findings.length ? findings.map((item) => (
                  <FindingRow key={item.key} finding={item} />
                )) : (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    주요 위험 규칙에 해당하는 항목이 없습니다.
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="종합 코멘트">
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {analysis.summaryComment || report?.summaryComment || '측정 결과를 기반으로 체형 정렬 상태를 추적하세요.'}
              </p>
            </Panel>
          </div>
        </section>

        <RegionDiagnoses regions={clinical.regions} />
        <AxialRotationSection rotation={axialRotation} />
        <RiskTop3 items={clinical.riskTop3} />
        <MuscleBalanceMap muscleMap={clinical.muscleMap} />

        <PostureSnapshotGallery snapshots={perViewSnapshots || report?.perViewSnapshots} />

        <section className={`rounded-lg border px-4 py-3 ${statusStyle.bg} ${statusStyle.border}`}>
          <p className={`text-sm font-bold ${statusStyle.text}`}>
            현재 상태: {POSTURE_STATUS_KO[analysis.status] || '주의'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            본 리포트는 BlazePose 기반 스크리닝 자료이며, 통증 또는 신경학적 증상이 있는 경우 전문 의료진 평가가 우선입니다.
          </p>
        </section>
      </UnifiedReportPage>
    </UnifiedReportCanvas>
  );
}

const LEVEL_STYLE = {
  normal: { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', ko: '정상' },
  caution: { text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30', ko: '주의' },
  risk: { text: 'text-red-700 dark:text-red-300', bg: 'bg-red-500/10', border: 'border-red-500/30', ko: '위험' },
  insufficient: { text: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100/40 dark:bg-slate-800/40', border: 'border-slate-300 dark:border-slate-700', ko: '측정 부족' },
};

function MetadataStrip({ metadata, viewsMeasured }) {
  if (!metadata) return null;
  const sexNorm = String(metadata.sex || '').trim().toLowerCase();
  const sexKo = ['m', 'male', '남', '남성'].includes(sexNorm) ? '남'
    : ['f', 'female', '여', '여성'].includes(sexNorm) ? '여'
    : '미입력';
  const views = Array.isArray(viewsMeasured) ? viewsMeasured.length : null;
  const cell = (label, value) => (
    <div className="rounded-md bg-white dark:bg-slate-900 px-2.5 py-1.5">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="text-xs font-black text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-black text-slate-600 dark:text-slate-300">측정 정보 · 영점 메타데이터</p>
        {metadata.horizontalPlaneCertified ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">✓ AI 수평 평면 변환</span>
        ) : (
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">수평 보정 정보 없음</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {cell('성별', sexKo)}
        {cell('연령', metadata.actualAge != null ? `${metadata.actualAge}세` : '미입력')}
        {cell('신장', metadata.heightCm != null ? `${metadata.heightCm}cm` : '미입력')}
        {cell('촬영거리', `${metadata.captureDistanceM}m`)}
        {cell('삼각대', `${metadata.tripodHeightM}m`)}
        {cell('카메라 틸트', metadata.cameraTiltDeg != null ? `${metadata.cameraTiltDeg}°` : '—')}
      </div>
      {views != null && (
        <p className="mt-2 text-[10px] text-slate-500">측정 면 수: {views}면 (다면 측정일수록 3D 해석 신뢰도가 높아집니다)</p>
      )}
    </section>
  );
}

function RegionDiagnoses({ regions }) {
  if (!Array.isArray(regions) || !regions.length) return null;
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <p className="mb-3 text-sm font-black text-white">부위별 원인 진단</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {regions.map((r) => {
          const st = LEVEL_STYLE[r.level] || LEVEL_STYLE.insufficient;
          return (
            <div key={r.key} className={`rounded-lg border p-3 ${st.bg} ${st.border}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-white">{r.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.text}`}>{st.ko}</span>
              </div>
              {r.measured.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.measured.map((m, i) => (
                    <span key={i} className="rounded bg-slate-50/60 dark:bg-slate-950/60 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      {m.label} {m.value}{m.unit}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{r.problem}</p>
              {r.recommendation && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">→ {r.recommendation}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AxialRotationSection({ rotation }) {
  if (!rotation || !rotation.available) {
    return (
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <p className="mb-1 text-sm font-black text-white">전신 회전(축 정렬) 분석</p>
        <p className="text-xs text-slate-500">회전을 추정할 측정값이 부족합니다.</p>
      </section>
    );
  }
  const seg = rotation.segments || {};
  const confPct = Math.round((rotation.confidence || 0) * 100);
  const confColor = confPct >= 70 ? 'text-emerald-700 dark:text-emerald-300' : confPct >= 45 ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300';
  const levelStyle = (lv) => (lv === 'marked' ? 'text-red-700 dark:text-red-300' : lv === 'mild' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300');

  const segRow = (label, s) => {
    if (!s) return (
      <div className="flex items-center justify-between rounded-md bg-slate-50/50 dark:bg-slate-950/50 px-3 py-2">
        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
        <span className="text-xs text-slate-500">측정 부족</span>
      </div>
    );
    return (
      <div className="flex items-center justify-between rounded-md bg-slate-50/50 dark:bg-slate-950/50 px-3 py-2">
        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {ROTATION_DIRECTION_KO[s.direction] || s.direction}
          </span>
          <span className={`text-xs font-black ${levelStyle(s.level)}`}>
            {ROTATION_LEVEL_KO[s.level] || '-'}
          </span>
        </span>
      </div>
    );
  };

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-sm font-black text-white">전신 회전(축 정렬) 분석</p>
        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">4면 종합 · 추정</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        분절별 좌우 회전 방향과 정도(없음/경미/뚜렷)입니다. 도(°) 단정 대신 방향·단계로 표기합니다.
        <span className={`ml-1 font-bold ${confColor}`}>신뢰도 {confPct}%</span>
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {segRow('머리', seg.head)}
        {segRow('체간(어깨)', seg.trunk)}
        {segRow('골반', seg.pelvis)}
        {segRow('하체', seg.lower)}
      </div>

      {rotation.axialTwist && rotation.axialTwist.level !== 'none' && (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 ${rotation.axialTwist.opposing ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
          <p className={`text-xs font-black ${rotation.axialTwist.opposing ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
            🔄 척추 축 비틀림 {ROTATION_LEVEL_KO[rotation.axialTwist.level]}
            {rotation.axialTwist.opposing ? ' (체간·골반 반대 방향)' : ''}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            {rotation.axialTwist.opposing
              ? '체간과 골반이 서로 반대 방향으로 회전해 있어 척추 회전(비틀림) 경향이 관찰됩니다. 회전성 요통·디스크 부담을 높일 수 있어 회전 안정화 운동 평가를 권장합니다.'
              : '체간과 골반의 회전 정도에 차이가 있습니다. 좌우 균형 회전 운동을 점검하세요.'}
          </p>
        </div>
      )}

      {rotation.note && (
        <p className="mt-2 text-[11px] text-slate-500">{rotation.note}</p>
      )}
    </section>
  );
}

function RiskTop3({ items }) {
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <p className="mb-1 text-sm font-black text-white">통증·부상 위험 예측 Top 3</p>
      <p className="mb-3 text-[11px] text-slate-500">현재 불균형을 방치할 경우 통증 발생 가능성이 높은 순서입니다. (예측 참고용)</p>
      {(!items || !items.length) ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          현재 측정값에서 두드러진 위험 부위가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const st = LEVEL_STYLE[it.level] || LEVEL_STYLE.caution;
            return (
              <div key={it.key} className={`flex items-start gap-3 rounded-lg border p-2.5 ${st.bg} ${st.border}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-50/60 dark:bg-slate-950/60 text-sm font-black ${st.text}`}>{it.rank}</span>
                <div>
                  <p className="text-sm font-black text-white">{it.area} <span className={`text-[10px] font-bold ${st.text}`}>· {st.ko}</span></p>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{it.outcome}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MuscleBalanceMap({ muscleMap }) {
  if (!muscleMap) return null;
  const { tight = [], weak = [], note } = muscleMap;
  const empty = tight.length === 0 && weak.length === 0;
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-sm font-black text-white">근육 밸런스 맵</p>
        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">추정 · 측정값 아님</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">{note}</p>
      {empty ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          두드러진 자세 불균형이 없어 특이 근육 경향이 추정되지 않았습니다.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <p className="mb-2 text-xs font-black text-red-700 dark:text-red-300">🔴 긴장·단축 (풀어주기)</p>
            <ul className="space-y-1.5">
              {tight.length ? tight.map((m, i) => (
                <li key={i} className="text-xs text-slate-600 dark:text-slate-300"><span className="font-bold text-white">{m.name}</span> — {m.reason}</li>
              )) : <li className="text-xs text-slate-500">해당 없음</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="mb-2 text-xs font-black text-sky-700 dark:text-sky-300">🔵 약화·이완 (강화하기)</p>
            <ul className="space-y-1.5">
              {weak.length ? weak.map((m, i) => (
                <li key={i} className="text-xs text-slate-600 dark:text-slate-300"><span className="font-bold text-white">{m.name}</span> — {m.reason}</li>
              )) : <li className="text-xs text-slate-500">해당 없음</li>}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function PostureSnapshotGallery({ snapshots }) {
  const items = Array.isArray(snapshots) ? snapshots.filter((s) => s && s.snapshotUrl) : [];
  if (!items.length) return null;
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black text-white">측정 장면 ({items.length}면)</p>
        <p className="text-xs text-slate-500">스켈레톤 인식 상태를 확인하세요</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <SnapshotCard key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

// 측면에서 카메라에 가까운(z가 작은) 쪽 관절 선택. 한쪽만 보이면 그쪽 사용.
function pickNear(lm, leftIdx, rightIdx) {
  const L = lm[leftIdx]; const R = lm[rightIdx];
  const okL = L && (L.visibility ?? 1) >= 0.25;
  const okR = R && (R.visibility ?? 1) >= 0.25;
  if (okL && okR) return ((L.z ?? 0) <= (R.z ?? 0)) ? L : R;
  return okL ? L : (okR ? R : null);
}

// 화살표(특이사항·정렬 방향 표시). (fromX,fromY)→(toX,toY)
function drawArrow(ctx, fromX, fromY, toX, toY, color, scale) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  const ang = Math.atan2(toY - fromY, toX - fromX);
  const head = Math.max(7, 11 * scale);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - head * Math.cos(ang - Math.PI / 6), toY - head * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(toX - head * Math.cos(ang + Math.PI / 6), toY - head * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 리포트 스냅샷용 문제 지점 오버레이.
//  분석값(analysis)이 있으면 측정 결과에 따라 문제 지점마다 빨간/주황 원·화살표를 표시한다.
//   - 측면(left/right): 목 기울기선·각도, 굽은등 빨간 원, 무릎 과신전 원
//   - 정면/후면: 머리/어깨/골반 높이차 원, 무릎 정렬(외반/내반) 화살표, 손 회전 표시
function drawProblemMarkers(ctx, lm, px, scale, viewKey, analysis) {
  const RED = 'rgba(248,113,113,0.95)';
  const ORANGE = 'rgba(251,146,60,0.95)';
  const label = (text, x, y, color) => {
    ctx.save();
    ctx.font = `bold ${Math.round(13 * scale)}px system-ui, sans-serif`;
    const padX = 5 * scale; const padY = 3 * scale;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(x - padX, y - 13 * scale - padY, w + padX * 2, 17 * scale + padY * 2);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  };
  const circle = (cx, cy, rad, color) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  const frontal = analysis?.frontal;
  const sagittal = analysis?.sagittal;

  if (viewKey === 'left' || viewKey === 'right') {
    const ear = pickNear(lm, 7, 8);
    const shoulder = pickNear(lm, 11, 12);
    const hip = pickNear(lm, 23, 24);
    const knee = pickNear(lm, 25, 26);
    const ankle = pickNear(lm, 27, 28);
    // ① 목 기울기(귀→어깨 전방 기울기) — 빨간 선 + 각도
    if (ear && shoulder) {
      const E = px(ear); const S = px(shoulder);
      ctx.save();
      ctx.strokeStyle = RED;
      ctx.lineWidth = Math.max(2.5, 3.4 * scale);
      ctx.beginPath(); ctx.moveTo(S.x, S.y); ctx.lineTo(E.x, E.y); ctx.stroke();
      ctx.restore();
      const dx = E.x - S.x; const dy = S.y - E.y;
      const tiltDeg = Math.round(Math.abs(Math.atan2(dx, Math.max(1, dy)) * 180 / Math.PI));
      if (tiltDeg >= 8) label(`목 기울기 ${tiltDeg}°`, E.x + 8 * scale, E.y - 6 * scale, RED);
    }
    // ② 굽은등(흉추 굴곡 proxy): 귀-어깨-골반 각도. 굴곡이 클수록 편위.
    if (ear && shoulder && hip) {
      const a = Math.atan2(ear.y - shoulder.y, ear.x - shoulder.x);
      const b = Math.atan2(hip.y - shoulder.y, hip.x - shoulder.x);
      let deg = Math.abs((a - b) * 180 / Math.PI);
      if (deg > 180) deg = 360 - deg;
      const dev = Math.round(Math.abs(180 - deg));
      if (dev >= 15) {
        const S = px(shoulder);
        const rad = Math.max(18, 26 * scale);
        circle(S.x, S.y, rad, RED);
        label(`굽은등 편위 ${dev}°`, S.x + rad + 4 * scale, S.y - 4 * scale, RED);
      }
    }
    // ③ 무릎 과신전(측면): 고관절-무릎-발목이 뒤로 꺾임. analysis 우선, 없으면 기하 추정.
    if (hip && knee && ankle) {
      const kneeExtDeg = sagittal?.kneeExtensionProxyDeg;
      // 무릎이 발목보다 앞으로 나가고 각도가 펴진 상태(>183 proxy)면 과신전 의심
      const hyper = (typeof kneeExtDeg === 'number' && kneeExtDeg >= 183)
        || (knee.x !== ankle.x && Math.sign(knee.x - ankle.x) === Math.sign(knee.x - hip.x) && Math.abs(knee.x - ankle.x) > 0.012);
      if (hyper) {
        const K = px(knee);
        const rad = Math.max(15, 22 * scale);
        circle(K.x, K.y, rad, ORANGE);
        label('무릎 과신전 의심', K.x + rad + 4 * scale, K.y, ORANGE);
      }
    }
  } else if (viewKey === 'front' || viewKey === 'back') {
    // ① 머리 좌우 기울기(roll)
    const okEye = lm[2] && lm[5] && (lm[2].visibility ?? 1) >= 0.25 && (lm[5].visibility ?? 1) >= 0.25;
    const pair = okEye ? [lm[2], lm[5]] : ((lm[7] && lm[8]) ? [lm[7], lm[8]] : null);
    if (pair) {
      const L = px(pair[0]); const R = px(pair[1]);
      const rollDeg = Math.round(Math.abs(Math.atan2(R.y - L.y, R.x - L.x) * 180 / Math.PI));
      if (rollDeg >= 4) {
        const cx = (L.x + R.x) / 2; const cy = (L.y + R.y) / 2;
        const rad = Math.max(16, 22 * scale);
        circle(cx, cy, rad, RED);
        label(`머리 기울기 ${rollDeg}°`, cx + rad + 4 * scale, cy - 4 * scale, RED);
      }
    }
    // ② 어깨 높이차 (좌우 불균형) — 5mm 이상이면 높은 쪽 어깨에 원
    const lSh = lm[11]; const rSh = lm[12];
    const shDiff = Math.abs(frontal?.shoulderHeightDiffMm ?? 0);
    if (lSh && rSh && shDiff >= 5) {
      const higher = (lSh.y <= rSh.y) ? lSh : rSh; // y 작을수록 위(높음)
      const H = px(higher);
      const rad = Math.max(16, 22 * scale);
      circle(H.x, H.y, rad, ORANGE);
      label(`어깨 높이차 ${Math.round(shDiff)}mm`, H.x + rad + 4 * scale, H.y - 4 * scale, ORANGE);
    }
    // ③ 골반 높이차 (좌우 불균형) — 5mm 이상이면 높은 쪽 골반에 원 (이미지2)
    const lHip = lm[23]; const rHip = lm[24];
    const pvDiff = Math.abs(frontal?.pelvisHeightDiffMm ?? 0);
    if (lHip && rHip && pvDiff >= 5) {
      const higher = (lHip.y <= rHip.y) ? lHip : rHip;
      const H = px(higher);
      const rad = Math.max(16, 22 * scale);
      circle(H.x, H.y, rad, ORANGE);
      label(`골반 높이차 ${Math.round(pvDiff)}mm`, H.x + rad + 4 * scale, H.y + 4 * scale, ORANGE);
    }
    // ④ 무릎 정렬(외반 X자 / 내반 O자): 화살표로 변형 방향 표시
    const legKey = frontal?.legAlignment?.key;
    const lKnee = lm[25]; const rKnee = lm[26];
    if (lKnee && rKnee && (legKey === 'genu_valgum' || legKey === 'genu_varum')) {
      const LK = px(lKnee); const RK = px(rKnee);
      const midY = (LK.y + RK.y) / 2;
      const gap = Math.max(20, 30 * scale);
      if (legKey === 'genu_valgum') {
        // X자: 양 무릎이 안쪽으로 → 화살표가 서로 마주봄
        drawArrow(ctx, LK.x - gap, midY, LK.x, midY, RED, scale);
        drawArrow(ctx, RK.x + gap, midY, RK.x, midY, RED, scale);
        label('무릎 외반(X자)', Math.min(LK.x, RK.x) - gap, midY - 8 * scale, RED);
      } else {
        // O자: 양 무릎이 바깥으로 → 화살표가 바깥을 향함
        drawArrow(ctx, LK.x, midY, LK.x - gap, midY, RED, scale);
        drawArrow(ctx, RK.x, midY, RK.x + gap, midY, RED, scale);
        label('무릎 내반(O자)', Math.min(LK.x, RK.x) - gap, midY - 8 * scale, RED);
      }
    }
    // ⑤ 손 회전(정면 한정): 손목-손 랜드마크로 손바닥/손등 방향 추정
    //    BlazePose 22(L pinky),18/20, 21(L index)/19 등으로 회전 추정은 신뢰도 낮아
    //    엄지(21,22)-새끼(17,18) 좌우 순서로만 간단 표시.
    if (viewKey === 'front') {
      drawHandRotation(ctx, lm, px, scale, label, 'left');
      drawHandRotation(ctx, lm, px, scale, label, 'right');
    }
  }
}

// 손 회전 표시(정면): 같은 쪽 엄지(thumb)와 새끼(pinky)의 좌우 위치로
// 손바닥이 앞을 향하는지(외회전) 손등이 앞을 향하는지(내회전) 추정.
//  왼손: 손바닥 앞 → 엄지가 신체 바깥(화면 좌측), 오른손: 엄지가 신체 바깥(화면 우측).
function drawHandRotation(ctx, lm, px, scale, label, side) {
  const isLeft = side === 'left';
  const wrist = lm[isLeft ? 15 : 16];
  const thumb = lm[isLeft ? 21 : 22];
  const pinky = lm[isLeft ? 17 : 18];
  const ok = (p) => p && (p.visibility ?? 1) >= 0.3;
  if (!ok(wrist) || !ok(thumb) || !ok(pinky)) return;
  // 손바닥 정면(외회전 중립)일 때 엄지는 신체 바깥쪽.
  // 화면 좌표 x 는 좌우 반전 가능성 있어 '엄지가 새끼보다 바깥'인지로 판정.
  const thumbOutside = isLeft ? (thumb.x < pinky.x) : (thumb.x > pinky.x);
  const W = px(wrist);
  const text = thumbOutside ? `${isLeft ? '좌' : '우'}손 손바닥(외회전)` : `${isLeft ? '좌' : '우'}손 손등(내회전)`;
  const color = thumbOutside ? 'rgba(52,211,153,0.95)' : 'rgba(251,146,60,0.95)';
  // 손등(내회전)일 때만 강조(문제 포인트). 손바닥(중립)은 표시 생략해 과밀 방지.
  if (!thumbOutside) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.beginPath();
    ctx.arc(W.x, W.y, Math.max(13, 18 * scale), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    label(text, W.x + 18 * scale, W.y, color);
  }
}

function SnapshotCard({ item }) {
  const canvasRef = React.useRef(null);
  const imgRef = React.useRef(null);

  const drawOverlay = React.useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lm = item.landmarks;
    if (!Array.isArray(lm)) return;
    const px = (p) => ({ x: p.x * canvas.width, y: p.y * canvas.height });
    const scale = canvas.width / 600; // 라벨/원 크기 정규화 기준
    ctx.lineWidth = Math.max(2, canvas.width / 180);
    ctx.strokeStyle = 'rgba(52,211,153,0.9)';
    SKELETON_CONNECTIONS.forEach(([a, b]) => {
      const pa = lm[a]; const pb = lm[b];
      if (!pa || !pb) return;
      if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) return;
      const A = px(pa); const B = px(pb);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    });
    ctx.fillStyle = '#fde68a';
    const r = Math.max(2.5, canvas.width / 150);
    lm.forEach((p) => {
      if (!p || (p.visibility ?? 1) < 0.3) return;
      const P = px(p);
      ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, Math.PI * 2); ctx.fill();
    });

    // ── 문제 지점 빨간/주황 원·화살표 + 측면 목 기울기 라벨 (라이브 화면과 동일) ──
    drawProblemMarkers(ctx, lm, px, scale, item.key, item.analysis);
  }, [item.landmarks, item.key, item.analysis]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950">
      <div className="relative aspect-[3/4] w-full bg-black">
        <img
          ref={imgRef}
          src={item.snapshotUrl}
          alt={item.label}
          crossOrigin="anonymous"
          className="absolute inset-0 h-full w-full object-cover"
          onLoad={drawOverlay}
        />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />
      </div>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{item.label}</span>
        {item.analysis?.score != null && (
          <span className="text-xs font-black text-amber-700 dark:text-amber-300">{item.analysis.score}점</span>
        )}
      </div>
    </div>
  );
}

function ScoreDial({ score, status }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.caution;
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <div className={`flex min-h-[190px] flex-col items-center justify-center rounded-lg border bg-white dark:bg-slate-900 p-4 ring-1 ${style.border} ${style.ring}`}>
      <div className="relative h-36 w-36">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#1e293b" strokeWidth="12" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={style.stroke}
            strokeLinecap="round"
            strokeWidth="12"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-4xl font-black ${style.text}`}>{score}</span>
          <span className="text-xs font-bold text-slate-500">/ 100</span>
        </div>
      </div>
      <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">통합 체형 점수</p>
    </div>
  );
}

function MetricPanel({ title, value, unit, status = 'caution', children }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.caution;
  return (
    <div className={`rounded-lg border bg-white dark:bg-slate-900 p-4 ${style.border}`}>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <p className={`mt-3 text-4xl font-black tabular-nums ${style.text}`}>
        {value}<span className="ml-1 text-base text-slate-500 dark:text-slate-400">{unit}</span>
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-black text-white">{title}</h2>
      {children}
    </section>
  );
}

function FindingRow({ finding }) {
  const style = STATUS_STYLE[finding.status] || STATUS_STYLE.caution;
  return (
    <div className={`rounded-md border px-3 py-2 ${style.bg} ${style.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-black ${style.text}`}>{finding.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{finding.message}</p>
        </div>
        <span className={`shrink-0 rounded px-2 py-1 text-xs font-black ${style.text}`}>
          {POSTURE_STATUS_KO[finding.status]}
        </span>
      </div>
    </div>
  );
}

function absValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : '-';
}

function mmStatus(value, cautionMm, riskMm) {
  const abs = Math.abs(value ?? 0);
  if (abs >= riskMm) return 'risk';
  if (abs >= cautionMm) return 'caution';
  return 'normal';
}

function kneeExtensionStatus(value) {
  if (value == null) return 'caution';
  // 과신전 방향만 판정한다 — evaluatePostureRules(점수·항목별 체크 목록)·
  // postureClinical.js(부위별 진단)와 동일 기준으로 통일(POSTURE_THRESHOLDS).
  // 이전엔 여기만 미달(<175/177)도 위험/주의로 잡아, 같은 리포트 화면 안에서
  // 이 지표 카드와 "항목별 체크 결과"·점수가 서로 다른 판정을 보여줬다.
  const { cautionAbove, riskAbove } = POSTURE_THRESHOLDS.kneeExtensionDeg;
  if (value > riskAbove) return 'risk';
  if (value > cautionAbove) return 'caution';
  return 'normal';
}

function pelvisPatternLabel(pattern) {
  if (pattern === 'structural_leg_length_pattern') return '다리 길이 차이 가능성';
  if (pattern === 'functional_lumbopelvic_pattern') return '요방형근/중둔근 기능성 불균형 가능성';
  if (pattern === 'within_error') return '측정 오차 범위';
  return '판별 보류';
}

function GhostingViewer({
  currentImageUrl,
  previousImageUrl,
  currentLandmarks,
  previousLandmarks,
  cog,
  status,
}) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.caution;
  const normalizedPreviousLandmarks = useMemo(
    () => normalizeLandmarksForOverlay(previousLandmarks, currentLandmarks),
    [currentLandmarks, previousLandmarks],
  );
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-black text-white">Before & After Ghosting</h2>
          <p className="text-xs text-slate-500">과거 스켈레톤은 점선, 현재 스켈레톤은 실선으로 표시됩니다.</p>
        </div>
        <div className="flex items-center gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-5 border-t-2 border-dashed border-sky-300" /> Before</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-5 border-t-2 border-emerald-300" /> Today</span>
        </div>
      </div>
      <div className="relative aspect-[3/4] w-full bg-slate-50 dark:bg-slate-950">
        {previousImageUrl && (
          <img src={previousImageUrl} alt="" className="absolute inset-0 h-full w-full object-contain opacity-25" />
        )}
        {currentImageUrl && (
          <img src={currentImageUrl} alt="" className="absolute inset-0 h-full w-full object-contain opacity-80" />
        )}
        {!currentImageUrl && !previousImageUrl && (
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px]" />
        )}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {normalizedPreviousLandmarks && <SkeletonLayer landmarks={normalizedPreviousLandmarks} stroke="#7dd3fc" opacity={0.38} dashed />}
          {currentLandmarks && <SkeletonLayer landmarks={currentLandmarks} stroke="#34d399" opacity={0.95} />}
          {cog?.available && (
            <CoGLayer cog={cog} stroke={style.stroke} />
          )}
        </svg>
      </div>
    </section>
  );
}

export function normalizeLandmarksForOverlay(sourceLandmarks, targetLandmarks) {
  if (!sourceLandmarks || !targetLandmarks) return sourceLandmarks || null;
  const sourceAnchor = overlayAnchor(sourceLandmarks);
  const targetAnchor = overlayAnchor(targetLandmarks);
  if (!sourceAnchor?.midHip || !targetAnchor?.midHip) return sourceLandmarks;

  const sourceScale = sourceAnchor.torsoLength || sourceAnchor.hipWidth || 1;
  const targetScale = targetAnchor.torsoLength || targetAnchor.hipWidth || sourceScale;
  const scale = sourceScale > 0 ? targetScale / sourceScale : 1;

  return sourceLandmarks.map((point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
    return {
      ...point,
      x: targetAnchor.midHip.x + (point.x - sourceAnchor.midHip.x) * scale,
      y: targetAnchor.midHip.y + (point.y - sourceAnchor.midHip.y) * scale,
      z: point.z == null ? point.z : point.z * scale,
    };
  });
}

function overlayAnchor(landmarks) {
  const leftHip = landmarks?.[LM.LEFT_HIP];
  const rightHip = landmarks?.[LM.RIGHT_HIP];
  const leftShoulder = landmarks?.[LM.LEFT_SHOULDER];
  const rightShoulder = landmarks?.[LM.RIGHT_SHOULDER];
  const midHip = midpoint2d(leftHip, rightHip);
  const midShoulder = midpoint2d(leftShoulder, rightShoulder);
  return {
    midHip,
    midShoulder,
    torsoLength: distance2d(midHip, midShoulder),
    hipWidth: distance2d(leftHip, rightHip),
  };
}

function midpoint2d(a, b) {
  if (!isRenderable(a) || !isRenderable(b)) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

function distance2d(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function SkeletonLayer({ landmarks, stroke, opacity = 1, dashed = false }) {
  return (
    <g opacity={opacity}>
      {SKELETON_CONNECTIONS.map(([from, to]) => {
        const a = landmarks?.[from];
        const b = landmarks?.[to];
        if (!isRenderable(a) || !isRenderable(b)) return null;
        return (
          <line
            key={`${from}-${to}`}
            x1={a.x * 100}
            y1={a.y * 100}
            x2={b.x * 100}
            y2={b.y * 100}
            stroke={stroke}
            strokeWidth={dashed ? 0.5 : 0.7}
            strokeLinecap="round"
            strokeDasharray={dashed ? '2 1.5' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {landmarks?.map((point, index) => (
        isRenderable(point) ? (
          <circle
            key={index}
            cx={point.x * 100}
            cy={point.y * 100}
            r={dashed ? 0.55 : 0.7}
            fill={stroke}
            vectorEffect="non-scaling-stroke"
          />
        ) : null
      ))}
    </g>
  );
}

function CoGLayer({ cog, stroke }) {
  const top = cog.cogLine.top;
  const bottom = cog.cogLine.bottom;
  const bos = cog.bos;
  return (
    <g>
      <line
        x1={top.x * 100}
        y1={top.y * 100}
        x2={bottom.x * 100}
        y2={bottom.y * 100}
        stroke={stroke}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={cog.cogLine.xAtBos * 100}
        y1="0"
        x2={cog.cogLine.xAtBos * 100}
        y2="100"
        stroke={stroke}
        strokeWidth="0.7"
        strokeDasharray="3 2"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={bos.left.x * 100}
        y1={bos.center.y * 100}
        x2={bos.right.x * 100}
        y2={bos.center.y * 100}
        stroke="#cbd5e1"
        strokeWidth="0.7"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={bos.center.x * 100} cy={bos.center.y * 100} r="0.9" fill="#e2e8f0" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function isRenderable(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility == null || point.visibility >= 0.25);
}
