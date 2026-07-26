// utils/viewportLock.js
// ════════════════════════════════════════════════════════════════════════
//  카메라 측정 중에만 화면 확대(핀치 줌)를 잠그고, 끝나면 푼다.
//  일반 화면(회원가입·리포트 등)은 확대 가능, 측정 중엔 의도치 않은 확대 방지.
//  앱은 항상 세로 고정(별도 처리 불필요 — 가로 레이아웃 미지원).
// ════════════════════════════════════════════════════════════════════════
const LOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
const FREE = 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes';

let lockCount = 0;

function setViewport(content) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('app-viewport') || document.querySelector('meta[name="viewport"]');
  if (el) el.setAttribute('content', content);
}

// 측정 시작 시 호출 → 확대 잠금. 중첩 호출 안전(카운트).
export function lockZoom() {
  lockCount++;
  setViewport(LOCKED);
}

// 측정 종료/언마운트 시 호출 → 확대 복원.
export function unlockZoom() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) setViewport(FREE);
}
