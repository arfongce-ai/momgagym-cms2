// gaitMode.js — 걷기/달리기 구분 및 케이던스·입각기 기준 (2026-10)
//
// 배경: 보행/러닝 분석 한 메뉴가 걷기와 달리기를 모두 받는데, 기준(케이던스 160~180)이
// 달리기 기준 하나뿐이라 걷기 회원(실측 중앙값 약 116 spm)이 전부 '범위 밖'으로 나왔다.
// 데이터에 걷기/달리기 구분 필드가 없어, 케이던스로 구분한다.
//
// 근거:
//  - 걷기 강도 연구(CADENCE-adults, 21~40세): 분당 100걸음 ≈ 중강도(3 METs), 130걸음 ≈ 고강도(6 METs).
//    https://shareok.org/handle/11244/335264
//  - 달리기는 통상 150~180 spm. 걷기와 달리기 사이(약 130~150)는 '빠르게 걷기/가볍게 뛰기' 구간.
// ⚠️ 구분선 140 과 아래 기준은 참고용이며 트레이너가 조정할 수 있게 상수로 모아 둔다.
// 입각기(stance) 55~65%는 걷기 기준이다(달리기는 입각기가 더 짧아 같은 기준을 쓸 수 없음).

export const GAIT_MODE_SPLIT_SPM = 140;

export const GAIT_CADENCE_RANGES = Object.freeze({
  walk: Object.freeze({ good: [100, 130], warn: [85, 140] }),
  run: Object.freeze({ good: [160, 180], warn: [150, 190] }),
});

// 근거: Magee 'Orthopedic Physical Assessment' — 입각기는 걷기 주기의 60~65%(유각기 35~40%). 55~65 는 영상 근사 오차를 감안한 범위.
export const GAIT_STANCE_RANGE_WALK = Object.freeze({ good: [55, 65], warn: [50, 70] });

export const GAIT_MODE_LABEL = Object.freeze({ walk: '걷기', run: '달리기' });

/** 케이던스(spm)로 걷기/달리기를 구분한다. 값이 없으면 null. */
export function classifyGaitMode(cadence) {
  const n = Number(cadence);
  if (cadence == null || cadence === '' || !Number.isFinite(n) || n <= 0) return null;
  return n < GAIT_MODE_SPLIT_SPM ? 'walk' : 'run';
}

/** 케이던스 기준범위. 구분 못 하면 달리기 기준(기존 동작)을 쓴다. */
export function cadenceRangeFor(cadence) {
  return GAIT_CADENCE_RANGES[classifyGaitMode(cadence) || 'run'];
}

/** 입각기 기준범위. 걷기만 있고, 달리기는 null(판정하지 않음). */
export function stanceRangeFor(cadence) {
  return classifyGaitMode(cadence) === 'run' ? null : GAIT_STANCE_RANGE_WALK;
}

// ── 수직 진폭(골반 높이 위아래 움직임) 기준 (2026-10) ──
// 단위: 어깨~발목 길이 대비 %. (앱은 어깨 중점~발목 중점 수직거리로 정규화한다. 인체계측상 키의 약 78%,
//  키 170cm 기준 약 132cm — Drillis & Contini 비율에서 어깨높이 0.818H, 외측복사 0.039H.)
//  - 걷기: 무게중심 상하 이동 — Neumann Kinesiology 15장(p.671~672) 성인 남성 평균 속도에서 약 5cm,
//    마커 연구(52명, 21~31세) 키의 2.16%(≈3.7cm @170cm). 둘을 어깨~발목 길이(≈키의 78%) 대비로 환산하면 약 2.8~3.8%.
//    양호 2.5~4.0% (이전 상한 5.0%는 약 6.6cm로 근거 값보다 느슨해 낮춤. 평균만 있고 SD가 없어 상한은 책 값 5cm 기준).
//  - 달리기: 러닝 코칭 가이드에서 흔히 쓰는 목표 약 6~9cm → 약 4.5~7% 가 중심. 양호 4.5~7.5%
// ⚠️ 임상 절단값이 아니라 참고 기준이며, 골반 랜드마크로 잰 근사치다. 트레이너가 조정할 수 있게 상수로 둔다.
export const GAIT_VERTICAL_OSC_RANGES = Object.freeze({
  walk: Object.freeze({ good: [2.5, 4.0], warn: [1.5, 5.5] }),
  run: Object.freeze({ good: [4.5, 7.5], warn: [3.0, 9.5] }),
});

export function verticalOscRangeFor(cadence) {
  return GAIT_VERTICAL_OSC_RANGES[classifyGaitMode(cadence) || 'run'];
}
