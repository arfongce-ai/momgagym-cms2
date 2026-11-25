// components/report/PapsReportSheet.jsx
// ════════════════════════════════════════════════════════════════════════
//  PAPS 계열 체력평가 결과 리포트 — A4 한 장. 측정 직후와 결과리포트 화면에서 같은 모양.
//  측정·평가 통합 리포트: 값 + 평가 문장(성인·학생 공통) + 초4~6 기준표 종목은 등급 + 직전 대비 변화 + 인식률·촬영 조건.
// ════════════════════════════════════════════════════════════════════════
import {
  UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection,
} from './UnifiedReportPrimitives';
import ReportActions from './ReportActions';
import { HrChart, Tile } from './SeniorReportSheet';
import { PAPS_TESTS, evaluatePapsTest, papsChange, papsEvaluationText, papsGroupKey } from '../../ai-measure/core/papsTests';

const SEX_LABEL = { male: '남', female: '여' };
const fmtDate = (v) => String(v || '').slice(0, 10) || '-';

export default function PapsReportSheet({ report, member, previous = null, history = [], onMessage, showActions = true, reportNodeId = 'paps-report-sheet' }) {
  const p = report && typeof report === 'object' ? report : {};
  const meta = PAPS_TESTS[p.testId] || null;
  const memberName = member?.name || p.member?.name || '회원';
  const subject = p.subject || {};
  const ev = p.statusLabel
    ? { label: p.statusLabel, reason: p.invalidReason, easy: p.easySummary, valid: p.valid, reference: p.reference, grade: p.grade }
    : evaluatePapsTest(p.testId, p.value, { invalid: p.invalid, subject });
  const sameKey = papsGroupKey(p);
  const rows = (history || []).filter((x) => x && papsGroupKey(x) === sameKey).slice(0, 8);
  const prev = previous && papsGroupKey(previous) === sameKey ? previous : rows[0] || null;
  const change = papsChange(p, prev);
  const evalText = papsEvaluationText({ ...p, grade: p.grade || ev.grade || null, valid: p.valid !== false, subject }, prev);
  const title = `${p.testLabel || meta?.label || ''}${p.variant === 'knee' ? ' (무릎 대고)' : ''}`;

  return (
    <div>
      <UnifiedReportCanvas>
        <UnifiedReportPage id={reportNodeId} className="mx-auto">
          <UnifiedReportHeader
            badge="PAPS"
            title={`체력평가 · ${title}`.trim()}
            subtitle={`${memberName} · ${fmtDate(p.startedAt || p.endedAt || p.measuredAt)}`}
            score={null}
            member={member || p.member || null}
          />

          <UnifiedReportSection title="측정 결과" subtitle="값과 평가 (등급은 초4~6 기준표 종목만)" className="mb-4">
            <div className="rounded-xl border-2 border-slate-300 bg-slate-100/60 p-3 text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100" data-testid="paps-report-result">
              <p className="font-mono text-4xl font-black">{Number.isFinite(p.value) ? p.value : '-'}<span className="ml-1 text-base">{p.unit}</span></p>
              <p className="mt-1 text-sm font-black">{ev.label}</p>
              {ev.reference && <p className="mt-0.5 text-[11px] font-semibold">기준 {ev.reference} (대표님 제공 등급표)</p>}
              {ev.reason && <p className="mt-0.5 text-[11px] font-bold">확인 필요: {ev.reason}</p>}
            </div>
            <p className="mt-2 break-keep text-[12px] font-bold leading-relaxed text-slate-700 dark:text-slate-100" data-testid="paps-report-eval">{evalText}</p>
            {(p.recognition || p.video || p.conditions) && (
              <p className="mt-1 break-keep text-[11px] font-semibold text-slate-500" data-testid="paps-report-capture">
                {p.recognition ? `동작 인식률 ${Math.round(p.recognition.ratio * 100)}%` : ''}
                {p.video?.recorded ? ` · 영상 ${p.video.fileName ? `저장(${p.video.fileName})` : '녹화됨'}` : ''}
                {p.conditions?.distanceCm ? ` · 선 사이 거리 ${p.conditions.distanceCm}cm` : ''}
                {p.conditions?.metronomeBpm ? ` · 메트로놈 ${p.conditions.metronomeBpm}BPM` : ''}
              </p>
            )}
            {change && (
              <p className="mt-2 break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300" data-testid="paps-report-change">
                직전 같은 테스트({fmtDate(prev?.startedAt || prev?.measuredAt)}) 대비 {change.diff > 0 ? '+' : ''}{change.diff}{change.unit} — {change.direction === 'improved' ? '좋아졌습니다.' : change.direction === 'worsened' ? '기록이 줄었습니다.' : '같은 기록입니다.'}
              </p>
            )}
            {!change && <p className="mt-2 text-[12px] font-semibold text-slate-500">같은 테스트의 이전 유효 기록이 없어 변화는 다음 측정부터 비교합니다.</p>}
          </UnifiedReportSection>

          {ev.easy && (
            <UnifiedReportSection title="쉬운 설명" subtitle="한눈에 보기" className="mb-4">
              <p className="break-keep text-[14px] font-bold leading-relaxed text-slate-700 dark:text-slate-100" data-testid="paps-report-easy">{ev.easy}</p>
            </UnifiedReportSection>
          )}

          {meta && (
            <UnifiedReportSection title="이 테스트는" subtitle="무엇을 보나" className="mb-4">
              <p className="break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300">{meta.what}</p>
            </UnifiedReportSection>
          )}

          {p.hr && (
            <UnifiedReportSection title="심박" subtitle="심박 밴드 기록" className="mb-4">
              <div className="mb-2 grid grid-cols-3 gap-2">
                <Tile label="평균 심박" value={p.hr.avgBpm ?? '-'} unit="bpm" />
                <Tile label="최고 심박" value={p.hr.maxBpm ?? '-'} unit="bpm" accent />
                <Tile label="최대심박 대비" value={p.hr.avgPctOfMax ?? '-'} unit="%" />
              </div>
              <HrChart series={p.hr.bpmSeries} stepSec={p.hr.seriesStepSec || 5} />
            </UnifiedReportSection>
          )}

          {p.trials?.length > 0 && (
            <UnifiedReportSection title="측정 상세" subtitle="가장 좋은 값을 기록으로 사용" className="mb-4">
              <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                {p.trials.map((t) => `${t.label} ${t.value ?? '-'}${p.unit}`).join(' · ')}
              </p>
            </UnifiedReportSection>
          )}

          {rows.length > 0 && (
            <UnifiedReportSection title="같은 테스트 추이" subtitle="무효 기록 포함, 최근순" className="mb-4">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-slate-500"><th className="py-1">날짜</th><th>기록</th><th>상태</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.startedAt || i}`} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-1 font-mono">{fmtDate(r.startedAt || r.measuredAt)}</td>
                      <td className="font-mono">{Number.isFinite(r.value) ? `${r.value}${r.unit}` : '-'}</td>
                      <td>{r.valid === false ? '무효' : '유효'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </UnifiedReportSection>
          )}

          <UnifiedReportSection title="대상·조건" subtitle="등록정보에서 적용" className="mb-4">
            <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
              학년 {subject.grade || '-'} · 나이 {subject.age ?? '-'}세 · 성별 {SEX_LABEL[subject.sex] || '-'} · 키 {subject.heightCm ?? '-'}cm · 체중 {subject.weightKg ?? '-'}kg
              {Number.isFinite(p.metronomeBpm) ? ` · 박자 ${p.metronomeBpm}BPM` : ''}
              {p.auto?.used ? ' · 횟수: 카메라 자동 카운트 + 측정자 확인' : ' · 횟수: 측정자 직접 입력'}
            </p>
            {p.auto?.used && Number.isFinite(p.auto.autoValue ?? p.auto.autoCount) && (
              <p className="mt-1 text-[11px] font-semibold text-slate-500">자동 인식값 {p.auto.autoValue ?? p.auto.autoCount}{p.unit}{p.auto.offset ? ` (측정자 보정 ${p.auto.offset > 0 ? '+' : ''}${p.auto.offset})` : ''} — 측정자가 확인한 값을 기록으로 씁니다.</p>
            )}
          </UnifiedReportSection>

          {p.trainerNote && (
            <UnifiedReportSection title="확인 사항" subtitle="메모" className="mb-2">
              <p className="break-keep text-[12px] font-semibold text-slate-700 dark:text-slate-200">· 트레이너 메모: {p.trainerNote}</p>
            </UnifiedReportSection>
          )}

          <p className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-3 text-[10px] font-bold text-slate-600">
            몸가짐운동센터 · PAPS 계열 체력평가 · 같은 방법으로 반복 측정했을 때의 변화 비교에 가장 의미가 있습니다. 진단이 아닙니다.
          </p>
        </UnifiedReportPage>
      </UnifiedReportCanvas>
      {showActions && (
        <div className="mt-3 print:hidden">
          <ReportActions reportNodeId={reportNodeId} baseName={`${memberName}_PAPS`} onMessage={onMessage} />
        </div>
      )}
    </div>
  );
}
