// ai-measure/menus/RomReport.jsx
// ROM 측정 리포트 — A4 폭. 자세별·관절별 좌우 최대 가동범위, 대칭성,
// 끝범위 안정성, 보상 작용, AI 진단 코멘트, 각도 시계열 차트를 한 장에 담는다.
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { buildProblemFocus } from '../core/crossMeasureContext';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';

const JOINT_KO = { HIP: '고관절', KNEE: '슬관절', SHOULDER: '견관절', ANKLE: '족관절' };
const POSE_KO = { STANDING: '서서(체중지지)', SUPINE: '앙와위(누워서)', PRONE: '복와위(엎드려)', SEATED: '앉아서' };
const GRADE_KO = { good: '양호', attention: '관리 필요', focus: '집중 관리', insufficient: '측정 보완' };
const GRADE_TONE = {
  good: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  attention: 'text-amber-600 bg-amber-50 border-amber-200',
  focus: 'text-red-600 bg-red-50 border-red-200',
  insufficient: 'text-slate-600 bg-slate-50 border-slate-200',
};

function fmt(v, unit = '°') {
  return v == null ? '—' : `${v}${unit}`;
}

export default function RomReport({ report }) {
  if (!report) return null;
  const { joint, poseMode, summary, diagnosis, member, recordedAt, captureMode, snapshotUrl, hasVideo, posture_context, integrated_assessment } = report;
  const s = summary || {};
  const stab = s.end_range_stability_score || {};
  const comp = s.compensation || {};
  const problemFocus = report.problem_focus || buildProblemFocus('rom', report);

  // 차트 데이터: 정제된 좌/우 각도 시계열(다운샘플 — 최대 120포인트).
  const series = (s.timeSeries || []);
  const step = Math.max(1, Math.ceil(series.length / 120));
  const chartData = series
    .filter((_, i) => i % step === 0)
    .map((d, i) => ({ t: i, 좌: d.left_angle, 우: d.right_angle }));

  return (
    <div className="mx-auto bg-white text-slate-900" style={{ width: '794px', maxWidth: '100%', padding: '28px' }}>
      {/* 헤더 */}
      <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">ROM 관절 가동범위 리포트</h1>
          <p className="mt-1 text-sm text-slate-500">
            {JOINT_KO[joint] || joint} · {POSE_KO[poseMode] || poseMode}
            {captureMode && captureMode !== 'live' ? ` · ${captureMode === 'slowmo240' ? '슬로모 240fps' : captureMode === 'slowmo120' ? '슬로모 120fps' : '업로드'}` : ' · 라이브 녹화'}
            {hasVideo ? ' · 🎥 영상 포함' : ''}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-bold">{member?.name || '회원 미선택'}</p>
          <p className="text-slate-500">{recordedAt}</p>
        </div>
      </div>

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

      <div className="mt-4">
        <ProblemFocusPanel focus={problemFocus} context={report.cross_measure_context} variant="light" />
      </div>

      {/* 자세·체형 연동 해석 */}
      {integrated_assessment && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-700">Posture x ROM</p>
              <p className="mt-0.5 text-sm font-bold text-slate-800">자세·체형 리포트 연동 해석</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-500">통합 신뢰도</p>
              <p className="text-lg font-black text-sky-700">
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
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                  <span className="mt-0.5 text-sky-600">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}
          {integrated_assessment.recommendations?.length > 0 && (
            <p className="mt-2 text-xs font-semibold leading-relaxed text-sky-800">
              권장: {integrated_assessment.recommendations[0]}
            </p>
          )}
        </div>
      )}

      {/* 핵심 수치 카드 */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <MetricCard label="좌측 최대 가동범위" value={fmt(s.left_max_rom)} sub="left max ROM" />
        <MetricCard label="우측 최대 가동범위" value={fmt(s.right_max_rom)} sub="right max ROM" />
        <MetricCard
          label="좌우 대칭성"
          value={s.symmetry_index_score == null ? '—' : `${s.symmetry_index_score}%`}
          sub="차이(작을수록 대칭)"
          tone={s.symmetry_index_score != null && s.symmetry_index_score >= 15 ? 'warn' : 'ok'}
        />
        <MetricCard label="좌 끝범위 안정성" value={stab.left == null ? '—' : `${stab.left}점`} sub="잔떨림 제어" />
        <MetricCard label="우 끝범위 안정성" value={stab.right == null ? '—' : `${stab.right}점`} sub="잔떨림 제어" />
        <MetricCard
          label="보상 작용"
          value={
            (comp.left == null && comp.right == null)
              ? '—'
              : `${comp.left ?? '—'} / ${comp.right ?? '—'}`
          }
          sub={poseMode === 'STANDING' ? (joint === 'SHOULDER' ? '체간기울기(°)' : '골반불균형(%)') : '지면지지로 통제'}
        />
      </div>

      {/* 각도 시계열 차트 */}
      {chartData.length >= 3 && (
        <div className="mt-5">
          <p className="mb-1 text-sm font-bold text-slate-700">좌/우 가동 각도 시계열 (정제·스무딩)</p>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 6, right: 12, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
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
          <p className="mb-1 text-sm font-bold text-slate-700">끝범위 캡처</p>
          <img src={snapshotUrl} alt="ROM 캡처" className="rounded-lg border border-slate-200" style={{ maxHeight: 240 }} />
        </div>
      )}

      {/* AI 진단 상세 */}
      {diagnosis?.details?.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-bold text-slate-700">AI 자동 진단</p>
          <ul className="space-y-1.5">
            {diagnosis.details.map((d, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-700">
                <span className="mt-0.5 text-amber-500">▸</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-400">
        ※ 본 수치는 BlazePose 추정 좌표 기반 참고용입니다. 정상치는 평균 성인 임상 가동범위표를 기준으로 하며,
        개인 차·측정 환경에 따라 달라질 수 있습니다. 진단·치료 목적의 의료 판단을 대체하지 않습니다.
      </p>
    </div>
  );
}

function confidenceLabel(level) {
  return level === 'high' ? '높음' : level === 'medium' ? '중간' : '주의';
}

function MetricCard({ label, value, sub, tone = 'neutral' }) {
  const toneCls =
    tone === 'warn' ? 'border-amber-200 bg-amber-50' :
    tone === 'ok' ? 'border-emerald-200 bg-emerald-50' :
    'border-slate-200 bg-slate-50';
  return (
    <div className={`rounded-xl border p-3 ${toneCls}`}>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
