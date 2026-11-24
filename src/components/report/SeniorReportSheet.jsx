// components/report/SeniorReportSheet.jsx
// ════════════════════════════════════════════════════════════════════════
//  시니어 기능 테스트(30초 의자 일어서기·5회 일어서기·TUG) 결과 리포트 — A4 한 장.
//   · 측정 직후와 결과리포트 화면(Report.jsx)에서 같은 모양으로 쓴다(심폐 리포트와 같은 틀).
//   · 저장된 값만 그린다. 무효·기준표 밖 값은 숨기지 않고 사유와 함께 보여준다.
//   · 값 해석 + 쉬운 설명(초등학생 수준) + 같은 테스트 직전 대비 변화 + 심박.
// ════════════════════════════════════════════════════════════════════════
import {
  UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection,
} from './UnifiedReportPrimitives';
import ReportActions from './ReportActions';
import { SENIOR_TESTS, evaluateSeniorTest, seniorChange, seniorGroupKey } from '../../ai-measure/core/seniorTests';

const SEX_LABEL = { male: '남', female: '여' };
const TONE = {
  normal: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  caution: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  unknown: 'border-slate-300 bg-slate-100/60 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
};

const fmtDate = (v) => String(v || '').slice(0, 10) || '-';

function Tile({ label, value, unit, accent = false }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-amber-500/35 bg-amber-500/10' : 'border-slate-300 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/60'}`}>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-black leading-none ${accent ? 'text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-slate-100'}`}>
        {value}{unit && <span className="ml-1 text-xs font-bold text-slate-500">{unit}</span>}
      </p>
    </div>
  );
}

// 심박 꺾은선(저장된 bpmSeries, 0=신호 없음)
function HrChart({ series = [], stepSec = 5 }) {
  const pts = series.map((v, i) => ({ v, i })).filter((p) => p.v > 0);
  if (pts.length < 2) return null;
  const W = 700; const H = 130; const padL = 30; const padR = 10; const padT = 10; const padB = 18;
  const lo = Math.floor(Math.min(...pts.map((p) => p.v)) / 10) * 10;
  const hi = Math.ceil(Math.max(...pts.map((p) => p.v)) / 10) * 10 || lo + 10;
  const n = Math.max(series.length - 1, 1);
  const x = (i) => padL + (i / n) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - padT - padB);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="심박 변화">
      <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="none" stroke="#94a3b8" strokeOpacity="0.4" />
      <path d={d} fill="none" stroke="#dc2626" strokeWidth="1.8" />
      <text x="2" y={padT + 8} fontSize="10" fill="#dc2626">{hi}</text>
      <text x="2" y={H - padB} fontSize="10" fill="#dc2626">{lo}</text>
      <text x={W - padR} y={H - 4} fontSize="10" fill="#64748b" textAnchor="end">{Math.round(n * stepSec)}초</text>
    </svg>
  );
}

export default function SeniorReportSheet({ report, member, previous = null, history = [], onMessage, showActions = true, reportNodeId = 'senior-report-sheet' }) {
  const p = report && typeof report === 'object' ? report : {};
  const meta = SENIOR_TESTS[p.testId] || null;
  const memberName = member?.name || p.member?.name || '회원';
  const subject = p.subject || {};
  // 저장된 판정을 그대로 쓰되, 없으면(구버전) 규준으로 다시 계산한다.
  const ev = p.statusLabel
    ? { status: p.status || 'unknown', label: p.statusLabel, reason: p.invalidReason, reference: p.reference, easy: p.easySummary }
    : evaluateSeniorTest(p.testId, p.value, { age: subject.age, sex: subject.sex, armsUsed: p.armsUsed, completed: p.completed });
  const sameTest = [...(history || []), previous].filter((x) => x && seniorGroupKey(x) === seniorGroupKey(p));
  const prev = previous && seniorGroupKey(previous) === seniorGroupKey(p) ? previous : sameTest[0] || null;
  const change = seniorChange(p, prev);
  const rows = (history || []).filter((x) => x && seniorGroupKey(x) === seniorGroupKey(p)).slice(0, 8);
  const hr = p.hr || null;
  const bmi = subject.weightKg && subject.heightCm ? Math.round((subject.weightKg / ((subject.heightCm / 100) ** 2)) * 10) / 10 : null;

  return (
    <div>
      <UnifiedReportCanvas>
        <UnifiedReportPage id={reportNodeId} className="mx-auto">
          <UnifiedReportHeader
            badge="SENIOR"
            title={`시니어 기능 · ${p.testLabel || meta?.label || ''}`.trim()}
            subtitle={`${memberName} · ${fmtDate(p.startedAt || p.endedAt || p.measuredAt)}`}
            score={null}
            member={member || p.member || null}
          />

          <UnifiedReportSection title="측정 결과" subtitle="판정은 나이·성별 기준표 참고" className="mb-4">
            <div className={`rounded-xl border-2 p-3 ${TONE[ev.status] || TONE.unknown}`} data-testid="senior-report-result">
              <p className="font-mono text-4xl font-black">{Number.isFinite(p.value) ? p.value : '-'}<span className="ml-1 text-base">{p.unit}</span></p>
              <p className="mt-1 text-sm font-black">{ev.label}</p>
              {ev.reference && <p className="mt-0.5 text-[11px] font-semibold">{ev.reference.text} · 출처 {ev.reference.source}</p>}
              {ev.reason && <p className="mt-0.5 text-[11px] font-bold">확인 필요: {ev.reason}</p>}
            </div>
            {change && (
              <p className="mt-2 break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300" data-testid="senior-report-change">
                직전 같은 테스트({fmtDate(prev?.startedAt || prev?.measuredAt)}) 대비 {change.diff > 0 ? '+' : ''}{change.diff}{change.unit} — {change.direction === 'improved' ? '좋아졌습니다.' : change.direction === 'worsened' ? '기록이 나빠졌습니다.' : '같은 기록입니다.'}
              </p>
            )}
            {!change && <p className="mt-2 text-[12px] font-semibold text-slate-500">같은 테스트의 이전 유효 기록이 없어 변화는 다음 측정부터 비교합니다.</p>}
          </UnifiedReportSection>

          {ev.easy && (
            <UnifiedReportSection title="쉬운 설명" subtitle="한눈에 보기" className="mb-4">
              <p className="break-keep text-[14px] font-bold leading-relaxed text-slate-700 dark:text-slate-100" data-testid="senior-report-easy">{ev.easy}</p>
            </UnifiedReportSection>
          )}

          {meta && (
            <UnifiedReportSection title="이 테스트는" subtitle="무엇을 보나" className="mb-4">
              <p className="break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300">{meta.what} {meta.read}</p>
            </UnifiedReportSection>
          )}

          {hr && (
            <UnifiedReportSection title="심박" subtitle="심박 밴드 기록" className="mb-4">
              <div className="mb-2 grid grid-cols-3 gap-2">
                <Tile label="평균 심박" value={hr.avgBpm ?? '-'} unit="bpm" />
                <Tile label="최고 심박" value={hr.maxBpm ?? '-'} unit="bpm" accent />
                <Tile label="최대심박 대비" value={hr.avgPctOfMax ?? '-'} unit="%" />
              </div>
              <HrChart series={hr.bpmSeries} stepSec={hr.seriesStepSec || 5} />
            </UnifiedReportSection>
          )}

          {rows.length > 0 && (
            <UnifiedReportSection title="같은 테스트 추이" subtitle="무효 기록 포함, 최근순" className="mb-4">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-slate-500"><th className="py-1">날짜</th><th>기록</th><th>판정</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.startedAt || i}`} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-1 font-mono">{fmtDate(r.startedAt || r.measuredAt)}</td>
                      <td className="font-mono">{Number.isFinite(r.value) ? `${r.value}${r.unit}` : '-'}</td>
                      <td>{r.statusLabel || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </UnifiedReportSection>
          )}

          <UnifiedReportSection title="대상·조건" subtitle="등록정보에서 적용" className="mb-4">
            <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
              나이 {subject.age ?? '-'}세 · 성별 {SEX_LABEL[subject.sex] || '-'} · 키 {subject.heightCm ?? '-'}cm · 체중 {subject.weightKg ?? '-'}kg{bmi ? ` (BMI ${bmi})` : ''} · 혈압 {subject.systolic ?? '-'}/{subject.diastolic ?? '-'}
              {p.auto?.used ? ' · 횟수: 카메라 자동 카운트 + 측정자 확인' : ' · 횟수: 측정자 직접 입력'}
            </p>
            {p.auto?.used && Number.isFinite(p.auto.autoValue ?? p.auto.autoCount) && (
              <p className="mt-1 text-[11px] font-semibold text-slate-500">자동 인식값 {p.auto.autoValue ?? p.auto.autoCount}{p.unit}{p.auto.offset ? ` (측정자 보정 ${p.auto.offset > 0 ? '+' : ''}${p.auto.offset})` : ''} — 측정자가 확인한 값을 기록으로 씁니다.</p>
            )}
          </UnifiedReportSection>

          {(p.trainerNote || p.precheck?.reasons?.length > 0 || p.armsUsed) && (
            <UnifiedReportSection title="확인 사항" subtitle="메모" className="mb-2">
              <div className="space-y-1.5">
                {p.armsUsed && <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">· 팔을 사용했습니다.</p>}
                {p.precheck?.reasons?.length > 0 && <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">· 측정 전 확인 사항: {p.precheck.reasons.join(', ')}</p>}
                {p.trainerNote && <p className="break-keep text-[12px] font-semibold text-slate-700 dark:text-slate-200">· 트레이너 메모: {p.trainerNote}</p>}
              </div>
            </UnifiedReportSection>
          )}

          <p className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-3 text-[10px] font-bold text-slate-600">
            몸가짐운동센터 · 시니어 기능 테스트 · 기준표는 참고용이며 진단이 아닙니다. 같은 방법으로 반복 측정했을 때의 변화 비교에 가장 의미가 있습니다.
          </p>
        </UnifiedReportPage>
      </UnifiedReportCanvas>
      {showActions && (
        <div className="mt-3 print:hidden">
          <ReportActions reportNodeId={reportNodeId} baseName={`${memberName}_시니어기능`} onMessage={onMessage} />
        </div>
      )}
    </div>
  );
}
