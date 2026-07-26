// ai-measure/core/skeletonPref.js
// ════════════════════════════════════════════════════════════════════════
//  스켈레톤 오버레이 모드(ON/OFF) — 모든 측정 화면 공통 설정.
//
//  · 사운드 볼륨(audioCue)과 같은 패턴: 전역 상태 + localStorage 영속
//    + 구독(subscribe) 통지. 카메라 화면의 토글 칩(SkeletonToggleChip)으로
//    측정 중에도 즉시 켜고 끌 수 있다.
//  · OFF 여도 포즈 추적·각도 계산은 그대로 동작한다(측정 정직성 —
//    화면에 그리는 것만 끄고, 데이터 파이프라인은 건드리지 않는다).
//  · 각 모듈의 drawSkeleton 류 함수가 isSkeletonEnabled() 를 확인해
//    OFF 면 캔버스를 비우고 그리지 않는다. ROM 녹화 합성 영상도 동일하게
//    따라간다(OFF = 깨끗한 원본 영상 + 수치 HUD만).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'aiSkeletonOverlay';

function readInitial() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (v === '0') return false;
    return true; // 기본값 ON (기존 동작 유지)
  } catch (e) {
    return true;
  }
}

let enabled = readInitial();
const subscribers = new Set();

// 현재 스켈레톤 표시 여부. draw 루프에서 매 프레임 호출해도 되는 O(1) 조회.
export function isSkeletonEnabled() {
  return enabled;
}

export function setSkeletonEnabled(next) {
  const v = !!next;
  if (v === enabled) return;
  enabled = v;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch (e) { /* 저장 실패해도 세션 내 동작 */ }
  subscribers.forEach((fn) => { try { fn(v); } catch (e) { /* noop */ } });
}

export function subscribeSkeleton(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// React 훅 — 토글 UI 용. [on, setOn]
export function useSkeletonOverlay() {
  const [on, setOn] = useState(isSkeletonEnabled);
  useEffect(() => subscribeSkeleton(setOn), []);
  return [on, setSkeletonEnabled];
}
