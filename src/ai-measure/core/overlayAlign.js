// ai-measure/core/overlayAlign.js
// 오버레이 비교 도구(OverlayCompare.jsx)의 순수 기하 계산.
// DOM/React에 의존하지 않아 단위 테스트가 쉽다 — bodyMetrics.js와 같은 원칙
// (기존 recordSink.js/bodyMetrics.js처럼 로직을 컴포넌트 밖으로 뽑아 공식
// 불일치를 막는다).

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** object-fit: contain 배치 시, 스테이지 안에서 미디어가 그려질 사각형. */
export function computeContainRect(nw, nh, bw, bh) {
  if (!nw || !nh) return { x: 0, y: 0, w: bw, h: bh };
  const scale = Math.min(bw / nw, bh / nh);
  const w = nw * scale;
  const h = nh * scale;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

/**
 * translate(x,y) + scale(s)를 풀어, ankleB(레이어 B의 로컬/미변환 좌표)가
 * ankleA(레이어 A의 최종 표시 좌표)에 정확히 겹치고, ref~ankle 세로 길이가
 * 같아지도록(=신체 크기가 맞춰지도록) 하는 변환값을 계산한다.
 *
 * CSS `transform: translate(tx,ty) scale(sx,sy)`는 스테이지 중심을 원점으로
 * "먼저 스케일 → 그다음 고정 픽셀만큼 이동"하는 것과 같아서(각 transform
 * 함수가 이전 좌표계 위에 순서대로 합성됨), 아래 식은 그 역연산이다.
 */
export function solveAutoAlign(opts) {
  const {
    stageW, stageH, rectA, rectB, ankleA, ankleB, refA, refB,
    flip, scaleMin, scaleMax, offsetMin, offsetMax,
  } = opts;

  const ankleADisp = { x: rectA.x + ankleA.x * rectA.w, y: rectA.y + ankleA.y * rectA.h };
  const refADisp = { x: rectA.x + refA.x * rectA.w, y: rectA.y + refA.y * rectA.h };
  const heightA = Math.abs(ankleADisp.y - refADisp.y);

  const ankleBLocal = { x: rectB.x + ankleB.x * rectB.w, y: rectB.y + ankleB.y * rectB.h };
  const refBLocal = { x: rectB.x + refB.x * rectB.w, y: rectB.y + refB.y * rectB.h };
  const heightB = Math.abs(ankleBLocal.y - refBLocal.y);

  let scalePct = 100;
  if (heightB > 1e-3 && heightA > 1e-3) scalePct = (heightA / heightB) * 100;
  scalePct = clamp(scalePct, scaleMin, scaleMax);
  const s = scalePct / 100;
  const sx = flip ? -s : s;
  const sy = s;

  const origin = { x: stageW / 2, y: stageH / 2 };
  let tx = ankleADisp.x - origin.x - sx * (ankleBLocal.x - origin.x);
  let ty = ankleADisp.y - origin.y - sy * (ankleBLocal.y - origin.y);
  tx = clamp(Math.round(tx), offsetMin, offsetMax);
  ty = clamp(Math.round(ty), offsetMin, offsetMax);

  return { x: tx, y: ty, scale: Math.round(scalePct) };
}

/**
 * PoseLandmarker 검출 결과(BlazePose 33점)에서 발목 중점(27·28)과
 * 어깨 중점(11·12, 없으면 발목 위 40% 지점으로 대체)을 뽑는다.
 */
export function extractAnkleData(result) {
  const lm = result && result.landmarks && result.landmarks[0];
  if (!lm || !lm.length) return null;
  const lA = lm[27];
  const rA = lm[28];
  const lS = lm[11];
  const rS = lm[12];
  let ankle;
  if (lA && rA) ankle = { x: (lA.x + rA.x) / 2, y: (lA.y + rA.y) / 2 };
  else ankle = lA || rA;
  if (!ankle) return null;
  let ref;
  if (lS && rS) ref = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
  else if (lS || rS) ref = lS || rS;
  else ref = { x: ankle.x, y: Math.max(0, ankle.y - 0.4) };
  return { ankle, ref };
}
