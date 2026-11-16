// [자세 결과시트 UI 2026-11-15]
// motiphysio·exbody 결과지 구성을 참고한 상단 요약 영역.
//  ① 면별 스켈레톤 시트(기준 수직선 + 항목 배지)  ② 통합 점수 3구간 막대
//  ③ 먼저 볼 3가지(3칸 단계 막대)  ④ 항목 목록 + 항목별 눈금 카드(지난번 대비)
//  ⑤ 근육 경향 몸 그림(추정 표시 유지)
// 계산은 core/postureResultSheet.js(기존 값·기존 기준 재사용)에서만 한다.
// 참고 업체 화면의 장기·신경·림프 표시, '악화 시뮬레이션', 3D 모델은 카메라로
// 측정되지 않는 정보라 넣지 않는다(센터 원칙: 느낌이 아니라 숫자).
import React, { useEffect, useMemo, useState } from 'react';
import { POSE_LANDMARKS } from '../core/postureMath';
import MuscleAtlas from './MuscleAtlas.jsx';
import { atlasForRegions, muscleById, muscleImageSrc } from '../core/muscleAtlas';
import {
  buildPostureSheetItems,
  buildPostureMissing,
  activeRegions,
  collectViewLandmarks,
  SHEET_LEVEL,
} from '../core/postureResultSheet';
import { zonesFromRange } from '../core/quickResultSheet';
import QuickResultSheet from '../../components/report/QuickResultSheet.jsx';

const LM = POSE_LANDMARKS;

const LV = {
  normal: { ko: '정상', text: 'text-emerald-700 dark:text-emerald-300', chip: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200', fill: '#10b981', seg: 1 },
  caution: { ko: '주의', text: 'text-amber-700 dark:text-amber-300', chip: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200', fill: '#f59e0b', seg: 2 },
  risk: { ko: '위험', text: 'text-red-700 dark:text-red-300', chip: 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200', fill: '#ef4444', seg: 3 },
};

const VIEW_ORDER = [
  { key: 'front', label: '정면' },
  { key: 'left', label: '좌측면' },
  { key: 'right', label: '우측면' },
  { key: 'back', label: '후면' },
];

const BONES = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW], [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP], [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE], [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE], [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL], [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL], [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
];

function SectionTitle({ children, aside }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-sm font-black text-slate-900 dark:text-white">{children}</p>
      {aside}
    </div>
  );
}

function Card({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </section>
  );
}

function fmt(v) {
  if (v == null) return '-';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ── ① 면별 스켈레톤 시트 ─────────────────────────────────────────────
function visible(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= 0.3;
}

// aspect = 사진 가로/세로 비율. 사진이 있으면 실제 비율로 그려야 사진과 뼈대가 겹친다.
function useFigure(landmarks, aspect = 1) {
  return useMemo(() => {
    const pts = landmarks.filter(visible);
    if (pts.length < 8) return null;
    const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const h = Math.max(1e-6, maxY - minY);
    const W = 100; const H = 160; const pad = 14;
    const s = (H - pad * 2) / h;
    const cx = (minX + maxX) / 2;
    const map = (p) => ({ x: W / 2 + (p.x - cx) * s * aspect, y: pad + (p.y - minY) * s });
    // 사진 전체(정규화 0~1)를 같은 변환으로 놓을 위치
    const photo = { x: W / 2 - cx * s * aspect, y: pad - minY * s, w: s * aspect, h: s };
    return { map, W, H, photo };
  }, [landmarks, aspect]);
}

// [스켈레톤+사진 2026-11-16] 촬영 사진의 가로/세로 비율 읽기
function usePhotoAspect(url) {
  const [aspect, setAspect] = useState(null);
  useEffect(() => {
    if (!url) { setAspect(null); return undefined; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive && img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight); };
    img.onerror = () => { if (alive) setAspect(null); };
    img.src = url;
    return () => { alive = false; };
  }, [url]);
  return aspect;
}

function Badge({ x, y, text, level, anchor = 'start' }) {
  const st = LV[level] || LV.normal;
  const w = Math.max(18, text.length * 5.2 + 6);
  const bx = anchor === 'end' ? x - w : x;
  return (
    <g>
      <rect x={bx} y={y - 7} width={w} height={13} rx={3} fill={st.fill} />
      <text x={bx + w / 2} y={y + 2.6} textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#fff">{text}</text>
    </g>
  );
}

function SkeletonFigure({ viewKey, label, landmarks, itemsByKey, photoUrl, showPhoto }) {
  const aspect = usePhotoAspect(showPhoto ? photoUrl : null);
  const withPhoto = !!(showPhoto && photoUrl && aspect);
  const fig = useFigure(landmarks, withPhoto ? aspect : 1);
  if (!fig) {
    return (
      <div className="flex aspect-[5/8] items-center justify-center rounded-lg bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-950">
        {label} 좌표 부족
      </div>
    );
  }
  const { map, W, H, photo } = fig;
  const P = (i) => (visible(landmarks[i]) ? map(landmarks[i]) : null);
  const isSide = viewKey === 'left' || viewKey === 'right';
  const la = P(LM.LEFT_ANKLE); const ra = P(LM.RIGHT_ANKLE);
  const ankles = [la, ra].filter(Boolean);
  const plumbX = ankles.length ? ankles.reduce((s, p) => s + p.x, 0) / ankles.length : W / 2;
  const head = P(LM.NOSE);
  const ear = P(LM.LEFT_EAR) || P(LM.RIGHT_EAR);
  const ls = P(LM.LEFT_SHOULDER); const rs = P(LM.RIGHT_SHOULDER);
  const lh = P(LM.LEFT_HIP); const rh = P(LM.RIGHT_HIP);
  const knee = P(LM.LEFT_KNEE) || P(LM.RIGHT_KNEE);
  const badges = [];
  const add = (key, at, anchor) => {
    const it = itemsByKey[key];
    if (!it || !at) return;
    badges.push(<Badge key={key} x={at.x + (anchor === 'end' ? -4 : 4)} y={at.y} text={`${fmt(Math.round(it.value))}${it.unit}`} level={it.level} anchor={anchor} />);
  };
  if (isSide) {
    add('forward_head', ear, 'start');
    add('kyphosis', ls || rs, 'end');
    add('knee_plumb', knee, 'start');
  } else {
    const shoulderItem = itemsByKey.shoulder_height;
    const pelvisItem = itemsByKey.pelvis_height;
    const rightMost = (a, b) => (a && b ? (a.x > b.x ? a : b) : a || b);
    if (shoulderItem && (shoulderItem.source || 'front') === viewKey) add('shoulder_height', rightMost(ls, rs), 'start');
    if (pelvisItem && (pelvisItem.source || 'front') === viewKey) add('pelvis_height', rightMost(lh, rh), 'start');
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-950" role="img" aria-label={`${label} 스켈레톤${withPhoto ? ' (촬영 사진)' : ''}`}>
      {withPhoto && (
        <>
          <image href={photoUrl} x={photo.x} y={photo.y} width={photo.w} height={photo.h} preserveAspectRatio="none" />
          <rect x="0" y="0" width={W} height={H} fill="#000" fillOpacity="0.18" />
        </>
      )}
      {!withPhoto && [20, 40, 60, 80].map((x) => <line key={`v${x}`} x1={x} y1="0" x2={x} y2={H} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="0.4" />)}
      {!withPhoto && [40, 80, 120].map((y) => <line key={`h${y}`} x1="0" y1={y} x2={W} y2={y} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="0.4" />)}
      <line x1={plumbX} y1="4" x2={plumbX} y2={H - 4} stroke="#3b82f6" strokeWidth="0.8" strokeDasharray="2 2" />
      {!isSide && ls && rs && <line x1={ls.x} y1={ls.y} x2={rs.x} y2={rs.y} stroke="#3b82f6" strokeWidth="0.6" />}
      {!isSide && lh && rh && <line x1={lh.x} y1={lh.y} x2={rh.x} y2={rh.y} stroke="#3b82f6" strokeWidth="0.6" />}
      <g stroke={withPhoto ? '#22d3ee' : 'currentColor'} className={withPhoto ? '' : 'text-slate-500 dark:text-slate-400'} strokeWidth={withPhoto ? 1.6 : 2.2} strokeLinecap="round">
        {BONES.map(([a, b]) => {
          const A = P(a); const B = P(b);
          return A && B ? <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} /> : null;
        })}
        {isSide && ear && (ls || rs) && <line x1={ear.x} y1={ear.y} x2={(ls || rs).x} y2={(ls || rs).y} strokeDasharray="1.5 1.5" strokeWidth="1.2" />}
      </g>
      {head && !withPhoto && <circle cx={head.x} cy={head.y - 2} r="7" fill="none" stroke="currentColor" className="text-slate-500 dark:text-slate-400" strokeWidth="1.8" />}
      {withPhoto && BONES.flat().filter((v, i, a) => a.indexOf(v) === i).map((i) => {
        const pt = P(i);
        return pt ? <circle key={`j${i}`} cx={pt.x} cy={pt.y} r="1.6" fill="#fff" stroke="#0891b2" strokeWidth="0.6" /> : null;
      })}
      {badges}
    </svg>
  );
}

function SkeletonSheet({ viewMap, items, photoMap = {} }) {
  const itemsByKey = useMemo(() => Object.fromEntries(items.map((it) => [it.key, it])), [items]);
  const hasPhotos = Object.values(photoMap).some(Boolean);
  const [showPhoto, setShowPhoto] = useState(true);
  const views = VIEW_ORDER.filter((v) => viewMap[v.key]);
  if (!views.length) return null;
  return (
    <Card>
      <SectionTitle aside={hasPhotos ? (
        <button type="button" onClick={() => setShowPhoto((v) => !v)}
          className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200">
          {showPhoto ? '뼈대만 보기' : '사진과 함께 보기'}
        </button>
      ) : <span className="text-[10px] text-slate-500">파란 점선 = 발목 기준 수직선</span>}>스켈레톤 결과 시트</SectionTitle>
      <div className={`grid gap-2 ${views.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : views.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {views.map((v) => (
          <div key={v.key} className="mx-auto w-full max-w-[170px]">
            <SkeletonFigure viewKey={v.key} label={v.label} landmarks={viewMap[v.key]} itemsByKey={itemsByKey}
              photoUrl={photoMap[v.key]} showPhoto={showPhoto} />
            <p className="mt-1 text-center text-[11px] font-bold text-slate-500">{v.label}</p>
          </div>
        ))}
      </div>
      {hasPhotos && <p className="mt-2 text-[10px] text-slate-500">파란 점선 = 발목 기준 수직선 · 촬영 사진은 이 화면과 저장한 A4 리포트 이미지에만 쓰이고 서버에는 올라가지 않습니다.</p>}
    </Card>
  );
}

// ── ⑤ 근육 경향 해부도 (추정) ── 그림은 public/muscles (근육 도감 PNG), 목록·연결은 core/muscleAtlas.js
function MuscleBodyMap({ regions, items }) {
  const tight = [...new Set(items.flatMap((it) => it.tight))];
  const weak = [...new Set(items.flatMap((it) => it.weak))];
  const atlas = atlasForRegions(regions);
  const [atlasOpen, setAtlasOpen] = React.useState(false);
  const tile = (no, kind) => {
    const m = muscleById(no);
    if (!m) return null;
    return (
      <figure key={`${kind}${no}`} className="m-0 rounded-lg bg-white p-1 text-center ring-1 ring-slate-200 dark:ring-slate-300">
        <img src={muscleImageSrc(no, kind)} alt={`${m.name} ${kind === 'weak' ? '약화' : '긴장'}`} className="mx-auto block h-24 w-full object-contain" crossOrigin="anonymous" />
        <figcaption className={`text-[10px] font-black ${kind === 'weak' ? 'text-blue-700' : 'text-red-700'}`}>{m.name}</figcaption>
      </figure>
    );
  };
  return (
    <Card>
      <SectionTitle aside={<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">추정 · 측정값 아님</span>}>
        근육 경향 해부도
      </SectionTitle>
      {!regions.length ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">두드러진 자세 불균형이 없어 표시할 근육 경향이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.6fr_1fr]">
          <div className="grid grid-cols-3 gap-1.5">
            {atlas.tight.map((n) => tile(n, 'tight'))}
            {atlas.weak.map((n) => tile(n, 'weak'))}
          </div>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-black text-red-700 dark:text-red-300">빨강 · 긴장 쪽 (풀어주기)</p>
              <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">{tight.join(', ') || '해당 없음'}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-black text-sky-700 dark:text-sky-300">파랑 · 약해지기 쉬운 쪽 (강화하기)</p>
              <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">{weak.join(', ') || '해당 없음'}</p>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-500">자세 패턴에서 흔히 함께 나타나는 경향입니다. 실제 근긴장은 트레이너 촉진으로 확인하세요.</p>
            <button type="button" onClick={() => setAtlasOpen(true)} data-html2canvas-ignore="true"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200">근육 도감 열기</button>
          </div>
        </div>
      )}
      {atlasOpen && <MuscleAtlas onClose={() => setAtlasOpen(false)} />}
    </Card>
  );
}

// ── 묶음 ── 점수·먼저 볼 것·항목 카드는 다른 측정 리포트와 같은 공용 QuickResultSheet 로 그린다(통일).
// 자세체형 전용 계산(면별 값·성별 기준·근육 경향)만 여기서 공용 항목 모양으로 바꿔 넘긴다.
export function toQuickItems(items = []) {
  return items.map((it) => {
    const source = it.source ? `(${it.source === 'back' ? '후면' : '정면'})` : '';
    return {
      key: it.key,
      label: it.label,
      tag: `${it.view}${source}`,
      description: it.plain,
      value: it.value,
      display: fmt(it.value),
      unit: it.unit,
      level: it.level,
      scale: zonesFromRange({ good: [0, it.caution], warn: [0, it.risk] }),
      dir: 'lower',
      previous: it.previous,
      delta: it.delta,
      improved: it.delta == null || it.delta === 0 ? null : it.delta < 0,
      chips: [
        ...it.tight.map((m) => ({ tone: 'tight', text: `풀기 · ${m}` })),
        ...it.weak.map((m) => ({ tone: 'weak', text: `강화 · ${m}` })),
      ],
    };
  });
}

export default function PostureResultSheet({ report, analysis, score, member, previousReport, perViewSnapshots, currentPose }) {
  const sex = member?.sex || member?.gender || report?.sex || null;
  const items = useMemo(() => buildPostureSheetItems({
    perViewAnalysis: report?.perViewAnalysis,
    analysis,
    sex,
    previous: previousReport || null,
  }), [report, analysis, sex, previousReport]);
  const quickItems = useMemo(() => toQuickItems(items), [items]);
  const missing = useMemo(() => buildPostureMissing({
    perViewAnalysis: report?.perViewAnalysis, analysis, presentKeys: items.map((i) => i.key),
  }), [report, analysis, items]);
  const regions = useMemo(() => activeRegions(items), [items]);
  // 측정 직후 화면에만 있는 촬영 사진(로컬 ObjectURL) — 저장된 기록을 다시 열면 뼈대만 보인다.
  const photoMap = useMemo(() => {
    const out = {};
    (perViewSnapshots || []).forEach((sn) => { if (sn?.key && sn.snapshotUrl) out[sn.key] = sn.snapshotUrl; });
    return out;
  }, [perViewSnapshots]);
  const viewMap = useMemo(() => collectViewLandmarks({
    viewLandmarks: report?.viewLandmarks,
    perViewSnapshots: perViewSnapshots || report?.perViewSnapshots,
    fallback: currentPose,
  }), [report, perViewSnapshots, currentPose]);

  return (
    <div data-testid="posture-result-sheet">
      <QuickResultSheet
        report={report}
        score={score}
        items={quickItems}
        missing={missing}
        anchorPrefix="posture-item"
        before={<SkeletonSheet viewMap={viewMap} items={items} photoMap={photoMap} />}
        after={<MuscleBodyMap regions={regions} items={items} />}
      />
    </div>
  );
}

export { SHEET_LEVEL };
