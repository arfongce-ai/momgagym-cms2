// jumpPower.js — 수직 점프 파워 추정식·EUR·보조 공식 모음 (순수 함수).
// 출처: Haff & Dumke, Laboratory Manual for Exercise Physiology, 12장 (p.306~316, 실습 12.2/12.3).
//  · 점프 높이는 cm, 체중 kg, 신장 cm 입력. 결과는 W(와트).
//  · 추정식은 "참고값"이다 — 힘판(포스플레이트)으로 잰 실측 파워가 아니다.
//    (책 p.312: 수직 점프는 높이만 알려주고 진짜 파워를 주지 않아 추정식을 쓴다.)
//  · 인쇄본 확인 메모(2026-11-24):
//    - Johnson 평균 파워 상수는 본문 p.312의 +431을 쓴다(실습지 p.330·338은 −1,393으로 인쇄 — 값이 비현실적이라 오기로 판단).
//    - Harman 최대 파워(+1,822)는 책 표기 그대로이나 일반 체형에서 Sayer의 약 2배 값이 나온다. 화면에는 쓰지 않는다.
//    - Lewis는 본문 p.312가 높이(m), 실습지가 cm로 달라 m 기준(표준형)으로 구현하고 W로 환산(×9.81).
const G = 9.81;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
const r0 = (x) => Math.round(x);
const r2 = (x) => Math.round(x * 100) / 100;

// 체공시간(s) → 수직 변위(cm). 책 p.310·334: h(m) = 9.81 × t² / 8
export function flightTimeToHeightCm(flightSec) {
  const t = pos(flightSec);
  return t == null ? null : r2((G * t * t / 8) * 100);
}

export function sayerPeakPower(heightCm, massKg) {
  const h = pos(heightCm), m = pos(massKg);
  return h == null || m == null ? null : r0(60.7 * h + 45.3 * m - 2055);
}
export function harmanPeakPower(heightCm, massKg) {
  const h = pos(heightCm), m = pos(massKg);
  return h == null || m == null ? null : r0(61.9 * h + 36 * m + 1822);
}
export function harmanAveragePower(heightCm, massKg) {
  const h = pos(heightCm), m = pos(massKg);
  return h == null || m == null ? null : r0(21.2 * h + 23 * m - 1393);
}
// Johnson & Bahamonde — 신장(cm)이 추가로 필요하다.
export function johnsonPeakPower(heightCm, massKg, bodyHeightCm) {
  const h = pos(heightCm), m = pos(massKg), bh = pos(bodyHeightCm);
  return h == null || m == null || bh == null ? null : r0(78.5 * h + 60.6 * m - 15.3 * bh - 1308);
}
export function johnsonAveragePower(heightCm, massKg, bodyHeightCm) {
  const h = pos(heightCm), m = pos(massKg), bh = pos(bodyHeightCm);
  return h == null || m == null || bh == null ? null : r0(41.4 * h + 31.2 * m - 13.9 * bh + 431);
}
// Lewis: P(kg·m/s) = √4.9 × 체중 × √높이(m) → W 환산.
export function lewisPower(heightCm, massKg) {
  const h = pos(heightCm), m = pos(massKg);
  return h == null || m == null ? null : r0(Math.sqrt(4.9) * m * Math.sqrt(h / 100) * G);
}

// 한 번에 계산(화면용). 입력이 없는 값은 null.
export function estimateVerticalPowers({ heightCm, massKg, bodyHeightCm } = {}) {
  return {
    sayerPeak: sayerPeakPower(heightCm, massKg),
    johnsonPeak: johnsonPeakPower(heightCm, massKg, bodyHeightCm),
    johnsonAverage: johnsonAveragePower(heightCm, massKg, bodyHeightCm),
    harmanPeak: harmanPeakPower(heightCm, massKg),
    harmanAverage: harmanAveragePower(heightCm, massKg),
    lewis: lewisPower(heightCm, massKg),
  };
}

// 편심 활용 비율(EUR) = 반동점프 / 정적점프 (책 p.313). 높이든 파워든 같은 단위끼리 나눈다.
export function eccentricUtilizationRatio(cmjValue, sjValue) {
  const c = pos(cmjValue), s = pos(sjValue);
  return c == null || s == null ? null : r2(c / s);
}

// 표 12.6 EUR 규준(평균, 표준편차). McGuigan 외·Hawkins 외·미발표 자료. 종목별 선수 집단이며 일반 회원 규준이 아니다.
export const EUR_NORMS = [
  { sport: '필드하키', men: null, women: { mean: 1.02, sd: 0.13 } },
  { sport: '럭비 유니언', men: { mean: 1.13, sd: 0.14 }, women: null },
  { sport: '축구', men: { mean: 1.14, sd: 0.15 }, women: { mean: 1.17, sd: 0.16 } },
  { sport: '소프트볼', men: { mean: 1.03, sd: 0.09 }, women: { mean: 1.04, sd: 0.13 } },
  { sport: '육상(투척)', men: { mean: 1.11, sd: 0.10 }, women: { mean: 1.05, sd: 0.06 } },
  { sport: '육상(점프·스프린트)', men: { mean: 1.11, sd: 0.10 }, women: { mean: 1.11, sd: 0.10 } },
  { sport: '비훈련자', men: { mean: 1.17, sd: 0.17 }, women: null },
];

// Bosco 연속 점프 — 기계적 파워(W/kg) = g²·Tf·Tt / (4·n·(Tt − Tf)). 60초면 Tt=60 (책 p.312~313).
export function boscoMechanicalPower(totalFlightSec, jumps, totalSec = 60) {
  const tf = pos(totalFlightSec), n = pos(jumps), tt = pos(totalSec);
  if (tf == null || n == null || tt == null || tt <= tf) return null;
  return r2((G * G * tf * tt) / (4 * n * (tt - tf)));
}

// 표 12.8 — 60초 파워지구력 점프 규준(평균 ± 표준편차). Bosco 외·Hespanhol 외·Sands 외. 선수·청소년 집단이며 일반 회원 규준이 아니다.
export const BOSCO_GROUP_NORMS = [
  { group: '남자 농구선수', jumps: { mean: 56.8, sd: 4.3 }, power: { mean: 19.8, sd: 2.2 } },
  { group: '남자 배구선수', jumps: { mean: 50.8, sd: 2.7 }, power: { mean: 19.6, sd: 2.6 } },
  { group: '청소년 남자', jumps: { mean: 63.2, sd: 5.8 }, power: { mean: 22.2, sd: 1.8 } },
  { group: '여자 선수', jumps: null, power: { mean: 12.2, sd: 2.4 } },
  { group: '남자 선수', jumps: null, power: { mean: 17.8, sd: 2.7 } },
];

// 표 12.9 — 60초 파워지구력 점프 백분위 규준(Maud & Foster 2005, p.229). 절대(W)·상대(W/kg). 백분위 95→5 순서.
// 인쇄본 확인(2026-11-24): 5·10·평균 행까지 단조 감소로 읽힘. 남자 95백분위 상대값 29.85는 90백분위(19.90)와 격차가 커 이상치일 수 있으나 인쇄 그대로 둔다.
const BOSCO_PCT_RANKS = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5];
export const BOSCO_PERCENTILES = {
  male: {
    absolute: [2385, 1556, 1481, 1464, 1395, 1367, 1309, 1267, 1249, 1223, 1203, 1172, 1140, 1120, 1101, 1083, 1060, 986, 922],
    relative: [29.85, 19.90, 18.80, 17.80, 17.35, 17.30, 16.35, 16.10, 16.05, 15.90, 15.55, 15.30, 15.30, 15.10, 14.70, 14.70, 14.45, 14.10, 12.50],
    mean: { absolute: 1289, relative: 16.69 },
  },
  female: {
    absolute: [961, 885, 848, 810, 746, 740, 730, 723, 705, 703, 698, 667, 639, 623, 619, 594, 583, 547, 470],
    relative: [15.32, 13.46, 13.34, 13.26, 12.80, 12.52, 11.94, 11.80, 11.60, 11.60, 11.42, 11.04, 10.76, 10.08, 9.70, 9.52, 9.40, 9.20, 8.48],
    mean: { absolute: 700, relative: 11.47 },
  },
};

// 상대 파워(W/kg)가 표 12.9의 어느 백분위 구간인지. 값 이상인 가장 높은 백분위를 돌려주고, 5백분위 값보다 낮으면 { below: true }.
// 규준표이므로 "참고"로만 쓴다 — 인원·측정 방식이 다른 집단 자료다.
export function boscoPercentile(sex, relativeWPerKg) {
  const v = num(relativeWPerKg);
  const t = BOSCO_PERCENTILES[sex === 'F' || sex === 'female' ? 'female' : sex === 'M' || sex === 'male' ? 'male' : ''];
  if (v == null || !t) return null;
  const i = t.relative.findIndex((x) => v >= x);
  return i === -1 ? { below: true, percentile: null } : { below: false, percentile: BOSCO_PCT_RANKS[i] };
}

// 스톱워치 → 전자 타이머 환산 (책 p.307): 전자 = 1.0113 × 스톱워치 + 0.2252
export function stopwatchToElectronic(stopwatchSec) {
  const t = pos(stopwatchSec);
  return t == null ? null : r2(1.0113 * t + 0.2252);
}
// 수평 파워(kg·m/s) = 체중 × 거리 / 시간 (책 p.307)
export function horizontalPower(massKg, distanceM, timeSec) {
  const m = pos(massKg), d = pos(distanceM), t = pos(timeSec);
  return m == null || d == null || t == null ? null : r2(m * d / t);
}
// Margaria-Kalamen 계단 오르기: P(kg·m/s) = 체중 × 1.05m / 시간(3→9번째 계단), W = ×9.807 (책 p.316)
export function margariaKalamenPower(massKg, seconds, verticalM = 1.05) {
  const m = pos(massKg), t = pos(seconds), v = pos(verticalM);
  if (m == null || t == null || v == null) return null;
  const kgms = m * v / t;
  return { kgms: r2(kgms), watts: r0(kgms * 9.807) };
}
