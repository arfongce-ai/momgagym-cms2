// ai-measure/core/recordSink.js
// ════════════════════════════════════════════════════════════════════════
//  녹화 영상 저장 — 트레이너 폰에 "몸가짐ai" 식별 파일명으로 저장.
//   · 측정 데이터(JSON)는 Firestore 에, 녹화 영상은 폰에 분리 저장하는 정책.
//   · Web Share(navigator.share) 가 가능하면 갤러리/파일앱 저장 시트를 띄우고,
//     아니면 a[download] 로 직접 내려받는다(RecordMeasure 패턴 표준화).
//   · 파일명은 사람이 폴더에서 모아 보기 쉽게 '몸가짐_AI' 접두 + 종목 + 회원 + 날짜.
//     (실제 OS 폴더 생성은 브라우저 권한 밖이라, 식별 가능한 접두로 '몸가짐 AI'
//      묶음을 만든다. 저장 위치는 사용자가 공유 시트에서 폴더를 고른다.)
// ════════════════════════════════════════════════════════════════════════

/** 파일명에 못 쓰는 문자를 안전치환. */
function safeSeg(s) {
  return String(s ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'na';
}

/** YYYYMMDD (로컬). */
function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** HHMMSS (로컬) — 같은 날 여러 측정 파일이 안 겹치게. */
function hms(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}${m}${s}`;
}

/** blob MIME → 확장자. */
export function extForBlob(blob) {
  const t = (blob?.type || '').toLowerCase();
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  return 'webm';
}

/**
 * 측정 영상 표준 파일명 생성.
 *  예) 몸가짐_AI_벤치프레스_홍길동_20260630_142035.webm
 * @param {{ measure?:string, member?:object, ext?:string, at?:Date }} opts
 */
export function buildVideoFileName({ measure, member, ext = 'webm', at = new Date() } = {}) {
  const who = safeSeg(member?.name || (member?.isVirtual ? '미등록회원' : 'guest'));
  const what = safeSeg(measure || 'measure');
  return `몸가짐_AI_${what}_${who}_${ymd(at)}_${hms(at)}.${ext}`;
}

/**
 * 녹화 영상을 트레이너 폰에 저장.
 *  - Web Share(파일 공유) 지원 시: 공유 시트 → 갤러리/파일앱/드라이브 등에 저장.
 *  - 미지원/취소 시: a[download] 로 직접 다운로드(폴백).
 * @param {Blob} blob
 * @param {{ measure?:string, member?:object, at?:Date }} meta
 * @returns {Promise<{ saved:boolean, method:'share'|'download'|'none', fileName:string }>}
 */
export async function saveVideoToPhone(blob, meta = {}) {
  if (!blob) return { saved: false, method: 'none', fileName: '' };
  const ext = extForBlob(blob);
  const fileName = buildVideoFileName({ ...meta, ext });

  // 1) Web Share(파일) — 모바일에서 갤러리/파일앱으로 저장하기 가장 자연스러움.
  try {
    if (typeof navigator !== 'undefined' && navigator.canShare) {
      const file = new File([blob], fileName, { type: blob.type || 'video/webm' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
        return { saved: true, method: 'share', fileName };
      }
    }
  } catch (e) {
    // 사용자가 공유 시트를 닫은 경우(AbortError)는 폴백하지 않고 종료.
    if (e?.name === 'AbortError') return { saved: false, method: 'share', fileName };
    // 그 외 오류는 다운로드 폴백으로 진행.
  }

  // 2) 다운로드 폴백.
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 잠시 후 URL 해제(다운로드 시작 시간 확보).
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { saved: true, method: 'download', fileName };
  } catch (e) {
    return { saved: false, method: 'none', fileName };
  }
}

/** 지원되는 녹화 MIME 우선순위에서 첫 지원값 반환(없으면 ''). */
export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const order = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
  return order.find(m => MediaRecorder.isTypeSupported(m)) || '';
}
