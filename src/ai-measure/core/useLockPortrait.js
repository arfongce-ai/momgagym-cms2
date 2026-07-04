// ai-measure/core/useLockPortrait.js
// ════════════════════════════════════════════════════════════════════════
//  AI 측정·분석 사용 중 화면 자동 회전 방지 (세로 고정)
//
//  측정 화면(카메라·각도기·센서)은 세로 기준 배치라, 가로로 회전하면 레이아웃과
//  측정 기준선이 틀어진다. 그래서 이 훅이 활성인 동안 세로를 유지한다.
//
//  두 갈래(브라우저 지원 편차 대응):
//   1) 네이티브 잠금: screen.orientation.lock('portrait').
//      · 설치형 PWA(전체화면)·안드로이드 크롬 등에서 실제 회전이 잠긴다.
//   2) 폴백(잠금 불가 시): 앱을 강제로 회전시키지 않는다. 대신 '가로 상태'를
//      감지해 isBlocked=true 를 반환 → UI 가 "세로로 돌려달라"는 안내를 덮어
//      가로에서의 조작을 잠시 막는다. (과거 CSS body rotate 폴백은 일부 기기에서
//      화면이 검게 되는 문제가 있어 제거했다.)
//
//  반환: isBlocked — 폴백 안내 오버레이 표시 여부(네이티브 잠금 성공 시 항상 false).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';

export function useLockPortrait(active = true) {
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    if (!active) { setIsBlocked(false); return undefined; }
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    let nativeLocked = false;

    // 1) 네이티브 잠금 시도 (지원 환경에서만 성공)
    try {
      const so = window.screen && window.screen.orientation;
      if (so && typeof so.lock === 'function') {
        const p = so.lock('portrait');
        if (p && typeof p.then === 'function') {
          p.then(() => { nativeLocked = true; setIsBlocked(false); }).catch(() => { /* 폴백에 맡김 */ });
        }
      }
    } catch { /* 미지원 — 폴백 */ }

    // 2) 폴백: 가로 감지 시 안내 오버레이 플래그만 올린다(앱은 그대로 둔다)
    const evalOrientation = () => {
      if (nativeLocked) { setIsBlocked(false); return; }
      const isLandscape = window.matchMedia
        ? window.matchMedia('(orientation: landscape)').matches
        : window.innerWidth > window.innerHeight;
      setIsBlocked(isLandscape);
    };
    evalOrientation();

    const mq = window.matchMedia ? window.matchMedia('(orientation: landscape)') : null;
    const onChange = () => evalOrientation();
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange); // 구형 사파리
    }
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);

    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener('change', onChange);
        else if (mq.removeListener) mq.removeListener(onChange);
      }
      setIsBlocked(false);
      try {
        const so = window.screen && window.screen.orientation;
        if (nativeLocked && so && typeof so.unlock === 'function') so.unlock();
      } catch { /* noop */ }
    };
  }, [active]);

  return isBlocked;
}

export default useLockPortrait;
