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

// A4 세로 비율(높이/폭). 297/210.
export const A4_RATIO = 297 / 210;

// 캔버스 높이가 A4 한 장을 넘으면 어느 높이에서 자를지 계산한다(순수 함수 — 테스트 대상).
//  heightPx: 전체 높이, pagePx: A4 한 장 높이, candidates: 섹션 경계 후보(px, 오름차순 불필요).
//  후보 중 현재 페이지 하단 50~100% 구간에서 가장 큰 값을 골라 카드/섹션 중간이 잘리지 않게 한다.
//  후보가 없으면 A4 높이에서 그냥 자른다. 1.03배 이내는 한 장으로 본다(미세 초과 허용).
export function computeA4Breaks(heightPx, pagePx, candidates = []) {
  if (!(heightPx > 0) || !(pagePx > 0) || heightPx <= pagePx * 1.03) return [];
  const cands = candidates.filter((c) => Number.isFinite(c) && c > 0 && c < heightPx).sort((a, b) => a - b);
  const breaks = [];
  let start = 0;
  while (heightPx - start > pagePx * 1.03) {
    const limit = start + pagePx;
    let cut = limit;
    for (let i = cands.length - 1; i >= 0; i -= 1) {
      if (cands[i] <= limit && cands[i] > start + pagePx * 0.5) { cut = cands[i]; break; }
    }
    breaks.push(Math.round(cut));
    start = cut;
  }
  return breaks;
}

// DOM 노드 → A4 크기 JPG File 배열. 내용이 A4 한 장보다 길면 섹션 경계에서 나눠
// 여러 장(_p1, _p2 …)으로 만든다. 프린트 시 A4 한 장 안에 맞게 출력된다.
export async function captureNodeToA4JpgFiles(node, filename, { scale = 2, bg = '#0f172a', width } = {}) {
  const html2canvas = await loadHtml2Canvas();
  const opts = { backgroundColor: bg, scale, useCORS: true, logging: false };
  if (width) opts.windowWidth = width;
  // 캡처용 복제 DOM 에서 섹션 경계(자식·손자 요소 하단)를 측정한다 — 캡처 폭 기준 레이아웃.
  const tag = `a4cap-${Date.now()}`;
  node.setAttribute('data-a4-cap', tag);
  let candidates = [];
  opts.onclone = (doc) => {
    try {
      const el = doc.querySelector(`[data-a4-cap="${tag}"]`);
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const out = [];
      Array.from(el.children).forEach((c) => {
        out.push(c.getBoundingClientRect().bottom - top);
        Array.from(c.children).forEach((g) => out.push(g.getBoundingClientRect().bottom - top));
      });
      candidates = out;
    } catch (e) { /* 측정 실패 시 A4 높이에서 단순 분할 */ }
  };
  let canvas;
  try { canvas = await html2canvas(node, opts); } finally { node.removeAttribute('data-a4-cap'); }

  const toFile = async (c, name) => {
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('이미지 변환 실패');
    return new File([blob], name, { type: 'image/jpeg' });
  };
  const pagePx = Math.round(canvas.width * A4_RATIO);
  const breaks = computeA4Breaks(canvas.height, pagePx, candidates.map((c) => c * scale));
  if (!breaks.length) return [await toFile(canvas, filename)];

  const edges = [0, ...breaks, canvas.height];
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '.jpg';
  const files = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const sh = edges[i + 1] - edges[i];
    const page = document.createElement('canvas');
    page.width = canvas.width;
    page.height = pagePx;
    const ctx = page.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.drawImage(canvas, 0, edges[i], canvas.width, sh, 0, 0, canvas.width, sh);
    files.push(await toFile(page, `${stem}_p${i + 1}${ext}`));
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
      files.push(await captureNodeToJpgFile(reportNode, `몸가짐_${baseName}_리포트.jpg`));
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
