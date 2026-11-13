// A4 인쇄 공통 유틸 — 측정 결과 리포트(.report-a4-page)를 A4 용지에 맞춰 인쇄한다.
//  · 화면의 리포트 노드를 인쇄 전용 영역(#mg-print-root)에 복제해 그 영역만 인쇄한다.
//  · 인쇄 중에는 다크 모드를 잠시 풀어 흰 종이에 검정 글씨로 나오게 한다(잉크 절약).
//  · 리포트 장수는 상관없다 — 페이지(.report-a4-page)마다 새 장으로 나온다.
//  · <canvas>는 복제하면 비므로 그림(img)으로 바꿔 넣는다.

const ROOT_ID = 'mg-print-root';
const STYLE_ID = 'mg-print-style';

const PRINT_CSS = `
@page { size: A4 portrait; margin: 8mm; }
#${ROOT_ID} { display: none; }
@media print {
  html, body { background: #fff !important; }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block !important; }
  #${ROOT_ID} .report-a4-page {
    width: 100% !important; max-width: none !important; min-height: 0 !important;
    margin: 0 0 0 0 !important; border-radius: 0 !important; box-shadow: none !important;
    --tw-ring-shadow: 0 0 #0000 !important;
    break-after: page; page-break-after: always; break-inside: auto;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  #${ROOT_ID} .report-a4-page:last-child { break-after: auto; page-break-after: auto; }
  #${ROOT_ID} [data-html2canvas-ignore], #${ROOT_ID} .no-print { display: none !important; }
  #${ROOT_ID} img, #${ROOT_ID} svg { max-width: 100%; }
}
`;

function cloneForPrint(node) {
  const copy = node.cloneNode(true);
  // 복제본의 canvas 는 비어 있으니 원본 그림을 img 로 대체한다.
  const srcCanvases = node.querySelectorAll('canvas');
  const dstCanvases = copy.querySelectorAll('canvas');
  srcCanvases.forEach((canvas, i) => {
    try {
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.style.width = canvas.style.width || '100%';
      img.style.height = 'auto';
      dstCanvases[i]?.replaceWith(img);
    } catch (e) { /* 보안 제한 canvas 는 그대로 둔다 */ }
  });
  copy.removeAttribute('id');
  return copy;
}

// nodes: 리포트 DOM 노드(여러 장이면 배열). 장수 제한 없음.
export function printReportNodes(nodes) {
  const list = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
  if (!list.length || typeof document === 'undefined') return false;

  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PRINT_CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = ROOT_ID;
  list.forEach((node) => root.appendChild(cloneForPrint(node)));
  document.body.appendChild(root);

  const html = document.documentElement;
  const hadDark = html.classList.contains('dark');
  if (hadDark) html.classList.remove('dark');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener('afterprint', cleanup);
    root.remove();
    style.remove();
    if (hadDark) html.classList.add('dark');
  };
  window.addEventListener('afterprint', cleanup);
  // afterprint 를 못 받는 브라우저 대비 안전장치.
  setTimeout(cleanup, 5 * 60 * 1000);

  // 이미지(로고 등)가 그려진 뒤 인쇄 창을 연다.
  const imgs = Array.from(root.querySelectorAll('img'));
  const ready = Promise.all(imgs.map((img) => (img.complete ? null : new Promise((res) => { img.onload = res; img.onerror = res; }))));
  Promise.race([ready, new Promise((res) => setTimeout(res, 1500))]).then(() => {
    try { window.print(); } catch (e) { cleanup(); }
  });
  return true;
}

// reportNodeId 안의 모든 A4 페이지를 찾아 인쇄한다. 페이지 클래스가 없으면 노드 전체를 한 장으로 인쇄.
export function printReportById(reportNodeId) {
  const node = typeof document !== 'undefined' ? document.getElementById(reportNodeId) : null;
  if (!node) return false;
  const pages = Array.from(node.querySelectorAll('.report-a4-page'));
  const targets = pages.length > 0 ? pages : (node.classList.contains('report-a4-page') ? [node] : [node]);
  return printReportNodes(targets);
}
