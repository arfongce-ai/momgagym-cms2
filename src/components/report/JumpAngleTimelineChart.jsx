// components/report/JumpAngleTimelineChart.jsx
// [무릎·고관절 각도 그래프 2026-08-18] 순수 SVG 꺾은선 그래프 (외부 라이브러리
// 0 — TrendChart.jsx와 동일 철학). 단일 점프 안에서 준비→도약→공중→착지 구간
// 동안의 무릎/고관절 각도 변화를 시간축으로 보여준다.
//
// timeline: JumpBiomechAccumulator.summary().timeline — [{tMs, phase, knee, hip}, ...]
// (jumpBiomechanics.js push() 참고). phase는 'stand'|'air'|'land'.
//
// 측정 정직성: 관절이 안 보인 프레임은 knee/hip이 null일 수 있다 — 그 구간은
// 선을 끊어서(연결하지 않고) 그린다. 값이 하나도 없으면 그리지 않는다(호출부에서
// length 체크로 걸러짐).
export default function JumpAngleTimelineChart({ timeline = [], width = 680, height = 200 }) {
  if (!timeline || timeline.length < 2) return null;

  const padL = 40, padR = 12, padT = 22, padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const t0 = timeline[0].tMs;
  const tMax = Math.max(1, timeline[timeline.length - 1].tMs - t0);
  const xAt = (tMs) => padL + ((tMs - t0) / tMax) * innerW;

  const allVals = timeline.flatMap((p) => [p.knee, p.hip]).filter((v) => v != null);
  if (!allVals.length) return null;
  let min = Math.min(...allVals), max = Math.max(...allVals);
  if (min === max) { min -= 5; max += 5; }
  // 위아래 여백 10%
  const pad = (max - min) * 0.1;
  min -= pad; max += pad;
  const range = max - min;
  const yAt = (v) => padT + innerH - ((v - min) / range) * innerH;

  // 선 경로 — null인 지점에서 끊는다(구간별 M/L 분리)
  const pathOf = (key) => {
    let d = '';
    let drawing = false;
    for (const p of timeline) {
      const v = p[key];
      if (v == null) { drawing = false; continue; }
      d += `${drawing ? 'L' : 'M'} ${xAt(p.tMs).toFixed(1)} ${yAt(v).toFixed(1)} `;
      drawing = true;
    }
    return d.trim();
  };
  const kneePath = pathOf('knee');
  const hipPath = pathOf('hip');

  // 위상(phase) 전환 지점 — 배경 밴드 + 경계선. 'stand'는 배경 없음(기본),
  // 'air'는 살짝 밝은 배경, 'land'는 옅은 인디고 배경으로 구간을 표시.
  const bands = [];
  let curPhase = timeline[0].phase, curStart = timeline[0].tMs;
  for (let i = 1; i <= timeline.length; i++) {
    const p = timeline[i];
    const phase = p ? p.phase : null;
    if (phase !== curPhase) {
      bands.push({ phase: curPhase, x1: xAt(curStart), x2: xAt(p ? p.tMs : timeline[timeline.length - 1].tMs) });
      curPhase = phase; curStart = p ? p.tMs : curStart;
    }
  }
  const bandColor = { air: 'rgba(251,191,36,0.08)', land: 'rgba(99,102,241,0.10)', stand: 'transparent' };

  const ticks = [min, (min + max) / 2, max];

  return (
    <div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
        style={{ background: '#0f172a', borderRadius: 12, width: '100%', height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg">
        <text x={padL} y={13} fill="#cbd5e1" fontSize="11" fontWeight="bold" fontFamily="system-ui">
          관절 각도 변화 (°) · 준비→도약→착지
        </text>
        {/* 범례 */}
        <g fontFamily="system-ui" fontSize="10" fontWeight="bold">
          <circle cx={width - 118} cy={9} r="3.5" fill="#a78bfa" />
          <text x={width - 110} y={12.5} fill="#a78bfa">무릎</text>
          <circle cx={width - 70} cy={9} r="3.5" fill="#fb7185" />
          <text x={width - 62} y={12.5} fill="#fb7185">고관절</text>
        </g>

        {/* 위상 배경 밴드 */}
        {bands.map((b, i) => (
          bandColor[b.phase] && bandColor[b.phase] !== 'transparent' ? (
            <rect key={i} x={b.x1} y={padT} width={Math.max(0, b.x2 - b.x1)} height={innerH} fill={bandColor[b.phase]} />
          ) : null
        ))}

        {/* y축 눈금 */}
        {ticks.map((tv, i) => {
          const y = yAt(tv);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#1e293b" strokeWidth="1" />
              <text x={padL - 4} y={y + 3} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="system-ui">
                {Math.round(tv)}
              </text>
            </g>
          );
        })}

        {kneePath && <path d={kneePath} fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {hipPath && <path d={hipPath} fill="none" stroke="#fb7185" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}

        {/* x축 라벨 */}
        <text x={padL} y={height - 6} fill="#64748b" fontSize="9" fontFamily="system-ui">0ms</text>
        <text x={width - padR} y={height - 6} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="system-ui">
          {Math.round(tMax)}ms
        </text>
      </svg>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        음영 구간은 공중(주황)·착지 직후(남색)입니다. 관절이 가려져 인식되지 않은 구간은 선이 끊깁니다.
      </p>
    </div>
  );
}
