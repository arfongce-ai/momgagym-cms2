import React, { useMemo } from 'react';
import {
  POSTURE_STATUS_KO,
  POSE_LANDMARKS,
  analyzePostureFromLandmarks,
} from '../core/postureMath';

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

  return (
    <div className="min-h-full w-full bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4">
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

        <section className="grid gap-3 lg:grid-cols-[280px_1fr_1fr]">
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

        <section className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
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
