// 지출 가져오기 파서 — 엑셀 매트릭스형 / 평면 표 / 텍스트 붙여넣기를 공통 처리.
// Revenue.jsx와 테스트에서 공용으로 사용한다.

const isYear = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 2000 && n <= 2100; };
const monthOf = (v) => { const m = String(v ?? '').match(/^\s*(\d{1,2})\s*월/); return m ? Number(m[1]) : null; };

// 분류 라벨 → CMS 분류/항목명
export function categoryOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/수도.*관리|관리.*수도|관리비/.test(s)) return { category: '관리비', name: s };
  if (/전기/.test(s)) return { category: '전기세', name: '전기세' };
  if (/수도/.test(s)) return { category: '수도세', name: '수도세' };
  if (/원천세/.test(s)) return { category: '세금', name: '원천세' };
  if (/지방세/.test(s)) return { category: '세금', name: '지방세' };
  if (/세금|부가세/.test(s)) return { category: '세금', name: s };
  if (/임대|월세/.test(s)) return { category: '임대료', name: s };
  if (/통신|인터넷|전화/.test(s)) return { category: '통신비', name: s };
  return null;
}

// 월×연도 매트릭스형 시트 파싱.
// 분류 라벨행 → 연도 헤더행(연도 1개 이상) → 'N월' 행들의 교차점 금액.
export function parseMatrixRows(rows) {
  const out = [];
  let cur = null, yearCols = null;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    // 1) 분류 라벨(연도 셀 제외)
    for (let c = 0; c < row.length; c++) {
      const cat = categoryOf(row[c]);
      if (cat && !isYear(row[c])) { cur = cat; yearCols = null; break; }
    }
    // 2) 연도 헤더행
    const yc = {};
    row.forEach((v, c) => { if (isYear(v)) yc[c] = Number(v); });
    if (Object.keys(yc).length >= 1) { yearCols = yc; continue; }
    // 3) 월 행 → 교차점 금액
    if (cur && yearCols) {
      let month = null;
      for (let c = 0; c < row.length; c++) { const mm = monthOf(row[c]); if (mm) { month = mm; break; } }
      if (month) {
        Object.entries(yearCols).forEach(([c, year]) => {
          const v = row[Number(c)];
          const amt = Number(String(v ?? '').replace(/[, ]/g, ''));
          if (v != null && v !== '' && !Number.isNaN(amt) && amt !== 0) {
            out.push({ kind: 'monthly', category: cur.category, name: cur.name, ym: `${year}-${String(month).padStart(2, '0')}`, amount: Math.round(amt) });
          }
        });
      }
    }
  }
  return out;
}

// 평면 표(헤더에 분류/항목/귀속월/금액)
export function parseFlatRows(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(h => String(h ?? '').trim());
  const find = (...names) => head.findIndex(h => names.some(n => h.includes(n)));
  const ci = { cat: find('분류', '종류', '항목분류'), name: find('항목', '내용', '이름'), ym: find('귀속월', '월', '년월'), amt: find('금액', '지출') };
  if (ci.ym < 0 || ci.amt < 0) return [];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const ymRaw = String(row[ci.ym] ?? '').trim();
    const ym = ymRaw.match(/\d{4}[-/.]\d{1,2}/) ? ymRaw.replace(/[/.]/g, '-').replace(/-(\d)$/, '-0$1') : '';
    const amt = Number(String(row[ci.amt] ?? '').replace(/[, ]/g, ''));
    if (ym && !Number.isNaN(amt) && amt !== 0) {
      out.push({
        kind: 'monthly',
        category: (ci.cat >= 0 ? String(row[ci.cat]).trim() : '기타') || '기타',
        name: (ci.name >= 0 ? String(row[ci.name]).trim() : '') || '지출',
        ym, amount: Math.round(amt),
      });
    }
  }
  return out;
}

// 시트 rows[][]를 받아 평면 우선, 없으면 매트릭스로 파싱
export function parseSheetRows(rows) {
  const flat = parseFlatRows(rows);
  return flat.length ? flat : parseMatrixRows(rows);
}

// 동일 (분류·항목·귀속월·금액) 중복 제거
export function dedupeExpenses(list) {
  const seen = new Set();
  return list.filter(e => {
    const k = `${e.category}|${e.name}|${e.ym}|${e.amount}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// 텍스트 붙여넣기 파싱(JSON 배열 또는 분류,항목,귀속월,금액[,메모])
export function parsePastedText(text) {
  const t = (text || '').trim();
  if (!t) return [];
  if (t.startsWith('[') || t.startsWith('{')) {
    const arr = JSON.parse(t);
    return Array.isArray(arr) ? arr : [arr];
  }
  return t.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const c = line.split(/\t|,/).map(s => s.trim());
    const [category, name, ym, amount, note] = c;
    return { kind: 'monthly', category, name, ym, amount, note };
  }).filter(e => e.ym && e.amount);
}
