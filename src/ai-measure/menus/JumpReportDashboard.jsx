import { useEffect, useMemo, useState } from 'react';
import ReportActions from '../../components/report/ReportActions';
import {
  UnifiedEmptyState,
  UnifiedReportCanvas,
  UnifiedReportHeader,
  UnifiedReportPage,
  UnifiedReportSection,
} from '../../components/report/UnifiedReportPrimitives';
import { buildProblemFocus } from '../core/crossMeasureContext';
import ProblemFocusPanel from './ProblemFocusPanel.jsx';
import MomiAutoNote from '../../components/report/MomiAutoNote.jsx';
import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';
import { aiStore } from '../../demoData';
import { JUMP_SUBTYPES, LEG_LABEL, resolveJumpSubType } from '../core/jumpTypes';
// [SLJ 좌우 비대칭 2026-08-11] 순수 계산은 core/jumpBiomechanics.js에 —
// 여기(리포트 화면)는 aiStore에서 회원의 다른 리포트를 가져와 넘기기만 한다.
import { findSljAsymmetry } from '../core/jumpBiomechanics';

const RANGE = {
  height: { good: [40, 100], warn: [30, 100], unit: 'cm' },
  knee: { good: [110, 150], warn: [90, 165], unit: '°' },
  trunk: { good: [0, 12], warn: [0, 20], unit: '°' },
  pelvis: { good: [0, 4], warn: [0, 7], unit: '%' },
  foot: { good: [85, 100], warn: [70, 100], unit: '%' },
  align: { good: [80, 100], warn: [60, 100], unit: '점' },
  // [SLJ 좌우 비대칭 2026-08-11] LSI(Limb Symmetry Index) — 스포츠의학에서
  // 흔히 쓰는 기준(예: ACL 재활 복귀 판정)을 그대로 따름: 90% 이상 정상,
  // 80~90% 주의, 80% 미만 개선 필요.
  lsi: { good: [90, 100], warn: [80, 100], unit: '%' },
};

function isRsiReport(report) {
  return report?.jumpType === 'reactive' || Boolean(report?.rsi);
}

function formatDate(value) {
  return String(value || '').slice(0, 10) || '-';
}

function metric(value, suffix = '') {
  return value == null || Number.isNaN(Number(value)) ? '-' : `${value}${suffix}`;
}

function status(value, range) {
  if (value == null || Number.isNaN(Number(value))) return { text: '미측정', color: 'text-slate-400', bar: 'bg-slate-600' };
  if (value >= range.good[0] && value <= range.good[1]) return { text: '정상', color: 'text-emerald-300', bar: 'bg-emerald-400' };
  if (value >= range.warn[0] && value <= range.warn[1]) return { text: '주의', color: 'text-amber-300', bar: 'bg-amber-400' };
  return { text: '개선 필요', color: 'text-red-300', bar: 'bg-red-400' };
}

function scoreReport(report, biomech) {
  if (report?.valid === false) return 0;
  const values = [];
  const add = (value, range) => {
    if (value == null || Number.isNaN(Number(value))) return;
    const s = status(value, range).text;
    values.push(s === '정상' ? 100 : s === '주의' ? 65 : 35);
  };
  add(report?.heightCm, RANGE.height);
  add(biomech.landingKneeAngle, RANGE.knee);
  add(biomech.trunkLeanChange, RANGE.trunk);
  add(biomech.pelvicImbalance, RANGE.pelvis);
  add(biomech.extensionAlignment?.alignmentScore, RANGE.align);
  add(biomech.footLandingSymmetry?.symmetryPct, RANGE.foot);

  if (isRsiReport(report) && report?.rsi?.rsi != null) {
    const rsi = Number(report.rsi.rsi);
    values.push(rsi >= 2 ? 100 : rsi >= 1.5 ? 80 : rsi >= 1 ? 60 : 35);
  }
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

function normalizeBiomech(report) {
  const biomech = report?.biomech || {};
  return {
    view: biomech.view || report?.videoMetrics?.detectedView || 'unknown',
    landingKneeAngle: biomech.landingKneeAngle,
    trunkLeanChange: biomech.trunkLeanChange,
    pelvicImbalance: biomech.pelvicImbalance,
    extensionAlignment: biomech.extensionAlignment || {},
    footLandingSymmetry: biomech.footLandingSymmetry || {},
  };
}

export default function JumpReportDashboard({ report, onClose, onComment, member }) {
  const [message, setMessage] = useState('');
  const [comment, setComment] = useState(report?.trainerComment || '');
  const biomech = useMemo(() => normalizeBiomech(report), [report]);
  const score = useMemo(() => scoreReport(report, biomech), [report, biomech]);
  const isRsi = isRsiReport(report);
  // [2026-08-10] 세부 종류(CMJ/SJ/DJ/SLJ/RSI) — isRsi는 엔진(파워/반응) 선택에만
  // 계속 쓰고(PowerSection/RsiSection 어느 걸 렌더할지는 그대로), 화면에 보이는
  // 이름표(reportName/reportCode/saveName)만 이 세분화된 라벨로 바꾼다.
  const jumpSubType = resolveJumpSubType(report);
  const subMeta = JUMP_SUBTYPES[jumpSubType];
  const resolvedMember = member || report?.member || null;
  const memberName = resolvedMember?.name || '가상회원';
  const date = formatDate(report?.createdAt || report?.measuredAt);
  // [SLJ 좌우 비대칭 2026-08-11] 어느 다리를 쟀는지 리포트 이름에 바로 보이게.
  const legLabel = jumpSubType === 'slj' && report?.leg ? LEG_LABEL[report.leg] : null;
  const reportName = `${subMeta.label} 평가표${legLabel ? ` · ${legLabel}` : ''}`;
  const reportCode = `${subMeta.code} JUMP`;
  const viewLabel = biomech.view === 'side' ? '측면' : biomech.view === 'back' || biomech.view === 'front' ? '정면' : '미확인';
  const saveName = `${memberName}_${subMeta.code}`;
  const problemFocus = useMemo(() => report?.problem_focus || buildProblemFocus('jump', report), [report]);

  // [SLJ 좌우 비대칭 2026-08-11] 이 회원의 반대쪽 다리 SLJ 최신 기록을 찾아
  // 비교한다. 가상회원(isVirtual)은 실제 저장된 회원 문서가 아니라 이력
  // 조회가 의미 없으므로 건너뛴다. aiStore.ensureGaitReports는 회원별
  // 지연로딩 + 캐시라 이 화면을 여러 번 여닫아도 매번 새로 안 읽는다.
  const [asymmetry, setAsymmetry] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (jumpSubType !== 'slj' || !report?.leg || report?.heightCm == null
        || !resolvedMember?.id || resolvedMember?.isVirtual) {
        setAsymmetry(null);
        return;
      }
      try {
        const reports = await aiStore.ensureGaitReports(resolvedMember.id);
        if (cancelled) return;
        setAsymmetry(findSljAsymmetry({ reports, currentReport: report }));
      } catch (e) {
        if (!cancelled) setAsymmetry(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [jumpSubType, report?.id, report?.leg, report?.heightCm, resolvedMember?.id, resolvedMember?.isVirtual]);

  const saveComment = () => {
    onComment?.(comment);
    setMessage('코멘트를 저장했습니다.');
    setTimeout(() => setMessage(''), 1600);
  };

  if (!report) {
    return <UnifiedEmptyState onClose={onClose}>리포트 데이터가 없습니다.</UnifiedEmptyState>;
  }

  return (
    <UnifiedReportCanvas className="flex flex-col items-center gap-3 font-sans">
      <div className="w-full max-w-[794px] flex items-center justify-between">
        <button onClick={onClose} className="text-slate-300 font-bold text-sm">← 닫기</button>
        {message && <span className="text-xs text-emerald-400">{message}</span>}
      </div>

      <div id="jump-report-sheet" className="w-full flex flex-col items-center gap-4">
        <ReportPage>
          <ReportHeader
            code={reportCode}
            type={isRsi ? 'RSI' : 'POWER'}
            title={memberName}
            subtitle={`${date} · ${reportName}`}
            score={score}
            invalid={report.valid === false}
            member={resolvedMember}
          />

          <ProblemFocusPanel focus={problemFocus} context={report.cross_measure_context} />
          {/* [Axis3 확장 2026-08-08] MomiAutoNote — PostureReport.jsx와 동일 패턴.
              gait_reports 컬렉션을 gait와 공유하므로 updateGaitReport를 그대로 쓴다. */}
          <MomiAutoNote kind="jump" report={report} member={resolvedMember}
            onSaved={(patch) => aiStore.updateGaitReport(resolvedMember?.id, report.id, patch)} />
          {/* [Axis4 확장 2026-08-08] MomiAutoNote와 별개로, 필요하면 트레이너가
              직접 물어보고 후속 질문까지 이어갈 수 있는 대화창. */}
          <MomiInsightPanel kind="jump" report={report} member={resolvedMember} />

          {report.valid === false ? (
            <InvalidBlock report={report} />
          ) : (
            <>
              <Section title="① 성능 및 파워" subtitle="비행시간 기반 · 핵심 지표">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatCard label="점프 높이" value={metric(report.heightCm)} unit="cm" range={RANGE.height} />
                  <StatCard label="체공 시간" value={metric(report.flightTimeMs)} unit="ms" />
                  <StatCard label="도약 속도" value={metric(report.takeoffVelocity)} unit="m/s" />
                  <StatCard label="최대 파워" value={metric(report.peakPower)} unit="W" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <SmallInfo label="측정 방향" value={`${viewLabel} 촬영`} />
                  <SmallInfo label="신체 정보" value={`${metric(report.calibHeightCm, 'cm')} · ${metric(report.bodyWeight, 'kg')}`} />
                </div>
                {report.crossCheck?.heightCrossCm != null && (
                  <Notice
                    tone={report.crossCheck.agree ? 'good' : 'bad'}
                    text={`교차검증 ${report.crossCheck.heightCrossCm}cm · ${report.crossCheck.agree ? '일치' : '불일치'} (${report.crossCheck.deltaPct}%)`}
                  />
                )}
              </Section>

              {jumpSubType === 'slj' && <AsymmetrySection asymmetry={asymmetry} report={report} />}

              {isRsi ? <RsiSection report={report} /> : <PowerSection report={report} />}
            </>
          )}
        </ReportPage>

        <ReportPage>
          <ReportHeader
            code={reportCode}
            type={isRsi ? 'RSI' : 'POWER'}
            title={memberName}
            subtitle={`${date} · 자세/대칭/해석`}
            score={score}
            invalid={report.valid === false}
            compact
            member={resolvedMember}
          />

          <Section title="② 자세 및 기술" subtitle={viewLabel === '측면' ? '측면뷰 · 활성' : '측면뷰 권장'}>
            <div className="space-y-4">
              <BarMetric label="착지 무릎 각도" value={biomech.landingKneeAngle} range={RANGE.knee} max={180} />
              <BarMetric label="상체 기울기 변화" value={biomech.trunkLeanChange} range={RANGE.trunk} max={35} />
              <BarMetric label="신전 궤적 정렬도" value={biomech.extensionAlignment?.alignmentScore} range={RANGE.align} max={100} />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              자세와 각도 지표는 측면 촬영에서 가장 정확합니다. 정면 촬영은 점프 높이와 좌우 대칭성 확인에 더 적합합니다.
            </p>
          </Section>

          <Section title="③ 대칭성 및 안정성" subtitle="정면뷰 권장 · 착지 대칭">
            <div className="space-y-4">
              <BarMetric label="골반 불균형" value={biomech.pelvicImbalance} range={RANGE.pelvis} max={12} lowerIsBetter />
              <BarMetric label="착지 대칭" value={biomech.footLandingSymmetry?.symmetryPct} range={RANGE.foot} max={100} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <SmallInfo label="좌우 차이" value={metric(biomech.footLandingSymmetry?.lateralDiffPct, '%')} />
              <SmallInfo label="앞뒤 차이" value={metric(biomech.footLandingSymmetry?.anteroposteriorDiffPct, '%')} />
            </div>
          </Section>

          <Section title="④ 평가 요약" subtitle={isRsi ? '반응 탄성 중심' : '파워 생산 중심'}>
            <SummaryNotes isRsi={isRsi} report={report} biomech={biomech} />
          </Section>

          <Section title="영상 분석의 한계">
            <ul className="list-disc pl-4 text-[11px] leading-relaxed text-slate-400 space-y-1">
              <li>좌우 체중 분산은 카메라 영상만으로 직접 측정하지 않습니다. 정확한 하중 분산은 지면반력판이 필요합니다.</li>
              <li>정면 촬영은 점프 높이와 좌우 대칭 분석에 적합하고, 측면 촬영은 자세 각도 분석에 적합합니다.</li>
              <li>모든 값은 같은 방식으로 반복 측정했을 때 상대 비교와 추세 관찰에 가장 의미가 있습니다.</li>
            </ul>
          </Section>

          {onComment && (
            <Section title="트레이너 코멘트">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="w-full h-20 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100 resize-none focus:outline-none focus:border-amber-400"
                placeholder="회원에게 전달할 코멘트를 입력하세요."
              />
              <button onClick={saveComment} className="mt-2 rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold text-white">
                코멘트 저장
              </button>
            </Section>
          )}
        </ReportPage>
      </div>

      <div className="w-full max-w-[794px] sticky bottom-0 bg-slate-950 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        <ReportActions reportNodeId="jump-report-sheet" videoBlob={report.videoBlob || null} baseName={saveName} onMessage={setMessage} />
      </div>
    </UnifiedReportCanvas>
  );
}

function ReportPage({ children }) {
  return (
    <UnifiedReportPage className="mx-auto overflow-hidden">
      {children}
    </UnifiedReportPage>
  );
}

function ReportHeader({ code, type, title, subtitle, score, invalid, compact = false, member }) {
  return (
    <UnifiedReportHeader
      eyebrow={code}
      badge={type}
      title={title}
      subtitle={subtitle}
      score={invalid ? null : score}
      status={invalid ? 'risk' : undefined}
      compact={compact}
      member={member}
    />
  );
}

function Section({ title, subtitle, children }) {
  return (
    <UnifiedReportSection title={title} subtitle={subtitle} className="mb-5">
      {children}
    </UnifiedReportSection>
  );
}

function StatCard({ label, value, unit, range }) {
  const numeric = Number(value);
  const st = range ? status(Number.isFinite(numeric) ? numeric : null, range) : null;
  const valueText = String(value ?? '-');
  const valueSize = valueText.length >= 5 ? 'text-[1.25rem]' : valueText.length >= 4 ? 'text-[1.45rem]' : 'text-[1.75rem]';
  return (
    <div className="min-w-0 rounded-xl bg-slate-800 px-2.5 py-3 text-center">
      <p className="min-h-[2rem] break-keep text-[10px] font-bold leading-tight text-slate-500 sm:text-[11px]">{label}</p>
      <p className={`mt-2 break-all font-mono ${valueSize} font-black leading-none tracking-normal tabular-nums ${st?.color || 'text-slate-100'}`}>{valueText}</p>
      <p className="mt-1 text-[11px] font-bold leading-tight text-slate-500">{unit}</p>
      {st && <p className={`mt-1 text-[10px] font-black ${st.color}`}>{st.text}</p>}
    </div>
  );
}

function SmallInfo({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-800/70 px-3 py-2">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-100">{value}</p>
    </div>
  );
}

function Notice({ tone, text }) {
  const cls = tone === 'good' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300';
  return <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-black ${cls}`}>{text}</div>;
}

// [SLJ 좌우 비대칭 2026-08-11] 반대쪽 다리 최신 기록과의 LSI 비교. 아직
// 반대쪽을 안 쟀으면(asymmetry === null) 비교 대신 "반대쪽도 재면 비교가
// 뜬다"는 안내만 보여준다 — 데이터가 없다고 섹션 자체를 숨기면 트레이너가
// "이 기능이 있는지"조차 모를 수 있어서, 항상 보여주되 상태에 맞게 안내한다.
function AsymmetrySection({ asymmetry, report }) {
  const thisLeg = report?.leg;
  const thisLabel = LEG_LABEL[thisLeg] || '이번';
  if (!asymmetry) {
    return (
      <Section title="③ 좌우 비대칭 비교" subtitle="LSI · 반대쪽 다리와 비교">
        <div className="rounded-xl bg-slate-800/60 p-4 text-center">
          <p className="text-sm text-slate-300">
            {LEG_LABEL[thisLeg === 'left' ? 'right' : 'left']} 기록이 아직 없어요.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">반대쪽 다리도 SLJ로 측정하면 좌우 비대칭(LSI)이 여기 표시됩니다.</p>
        </div>
      </Section>
    );
  }
  const st = status(asymmetry.lsiPct, RANGE.lsi);
  const weakerLabel = LEG_LABEL[asymmetry.weakerSide];
  return (
    <Section title="③ 좌우 비대칭 비교" subtitle={`LSI · ${formatDate(asymmetry.otherReportDate)} 반대쪽 기록과 비교`}>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label={LEG_LABEL.left} value={metric(asymmetry.leftValue)} unit="cm" />
        <StatCard label={LEG_LABEL.right} value={metric(asymmetry.rightValue)} unit="cm" />
        <StatCard label="대칭지수(LSI)" value={metric(asymmetry.lsiPct)} unit="%" range={RANGE.lsi} />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
        LSI(대칭지수)는 약한 쪽 ÷ 강한 쪽 × 100으로, 100%면 완전 대칭입니다. 통상 90% 이상을 정상 범위로 봅니다.
        {' '}현재 <b className="text-slate-200">{weakerLabel}</b>이(가) 상대적으로 약합니다
        {st.text === '개선 필요' ? ' — 편측 강화 운동을 우선 고려하세요.' : '.'}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        이번 {thisLabel} 측정({formatDate(report?.createdAt || report?.measuredAt)})과 반대쪽의 가장 최근 기록을 비교한 값입니다 — 같은 날 측정이 아닐 수 있습니다.
      </p>
    </Section>
  );
}

function PowerSection({ report }) {
  const relativePower = report.bodyWeight && report.peakPower ? (report.peakPower / report.bodyWeight).toFixed(1) : null;
  const heightRatio = report.calibHeightCm && report.heightCm ? ((report.heightCm / report.calibHeightCm) * 100).toFixed(1) : null;
  return (
    <Section title="파워 점프 해석" subtitle="폭발적 힘 · 최고 파워">
      <div className="grid grid-cols-3 gap-2">
        <SmallInfo label="상대 파워" value={relativePower ? `${relativePower} W/kg` : '-'} />
        <SmallInfo label="신장 대비 점프" value={heightRatio ? `${heightRatio}%` : '-'} />
        <SmallInfo label="권장 촬영" value="정면" />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
        파워 점프는 최고 점프 높이, 도약 속도, 최대 파워를 중심으로 폭발적인 힘 생산 능력을 평가합니다.
        정면 촬영에서는 좌우 착지 대칭과 점프 높이 추적이 더 안정적입니다.
      </p>
    </Section>
  );
}

function RsiSection({ report }) {
  const rsi = report.rsi || {};
  return (
    <Section title="반응 탄성 (RSI)" subtitle="체공 ÷ 접지 · 무단위">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="RSI" value={metric(rsi.rsi)} unit={rsi.grade?.label || ''} />
        <StatCard label="접지 시간" value={metric(rsi.contactTimeMs)} unit="ms" />
        <StatCard label="후속 체공" value={metric(rsi.flightTimeMs)} unit="ms" />
        <StatCard label="평균 RSI" value={metric(rsi.rsiMean)} unit={`${rsi.cycles || 0}회`} />
      </div>
      {/* [DJ 박스높이 2026-08-11] 트레이너가 record 단계에서 직접 입력했을
          때만 표시(참고용 — 카메라 측정값이 아니므로 StatCard/점수엔 안 씀). */}
      {report.boxHeightCm != null && (
        <div className="mt-3">
          <SmallInfo label="박스 높이 (트레이너 입력)" value={`${report.boxHeightCm}cm`} />
        </div>
      )}
      {Array.isArray(rsi.perCycle) && rsi.perCycle.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-slate-900/55 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-black text-emerald-300">점프별 RSI 데이터</p>
            <p className="text-[10px] font-bold text-slate-500">{rsi.perCycle.length} cycles</p>
          </div>
          <div className="space-y-1">
            {rsi.perCycle.map((cycle, index) => (
              <div key={index} className="grid grid-cols-2 gap-1 rounded-lg bg-slate-800/70 px-2 py-2 text-center sm:grid-cols-5">
                <Mini label={`#${index + 1}`} value={metric(cycle.rsi)} />
                <Mini label="접지" value={metric(cycle.contactMs, 'ms')} />
                <Mini label="체공" value={metric(cycle.flightMs, 'ms')} />
                <Mini label="높이" value={metric(cycle.heightCm, 'cm')} />
                <Mini label="RSI(높이)" value={metric(cycle.rsiHeight)} />
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        RSI는 체공시간을 접지시간으로 나눈 값입니다. 접지시간이 짧고 체공시간이 길수록 반응 탄성 효율이 높습니다.
        안정적인 평가를 위해 최소 3회 이상의 연속 점프를 기준으로 봅니다.
      </p>
    </Section>
  );
}

function Mini({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="break-keep text-[9px] font-bold leading-tight text-slate-500">{label}</p>
      <p className="break-all font-mono text-[11px] font-black leading-tight tracking-normal text-slate-100">{value}</p>
    </div>
  );
}

function BarMetric({ label, value, range, max, lowerIsBetter = false }) {
  const st = status(value, range);
  const pct = value == null ? 0 : Math.min(100, Math.max(0, (Number(value) / max) * 100));
  const display = value == null ? '-' : `${value}${range.unit}`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-300">{label}</span>
        <span className={`text-sm font-black ${st.color}`}>{display} · {lowerIsBetter && value != null ? (st.text === '정상' ? '낮음' : st.text) : st.text}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SummaryNotes({ isRsi, report, biomech }) {
  const notes = [];
  if (isRsi) {
    notes.push('RSI는 반응 속도와 탄성 사용 능력을 보는 지표입니다.');
    notes.push(`현재 RSI ${metric(report.rsi?.rsi)} · 접지 ${metric(report.rsi?.contactTimeMs, 'ms')} · 체공 ${metric(report.rsi?.flightTimeMs, 'ms')}`);
    notes.push('접지시간이 길게 나오면 발목-무릎-고관절의 빠른 반발 훈련을 우선 추천합니다.');
  } else {
    notes.push('파워 점프는 폭발적 힘과 도약 능력을 보는 지표입니다.');
    notes.push(`현재 점프 높이 ${metric(report.heightCm, 'cm')} · 최대 파워 ${metric(report.peakPower, 'W')}`);
    notes.push('점프 높이와 파워가 낮으면 하체 근력, 팔 스윙, 착지 후 재도약 패턴을 함께 확인합니다.');
  }
  if (biomech.footLandingSymmetry?.symmetryPct != null) {
    notes.push(`착지 대칭 ${biomech.footLandingSymmetry.symmetryPct}%로 좌우 착지 습관을 함께 확인합니다.`);
  }
  return (
    <ul className="list-disc pl-4 text-[12px] leading-relaxed text-slate-400 space-y-1">
      {notes.map((note, index) => <li key={index}>{note}</li>)}
    </ul>
  );
}

function InvalidBlock({ report }) {
  const reason = report.reason === 'need_more_cycles'
    ? 'RSI는 최소 3회 이상의 연속 점프가 필요합니다.'
    : report.reason === 'no_jump'
      ? '점프 동작을 감지하지 못했습니다.'
      : '측정값이 유효하지 않습니다. 카메라 각도와 기준선을 확인해주세요.';
  return (
    <Section title="측정 무효">
      <div className="rounded-xl bg-red-500/10 p-5 text-center">
        <p className="text-4xl">⚠️</p>
        <p className="mt-2 text-lg font-black text-red-300">{reason}</p>
      </div>
    </Section>
  );
}
