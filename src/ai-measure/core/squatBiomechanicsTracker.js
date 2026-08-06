// ai-measure/core/squatBiomechanicsTracker.js
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트 프레임 추적기 — singleLegStanceTracker.js와 동일한 패턴
//  (StandingCalibrator로 서기 기준선 확보 → push(lm,tMs) → summary()).
//  SLST가 "한 번의 유지(hold)"를 추적하는 것과 달리, 이 추적기는 "내려갔다
//  올라오는 한 번의 반복(rep)"을 시행(trial) 1개로 본다 — 한 영상 안에서
//  연속된 최대 2회의 반복을 자동으로 구분해 추적한다.
//
//  역할: "카메라가 본 것"(landmarks 스트림)을 squatBiomechanics.js가 받는
//  {trial1, trial2} 입력 형태로 바꾸기만 한다 — 정상/주의/위험 판정은 하지
//  않는다(역할 분리, 다른 tracker들과 동일한 원칙).
//
//  ── 정면 카메라 전제 — 깊이(thighInclineDeg) 계산 방식 ──
//  오버헤드 딥 스쿼트는 정면에서 촬영한다(양팔을 위로 든 자세를 정면에서 봐야
//  좌우 무릎 외반·골반 쏠림이 보인다). 그런데 원래 thighInclineDeg 정의
//  (대퇴부가 수평에서 얼마나 못 미쳤는지)는 측면 촬영을 전제로 한 각도 공식이라,
//  정면 영상에서는 무릎이 앞으로 나가는 움직임(X축)이 거의 안 보여 그대로 쓸 수
//  없다 — 대신 "엉덩이 Y좌표가 무릎 Y좌표에 얼마나 가까워졌는지"(수직 접근도)로
//  깊이를 추정하고, 기존 임계값(SQUAT_TUNING)과 호환되도록 0~90° 스케일로
//  환산한다: 서 있을 때 ≈90°(전혀 안 앉음), 무릎 높이까지 앉으면(패러렐) ≈0°.
//  torsoLeanDeg(엉덩이-어깨 벡터 vs 수직)·pelvicTiltDeg(골반 라인 vs 수평)는
//  2D 이미지 좌표 각도라 촬영 방향에 무관하게 그대로 쓴다. kneeValgusDeg(FPPA)는
//  오히려 정면에서 가장 잘 보이는 지표라 정면 촬영이 유리하다.
//
//  ⚠ 측정 한계(결과에 그대로 노출):
//   · 정면 촬영 특성상 상체 전방 기울기(torsoLeanDeg)는 순수 시상면 굽힘을
//     완전히 포착하지 못할 수 있다(측면 성분이 섞여야 각도 변화가 뚜렷해짐).
//   · balanceLoss는 SLST와 동일하게 "골반 이동 속도 급변" 휴리스틱 추정치다.
//   · heelLift는 발뒤꿈치 랜드마크(29/30)의 Y좌표가 서기 기준선보다 뜨는지로
//     판정한다 — 신발·바닥 대비가 낮으면 랜드마크 신뢰도가 떨어질 수 있다.
// ════════════════════════════════════════════════════════════════════════

import { OneEuroFilter } from './gaitBiomechanics';
import { StandingCalibrator } from './jumpBiomechanics';

// 화면(UI)에서 캘리브레이션도 이 파일 하나만 import 하도록 재노출.
export { StandingCalibrator };

export const SQUAT_TRACK_TUNING = {
  // ── 반복(rep) 구간 판정 ──
  descendStartFrac: 0.12,   // 서기 기준 대비 엉덩이-무릎 간격의 이만큼 내려가야 '하강 시작'
  standingReturnFrac: 0.06, // 이 이하로 돌아오면 '기립 복귀'(반복 완료) 판정
  minDepthForValidRep: 0.20, // 이 정도 깊이(0~1, 무릎 접근도)도 못 채운 반복은 오검출로 폐기

  // ── 필터 ──
  filterMinCutoff: 1.0,
  filterBeta: 0.01,

  // ── 균형 상실(휴리스틱, SLST와 동일 원칙) ──
  balanceLossVelocityThreshold: 0.35,

  // ── 뒤꿈치 들림 ──
  heelLiftBandFrac: 0.035, // 서기 기준 뒤꿈치 Y 대비 이만큼 뜨면 heelLift
};

const HIP_L = 23, HIP_R = 24;
const KNEE_L = 25, KNEE_R = 26;
const ANK_L = 27, ANK_R = 28;
const HEEL_L = 29, HEEL_R = 30;
const SHO_L = 11, SHO_R = 12;
const ELB_L = 13, ELB_R = 14;
const WRI_L = 15, WRI_R = 16;
const EAR_L = 7, EAR_R = 8;

function mid(lm, a, b) {
  if (!lm || !lm[a] || !lm[b]) return null;
  return { x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 };
}

export function pelvicTiltDegOf(lm) {
  if (!lm || !lm[HIP_L] || !lm[HIP_R]) return null;
  const dy = lm[HIP_R].y - lm[HIP_L].y;
  const dx = lm[HIP_R].x - lm[HIP_L].x;
  if (!dx && !dy) return 0;
  return Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
}

function torsoLeanDegOf(lm) {
  const hip = mid(lm, HIP_L, HIP_R);
  const sho = mid(lm, SHO_L, SHO_R);
  if (!hip || !sho) return null;
  const dx = sho.x - hip.x;
  const dy = hip.y - sho.y; // 위로 갈수록 y가 작아지므로 부호 반전
  if (!dx && !dy) return 0;
  return Math.abs((Math.atan2(dx, dy) * 180) / Math.PI); // 수직축(dy) 기준 편차
}

// FPPA 근사: hip→knee 벡터와 knee→ankle 벡터가 이루는 각(무릎 정점 기준)이
// 180°(일직선)에서 벗어난 정도 = 무릎이 안/밖으로 쏠린 각도. 좌우 중 더 큰 값.
export function kneeValgusDegOf(lm) {
  const oneLeg = (hipI, kneeI, ankI) => {
    if (!lm?.[hipI] || !lm?.[kneeI] || !lm?.[ankI]) return null;
    const v1 = { x: lm[hipI].x - lm[kneeI].x, y: lm[hipI].y - lm[kneeI].y };
    const v2 = { x: lm[ankI].x - lm[kneeI].x, y: lm[ankI].y - lm[kneeI].y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    if (!mag) return null;
    const angleAtKnee = (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
    return Math.abs(180 - angleAtKnee);
  };
  const left = oneLeg(HIP_L, KNEE_L, ANK_L);
  const right = oneLeg(HIP_R, KNEE_R, ANK_R);
  if (left == null && right == null) return null;
  return Math.max(left ?? 0, right ?? 0);
}

// [2026-08-03] 팔(어깨→손목 벡터)이 수직에서 앞으로 떨어진 각 — squatFms.js의
// evaluateSquatFrame()이 측면 뷰에서 쓰는 armDropDeg 값을 이 함수가 만든다.
// torsoLeanDegOf와 완전히 같은 계산 방식(기준점→끝점 벡터의 수직 편차, atan2)을
// 그대로 따른다: 0°=손목이 어깨 바로 위(완전한 수직), 클수록 앞으로 떨어진 것.
// 좌우 중 kneeValgusDegOf와 같은 원칙으로 더 나쁜(큰) 쪽을 쓴다 — 오버헤드
// 스쿼트는 양팔을 함께 들지만 카메라 각도상 한쪽만 뚜렷이 보이는 경우가 있어,
// 보이는 쪽 중 더 크게 벗어난 값을 놓치지 않기 위함이다.
export function armDropDegOf(lm) {
  const oneArm = (shoI, wriI) => {
    const sho = lm?.[shoI], wri = lm?.[wriI];
    if (!sho || !wri) return null;
    const dx = wri.x - sho.x;
    const dy = sho.y - wri.y; // 위로 갈수록 y가 작아지므로 부호 반전(손목이 어깨보다 위면 양수)
    if (!dx && !dy) return 0;
    return Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
  };
  const left = oneArm(SHO_L, WRI_L);
  const right = oneArm(SHO_R, WRI_R);
  if (left == null && right == null) return null;
  return Math.max(left ?? 0, right ?? 0);
}

// [2026-08-06] squatJointAngles.js(라이브 화면 표시용)의 11개 각도 중 방향·크기가
// 명확한 5개만 이 판정 로직에 연결한다. 나머지(어깨/고관절/무릎/발목 굽힘)는
// 스쿼트 깊이에 따라 "정상적으로" 계속 바뀌는 각도라 시행 전체를 대표하는 단일
// 목표값이 없다(이미 thighInclineDeg·torsoLeanDeg가 깊이·기울기를 대표값으로
// 판정 중이라 중복/모순 신호를 피함) — 화면 표시만 유지하고 여기엔 추가하지 않는다.
// 같은 이유로 귀-어깨 간격(정면)도 절대거리라 카메라 거리·고개 회전에 흔들려
// 제외하고, 대신 더 안정적인 headTiltDegOf(귀-귀 각도)만 연결한다.

// CoG(어깨-엉덩이 평균) 발목 수직선 대비 편차각(측면) — squatJointAngles.js의
// cogOverAnkleDeg와 동일한 근사·부호 규칙, 절대값만 쓴다(방향 무관 크기 판정).
export function cogOverAnkleDegOf(lm, side) {
  const sho = lm?.[side === 'left' ? SHO_L : SHO_R];
  const hip = lm?.[side === 'left' ? HIP_L : HIP_R];
  const ank = lm?.[side === 'left' ? ANK_L : ANK_R];
  if (!sho || !hip || !ank) return null;
  const cog = { x: (sho.x + hip.x) / 2, y: (sho.y + hip.y) / 2 };
  const dx = cog.x - ank.x, dy = cog.y - ank.y;
  if (!dx && !dy) return 0;
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
}

// CoG 좌우쏠림(정면) — pelvicTiltDegOf와 같은 절대값 방식(더 넓은 구간 평균이라
// 노이즈가 커 임계값은 pelvicTilt보다 넉넉하게 잡음 — SQUAT_TUNING 주석 참고).
export function cogTiltDegOf(lm) {
  const shoMid = mid(lm, SHO_L, SHO_R), hipMid = mid(lm, HIP_L, HIP_R), ankMid = mid(lm, ANK_L, ANK_R);
  if (!shoMid || !hipMid || !ankMid) return null;
  const cog = { x: (shoMid.x + hipMid.x) / 2, y: (shoMid.y + hipMid.y) / 2 };
  const dx = cog.x - ankMid.x, dy = cog.y - ankMid.y;
  if (!dx && !dy) return 0;
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
}

// 머리 좌우 기울기(정면) — 귀 중점이 어깨 중점 대비 옆으로 쏠린 각.
// [수정] 처음엔 "귀-귀 선이 수평에서 벗어난 각"으로 짰으나 두 가지 문제가 있었다:
//  ① 귀 위치가 반대로(오른쪽 귀 x가 더 작게) 들어오면 atan2(dy,dx)가 0° 대신
//     180°를 반환(부호 버그 — abs()로는 못 고침, atan2 자체가 사분면을 봄).
//  ② 애초에 "귀-귀 선 기울기"는 카메라가 살짝 돌아만 가도(고개는 그대로여도)
//     흔들리는 값이라 안 안정적 — cogTiltDegOf와 같은 "중심선(어깨중점) 대비
//     귀중점 편차각" 방식이 실제 좌우 쏠림을 더 잘 반영한다.
export function headTiltDegOf(lm) {
  const l = lm?.[EAR_L], r = lm?.[EAR_R];
  const shoMid = mid(lm, SHO_L, SHO_R);
  if (!l || !r || !shoMid) return null;
  const earMid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  const dx = earMid.x - shoMid.x, dy = earMid.y - shoMid.y;
  if (!dx && !dy) return 0;
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
}

// 팔꿈치 폄(정면) — 180°=완전히 폄. FMS 오버헤드 스쿼트의 "바를 편 팔로 머리
// 위에 유지" 기준을 수치화. minExt(더 굽은 쪽, 낮을수록 나쁨)와 asymDeg(좌우
// 차이, 한쪽만 처지는 패턴)를 함께 반환 — 둘은 서로 다른 문제라 따로 본다.
export function elbowExtensionOf(lm) {
  const oneArm = (shoI, elbI, wriI) => {
    const sho = lm?.[shoI], elb = lm?.[elbI], wri = lm?.[wriI];
    if (!sho || !elb || !wri) return null;
    const v1 = { x: sho.x - elb.x, y: sho.y - elb.y };
    const v2 = { x: wri.x - elb.x, y: wri.y - elb.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    if (!mag) return null;
    return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
  };
  const left = oneArm(SHO_L, ELB_L, WRI_L);
  const right = oneArm(SHO_R, ELB_R, WRI_R);
  if (left == null && right == null) return null;
  const minExt = Math.min(left ?? 180, right ?? 180);
  const asymDeg = (left != null && right != null) ? Math.abs(left - right) : 0;
  return { minExt, asymDeg };
}

/**
 * 오버헤드 딥 스쿼트 추적기 — 한 영상 안에서 연속된 최대 maxTrials회의
 * 반복(내려갔다 올라오는 1회)을 자동으로 구분해 모은다.
 * @param {object} calib StandingCalibrator.result(locked 이후)
 */
export class SquatBiomechanicsTracker {
  constructor(calib, opts = {}) {
    this.calib = calib;
    this.tuning = { ...SQUAT_TRACK_TUNING, ...opts };
    this.maxTrials = opts.maxTrials ?? 2;

    this.trials = [];
    this.phase = 'waiting'; // waiting | active(하강~상승 전 구간을 통틀어 하나로 취급)
    this._lastMs = null;
    this._resetRep();
  }

  _resetRep() {
    this._filtHipX = new OneEuroFilter({ minCutoff: this.tuning.filterMinCutoff, beta: this.tuning.filterBeta, dCutoff: 1.0 });
    this._filtHipY = new OneEuroFilter({ minCutoff: this.tuning.filterMinCutoff, beta: this.tuning.filterBeta, dCutoff: 1.0 });
    this._minThighIncline = 90; // 이 반복 중 도달한 최소 각도(=최고 깊이)
    this._maxDepthFrac = 0;
    this._maxTorsoLean = 0;
    this._maxKneeValgus = 0;
    this._maxPelvicTilt = 0;
    this._maxArmDrop = 0;
    this._maxCogOverAnkle = 0;
    this._maxCogTilt = 0;
    this._maxHeadTilt = 0;
    this._minElbowExt = 180;
    this._maxElbowAsym = 0;
    this._heelLift = false;
    this._balanceLoss = false;
    this._prevHip = null;
    this._prevT = null;
  }

  markBalanceLoss() {
    if (this.phase === 'active') this._balanceLoss = true;
  }

  finalize(tMs) {
    // 하강 도중 영상이 끝나면(기립 복귀를 못 봤으면) 무리하게 반복으로 세지 않는다
    // (내려가다 만 반복을 완료로 오인하면 실제보다 얕게 나온 것처럼 보일 수 있어서).
    this.phase = 'waiting';
    this._lastMs = tMs;
  }

  push(lm, tMs) {
    if (!this.calib) return;
    this._lastMs = tMs;
    if (this.trials.length >= this.maxTrials) return;

    const hip = mid(lm, HIP_L, HIP_R);
    const knee = mid(lm, KNEE_L, KNEE_R);
    if (!hip || !knee) return;

    const baselineHipY = this.calib.baselinePelvisY ?? this.calib.baselineFeetY;
    const baselineKneeY = this.calib.baselineKneeY ?? knee.y;
    const span = baselineKneeY - baselineHipY; // 서 있을 때 엉덩이-무릎 Y 간격(양수)
    const depthFrac = span > 0 ? Math.max(0, Math.min(1.2, (hip.y - baselineHipY) / span)) : 0;
    const thighIncline = Math.max(0, 90 * (1 - Math.min(1, depthFrac)));

    if (this.phase === 'waiting') {
      if (depthFrac >= this.tuning.descendStartFrac) {
        this.phase = 'active';
      } else {
        return; // 아직 서 있는 상태 — 추적할 것 없음
      }
    }

    // phase === 'active' — 하강~바닥~상승을 통틀어 이 반복의 "가장 나쁜(깊은/기운/모인)" 값을 누적
    this._minThighIncline = Math.min(this._minThighIncline, thighIncline);
    this._maxDepthFrac = Math.max(this._maxDepthFrac, depthFrac);

    const fx = this._filtHipX.filter(hip.x, tMs / 1000);
    const fy = this._filtHipY.filter(hip.y, tMs / 1000);
    if (this._prevHip) {
      const dt = (tMs - this._prevT) / 1000;
      const dist = Math.hypot(fx - this._prevHip.x, fy - this._prevHip.y);
      if (dt > 0 && dist / dt >= this.tuning.balanceLossVelocityThreshold) this._balanceLoss = true;
    }
    this._prevHip = { x: fx, y: fy };
    this._prevT = tMs;

    const torsoLean = torsoLeanDegOf(lm);
    if (torsoLean != null) this._maxTorsoLean = Math.max(this._maxTorsoLean, torsoLean);
    const kneeValgus = kneeValgusDegOf(lm);
    if (kneeValgus != null) this._maxKneeValgus = Math.max(this._maxKneeValgus, kneeValgus);
    const pelvicTilt = pelvicTiltDegOf(lm);
    if (pelvicTilt != null) this._maxPelvicTilt = Math.max(this._maxPelvicTilt, pelvicTilt);
    const armDrop = armDropDegOf(lm);
    if (armDrop != null) this._maxArmDrop = Math.max(this._maxArmDrop, armDrop);
    const cogOverAnkle = cogOverAnkleDegOf(lm, 'left') ?? cogOverAnkleDegOf(lm, 'right');
    if (cogOverAnkle != null) this._maxCogOverAnkle = Math.max(this._maxCogOverAnkle, cogOverAnkle);
    const cogTilt = cogTiltDegOf(lm);
    if (cogTilt != null) this._maxCogTilt = Math.max(this._maxCogTilt, cogTilt);
    const headTilt = headTiltDegOf(lm);
    if (headTilt != null) this._maxHeadTilt = Math.max(this._maxHeadTilt, headTilt);
    const elbowExt = elbowExtensionOf(lm);
    if (elbowExt) {
      this._minElbowExt = Math.min(this._minElbowExt, elbowExt.minExt);
      this._maxElbowAsym = Math.max(this._maxElbowAsym, elbowExt.asymDeg);
    }

    const baselineHeelY = this.calib.baselineHeelY;
    if (baselineHeelY != null) {
      const heelY = lm?.[HEEL_L] && lm?.[HEEL_R]
        ? Math.min(lm[HEEL_L].y, lm[HEEL_R].y) // 둘 중 더 많이 뜬 쪽
        : (lm?.[HEEL_L]?.y ?? lm?.[HEEL_R]?.y ?? null);
      if (heelY != null && heelY < baselineHeelY - this.tuning.heelLiftBandFrac) this._heelLift = true;
    }

    // 기립 복귀 판정: 충분히 내려갔다가(minDepthForValidRep 이상) 다시 기준선 근처로 돌아옴.
    if (depthFrac <= this.tuning.standingReturnFrac && this._maxDepthFrac >= this.tuning.minDepthForValidRep) {
      this.trials.push({
        thighInclineDeg: Math.round(this._minThighIncline * 10) / 10,
        torsoLeanDeg: Math.round(this._maxTorsoLean * 10) / 10,
        kneeValgusDeg: Math.round(this._maxKneeValgus * 10) / 10,
        pelvicTiltDeg: Math.round(this._maxPelvicTilt * 10) / 10,
        armDropDeg: Math.round(this._maxArmDrop * 10) / 10,
        cogOverAnkleDeg: Math.round(this._maxCogOverAnkle * 10) / 10,
        cogTiltDeg: Math.round(this._maxCogTilt * 10) / 10,
        headTiltDeg: Math.round(this._maxHeadTilt * 10) / 10,
        elbowExtensionDeg: Math.round(this._minElbowExt * 10) / 10,
        elbowAsymDeg: Math.round(this._maxElbowAsym * 10) / 10,
        balanceLoss: this._balanceLoss,
        heelLift: this._heelLift,
      });
      this.phase = 'waiting';
      this._resetRep();
    }
  }

  /**
   * squatBiomechanics.js의 evaluateSquatBiomechanics({trial1, trial2})가 그대로
   * 받을 수 있는 형태로 변환.
   */
  summary() {
    const toTrial = (t) => (!t ? undefined : { valid: true, ...t });
    return {
      trial1: toTrial(this.trials[0]),
      trial2: toTrial(this.trials[1]),
      trialsFound: this.trials.length,
    };
  }

  // 라이브 화면에서 "지금 이 반복이 얼마나 깊이 내려갔는지"를 표시하기 위한
  // 조회용(상태 변경 없음) — singleLegStanceTracker.js의 elapsedHoldMs()와 동일한
  // 원칙: 이미 누적 중인 내부 상태를 읽기만 한다.
  liveDepthState() {
    if (this.phase !== 'active') return null;
    return {
      depthFrac: Math.round(this._maxDepthFrac * 100) / 100,
      thighInclineDeg: Math.round(this._minThighIncline * 10) / 10,
    };
  }

  // [2026-08-02] 부위별 색상 오버레이(FMS 보상패턴 표시)용 조회 메서드.
  // liveDepthState()와 같은 원칙 — 내부 누적값을 읽기만 하고 아무것도 바꾸지
  // 않는다. 이 반복(rep) 동안의 "가장 나쁜" 값들이라 색이 시시각각 튀지 않고
  // 한 번 붉어지면 그 반복이 끝날 때까지 유지된다(트레이너가 보기에 안정적).
  liveMetrics() {
    if (this.phase !== 'active') return null;
    return {
      thighInclineDeg: Math.round(this._minThighIncline * 10) / 10,
      torsoLeanDeg: Math.round(this._maxTorsoLean * 10) / 10,
      kneeValgusDeg: Math.round(this._maxKneeValgus * 10) / 10,
      pelvicTiltDeg: Math.round(this._maxPelvicTilt * 10) / 10,
      armDropDeg: Math.round(this._maxArmDrop * 10) / 10,
      cogOverAnkleDeg: Math.round(this._maxCogOverAnkle * 10) / 10,
      cogTiltDeg: Math.round(this._maxCogTilt * 10) / 10,
      headTiltDeg: Math.round(this._maxHeadTilt * 10) / 10,
      elbowExtensionDeg: Math.round(this._minElbowExt * 10) / 10,
      elbowAsymDeg: Math.round(this._maxElbowAsym * 10) / 10,
      heelLift: this._heelLift,
    };
  }
}
