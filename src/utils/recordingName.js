// utils/recordingName.js
// ════════════════════════════════════════════════════════════════════════
//  일반 영상 녹화 파일명 — 촬영할 때마다 고유해야 한다(카톡 즉시 전송 요구).
//  형식: 몸가짐YYMMDDHHmm  (예: 2026-07-06 20:26 → 몸가짐2607062026)
//  같은 '분(minute)' 안에서 연속 촬영하면(10초 영상 × 여러 번 흔함) 이름이
//  겹치므로, 그 경우에만 초(ss)를 덧붙여 고유성을 보장한다.
//   예) 20:26:05 → 몸가짐2607062026
//       20:26:48 → 몸가짐260706202648   (같은 분 → 초 추가)
//       20:30:10 → 몸가짐2607062030
//  '몸가짐' 접두어는 갤러리/카톡에서 묶여 보이는 기존 규칙을 유지한다.
// ════════════════════════════════════════════════════════════════════════

let lastBase = '';

export function recordingExtensionFor(mime = '') {
  return mime.includes('mp4') ? 'mp4' : 'webm';
}

/**
 * 촬영별 고유 파일명 생성. 호출 시점 기준(=녹화 종료 시각).
 * @param {string} mime  MediaRecorder mimeType
 * @param {Date} now     테스트 주입용
 */
export function buildRecordingFileName(mime = '', now = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  const base = `몸가짐${String(now.getFullYear()).slice(-2)}${p2(now.getMonth() + 1)}${p2(now.getDate())}${p2(now.getHours())}${p2(now.getMinutes())}`;
  const name = base === lastBase ? `${base}${p2(now.getSeconds())}` : base;
  lastBase = base;
  return `${name}.${recordingExtensionFor(mime)}`;
}

/** 테스트 전용 — 세션 상태 초기화. */
export function _resetRecordingNameState() { lastBase = ''; }
