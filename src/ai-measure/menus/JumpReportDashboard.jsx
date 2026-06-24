// ai-measure/menus/JumpReportDashboard.jsx
// ════════════════════════════════════════════════════════════════════════
//  점프 종합 리포트 (1장 대시보드) — GaitReportDashboard 와 동일 패턴.
//  세 카테고리: [성능·파워] [자세·기술] [대칭성·안정성]
//   · 한 노드(#jump-report-sheet)에 전부 담아 html2canvas 로 JPG 저장.
//   · 각 지표에 신뢰 등급 배지(핵심/참고/제약)를 달아 정직하게 표시.
//     - 핵심(core): 측면뷰 기준 비교적 신뢰
//     - 참고(ref):  Triple Extension 발목 등 정확도 한계
//     - 제약(limit): 좌우 '체중' 분산은 카메라로 불가 → 기하학적 대칭 추정
//
//  props:
//    report   ai 문서(점프) — JumpUploadAnalysis 가 만든 페이로드
//    onClose  () => void
//    onComment(text) => void   (선택) 트레이너 코멘트 저장
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useMemo, useRef } from 'react';
import ReportActions from '../../components/report/ReportActions';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer,
} from 'recharts';

// 정상범위 — 색/판정 공통 (반동점프 성인 일반 기준, 현장 데이터로 조정)
const RANGES = {
  height:    { good: [40, 100], warn: [30, 100], unit: 'cm', label: '점프 높이' },
  landKnee:  { good: [110, 150], warn: [90, 165], unit: '°', label: '착지 무릎각' },
  trunkChg:  { good: [0, 12], warn: [0, 20], unit: '°', label: '상체 기울기 변화' },
  pelvic:    { good: [0, 4], warn: [0, 7], unit: '%', label: '골반 불균형' },
  alignment: { good: [80, 100], warn: [60, 100], unit: '점', label: '신전 정렬도' },
  footSym:   { good: [85, 100], warn: [70, 100], unit: '%', label: '착지 대칭' },
};

const statusColor = (v, r) => {
  if (v == null || Number.isNaN(v)) return '#64748b';
  if (v >= r.good[0] && v <= r.good[1]) return '#34d399';
  if (v >= r.warn[0] && v <= r.warn[1]) return '#fbbf24';
  return '#f87171';
};
const statusText = (v, r) => {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= r.good[0] && v <= r.good[1]) return '정상';
  if (v >= r.warn[0] && v <= r.warn[1]) return '주의';
  return '이상';
};
// RSI 등급 tone → 색상(hex). reactiveJump.RSI_TUNING.grades 의 tone 과 매칭.
const rsiToneClass = (tone) => ({
  blue: '#60a5fa', emerald: '#34d399', green: '#4ade80',
  amber: '#fbbf24', red: '#f87171',
}[tone] || '#f1f5f9');

// 종합 점수 (활성 + 측정된 지표만 가점)
function computeScore(r, b) {
  const checks = [
    [r.heightCm, RANGES.height],
    [b.landingKneeAngle, RANGES.landKnee],
    [b.trunkLeanChange, RANGES.trunkChg],
    [b.pelvicImbalance, RANGES.pelvic],
    [b.extensionAlignment?.alignmentScore, RANGES.alignment],
    [b.footLandingSymmetry?.symmetryPct, RANGES.footSym],
  ];
  let score = 0, n = 0;
  for (const [v, rg] of checks) {
    if (v == null || Number.isNaN(v)) continue;
    n++;
    if (v >= rg.good[0] && v <= rg.good[1]) score += 100;
    else if (v >= rg.warn[0] && v <= rg.warn[1]) score += 65;
    else score += 30;
  }
  return n ? Math.round(score / n) : 0;
}

// 리포트 캡처/공유는 공용 유틸 사용 (gait 와 동일 경로)

export default function JumpReportDashboard({ report, onClose, onComment }) {
  const r = report || {};
  const b = useMemo(() => normalizeBiomech(report), [report]);
  const score = useMemo(() => computeScore(r, b), [r, b]);
  const [comment, setComment] = useState(r?.trainerComment || '');
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState('');
  const sheetRef = useRef(null);

  const memberName = r?.member?.name || '회원';
  const dateStr = (r?.createdAt || r?.measuredAt || '').slice(0, 10) || '—';
  const cc = r.crossCheck || {};
  const align = b.extensionAlignment || {};
  const foot = b.footLandingSymmetry || {};
  const view = b.view || 'unknown';
  const viewLabel = view === 'side' ? '측면뷰' : view === 'back' ? '정면/후면뷰' : '방향 미상';

  // 자세 레이더 (좌우 비교): 착지 무릎 좌/우 + 신전 정렬 관련
  const radarData = [
    { axis: '착지무릎 L', v: b.landingKneeLeft ?? 0 },
    { axis: '착지무릎 R', v: b.landingKneeRight ?? 0 },
    { axis: '고관절 신전', v: align.hipFinalDeg ?? 0 },
    { axis: '무릎 신전', v: align.kneeFinalDeg ?? 0 },
    { axis: '정렬 일치도', v: align.directionConsistency ?? 0 },
  ];

  const handleSaveComment = () => {
    if (typeof onComment === 'function') onComment(comment);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const invalid = r.valid !== true;

  return (
    <div className="min-h-full w-full bg-slate-950 flex flex-col items-center p-4 font-sans gap-3">
      {/* 상단: 닫기만 */}
      <div className="w-full max-w-[820px] flex items-center justify-between">
        <button onClick={onClose} className="text-slate-300 font-bold text-sm">← 닫기</button>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
      </div>

      {/* ── 캡처 대상 시트 (A4 비율) ── */}
      <div ref={sheetRef} id="jump-report-sheet"
        className="w-full max-w-[820px] bg-slate-900 rounded-2xl shadow-2xl ring-1 ring-slate-700/60 overflow-hidden flex flex-col"
        style={{ minHeight: 900 }}>

        {/* 헤더 */}
        <header className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-700/60">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-amber-400/90">JUMP ANALYSIS REPORT</p>
            <h1 className="text-xl font-black text-white leading-tight">
              {memberName} <span className="text-slate-500 text-sm font-medium">· {dateStr}</span>
            </h1>
          </div>
          <ScoreBadge score={score} invalid={invalid} />
        </header>

        {invalid ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <p className="text-4xl mb-2">⚠</p>
              <p className="text-red-400 font-black text-lg">측정 무효</p>
              <p className="text-slate-400 text-sm mt-1 max-w-sm">
                {r.reason === 'cross_mismatch' ? `두 측정 방식 차이가 큽니다(${cc.deltaPct}%). 측면에서 카메라를 골반 높이로 고정하고 제자리 수직 점프로 다시 촬영하세요.`
                  : r.reason === 'no_jump' ? '점프 동작이 감지되지 않았습니다.'
                  : r.reason === 'sanity_fail' ? '측정값이 키 대비 비현실적입니다. 카메라 각도를 확인하세요.'
                  : r.reason === 'need_more_cycles' ? '반응 점프는 연속 2회 이상 뛰어야 접지 시간을 측정할 수 있습니다. 제자리에서 빠르게 연속 점프하세요.'
                  : r.reason === 'no_valid_contact' ? '유효한 접지 구간을 찾지 못했습니다. 착지 후 곧바로 다시 뛰어 접지 시간을 짧게 유지하세요.'
                  : '다시 측정해 주세요.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-5 space-y-4">
            {/* ① 성능 및 파워 */}
            <Panel title="① 성능 및 파워" subtitle="비행시간 기반 · 핵심 지표">
              <div className="grid grid-cols-4 gap-2">
                <BigStat label="점프 높이" value={r.heightCm} unit="cm"
                  color={statusColor(r.heightCm, RANGES.height)} status={statusText(r.heightCm, RANGES.height)} badge="핵심" />
                <BigStat label="체공 시간" value={r.flightTimeMs} unit="ms" badge="핵심" />
                <BigStat label="도약 속도" value={r.takeoffVelocity} unit="m/s" badge="핵심" />
                <BigStat label="최대 파워" value={r.peakPower} unit="W"
                  note={r.peakPower == null ? '체중 입력 시' : null} badge="핵심" />
              </div>
              {/* 교차검증 신뢰도 */}
              {cc.heightCrossCm != null && (
                <div className="mt-2 flex items-center justify-between text-[11px] bg-slate-800/60 rounded-lg px-3 py-2">
                  <span className="text-slate-400">교차검증 (골반변위 {cc.heightCrossCm}cm)</span>
                  <span className={cc.agree ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {cc.agree ? `✓ 일치 (오차 ${cc.deltaPct}%)` : `✗ 불일치 (${cc.deltaPct}%)`}
                  </span>
                </div>
              )}
            </Panel>

            {/* ①-R 반응 탄성 지표 (RSI) — 반응 점프 모드에서만 */}
            {r.rsi && r.rsi.valid && (
              <Panel title="① 반응 탄성 (RSI)" subtitle="체공 ÷ 접지 · 무단위 · 핵심">
                <div className="grid grid-cols-4 gap-2">
                  <BigStat label="RSI" value={r.rsi.rsi} unit=""
                    color={rsiToneClass(r.rsi.grade?.tone)} status={r.rsi.grade?.label} badge="핵심" />
                  <BigStat label="접지 시간" value={r.rsi.contactTimeMs} unit="ms" badge="핵심" />
                  <BigStat label="후속 체공" value={r.rsi.flightTimeMs} unit="ms" badge="핵심" />
                  <BigStat label="평균 RSI" value={r.rsi.rsiMean} unit=""
                    note={`${r.rsi.cycles}회 사이클`} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="bg-slate-800/60 rounded-lg px-3 py-1.5 text-slate-400">
                    RSI(높이) {r.rsi.rsiHeight} m/s
                  </span>
                  {r.rsi.cvPct != null && (
                    <span className={`rounded-lg px-3 py-1.5 ${r.rsi.cvPct > 15 ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800/60 text-slate-400'}`}>
                      사이클 변동 {r.rsi.cvPct}%{r.rsi.cvPct > 15 ? ' · 일관성 낮음' : ''}
                    </span>
                  )}
                  {r.rsi.lowFps && (
                    <span className="rounded-lg px-3 py-1.5 bg-red-500/15 text-red-300 font-bold">
                      ⚠ 프레임레이트 낮음 — 접지시간 정확도 제한 (240fps 고속영상 권장)
                    </span>
                  )}
                </div>
                {Array.isArray(r.rsi.perCycle) && r.rsi.perCycle.length > 0 && (
                  <div className="mt-3 rounded-xl bg-slate-900/55 border border-emerald-500/20 p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-black text-emerald-300">점프별 RSI 데이터</p>
                      <p className="text-[10px] text-slate-500">{r.rsi.perCycle.length} cycles</p>
                    </div>
                    <div className="space-y-1">
                      {r.rsi.perCycle.map((c, i) => (
                        <div key={i} className="grid grid-cols-5 gap-1 rounded-lg bg-slate-800/70 px-2 py-1.5 text-center">
                          <MiniCell label={`#${i + 1}`} value={c.rsi} />
                          <MiniCell label="접지" value={`${c.contactMs}ms`} />
                          <MiniCell label="체공" value={`${c.flightMs}ms`} />
                          <MiniCell label="높이" value={`${c.heightCm}cm`} />
                          <MiniCell label="RSI(높이)" value={c.rsiHeight} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                  ※ RSI = 체공시간 ÷ 접지시간(드롭점프 표준, 무단위). 접지시간이 짧을수록
                  (탄성 효율 ↑) RSI 가 높아집니다.
                  {r.rsi.rsiBasis === 'mean'
                    ? ' 대표값은 사이클 변동이 커서 최고값 대신 평균을 사용했습니다(과대평가 방지).'
                    : r.rsi.rsiBasis === 'manual'
                    ? ' 수동 입력한 체공·접지 시간으로 계산한 단일 값입니다.'
                    : ' 대표값은 가장 반응성이 좋은 사이클(최고값) 기준입니다.'}
                  {' '}등급 기준은 일반 참고치이며 종목·연령에 따라 편차가 큽니다
                  (Haff &amp; Dumke, <i>Laboratory Manual for Exercise Physiology</i>).
                </p>
              </Panel>
            )}
            {r.rsi && !r.rsi.valid && (
              <div className="rounded-lg px-3 py-2 text-[11px] font-bold bg-amber-500/15 text-amber-300">
                RSI 측정 실패 — {r.rsi.message || '연속 2회 이상 점프해야 접지시간을 측정할 수 있습니다.'}
              </div>
            )}
            <div className={`rounded-lg px-3 py-2 text-[11px] font-bold flex items-center justify-between ${
              view === 'side' ? 'bg-cyan-500/15 text-cyan-300'
                : view === 'back' ? 'bg-violet-500/15 text-violet-300'
                : 'bg-slate-700/50 text-slate-400'}`}>
              <span>📐 {viewLabel} 촬영으로 분석됨</span>
              <span className="font-normal text-slate-400">
                {view === 'side' ? '자세·기술 지표 활성' : view === 'back' ? '골반 불균형 지표 활성' : '방향 추정 실패'}
              </span>
            </div>

            {/* ② 자세 및 기술 (측면뷰 전용) */}
            <Panel title="② 자세 및 기술" subtitle={view === 'side' ? '측면뷰 · 활성' : '측면뷰 전용 · 비활성'}>
              {view === 'side' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <GaugeRow name="착지 무릎각" value={b.landingKneeAngle} range={RANGES.landKnee} max={180} badge="핵심" />
                    <GaugeRow name="상체 기울기 변화" value={b.trunkLeanChange} range={RANGES.trunkChg} max={30} badge="핵심" />
                    {/* 신전 궤적 정렬도 (Triple Extension 대체) */}
                    <div className="bg-slate-800/60 rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-slate-300">신전 궤적 정렬도</span>
                        <span className={`text-[11px] font-black ${
                          align.quality === 'good' ? 'text-emerald-400' : align.quality === 'fair' ? 'text-amber-400' : 'text-red-400'}`}>
                          {align.available ? `${align.alignmentScore}점` : '—'}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-500 mb-1.5">고관절·무릎이 함께 펴지는 궤적 정렬</p>
                      <div className="flex gap-1.5">
                        <TeChip label="고관절 신전" deg={align.hipFinalDeg} ok={align.quality !== 'poor'} />
                        <TeChip label="무릎 신전" deg={align.kneeFinalDeg} ok={align.quality !== 'poor'} />
                        <TeChip label="발목" deg={align.ankle?.finalDeg} ok={false} ref_ />
                      </div>
                    </div>
                  </div>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} outerRadius="72%">
                        <PolarGrid stroke="#334155" />
                        <PolarAngleAxis dataKey="axis" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                        <Radar dataKey="v" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.35} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <DisabledHint text="자세·기술 지표(착지 무릎각·상체 기울기·신전 정렬도)는 측면(옆모습) 촬영에서만 정확합니다. 옆에서 다시 촬영하면 활성화됩니다." />
              )}
            </Panel>

            {/* ③ 대칭성 및 안정성 */}
            <Panel title="③ 대칭성 및 안정성" subtitle="골반=정면뷰 · 착지대칭=양뷰">
              <div className="grid grid-cols-2 gap-4">
                {/* 골반 불균형 — 정면뷰 전용 */}
                {view === 'back' ? (
                  <GaugeRow name="골반 불균형" value={b.pelvicImbalance} range={RANGES.pelvic} max={12} badge="핵심" />
                ) : (
                  <div className="flex flex-col justify-center">
                    <span className="text-[11px] font-bold text-slate-400 mb-1">골반 불균형</span>
                    <span className="text-[10px] text-slate-500">정면뷰 전용 (현재 비활성)</span>
                  </div>
                )}
                {/* 착지 발끝 대칭 — 양 뷰 가능 */}
                <GaugeRow name="착지 대칭" value={foot.available ? foot.symmetryPct : null}
                  range={RANGES.footSym} max={100} badge="대체" />
              </div>
              {foot.available && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-center">
                  <div className="bg-slate-800/60 rounded-lg py-1.5">
                    <p className="text-slate-500">좌우 차이</p>
                    <p className="font-mono font-bold text-slate-200">{foot.lateralDiffPct}%</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg py-1.5">
                    <p className="text-slate-500">앞뒤 차이</p>
                    <p className="font-mono font-bold text-slate-200">{foot.anteroposteriorDiffPct}%</p>
                  </div>
                </div>
              )}
              {foot.available && foot.leadFoot && foot.leadFoot !== 'asym' && (
                <p className="mt-2 text-[11px] text-amber-400/90 text-center">
                  ⚠ {foot.leadFoot === 'left' ? '왼발' : '오른발'}이 먼저/앞서 착지하는 경향
                </p>
              )}
            </Panel>

            {/* 영상 분석 한계 주석 (Disclaimer) */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
              <p className="text-[11px] font-black text-slate-300 mb-1.5">⚠ 영상 분석의 한계 (필독)</p>
              <ul className="text-[10px] text-slate-400 leading-relaxed space-y-1 list-disc pl-3.5">
                <li><b className="text-slate-300">좌우 체중 분산은 측정하지 않습니다.</b> 카메라로는 어느 발에 몸무게가 더 실렸는지 알 수 없어, ‘착지 발끝 대칭성’(양발 착지 위치 차이)으로 대체했습니다. 정확한 하중 분산은 지면반력판(force plate)이 필요합니다.</li>
                <li><b className="text-slate-300">자세·각도 지표는 측면(옆모습)에서만</b> 정확합니다. 정면 촬영 시 각도가 왜곡됩니다.</li>
                <li><b className="text-slate-300">발목 신전은 참고용(*)</b>입니다. BlazePose의 발끝 추정 정확도가 낮아, 신전 판정은 고관절·무릎 궤적 중심으로 봅니다.</li>
                <li>모든 값은 <b className="text-slate-300">상대 비교·추세 관찰용</b>입니다. 같은 방식으로 반복 측정해 변화를 보는 데 의미가 있습니다.</li>
              </ul>
            </div>

            {/* 트레이너 코멘트 */}
            {onComment && (
              <Panel title="트레이너 코멘트">
                <textarea value={comment} onChange={e => setComment(e.target.value)}
                  placeholder="자세 교정 포인트, 다음 목표 등을 기록하세요."
                  className="w-full h-16 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-amber-500" />
                <button onClick={handleSaveComment}
                  className="mt-2 rounded-lg bg-slate-700 text-white text-xs font-bold px-4 py-2">
                  {saved ? '✓ 저장됨' : '코멘트 저장'}
                </button>
              </Panel>
            )}
          </div>
        )}

        {/* 푸터 */}
        <footer className="px-6 py-3 border-t border-slate-700/60 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            {r.source === 'upload' ? `고속영상 분석 (${r.precision?.measuredAvgFps ?? '-'}fps)` : r.source === 'manual' ? '수동 입력' : '실시간'} · 몸가짐 CMS
          </span>
          <span className="text-[10px] text-slate-600">핵심=신뢰 · 참고=정확도 한계 · 제약=영상 추정</span>
        </footer>
      </div>

      {/* 하단 고정 액션: 리포트 저장 + (영상 있으면) 동영상 저장 */}
      <div className="w-full max-w-[820px] sticky bottom-0 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 bg-slate-950">
        <ReportActions reportNodeId="jump-report-sheet" videoBlob={report?.videoBlob || null}
          baseName={`${memberName}_점프`} onMessage={setMsg} />
      </div>
    </div>
  );
}

// 구버전/부분 데이터 폴백
function normalizeBiomech(report) {
  const b = report?.biomech || {};
  return {
    view: b.view ?? 'unknown',
    enabled: b.enabled ?? { posture: false, pelvicDrop: false, footSymmetry: false },
    landingKneeAngle: b.landingKneeAngle ?? null,
    landingKneeLeft: b.landingKneeLeft ?? null,
    landingKneeRight: b.landingKneeRight ?? null,
    trunkLeanStand: b.trunkLeanStand ?? null,
    trunkLeanChange: b.trunkLeanChange ?? null,
    extensionAlignment: b.extensionAlignment ?? { available: false },
    pelvicImbalance: b.pelvicImbalance ?? null,
    footLandingSymmetry: b.footLandingSymmetry ?? { available: false },
  };
}

// ── 하위 컴포넌트 ──
function Panel({ title, subtitle, children }) {
  return (
    <section className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-3.5">
      <div className="flex items-baseline justify-between mb-2.5">
        <h2 className="text-sm font-black text-white">{title}</h2>
        {subtitle && <span className="text-[10px] text-slate-500">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Badge({ kind }) {
  const map = {
    '핵심': 'bg-emerald-500/20 text-emerald-300',
    '참고': 'bg-amber-500/20 text-amber-300',
    '대체': 'bg-sky-500/20 text-sky-300',
    '제약': 'bg-red-500/20 text-red-300',
  };
  return <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${map[kind] || 'bg-slate-700 text-slate-400'}`}>{kind}</span>;
}

function DisabledHint({ text }) {
  return (
    <div className="flex items-center gap-2 bg-slate-800/40 rounded-lg p-3">
      <span className="text-lg">🔒</span>
      <p className="text-[11px] text-slate-400 leading-relaxed">{text}</p>
    </div>
  );
}

function BigStat({ label, value, unit, color, status, note, badge }) {
  return (
    <div className="bg-slate-800 rounded-xl py-2.5 px-2 text-center">
      <div className="flex items-center justify-center gap-1 mb-0.5">
        <p className="text-[10px] text-slate-500">{label}</p>
        {badge && <Badge kind={badge} />}
      </div>
      <p className="font-mono font-black text-2xl" style={{ color: color || '#f1f5f9' }}>
        {value != null ? value : '—'}<span className="text-xs text-slate-500"> {unit}</span>
      </p>
      {status && <p className="text-[9px] font-bold" style={{ color }}>{status}</p>}
      {note && <p className="text-[9px] text-slate-600">{note}</p>}
    </div>
  );
}

function MiniCell({ label, value }) {
  return (
    <div>
      <p className="text-[9px] text-slate-500">{label}</p>
      <p className="font-mono text-[11px] font-black text-slate-100">{value ?? '--'}</p>
    </div>
  );
}

function GaugeRow({ name, value, range, max, badge }) {
  const color = statusColor(value, range);
  const pct = value != null ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-bold text-slate-300">{name}</span>
          {badge && <Badge kind={badge} />}
        </div>
        <span className="text-[11px] font-mono font-bold" style={{ color }}>
          {value != null ? `${value}${range.unit}` : '—'} <span className="text-slate-600">{statusText(value, range)}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function TeChip({ label, ok, deg, ref_ }) {
  return (
    <div className={`flex-1 rounded-md py-1 text-center ${ok ? 'bg-emerald-500/15' : 'bg-slate-700/50'}`}>
      <p className="text-[9px] text-slate-400">{label}{ref_ && '*'}</p>
      <p className={`text-[11px] font-bold ${ok ? 'text-emerald-300' : 'text-slate-400'}`}>
        {deg != null ? `${deg}°` : '—'}
      </p>
    </div>
  );
}

function ScoreBadge({ score, invalid }) {
  if (invalid) return <span className="text-red-400 font-black text-sm">무효</span>;
  const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  return (
    <div className="text-right">
      <p className="text-[10px] text-slate-500">종합 점수</p>
      <p className="font-mono font-black text-3xl leading-none" style={{ color }}>{score}</p>
    </div>
  );
}
