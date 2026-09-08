// ai-measure/core/trajectoryPref.js
// ════════════════════════════════════════════════════════════════════════
//  손·발 궤적 오버레이 모드(ON/OFF) — skeletonPref.js와 동일한 패턴
//  (전역 상태 + localStorage 영속 + 구독 통지)이지만, 완전히 독립된 설정이다.
//  스켈레톤을 꺼도 궤적만 켜둘 수 있고, 반대도 가능하다.
//
//  · 신규 기능이라 사용자가 예상 못한 상태로 화면이 갑자기 복잡해지지
//    않도록 기본값은 OFF(스켈레톤은 기존 동작 유지를 위해 기본 ON인 것과
//    다름 — 궤적은 완전히 새 오버레이라 opt-in으로 시작한다).
//  · 켜지면 손목(15/16)·발목(27/28) 랜드마크의 최근 위치를 짧게(약 1.5초)
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

/**
 * [발목 궤적 그리기 2026-09-08] 보행·스프린트처럼 발목(27/28) 움직임이 핵심인
 * 화면에서 공용으로 쓰는 그리기 함수. 이 파일이 상태(on/off)를 갖고 있으니
 * 그리기 로직도 같이 둬서, 쓰는 쪽(GaitRunningAnalysis.jsx/SprintLiveAnalysis.jsx)은
 * 매 프레임 한 줄만 호출하면 된다 — 각자 따로 궤적 버퍼를 만들지 않도록.
 * OFF 상태면 이전에 그려둔 궤적 버퍼만 비우고 즉시 반환(스켈레톤 on/off와는
 * 완전히 독립 — 호출부에서 별도 조건 없이 항상 불러도 안전).
 * @param {HTMLCanvasElement} canvas 궤적 버퍼를 캐싱해 둘 캔버스 노드(자체 상태 보관용 —
 *   추가 React ref 없이 canvas.__ankleTrail 에 직접 붙인다).
 * @param {CanvasRenderingContext2D} ctx 이미 clearRect까지 끝난 2D 컨텍스트.
 * @param {(p:{x:number,y:number})=>number} px 정규화 좌표 → 캔버스 픽셀 x 변환 함수.
 * @param {(p:{x:number,y:number})=>number} py 정규화 좌표 → 캔버스 픽셀 y 변환 함수.
 * @param {Array} landmarks 현재 프레임 포즈 랜드마크(27=왼발목, 28=오른발목).
 */
export function drawAnkleTrail(canvas, ctx, px, py, landmarks) {
  if (!isTrajectoryEnabled()) { if (canvas) canvas.__ankleTrail = null; return; }
  if (!canvas || !ctx || !landmarks) return;
  const now = performance.now();
  const trail = canvas.__ankleTrail || (canvas.__ankleTrail = { L: [], R: [] });
  const pushIfVisible = (idx, key) => {
    const p = landmarks[idx];
    if (p && (p.visibility == null || p.visibility >= 0.3)) {
      trail[key].push({ x: px(p), y: py(p), t: now });
    }
  };
  pushIfVisible(27, 'L');
  pushIfVisible(28, 'R');
  const cutoff = now - 1500; // 최근 1.5초만 남긴다 — 계속 누적하면 화면이 지저분해짐
  trail.L = trail.L.filter((pt) => pt.t >= cutoff);
  trail.R = trail.R.filter((pt) => pt.t >= cutoff);
  const drawSide = (pts, rgb) => {
    if (pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const age = (now - b.t) / 1500; // 0(방금)~1(1.5초 전)
      ctx.strokeStyle = `rgba(${rgb},${Math.max(0, (1 - age) * 0.85).toFixed(2)})`;
      ctx.lineWidth = Math.max(1, 4 * (1 - age * 0.6));
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  };
  drawSide(trail.L, '96,165,250');  // 파랑 — 왼발목
  drawSide(trail.R, '251,191,36'); // 주황 — 오른발목
}
