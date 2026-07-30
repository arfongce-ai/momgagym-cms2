// ai-measure/core/useCameraRotation.js
// ════════════════════════════════════════════════════════════════════════
//  카메라 화면 회전 보정.
//  일부 웹캠(세로형으로 설계된 USB 웹캠, 일부 노트북 내장캠 등)은 원본 영상
//  자체가 90도/180도 돌아간 채로 들어온다. 카메라 기종·마운트 방식마다 원인이
//  달라 자동 판별이 불가능해서, 사람이 눈으로 보고 직접 맞추게 한다.
//
//  이 값은 "이 카메라(이 기기)"에 고정된 하드웨어 특성이라 로그인/회원과 무관
//  하다 — 그래서 Firestore 가 아니라 이 브라우저의 localStorage 에 저장한다
//  (useKioskMode 와 동일한 판단 기준).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'momi.cameraRotationDeg';
const STEPS = [0, 90, 180, 270];
// 같은 페이지 안에서 여러 화면(라이브 표시용 CameraStage + 녹화 합성용 측정
// 컴포넌트)이 각자 이 훅을 부른다. localStorage 는 새로고침 후에만 반영되므로,
// 버튼을 누른 즉시 다른 인스턴스도 같이 갱신되도록 커스텀 이벤트로 동기화한다.
const SYNC_EVENT = 'momi:camera-rotation-changed';

function readStoredRotation() {
  try {
    const raw = Number(window.localStorage.getItem(STORAGE_KEY));
    return STEPS.includes(raw) ? raw : 0;
  } catch {
    return 0;
  }
}

/**
 * @returns {[number, () => void]} [현재 회전값(0|90|180|270), 다음 값으로 돌리는 함수]
 */
export function useCameraRotation() {
  const [rotationDeg, setRotationDeg] = useState(0);

  useEffect(() => {
    setRotationDeg(readStoredRotation());
    const onSync = (e) => {
      if (typeof e?.detail === 'number' && STEPS.includes(e.detail)) setRotationDeg(e.detail);
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const cycleRotation = useCallback(() => {
    setRotationDeg((prev) => {
      const next = STEPS[(STEPS.indexOf(prev) + 1) % STEPS.length];
      try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* 저장 실패해도 이번 세션에선 계속 동작 */ }
      try { window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: next })); } catch { /* noop */ }
      return next;
    });
  }, []);

  return [rotationDeg, cycleRotation];
}

export default useCameraRotation;
