// ai-measure/menus/VelocityGaugeHud.jsx
// ════════════════════════════════════════════════════════════════════════
//  실시간 속도 게이지 HUD — OVR Velocity 스타일(참고 스크린샷 기반).
//   · 중앙: 원형 게이지 + 직전 렙 평균속도(m/s) 대형 표기
//   · 4모서리 카드: 반복(Rep) · 최고속도(AV) · 가동범위(ROM) · 속도저하(LOSS)
//  측정 정직성: 값이 없으면(키 미보정·렙 미완성) 숫자 대신 '—' 를 표시하고
//  게이지를 채우지 않는다 — 그럴듯한 가짜 값으로 채우지 않음.
//  데이터 소스는 전부 BarbellAccumulator.live() 실시간 산출값.
// ════════════════════════════════════════════════════════════════════════

// 게이지 만점 속도(m/s) — Mann VBT 존 상단(스피드·파워 1.3+)을 살짝 넘는 1.5.
const GAUGE_MAX_MS = 1.5;
const R = 66;                      // 게이지 반지름(px)
const CIRC = 2 * Math.PI * R;

function StatCard({ label, value, align = 'left', tone = 'text-white' }) {
  return (
    <div className={`rounded-xl bg-black/45 backdrop-blur px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <p className={`font-mono font-black text-xl leading-none ${tone}`}>{value ?? '—'}</p>
      <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300/80 mt-0.5 tracking-wider">{label}</p>
    </div>
  );
}

/**
 * @param {object} p
 * @param {number|null} p.avg      중앙 대형 값 — 직전 렙 평균속도(m/s)
 * @param {number}      p.reps     반복 수
 * @param {number|null} p.best     세트 최고 렙 평균속도(m/s)
 * @param {number|null} p.romCm    수직 가동범위(cm)
 * @param {number|null} p.lossPct  속도저하(%) — 최고 대비 직전 렙
 * @param {string|null} p.zoneLabel 속도 존 라벨(있으면 게이지 하단에 표시)
 */
export default function VelocityGaugeHud({ avg = null, reps = 0, best = null, romCm = null, lossPct = null, zoneLabel = null }) {
  const v = Number(avg);
  const hasV = Number.isFinite(v) && v > 0;
  const frac = hasV ? Math.min(1, v / GAUGE_MAX_MS) : 0;
  const dash = `${CIRC * frac} ${CIRC}`;
  const lossTone = lossPct == null ? 'text-white'
    : lossPct > 20 ? 'text-red-700 dark:text-red-300'
    : lossPct > 10 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300';

  return (
    <div className="relative mx-auto w-full max-w-sm select-none pointer-events-none" style={{ height: 200 }}>
      {/* 4모서리 지표 카드 */}
      <div className="absolute left-0 top-1"><StatCard label="Rep" value={reps} /></div>
      <div className="absolute right-0 top-1"><StatCard label="AV" value={best ?? '—'} align="right" /></div>
      <div className="absolute left-0 bottom-1"><StatCard label="ROM" value={romCm ?? '—'} /></div>
      <div className="absolute right-0 bottom-1"><StatCard label="LOSS%" value={lossPct ?? '—'} align="right" tone={lossTone} /></div>

      {/* 중앙 원형 게이지 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 168, height: 168 }}>
        <svg width="168" height="168" viewBox="0 0 168 168" className="block">
          {/* 트랙 */}
          <circle cx="84" cy="84" r={R} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.28)" strokeWidth="9" />
          {/* 값 아크 — 12시 방향 시작, 시계방향 */}
          <circle
            cx="84" cy="84" r={R} fill="none"
            stroke="#22d3ee" strokeWidth="9" strokeLinecap="round"
            strokeDasharray={dash}
            transform="rotate(-90 84 84)"
            style={{ transition: 'stroke-dasharray 240ms ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100/90 leading-none">Avg</p>
          <p className="font-mono font-black text-white leading-none mt-1" style={{ fontSize: 44 }}>
            {hasV ? v.toFixed(2) : '—'}
          </p>
          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100/90 leading-none mt-1">m/s</p>
          {zoneLabel && <p className="text-[10px] font-black text-cyan-700 dark:text-cyan-300 mt-1">{zoneLabel}</p>}
        </div>
      </div>
    </div>
  );
}
