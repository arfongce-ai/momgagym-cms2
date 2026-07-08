// ai-measure/menus/GaugeHud.jsx
// ════════════════════════════════════════════════════════════════════════
//  실시간 게이지형 HUD (전 측정 모듈 공통 · 녹화 번인 drawGaugeHud 와 동일 디자인).
//   · 중앙: 270° 아크 게이지 + 주값(대형) + 라벨/단위.
//   · 하단 좌/우: 보조 스탯 카드(최대 4). 피사체(중앙 상단)를 가리지 않는 배치.
//  측정 정직성: 값이 없으면(키 미보정·측정 전) 게이지를 채우지 않고 '—' 표시.
// ════════════════════════════════════════════════════════════════════════
const ARC_START = 135; // deg (좌하)
const ARC_SWEEP = 270; // deg

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function StatCard({ label, value, unit, tone = 'text-white' }) {
  return (
    <div className="rounded-xl bg-black/50 backdrop-blur px-3 py-2 min-w-[76px] text-center">
      <p className={`font-mono font-black text-2xl leading-none ${tone}`}>
        {value == null || value === '' ? '—' : value}
        {unit ? <span className="text-[11px] font-bold text-slate-300/70 ml-0.5">{unit}</span> : null}
      </p>
      <p className="text-[10px] font-bold text-slate-300/75 mt-1 tracking-wider">{label}</p>
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} p.label     게이지 라벨(예: '평균속도')
 * @param {number|null} p.value 게이지 주값
 * @param {number} p.min        게이지 하한(기본 0)
 * @param {number} p.max        게이지 상한
 * @param {string} p.unit       주값 단위(예: 'm/s')
 * @param {number} [p.decimals] 표시 소수 자릿수(미지정 시 값 그대로)
 * @param {string} p.accent     아크 색(기본 시안)
 * @param {Array}  p.stats      하단 스탯 카드 [{label,value,unit,tone}]
 */
export default function GaugeHud({
  label = '', value = null, min = 0, max = 1, unit = '', decimals = null,
  accent = '#22d3ee', stats = [],
}) {
  // null/undefined/'' 는 '값 없음'으로 처리 — Number(null)===0 이 유한수로 새어들어
  //  '0' 또는 'null' 로 표시되던 버그 방지(측정 정직성: 없는 값은 '—').
  const hasV = value != null && value !== '' && Number.isFinite(Number(value));
  const v = hasV ? Number(value) : NaN;
  const frac = hasV && max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;

  const size = 176;
  const cx = size / 2, cy = size / 2, r = size / 2 - 16;
  const track = arcPath(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP);
  const valArc = arcPath(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP * frac);

  const display = hasV
    ? (decimals != null ? v.toFixed(decimals) : String(value))
    : '—';

  const cards = (stats || []).filter(s => s && s.label).slice(0, 4);
  const leftCards = cards.filter((_, i) => i % 2 === 0);
  const rightCards = cards.filter((_, i) => i % 2 === 1);

  return (
    <div className="relative mx-auto w-full max-w-sm select-none pointer-events-none" style={{ minHeight: 196 }}>
      {/* 하단 좌/우 보조 스탯 */}
      {leftCards.length > 0 && (
        <div className="absolute left-0 bottom-1 flex flex-col gap-1.5">
          {leftCards.map((s, i) => <StatCard key={`l${i}`} {...s} />)}
        </div>
      )}
      {rightCards.length > 0 && (
        <div className="absolute right-0 bottom-1 flex flex-col gap-1.5 items-end">
          {rightCards.map((s, i) => <StatCard key={`r${i}`} {...s} />)}
        </div>
      )}

      {/* 중앙 아크 게이지 */}
      <div className="absolute left-1/2 top-1 -translate-x-1/2" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
          <path d={track} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="11" strokeLinecap="round" />
          {frac > 0 && (
            <path d={valArc} fill="none" stroke={accent} strokeWidth="11" strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 220ms ease-out' }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {label && <p className="text-[12px] font-bold text-slate-100/85 leading-none">{label}</p>}
          <p className="font-mono font-black text-white leading-none mt-1" style={{ fontSize: 46 }}>{display}</p>
          {unit && <p className="text-[13px] font-black leading-none mt-1" style={{ color: accent }}>{unit}</p>}
        </div>
      </div>
    </div>
  );
}
