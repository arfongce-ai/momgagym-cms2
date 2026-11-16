// preventPullRefresh.js — 화면을 아래로 끌어당길 때(위로 스크롤) 브라우저 새로고침이 걸려
// 측정·리포트 화면이 날아가는 것을 막는다. (2026-11-16)
// CSS overscroll-behavior 가 먹히지 않는 브라우저를 위한 보조: 스크롤 맨 위에서 손가락을 아래로 끌 때만 막는다.
//  - 스크롤 가능한 안쪽 영역이 맨 위가 아니면(scrollTop > 0) 정상 스크롤을 건드리지 않는다.
//  - 두 손가락(확대)·가로 스와이프·입력창·캔버스·영상 조작은 건드리지 않는다.
const SKIP = 'input, textarea, select, canvas, video, [data-allow-pull], [contenteditable="true"]';

export function scrollableAncestorAtTop(el) {
  let node = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.nodeType === 1) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
        return node.scrollTop <= 0;
      }
    }
    node = node.parentElement;
  }
  const root = document.scrollingElement || document.documentElement;
  return (root?.scrollTop || 0) <= 0;
}

export function installPreventPullRefresh(target = document) {
  if (typeof document === 'undefined') return () => {};
  let startY = 0; let startX = 0; let tracking = false;
  const onStart = (e) => {
    tracking = e.touches.length === 1;
    if (tracking) { startY = e.touches[0].clientY; startX = e.touches[0].clientX; }
  };
  const onMove = (e) => {
    if (!tracking || e.touches.length !== 1 || !e.cancelable) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    if (dy <= 4 || Math.abs(dy) < Math.abs(dx)) return; // 아래로 끄는 세로 동작만
    const t = e.target;
    if (t?.closest?.(SKIP)) return;
    if (scrollableAncestorAtTop(t)) e.preventDefault();
  };
  const onEnd = () => { tracking = false; };
  target.addEventListener('touchstart', onStart, { passive: true });
  target.addEventListener('touchmove', onMove, { passive: false });
  target.addEventListener('touchend', onEnd, { passive: true });
  target.addEventListener('touchcancel', onEnd, { passive: true });
  return () => {
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchmove', onMove);
    target.removeEventListener('touchend', onEnd);
    target.removeEventListener('touchcancel', onEnd);
  };
}
