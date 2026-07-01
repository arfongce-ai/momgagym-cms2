// ai-measure/core/trackFusion.js
// ════════════════════════════════════════════════════════════════════════
//  바벨 추적 다중 신호 융합(요구사항 2) — "할 수 있는 모든 방법을 동원".
//
//  신호 3종:
//   1) color   — 사용자가 탭으로 지정한 엔드캡/원판 색 추적(endcapTracker).
//                가장 정밀(사용자가 직접 지정한 지점) → 기본 신뢰 1순위.
//   2) skeleton— MediaPipe 손목 관절 중점(barbell.js barbellPoint).
//                항상 계산 가능(색 학습 불필요) → 색 추적이 가려짐 등으로
//                끊겼을 때의 대체 신호이자, 색 추적이 튀었는지 검증하는 기준.
//   3) plate   — 원판 색 인식(plates.js)으로 학습한 IWF 색 태그를 매 프레임
//                큰 색 덩어리(블롭)로 계속 추적(createPlateBlobTracker).
//                원판은 엔드캡보다 면적이 커서 조명 변화에도 안정적.
//
//  융합 규칙(측정 정직성 · 근거기반):
//   - color 신호가 살아있으면(활성 추적점 ≥1) 그 값을 위치의 정답으로 그대로
//     쓴다(사용자가 직접 지정했으므로 임의로 덮어쓰지 않음).
//   - 대신 다른 신호와의 거리(agreement)를 기록해 "서로 다른 방법이 같은
//     곳을 가리키는지" 교차검증 지표로 남긴다 — 점프 모듈의 cross-validation
//     이 게이트가 아니라 advisory(참고) 인 것과 동일한 설계.
//   - color 신호가 완전히 소실되면(가려짐 등) skeleton/plate 신호의 가중
//     평균으로 대체해 궤적이 끊기지 않게 하되, 그 프레임은 'fallback'으로
//     표시해 신뢰도 점수에 반영한다(silently 정밀한 척하지 않음).
// ════════════════════════════════════════════════════════════════════════

const DEFAULT_AGREE_TOL = 0.09; // 화면비율(0~1) — 이 안이면 "같은 곳을 가리킨다"

/**
 * 한 프레임의 추적 후보들을 융합.
 * @param {object} input
 * @param {{x:number,y:number}|null} input.colorPoint   색 추적기 대표 좌표(EMA)
 * @param {number} input.colorActive                    색 추적기 살아있는 점 수
 * @param {{x:number,y:number}|null} input.skeletonPoint barbellPoint(lms) 결과
 * @param {{x:number,y:number}|null} input.plateColorPoint 원판 블롭 추적 결과
 * @param {{agreeTol?:number}} [opts]
 * @returns {{
 *   point:{x:number,y:number}|null,
 *   source:'color'|'fused_fallback'|'skeleton'|'plate'|'none',
 *   agreement:number|null,     // 0~1, primary 와 나머지 후보들의 일치 비율
 *   usedFallback:boolean,
 * }}
 */
export function fuseTrackingCandidates(input = {}, opts = {}) {
  const { colorPoint = null, colorActive = 0, skeletonPoint = null, plateColorPoint = null } = input;
  const AGREE_TOL = opts.agreeTol ?? DEFAULT_AGREE_TOL;

  const candidates = [];
  if (colorPoint && colorActive > 0) candidates.push({ src: 'color', pt: colorPoint, weight: 1.0 });
  if (plateColorPoint) candidates.push({ src: 'plate', pt: plateColorPoint, weight: 0.65 });
  if (skeletonPoint) candidates.push({ src: 'skeleton', pt: skeletonPoint, weight: 0.45 });

  if (!candidates.length) return { point: null, source: 'none', agreement: null, usedFallback: false };

  candidates.sort((a, b) => b.weight - a.weight);
  const primary = candidates[0];
  const others = candidates.slice(1);

  let agreement = null;
  if (others.length) {
    let agree = 0;
    others.forEach((c) => {
      const d = Math.hypot(c.pt.x - primary.pt.x, c.pt.y - primary.pt.y);
      if (d <= AGREE_TOL) agree += 1;
    });
    agreement = Math.round((agree / others.length) * 100) / 100;
  }

  if (primary.src === 'color') {
    return { point: primary.pt, source: 'color', agreement, usedFallback: false };
  }

  // color 소실 — 남은 신호들의 가중 평균으로 대체(끊김 없는 궤적 유지).
  let sx = 0, sy = 0, sw = 0;
  candidates.forEach((c) => { sx += c.pt.x * c.weight; sy += c.pt.y * c.weight; sw += c.weight; });
  const point = sw ? { x: sx / sw, y: sy / sw } : primary.pt;
  const source = candidates.length > 1 ? 'fused_fallback' : primary.src;
  return { point, source, agreement, usedFallback: true };
}

/**
 * 한 세트(기록 구간) 동안 누적한 프레임별 융합 결과로 교차검증 요약을 계산.
 * @param {Array<{source:string, agreement:number|null}>} frames
 * @returns {{ totalFrames:number, fallbackFrames:number, assistRatio:number|null,
 *             avgAgreement:number|null }}
 */
export function summarizeCrossValidation(frames) {
  const list = Array.isArray(frames) ? frames : [];
  if (!list.length) return { totalFrames: 0, fallbackFrames: 0, assistRatio: null, avgAgreement: null };
  const fallbackFrames = list.filter(f => f.usedFallback || f.source === 'fused_fallback' || f.source === 'skeleton' || f.source === 'plate').length;
  const agreements = list.map(f => f.agreement).filter(v => typeof v === 'number');
  const avgAgreement = agreements.length
    ? Math.round((agreements.reduce((s, v) => s + v, 0) / agreements.length) * 100) / 100
    : null;
  return {
    totalFrames: list.length,
    fallbackFrames,
    assistRatio: Math.round((fallbackFrames / list.length) * 100) / 100,
    avgAgreement,
  };
}
