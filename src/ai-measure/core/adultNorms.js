// ai-measure/core/adultNorms.js
// ════════════════════════════════════════════════════════════════════════
//  국민체력100 성인(19~64세) 인증기준 — 항목별 1·2·3등급 기준값 (모두 "이상")
//  · 출처: 체력컷(pregrade.kr/standards/) 연령·성별 페이지(기준 확인일 2026-11-14), 대표님이 공식 원문이라고 확인(2026-11-25).
//    3등급 값은 같은 사이트 '3등급 기준표'와 대조해 일치함을 확인. 국민체력100 누리집 원본과의 직접 대조는 못 함.
//  · 이 앱에 있는 종목만 담는다: 앉아윗몸앞으로굽히기(cm), 상대악력(%=악력kg÷체중kg×100), 제자리멀리뛰기(cm, 1·2등급만).
//    교차윗몸일으키기·20m 왕복오래달리기 등은 앱에 없어 넣지 않았다.
//  · 국민체력100의 최종 1~6등급은 건강체력 4종(+운동체력/신체조성)을 모두 잰 뒤 정해진다.
//    그래서 여기서는 "항목별로 어느 등급 기준을 넘었는지"만 낸다(종합 등급을 임의로 만들지 않음).
// ════════════════════════════════════════════════════════════════════════
export const ADULT_AGE_BANDS = [[19, 24], [25, 29], [30, 34], [35, 39], [40, 44], [45, 49], [50, 54], [55, 59], [60, 64]];

export const ADULT_NORM_SOURCE = { label: '국민체력100 인증기준(체력컷 기준표, 2026-11-14 확인)', status: 'official-site' };

// [1등급, 2등급, 3등급(없으면 null)] — 연령대 순서는 ADULT_AGE_BANDS 와 같다.
export const ADULT_NORMS = {
  sitreach: {
    male: [[16.1, 11.1, 6.1], [14.9, 10.1, 5.3], [14.2, 9.4, 4.6], [14, 9.3, 4.6], [14.2, 9.5, 4.8], [13.6, 9.1, 4.6], [13.9, 9.3, 4.7], [13.3, 8.6, 3.9], [11.8, 7.1, 2.3]],
    female: [[19.7, 14.9, 10.1], [18.5, 13.8, 9.1], [18.2, 13.8, 9.4], [18.9, 14.5, 10.1], [18.8, 14.6, 10.4], [18.9, 14.8, 10.7], [19.5, 15.6, 11.7], [19.5, 15.7, 11.9], [19.6, 15.7, 11.8]],
  },
  relgrip: {
    male: [[62.6, 57.2, 51.8], [62.4, 57, 51.6], [62.6, 57.2, 51.8], [62.1, 56.6, 51.1], [62.8, 57.2, 51.6], [62, 56.7, 51.4], [60.5, 55.3, 50.1], [59.4, 54.2, 49], [56.8, 51.7, 46.6]],
    female: [[46.8, 42.4, 38], [47, 42.6, 38.2], [49.6, 45.2, 40.8], [47.5, 43.1, 38.7], [47.1, 42.8, 38.5], [46.2, 41.9, 37.6], [44.7, 40.6, 36.5], [43.2, 39.2, 35.2], [41.9, 38, 34.1]],
  },
  standlong: {
    male: [[229, 213, null], [223, 208, null], [219, 204, null], [214, 199, null], [209, 195, null], [202, 188, null], [192, 177, null], [183, 168, null], [170, 154, null]],
    female: [[162, 149, null], [156, 144, null], [154, 142, null], [155, 144, null], [153, 142, null], [148, 136, null], [138, 126, null], [129, 117, null], [120, 107, null]],
  },
};

export function adultBandIndex(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return -1;
  return ADULT_AGE_BANDS.findIndex(([lo, hi]) => a >= lo && a <= hi);
}

/** 상대악력(%) = 악력(kg) ÷ 체중(kg) × 100. 값·체중이 없으면 null. */
export function relativeGripPct(gripKg, weightKg) {
  const g = Number(gripKg); const w = Number(weightKg);
  if (!Number.isFinite(g) || !Number.isFinite(w) || w <= 0 || g < 0) return null;
  return Math.round((g / w) * 1000) / 10;
}

/**
 * 항목별 판정. 반환: { level: 1|2|3|0, text } — level 0 = 3등급 기준 미만(운동체력은 2등급 기준 미만).
 * 연령(19~64)·성별·값이 없으면 null.
 */
export function adultItemLevel(normKey, value, { sex, age } = {}) {
  const idx = adultBandIndex(age);
  const row = ADULT_NORMS[normKey]?.[sex]?.[idx];
  const v = Number(value);
  if (!row || value === '' || value == null || !Number.isFinite(v)) return null;
  const [lo, hi] = ADULT_AGE_BANDS[idx];
  const band = `${lo}~${hi}세 ${sex === 'male' ? '남' : '여'}`;
  const ref = row.map((x, i) => (x == null ? null : `${i + 1}등급 ${x}`)).filter(Boolean).join(' · ');
  for (let i = 0; i < 3; i += 1) if (row[i] != null && v >= row[i]) return { level: i + 1, band, reference: ref };
  return { level: 0, band, reference: ref };
}
