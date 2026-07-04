// ai-measure/core/useLockPortrait.js
// ════════════════════════════════════════════════════════════════════════
//  AI 측정·분석 사용 중 화면 자동 회전 방지 (세로 고정)
//
//  측정 화면(카메라 미리보기·각도기·센서)은 세로 기준으로 배치돼 있어, 사용 중
//  기기가 가로로 회전하면 레이아웃이 틀어지고 측정 기준선도 흔들린다. 그래서
//  이 훅이 활성인 동안에는 화면을 세로로 고정한다.
//
//  두 갈래로 처리(브라우저 지원 편차 대응):
//   1) 네이티브 잠금: screen.orientation.lock('portrait').
//      · 설치형 PWA(전체화면 모드)나 안드로이드 크롬 등에서 동작한다.
//      · 다만 대부분의 모바일 '브라우저 탭'에서는 전체화면이 아니면 거부된다.
//   2) CSS 폴백: 네이티브 잠금이 안 되는 환경에서, 기기가 가로로 돌아가면
//      <html> 에 클래스를 붙여 앱 전체를 반대로 90° 회전시켜 '세로처럼' 보이게
//      한다. (실제 회전은 막지 못하는 웹 환경에서 UI 기준을 세로로 유지하는 수단)
//
//  주의: 폴백 회전은 사용자가 물리적으로 기기를 돌렸을 때만 개입한다. 세로로
//  들고 있으면 아무 변화도 없다. 훅이 언마운트되면 잠금·클래스를 모두 해제한다.
// ════════════════════════════════════════════════════════════════════════
import { useEffect } from 'react';

const LOCK_CLASS = 'ai-portrait-lock';

export function useLockPortrait(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    let nativeLocked = false;
    const root = document.documentElement;

    // 1) 네이티브 잠금 시도 (지원 환경에서만 성공)
    const tryNativeLock = () => {
      try {
        const so = window.screen && window.screen.orientation;
        if (so && typeof so.lock === 'function') {
          const p = so.lock('portrait');
          if (p && typeof p.then === 'function') {
            p.then(() => { nativeLocked = true; }).catch(() => { /* 전체화면 아님 등 — 폴백에 맡김 */ });
          }
        }
      } catch { /* 미지원 — 폴백 */ }
    };
    tryNativeLock();

    // 2) CSS 폴백: 가로 감지 시 <html> 에 클래스 부여/해제
    const applyFallback = () => {
      if (nativeLocked) { root.classList.remove(LOCK_CLASS); return; }
      const isLandscape = (() => {
        if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
        return window.innerWidth > window.innerHeight;
      })();
      root.classList.toggle(LOCK_CLASS, isLandscape);
    };
    applyFallback();

    const mq = window.matchMedia ? window.matchMedia('(orientation: landscape)') : null;
    const onChange = () => applyFallback();
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
      root.classList.remove(LOCK_CLASS);
      try {
        const so = window.screen && window.screen.orientation;
        if (nativeLocked && so && typeof so.unlock === 'function') so.unlock();
      } catch { /* noop */ }
    };
  }, [active]);
}

export default useLockPortrait;
