// src/hooks/useKioskMode.js
// 센터 고정 PC를 "AI측정"·"리포트" 탭만 보이는 키오스크 모드로 전환/해제한다.
// localStorage 기반 on/off 상태. 해제는 새 PIN을 만들지 않고 기존 AdminLockGate.jsx와
// 같은 Firebase 관리자 재인증(reauth)을 그대로 재사용한다.

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'momi_kiosk_mode';

export function useKioskMode() {
  const [kioskOn, setKioskOn] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'on';
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, kioskOn ? 'on' : 'off');
    } catch (e) {
      // localStorage 접근 실패는 무시 — 현재 세션 동안은 state로 계속 동작
    }
  }, [kioskOn]);

  const enableKiosk = useCallback(() => setKioskOn(true), []);

  // 관리자 재인증(reauth) 성공 후에만 호출할 것 — 이 함수 자체는 인증을 검사하지 않는다.
  const disableKiosk = useCallback(() => setKioskOn(false), []);

  return { kioskOn, enableKiosk, disableKiosk };
}
