// A4 프린트 — 저장·전송하는 A4 JPG 와 똑같은 이미지를 그대로 프린터로 보낸다.
//  · 파일(JPG)을 숨은 iframe 에 A4 한 장씩 깔고 인쇄 창을 연다(장수 제한 없음).
//  · 인쇄 창을 닫으면(afterprint) 정리한다. 이벤트를 못 받는 브라우저를 위해 시간 제한도 둔다.
export function buildPrintHtml(urls) {
  const pages = urls.map((u) => `<div class="pg"><img src="${u}" /></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>몸가짐 리포트</title><style>
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.pg { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
.pg:last-child { page-break-after: auto; break-after: auto; }
.pg img { display: block; width: 210mm; height: 297mm; object-fit: fill; }
</style></head><body>${pages}</body></html>`;
}

export function printImageFiles(files) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (!list.length || typeof document === 'undefined') return Promise.resolve(false);
  const urls = list.map((f) => URL.createObjectURL(f));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    urls.forEach((u) => URL.revokeObjectURL(u));
    iframe.remove();
  };
  return new Promise((resolve) => {
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); resolve(false); return; }
      const imgs = Array.from(win.document.images);
      Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))))
        .then(() => {
          win.addEventListener('afterprint', cleanup);
          setTimeout(cleanup, 10 * 60 * 1000);
          try { win.focus(); win.print(); resolve(true); } catch (e) { cleanup(); resolve(false); }
        });
    };
    iframe.srcdoc = buildPrintHtml(urls);
    document.body.appendChild(iframe);
  });
}
