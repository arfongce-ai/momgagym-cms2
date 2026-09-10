// src/hooks/useIsDesktop.js
// "폰에서는 모미를 쓰지 않고, PC·키오스크에서만 쓴다"를 판단하기 위한 훅.
// 이미 앱 전체(AppLayout 사이드바 hidden md:flex / 모바일 하단바 md:hidden)가
// 데스크탑 기준으로 쓰고 있는 Tailwind 'md' 브레이크포인트(768px)와 동일한
// 기준을 JS 쪽에서도 그대로 써서, "모바일 레이아웃이 보이는 화면 = 모미도 안 뜨는 화면"이
// 항상 일치하도록 맞춘다. 기기 종류(UA) 대신 화면 너비로 판단하므로, 같은 폰이라도
// 가로 모드로 크게 회전하면 데스크탑 취급될 수 있음 — 하지만 그 경우 UI 자체가
// 이미 데스크탑 레이아웃으로 바뀌어 있으므로(같은 브레이크포인트) 모미만 예외로
// 남는 것보다 일관되게 맞추는 편이 낫다고 판단.

import { useState, useEffect } from 'react';

const QUERY = '(min-width: 768px)';

function getInitial() {
  try {
    return window.matchMedia(QUERY).matches;
  } catch (e) {
    // matchMedia 자체가 없는 아주 오래된 환경 — 안전하게 "폰"으로 취급(모미 숨김)
    return false;
  }
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(getInitial);

  useEffect(() => {
    let mql;
    try {
      mql = window.matchMedia(QUERY);
    } catch (e) {
      return;
    }
    const onChange = (e) => setIsDesktop(e.matches);
    // 구형 Safari는 addEventListener를 지원 안 할 수 있어 addListener로 폴백.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return isDesktop;
}
