// ai-measure/core/trackFusion.js
// ════════════════════════════════════════════════════════════════════════
//  바벨 추적 다중 신호 융합(요구사항 2) — "할 수 있는 모든 방법을 동원".
//
//  신호 3종:
//   1) plate   — 원판 색 인식(plates.js)으로 학습한 IWF 색 태그를 매 프레임
//                큰 색 덩어리(블롭)로 계속 추적(createPlateBlobTracker).
//                원판은 엔드캡보다 면적이 커서 조명 변화·가림에 안정적이고
//                바와 강체로 함께 움직이므로 수직 이동 측정엔 동등하게
//                유효 → 살아있으면 기본(1순위) 신호로 승격(개선 2).
//   2) color   — 사용자가 탭으로 지정한 엔드캡/원판 색 추적(endcapTracker).
//                원판 신호가 없을 때는 여전히 1순위(사용자가 직접 지정).
//                원판 신호가 있을 때는 2순위(교차검증용 보조 신호).
//   3) skeleton— MediaPipe 손목 관절 중점(barbell.js barbellPoint).
//                항상 계산 가능(색 학습 불필요) → 색/원판 추적이 가려짐
//                등으로 끊겼을 때의 최종 대체 신호이자 교차검증 기준.
//
//  융합 규칙(측정 정직성 · 근거기반):
//   - plate 신호가 살아있으면 그 값을 위치의 정답으로 쓴다(면적이 커서
//     가장 안정적). 없으면 color 를 정답으로 쓴다(사용자가 직접 지정).
//     — 단, 나머지 두 독립 신호가 서로는 합의(가까움)하는데 primary(plate
//     또는 color) 만 거기서 크게 벗어나 있으면 그 프레임은 드리프트로 보고
//     둘의 합의 지점으로 대체한다(색·원판 추적 모두 시간이 지나며 바닥·
//     배경 등으로 서서히 "걸어가 버릴" 수 있음 — 계속 자신 있게 틀린 값을
//     내놓지 않는다).
//   - 대신 다른 신호와의 거리(agreement)를 기록해 "서로 다른 방법이 같은
//     곳을 가리키는지" 교차검증 지표로 남긴다 — 점프 모듈의 cross-validation
//     이 게이트가 아니라 advisory(참고) 인 것과 동일한 설계.
//   - plate·color 신호가 모두 소실되면(가려짐 등) skeleton 으로 대체해
//     궤적이 끊기지 않게 하되, 그 프레임은 'fallback'으로 표시해 신뢰도
//     점수에 반영한다(silently 정밀한 척하지 않음).
// ════════════════════════════════════════════════════════════════════════

const DEFAULT_AGREE_TOL = 0.09; // 화면비율(0~1) — 이 안이면 "같은 곳을 가리킨다"
const CONSENSUS_TOL = 0.07;     // skeleton/plate 두 독립 신호가 이 안이면 "서로 합의"로 본다
const COLOR_OUTLIER_TOL = 0.15; // color 가 그 합의 지점에서 이만큼 멀면 드리프트로 간주(거부)

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
 *   colorRejected?:boolean,    // true면 color가 primary였다가 이 프레임에서 드리프트로 거부됨
 *   plateRejected?:boolean,    // true면 plate가 primary였다가 이 프레임에서 드리프트로 거부됨
 * }}
 */
export function fuseTrackingCandidates(input = {}, opts = {}) {
  const { colorPoint = null, colorActive = 0, skeletonPoint = null, plateColorPoint = null } = input;
  const AGREE_TOL = opts.agreeTol ?? DEFAULT_AGREE_TOL;

  const candidates = [];
  // 원판 신호가 있으면 원판을 1순위로 승격(개선 2) — 엔드캡 색보다 면적이
  // 커서 조명 변화에 안정적이고, 바와 강체로 같이 움직이므로 수직 이동
  // 측정에는 동등하게 유효하다. 원판이 없을 때는 기존처럼 color 가 1순위.
  if (plateColorPoint) candidates.push({ src: 'plate', pt: plateColorPoint, weight: 1.0 });
  if (colorPoint && colorActive > 0) candidates.push({ src: 'color', pt: colorPoint, weight: plateColorPoint ? 0.9 : 1.0 });
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

  if (primary.src === 'color' || primary.src === 'plate') {
    // 드리프트 방지 안전망(측정 정직성) — primary(색 또는 원판)가 시간이
    // 지나며 바닥/배경 등 엉뚱한 곳으로 서서히 옮겨갈 수 있다. 나머지 두
    // "독립적인" 신호가 서로는 합의하는데 primary 만 그 지점에서 크게
    // 벗어나 있다면, primary 를 그 프레임만 신뢰하지 않고 둘의 합의 지점을
    // 대신 쓴다(계속 자신 있게 틀린 값을 내놓지 않는다). 세 신호가 모두
    // 있을 때만(others.length===2) 판단 가능 — 둘뿐이면 교차검증 불가라
    // 기존처럼 primary 를 그대로 신뢰한다.
    if (others.length === 2) {
      const [a, b] = others;
      const abDist = Math.hypot(a.pt.x - b.pt.x, a.pt.y - b.pt.y);
      if (abDist <= CONSENSUS_TOL) {
        const midX = (a.pt.x + b.pt.x) / 2;
        const midY = (a.pt.y + b.pt.y) / 2;
        const dPrimary = Math.hypot(primary.pt.x - midX, primary.pt.y - midY);
        if (dPrimary > COLOR_OUTLIER_TOL) {
          const out = { point: { x: midX, y: midY }, source: 'fused_fallback', agreement, usedFallback: true };
          if (primary.src === 'color') out.colorRejected = true; else out.plateRejected = true;
          return out;
        }
      }
    }
    return { point: primary.pt, source: primary.src, agreement, usedFallback: false };
  }

  // color·plate 둘 다 소실 — 남은 신호(사실상 skeleton)만으로 대체, 궤적은
  // 끊기지 않되 정밀도가 낮은 방법에 의존했음을 fallback 으로 표시.
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
  // plate 는 개선 2로 color 와 동급의 1순위(신뢰) 신호가 됐으므로 더 이상
  // 그 자체로 fallback 취급하지 않는다 — usedFallback 플래그(진짜 대체 발생)
  // 와 명시적 'fused_fallback'/'skeleton' 소스만 대체 프레임으로 집계한다.
  const fallbackFrames = list.filter(f => f.usedFallback || f.source === 'fused_fallback' || f.source === 'skeleton').length;
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
