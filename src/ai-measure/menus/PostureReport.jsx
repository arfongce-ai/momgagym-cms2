import React, { useMemo } from 'react';
import {
  POSTURE_STATUS_KO,
  POSE_LANDMARKS,
  analyzePostureFromLandmarks,
} from '../core/postureMath';
import { buildClinicalInterpretation } from '../core/postureClinical';
import { buildPostureMarkers } from '../core/postureOverlay';
import { analyzeAxialRotation, ROTATION_DIRECTION_KO, ROTATION_LEVEL_KO } from '../core/postureRotation';

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
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    stroke: '#34d399',
    ring: 'ring-emerald-500/30',
  },
  caution: {
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    stroke: '#fbbf24',
    ring: 'ring-amber-500/30',
  },
  risk: {
    text: 'text-red-300',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    stroke: '#f87171',
    ring: 'ring-red-500/30',
  },
};

export default function PostureReport({
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

  if (!analysis) {
    return (
      <div className="w-full rounded-lg border border-slate-700 bg-slate-900 p-6 text-center text-sm text-slate-400">
        분석 가능한 BlazePose 랜드마크가 없습니다.
      </div>
    );
  }

  const statusStyle = STATUS_STYLE[analysis.status] || STATUS_STYLE.caution;
  const memberName = member?.name || report?.memberName || '회원';
  const measuredAt = (report?.measuredAt || report?.createdAt || new Date().toISOString()).slice(0, 10);
  const bodyAge = analysis.bodyAge ?? report?.bodyAge;
  const score = analysis.score ?? report?.postureScore ?? 0;
  const findings = analysis.rules?.findings?.length ? analysis.rules.findings : [];

  // 임상 해석(부위별 진단·근육 추정·위험 Top3) — 측정값 기반, 비단정.
  const clinical = useMemo(() => {
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
    const pv = report?.perViewAnalysis && Object.keys(report.perViewAnalysis).length
      ? report.perViewAnalysis
      : { front: analysis };
    return analyzeAxialRotation(pv);
  }, [report, analysis]);

  return (
    <div className="min-h-full w-full bg-slate-950 p-4 text-slate-100">
      {/* ── A4 1페이지: 요약(점수·체형나이·CoG·정렬·뷰별 지표) ── */}
      <div className="report-a4-page mx-auto flex w-full max-w-[794px] flex-col gap-4 rounded-2xl bg-slate-950 p-5 ring-1 ring-slate-800">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-300">Posture & Alignment Assessment</p>
            <h1 className="mt-1 text-2xl font-black text-white">
              {memberName} <span className="text-base font-semibold text-slate-500">{measuredAt}</span>
            </h1>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-slate-500 hover:text-white"
            >
              닫기
            </button>
          )}
        </header>

        <MetadataStrip metadata={clinical.metadata} viewsMeasured={report?.viewsMeasured} />

        <section className="grid gap-3 sm:grid-cols-[240px_1fr_1fr]">
          <ScoreDial score={score} status={analysis.status} />
          <MetricPanel title="체형 나이" value={bodyAge ?? '-'} unit={bodyAge ? '세' : ''} status={analysis.status}>
            <p className="text-sm leading-relaxed text-slate-400">
              실제 나이 대비 자세 편차, 비대칭, 위험 규칙을 반영한 기능적 체형 나이입니다.
            </p>
          </MetricPanel>
          <MetricPanel title="가상 무게중심" value={analysis.cog?.available ? `${Math.abs(analysis.cog.offsetPct)}%` : '-'} unit="" status={analysis.cog?.status}>
            <p className="text-sm leading-relaxed text-slate-400">
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
                <SmallMetric label="ASI 평균" value={analysis.asymmetry?.averageAsi ?? '-'} unit="%" status={analysis.asymmetry?.averageAsi >= 12 ? 'risk' : analysis.asymmetry?.averageAsi >= 7 ? 'caution' : 'normal'} />
                <SmallMetric label="Roll" value={analysis.rotations?.rollDeg ?? '-'} unit="deg" status={Math.abs(analysis.rotations?.rollDeg || 0) >= 5 ? 'caution' : 'normal'} />
                <SmallMetric label="Pitch" value={analysis.rotations?.pitchDeg ?? '-'} unit="deg" status={Math.abs(analysis.rotations?.pitchDeg || 0) >= 8 ? 'caution' : 'normal'} />
                <SmallMetric label="Yaw" value={analysis.rotations?.yawDeg ?? '-'} unit="deg" status={Math.abs(analysis.rotations?.yawDeg || 0) >= 8 ? 'caution' : 'normal'} />
              </div>
            </Panel>

            <Panel title="뷰별 핵심 지표">
              <div className="grid grid-cols-2 gap-2">
                <SmallMetric label="어깨 높이" value={absValue(analysis.frontal?.shoulderHeightDiffMm)} unit="mm" status={mmStatus(analysis.frontal?.shoulderHeightDiffMm, 8, 18)} />
                <SmallMetric label="골반 높이" value={absValue(analysis.frontal?.pelvisHeightDiffMm)} unit="mm" status={mmStatus(analysis.frontal?.pelvisHeightDiffMm, 8, 15)} />
                <SmallMetric label="거북목 거리" value={absValue(analysis.sagittal?.forwardHeadMm)} unit="mm" status={mmStatus(analysis.sagittal?.forwardHeadMm, 25, 45)} />
                <SmallMetric label="무릎 신전각" value={analysis.sagittal?.kneeExtensionProxyDeg ?? '-'} unit="deg" status={kneeExtensionStatus(analysis.sagittal?.kneeExtensionProxyDeg)} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                골반 패턴: {pelvisPatternLabel(analysis.frontal?.pelvisPattern)} · 신뢰도 {analysis.reliability?.validCount ?? 0}/{analysis.reliability?.requiredCount ?? 8}
              </p>
            </Panel>

            <Panel title="Rule-based 평가">
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
              <p className="text-sm leading-relaxed text-slate-300">
                {analysis.summaryComment || report?.summaryComment || '측정 결과를 기반으로 체형 정렬 상태를 추적하세요.'}
              </p>
            </Panel>
          </div>
        </section>
      </div>

      {/* ── A4 2페이지: 임상 진단(부위별·축회전·위험Top3·근육밸런스) ── */}
      <div className="report-a4-page mx-auto mt-4 flex w-full max-w-[794px] flex-col gap-4 rounded-2xl bg-slate-950 p-5 ring-1 ring-slate-800">
        <h2 className="text-lg font-black text-white border-b border-slate-800 pb-2">임상 해석 · 부위별 진단</h2>
        <RegionDiagnoses regions={clinical.regions} />
        <AxialRotationSection rotation={axialRotation} />
        <RiskTop3 items={clinical.riskTop3} />
        <MuscleBalanceMap muscleMap={clinical.muscleMap} />
      </div>

      {/* ── A4 3페이지: 면별 사진(스켈레톤+문제표시) ── */}
      <div className="report-a4-page mx-auto mt-4 flex w-full max-w-[794px] flex-col gap-4 rounded-2xl bg-slate-950 p-5 ring-1 ring-slate-800">
        <h2 className="text-lg font-black text-white border-b border-slate-800 pb-2">면별 촬영 (4면) · 문제 위치 표시</h2>
        <PostureSnapshotGallery snapshots={perViewSnapshots || report?.perViewSnapshots} />

        <section className={`rounded-lg border px-4 py-3 ${statusStyle.bg} ${statusStyle.border}`}>
          <p className={`text-sm font-bold ${statusStyle.text}`}>
            현재 상태: {POSTURE_STATUS_KO[analysis.status] || '주의'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            본 리포트는 BlazePose 기반 스크리닝 자료이며, 통증 또는 신경학적 증상이 있는 경우 전문 의료진 평가가 우선입니다.
          </p>
        </section>
      </div>
    </div>
  );
}

const LEVEL_STYLE = {
  normal: { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', ko: '정상' },
  caution: { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30', ko: '주의' },
  risk: { text: 'text-red-300', bg: 'bg-red-500/10', border: 'border-red-500/30', ko: '위험' },
  insufficient: { text: 'text-slate-400', bg: 'bg-slate-800/40', border: 'border-slate-700', ko: '측정 부족' },
};

function MetadataStrip({ metadata, viewsMeasured }) {
  if (!metadata) return null;
  const sexNorm = String(metadata.sex || '').trim().toLowerCase();
  const sexKo = ['m', 'male', '남', '남성'].includes(sexNorm) ? '남'
    : ['f', 'female', '여', '여성'].includes(sexNorm) ? '여'
    : '미입력';
  const views = Array.isArray(viewsMeasured) ? viewsMeasured.length : null;
  const cell = (label, value) => (
    <div className="rounded-md bg-slate-900 px-2.5 py-1.5">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="text-xs font-black text-slate-200">{value}</p>
    </div>
  );
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-black text-slate-300">측정 정보 · 영점 메타데이터</p>
        {metadata.horizontalPlaneCertified ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">✓ AI 수평 평면 변환</span>
        ) : (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">수평 보정 정보 없음</span>
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
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
                    <span key={i} className="rounded bg-slate-950/60 px-1.5 py-0.5 text-[11px] font-bold text-slate-300">
                      {m.label} {m.value}{m.unit}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs leading-relaxed text-slate-300">{r.problem}</p>
              {r.recommendation && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-sky-300">→ {r.recommendation}</p>
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
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <p className="mb-1 text-sm font-black text-white">전신 회전(축 정렬) 분석</p>
        <p className="text-xs text-slate-500">회전을 추정할 측정값이 부족합니다.</p>
      </section>
    );
  }
  const seg = rotation.segments || {};
  const confPct = Math.round((rotation.confidence || 0) * 100);
  const confColor = confPct >= 70 ? 'text-emerald-300' : confPct >= 45 ? 'text-amber-300' : 'text-red-300';
  const levelStyle = (lv) => (lv === 'marked' ? 'text-red-300' : lv === 'mild' ? 'text-amber-300' : 'text-emerald-300');

  const segRow = (label, s) => {
    if (!s) return (
      <div className="flex items-center justify-between rounded-md bg-slate-950/50 px-3 py-2">
        <span className="text-xs font-bold text-slate-300">{label}</span>
        <span className="text-xs text-slate-500">측정 부족</span>
      </div>
    );
    return (
      <div className="flex items-center justify-between rounded-md bg-slate-950/50 px-3 py-2">
        <span className="text-xs font-bold text-slate-300">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-sm font-black text-white">전신 회전(축 정렬) 분석</p>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-300">4면 종합 · 추정</span>
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
          <p className={`text-xs font-black ${rotation.axialTwist.opposing ? 'text-red-300' : 'text-amber-300'}`}>
            🔄 척추 축 비틀림 {ROTATION_LEVEL_KO[rotation.axialTwist.level]}
            {rotation.axialTwist.opposing ? ' (체간·골반 반대 방향)' : ''}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="mb-1 text-sm font-black text-white">통증·부상 위험 예측 Top 3 · 상세 피드백</p>
      <p className="mb-3 text-[11px] text-slate-500">현재 불균형을 방치할 경우 통증 발생 가능성이 높은 순서입니다. 각 항목에 원인·교정 운동·자가 점검을 함께 제공합니다. (예측 참고용)</p>
      {(!items || !items.length) ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          현재 측정값에서 두드러진 위험 부위가 없습니다. 좋은 정렬 상태를 유지하세요.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const st = LEVEL_STYLE[it.level] || LEVEL_STYLE.caution;
            return (
              <div key={it.key} className={`rounded-lg border p-3 ${st.bg} ${st.border}`}>
                <div className="flex items-center gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950/60 text-sm font-black ${st.text}`}>{it.rank}</span>
                  <p className="text-sm font-black text-white">{it.area} <span className={`text-[10px] font-bold ${st.text}`}>· {st.ko}</span></p>
                </div>

                {/* 측정 근거 */}
                {it.measured?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {it.measured.map((m, i) => (
                      <span key={i} className="rounded bg-slate-950/60 px-1.5 py-0.5 text-[11px] font-bold text-slate-300">
                        {m.label} {m.value}{m.unit}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mt-2 text-xs leading-relaxed text-slate-300"><span className="font-bold text-slate-200">위험: </span>{it.outcome}</p>
                {it.cause && <p className="mt-1 text-xs leading-relaxed text-slate-400"><span className="font-bold text-slate-300">원인: </span>{it.cause}</p>}
                {it.impact && <p className="mt-1 text-xs leading-relaxed text-slate-400"><span className="font-bold text-slate-300">방치 시: </span>{it.impact}</p>}

                {/* 교정 운동 */}
                {it.exercises?.length > 0 && (
                  <div className="mt-2 rounded-md border border-sky-500/20 bg-sky-500/5 p-2">
                    <p className="text-[11px] font-bold text-sky-300">교정 운동</p>
                    <ul className="mt-1 space-y-1">
                      {it.exercises.map((ex, i) => (
                        <li key={i} className="text-[11px] leading-relaxed text-slate-300">
                          <span className="font-bold text-slate-100">{ex.name}</span>
                          <span className="text-sky-200"> · {ex.dose}</span>
                          {ex.caution && <span className="block text-[10px] text-slate-500">주의: {ex.caution}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {it.selfCheck && <p className="mt-2 text-[11px] leading-relaxed text-emerald-200/90"><span className="font-bold">자가 점검: </span>{it.selfCheck}</p>}
                {it.timeline && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{it.timeline}</p>}
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-sm font-black text-white">근육 밸런스 맵</p>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-300">추정 · 측정값 아님</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">{note}</p>
      {empty ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          두드러진 자세 불균형이 없어 특이 근육 경향이 추정되지 않았습니다.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <p className="mb-2 text-xs font-black text-red-300">🔴 긴장·단축 (풀어주기)</p>
            <ul className="space-y-1.5">
              {tight.length ? tight.map((m, i) => (
                <li key={i} className="text-xs text-slate-300"><span className="font-bold text-white">{m.name}</span> — {m.reason}</li>
              )) : <li className="text-xs text-slate-500">해당 없음</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="mb-2 text-xs font-black text-sky-300">🔵 약화·이완 (강화하기)</p>
            <ul className="space-y-1.5">
              {weak.length ? weak.map((m, i) => (
                <li key={i} className="text-xs text-slate-300"><span className="font-bold text-white">{m.name}</span> — {m.reason}</li>
              )) : <li className="text-xs text-slate-500">해당 없음</li>}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function PostureSnapshotGallery({ snapshots }) {
  const items = Array.isArray(snapshots) ? snapshots.filter((s) => s && (s.annotatedUrl || s.snapshotUrl)) : [];
  if (!items.length) return null;
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black text-white">측정 장면 ({items.length}면)</p>
        <p className="text-xs text-slate-500">초록=스켈레톤 · 빨강/주황=문제 위치</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <SnapshotCard key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
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
    // 빨간 문제 표시(원/화살표)
    const markers = buildPostureMarkers(item.analysis, lm, item.key);
    markers.forEach((m) => {
      const c = px({ x: m.x, y: m.y });
      const color = m.severity === 'risk' ? '#ef4444' : '#f59e0b';
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2.5, canvas.width / 130);
      if (m.type === 'circle') {
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(10, canvas.width / 16), 0, Math.PI * 2); ctx.stroke();
      } else if (m.type === 'arrow') {
        const len = Math.max(20, canvas.width / 8);
        const dx = m.dir === 'left' ? -len : m.dir === 'right' ? len : 0;
        const dy = m.dir === 'up' ? -len : m.dir === 'down' ? len : 0;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + dx, c.y + dy); ctx.stroke();
      }
    });
  }, [item.landmarks, item.analysis, item.key]);

  // 주석 JPG(서버/저장본과 동일)가 있으면 그것을 그대로 표시 → 화면=저장본 일치.
  if (item.annotatedUrl) {
    return (
      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
        <div className="relative aspect-[3/4] w-full bg-black">
          <img src={item.annotatedUrl} alt={item.label} crossOrigin="anonymous"
            className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-bold text-slate-200">{item.label}</span>
          {item.analysis?.score != null && (
            <span className="text-xs font-black text-amber-300">{item.analysis.score}점</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
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
        <span className="text-xs font-bold text-slate-200">{item.label}</span>
        {item.analysis?.score != null && (
          <span className="text-xs font-black text-amber-300">{item.analysis.score}점</span>
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
    <div className={`flex min-h-[190px] flex-col items-center justify-center rounded-lg border bg-slate-900 p-4 ring-1 ${style.border} ${style.ring}`}>
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
      <p className="mt-1 text-sm font-bold text-slate-300">통합 체형 점수</p>
    </div>
  );
}

function MetricPanel({ title, value, unit, status = 'caution', children }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.caution;
  return (
    <div className={`rounded-lg border bg-slate-900 p-4 ${style.border}`}>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <p className={`mt-3 text-4xl font-black tabular-nums ${style.text}`}>
        {value}<span className="ml-1 text-base text-slate-400">{unit}</span>
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-black text-white">{title}</h2>
      {children}
    </section>
  );
}

function SmallMetric({ label, value, unit, status }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.caution;
  return (
    <div className={`rounded-md border px-3 py-2 ${style.bg} ${style.border}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black tabular-nums ${style.text}`}>
        {value}<span className="ml-1 text-xs text-slate-400">{unit}</span>
      </p>
    </div>
  );
}

function FindingRow({ finding }) {
  const style = STATUS_STYLE[finding.status] || STATUS_STYLE.caution;
  return (
    <div className={`rounded-md border px-3 py-2 ${style.bg} ${style.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-black ${style.text}`}>{finding.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{finding.message}</p>
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
  if (value > 185 || value < 175) return 'risk';
  if (value > 180 || value < 177) return 'caution';
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
    <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-black text-white">Before & After Ghosting</h2>
          <p className="text-xs text-slate-500">과거 스켈레톤은 점선, 현재 스켈레톤은 실선으로 표시됩니다.</p>
        </div>
        <div className="flex items-center gap-3 text-xs font-bold text-slate-400">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-5 border-t-2 border-dashed border-sky-300" /> Before</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-5 border-t-2 border-emerald-300" /> Today</span>
        </div>
      </div>
      <div className="relative aspect-[3/4] w-full bg-slate-950">
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
