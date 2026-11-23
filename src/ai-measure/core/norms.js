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

// ════════════════════════════════════════════════════════════════════════
//  [2026-11-17] 달리기 기준표(평지·모터 트레드밀 기준) — 2.4km(1.5마일) 시간 / 12분 달리기 거리
//  ※ 화면에는 보여주지 않는다. 커브드 트레드밀(Seared)은 같은 속도에서도 훨씬 힘들어 책 표를 그대로 쓰면 체력이 낮게 나온다.
//     대표님 결정: 커브드 기록은 회원 본인의 회차 비교로만 보고, 아래 기준표 대비 값은 '연구용 데이터'로만 저장한다(researchData.js).
//  출처
//   · 2.4km 표: 대표님이 보내 주신 교재 표 13.15(여 20-29)·13.16(남 30-39)·13.17(여 30-39) — VO2max 백분위(Cooper Institute/ACSM)를
//     George 1993 공식(VO2max = 483/분 + 3.5)으로 환산한 시간. 교재 값은 전부 이 공식과 맞는다(아래 검산 테스트).
//   · 12분 표: 교재 표 13.19(20-49세, 남·여) — Cooper 1968 공식(VO2max = (m − 504.9)/44.73)과 맞는다.
//   · 교재에 없는 연령·성별(2.4km 남 20대, 40대 이상 / 12분 50대 이상)은 위 Cooper Institute VO2max 등급표(VO2_CUTS)를
//     같은 공식으로 바꿔 계산한다 → source 가 'derived'(계산값)로 표시된다. 교재 원문이 아니다.
// ════════════════════════════════════════════════════════════════════════
export const RUN_PERCENTILES_2400 = [99, 90, 80, 70, 60, 50, 40, 30, 20, 10, 1];
// [VO2max, 시간(분:초)] — 백분위 99→01 순서. 값이 클수록 좋은(빠른) 쪽이 앞.
const BOOK_2400 = {
  'female-20-29': [[54.5, '9:30'], [46.8, '11:10'], [43.9, '11:58'], [41.1, '12:51'], [39.5, '13:24'], [37.8, '14:04'], [36.1, '14:50'], [34.1, '15:46'], [32.3, '16:46'], [29.5, '18:33'], [23.7, '23:58']],
  'male-30-39': [[58.3, '8:49'], [51.7, '10:01'], [48.3, '10:46'], [46.0, '11:22'], [44.1, '11:54'], [42.4, '12:24'], [40.7, '12:58'], [38.7, '13:44'], [36.7, '14:34'], [33.8, '15:57'], [26.5, '20:58']],
  'female-30-39': [[52.0, '9:58'], [45.3, '11:33'], [42.4, '12:24'], [39.6, '13:24'], [37.7, '14:08'], [36.7, '14:34'], [34.2, '15:43'], [32.4, '16:42'], [30.9, '17:38'], [28.0, '19:43'], [22.9, '24:56']],
};
export const RUN_PERCENTILES_12MIN = [90, 80, 70, 60, 50, 40, 30, 20, 10];
// 12분 달리기 거리(km) — 백분위 90→10 순서. 남 40-49 의 90·60 백분위는 교재 인쇄가 흐려(1.72/1.40) miles 열(1.69/1.49)로 바로잡았다.
const BOOK_12MIN_KM = {
  'male-20-29': [2.90, 2.78, 2.62, 2.54, 2.46, 2.37, 2.29, 2.20, 2.06],
  'male-30-39': [2.82, 2.67, 2.56, 2.48, 2.40, 2.32, 2.24, 2.14, 2.01],
  'male-40-49': [2.72, 2.57, 2.46, 2.40, 2.30, 2.22, 2.14, 2.06, 1.95],
  'female-20-29': [2.59, 2.46, 2.35, 2.27, 2.20, 2.12, 2.03, 1.95, 1.82],
  'female-30-39': [2.53, 2.40, 2.27, 2.19, 2.14, 2.04, 1.95, 1.88, 1.75],
  'female-40-49': [2.43, 2.27, 2.20, 2.11, 2.04, 1.96, 1.90, 1.82, 1.70],
};

export const parseClockSec = (s) => {
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// George 1993: VO2max = 483 / 시간(분) + 3.5  (2.4km 최대 달리기)
export const vo2maxFromRun2400 = (timeSec) => (Number(timeSec) > 0 ? Math.round((483 / (timeSec / 60) + 3.5) * 10) / 10 : null);
export const run2400SecFromVo2max = (vo2) => (Number(vo2) > 3.5 ? Math.round((483 / (vo2 - 3.5)) * 60) : null);
// Cooper 1968: VO2max = (12분 거리 m − 504.9) / 44.73
export const vo2maxFromRun12 = (distanceM) => (Number(distanceM) > 0 ? Math.round(((distanceM - 504.9) / 44.73) * 10) / 10 : null);
export const run12mFromVo2max = (vo2) => (Number(vo2) > 0 ? Math.round(vo2 * 44.73 + 504.9) : null);

function groupKey(sex, age) {
  const band = ageBand(age);
  return band && (sex === 'male' || sex === 'female') ? `${sex}-${band}` : null;
}

// 교재 행 → [{ pct, vo2, timeSec }]
function bookRows2400(key) {
  const rows = BOOK_2400[key];
  return rows ? rows.map(([vo2, t], i) => ({ pct: RUN_PERCENTILES_2400[i], vo2, timeSec: parseClockSec(t) })) : null;
}

// Cooper VO2max 등급 하한(95/80/60/40 백분위) → 같은 모양의 계산 행
function derivedRows(key, toValue) {
  const [sex, band] = [key.split('-')[0], key.split('-').slice(1).join('-')];
  const cuts = VO2_CUTS[sex]?.[band];
  if (!cuts) return null;
  return [95, 80, 60, 40].map((pct, i) => ({ pct, vo2: cuts[i], value: toValue(cuts[i]) }));
}

/**
 * 2.4km 달리기 시간의 기준표 상 위치(평지 기준) — 연구용 저장 전용, 화면 비표시.
 * → { source: 'book'|'derived', group, percentile, vo2max, approx } | null
 */
export function run2400Reference(sex, age, timeSec) {
  const key = groupKey(sex, age);
  const t = Number(timeSec);
  if (!key || !Number.isFinite(t) || t <= 0) return null;
  const vo2max = vo2maxFromRun2400(t);
  const book = bookRows2400(key);
  if (book) {
    // 시간이 짧을수록 백분위가 높다. 행은 빠른 순서(99→01).
    if (t <= book[0].timeSec) return { source: 'book', group: key, percentile: 99, vo2max, approx: false };
    if (t >= book[book.length - 1].timeSec) return { source: 'book', group: key, percentile: 1, vo2max, approx: false };
    for (let i = 1; i < book.length; i += 1) {
      if (t <= book[i].timeSec) {
        const a = book[i - 1]; const b = book[i];
        const f = (t - a.timeSec) / (b.timeSec - a.timeSec);
        return { source: 'book', group: key, percentile: Math.round(a.pct + (b.pct - a.pct) * f), vo2max, approx: true };
      }
    }
  }
  const rows = derivedRows(key, run2400SecFromVo2max);
  if (!rows) return null;
  // 계산값은 95/80/60/40 네 칸만 있어 구간(이상)으로만 말한다.
  const hit = rows.find((r) => t <= r.value);
  return { source: 'derived', group: key, percentile: hit ? hit.pct : 20, vo2max, approx: true, band: hit ? `${hit.pct}이상` : '40미만' };
}

/** 12분 달리기 거리(m)의 기준표 상 위치(평지 기준) — 연구용 저장 전용. */
export function run12Reference(sex, age, distanceM) {
  const key = groupKey(sex, age);
  const d = Number(distanceM);
  if (!key || !Number.isFinite(d) || d <= 0) return null;
  const vo2max = vo2maxFromRun12(d);
  const km = BOOK_12MIN_KM[key];
  if (km) {
    const x = d / 1000;
    if (x >= km[0]) return { source: 'book', group: key, percentile: 90, vo2max, approx: true, band: '90이상' };
    if (x < km[km.length - 1]) return { source: 'book', group: key, percentile: 10, vo2max, approx: true, band: '10미만' };
    for (let i = 1; i < km.length; i += 1) {
      if (x >= km[i]) {
        const f = (km[i - 1] - x) / (km[i - 1] - km[i]);
        return { source: 'book', group: key, percentile: Math.round(RUN_PERCENTILES_12MIN[i - 1] - 10 * f), vo2max, approx: true };
      }
    }
  }
  const rows = derivedRows(key, run12mFromVo2max);
  if (!rows) return null;
  const hit = rows.find((r) => d >= r.value);
  return { source: 'derived', group: key, percentile: hit ? hit.pct : 20, vo2max, approx: true, band: hit ? `${hit.pct}이상` : '40미만' };
}

// 검산·테스트용으로 표 원본을 내보낸다.
export const RUN_BOOK_TABLES = { run2400: BOOK_2400, run12minKm: BOOK_12MIN_KM };

// ════════════════════════════════════════════════════════════════════════
//  [2026-11-23] 교재 표 8.2 — 1.5마일(2.4km) 달리기/걷기 시간 백분위(Cooper Institute, 평지·트랙 기준)
//  행 순서: 백분위 90→10. 값은 분:초. 필드(트랙·평지) 테스트에만 화면에 보여 준다(커브드는 제외 — 위 주석 참고).
// ════════════════════════════════════════════════════════════════════════
export const TABLE_8_2_PERCENTILES = [90, 80, 70, 60, 50, 40, 30, 20, 10];
const TABLE_8_2 = {
  'male-20-29': ['9:34', '10:08', '10:49', '11:27', '11:58', '12:29', '13:08', '13:58', '15:14'],
  'female-20-29': ['10:59', '11:56', '12:51', '13:25', '14:15', '15:05', '15:56', '17:11', '18:39'],
  'male-30-39': ['9:52', '10:38', '11:09', '11:49', '12:25', '12:53', '13:48', '14:33', '15:56'],
  'female-30-39': ['11:43', '12:53', '13:41', '14:33', '15:14', '15:56', '16:46', '18:18', '20:13'],
  'male-40-49': ['10:09', '11:09', '11:52', '12:25', '13:05', '13:50', '14:33', '15:32', '17:04'],
  'female-40-49': ['12:25', '13:38', '14:33', '15:17', '16:13', '17:11', '18:26', '19:43', '21:52'],
  'male-50-59': ['11:09', '12:08', '12:53', '13:53', '14:33', '15:14', '16:16', '17:30', '19:24'],
  'female-50-59': ['13:58', '15:14', '16:26', '17:19', '18:05', '19:10', '20:17', '21:57', '23:55'],
  'male-60-69': ['12:10', '13:25', '14:33', '15:20', '16:19', '17:19', '18:39', '20:13', '23:27'],
  'female-60-69': ['15:32', '16:46', '18:05', '18:52', '20:08', '20:55', '22:34', '23:55', '26:32'],
};
export const TABLE_8_2_BOOK = TABLE_8_2;

/** 1.5마일 시간(초)의 교재 표 8.2 백분위. 20~69세·남/여만. → { percentile, band?, group, source } | null */
export function run15Percentile(sex, age, timeSec) {
  const a = Number(age);
  const t = Number(timeSec);
  if (!(sex === 'male' || sex === 'female') || !Number.isFinite(a) || a < 20 || a >= 70 || !(t > 0)) return null;
  const decade = Math.floor(a / 10) * 10;
  const group = `${sex}-${decade}-${decade + 9}`;
  const row = TABLE_8_2[group]?.map(parseClockSec);
  if (!row) return null;
  const base = { group, source: 'table8.2' };
  if (t <= row[0]) return { ...base, percentile: 90, band: '90이상' };
  if (t >= row[row.length - 1]) return { ...base, percentile: 10, band: '10이하' };
  for (let i = 1; i < row.length; i += 1) {
    if (t <= row[i]) {
      const f = (t - row[i - 1]) / (row[i] - row[i - 1]);
      return { ...base, percentile: Math.round(TABLE_8_2_PERCENTILES[i - 1] - 10 * f) };
    }
  }
  return null;
}
