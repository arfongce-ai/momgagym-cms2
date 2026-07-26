// components/report/reportImage.js
// 리포트를 단일 SVG 문자열로 조립 → Canvas 에 그려 JPG 다운로드.
// 외부 라이브러리(html2canvas 등) 없이 동작. CORS/폰트 이슈 최소화.

/** SVG 문자열을 JPG 로 변환해 다운로드 */
export async function downloadSvgAsJpg(svgString, filename = 'report.jpg', scale = 2) {
  return new Promise((resolve, reject) => {
    try {
      // viewBox 에서 크기 추출
      const wMatch = svgString.match(/width="(\d+)"/);
      const hMatch = svgString.match(/height="(\d+)"/);
      const w = wMatch ? Number(wMatch[1]) : 600;
      const h = hMatch ? Number(hMatch[1]) : 800;

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        // JPG 는 투명 미지원 → 배경 채움
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        canvas.toBlob((b) => {
          if (!b) { reject(new Error('이미지 변환 실패')); return; }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          resolve(true);
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG 로드 실패')); };
      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}

/** XML 특수문자 escape */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 작은 꺾은선을 SVG 조각으로 (리포트 내장용) */
function miniChart(points, x, y, w, h, color) {
  if (!points || points.length === 0) return '';
  const vals = points.map(p => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const n = points.length;
  const xAt = (i) => x + (n === 1 ? w / 2 : (w * i) / (n - 1));
  const yAt = (v) => y + h - ((v - min) / (max - min)) * h;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.value).toFixed(1)}" r="3" fill="${color}"/>`).join('');
  const lastLabel = `<text x="${xAt(n - 1).toFixed(1)}" y="${(yAt(points[n - 1].value) - 6).toFixed(1)}" fill="${color}" font-size="11" font-weight="bold" text-anchor="middle" font-family="system-ui">${points[n - 1].value}</text>`;
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}${lastLabel}`;
}

/**
 * 종합 리포트를 단일 SVG 문자열로 조립.
 * @param {object} report buildFullReport() 결과
 */
export function buildReportSvg(report) {
  const { member, body, ai, notes, generatedAt } = report;
  const W = 600;
  const colors = { weight:'#f59e0b', systolic:'#ef4444', diastolic:'#3b82f6', height:'#22d3ee' };

  let y = 0;
  const parts = [];

  // 헤더
  parts.push(`<rect x="0" y="0" width="${W}" height="72" fill="#1e293b"/>`);
  parts.push(`<text x="24" y="34" fill="#f59e0b" font-size="20" font-weight="800" font-family="system-ui">몸가짐운동센터 측정 리포트</text>`);
  parts.push(`<text x="24" y="56" fill="#cbd5e1" font-size="13" font-family="system-ui">${esc(member?.name || '회원')} · 생성일 ${esc(generatedAt.slice(0,10))}</text>`);
  y = 96;

  // 요약 카드 (실측 항목만, 최대값 기준)
  parts.push(`<text x="24" y="${y}" fill="#94a3b8" font-size="13" font-weight="bold" font-family="system-ui">측정 요약 (최대값 기준)</text>`);
  y += 14;
  const cardW = (W - 48 - 12) / 2;
  body.summary.forEach((s, i) => {
    const cx = 24 + (i % 2) * (cardW + 12);
    const cy = y + Math.floor(i / 2) * 64;
    parts.push(`<rect x="${cx}" y="${cy}" width="${cardW}" height="56" rx="10" fill="#0f172a" stroke="#1e293b"/>`);
    parts.push(`<text x="${cx + 12}" y="${cy + 20}" fill="#64748b" font-size="11" font-family="system-ui">${esc(s.label)}</text>`);
    parts.push(`<text x="${cx + 12}" y="${cy + 42}" fill="#f1f5f9" font-size="18" font-weight="800" font-family="system-ui">${s.max}<tspan fill="#64748b" font-size="11" font-weight="400"> ${esc(s.unit)} (최대)</tspan></text>`);
    if (s.change != null) {
      const up = s.change > 0;
      parts.push(`<text x="${cx + cardW - 12}" y="${cy + 42}" fill="${up ? '#ef4444' : '#22c55e'}" font-size="12" font-weight="bold" text-anchor="end" font-family="system-ui">${up ? '▲' : '▼'}${Math.abs(s.change)}</text>`);
    }
  });
  y += Math.ceil(body.summary.length / 2) * 64 + 16;

  // 추이 그래프 (실측 시계열만)
  const chartFields = body.fields.filter(f => body.series[f.key]?.length > 1);
  if (chartFields.length) {
    parts.push(`<text x="24" y="${y}" fill="#94a3b8" font-size="13" font-weight="bold" font-family="system-ui">회차별 추이</text>`);
    y += 12;
    chartFields.forEach(f => {
      const pts = body.series[f.key];
      parts.push(`<rect x="24" y="${y}" width="${W - 48}" height="90" rx="10" fill="#0f172a" stroke="#1e293b"/>`);
      parts.push(`<text x="36" y="${y + 18}" fill="#cbd5e1" font-size="11" font-weight="bold" font-family="system-ui">${esc(f.label)} (${esc(f.unit)})</text>`);
      parts.push(miniChart(pts, 36, y + 26, W - 96, 50, colors[f.key] || '#f59e0b'));
      y += 102;
    });
  }

  // 텍스트 설명
  if (notes.length) {
    parts.push(`<text x="24" y="${y}" fill="#94a3b8" font-size="13" font-weight="bold" font-family="system-ui">분석 설명</text>`);
    y += 8;
    notes.forEach(note => {
      y += 20;
      parts.push(`<text x="28" y="${y}" fill="#cbd5e1" font-size="12" font-family="system-ui">· ${esc(note)}</text>`);
    });
    y += 16;
  }

  const H = y + 20;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#0b1220"/>${parts.join('')}</svg>`;
}
