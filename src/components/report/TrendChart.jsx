// components/report/TrendChart.jsx
// 순수 SVG 꺾은선 그래프 (외부 라이브러리 0). 회차별 누적 추이 표시.
// JPG 변환을 위해 의도적으로 인라인 스타일/명시적 좌표 사용.

export default function TrendChart({ title, unit, points, color = '#f59e0b', width = 320, height = 160 }) {
  if (!points || points.length === 0) return null;

  const padL = 38, padR = 12, padT = 18, padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const values = points.map(p => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; } // 평평한 경우 여백
  const range = max - min;

  const n = points.length;
  const xAt = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (v) => padT + innerH - ((v - min) / range) * innerH;

  // 꺾은선 경로
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(' ');

  // y축 눈금 3개
  const ticks = [min, (min + max) / 2, max];

  // x축 라벨 (첫/끝만, 길면 잘림)
  const shortDate = (d) => String(d).slice(5); // MM-DD

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ background: '#0f172a', borderRadius: 12 }} xmlns="http://www.w3.org/2000/svg">
      {/* 제목 */}
      <text x={padL} y={12} fill="#cbd5e1" fontSize="11" fontWeight="bold" fontFamily="system-ui">
        {title} {unit ? `(${unit})` : ''}
      </text>

      {/* y축 눈금선 + 라벨 */}
      {ticks.map((t, i) => {
        const y = yAt(t);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#1e293b" strokeWidth="1" />
            <text x={padL - 4} y={y + 3} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="system-ui">
              {Number(t.toFixed(1))}
            </text>
          </g>
        );
      })}

      {/* 꺾은선 */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* 데이터 점 */}
      {points.map((p, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(p.value)} r="3.5" fill={color} stroke="#0f172a" strokeWidth="1.5" />
      ))}

      {/* 최신값 강조 라벨 */}
      <text x={xAt(n - 1)} y={yAt(points[n - 1].value) - 8} fill={color} fontSize="11" fontWeight="bold"
        textAnchor="middle" fontFamily="system-ui">
        {points[n - 1].value}
      </text>

      {/* x축 양끝 날짜 */}
      <text x={padL} y={height - 8} fill="#64748b" fontSize="9" fontFamily="system-ui">{shortDate(points[0].date)}</text>
      {n > 1 && (
        <text x={width - padR} y={height - 8} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="system-ui">
          {shortDate(points[n - 1].date)}
        </text>
      )}
    </svg>
  );
}
