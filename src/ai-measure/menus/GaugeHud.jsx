// ai-measure/menus/GaugeHud.jsx
// ════════════════════════════════════════════════════════════════════════
//  실시간 측정 HUD (전 모듈 공통 · 녹화 번인 drawGaugeHud 와 동일 디자인).
//
//  측정 정직성 원칙 — 아크 게이지는 "상한이 생리학적으로 명확한 값"에만 쓴다.
//   · arc=true  : 속도(0~1.5 m/s), RSI(0~3) 처럼 기준 상한이 뚜렷 → 비율 표현이 유의미.
//   · arc=false : 무게·각도·케이던스·점프높이 처럼 상한이 자의적 → 아크의 채움 비율이
//                 오해를 주므로(예: 140kg 이 300 중 절반) 큰 숫자만 정직하게 표시.
//  값이 없으면(측정 전·미보정) '—'. Number(null)===0 유출 방지 가드 포함.
// ════════════════════════════════════════════════════════════════════════
const ARC_START = 135, ARC_SWEEP = 270; // deg (좌하에서 270° 시계방향)

function arcPath(cx, cy, r, startDeg, endDeg) {
  const p = (deg) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const [sx, sy] = p(startDeg), [ex, ey] = p(endDeg);
  return `M ${sx} ${sy} A ${r} ${r} 0 ${endDeg - startDeg > 180 ? 1 : 0} 1 ${ex} ${ey}`;
}

function StatCard({ label, value, unit, tone = 'text-white' }) {
  // [2026-08-05] min-w를 76px→56px로 낮추고 truncate를 추가 — 좁은 화면에서
  // grid 칸이 56px보다 작아질 일은 거의 없지만(원 크기도 같이 줄였다),
  // 혹시 더 좁아져도 숫자가 카드 밖으로 삐져나가 원과 겹치는 대신 카드 안에서
  // 말줄임되게 한다(겹침보다 훨씬 안전한 실패 방식).
  return (
    <div className="min-w-[56px] max-w-full overflow-hidden rounded-xl bg-black/50 backdrop-blur px-2 py-1.5 text-center">
      <p className={`truncate font-mono font-black text-xl leading-none ${tone}`}>
        {value == null || value === '' ? '—' : value}
        {unit ? <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300/70 ml-0.5">{unit}</span> : null}
      </p>
      <p className="truncate text-[9px] font-bold text-slate-600 dark:text-slate-300/75 mt-1 tracking-wider">{label}</p>
    </div>
  );
}

/**
 * @param {string}      p.label    주값 라벨(예: '평균속도')
 * @param {number|null} p.value    주값
 * @param {string}      p.unit     단위(예: 'm/s')
 * @param {number}      [p.decimals] 표시 소수 자릿수
 * @param {boolean}     [p.arc]    true 일 때만 아크 게이지(상한 명확한 값 전용)
 * @param {number}      [p.min=0]  아크 하한
 * @param {number}      [p.max]    아크 상한(arc=true 일 때 필수)
 * @param {string}      p.accent   강조색
 * @param {Array}       p.stats    코너 스탯 카드 [{label,value,unit,tone}]
 */
export default function GaugeHud({
  label = '', value = null, unit = '', decimals = null,
  arc = false, min = 0, max = 1, accent = '#22d3ee', stats = [],
}) {
  const hasV = value != null && value !== '' && Number.isFinite(Number(value));
  const v = hasV ? Number(value) : NaN;
  const display = hasV ? (decimals != null ? v.toFixed(decimals) : String(value)) : '—';

  const cards = (stats || []).filter(s => s && s.label).slice(0, 4);
  const leftCards = cards.filter((_, i) => i % 2 === 0);
  const rightCards = cards.filter((_, i) => i % 2 === 1);

  const size = 160;
  const frac = arc && hasV && max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;

  // [2026-08-05] 예전엔 원형 게이지를 컨테이너 중앙에, 스탯 카드를 좌/우 끝에
  // 각각 absolute로 독립 배치했다 — 폭이 좁은 화면(구형/보급형 폰)에서는
  // "카드 폭 + 원 반지름"의 합이 실제 컨테이너 폭보다 커져 카드가 원의
  // 아래쪽 모서리와 그대로 겹쳤다. 자세·ROM·보행·점프·바벨·SLST·스쿼트
  // 전부 이 컴포넌트 하나를 공유해서, 화면마다 다른 이유처럼 보였지만
  // 실제로는 여기 하나가 원인이었다.
  // grid-cols-[1fr_auto_1fr]로 바꾸면 세 구역(좌 카드/원/우 카드)이 서로
  // 다른 트랙에 배치돼 레이아웃 엔진 자체가 겹침을 원천 차단한다 — 카드가
  // 많아 넘치면 그 칸 안에서만 줄바꿈/축소될 뿐, 가운데 원 쪽으로 침범하지
  // 않는다. 가운데 트랙이 auto(원 실제 폭)라 좌우 1fr이 항상 같은 폭이 되고,
  // 그래서 원이 예전과 동일하게 정중앙에 남는다.
  return (
    <div className="mx-auto w-full max-w-sm select-none pointer-events-none" style={{ minHeight: 196 }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          {leftCards.map((s, i) => <StatCard key={`l${i}`} {...s} />)}
        </div>

        <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
          {arc && (
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
              <path d={arcPath(size / 2, size / 2, size / 2 - 16, ARC_START, ARC_START + ARC_SWEEP)}
                fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="11" strokeLinecap="round" />
              {frac > 0 && (
                <path d={arcPath(size / 2, size / 2, size / 2 - 16, ARC_START, ARC_START + ARC_SWEEP * frac)}
                  fill="none" stroke={accent} strokeWidth="11" strokeLinecap="round" />
              )}
            </svg>
          )}
          <div className="relative flex flex-col items-center justify-center">
            {label && <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100/85 leading-none">{label}</p>}
            <p className="font-mono font-black text-white leading-none mt-1" style={{ fontSize: arc ? 46 : 56 }}>{display}</p>
            {unit && <p className="text-[13px] font-black leading-none mt-1" style={{ color: accent }}>{unit}</p>}
          </div>
        </div>

        <div className="flex min-w-0 flex-col items-end gap-1.5">
          {rightCards.map((s, i) => <StatCard key={`r${i}`} {...s} />)}
        </div>
      </div>
    </div>
  );
}
