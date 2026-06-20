// xlsx(SheetJS)를 CDN에서 1회 로드해 캐시한다.
// package.json 의존성으로 넣지 않아 Cloudflare 빌드를 가볍게 유지하고,
// 엑셀 가져오기를 실제로 쓸 때만 브라우저에서 스크립트를 받아온다.
let _xlsxPromise = null;

// 공식 CDN 우선, 실패 시 대체 CDN 순서로 시도
const XLSX_SOURCES = [
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX 로드 실패')));
    s.onerror = () => reject(new Error('script error: ' + src));
    document.head.appendChild(s);
  });
}

export function loadXLSX() {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = (async () => {
    let lastErr;
    for (const src of XLSX_SOURCES) {
      try { return await loadScript(src); }
      catch (e) { lastErr = e; }
    }
    _xlsxPromise = null;
    throw new Error('엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하거나, 카카오톡 등 앱 내 브라우저가 아닌 크롬·사파리에서 시도해 주세요.');
  })();
  return _xlsxPromise;
}
