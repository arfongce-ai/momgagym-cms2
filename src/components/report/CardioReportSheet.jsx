// components/report/CardioReportSheet.jsx
// ════════════════════════════════════════════════════════════════════════
//  11번 심폐지구력(VO2max) 결과 리포트 — A4 한 장.
//   · 측정 직후(CardioTestMeasure 저장 후)와 리포트 화면(Report.jsx)에서 같은 모양으로 쓴다.
//   · 저장된 값만 그린다. 계산 못 한 값은 '계산하지 않음'과 이유를 보여준다(측정 정직성).
//   · 공통 ReportActions 로 A4 리포트 이미지(JPG) 저장을 제공한다.
// ════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import {
  UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection,
} from './UnifiedReportPrimitives';
import ReportActions from './ReportActions';
import ChangeSummaryPanel from './ChangeSummaryPanel';
import { recomputeCardioRecord, normalizeSex, cardioHistoryMetrics, curvedComparison, cardioChangeSummary, cardioContextLabel, cardioGroupHistory, rpeLabel, formatClock, formatPace } from '../../ai-measure/core/cardioTest';
import { buildSummaryData } from '../../ai-measure/core/unifiedReport';

const SEX_LABEL = { male: '남', female: '여', m: '남', f: '여' };

function fmtDate(v) {
  return String(v || '').slice(0, 10) || '-';
}

// 1초 단위 시리즈를 SVG 꺾은선으로 그린다(값 없는 구간은 끊는다).
function SeriesChart({ t = [], hr = [], w = [], workEndSec = null }) {
  const n = t.length;
  if (n < 2) return null;
  const W = 700; const H = 170; const padL = 34; const padR = 34; const padT = 10; const padB = 18;
  const tMax = t[n - 1] || n;
  const hrVals = hr.filter((v) => Number.isFinite(v));
  const wVals = w.filter((v) => Number.isFinite(v));
  const hrMin = hrVals.length ? Math.floor(Math.min(...hrVals) / 10) * 10 : 0;
  const hrMax = hrVals.length ? Math.ceil(Math.max(...hrVals) / 10) * 10 : 1;
  const wMax = wVals.length ? Math.ceil(Math.max(...wVals) / 50) * 50 : 1;
  const x = (i) => padL + ((t[i] - t[0]) / Math.max(1, tMax - t[0])) * (W - padL - padR);
  const yHr = (v) => padT + (1 - (v - hrMin) / Math.max(1, hrMax - hrMin)) * (H - padT - padB);
  const yW = (v) => padT + (1 - v / Math.max(1, wMax)) * (H - padT - padB);
  const path = (arr, yf) => {
    let d = ''; let pen = false;
    for (let i = 0; i < n; i += 1) {
      const v = arr[i];
      if (!Number.isFinite(v)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${yf(v).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  };
  const endX = workEndSec != null && workEndSec > 0 ? padL + ((workEndSec - t[0]) / Math.max(1, tMax - t[0])) * (W - padL - padR) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="심박과 와트 변화">
      <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="none" stroke="#94a3b8" strokeOpacity="0.4" />
      {endX != null && <line x1={endX} x2={endX} y1={padT} y2={H - padB} stroke="#64748b" strokeDasharray="4 3" />}
      {hrVals.length > 0 && <path d={path(hr, yHr)} fill="none" stroke="#dc2626" strokeWidth="1.8" />}
      {wVals.length > 0 && <path d={path(w, yW)} fill="none" stroke="#2563eb" strokeWidth="1.4" />}
      {hrVals.length > 0 && <text x="2" y={padT + 8} fontSize="10" fill="#dc2626">{hrMax}</text>}
      {hrVals.length > 0 && <text x="2" y={H - padB} fontSize="10" fill="#dc2626">{hrMin}</text>}
      {wVals.length > 0 && <text x={W - padR + 3} y={padT + 8} fontSize="10" fill="#2563eb">{wMax}W</text>}
      <text x={padL} y={H - 4} fontSize="10" fill="#64748b">0</text>
      <text x={W - padR} y={H - 4} fontSize="10" fill="#64748b" textAnchor="end">{formatClock(tMax)}</text>
    </svg>
  );
}

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

function RecalcPanel({ p, onRecalc }) {
  const subject = p.subject || {};
  const [sex, setSex] = useState(normalizeSex(subject.sex) || '');
  const [weight, setWeight] = useState(subject.weightKg ? String(subject.weightKg) : '');
  const [age, setAge] = useState(subject.age ? String(subject.age) : '');
  const [state, setState] = useState({ s: 'idle', msg: '' });
  const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
  const run = async () => {
    const patch = recomputeCardioRecord(p, { subject: { sex: sex || null, weightKg: Number(weight) || null, age: Number(age) || null } });
    if (!patch) { setState({ s: 'err', msg: '1초 단위 원본 기록이 없어 다시 계산할 수 없습니다.' }); return; }
    setState({ s: 'saving', msg: '' });
    try {
      await onRecalc(patch);
      const v = patch.estimates?.vo2max;
      setState({ s: 'ok', msg: v?.value ? `다시 계산했습니다 · VO2max ${v.value}` : `다시 계산했지만 VO2max는 여전히 비어 있습니다 — ${v?.reason || '조건 부족'}` });
    } catch (e) { setState({ s: 'err', msg: '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }); }
  };
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" data-testid="cardio-recalc">
      <p className="text-[12px] font-black text-amber-800 dark:text-amber-300">입력 정보 보완 후 다시 계산</p>
      <p className="mt-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">성별·체중·나이를 채우면 저장된 심박·출력 기록으로 VO2max 등을 다시 계산해 저장합니다. 원본 기록은 바뀌지 않습니다.</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="text-[10px] font-bold text-slate-500">성별
          <select value={sex} onChange={(e) => setSex(e.target.value)} className={inputCls}><option value="">선택</option><option value="male">남</option><option value="female">여</option></select>
        </label>
        <label className="text-[10px] font-bold text-slate-500">체중(kg)
          <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} className={inputCls} />
        </label>
        <label className="text-[10px] font-bold text-slate-500">나이
          <input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} className={inputCls} />
        </label>
      </div>
      <button type="button" onClick={run} disabled={state.s === 'saving'} className="mt-2 w-full rounded-lg bg-amber-500 py-2 text-sm font-black text-black disabled:opacity-60">{state.s === 'saving' ? '계산 중…' : '다시 계산해서 저장'}</button>
      {state.msg && <p className={`mt-1.5 text-[11px] font-bold ${state.s === 'err' ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{state.msg}</p>}
    </div>
  );
}

export default function CardioReportSheet({ report, member, previous = null, history = [], onMessage, showActions = true, reportNodeId = 'cardio-report-sheet', onRecalc = null }) {
  const p = report && typeof report === 'object' ? report : {};
  const memberName = member?.name || p.member?.name || '회원';
  const vo2 = p.estimates?.vo2max;
  const shownVo2 = Number.isFinite(p.confirmedVo2max) ? p.confirmedVo2max : (vo2?.calibratedValue ?? vo2?.value);
  const result = p.result || {};
  const recovery = p.recovery || {};
  const stages = Array.isArray(p.stages) ? p.stages.filter((s) => s.complete) : [];
  const tiles = cardioHistoryMetrics(p).filter((m) => m.key !== 'vo2max');
  const series = p.series || {};
  const subject = p.subject || {};
  const notes = [...(p.notes || []), vo2 && !vo2.value ? vo2.reason : null, vo2?.value ? vo2.reason : null, p.estimates?.maxPower?.reason].filter(Boolean);
  const dateText = fmtDate(p.startedAt || p.endedAt || p.measuredAt);
  const isCurved = p.basis === 'curved';
  const cmp = isCurved ? curvedComparison(p, previous) : null;
  const changeSummary = !isCurved ? cardioChangeSummary(p, previous) : null;
  // 같은 묶음(실내/필드 + 장비 + 테스트)끼리만 모은 과거 기록
  const ctxLabel = cardioContextLabel(p.machineId);
  const groupHist = cardioGroupHistory(p, [...(history || []), previous].filter(Boolean));
  const sinceFirst = groupHist.oldest ? cardioChangeSummary(p, groupHist.oldest) : null;

  return (
    <div>
      <UnifiedReportCanvas>
        <UnifiedReportPage id={reportNodeId} className="mx-auto" interpretationSummary={buildSummaryData(p, { reportType: 'cardio' })} interpretationType="cardio">
          <UnifiedReportHeader
            badge="VO2max"
            title={`심폐지구력 · ${ctxLabel} · ${p.machineLabel || ''} ${p.protocolLabel || ''}`.trim()}
            subtitle={`${memberName} · ${dateText}`}
            score={null}
            member={member || p.member || null}
          />

          {isCurved && (
            <UnifiedReportSection title="커브드 트레드밀 기록" subtitle="회차 비교" className="mb-4">
              <div className="grid grid-cols-2 gap-2">
                {p.protocolId === 'curved_2400'
                  ? <Tile label="2.4km 기록" value={formatClock(result.durationSec)} unit="" accent />
                  : <Tile label="12분 거리" value={result.distanceM ?? '-'} unit="m" accent />}
                {cmp && <Tile label={cmp.kind === 'time' ? '직전 대비 시간' : '직전 대비 거리'} value={`${cmp.diff > 0 ? '+' : cmp.diff < 0 ? '-' : ''}${cmp.kind === 'time' ? formatClock(Math.abs(cmp.diff)) : Math.abs(cmp.diff)}`} unit={cmp.kind === 'time' ? '' : 'm'} />}
              </div>
              <p className="mt-2 break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                {cmp
                  ? `${cmp.previousDate || '직전'} 기록과 같은 테스트로 비교했습니다. ${cmp.direction === 'improved' ? '좋아졌습니다.' : cmp.direction === 'worsened' ? '기록이 나빠졌습니다.' : '같은 기록입니다.'}`
                  : '이 회원의 첫 커브드 기록입니다. 다음 측정부터 변화를 비교합니다.'}
                {' '}커브드 트레드밀은 평지보다 힘들어 일반 달리기 표와 비교하지 않고, 같은 회원의 같은 테스트끼리 변화로 봅니다.
              </p>
            </UnifiedReportSection>
          )}

          {!isCurved && (
          <UnifiedReportSection title="최대산소섭취량(VO2max) 추정" subtitle="참고값" className="mb-4">
            {Number.isFinite(shownVo2) ? (
              <div className="grid grid-cols-2 gap-2">
                <Tile label={Number.isFinite(p.confirmedVo2max) ? 'VO2max (실측 확인)' : 'VO2max (추정·참고)'} value={shownVo2} unit="mL/kg/min" accent />
                {Number.isFinite(p.referenceVo2max) && <Tile label="다른 곳 실측값" value={p.referenceVo2max} unit="mL/kg/min" />}
              </div>
            ) : (
              <p className="rounded-lg border border-slate-300/60 dark:border-slate-700/60 px-3 py-2.5 text-[13px] font-semibold text-slate-600 dark:text-slate-300">
                이번 측정은 VO2max를 계산하지 않았습니다. {vo2?.reason || '조건을 채우지 못했습니다.'}
              </p>
            )}
            {p.walk6 && (
              <p className="mt-2 break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300" data-testid="cardio-report-walk6">
                6분 걷기 {p.walk6.distanceM ?? '-'}m{p.walk6.pctPredicted != null ? ` · 예측거리 ${p.walk6.predictedM}m 대비 ${p.walk6.pctPredicted}% (Enright & Sherrill 1998, 건강한 40~80세 기준)` : ` · ${p.walk6.reason}`}
              </p>
            )}
            {p.fieldRank && (
              <p className="mt-2 break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300" data-testid="cardio-report-fieldrank">
                1.5마일 {formatClock(p.fieldRank.timeSec)} · 같은 나이·성별 백분위 {p.fieldRank.band || `약 ${p.fieldRank.percentile}`} (교재 표 8.2, Cooper Institute)
              </p>
            )}
          </UnifiedReportSection>
          )}

          {!isCurved && (changeSummary
            ? <div className="mb-4"><ChangeSummaryPanel summary={changeSummary} /></div>
            : <p className="mb-4 break-keep text-[12px] font-semibold text-slate-500">이 회원의 같은 장비·같은 테스트 첫 기록입니다. 다음 측정부터 이전 대비 변화를 보여드립니다.</p>)}

          {groupHist.rows.length > 0 && (
            <UnifiedReportSection title={`${ctxLabel} · ${p.machineLabel || ''} 추이`} subtitle={`같은 장비·같은 테스트(${p.protocolLabel || ''}) 기록만 비교`} className="mb-4">
              <table className="w-full text-[12px]" data-testid="cardio-group-history">
                <thead><tr className="text-left text-slate-500"><th className="py-1">날짜</th><th>VO2max</th><th>기록</th><th>평균 심박</th><th>1분 회복</th></tr></thead>
                <tbody>
                  {groupHist.rows.map((r) => (
                    <tr key={r.date + String(r.timeSec) + String(r.distanceM)} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-1 font-mono">{r.date}</td>
                      <td className="font-mono">{r.vo2 ?? '-'}</td>
                      <td className="font-mono">{r.distanceM && !r.timeSec ? `${r.distanceM}m` : r.timeSec ? `${formatClock(r.timeSec)}${r.distanceM ? ` · ${r.distanceM}m` : ''}` : '-'}</td>
                      <td className="font-mono">{r.avgHr ?? '-'}</td>
                      <td className="font-mono">{r.drop60 ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">실내·필드, 다른 장비의 기록은 섞지 않습니다(총 {groupHist.total}회 이전 기록).</p>
              {sinceFirst && <div className="mt-2"><ChangeSummaryPanel summary={sinceFirst} /><p className="text-[11px] text-slate-500">위는 가장 처음 기록 대비 변화입니다.</p></div>}
            </UnifiedReportSection>
          )}

          {tiles.length > 0 && (
            <UnifiedReportSection title="측정 값" subtitle="핵심 지표" className="mb-4">
              <div className="grid grid-cols-3 gap-2">
                {tiles.map((m) => <Tile key={m.key} label={m.label} value={m.displayValue} unit={m.unit} />)}
                {Number.isFinite(result.avgHr) && <Tile label="평균 심박" value={result.avgHr} unit="bpm" />}
                {Number.isFinite(result.peakHr) && <Tile label="최고 심박" value={result.peakHr} unit="bpm" />}
                {Number.isFinite(result.paceSec500) && <Tile label="500m 페이스" value={formatPace(result.paceSec500)} unit="" />}
                {Number.isFinite(p.hrMax?.value) && <Tile label="최대심박 기준" value={p.hrMax.value} unit="bpm" />}
                {p.rpe?.peak != null && <Tile label={`RPE 피크${p.rpe.hasEnd ? '' : '(운동 중)'}`} value={p.rpe.peak} unit={rpeLabel(p.rpe.peak)} />}
              </div>
            </UnifiedReportSection>
          )}

          {p.rpe?.entries?.length > 0 && (
            <UnifiedReportSection title="운동 강도 체감(RPE)" subtitle="Borg 6~20 · 기록용(VO2max 계산에는 미사용)" className="mb-4">
              <p className="text-[12px] font-bold text-slate-700 dark:text-slate-200" data-testid="cardio-report-rpe">
                {p.rpe.entries.map((x) => `${x.kind === 'end' ? '끝 직후' : formatClock(x.tSec)} ${x.value}`).join(' → ')}
              </p>
              {!p.rpe.maxEffort && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">피크 RPE가 17 미만입니다. 최대 노력이 아니었다면 추정 VO2max가 실제보다 낮게 나올 수 있습니다.</p>}
            </UnifiedReportSection>
          )}

          {series.t?.length > 1 && (
            <UnifiedReportSection title="심박·와트 변화" subtitle="1초 단위 기록 (빨강 심박 · 파랑 와트)" className="mb-4">
              <SeriesChart t={series.t} hr={series.hr || []} w={series.w || []} workEndSec={result.durationSec} />
            </UnifiedReportSection>
          )}

          {stages.length > 0 && (
            <UnifiedReportSection title="단계별 기록" subtitle="각 단계 마지막 60초 평균" className="mb-4">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-slate-500"><th className="py-1">단계</th><th>평균 와트</th><th>평균 심박</th></tr></thead>
                <tbody>
                  {stages.map((s) => (
                    <tr key={s.stage} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="py-1 font-bold">{s.stage}</td>
                      <td className="font-mono">{s.avgPowerW ?? '-'} W</td>
                      <td className="font-mono">{s.avgHr ?? '-'} bpm</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </UnifiedReportSection>
          )}

          {(Number.isFinite(recovery.endHr) || Number.isFinite(recovery.drop60)) && (
            <UnifiedReportSection title="회복 심박" subtitle="운동 직후 → 1분 뒤" className="mb-4">
              <div className="grid grid-cols-3 gap-2">
                <Tile label="운동 직후" value={recovery.endHr ?? '-'} unit="bpm" />
                <Tile label="1분 뒤" value={recovery.hr60 ?? '-'} unit="bpm" />
                <Tile label="1분 회복" value={recovery.drop60 ?? '-'} unit="bpm" accent />
              </div>
            </UnifiedReportSection>
          )}

          {onRecalc && showActions && vo2 && !vo2.value && p.series?.t?.length > 0 && !(Number(subject.weightKg) > 0 && normalizeSex(subject.sex)) && (
            <RecalcPanel key={p.endedAt || p.startedAt || 'r'} p={p} onRecalc={onRecalc} />
          )}

          <UnifiedReportSection title="대상·조건" subtitle="입력 정보" className="mb-4">
            <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
              나이 {subject.age ?? '-'}세 · 성별 {SEX_LABEL[String(subject.sex || '').toLowerCase()] || '-'} · 체중 {subject.weightKg ?? '-'}kg · 심박 출처 {p.hrSource === 'band' ? '심박 밴드' : p.hrSource === 'machine' ? '장비' : p.hrSource === 'band+machine' ? '밴드+장비' : '없음'}
            </p>
          </UnifiedReportSection>

          {(notes.length > 0 || p.trainerNote) && (
            <UnifiedReportSection title="확인 사항" subtitle="메모" className="mb-2">
              <div className="space-y-1.5">
                {notes.map((text, i) => <p key={i} className="break-keep text-[12px] font-semibold text-slate-600 dark:text-slate-300">· {text}</p>)}
                {p.trainerNote && <p className="break-keep text-[12px] font-semibold text-slate-700 dark:text-slate-200">· 트레이너 메모: {p.trainerNote}</p>}
              </div>
            </UnifiedReportSection>
          )}

          <p className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-3 text-[10px] font-bold text-slate-600">
            몸가짐운동센터 · 심폐지구력 측정 결과 · 추정값은 같은 장비·같은 방법으로 반복 측정했을 때의 변화 비교에 가장 의미가 있습니다. 병원 호흡가스 검사 결과를 대신하지 않습니다.
          </p>
        </UnifiedReportPage>
      </UnifiedReportCanvas>
      {showActions && (
        <div className="mt-3 print:hidden">
          <ReportActions reportNodeId={reportNodeId} baseName={`${memberName}_심폐지구력`} onMessage={onMessage} />
        </div>
      )}
    </div>
  );
}
