// [측정 결과시트 공용화 2026-11-15]
// 모든 측정 리포트 상단에 붙이는 "한눈에 보기" 영역 (motiphysio·exbody 결과지 구성 참고).
//  점수 3구간 막대 · 먼저 볼 것 · 항목별 눈금 카드 · 기준 없는 기록(지난번 대비만)
// 계산은 core/quickResultSheet.js(= extractKeyMetrics 단일 소스)에서만 한다.
import React, { useMemo, useState, useCallback } from 'react';
import { buildQuickItems, pickTopItems, markerPct, buildMissingItems, resolveReportQuality } from '../../ai-measure/core/quickResultSheet';
import { QUALITY_KO } from '../../ai-measure/core/captureQuality';

const LV = {
  normal: { ko: '정상', text: 'text-emerald-700 dark:text-emerald-300', chip: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200', fill: '#10b981', seg: 1 },
  caution: { ko: '주의', text: 'text-amber-700 dark:text-amber-300', chip: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200', fill: '#f59e0b', seg: 2 },
  risk: { ko: '위험', text: 'text-red-700 dark:text-red-300', chip: 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200', fill: '#ef4444', seg: 3 },
};

// 카드 아래 보조 표시(예: 자세체형의 풀기/강화 근육)
const CHIP_TONE = {
  tight: 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200',
  weak: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  info: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

function fmt(v) {
  if (v == null || !Number.isFinite(v)) return '-';
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString();
}

function Segments({ level }) {
  const st = LV[level];
  return (
    <span className="flex shrink-0 gap-0.5" aria-label={st?.ko || '판정 없음'}>
      {[1, 2, 3].map((i) => (
        <span key={i} className="block h-1.5 w-4 rounded-sm" style={{ background: st && i <= st.seg ? st.fill : 'rgba(148,163,184,0.35)' }} />
      ))}
    </span>
  );
}

function ScoreBar({ score }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const level = s >= 80 ? 'normal' : s >= 60 ? 'caution' : 'risk';
  const st = LV[level];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-900 dark:text-white">종합 점수</p>
        <p className={`text-3xl font-black tabular-nums ${st.text}`}>
          {Math.round(s)}<span className="ml-1 text-xs text-slate-500">/100</span>
          <span className={`ml-2 rounded-md px-2 py-0.5 align-middle text-[11px] font-bold ${st.chip}`}>{st.ko}</span>
        </p>
      </div>
      <div className="relative mt-4 flex h-2.5 gap-0.5">
        <span className="h-full rounded-l-sm" style={{ width: '60%', background: LV.risk.fill }} />
        <span className="h-full" style={{ width: '20%', background: LV.caution.fill }} />
        <span className="h-full rounded-r-sm" style={{ width: '20%', background: LV.normal.fill }} />
        <span className="absolute -top-1.5 h-5 w-1 rounded bg-slate-900 dark:bg-white" style={{ left: `calc(${s}% - 2px)` }} />
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-slate-500">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: '60%' }}>60</span>
        <span className="absolute -translate-x-1/2" style={{ left: '80%' }}>80</span>
        <span className="absolute right-0">100</span>
      </div>
    </div>
  );
}

function TopList({ top, onPick }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-black text-slate-900 dark:text-white">먼저 볼 것</p>
        {top.length > 0 && <span className="text-[10px] text-slate-500">누르면 상세로 이동</span>}
      </div>
      {!top.length ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">주의·위험 범위 항목이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {top.map((it) => (
            <li key={it.key}>
              <button type="button" onClick={() => onPick(it.key)} className="flex w-full items-center gap-3 py-2.5 text-left">
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-black ${LV[it.level].chip}`}>{String(it.rank).padStart(2, '0')}</span>
                <span className="flex-1">
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">{it.label}</span>
                  <span className="block text-[11px] text-slate-500">{it.display}{it.unit}</span>
                </span>
                <Segments level={it.level} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ZoneBar({ item }) {
  const { scale } = item;
  const pos = markerPct(item.value, scale);
  const span = scale.max - scale.min;
  const pct = (v) => ((v - scale.min) / span) * 100;
  return (
    <div>
      <div className="relative mt-3 flex h-2 gap-0.5">
        {scale.zones.map((z, i) => (
          <span key={i} className={`h-full ${i === 0 ? 'rounded-l-sm' : ''} ${i === scale.zones.length - 1 ? 'rounded-r-sm' : ''}`}
            style={{ width: `${((z.to - z.from) / span) * 100}%`, background: LV[z.level].fill }} />
        ))}
        {pos != null && <span className="absolute -top-1.5 h-5 w-1 rounded bg-slate-900 dark:bg-white" style={{ left: `calc(${pos}% - 2px)` }} />}
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-slate-500">
        {scale.ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${Math.min(97, Math.max(3, pct(t)))}%` }}>{fmt(t)}</span>
        ))}
      </div>
    </div>
  );
}

function ChangeLine({ item }) {
  if (item.previous == null) return null;
  const tone = item.improved === true ? 'text-emerald-700 dark:text-emerald-300'
    : item.improved === false ? 'text-red-700 dark:text-red-300' : 'text-slate-500';
  const word = item.improved === true ? '좋아짐' : item.improved === false ? '나빠짐' : (item.delta > 0 ? '늘어남' : '줄어듦');
  return (
    <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
      지난번 {fmt(item.previous)}{item.unit} → 이번 {fmt(item.value)}{item.unit}
      {item.delta !== 0 && item.delta != null && (
        <span className={`ml-1 font-bold ${tone}`}>({fmt(Math.abs(item.delta))}{item.unit} {word})</span>
      )}
    </p>
  );
}

function JudgedCard({ item, active, anchorPrefix }) {
  const st = LV[item.level];
  return (
    <div id={`${anchorPrefix}-${item.key}`}
      className={`scroll-mt-4 rounded-xl border bg-white p-3.5 dark:bg-slate-900 ${active ? 'border-sky-500 ring-2 ring-sky-500/30' : 'border-slate-200 dark:border-slate-800'}`}>
      {/* 값이 길어도(예: 138 / 93 mmHg) 제목이 한 글자씩 꺾이지 않게: 좁으면 값이 아래줄로 내려간다 */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-[8rem] flex-1 break-keep">
          <p className="text-sm font-black text-slate-900 dark:text-white">
            {item.label}
            {item.tag && <span className="ml-1.5 text-[10px] font-bold text-slate-500">{item.tag}</span>}
          </p>
          {item.description && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.description}</p>}
        </div>
        <div className="ml-auto shrink-0 whitespace-nowrap text-right">
          <p className={`text-xl font-black tabular-nums ${st.text}`}>{item.display}<span className="ml-0.5 text-xs">{item.unit}</span></p>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${st.chip}`}>{st.ko}</span>
        </div>
      </div>
      {item.scale ? <ZoneBar item={item} /> : <div className="mt-3"><Segments level={item.level} /></div>}
      {Array.isArray(item.chips) && item.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.chips.map((c) => (
            <span key={`${c.tone}-${c.text}`} className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${CHIP_TONE[c.tone] || CHIP_TONE.info}`}>{c.text}</span>
          ))}
        </div>
      )}
      <ChangeLine item={item} />
    </div>
  );
}

function RecordTile({ item }) {
  const arrow = item.dir === 'higher' ? '높을수록 좋음' : item.dir === 'lower' ? '낮을수록 좋음' : '';
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{item.label}</p>
      <p className="mt-1 text-lg font-black tabular-nums text-slate-900 dark:text-white">{item.display}<span className="ml-0.5 text-xs text-slate-500">{item.unit}</span></p>
      {arrow && <p className="text-[10px] text-slate-500">{arrow}</p>}
      <ChangeLine item={item} />
    </div>
  );
}

const QUALITY_TONE = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  fair: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
  poor: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
};

// [측정 품질 2026-11-16] 값이 틀어졌을 때 촬영 문제인지 바로 보이게 맨 위에 표시
function QualityBanner({ quality }) {
  if (!quality) return null;
  return (
    <div className={`rounded-xl border px-4 py-2.5 ${QUALITY_TONE[quality.grade] || QUALITY_TONE.fair}`} data-testid="report-quality">
      <p className="text-sm font-black">
        측정 품질 {QUALITY_KO[quality.grade]} <span className="text-xs font-bold opacity-80">({quality.score}점)</span>
        {quality.grade === 'poor' && <span className="ml-1 text-xs font-bold">· 촬영 조건이 나빠 오차가 클 수 있어 다시 측정을 권장합니다</span>}
      </p>
      {quality.reasons?.length > 0 && (
        <p className="mt-0.5 text-[11px] leading-snug opacity-90">{quality.reasons.slice(0, 3).join(' · ')}</p>
      )}
    </div>
  );
}

// [측정 사진 2026-11-23] 저장 시 남긴 작은 사진(시작·중간) — 전·후 비교 때 같은 자세·위치인지 확인용
export function resolveSnapshots(report) {
  const s = report?.snapshots || report?.data?.snapshots;
  return Array.isArray(s) ? s.filter((x) => x && typeof x.dataUrl === 'string' && x.dataUrl.startsWith('data:image/')) : [];
}
function deviceKeyOfReport(r) {
  return r?.capture?.deviceKey || r?.data?.capture?.deviceKey || null;
}
/** 전/후 측정 기기가 같으면 true, 다르면 false, 한쪽이라도 기록이 없으면 null(모름). */
export function sameCaptureDevice(report, previousReport) {
  const a = deviceKeyOfReport(report); const b = deviceKeyOfReport(previousReport);
  if (!a || !b) return null;
  return a === b;
}
// 결과리포트는 영상 비교보다 사진(썸네일) 비교를 기본으로 한다(2026-11-25).
// 촬영 기기가 같으면 직전 기록의 사진을 자동으로 불러와 나란히 놓는다. 기기가 다르거나 모르면 현재 사진만 보여준다.
function SnapshotStrip({ snapshots, previousSnapshots = [], sameDevice = null }) {
  if (!snapshots.length) return null;
  const compare = sameDevice === true && previousSnapshots.length > 0;
  const row = (list, title) => (
    <div className="flex items-start gap-2">
      <span className="w-8 shrink-0 pt-1 text-[10px] font-black text-slate-500">{title}</span>
      {list.map((sn, i) => (
        <figure key={i} className="m-0 flex-1 max-w-[160px]">
          <img src={sn.dataUrl} alt={`${title} 측정 사진 ${sn.label || i + 1}`} className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
          <figcaption className="mt-0.5 text-center text-[10px] text-slate-500">{sn.label || `사진 ${i + 1}`}</figcaption>
        </figure>
      ))}
    </div>
  );
  if (compare) {
    return (
      <div className="flex flex-col gap-2" data-testid="report-snapshots">
        <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">전/후 사진 비교 <span className="font-normal text-slate-500">(같은 기기로 촬영)</span></p>
        {row(previousSnapshots, '이전')}
        {row(snapshots, '현재')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid="report-snapshots">
      {row(snapshots, '현재')}
      {sameDevice === false && previousSnapshots.length > 0 && (
        <p className="text-[10px] text-slate-500">이전 측정과 촬영 기기가 달라 자동 비교는 하지 않았습니다.</p>
      )}
    </div>
  );
}

// [빠진 항목 2026-11-16] 계산 안 된 핵심 항목을 숨기지 않고 이유와 함께 보여준다
function MissingList({ missing }) {
  if (!missing?.length) return null;
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="missing-items">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-black text-slate-900 dark:text-white">계산 안 된 항목</p>
        <span className="text-[10px] text-slate-500">다시 찍을 때 참고</span>
      </div>
      <ul className="space-y-1.5">
        {missing.map((m) => (
          <li key={m.key} className="text-xs leading-snug">
            <span className="font-bold text-slate-800 dark:text-slate-100">{m.label}</span>
            <span className="text-slate-500"> — {m.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.report        리포트 원본
 * @param {string} [props.reportType]  inferReportType 결과를 덮어쓸 때
 * @param {number|null} [props.score]  헤더와 같은 점수(없으면 점수 막대 생략)
 * @param {object} [props.previousReport]
 * @param {Array}  [props.metrics]     extractKeyMetrics 대신 쓸 지표(같은 모양)
 * @param {Array}  [props.items]       이미 만든 항목(buildQuickItems 결과와 같은 모양 — 자세체형처럼 전용 계산이 있을 때)
 * @param {node}   [props.before]      점수 막대 위에 넣을 영역(예: 스켈레톤 시트)
 * @param {node}   [props.after]       맨 아래에 넣을 영역(예: 근육 해부도)
 */
export default function QuickResultSheet({
  report, reportType, score = null, previousReport = null, metrics = null,
  items: givenItems = null, before = null, after = null, anchorPrefix = 'quick-item',
  missing: givenMissing = null, quality: givenQuality, showQuality = true,
}) {
  const items = useMemo(
    () => givenItems || buildQuickItems(report, { reportType, previousReport, metrics }),
    [givenItems, report, reportType, previousReport, metrics],
  );
  const missing = useMemo(
    () => givenMissing || (givenItems ? [] : buildMissingItems(report, { reportType, presentKeys: items.map((i) => i.key) })),
    [givenMissing, givenItems, report, reportType, items],
  );
  const quality = useMemo(
    () => (!showQuality ? null : givenQuality !== undefined ? givenQuality : resolveReportQuality(report)),
    [showQuality, givenQuality, report],
  );
  const judged = items.filter((it) => it.level);
  const records = items.filter((it) => !it.level && it.value != null);
  const top = useMemo(() => pickTopItems(items), [items]);
  const [activeKey, setActiveKey] = useState(null);
  const onPick = useCallback((key) => {
    setActiveKey(key);
    if (typeof document !== 'undefined') {
      document.getElementById(`${anchorPrefix}-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [anchorPrefix]);

  const snapshots = useMemo(() => resolveSnapshots(report), [report]);
  const previousSnapshots = useMemo(() => resolveSnapshots(previousReport), [previousReport]);
  const sameDevice = useMemo(() => sameCaptureDevice(report, previousReport), [report, previousReport]);
  if (!items.length && score == null && !before && !after && !missing.length && !quality && !snapshots.length) return null;
  const hasScore = score != null && Number.isFinite(Number(score));

  return (
    <section className="flex flex-col gap-3" data-testid="quick-result-sheet">
      <QualityBanner quality={quality} />
      <SnapshotStrip snapshots={snapshots} previousSnapshots={previousSnapshots} sameDevice={sameDevice} />
      {/* [A4 유지 2026-11-15] A4 폭(794px)에서도 옆으로 나란히 놓아 장수가 늘지 않게 한다(md 기준). */}
      {before ? (
        <div className="grid gap-3 md:grid-cols-[1.25fr_1fr]">
          {before}
          <div className="flex flex-col gap-3">
            {hasScore && <ScoreBar score={score} />}
            {judged.length > 0 && <TopList top={top} onPick={onPick} />}
          </div>
        </div>
      ) : (hasScore || judged.length > 0) && (
        <div className={`grid gap-3 ${hasScore && judged.length ? 'md:grid-cols-2' : ''}`}>
          {hasScore && <ScoreBar score={score} />}
          {judged.length > 0 && <TopList top={top} onPick={onPick} />}
        </div>
      )}
      {judged.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-black text-slate-900 dark:text-white">항목별 결과</p>
            <span className="text-[10px] text-slate-500">눈금 기준은 참고 기준</span>
          </div>
          <div className="grid gap-2.5 md:grid-cols-2 [&>*]:min-w-0">
            {judged.map((it) => <JudgedCard key={it.key} item={it} active={activeKey === it.key} anchorPrefix={anchorPrefix} />)}
          </div>
        </div>
      )}
      {records.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-black text-slate-900 dark:text-white">기록</p>
            <span className="text-[10px] text-slate-500">검증된 기준이 없어 판정 없이 지난번과 비교</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {records.map((it) => <RecordTile key={it.key} item={it} />)}
          </div>
        </div>
      )}
      <MissingList missing={missing} />
      {after}
    </section>
  );
}
