// ai-measure/core/reportShare.js
// ════════════════════════════════════════════════════════════════════════
//  리포트(JPG) + 영상(비디오 파일)을 함께 저장/공유하는 공용 유틸.
//  · html2canvas 를 CDN 에서 1회 로드해 리포트 DOM 을 JPG 로 캡처.
//  · Web Share API 로 [리포트 JPG + 영상] 을 한 번에 공유(모바일).
//  · Web Share 미지원/실패 시 각각 다운로드로 폴백.
//  영상은 용량이 커 Firestore 에 올리지 않으므로, 이 공유가 영상 전달 경로다.
// ════════════════════════════════════════════════════════════════════════

// ── 카카오톡 공유 ────────────────────────────────────────────────────────
//  측정 결과의 핵심 요약(상위 3건 + 종합점수)만 Kakao Feed 템플릿으로 공유.
//  · JS 키는 빌드 환경변수 VITE_KAKAO_JS_KEY 에서 주입(없으면 안내만 반환).
//  · SDK 는 index.html 에서 defer 로 로드 → window.Kakao 준비를 잠시 기다린다.
//  · 실패 시 throw 하지 않고 { ok:false, msg } 를 돌려 UI 가 친절히 안내하게 한다.
import { shareSummaryToKakao } from './unifiedReport';

const KAKAO_JS_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_KAKAO_JS_KEY) || '';

async function waitForKakao(timeoutMs = 3000) {
  if (typeof window === 'undefined') return null;
  if (window.Kakao) return window.Kakao;
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (window.Kakao) return resolve(window.Kakao);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * 측정 요약을 카카오톡으로 공유.
 * @param {object} summaryInput  통합 summary 또는 리포트(빌더가 요약 추출)
 * @param {object} opts          { webUrl, memberName, title, buttonTitle, imageUrl }
 * @returns {Promise<{ok, msg}>}  실패해도 throw 하지 않음
 */
export async function shareMeasurementSummaryToKakao(summaryInput, opts = {}) {
  if (!KAKAO_JS_KEY) {
    return { ok: false, msg: '카카오 공유 키가 설정되지 않았습니다. 관리자에게 문의하세요.' };
  }
  const Kakao = await waitForKakao();
  if (!Kakao) {
    return { ok: false, msg: '카카오 SDK를 불러오지 못했습니다. 네트워크를 확인하세요.' };
  }
  try {
    await shareSummaryToKakao(summaryInput, {
      ...opts,
      Kakao,
      javascriptKey: KAKAO_JS_KEY,
      webUrl: opts.webUrl || (typeof window !== 'undefined' ? window.location.href : ''),
    });
    return { ok: true, msg: '카카오톡 공유 창을 열었습니다.' };
  } catch (e) {
    return { ok: false, msg: `카카오 공유 실패: ${e?.message || '알 수 없는 오류'}` };
  }
}

// data:URL(예: canvas.toDataURL) → File. 자세 측정 면별 스냅샷 저장용.
export function dataUrlToFile(dataUrl, filename) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('잘못된 이미지 데이터');
  }
  const [head, body] = dataUrl.split(',');
  const mimeMatch = /data:([^;]+)/.exec(head);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(body);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

let _h2cPromise = null;
export async function loadHtml2Canvas() {
  if (typeof window === 'undefined') throw new Error('no window');
  if (window.html2canvas) return window.html2canvas;
  if (_h2cPromise) return _h2cPromise;
  _h2cPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('html2canvas 로드 실패'));
    document.head.appendChild(s);
  });
  return _h2cPromise;
}

// DOM 노드 → JPG File. 실패 시 throw.
// width 를 주면 html2canvas의 windowWidth로 넘겨, 실제 폰 화면 너비가 좁아도
// max-width(A4 794px 등) CSS가 캡처 시점엔 그 너비 기준으로 적용되게 한다.
// (안 주면 지금 화면에 실제로 렌더링된 좁은 폭 그대로 캡처돼 세로로 길쭉하게 나온다.)
export async function captureNodeToJpgFile(node, filename, { scale = 2, bg = '#0f172a', width } = {}) {
  const html2canvas = await loadHtml2Canvas();
  const opts = { backgroundColor: bg, scale, useCORS: true, logging: false };
  if (width) opts.windowWidth = width;
  const canvas = await html2canvas(node, opts);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) throw new Error('이미지 변환 실패');
  return new File([blob], filename, { type: 'image/jpeg' });
}

// [A4 JPG 2026-11-13] 리포트 노드를 '정확한 A4 비율(210×297)' JPG 로 만든다 — 저장·전송·프린트 모두 같은 파일.
//  · 내용이 A4 한 장보다 짧으면 배경색으로 채워 한 장으로 만든다.
//  · 한 장보다 아주 조금(6% 이내) 길면 한 장에 맞게 줄인다.
//  · 그보다 길면 A4 높이 단위로 나눠 여러 장(매수 제한 없음)으로 만든다.
export const A4_RATIO = 297 / 210;

export function planA4Pages(widthPx, heightPx) {
  const pageH = Math.round(widthPx * A4_RATIO);
  if (heightPx <= pageH) return { pageH, mode: 'pad', pages: 1 };
  if (heightPx <= pageH * 1.06) return { pageH, mode: 'fit', pages: 1 };
  return { pageH, mode: 'slice', pages: Math.ceil(heightPx / pageH) };
}

function resolveNodeBg(node, fallback) {
  try {
    const c = getComputedStyle(node).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)) return c;
  } catch (e) { /* 무시 */ }
  return fallback;
}

// 복제본(clone)을 항상 같은 폭(A4 794px)으로 고정하고, 카드 경계(자르기 좋은 위치)를 모아 돌려준다.
//  · 기기(폰/PC) 화면 폭과 상관없이 같은 레이아웃·같은 해상도로 캡처된다.
//  · 글자는 html2canvas 가 DOM 보다 살짝 아래에 그리므로 위로 보정한다.
function prepareCloneForA4(clonedDoc, clonedEl, width, breaks) {
  try {
    const st = clonedEl.style;
    st.width = `${width}px`; st.maxWidth = `${width}px`; st.minWidth = `${width}px`;
    st.margin = '0'; st.boxSizing = 'border-box'; st.transform = 'none';
    const fix = clonedDoc.createElement('style');
    fix.textContent = '.report-a4-page *{letter-spacing:normal !important}.report-a4-page img{max-width:100%}';
    clonedDoc.head.appendChild(fix);
    // 글자만 든 말단 요소(칩·배지·숫자 등)를 위로 살짝 올려 DOM 화면과 같은 높이로 맞춘다.
    clonedEl.querySelectorAll('*').forEach((el) => {
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasOwnText) return;
      if (el.parentElement && el.parentElement.closest('[data-a4-shifted]')) return; // 부모가 이미 올렸으면 건너뜀(이중 이동 방지)
      const cs = clonedDoc.defaultView.getComputedStyle(el);
      if (cs.position !== 'static') return;
      el.style.position = 'relative';
      el.style.top = '-0.2em';
      el.setAttribute('data-a4-shifted', '1');
    });
    const top = clonedEl.getBoundingClientRect().top;
    clonedEl.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 36 || r.width < width * 0.3) return;
      breaks.push(Math.round(r.bottom - top));
    });
    breaks.sort((x, y) => x - y);
  } catch (e) { /* 보정 실패해도 캡처는 계속 */ }
}

// 한 장(pageH)을 넘기면 '카드 경계' 중 페이지 끝에 가장 가까운(60% 이상 채운) 위치에서 자른다.
export function planCutPoints(totalH, pageH, breaks) {
  const cuts = [0];
  let start = 0;
  while (totalH - start > pageH * 1.02) {
    const limit = start + pageH;
    let cut = limit;
    for (let i = breaks.length - 1; i >= 0; i -= 1) {
      if (breaks[i] <= limit && breaks[i] >= start + pageH * 0.6) { cut = breaks[i]; break; }
    }
    cuts.push(cut);
    start = cut;
  }
  cuts.push(totalH);
  return cuts;
}

export async function captureNodeToA4Files(node, baseName, { scale = 2, width = 794, bg } = {}) {
  const html2canvas = await loadHtml2Canvas();
  const pageBg = bg || resolveNodeBg(node, '#ffffff');
  const breaks = [];
  // html2canvas 는 '원본' 노드 크기로 캔버스를 만들므로, 캡처하는 동안만 원본도 A4 폭으로 고정한다.
  const prev = node.getAttribute('style');
  node.style.width = `${width}px`; node.style.maxWidth = `${width}px`; node.style.minWidth = `${width}px`;
  let canvas;
  try {
    canvas = await html2canvas(node, {
      backgroundColor: pageBg, scale, useCORS: true, logging: false, windowWidth: width,
      onclone: (doc, el) => prepareCloneForA4(doc, el, width, breaks),
    });
  } finally {
    if (prev === null) node.removeAttribute('style'); else node.setAttribute('style', prev);
  }
  const k = canvas.width / width; // css px → canvas px
  const pageH = Math.round(canvas.width * A4_RATIO);
  const total = canvas.height;
  let cuts;
  if (total <= pageH * 1.06) cuts = [0, total];
  else cuts = planCutPoints(total, pageH, breaks.map((y) => Math.round(y * k)));
  const pageCanvases = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const sy = cuts[i];
    const sh = cuts[i + 1] - sy;
    const page = document.createElement('canvas');
    page.width = canvas.width;
    page.height = pageH;
    const ctx = page.getContext('2d');
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, page.width, page.height);
    if (sh > pageH) { // 6% 이내로 긴 한 장 → 한 장에 맞춤
      const f = pageH / sh;
      const w = canvas.width * f;
      ctx.drawImage(canvas, 0, sy, canvas.width, sh, (page.width - w) / 2, 0, w, pageH);
    } else {
      ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
    }
    pageCanvases.push(page);
  }
  const files = [];
  for (let i = 0; i < pageCanvases.length; i += 1) {
    const blob = await new Promise((res) => pageCanvases[i].toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('이미지 변환 실패');
    const suffix = pageCanvases.length > 1 ? `_A4_${i + 1}` : '_A4';
    files.push(new File([blob], `${baseName}${suffix}.jpg`, { type: 'image/jpeg' }));
  }
  return files;
}

function triggerDownload(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

/**
 * 리포트 캡처 + 영상을 함께 공유/저장.
 * @param {HTMLElement} reportNode  캡처할 리포트 DOM (없으면 영상만)
 * @param {Blob|null}   videoBlob   녹화 영상 (없으면 리포트만)
 * @param {object}      opts        { baseName, title }
 * @returns {Promise<{ok, mode, msg}>}
 */
export async function shareReportWithVideo(reportNode, videoBlob, { baseName = '분석', title = '분석 리포트' } = {}) {
  const files = [];
  // 1) 리포트 JPG
  if (reportNode) {
    try {
      files.push(...await captureNodeToA4Files(reportNode, `몸가짐_${baseName}_리포트`));
    } catch (e) { /* 캡처 실패해도 영상은 시도 */ }
  }
  // 2) 영상
  if (videoBlob) {
    const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    files.push(new File([videoBlob], `몸가짐_${baseName}_영상.${ext}`, { type: videoBlob.type }));
  }
  if (!files.length) return { ok: false, mode: 'none', msg: '공유할 항목이 없습니다.' };

  // Web Share (모바일) — 리포트+영상 한 번에
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ title, files });
      return { ok: true, mode: 'share', msg: '리포트와 영상을 공유했습니다.' };
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: false, mode: 'cancel', msg: '' };
      // 폴백으로 진행
    }
  }
  // 폴백: 각각 다운로드
  files.forEach(triggerDownload);
  return { ok: true, mode: 'download', msg: '리포트/영상을 기기에 저장했습니다.' };
}
