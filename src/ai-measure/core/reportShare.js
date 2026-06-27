// ai-measure/core/reportShare.js
// ════════════════════════════════════════════════════════════════════════
//  리포트(JPG) + 영상(비디오 파일)을 함께 저장/공유하는 공용 유틸.
//  · html2canvas 를 CDN 에서 1회 로드해 리포트 DOM 을 JPG 로 캡처.
//  · Web Share API 로 [리포트 JPG + 영상] 을 한 번에 공유(모바일).
//  · Web Share 미지원/실패 시 각각 다운로드로 폴백.
//  영상은 용량이 커 Firestore 에 올리지 않으므로, 이 공유가 영상 전달 경로다.
// ════════════════════════════════════════════════════════════════════════

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
export async function captureNodeToJpgFile(node, filename, { scale = 2, bg = '#0f172a' } = {}) {
  const html2canvas = await loadHtml2Canvas();
  const canvas = await html2canvas(node, { backgroundColor: bg, scale, useCORS: true, logging: false });
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) throw new Error('이미지 변환 실패');
  return new File([blob], filename, { type: 'image/jpeg' });
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
      files.push(await captureNodeToJpgFile(reportNode, `${baseName}_리포트.jpg`));
    } catch (e) { /* 캡처 실패해도 영상은 시도 */ }
  }
  // 2) 영상
  if (videoBlob) {
    const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    files.push(new File([videoBlob], `${baseName}_영상.${ext}`, { type: videoBlob.type }));
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
