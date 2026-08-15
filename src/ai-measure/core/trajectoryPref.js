// ai-measure/core/trajectoryPref.js
// ════════════════════════════════════════════════════════════════════════
//  손·발 궤적 오버레이 모드(ON/OFF) — skeletonPref.js와 동일한 패턴
//  (전역 상태 + localStorage 영속 + 구독 통지)이지만, 완전히 독립된 설정이다.
//  스켈레톤을 꺼도 궤적만 켜둘 수 있고, 반대도 가능하다.
//
//  · 신규 기능이라 사용자가 예상 못한 상태로 화면이 갑자기 복잡해지지
//    않도록 기본값은 OFF(스켈레톤은 기존 동작 유지를 위해 기본 ON인 것과
//    다름 — 궤적은 완전히 새 오버레이라 opt-in으로 시작한다).
//  · 켜지면 손목(15/16)·발목(27/28) 랜드마크의 최근 위치를 짧게(약 1.2초)
//    "잔상"처럼 남긴다 — 촬영 시작부터 전체 누적이 아니라 최근 움직임만
//    보여주는 방식(화면이 지저분해지지 않도록).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'aiTrajectoryOverlay';

function readInitial() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (v === '1') return true;
    return false; // 기본값 OFF(신규 오버레이는 opt-in)
  } catch (e) {
    return false;
  }
}

let enabled = readInitial();
const subscribers = new Set();

// 현재 궤적 표시 여부. draw 루프에서 매 프레임 호출해도 되는 O(1) 조회.
export function isTrajectoryEnabled() {
  return enabled;
}

export function setTrajectoryEnabled(next) {
  const v = !!next;
  if (v === enabled) return;
  enabled = v;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch (e) { /* 저장 실패해도 세션 내 동작 */ }
  subscribers.forEach((fn) => { try { fn(v); } catch (e) { /* noop */ } });
}

export function subscribeTrajectory(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// React 훅 — 토글 UI 용. [on, setOn]
export function useTrajectoryOverlay() {
  const [on, setOn] = useState(isTrajectoryEnabled);
  useEffect(() => subscribeTrajectory(setOn), []);
  return [on, setTrajectoryEnabled];
}
