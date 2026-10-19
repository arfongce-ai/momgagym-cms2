// romThresholds.js — ROM 좌우 비대칭 기준을 한 곳에 모은다 (2026-10)
//
// 배경: 한 화면은 15% 이상, 다른 곳은 10% 초과를 '주의'로 봐서 같은 측정이 화면마다 다르게 판정됐다.
// 값은 romClinical.js(트레이너 평가 로직)의 기존 기준(8% 미만 양호 / 8~15% 경미 / 15% 이상 뚜렷)을 그대로 쓴다.
// ⚠️ 관절 가동범위 좌우차의 '검증된 절단값'은 확인하지 못했다(2026-10 조사: 관련 연구에서 수치 절단값 미확인).
//    따라서 이 값은 참고 기준이며, 해석은 트레이너 판단과 함께 한다.
export const ROM_SYMMETRY_GOOD_MAX_PCT = 8;
export const ROM_SYMMETRY_CAUTION_MAX_PCT = 15;
export const ROM_SYMMETRY_RANGE = Object.freeze({
  good: [0, ROM_SYMMETRY_GOOD_MAX_PCT],
  warn: [0, ROM_SYMMETRY_CAUTION_MAX_PCT],
});
