// ai-measure/menus/RomReport.jsx
// ROM 측정 리포트 — A4 폭. 자세별·관절별 좌우 최대 가동범위, 대칭성,
// 보상 작용, AI 진단 코멘트, 각도 시계열 차트를 한 장에 담는다. (끝범위 측정은 제외 — 항목 5)
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { buildProblemFocus } from '../core/crossMeasureContext';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import {
  MetricCard,
  UnifiedEmptyState,
  UnifiedReportCanvas,
  UnifiedReportHeader,
  UnifiedReportPage,
} from '../../components/report/UnifiedReportPrimitives';
import { scoreToStatus } from '../core/unifiedReport';

const JOINT_KO = { HIP: '고관절', KNEE: '슬관절', SHOULDER: '견관절', ANKLE: '족관절' };
const POSE_KO = { STANDING: '서서(체중지지)', SUPINE: '앙와위(누워서)', PRONE: '복와위(엎드려)', SEATED: '앉아서' };
const GRADE_KO = { good: '양호', attention: '관리 필요', focus: '집중 관리', insufficient: '측정 보완' };
const GRADE_TONE = {
  good: 'text-emerald-200 bg-emerald-500/10 border-emerald-500/30',
  attention: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
  focus: 'text-red-200 bg-red-500/10 border-red-500/30',
  insufficient: 'text-slate-300 bg-slate-800/60 border-slate-700',
};

function fmt(v, unit = '°') {
  return v == null ? '—' : `${v}${unit}`;
}

function gradeScore(grade) {
  if (grade === 'good') return 90;
  if (grade === 'attention') return 65;
  if (grade === 'focus') return 35;
  return null;
}

export default function RomReport({ id = 'rom-report-sheet', report }) {
  if (!report) return <UnifiedEmptyState>리포트 데이터가 없습니다.</UnifiedEmptyState>;
  const { joint, poseMode, summary, diagnosis, member, recordedAt, captureMode, snapshotUrl, hasVideo, posture_context, integrated_assessment } = report;
  const s = summary || {};
  // [항목 5] end-range 지표는 불확실하여 리포트에서 사용하지 않는다.
  const comp = s.compensation || {};
  const problemFocus = report.problem_focus || buildProblemFocus('rom', report);

  // 차트 데이터: 정제된 좌/우 각도 시계열(다운샘플 — 최대 120포인트).
  const series = (s.timeSeries || []);
  const step = Math.max(1, Math.ceil(series.length / 120));
  const chartData = series
    .filter((_, i) => i % step === 0)
    .map((d, i) => ({ t: i, 좌: d.left_angle, 우: d.right_angle }));

  return (
    <UnifiedReportCanvas>
      <UnifiedReportPage className="mx-auto" id={id}>
        <UnifiedReportHeader
          eyebrow="ROM RANGE OF MOTION REPORT"
          badge="ROM"
          title="ROM 관절 가동범위 리포트"
          subtitle={`${member?.name || '회원 미선택'} · ${recordedAt || '-'} · ${JOINT_KO[joint] || joint}${report.movement ? ` · ${report.movement}` : ''} · ${POSE_KO[poseMode] || poseMode}${captureMode === 'sensor' ? ' · 센서 각도기' : captureMode && captureMode !== 'live' ? ` · ${captureMode === 'slowmo240' ? '슬로모 240fps' : captureMode === 'slowmo120' ? '슬로모 120fps' : '업로드'}` : ' · 라이브 녹화'}${hasVideo ? ' · 영상 포함' : ''}`}
          score={gradeScore(diagnosis?.grade)}
          compact
          member={member}
        />

      {/* 종합 등급 + 헤드라인 */}
      {diagnosis && (
        <div className={`mt-4 rounded-xl border px-4 py-3 ${GRADE_TONE[diagnosis.grade] || GRADE_TONE.insufficient}`}>
          <div className="flex items-center gap-2">
            <span className="rounded-full border px-2.5 py-0.5 text-xs font-black">
              {GRADE_KO[diagnosis.grade] || diagnosis.grade}
            </span>
            <p className="text-sm font-bold">{diagnosis.headline}</p>
          </div>
        </div>
      )}

      {/* 센서 측정 출처 표시 — 카메라 추정치와 구분(측정 정직성) */}
      {report.measureType === 'sensor_goniometer' && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5">
          <p className="text-xs font-bold text-emerald-200">
            📐 고니오메타 — 폰 밀착 기울기 센서 · 하드웨어 측정값 (신뢰도 {report.confidenceScore ?? 1.0})
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-300/70">
            0점(시작 자세) 대비 최대 이동각. 골반·체간 보상 작용은 센서로 판별하지 않습니다.
          </p>
        </div>
      )}

      <div className="mt-4">
        <ProblemFocusPanel focus={problemFocus} context={report.cross_measure_context} />
      </div>

      {/* 자세·체형 연동 해석 */}
      {integrated_assessment && (
        <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-300">Posture x ROM</p>
              <p className="mt-0.5 text-sm font-bold text-slate-100">자세·체형 리포트 연동 해석</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-500">통합 신뢰도</p>
              <p className="text-lg font-black text-sky-300">
                {integrated_assessment.confidenceScore}점
                <span className="ml-1 text-xs text-slate-500">({confidenceLabel(integrated_assessment.confidenceLevel)})</span>
              </p>
            </div>
          </div>
          {posture_context?.sourceReportId && (
            <p className="mt-2 text-[11px] font-semibold text-slate-500">
              연결된 자세 리포트: {posture_context.sourceReportId}
            </p>
          )}
          {integrated_assessment.notes?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {integrated_assessment.notes.map((note, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-300">
                  <span className="mt-0.5 text-sky-300">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}
          {integrated_assessment.recommendations?.length > 0 && (
            <p className="mt-2 text-xs font-semibold leading-relaxed text-sky-200">
              권장: {integrated_assessment.recommendations[0]}
            </p>
          )}
        </div>
      )}

      {/* 핵심 수치 카드 — 다른 리포트와 동일한 공용 MetricCard로 통일 */}
      {(report.measureType === 'sensor_goniometer' || (s.right_max_rom == null && s.max_rom != null)) ? (
        // 단일 측정(고니오메타): 좌/우 구분 없이 가동범위 한 장.
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard metric={{ key:'rom', label:'가동범위', displayValue: fmt(s.max_rom ?? s.left_max_rom), description:'max ROM' }} />
          <MetricCard metric={{
            key:'comp', label:'보상 작용',
            displayValue: (comp.left == null && comp.right == null) ? '—' : `${comp.left ?? '—'} / ${comp.right ?? '—'}`,
            description: poseMode === 'STANDING' ? (joint === 'SHOULDER' ? '체간기울기(°)' : '골반불균형(%)') : '지면지지로 통제',
          }} />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard metric={{ key:'left', label:'좌측 최대 가동범위', displayValue: fmt(s.left_max_rom), description:'left max ROM' }} />
          <MetricCard metric={{ key:'right', label:'우측 최대 가동범위', displayValue: fmt(s.right_max_rom), description:'right max ROM' }} />
          <MetricCard metric={{
            key:'symmetry', label:'좌우 대칭성',
            displayValue: s.symmetry_index_score == null ? '—' : `${s.symmetry_index_score}%`,
            description:'차이(작을수록 대칭)',
            status: s.symmetry_index_score == null ? undefined
              : scoreToStatus(s.symmetry_index_score >= 15 ? 65 : 90),
          }} />
          <MetricCard metric={{
            key:'comp', label:'보상 작용',
            displayValue: (comp.left == null && comp.right == null) ? '—' : `${comp.left ?? '—'} / ${comp.right ?? '—'}`,
            description: poseMode === 'STANDING' ? (joint === 'SHOULDER' ? '체간기울기(°)' : '골반불균형(%)') : '지면지지로 통제',
          }} />
        </div>
      )}

      {/* [보상 프로파일] 3축 보상 패턴 — 숫자 + 방향 시각화 (카메라 측정 전용) */}
      <CompensationProfilePanel profile={s.compensation_profile} poseMode={poseMode} />

      {/* 각도 시계열 차트 */}
      {chartData.length >= 3 && (
        <div className="mt-5">
          <p className="mb-1 text-sm font-bold text-slate-300">좌/우 가동 각도 시계열 (정제·스무딩)</p>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 6, right: 12, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="좌" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="우" stroke="#f59e0b" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 스냅샷 (있으면) */}
      {snapshotUrl && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-bold text-slate-300">측정 캡처</p>
          <img src={snapshotUrl} alt="ROM 캡처" className="rounded-lg border border-slate-700" style={{ maxHeight: 240 }} />
        </div>
      )}

      {/* AI 진단 상세 */}
      {diagnosis?.details?.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-bold text-slate-300">AI 자동 진단</p>
          <ul className="space-y-1.5">
            {diagnosis.details.map((d, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300">
                <span className="mt-0.5 text-amber-500">▸</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 border-t border-slate-700 pt-2 text-[11px] leading-relaxed text-slate-400">
        ※ 본 수치는 BlazePose 추정 좌표 기반 참고용입니다. 정상치는 평균 성인 임상 가동범위표를 기준으로 하며,
        개인 차·측정 환경에 따라 달라질 수 있습니다. 진단·치료 목적의 의료 판단을 대체하지 않습니다.
      </p>
      </UnifiedReportPage>
    </UnifiedReportCanvas>
  );
}

function confidenceLabel(level) {
  return level === 'high' ? '높음' : level === 'medium' ? '중간' : '주의';
}

// ── [보상 프로파일] 3축 보상 패턴 패널 — 숫자 + 방향 시각화 ──
//  · 체간 기울기: 사람 축(막대)이 실제 이탈 각도만큼 기울어져 방향을 보여준다.
//  · 회전(비틀기): 회전 아이콘 + 측정면 이탈 %.
//  · 골반 하강: STANDING 전용, 하강 방향 화살표 + %.
//  값이 null 인 축은 '기준선 부족'으로 표시(측정 정직성 — 추측한 값을 그리지 않음).
function CompensationProfilePanel({ profile, poseMode }) {
  if (!profile) return null; // 센서 측정 등 프로파일 없는 리포트는 패널 생략
  const lean = profile.lean_max_dev_deg;
  const leanSigned = profile.lean_dev_signed_deg;
  const rot = profile.rotation_max_pct;
  const pelvic = profile.pelvic_drop_pct;

  const toneOf = (v, warn, severe) =>
    v == null ? 'text-slate-500' : v >= severe ? 'text-red-300' : v >= warn ? 'text-amber-300' : 'text-emerald-300';
  const badgeOf = (v, warn, severe) =>
    v == null ? '기준선 부족' : v >= severe ? '큼' : v >= warn ? '주의' : '양호';

  // 기울기 방향 시각화: 몸통 막대를 부호 방향으로 기울여 그린다(표시각은 ±30° 캡).
  const tiltDeg = leanSigned == null ? 0 : Math.max(-30, Math.min(30, leanSigned));

  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <p className="mb-2 text-sm font-bold text-slate-300">보상 패턴 (시작 자세 기준)</p>
      <div className="grid grid-cols-3 gap-2">
        {/* 축 1: 체간 기울기 */}
        <div className="rounded-lg bg-slate-800/70 p-2.5 text-center">
          <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9">
            <line x1="20" y1="36" x2="20" y2="30" stroke="#475569" strokeWidth="2" />
            <g transform={`rotate(${tiltDeg} 20 30)`}>
              <line x1="20" y1="30" x2="20" y2="8" stroke={lean != null && lean >= 8 ? '#fbbf24' : '#34d399'} strokeWidth="3" strokeLinecap="round" />
              <circle cx="20" cy="6" r="3.5" fill={lean != null && lean >= 8 ? '#fbbf24' : '#34d399'} />
            </g>
          </svg>
          <p className={`mt-1 text-lg font-black tabular-nums ${toneOf(lean, 8, 15)}`}>{lean == null ? '—' : `${lean}°`}</p>
          <p className="text-[10px] font-bold text-slate-400">체간 기울기 · {badgeOf(lean, 8, 15)}</p>
        </div>
        {/* 축 2: 회전(비틀기) */}
        <div className="rounded-lg bg-slate-800/70 p-2.5 text-center">
          <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9">
            <path d="M 10 20 A 10 10 0 1 1 20 30" fill="none"
              stroke={rot != null && rot >= 12 ? '#fbbf24' : '#34d399'} strokeWidth="3" strokeLinecap="round" />
            <path d="M 16 30 L 22 30 L 19 35 Z" fill={rot != null && rot >= 12 ? '#fbbf24' : '#34d399'} />
          </svg>
          <p className={`mt-1 text-lg font-black tabular-nums ${toneOf(rot, 12, 25)}`}>{rot == null ? '—' : `${rot}%`}</p>
          <p className="text-[10px] font-bold text-slate-400">회전·비틀기 · {badgeOf(rot, 12, 25)}</p>
        </div>
        {/* 축 3: 골반 하강 (STANDING 전용) */}
        <div className="rounded-lg bg-slate-800/70 p-2.5 text-center">
          {poseMode === 'STANDING' ? (
            <>
              <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9">
                <line x1="8" y1="18" x2="32" y2={pelvic != null && Math.abs(pelvic) >= 8 ? 24 : 19}
                  stroke={pelvic != null && Math.abs(pelvic) >= 8 ? '#fbbf24' : '#34d399'} strokeWidth="3" strokeLinecap="round" />
                <circle cx="8" cy="18" r="3" fill="#94a3b8" />
                <circle cx="32" cy={pelvic != null && Math.abs(pelvic) >= 8 ? 24 : 19} r="3" fill="#94a3b8" />
              </svg>
              <p className={`mt-1 text-lg font-black tabular-nums ${toneOf(pelvic == null ? null : Math.abs(pelvic), 8, 15)}`}>
                {pelvic == null ? '—' : `${pelvic}%`}
              </p>
              <p className="text-[10px] font-bold text-slate-400">골반 하강 · {badgeOf(pelvic == null ? null : Math.abs(pelvic), 8, 15)}</p>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-2">
              <p className="text-lg font-black text-slate-600">—</p>
              <p className="text-[10px] font-bold text-slate-500">골반 하강 · 선 자세 전용</p>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        기울기=몸통이 시작 자세에서 기운 최대 각도 · 회전=측정면 이탈(몸통높이 대비 %, 단안 카메라 특성상 각도 아님) · 임계 초과 시 AI 진단에 재측정 권고가 표시됩니다.
      </p>
    </div>
  );
}


