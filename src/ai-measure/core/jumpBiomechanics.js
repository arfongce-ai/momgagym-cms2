// ai-measure/core/jumpBiomechanics.js
// ════════════════════════════════════════════════════════════════════════
//  점프 분석 핵심 로직 (순수 함수/클래스 — 단위 테스트 가능)
//  gaitBiomechanics.js 와 동일한 설계 철학:
//   · 현장 튜닝 상수를 JUMP_TUNING 한 곳에 모음 (데이터 쌓이면 이 값만 조정)
//   · 1-Euro 평활 재사용 (검출 떨림 제거)
//   · valid 플래그로 무효 측정 원천 차단 (gait 의 validMinAmp/validMinSteps 와 동형)
//
//  측정 원리 — "비행시간(flight time) 기반" + "골반 변위 교차검증":
//   (1) 주측정: 발(발목 27/28)이 '서 있는 기준선(baseline)'을 떠난 시각(takeoff)과
//       다시 돌아온 시각(landing)의 *실측 타임스탬프 차이* t 로
//         h = g·t²/8   (이륙·착지 높이 동일 가정의 표준식)
//       → 프레임 '개수'가 아니라 ms 타임스탬프로 계산하므로 VFR/드롭/실제 fps
//         오차를 자동 흡수한다. (videoAnalyzer 가 슬로모 보정한 tMs 를 그대로 받음)
//   (2) 교차검증: 같은 구간 골반(23/24) 중점의 수직 변위(정점-기준선)를
//       '서 있는 자세에서 측정한 px↔cm 스케일'로 환산해 독립적으로 높이를 추정.
//       두 값이 JUMP_TUNING.crossTolPct 이상 어긋나면 측정 신뢰도를 떨어뜨린다.
//   (3) sanity: 회원 키(cm) 기준으로 물리적으로 말이 되는 범위인지 점검.
// ════════════════════════════════════════════════════════════════════════

import { OneEuroFilter, angleAt, detectOrientation } from './gaitBiomechanics';
// [SLJ 좌우 비대칭 2026-08-11] findSljAsymmetry가 저장된 리포트에서 세부
// 종류를 판정하는 데 쓴다(jumpSubType 필드가 없는 과거 데이터도 안전하게 처리).
import { resolveJumpSubType } from './jumpTypes';

const G = 9.81;

// ───────── 현장 튜닝 설정 (한 곳에 모음) ─────────
// "정상인데 무효" → minVisibility/standStillTolY/minFlightMs 낮추기
// "이상한데 통과" → 위 값 + crossTolPct 조이기
// "이륙/착지 시점이 튐" → filterMinCutoff/Beta, liftoffBandFrac 조정
export const JUMP_TUNING = {
  minVisibility: 0.12,       // 관절 가시성 하한 (이하면 캘리브레이션/검출 제외)
  // [2026-07-30] 0.3→0.2 완화, [2026-07-31] 0.2→0.12 추가 완화. 키오스크
  // 환경(카메라 각도·화질·거리)에서 캘리브레이션이 계속 0%에 멈추거나
  // "발목을 못 잡는다"는 리포트가 반복됐다 — 07-30 완화 이후에도 부족했다는
  // 뜻이라 한 단계 더 낮췄다. feetCenterY(발목 27/28)는 push()가 표본을
  // 쌓는 조건 자체라, 이 값이 문턱을 못 넘으면 진행률이 아예 0%에서
  // 안 움직인다(low_visibility 사유로도 못 넘어가는 게 아니라 표본 자체가
  // 안 쌓이는 쪽). 트레이드오프는 여전히 있다 — 실측 데이터로 재보정 전까지의
  // 임시값이며, 카메라 위치·거리·조명 조정이 근본 해결책일 수 있다.
  filterMinCutoff: 1.2,      // 1-Euro 평활 강도 (낮을수록 더 부드럽게)
  filterBeta: 0.02,          // 1-Euro 반응성

  // ── 캘리브레이션(서 있는 자세) ──
  calibMinFrames: 8,         // 기준선 확정에 필요한 최소 안정 프레임 수
  calibMaxStdY: 0.012,       // 서 있는 동안 발 y 표준편차 상한(정규화). 넘으면 불안정
  calibMinVisRatio: 0.6,     // 캘리브레이션 프레임 중 관절 가시 비율 하한
  // [2026-07-31] 0.8→0.6 완화 — minVisibility 완화와 같은 이유. 처음 자리
  // 잡는 몇 프레임의 낮은 가시성이 누적 비율을 계속 끌어내리는 것을 완화한다.
  calibTimeoutMs: 4000,      // 이 시간 안에 정상 잠금이 안 되면 있는 표본으로 강제 잠금
  // [2026-07-31] "발목을 못 잡는다" 리포트에 대한 최후 폴백. 카메라 환경이
  // 정말 안 좋으면 문턱을 아무리 낮춰도 안 될 수 있다 — 그때는 "그냥 발목
  // 위치로 기준을 잡자"는 제안대로, 안정성·가시비율 조건 없이 지금까지 모인
  // 표본(최소 1개)의 평균으로 강제 잠금한다. 다만 완전히 무조건 즉시 잠그는
  // 대신 먼저 정상 경로로 몇 초간 시도부터 하게 둔다 — 카메라 상태가 괜찮은
  // 날엔 지금처럼 정확한 잠금을 그대로 쓰고, 정말 안 되는 경우에만 이 폴백이
  // 개입해 최소한 측정 자체는 진행되게 한다(정확도보다 가용성 우선의 최후
  // 수단이라는 걸 result.basis === 'timeout_fallback'로 남긴다).

  // ── 이륙/착지 검출 ──
  // 발 신호는 살짝만 평활(이륙·착지 전환을 날카롭게 유지). 과평활 시 체공이 짧게 측정됨.
  feetFilterMinCutoff: 6.0,  // 발 검출용 1-Euro (gait 보다 높게 = 덜 평활)
  feetFilterBeta: 0.05,
  liftoffBandFrac: 0.04,     // 기준선에서 이만큼(정규화 y) 위로 뜨면 '공중'으로 판정
  minFlightMs: 120,          // 이보다 짧은 체공은 노이즈로 간주(무효)
  maxFlightMs: 1500,         // 이보다 길면 검출 오류로 간주(무효)

  // ── 교차검증 ──
  crossTolPct: 25,           // 비행시간 높이 vs 골반변위 높이 허용 불일치(%)
  // ── 물리적 sanity (회원 키 대비) ──
  maxHeightToBodyRatio: 0.85,// 점프 높이가 키의 이 비율을 넘으면 비현실적(검출 오류)

  // ── Triple Extension 신전 임계(도) ── 이지 직전 세 관절이 거의 펴졌는지
  //   고관절/무릎은 신뢰, 발목은 참고. 현장 데이터로 조정 대상.
  tripleExtension: {
    hipMinDeg: 160,   // 고관절 신전 임계 (작을수록 관대)
    kneeMinDeg: 160,  // 무릎 신전 임계
    ankleMinDeg: 140, // 발목(plantarflexion) — BlazePose 한계로 관대하게
  },
};

// 두 발(발목)의 평균 y. 화면 좌표는 아래로 갈수록 y 증가 → 점프하면 y 감소.
// 발목(27/28)은 모션블러에 강해 gait 와 동일하게 1순위로 쓴다.
export const feetCenterY = (lm) => {
  if (!lm || !lm[27] || !lm[28]) return null;
  const v = JUMP_TUNING.minVisibility;
  const okL = lm[27].visibility == null || lm[27].visibility >= v;
  const okR = lm[28].visibility == null || lm[28].visibility >= v;
  if (!okL && !okR) return null;
  if (okL && okR) return (lm[27].y + lm[28].y) / 2;
  return okL ? lm[27].y : lm[28].y; // 한쪽만 보이면 그쪽 사용 (blur 관용)
};

// [2026-07-31] 한쪽 발목(27 또는 28)만 고정으로 추적 — "이번 프레임엔 평균,
// 다음 프레임엔 한쪽만" 식으로 계속 모드가 바뀌면(feetCenterY 특성) 평균값과
// 단일값 사이의 미세한 차이가 프레임마다 튀어 흔들림으로 오인될 수 있다.
// 캘리브레이션 때 더 잘 보이는 쪽을 한 번 정하고(StandingCalibrator.result.ankleSide),
// 점프 끝까지 그 발목 하나만 일관되게 본다.
export const singleAnkleY = (lm, side) => {
  const idx = side === 'right' ? 28 : 27;
  if (!lm || !lm[idx]) return null;
  const v = JUMP_TUNING.minVisibility;
  if (lm[idx].visibility != null && lm[idx].visibility < v) return null;
  return lm[idx].y;
};

// 골반(23/24) 중점 y — 교차검증용 수직 변위 신호.
export const pelvisCenterY = (lm) => {
  if (!lm || !lm[23] || !lm[24]) return null;
  const v = JUMP_TUNING.minVisibility;
  const okL = lm[23].visibility == null || lm[23].visibility >= v;
  const okR = lm[24].visibility == null || lm[24].visibility >= v;
  if (!okL && !okR) return null;
  return (lm[23].y + lm[24].y) / 2;
};

// [스쿼트 추적기 신규] 무릎(25/26)·뒤꿈치(29/30) 중점 y — StandingCalibrator의
// 서기 기준선에 선택적으로 추가되는 값(스쿼트 깊이·뒤꿈치 들림 판정용). 기존
// feetCenterY/pelvisCenterY와 동일한 시야각 관용 패턴을 따르되, 이 값들이
// 안 보인다고 해서 캘리브레이션 자체가 막히면 안 되므로(SLST·점프는 이 랜드마크가
// 필요 없다) push()/_tryLock()의 lock 조건에는 관여하지 않는다(순수 부가 정보).
export const kneeCenterY = (lm) => {
  if (!lm || !lm[25] || !lm[26]) return null;
  const v = JUMP_TUNING.minVisibility;
  const okL = lm[25].visibility == null || lm[25].visibility >= v;
  const okR = lm[26].visibility == null || lm[26].visibility >= v;
  if (!okL && !okR) return null;
  if (okL && okR) return (lm[25].y + lm[26].y) / 2;
  return okL ? lm[25].y : lm[26].y;
};

export const heelCenterY = (lm) => {
  if (!lm || !lm[29] || !lm[30]) return null;
  const v = JUMP_TUNING.minVisibility;
  const okL = lm[29].visibility == null || lm[29].visibility >= v;
  const okR = lm[30].visibility == null || lm[30].visibility >= v;
  if (!okL && !okR) return null;
  if (okL && okR) return (lm[29].y + lm[30].y) / 2;
  return okL ? lm[29].y : lm[30].y;
};

// 서 있는 자세 전신 픽셀 높이(정규화): 정수리(0) ~ 발목 중점.
// 요구사항대로 '정수리(0)와 발끝(27/28)'을 쓰되, 발끝(31/32)은 blur 로 자주
// 소실되므로 발목(27/28)을 기준으로 둔다(없으면 발끝 보조).
export const bodyPixelHeight = (lm) => {
  if (!lm || !lm[0] || !lm[27] || !lm[28]) return null;
  const v = JUMP_TUNING.minVisibility;
  if (lm[0].visibility != null && lm[0].visibility < v) return null;
  const headY = lm[0].y;
  const ankY = feetCenterY(lm);
  if (ankY == null) return null;
  const h = Math.abs(ankY - headY);
  return h > 0.05 ? h : null; // 너무 작으면(전신 미포함) 무효
};

// 가시성 신뢰도를 아예 무시하고 좌표만 쓰는 원시값 — feetCenterY/pelvisCenterY가
// minVisibility 문턱을 계속 못 넘는 최악의 카메라 환경에서 폴백 잠금의 최후
// 수단으로만 쓴다("선을 잡지 말고 그냥 발목으로 기준을 잡자"는 제안 그대로).
const rawFeetY = (lm) => (lm && lm[27] && lm[28]) ? (lm[27].y + lm[28].y) / 2 : null;
const rawPelvisY = (lm) => (lm && lm[23] && lm[24]) ? (lm[23].y + lm[24].y) / 2 : null;

// ════════════════════════════════════════════════════════════════════════
//  StandingCalibrator — 첫 N프레임의 '서 있는 자세'로 기준선 + 스케일 확정
//   요구사항 1: 측정 시작 시 키(height) 데이터로 px↔cm 스케일 자동 산출
//   요구사항 3: 자세 불안정(가시성↓ / 흔들림↑)이면 ok=false → "올바르게 서 주세요"
// ════════════════════════════════════════════════════════════════════════
export class StandingCalibrator {
  // [2026-08-10 추가 — SLJ 한발 점프] forcedAnkleSide: 'left'|'right'를 넘기면
  // 자동(가시성 기준) 선택 대신 그 발목을 강제로 추적 기준으로 쓴다. 안 넘기면
  // (undefined/null, 기존 모든 호출부) 아래 _finalizeLock의 자동 선택 로직이
  // 전과 100% 동일하게 동작한다 — 새 옵션은 명시적으로 줄 때만 개입하는
  // 순수 추가(additive) 변경이라 기존 CMJ/RSI 측정엔 영향이 없다.
  constructor({ heightCm = null, forcedAnkleSide = null } = {}) {
    this.heightCm = heightCm && heightCm > 0 ? Number(heightCm) : null;
    this.forcedAnkleSide = (forcedAnkleSide === 'left' || forcedAnkleSide === 'right') ? forcedAnkleSide : null;
    this._feetY = [];
    this._pelvisY = [];
    this._bodyPx = [];
    // [스쿼트 추적기 신규] 무릎·뒤꿈치는 선택적 부가 정보라 별도 배열로 모으고,
    // 아래 push()/_tryLock()의 lock 조건(안정성 판정)에는 전혀 관여하지 않는다.
    this._kneeY = [];
    this._heelY = [];
    this._frames = 0;
    this._visFrames = 0;
    this._rawFeetY = [];   // 가시성 무시 원시 발목 y — 최후 폴백용 롤링 버퍼
    this._rawPelvisY = [];
    // [2026-07-31] 어느 쪽 발목이 더 잘 보이는지 판단해 한쪽으로 고정 추적하기
    // 위한 좌/우 개별 집계. feetCenterY(양쪽 평균/폴백)와는 별개로 순수하게
    // "이 프레임에서 이 발목 하나가 문턱을 넘었는가"만 센다.
    this._visCountL = 0;
    this._visCountR = 0;
    this._feetYL = [];
    this._feetYR = [];
    this._startTs = null; // 첫 push() 시각(ms) — 타임아웃 폴백 판단용
    this.locked = false;
    this.result = null;
  }

  // 프레임마다 호출. 충분히 안정되면 lock() 되어 result 를 채운다.
  // tMs: 선택. 넘기면 타임아웃 폴백(calibTimeoutMs) 판단에 쓰인다 — 안 넘기면
  // (예: 기존 테스트 코드) 폴백 없이 기존 방식 그대로 동작한다.
  push(lm, tMs) {
    if (this.locked) return;
    if (tMs != null && this._startTs == null) this._startTs = tMs;
    this._frames++;
    const fY = feetCenterY(lm);
    const pY = pelvisCenterY(lm);
    const bPx = bodyPixelHeight(lm);
    // [2026-07-30] 발/골반만 있으면 기준선 확보를 진행한다. bPx(전신 픽셀
    // 높이 → cm 환산용)는 코(0번) 랜드마크가 필요한데, 카메라가 위에서 아래로
    // 내려다보는 각도(키오스크 거치대 등)에서는 유독 신뢰도가 낮게 나올 수
    // 있다 — ROM 등 이 계산이 아예 없는 화면은 같은 카메라에서도 문제가 없었던
    // 것으로 확인됨. cm 환산은 "있으면 좋은" 부가 정보(없으면 null, 이미
    // 기존 코드가 안전하게 처리)라 잠금 자체를 막을 이유가 없다.
    if (fY != null && pY != null) {
      this._visFrames++;
      this._feetY.push(fY);
      this._pelvisY.push(pY);
    }
    // 좌/우 개별 가시성 카운트 + 값(위 fY 병합 로직과 무관하게 독립적으로 집계).
    // 캘리브레이션 중엔 두 배열 다 짧게 유지되므로(calibMinFrames 근처) 계속
    // 쌓아도 무리 없다 — 잠금 시점의 두 배열 길이/평균으로 승자를 정한다.
    const v = JUMP_TUNING.minVisibility;
    const visL = lm && lm[27] && (lm[27].visibility == null || lm[27].visibility >= v);
    const visR = lm && lm[28] && (lm[28].visibility == null || lm[28].visibility >= v);
    if (visL) { this._visCountL++; this._feetYL.push(lm[27].y); }
    if (visR) { this._visCountR++; this._feetYR.push(lm[28].y); }
    // 가시성 무시 원시값도 별도로 계속 모은다(최근 30개만 유지) — 정식 표본이
    // 하나도 안 쌓이는 최악의 경우에도 타임아웃 폴백이 쓸 데이터가 있도록.
    const rfY = rawFeetY(lm);
    const rpY = rawPelvisY(lm);
    if (rfY != null && rpY != null) {
      this._rawFeetY.push(rfY); this._rawPelvisY.push(rpY);
      if (this._rawFeetY.length > 30) { this._rawFeetY.shift(); this._rawPelvisY.shift(); }
    }
    if (bPx != null) this._bodyPx.push(bPx);
    // 무릎·뒤꿈치는 안 보여도 위 lock 판정에 영향 없이 그냥 못 모을 뿐(선택 정보).
    const kY = kneeCenterY(lm);
    if (kY != null) this._kneeY.push(kY);
    const hY = heelCenterY(lm);
    if (hY != null) this._heelY.push(hY);
    if (this._feetY.length >= JUMP_TUNING.calibMinFrames) this._tryLock();
    if (!this.locked && tMs != null && this._startTs != null
      && (tMs - this._startTs) >= JUMP_TUNING.calibTimeoutMs) {
      this._forceLock();
    }
  }

  _finalizeLock(basis, feetArr, pelvisArr) {
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const visRatio = this._frames ? this._visFrames / this._frames : 0;
    const std = (a) => {
      const m = mean(a);
      return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
    };
    const baselineFeetY = mean(feetArr);
    const baselinePelvisY = mean(pelvisArr);
    // bPx 표본이 하나도 없으면(코가 한 번도 신뢰 기준을 못 넘김) cm 환산 없이
    // 잠금 — 정상적으로 발/골반 기준의 상대 측정(각도·비율)은 그대로 동작한다.
    const bodyPx = this._bodyPx.length ? mean(this._bodyPx) : null;
    // px↔cm 스케일: 실제 키(cm) / 화면상 픽셀 높이(정규화). 키 또는 bPx 없으면 null.
    const scaleCmPerY = (this.heightCm && bodyPx) ? this.heightCm / bodyPx : null;
    // 무릎·뒤꿈치 기준선은 표본이 너무 적으면(주로 정면 풀샷이 아닌 경우) null —
    // 스쿼트 추적기가 이미 null-safe 폴백을 갖고 있어 안전하다.
    const baselineKneeY = this._kneeY.length >= 5 ? mean(this._kneeY) : null;
    const baselineHeelY = this._heelY.length >= 5 ? mean(this._heelY) : null;
    // [2026-07-31] "매 프레임 평균/단일 모드가 바뀌는" 흔들림을 없애기 위해,
    // 더 잘 보인 쪽 발목 하나를 골라 그 발목만의 기준선(baselineAnkleY)을
    // 따로 계산해둔다. JumpFlightTracker가 이후 점프 끝까지 이 발목 하나만
    // 본다(singleAnkleY) — 캘리브레이션과 실제 추적이 같은 신호를 쓰도록.
    // 두 쪽 다 표본이 있으면 더 많이/안정적으로 보인 쪽, 한쪽만 있으면 그쪽,
    // 그마저 없으면(예: 원시 폴백 경로) 병합값(baselineFeetY)으로 대체한다.
    let ankleSide = null;
    let baselineAnkleY = baselineFeetY;
    // [2026-08-10 추가] 강제 지정 쪽에 표본이 있으면 그 쪽을 최우선으로 쓴다.
    // 표본이 하나도 없으면(그 다리가 화면 밖 등) 안전하게 아래 자동 선택으로
    // 폴백한다 — 강제 지정이 측정 자체를 막지는 않는다.
    if (this.forcedAnkleSide === 'left' && this._feetYL.length) {
      ankleSide = 'left'; baselineAnkleY = mean(this._feetYL);
    } else if (this.forcedAnkleSide === 'right' && this._feetYR.length) {
      ankleSide = 'right'; baselineAnkleY = mean(this._feetYR);
    } else if (this._feetYL.length && this._feetYR.length) {
      ankleSide = this._visCountL >= this._visCountR ? 'left' : 'right';
      baselineAnkleY = mean(ankleSide === 'left' ? this._feetYL : this._feetYR);
    } else if (this._feetYL.length) {
      ankleSide = 'left'; baselineAnkleY = mean(this._feetYL);
    } else if (this._feetYR.length) {
      ankleSide = 'right'; baselineAnkleY = mean(this._feetYR);
    }
    // [2026-08-02] 좌/우 발목의 "자기 자신" 기준선도 따로 내보낸다.
    // 한다리서기(SLST)는 한쪽 발목이 자기 평상시 높이보다 떴는지를 봐야 하는데,
    // 지금까지는 양발 평균(baselineFeetY)과 비교하고 있었다. 두 발목 높이가
    // 조금만 달라도(발을 나란히 못 두거나 카메라 각도 때문에 흔함) 그 차이가
    // 그대로 문턱값에 더해져, 발을 들어도 검출이 안 되는 원인이 됐다.
    // 표본이 없으면 병합값으로 안전하게 폴백한다.
    const baselineAnkleYL = this._feetYL.length ? mean(this._feetYL) : baselineFeetY;
    const baselineAnkleYR = this._feetYR.length ? mean(this._feetYR) : baselineFeetY;
    this.result = {
      baselineFeetY, baselinePelvisY, bodyPx, scaleCmPerY, feetStd: std(feetArr), visRatio,
      baselineKneeY, baselineHeelY, basis, ankleSide, baselineAnkleY,
      baselineAnkleYL, baselineAnkleYR,
    };
    this.locked = true;
  }

  // 정상 경로: 표본이 충분히 안정(흔들림 적음)+충분히 보임(가시비율)일 때만 잠금.
  _tryLock() {
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const std = (a) => {
      const m = mean(a);
      return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
    };
    const visRatio = this._frames ? this._visFrames / this._frames : 0;
    const feetStd = std(this._feetY);
    // 불안정 판정: 가시 비율 부족 OR 발 흔들림 과다 (무릎·뒤꿈치·bPx는 이 판정에 안 쓰임)
    const stable = visRatio >= JUMP_TUNING.calibMinVisRatio
      && feetStd <= JUMP_TUNING.calibMaxStdY;
    if (!stable) {
      // 슬라이딩 윈도우: 오래된 샘플을 버리고 계속 재시도(자세 교정 시간 부여)
      this._feetY.shift(); this._pelvisY.shift();
      if (this._bodyPx.length) this._bodyPx.shift();
      if (this._kneeY.length) this._kneeY.shift();
      if (this._heelY.length) this._heelY.shift();
      return;
    }
    this._finalizeLock('normal', this._feetY, this._pelvisY);
  }

  // 폴백 경로("선을 잡지 말고 그냥 발목으로 기준을 잡자") — calibTimeoutMs
  // 동안 정상 경로가 못 끝내면 개입한다. 안정성 검증을 거친 표본(_feetY)이
  // 하나라도 있으면 그걸 쓰고(그래도 상대적으로 더 낫다), 그마저 하나도 없는
  // 최악의 경우에만 가시성 무시 원시값(_rawFeetY)으로 강제 잠금한다 —
  // 둘 다 없으면(카메라에 사람이 아예 안 잡힘) 잠그지 않고 계속 기다린다.
  _forceLock() {
    if (this._feetY.length >= 1) {
      this._finalizeLock('timeout_fallback', this._feetY, this._pelvisY);
    } else if (this._rawFeetY.length >= 1) {
      this._finalizeLock('timeout_fallback_raw', this._rawFeetY, this._rawPelvisY);
    }
    // 둘 다 비어 있으면(랜드마크 자체가 안 잡힘) 아직 잠글 데이터가 없다 — 대기 유지.
  }

  // 진행 상태(UI 표시용). reason 으로 경고 문구를 분기한다.
  status() {
    if (this.locked) return { ready: true, progress: 1, reason: 'ok', visRatio: 1 };
    const visRatio = this._frames ? this._visFrames / this._frames : 0;
    const progress = Math.min(0.99, this._feetY.length / JUMP_TUNING.calibMinFrames);
    let reason = 'arming';
    if (this._frames > JUMP_TUNING.calibMinFrames && visRatio < JUMP_TUNING.calibMinVisRatio) {
      reason = 'low_visibility'; // 관절이 잘 안 잡힘 → "올바르게 서 주세요"
    }
    return { ready: false, progress, reason, visRatio };
  }
}

// ════════════════════════════════════════════════════════════════════════
//  JumpFlightTracker — 캘리브레이션 후 프레임을 흘려보내며 점프 1회를 검출
//   · 발이 baseline 보다 liftoffBand 만큼 뜨면 takeoff, 다시 내려오면 landing
//   · takeoff/landing 의 *실측 ms 타임스탬프* 차이로 비행시간 → 높이
//   · 같은 구간 골반 변위로 교차검증
// ════════════════════════════════════════════════════════════════════════
export class JumpFlightTracker {
  constructor(calib, {
    minCutoff = JUMP_TUNING.feetFilterMinCutoff,
    beta = JUMP_TUNING.feetFilterBeta,
  } = {}) {
    this.calib = calib;                 // StandingCalibrator.result
    this.band = JUMP_TUNING.liftoffBandFrac;
    this._filtFeet = new OneEuroFilter({ minCutoff, beta, dCutoff: 1.0 });
    this.inAir = false;
    this.takeoffMs = null;
    this.landingMs = null;
    // 공중 구간 골반 최고점(가장 작은 y = 가장 높이) 추적 → 변위 교차검증
    this._pelvisPeakY = Infinity;
    this._pelvisBaseY = calib?.baselinePelvisY ?? null;
    this.flights = []; // [{ takeoffMs, landingMs, flightMs, pelvisRiseY }]
    // [2026-07-31] 캘리브레이션이 고른 발목 한쪽(ankleSide)을 점프 끝까지
    // 그대로 쓴다 — 평균/단일 모드가 프레임마다 바뀌던 걸 없애서, 기준선을
    // 잡을 때와 같은 신호로 이착지를 판정한다. ankleSide가 없으면(옛 결과·
    // 테스트 등) feetCenterY로 안전하게 폴백.
    this.ankleSide = calib?.ankleSide ?? null;
    this.baselineAnkleY = calib?.baselineAnkleY ?? calib?.baselineFeetY ?? null;
  }

  push(lm, tMs) {
    if (!this.calib) return;
    const fYraw = this.ankleSide ? singleAnkleY(lm, this.ankleSide) : feetCenterY(lm);
    if (fYraw == null) return;
    const fY = this._filtFeet.filter(fYraw, tMs / 1000);
    const liftThreshold = this.baselineAnkleY - this.band; // 위로 뜨면 y 감소

    if (!this.inAir) {
      // 지면 → 공중 전환 (발이 기준선보다 band 이상 위로)
      if (fY < liftThreshold) {
        this.inAir = true;
        this.takeoffMs = tMs;
        this._pelvisPeakY = Infinity;
      }
    } else {
      // 공중 중: 골반 최고점 추적
      const pY = pelvisCenterY(lm);
      if (pY != null) this._pelvisPeakY = Math.min(this._pelvisPeakY, pY);
      // 공중 → 지면 전환 (발이 기준선 band 안으로 복귀).
      // 이륙과 동일한 band 임계를 써서 1-Euro 평활의 상승/하강 지연을
      // 대칭으로 만든다(체공시간 편향 최소화).
      if (fY >= this.baselineAnkleY - this.band) {
        this.landingMs = tMs;
        const flightMs = this.landingMs - this.takeoffMs;
        const pelvisRiseY = (this._pelvisBaseY != null && this._pelvisPeakY < Infinity)
          ? Math.max(0, this._pelvisBaseY - this._pelvisPeakY) : null;
        if (flightMs >= JUMP_TUNING.minFlightMs && flightMs <= JUMP_TUNING.maxFlightMs) {
          this.flights.push({ takeoffMs: this.takeoffMs, landingMs: this.landingMs, flightMs, pelvisRiseY });
        }
        this.inAir = false;
        this.takeoffMs = null;
      }
    }
  }

  // 최고 점프 1회를 골라 결과 산출. 무효면 valid:false.
  summary({ heightCm = null } = {}) {
    const calib = this.calib;
    if (!this.flights.length) {
      return { valid: false, reason: 'no_jump', jumps: 0 };
    }
    // 가장 긴 체공(=가장 높은 점프) 채택
    const best = this.flights.reduce((a, b) => (b.flightMs > a.flightMs ? b : a));
    const t = best.flightMs / 1000;
    const heightFlight = (G * t * t) / 8;          // m (주측정)
    const heightFlightCm = Math.round(heightFlight * 1000) / 10;
    const takeoffVel = (G * t) / 2;

    // 교차검증: 골반 변위(정규화 y) × px↔cm 스케일
    let heightCrossCm = null, crossDeltaPct = null, crossOk = null;
    if (best.pelvisRiseY != null && calib?.scaleCmPerY) {
      heightCrossCm = Math.round(best.pelvisRiseY * calib.scaleCmPerY * 10) / 10;
      if (heightFlightCm > 0) {
        crossDeltaPct = Math.round(Math.abs(heightCrossCm - heightFlightCm) / heightFlightCm * 1000) / 10;
        crossOk = crossDeltaPct <= JUMP_TUNING.crossTolPct;
      }
    }

    // 물리적 sanity (회원 키 대비)
    const bodyCm = heightCm || this.calibHeightCm || null;
    let sanityOk = true;
    if (bodyCm) sanityOk = heightFlightCm <= bodyCm * JUMP_TUNING.maxHeightToBodyRatio;

    // 유효 판정: 체공시간(주측정) + 물리적 sanity 만으로 결정.
    // 골반변위 교차검증은 카메라 거리/각도/원근 왜곡으로 구조적 오차가 커
    //  (정규화 픽셀 변위에 전신 스케일을 적용 → 1:1 전이 불가),
    //  pass/fail 게이트가 아니라 '참고 표시값'으로만 둔다.
    //  (front-view / 픽셀스케일 높이를 신뢰하지 않는 기존 결론과 동일 철학)
    const valid = sanityOk;

    return {
      valid,
      reason: !sanityOk ? 'sanity_fail' : 'ok',
      jumps: this.flights.length,
      flightTimeMs: Math.round(best.flightMs),
      flightTimeSec: Math.round(t * 1000) / 1000,
      heightCm: heightFlightCm,              // 주 결과(비행시간 기반)
      takeoffVelocity: Math.round(takeoffVel * 100) / 100,
      crossCheck: {
        heightCrossCm,                       // 골반 변위 기반 추정
        deltaPct: crossDeltaPct,             // 두 방식 불일치(%)
        agree: crossOk,                      // null=검증 불가, true/false
      },
      sanityOk,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════
//  [고도화] JumpBiomechAccumulator — 프레임마다 push, 끝에 summary()
//   보행의 BiomechAccumulator 와 같은 인터페이스(push/summary).
//   위상(phase)별로 지표를 잡는다: 'stand'(준비) | 'air'(공중) | 'land'(착지 직후).
//   위상은 JumpFlightTracker 가 inAir 상태로 알려주므로, 측정 루프에서
//   tracker.inAir 를 보고 phase 를 넘겨 주면 된다(아래 buildJumpReport 참고).
//
//  ⚠ 신뢰 등급(리포트에 그대로 노출):
//    'core'   = 비교적 신뢰(측면뷰 기준). 점프높이/체공/무릎각도/상체기울기/골반.
//    'ref'    = 참고용. Triple Extension(발목 신전 BlazePose 정확도 한계).
//    'limit'  = 제약 큼. 좌우 '체중' 분산은 카메라로 불가 → 기하학적 대칭으로 대체.
// ════════════════════════════════════════════════════════════════════════

const _v = (p) => p && (p.visibility == null || p.visibility >= JUMP_TUNING.minVisibility);
const _dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

// 상체 전방 기울기(도): 어깨중점→골반중점 벡터와 수직선의 각. 0=직립.
const _trunkLean = (lm) => {
  if (!lm || !_v(lm[11]) || !_v(lm[12]) || !_v(lm[23]) || !_v(lm[24])) return null;
  const sh = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
  const hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
  const vx = sh.x - hip.x, vy = sh.y - hip.y;
  if (Math.sqrt(vx * vx + vy * vy) < 1e-6) return null;
  return Math.round(Math.atan2(Math.abs(vx), Math.abs(vy)) * (180 / Math.PI) * 10) / 10;
};

// 좌우 무릎 굽힘 각도(고관절-무릎-발목). 180=완전 신전, 작을수록 깊게 굽힘.
const _knees = (lm) => ({
  left: angleAt(lm[23], lm[25], lm[27]),
  right: angleAt(lm[24], lm[26], lm[28]),
});

// 좌우 발목(plantarflexion) 각도(무릎-발목-발끝). 참고용(BlazePose 발끝 정확도 낮음).
const _ankles = (lm) => ({
  left: angleAt(lm[25], lm[27], lm[31]),
  right: angleAt(lm[26], lm[28], lm[32]),
});

// 좌우 고관절 각도(어깨-고관절-무릎).
const _hips = (lm) => ({
  left: angleAt(lm[11], lm[23], lm[25]),
  right: angleAt(lm[12], lm[24], lm[26]),
});

// 골반 좌우 높이차(정규화 y, 부호 좌-우). 신장으로 정규화해 % 로.
const _pelvicTilt = (lm, scale) => {
  if (!lm || !_v(lm[23]) || !_v(lm[24]) || !scale) return null;
  return Math.round(((lm[23].y - lm[24].y) / scale) * 1000) / 10;
};

export class JumpBiomechAccumulator {
  constructor({ heightCm = null } = {}) {
    this.heightCm = heightCm;
    this.stand = { trunkLean: [], pelvicTilt: [] };
    this.air = { trunkLean: [] };
    // [무릎·고관절 각도 그래프 2026-08-18] land에 hipL/hipR 추가 — 기존
    // kneeL/kneeR과 동일한 패턴으로 착지 시 고관절 굽힘도 함께 모은다
    // (landingHipAngle 계산용, summary() 참고).
    this.land = { kneeL: [], kneeR: [], hipL: [], hipR: [], trunkLean: [], footL: [], footR: [] };
    // 이지 접근(takeoff approach) 구간: 신전 '궤적'을 보기 위한 시퀀스(시간순)
    this.approach = { hip: [], knee: [], ankle: [] };
    this._scaleSum = 0; this._scaleN = 0;
    // 촬영 방향 투표 (프레임마다 detectOrientation → 다수결)
    this._viewVotes = { side: 0, back: 0, unknown: 0 };
    // [무릎·고관절 각도 그래프 2026-08-18] 준비→도약→공중→착지 전 구간의
    // 무릎/고관절 각도를 시간순으로 남긴다(리포트의 각도-시간 그래프용).
    // 요약 통계(min/mean)로 뭉개지기 전의 원본 프레임 시퀀스 — push() 될 때마다
    // 값이 있으면(둘 중 하나라도 non-null) 쌓는다. 값이 전혀 없는 프레임(관절
    // 미검출)은 그래프에 굳이 안 남긴다.
    this.timeline = [];
  }

  get bodyScale() { return this._scaleN ? this._scaleSum / this._scaleN : null; }

  // phase: 'stand' | 'air' | 'land'. justTookOff: 이지 직후 프레임이면 true.
  push(lm, tMs, phase, justTookOff = false) {
    if (!lm) return;
    // 신장 스케일(어깨~발목 y거리)
    if (lm[11] && lm[12] && lm[27] && lm[28]) {
      const s = Math.abs(((lm[27].y + lm[28].y) / 2) - ((lm[11].y + lm[12].y) / 2));
      if (s > 0.05) { this._scaleSum += s; this._scaleN++; }
    }
    const scale = this.bodyScale;

    // 촬영 방향 투표 (준비/착지 등 안정 구간에서만 — 공중은 자세 왜곡)
    if (phase !== 'air') {
      const o = detectOrientation(lm);
      this._viewVotes[o.view] = (this._viewVotes[o.view] || 0) + 1;
    }

    // [무릎·고관절 각도 그래프 2026-08-18] 위상과 무관하게 이 프레임의
    // 무릎/고관절 각도를 시계열로 남긴다. 아래 phase별 분기(요약 통계용)와는
    // 별개 — 하나가 없어도 다른 하나는 영향받지 않는다.
    const kn0 = _knees(lm), hp0 = _hips(lm);
    const kneeNow = _avg2(kn0.left, kn0.right);
    const hipNow = _avg2(hp0.left, hp0.right);
    if (tMs != null && (kneeNow != null || hipNow != null)) {
      this.timeline.push({
        tMs,
        phase,
        knee: kneeNow != null ? Math.round(kneeNow * 10) / 10 : null,
        hip: hipNow != null ? Math.round(hipNow * 10) / 10 : null,
      });
      // 방어적 상한 — 비정상적으로 긴 세션(예: RSI 연속 측정을 한참 못 끝낸
      // 경우)에도 메모리가 무한정 늘지 않게(오래된 표본부터 버림).
      if (this.timeline.length > 1500) this.timeline.shift();
    }

    if (phase === 'stand') {
      const tl = _trunkLean(lm); if (tl != null) this.stand.trunkLean.push(tl);
      const pt = _pelvicTilt(lm, scale); if (pt != null) this.stand.pelvicTilt.push(pt);
      // 이지 접근 시퀀스: 준비 후반(앉았다 펴는 구간)의 각도 추이를 모은다
      const hp = _hips(lm), kn = _knees(lm), an = _ankles(lm);
      const hipAvg = _avg2(hp.left, hp.right);
      const kneeAvg = _avg2(kn.left, kn.right);
      const ankAvg = _avg2(an.left, an.right);
      if (hipAvg != null) this.approach.hip.push(hipAvg);
      if (kneeAvg != null) this.approach.knee.push(kneeAvg);
      if (ankAvg != null) this.approach.ankle.push(ankAvg);
    } else if (phase === 'air') {
      const tl = _trunkLean(lm); if (tl != null) this.air.trunkLean.push(tl);
    } else if (phase === 'land') {
      const kn = _knees(lm);
      if (kn.left != null) this.land.kneeL.push(kn.left);
      if (kn.right != null) this.land.kneeR.push(kn.right);
      // [무릎·고관절 각도 그래프 2026-08-18] 착지 고관절 각도 — 무릎과 동일한
      // 패턴(좌우 각각 모아서 summary()에서 최소값 평균).
      const hpLand = _hips(lm);
      if (hpLand.left != null) this.land.hipL.push(hpLand.left);
      if (hpLand.right != null) this.land.hipR.push(hpLand.right);
      const tl = _trunkLean(lm); if (tl != null) this.land.trunkLean.push(tl);
      // 착지 발 위치 (좌/우) — blur 대비 여러 프레임 모아 중앙값 사용
      const fl = _footPos(lm, 27, 31);
      const fr = _footPos(lm, 28, 32);
      if (fl) this.land.footL.push(fl);
      if (fr) this.land.footR.push(fr);
    }
  }

  detectedView() {
    const { side, back } = this._viewVotes;
    if (side === 0 && back === 0) return 'unknown';
    return side >= back ? 'side' : 'back';
  }

  summary() {
    const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    const r1 = (n) => n == null ? null : Math.round(n * 10) / 10;
    const minOf = (a) => a.length ? Math.min(...a) : null;
    const maxOf = (a) => a.length ? Math.max(...a) : null;
    const view = this.detectedView();
    const scale = this.bodyScale;

    // ── 자세 및 기술 (측면뷰 전용) ──
    const landKneeL = minOf(this.land.kneeL);
    const landKneeR = minOf(this.land.kneeR);
    const landKnee = (landKneeL != null && landKneeR != null)
      ? r1((landKneeL + landKneeR) / 2) : (r1(landKneeL) ?? r1(landKneeR));

    // [무릎·고관절 각도 그래프 2026-08-18] 착지 고관절 각도 — landKnee와
    // 동일한 방식(좌우 최솟값의 평균 = 가장 깊게 굽혀진 순간).
    const landHipL = minOf(this.land.hipL);
    const landHipR = minOf(this.land.hipR);
    const landHip = (landHipL != null && landHipR != null)
      ? r1((landHipL + landHipR) / 2) : (r1(landHipL) ?? r1(landHipR));

    const standLean = mean(this.stand.trunkLean);
    const landLean = mean(this.land.trunkLean);
    const trunkLeanChange = (standLean != null && landLean != null)
      ? r1(Math.abs(landLean - standLean)) : null;

    // 신전 궤적 정렬도 (Extension Alignment) — 절대 발목각 대신 궤적 정렬에 초점
    const alignment = computeExtensionAlignment(
      this.approach.hip, this.approach.knee, this.approach.ankle
    );

    // ── 대칭성 및 안정성 ──
    // 골반 불균형(정면뷰에서 신뢰)
    const pelvicVals = this.stand.pelvicTilt;
    const pelvicImbalance = pelvicVals.length
      ? r1(Math.abs((maxOf(pelvicVals) ?? 0) - (minOf(pelvicVals) ?? 0))) : null;

    // 착지 발끝 대칭성 (force plate 대체) — 양쪽 뷰 모두 의미
    const footSym = computeFootLandingSymmetry(this.land.footL, this.land.footR, scale, view);

    // 뷰별 지표 활성 여부 (리포트 가이드라인 표시에 사용)
    const enabled = {
      view,
      posture: view === 'side',          // 자세/기술 = 측면 전용
      pelvicDrop: view === 'back',       // 골반 불균형 = 정면 전용
      footSymmetry: footSym.available,   // 발끝 대칭 = 양쪽 가능
    };

    return {
      view,
      enabled,
      // 자세 및 기술 (측면 전용)
      landingKneeAngle: landKnee,
      landingKneeLeft: r1(landKneeL),
      landingKneeRight: r1(landKneeR),
      // [무릎·고관절 각도 그래프 2026-08-18]
      landingHipAngle: landHip,
      landingHipLeft: r1(landHipL),
      landingHipRight: r1(landHipR),
      trunkLeanStand: r1(standLean),
      trunkLeanChange,
      extensionAlignment: alignment,      // 신전 궤적 정렬도
      // 대칭성 및 안정성
      pelvicImbalance,                    // 정면 전용
      footLandingSymmetry: footSym,       // 착지 발끝 대칭 (force plate 대체)
      // [무릎·고관절 각도 그래프 2026-08-18] 준비→도약→공중→착지 전 구간의
      // 무릎/고관절 각도 시계열 — [{tMs, phase, knee, hip}, ...] 시간순.
      // 리포트 화면에서 시간축 라인차트로 그린다(JumpReportDashboard.jsx).
      timeline: this.timeline,
    };
  }
}

// 두 값 평균 (null 안전)
const _avg2 = (a, b) => {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
};

// [실시간 HUD 2026-08-18] 특정 프레임의 무릎·고관절 각도(좌우 평균)를 즉시
// 계산한다. JumpBiomechAccumulator.push()의 phase 게이팅(stand/air/land)과는
// 무관하게 "지금 이 프레임" 값만 필요할 때 쓴다 — 캘리브레이션/대기 중에도
// 실시간 HUD에 각도를 띄우고 싶은 경우(측정 개시 전이라 accumulator에는 아직
// 아무것도 안 쌓인 상태) 등. null-safe — 관절이 안 보이면 null.
export function currentJointAngles(lm) {
  if (!lm) return { knee: null, hip: null };
  const kn = _knees(lm), hp = _hips(lm);
  const knee = _avg2(kn.left, kn.right);
  const hip = _avg2(hp.left, hp.right);
  return {
    knee: knee != null ? Math.round(knee * 10) / 10 : null,
    hip: hip != null ? Math.round(hip * 10) / 10 : null,
  };
}

// 측정 루프에서 위상 판정을 쉽게 하기 위한 헬퍼.
// 직전 inAir 와 현재 inAir 를 비교해 phase 와 justTookOff/justLanded 를 만든다.
export function jumpPhaseOf(prevInAir, curInAir, landWindowActive) {
  const justTookOff = !prevInAir && curInAir;
  const justLanded = prevInAir && !curInAir;
  let phase = 'stand';
  if (curInAir) phase = 'air';
  else if (landWindowActive) phase = 'land'; // 착지 직후 N프레임
  return { phase, justTookOff, justLanded };
}

// ════════════════════════════════════════════════════════════════════════
//  [재설계] 측정 가능한 지표로 교체
// ════════════════════════════════════════════════════════════════════════

// 발 위치(발목+발끝 평균). 발끝(31/32)이 blur 로 소실되면 발목만 사용.
const _footPos = (lm, ankleIdx, toeIdx) => {
  const ank = lm[ankleIdx], toe = lm[toeIdx];
  const okA = ank && (ank.visibility == null || ank.visibility >= JUMP_TUNING.minVisibility);
  const okT = toe && (toe.visibility == null || toe.visibility >= JUMP_TUNING.minVisibility);
  if (!okA && !okT) return null;
  if (okA && okT) return { x: (ank.x + toe.x) / 2, y: (ank.y + toe.y) / 2 };
  return okA ? { x: ank.x, y: ank.y } : { x: toe.x, y: toe.y };
};

// 중앙값 (blur 이상치 제거 — gait 의 median outlier rejection 과 동일 철학)
const _median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 착지 발끝 대칭성 (Foot Landing Symmetry) — force plate 대체 지표.
 * 착지 직후 안정된 N프레임에서 좌/우 발 위치의 중앙값을 구해,
 * 두 발의 좌우(x)·앞뒤(y) 위치 차이를 화면 픽셀(정규화) 거리로 평가한다.
 *  · 측면뷰: y(앞뒤) 차이가 핵심 — 한 발이 앞서 착지하는 비대칭
 *  · 정면뷰: x(좌우) 차이가 핵심 — 좌우 착지 폭 비대칭
 * 신장 스케일로 정규화해 % 로 환산(0%=완전 대칭).
 *
 * @param {Array} leftFrames  [{x,y}] 착지 구간 좌측 발 위치들
 * @param {Array} rightFrames [{x,y}] 착지 구간 우측 발 위치들
 * @param {number} bodyScale  신장 정규화 스케일(어깨~발목 y거리)
 * @param {'side'|'back'} view 촬영 방향
 */
export function computeFootLandingSymmetry(leftFrames, rightFrames, bodyScale, view) {
  if (!leftFrames?.length || !rightFrames?.length || !bodyScale) {
    return { available: false };
  }
  const lx = _median(leftFrames.map(p => p.x));
  const ly = _median(leftFrames.map(p => p.y));
  const rx = _median(rightFrames.map(p => p.x));
  const ry = _median(rightFrames.map(p => p.y));
  if (lx == null || rx == null) return { available: false };

  // 정규화 차이 (신장 대비 %)
  const dxPct = Math.round(Math.abs(lx - rx) / bodyScale * 1000) / 10; // 좌우
  const dyPct = Math.round(Math.abs(ly - ry) / bodyScale * 1000) / 10; // 앞뒤
  // 뷰별 '핵심 축' 차이 — 측면=앞뒤(y), 정면=좌우(x)
  const primaryAxis = view === 'side' ? 'anteroposterior' : 'mediolateral';
  const primaryDiffPct = view === 'side' ? dyPct : dxPct;
  // 대칭도 점수: 차이가 작을수록 100 에 가깝게 (10% 차이 → 0점 스케일)
  const symmetryPct = Math.max(0, Math.round((1 - Math.min(primaryDiffPct, 10) / 10) * 1000) / 10);
  // 어느 발이 앞/바깥인지 (참고)
  let leadFoot = null;
  if (view === 'side' && Math.abs(ly - ry) > 0.01) leadFoot = ly < ry ? 'left' : 'right'; // y작음=화면위=앞
  if (view !== 'side' && Math.abs(lx - rx) > 0.01) leadFoot = 'asym';

  return {
    available: true,
    view,
    primaryAxis,                 // 어느 축을 핵심으로 봤는지
    primaryDiffPct,              // 핵심 축 차이(%)
    lateralDiffPct: dxPct,       // 좌우 차이(%)
    anteroposteriorDiffPct: dyPct, // 앞뒤 차이(%)
    symmetryPct,                 // 0~100 (100=완전 대칭)
    leadFoot,                    // 'left'|'right'|'asym'|null
  };
}

/**
 * 신전 궤적 정렬도 (Extension Alignment) — 기존 Triple Extension 대체.
 * 절대 발목각의 부정확성을 피하고, '이지 구간 동안 고관절·무릎이 함께
 * 매끄럽게 펴지는가(정렬된 궤적)'에 초점을 둔다.
 *  · 이지 직전 여러 프레임의 고관절/무릎 각도 추이를 받아,
 *    (1) 두 관절이 함께 증가(신전)했는지 방향 일치도
 *    (2) 최종 신전 도달도
 *  를 결합해 0~100 정렬 점수를 낸다. 발목은 참고로만 같이 보고한다.
 *
 * @param {Array} hipSeq   이지 구간 고관절 각도 시퀀스(시간순)
 * @param {Array} kneeSeq  이지 구간 무릎 각도 시퀀스(시간순)
 * @param {Array} ankleSeq 발목(참고)
 */
export function computeExtensionAlignment(hipSeq, kneeSeq, ankleSeq = []) {
  const clean = (a) => a.filter(v => v != null && !Number.isNaN(v));
  const h = clean(hipSeq), k = clean(kneeSeq);
  if (h.length < 2 || k.length < 2) {
    return { available: false };
  }
  // (1) 방향 일치도: 인접 프레임 변화의 부호가 같은 비율(둘 다 펴지는 중인가)
  const n = Math.min(h.length, k.length);
  let agree = 0, total = 0;
  for (let i = 1; i < n; i++) {
    const dh = h[i] - h[i - 1], dk = k[i] - k[i - 1];
    if (Math.abs(dh) < 0.3 && Math.abs(dk) < 0.3) continue; // 정지 구간 무시
    total++;
    if ((dh >= 0 && dk >= 0) || (dh < 0 && dk < 0)) agree++;
  }
  const directionConsistency = total ? agree / total : 1;
  // (2) 최종 신전 도달도: 마지막 구간 평균이 신전 임계에 얼마나 근접
  const tail = (a) => a.slice(-Math.max(1, Math.round(a.length * 0.3)));
  const T = JUMP_TUNING.tripleExtension;
  const hipReach = Math.min(1, (tail(h).reduce((s, x) => s + x, 0) / tail(h).length) / T.hipMinDeg);
  const kneeReach = Math.min(1, (tail(k).reduce((s, x) => s + x, 0) / tail(k).length) / T.kneeMinDeg);
  const reach = (hipReach + kneeReach) / 2;
  // 결합 점수 (궤적 정렬 60% + 도달도 40%) — 궤적에 더 비중
  const alignmentScore = Math.round((directionConsistency * 0.6 + reach * 0.4) * 1000) / 10;

  const a = clean(ankleSeq);
  const ankleNote = a.length
    ? { finalDeg: Math.round((a.slice(-1)[0]) * 10) / 10, note: 'ref' }
    : null;

  return {
    available: true,
    alignmentScore,               // 0~100 (궤적 정렬도)
    directionConsistency: Math.round(directionConsistency * 1000) / 10, // %
    hipFinalDeg: Math.round((h.slice(-1)[0]) * 10) / 10,
    kneeFinalDeg: Math.round((k.slice(-1)[0]) * 10) / 10,
    ankle: ankleNote,             // 참고(발목 신전 도달 각, 정확도 낮음)
    quality: alignmentScore >= 80 ? 'good' : alignmentScore >= 60 ? 'fair' : 'poor',
  };
}

// ════════════════════════════════════════════════════════════════════════
//  [다회차 측정 평균 2026-08-11] CMJ·SJ·DJ·SLJ는 한 번만 뛰고 끝내는 대신
//  1차·2차·3차로 나눠 뛴 뒤 평균을 낸다(체육학에서 흔한 방식 — 단발 점프는
//  그날 컨디션에 따라 들쭉날쭉해서 여러 번 재 대표값을 쓴다). RSI는 제외 —
//  RSI는 원래부터 "한 세션 안에서 연속으로 여러 번 뛰어 그 안에서 평균 내는"
//  방식이라(rsiMean/cycles) 이미 자기 안에 반복·평균이 있다.
//
//  하위호환 원칙: trials가 1개뿐이면(기존처럼 한 번만 측정한 경우) 원본을
//  그대로 돌려주고 trials 필드 자체를 안 붙인다 — 예전에 저장된 리포트,
//  예전 리포트 화면 어디에도 새 필드가 안 보여서 100% 그대로 동작한다.
// ════════════════════════════════════════════════════════════════════════

/** CMJ·SJ·SLJ에서 이 종류가 다회차 평균 대상인지. */
export const MULTI_TRIAL_JUMP_SUBTYPES = ['cmj', 'sj', 'dj', 'slj'];
export const MAX_JUMP_TRIALS = 3;

/**
 * 여러 회차(trials, 시간순 배열) 측정 결과를 하나로 합친다. 대표값(heightCm
 * 등 메인 필드)은 평균으로 덮어쓰고, 각 회차 원본은 trials 필드로 남긴다.
 * engine('power'|'reactive')에 따라 평균 낼 필드가 다르다.
 * @returns {object|null} trials가 비어있으면 null. 1개면 원본 그대로(하위호환).
 */
export function combineJumpTrials(trials, engine) {
  if (!trials || trials.length === 0) return null;
  if (trials.length === 1) return trials[0];

  const avgNum = (getter, decimals = 1) => {
    const vals = trials.map(getter).map(Number).filter(Number.isFinite);
    if (!vals.length) return null;
    const mult = 10 ** decimals;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * mult) / mult;
  };
  // 회원 정보·valid 등 측정치가 아닌 필드는 가장 마지막(최신) 회차 기준으로.
  const base = trials[trials.length - 1];

  if (engine === 'reactive') {
    return {
      ...base,
      heightCm: avgNum((t) => t.heightCm),
      rsi: {
        ...base.rsi,
        rsi: avgNum((t) => t.rsi?.rsi, 2),
        contactTimeMs: avgNum((t) => t.rsi?.contactTimeMs, 0),
        flightTimeMs: avgNum((t) => t.rsi?.flightTimeMs, 0),
      },
      trials: trials.map((t) => ({
        heightCm: t.heightCm, rsi: t.rsi?.rsi ?? null,
        contactTimeMs: t.rsi?.contactTimeMs ?? null, measuredAt: t.measuredAt || null,
      })),
    };
  }

  return {
    ...base,
    heightCm: avgNum((t) => t.heightCm),
    takeoffVelocity: avgNum((t) => t.takeoffVelocity, 2),
    peakPower: avgNum((t) => t.peakPower, 0),
    trials: trials.map((t) => ({
      heightCm: t.heightCm, takeoffVelocity: t.takeoffVelocity,
      peakPower: t.peakPower, measuredAt: t.measuredAt || null,
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════
//  [SLJ 좌우 비대칭 비교 2026-08-11]
//  SLJ(한발 점프)는 한 번에 한쪽 다리만 측정해서 별도 리포트로 저장된다
//  (jumpSubType.js singleLeg — "테스트할 다리를 먼저 선택하세요"). 좌우를
//  같은 세션에서 묶어 저장하지 않는 기존 구조를 그대로 두고(하위호환 —
//  과거 저장 데이터·기존 저장 흐름 안 건드림), 리포트를 볼 때 "그 회원의
//  반대쪽 다리 최신 기록"을 찾아 비교만 추가로 보여주는 방식으로 구현한다.
//
//  지표는 LSI(Limb Symmetry Index) — 스포츠의학에서 좌우 비대칭을 볼 때
//  흔히 쓰는 방식(예: ACL 재활 복귀 기준)으로, 약한 쪽 ÷ 강한 쪽 × 100(%).
//  100%면 완전 대칭, 낮을수록 불균형이 큼. 통상 90% 이상을 정상 범위로 본다.
// ════════════════════════════════════════════════════════════════════════

/**
 * 두 값(왼쪽/오른쪽)의 좌우 대칭지수(LSI, %)를 계산한다. 순수 함수.
 * @returns {{leftValue:number, rightValue:number, lsiPct:number, weakerSide:'left'|'right'}|null}
 *   둘 중 하나라도 유효한 양수가 아니면 null(비교 불가 — 억지로 계산하지 않음).
 */
export function computeLegAsymmetry({ leftValue, rightValue }) {
  const L = Number(leftValue);
  const R = Number(rightValue);
  if (!Number.isFinite(L) || !Number.isFinite(R) || L <= 0 || R <= 0) return null;
  const stronger = Math.max(L, R);
  const weaker = Math.min(L, R);
  const lsiPct = Math.round((weaker / stronger) * 1000) / 10;
  // 완전히 같으면(L===R) 실질적 차이가 없으므로 어느 쪽을 weaker로 표기해도
  // 무해하다 — 관례상 left로 고정(표시 문구가 매 렌더마다 안 바뀌게).
  const weakerSide = L <= R ? 'left' : 'right';
  return { leftValue: L, rightValue: R, lsiPct, weakerSide };
}

/**
 * 리포트 목록(회원의 전체 AI측정 리포트, aiStore.ensureGaitReports 반환값)에서
 * "현재 보고 있는 SLJ 리포트"의 반대쪽 다리 중 가장 최근 유효 기록을 찾아
 * 비대칭을 계산한다. 순수 함수(aiStore를 직접 호출하지 않음) — 호출부
 * (JumpReportDashboard.jsx)가 이미 가져온 배열만 넘기면 되므로 테스트가
 * 쉽고, "가져오기"와 "계산"의 책임이 분리된다.
 *
 * currentReport가 SLJ가 아니거나(leg 없음) heightCm이 없으면(무효 측정 등)
 * 애초에 비교 대상이 아니므로 null. 반대쪽 다리 기록이 아예 없어도 null —
 * 이 경우 "아직 비교 불가"일 뿐 오류가 아니다(호출부가 안내 문구로 처리).
 */
export function findSljAsymmetry({ reports, currentReport }) {
  if (!currentReport?.leg || currentReport.heightCm == null) return null;
  const oppositeLeg = currentReport.leg === 'left' ? 'right' : 'left';
  const candidates = (reports || [])
    .filter((r) => r
      && r.id !== currentReport.id
      && r.kind === 'jump'
      && resolveJumpSubType(r) === 'slj'
      && r.leg === oppositeLeg
      && r.valid !== false
      && r.heightCm != null)
    .sort((a, b) => new Date(b.createdAt || b.measuredAt || 0) - new Date(a.createdAt || a.measuredAt || 0));
  const other = candidates[0];
  if (!other) return null;

  const result = computeLegAsymmetry({
    leftValue: currentReport.leg === 'left' ? currentReport.heightCm : other.heightCm,
    rightValue: currentReport.leg === 'right' ? currentReport.heightCm : other.heightCm,
  });
  if (!result) return null;

  return {
    ...result,
    otherReportDate: other.createdAt || other.measuredAt || null,
    otherReportId: other.id || null,
  };
}
