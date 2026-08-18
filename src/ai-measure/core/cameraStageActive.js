// ai-measure/core/cameraStageActive.js
// ════════════════════════════════════════════════════════════════════════
//  풀스크린 카메라 측정 화면(CameraStage)이 떠 있는지 여부 — 전역 상태.
//
//  · skeletonPref.js / trajectoryPref.js 와 동일 패턴(전역 상태 + 구독).
//  · [2026-08-18] "momi 버튼이 계속 화면을 가린다" 요청 대응 — AppLayout에
//    상시 떠 있는 momi 음성 버튼(GlobalVoiceCommand/KioskVoiceCommand)이
//    z-index 1000으로 카메라 스테이지(z-index 60, index.css .cam-stage)
//    위에 그려져, 측정 중 스켈레톤·게이지·녹화 버튼을 가리고 있었다.
//  · 모든 측정 탭이 공용으로 쓰는 CameraStage.jsx가 마운트/언마운트 시
//    setCameraStageActive(true/false)를 호출하면, momi 버튼 쪽에서
//    useCameraStageActive()로 구독해 반투명하게 낮추면 된다 — ROM뿐 아니라
//    점프/자세/보행/바벨/SLST/오버헤드스쿼트/녹화 등 카메라를 쓰는 모든
//    측정 화면에 자동으로 적용된다(CameraStage 공용 컴포넌트 한 곳만
//    고치면 되므로 탭마다 따로 배선할 필요 없음).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';

let activeCount = 0; // 중첩 마운트 대비 카운터(단순 boolean 대신) — StrictMode 이중 mount에도 안전.
const subscribers = new Set();

function notify() {
  const v = activeCount > 0;
  subscribers.forEach((fn) => { try { fn(v); } catch (e) { /* noop */ } });
}

// 현재 카메라 스테이지가 떠 있는지. O(1) 조회.
export function isCameraStageActive() {
  return activeCount > 0;
}

// CameraStage.jsx가 마운트 시 호출 — 반환값(해제 함수)을 언마운트 시 호출한다.
export function markCameraStageActive() {
  activeCount += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCount = Math.max(0, activeCount - 1);
    notify();
  };
}

export function subscribeCameraStageActive(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// React 훅 — momi 버튼 등에서 구독용.
export function useCameraStageActive() {
  const [active, setActive] = useState(isCameraStageActive);
  useEffect(() => subscribeCameraStageActive(setActive), []);
  return active;
}
