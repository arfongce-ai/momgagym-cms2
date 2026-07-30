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

// 세로 고정 차단 여부를 결정하는 순수 함수 (테스트·훅 양쪽에서 공용으로 사용).
// PC(마우스/트랙패드가 주 입력장치)는 물리적으로 회전할 수 없으므로 절대 차단하지
// 않는다 — 넓은 창(landscape)이어도 그냥 PC의 정상 상태일 뿐이다. 터치기기에서만,
// 그리고 네이티브 잠금이 아직 안 걸린 상태에서만 가로를 "차단 대상"으로 본다.
export function shouldBlockPortrait({ isTouchPrimary, isLandscape, nativeLocked }) {
  return Boolean(isTouchPrimary && isLandscape && !nativeLocked);
}

export function useLockPortrait(active = true) {
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    if (!active) { setIsBlocked(false); return undefined; }
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    // PC(마우스/트랙패드) 판별: pointer:coarse 는 터치처럼 정밀도가 낮은 주 입력장치일
    // 때만 참이다. 노트북 트랙패드·마우스는 pointer:fine → isTouchPrimary=false 이고,
    // 이 경우 아래 잠금/가로감지 로직에 들어가지도 않고 즉시 차단 해제 상태로 반환한다.
    const isTouchPrimary = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    if (!isTouchPrimary) { setIsBlocked(false); return undefined; }

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
      const isLandscape = window.matchMedia
        ? window.matchMedia('(orientation: landscape)').matches
        : window.innerWidth > window.innerHeight;
      setIsBlocked(shouldBlockPortrait({ isTouchPrimary, isLandscape, nativeLocked }));
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
