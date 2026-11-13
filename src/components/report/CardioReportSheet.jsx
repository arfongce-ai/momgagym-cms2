// components/report/CardioReportSheet.jsx
// ════════════════════════════════════════════════════════════════════════
//  15번 심폐지구력(VO2max) 결과 리포트 — A4 한 장.
//   · 측정 직후(CardioTestMeasure 저장 후)와 리포트 화면(Report.jsx)에서 같은 모양으로 쓴다.
//   · 저장된 값만 그린다. 계산 못 한 값은 '계산하지 않음'과 이유를 보여준다(측정 정직성).
//   · 공통 ReportActions 로 A4 인쇄·리포트 이미지 저장을 제공한다.
// ════════════════════════════════════════════════════════════════════════
import {
  UnifiedReportCanvas, UnifiedReportHeader, UnifiedReportPage, UnifiedReportSection,
} from './UnifiedReportPrimitives';
import ReportActions from './ReportActions';
import { cardioHistoryMetrics, formatClock, formatPace } from '../../ai-measure/core/cardioTest';

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

export default function CardioReportSheet({ report, member, onMessage, showActions = true, reportNodeId = 'cardio-report-sheet' }) {
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

  return (
    <div>
      <UnifiedReportCanvas>
        <UnifiedReportPage id={reportNodeId} className="mx-auto">
          <UnifiedReportHeader
            badge="VO2max"
            title={`심폐지구력 · ${p.machineLabel || ''} ${p.protocolLabel || ''}`.trim()}
            subtitle={`${memberName} · ${dateText}`}
            score={null}
            member={member || p.member || null}
          />

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
          </UnifiedReportSection>

          {tiles.length > 0 && (
            <UnifiedReportSection title="측정 값" subtitle="핵심 지표" className="mb-4">
              <div className="grid grid-cols-3 gap-2">
                {tiles.map((m) => <Tile key={m.key} label={m.label} value={m.displayValue} unit={m.unit} />)}
                {Number.isFinite(result.avgHr) && <Tile label="평균 심박" value={result.avgHr} unit="bpm" />}
                {Number.isFinite(result.peakHr) && <Tile label="최고 심박" value={result.peakHr} unit="bpm" />}
                {Number.isFinite(result.paceSec500) && <Tile label="500m 페이스" value={formatPace(result.paceSec500)} unit="" />}
                {Number.isFinite(p.hrMax?.value) && <Tile label="최대심박 기준" value={p.hrMax.value} unit="bpm" />}
              </div>
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
