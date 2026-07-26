// ai-measure/core/bodyCog.js
// ════════════════════════════════════════════════════════════════════════
//  전신 무게중심(COG) 자동 추정(요구사항 3) — 바벨 리프팅 "측면" 촬영 전용.
//
//  왜 측면에서만:
//   - 역도 코칭에서 핵심 지표 중 하나가 "바가 몸의 무게중심에서 얼마나
//     멀어지는가"(수평 이격) 인데, 이는 시상면(옆에서 본 모습)에서만 의미가
//     있다. 정면에서는 좌우 랜드마크가 겹쳐 보여 깊이(전후) 정보를 알 수
//     없으므로 계산을 거부한다(측정 정직성 — postureMath.js 의 "측면에서는
//     CoG/BoS 계산 거부"와 반대 방향이지만 같은 원칙: 촬영 방향에 안 맞는
//     계산은 하지 않는다).
//   - 촬영 방향은 framingGuide.js 의 assessFraming().orientation 을 그대로
//     사용(어깨 가로 간격 기반) — 이미 화면에 안내 중인 값과 일관되게.
//
//  방법(2D 근사 · 분절 질량비):
//   - de Leva(1996, adjusted Zatsiorsky-Seluyanov) 성인 평균 분절질량비(%BW)
//     사용. 각 분절의 질량중심은 두 끝 관절의 중점으로 근사(카메라 한 대의
//     2D 좌표 한계상 분절 내 정밀 비율 대신 중점 근사 — 임상 정밀도 아님).
//   - 측면 촬영에서는 카메라 반대쪽 팔다리가 가려지므로, 좌/우 중 가시성
//     합이 큰 쪽 한쪽만으로 전신을 대표(같은 편 분절 질량비를 좌우 합산치로
//     사용 — 반대쪽도 카메라 쪽과 거의 겹쳐 보인다는 시상면 가정).
//   - 핵심 분절(머리/몸통/다리)이 다수 누락되면(usedMass<0.55) 계산을 거부.
// ════════════════════════════════════════════════════════════════════════

import { LM } from './geometry';

const VIS = 0.3;
function vis(p) { return p && (p.visibility == null || p.visibility >= VIS); }
function mid(a, b) {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return a || b || null;
}

// de Leva(1996) 성인 평균 분절 질량비(%BW). 좌우 분절은 측면 촬영 특성상
// 좌우 합산치를 그대로 사용(한쪽만 보이지만 반대쪽도 거의 같은 위치로 가정).
const SEGMENT_MASS = Object.freeze({
  head: 0.0694,
  trunk: 0.4346,
  upperArm: 0.0271 * 2,
  forearm: 0.0162 * 2,
  hand: 0.0061 * 2,
  thigh: 0.1416 * 2,
  shank: 0.0433 * 2,
  foot: 0.0137 * 2,
});
// 총합 검증용(호출부·테스트에서 참고): 6.94+43.46+2*(2.71+1.62+0.61+14.16+4.33+1.37)=100%

const MIN_SEGMENT_COVERAGE = 0.55; // 이보다 적은 질량비만 계산 가능하면 거부

/**
 * 시상면(측면) 전신 무게중심 추정.
 * @param {Array} lms MediaPipe pose landmarks(33개)
 * @param {'side'|'front'|'unknown'} orientation assessFraming() 결과의 orientation
 * @returns {{
 *   available:boolean, point:{x:number,y:number}|null, reason?:string,
 *   visibleSide?:'left'|'right', segmentCoverage?:number,
 * }}
 */
export function estimateBodyCOG(lms, orientation) {
  if (orientation !== 'side') {
    return { available: false, point: null, reason: 'not_side_view' };
  }
  if (!lms || !lms.length) {
    return { available: false, point: null, reason: 'no_pose' };
  }

  // 측면에서는 카메라 쪽 한쪽만 잘 보인다 — 가시성 합이 큰 쪽을 대표로.
  const leftVisSum = [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_WRIST]
    .reduce((s, i) => s + (lms[i]?.visibility ?? 0), 0);
  const rightVisSum = [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_WRIST]
    .reduce((s, i) => s + (lms[i]?.visibility ?? 0), 0);
  const side = leftVisSum >= rightVisSum ? 'left' : 'right';
  const pfx = side === 'left' ? 'LEFT_' : 'RIGHT_';
  const at = (name) => lms[LM[`${pfx}${name}`]];

  const ear = vis(at('EAR')) ? at('EAR') : (vis(lms[LM.NOSE]) ? lms[LM.NOSE] : null);
  const shoulder = at('SHOULDER'), elbow = at('ELBOW'), wrist = at('WRIST');
  const hip = at('HIP'), knee = at('KNEE'), ankle = at('ANKLE');
  const heel = at('HEEL'), foot = at('FOOT');

  const core = [shoulder, hip, knee, ankle];
  if (!core.every(vis)) {
    return { available: false, point: null, reason: 'insufficient_landmarks', visibleSide: side };
  }

  const segs = [];
  if (vis(ear) && vis(shoulder)) segs.push([SEGMENT_MASS.head, mid(ear, shoulder)]);
  if (vis(shoulder) && vis(hip)) segs.push([SEGMENT_MASS.trunk, mid(shoulder, hip)]);
  if (vis(shoulder) && vis(elbow)) segs.push([SEGMENT_MASS.upperArm, mid(shoulder, elbow)]);
  if (vis(elbow) && vis(wrist)) segs.push([SEGMENT_MASS.forearm, mid(elbow, wrist)]);
  if (vis(wrist)) segs.push([SEGMENT_MASS.hand, wrist]);
  if (vis(hip) && vis(knee)) segs.push([SEGMENT_MASS.thigh, mid(hip, knee)]);
  if (vis(knee) && vis(ankle)) segs.push([SEGMENT_MASS.shank, mid(knee, ankle)]);
  const footPt = vis(foot) ? foot : (vis(heel) ? heel : null);
  if (vis(ankle) && footPt) segs.push([SEGMENT_MASS.foot, mid(ankle, footPt)]);

  const usedMass = segs.reduce((s, [m]) => s + m, 0);
  if (usedMass < MIN_SEGMENT_COVERAGE) {
    return { available: false, point: null, reason: 'insufficient_segments', visibleSide: side };
  }

  let x = 0, y = 0;
  segs.forEach(([m, p]) => { x += p.x * m; y += p.y * m; });
  x /= usedMass; y /= usedMass;

  return {
    available: true,
    point: { x, y },
    visibleSide: side,
    segmentCoverage: Math.round(usedMass * 100) / 100,
  };
}

/**
 * 바벨-COG 수평 거리(정규화 0~1). 값이 클수록 바가 몸통 무게중심에서
 * 수평으로 멀어짐(비효율 궤적 — 역도 코칭에서 "바를 몸에 붙여라"의 근거지표).
 */
export function barCogHorizontalGap(barPoint, cogPoint) {
  if (!barPoint || !cogPoint) return null;
  return Math.abs(barPoint.x - cogPoint.x);
}
