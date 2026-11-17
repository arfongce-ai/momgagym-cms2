// [2026-11-17] 연령·성별 참고 규준(등급표). 회원관리에 등록된 생년월일·성별로 자동 적용한다.
// 출처: VO2max — The Cooper Institute 표준 등급(Garmin 매뉴얼 'VO2 Max. Standard Ratings'에 전재된 표, 백분위 95/80/60/40).
// 주의: 표에 없는 연령(20세 미만·80세 이상)과 성별 미입력은 등급을 만들지 않는다(null). 추정 VO2max는 참고치이므로 등급도 '참고 등급'이다.
const BANDS = ['20-29', '30-39', '40-49', '50-59', '60-69', '70-79'];
const VO2_CUTS = {
  male: { // [Superior(95), Excellent(80), Good(60), Fair(40)] 하한
    '20-29': [55.4, 51.1, 45.4, 41.7], '30-39': [54, 48.3, 44, 40.5], '40-49': [52.5, 46.4, 42.4, 38.5],
    '50-59': [48.9, 43.4, 39.2, 35.6], '60-69': [45.7, 39.5, 35.5, 32.3], '70-79': [42.1, 36.7, 32.3, 29.4],
  },
  female: {
    '20-29': [49.6, 43.9, 39.5, 36.1], '30-39': [47.4, 42.4, 37.8, 34.4], '40-49': [45.3, 39.7, 36.3, 33],
    '50-59': [41.1, 36.7, 33, 30.1], '60-69': [37.8, 33, 30, 27.5], '70-79': [36.7, 30.9, 28.1, 25.9],
  },
};
const LABELS = ['최상위', '우수', '양호', '보통', '낮음'];
const TONES = ['normal', 'normal', 'normal', 'caution', 'risk'];

export function ageBand(age) {
  const a = Number(age);
  if (!Number.isFinite(a) || a < 20 || a >= 80) return null;
  return BANDS[Math.min(5, Math.floor((a - 20) / 10))];
}

// → { label, tone, band, source } | null
export function vo2maxRating(value, age, sex) {
  const v = Number(value);
  const band = ageBand(age);
  const cuts = band && VO2_CUTS[sex]?.[band];
  if (!Number.isFinite(v) || v <= 0 || !cuts) return null;
  const idx = cuts.findIndex((c) => v >= c);
  const i = idx === -1 ? 4 : idx;
  return { label: LABELS[i], tone: TONES[i], band, source: 'Cooper Institute' };
}
