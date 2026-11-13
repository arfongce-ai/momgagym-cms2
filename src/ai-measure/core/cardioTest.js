// ai-measure/core/cardioTest.js
// ════════════════════════════════════════════════════════════════════════
//  [11번 심폐지구력 2026-11-12] 테스트 정의·기록 요약·VO2max 참고 추정·누적 보정.
//  원칙(프로젝트 설계 원칙: AI가 확정 판정하지 않는다)
//   · 1초 단위 원본(심박·와트·케이던스·거리)을 그대로 저장한다 → 나중에 공식·보정을
//     바꿔도 과거 기록을 다시 계산할 수 있다.
//   · 추정값은 전부 "참고 추정치" + 계산 방법 + 신뢰 등급을 함께 남긴다.
//   · 기록이 쌓일수록 정확해지는 3가지
//       ① 개인 최대심박: 220-나이 → 실제로 찍힌 최고 심박이 더 높으면 그 값으로 교체
//       ② 심박-파워 직선: 같은 회원·같은 장비의 단계 테스트 점을 모아(최근 180일) 다시 맞춤
//       ③ 기준값 보정: 트레이너가 다른 곳에서 잰 실측 VO2max 를 넣어 두면 그 비율로 보정
//  순수 함수만 둔다(화면·블루투스 없음) — 테스트에서 직접 실행해 검증한다.
// ════════════════════════════════════════════════════════════════════════
import { maxHeartRateFromAge } from './heartRateBle';

export const CARDIO_RECORD_KIND = 'cardio_test';
export const CARDIO_SERIES_MAX_SEC = 3600; // 1초 단위 원본 저장 상한(1시간)
export const RECOVERY_SEC = 60;             // 테스트 종료 후 회복 심박 기록 시간
const POOL_DAYS = 180;                      // 심박-파워 직선에 모으는 과거 기간

export const CARDIO_MACHINES = {
  rower: { id: 'rower', label: '로잉머신', model: 'KeyTec', cadenceUnit: 'spm', ble: true },
  bike: { id: 'bike', label: '에어바이크', model: 'KeyTec', cadenceUnit: 'rpm', ble: true },
  ski: { id: 'ski', label: '스키에르고미터', model: 'Overmax', cadenceUnit: 'spm', ble: true },
  treadmill: { id: 'treadmill', label: '커브드 트레드밀', model: 'Seared', cadenceUnit: '', ble: false },
  climber: { id: 'climber', label: '마운틴 클라이머', model: '', cadenceUnit: '', ble: false },
};

// 단계 테스트(최대하) 기본 시작·증가 와트.
export const STEP_DEFAULTS = {
  rower: { startW: 60, incW: 30 },
  bike: { startW: 50, incW: 25 },
  ski: { startW: 40, incW: 20 },
};
export const STEP_STAGE_SEC = 180;
export const STEP_STOP_PCT = 85; // 최대심박의 85%에 닿으면 종료(최대하 원칙)

export const CARDIO_PROTOCOLS = [
  {
    id: 'rower_2k', machines: ['rower'], label: '2000m 기록 테스트', short: '2000m',
    target: { distanceM: 2000 }, maximal: true, estimate: 'hagerman',
    guide: '최대한 빠르게 2000m. 2000m에 닿으면 자동으로 끝나고 1분 회복 심박을 잽니다.',
    caution: '전력 테스트입니다. 재활·고령 회원은 단계 테스트를 쓰세요.',
    info: {
      what: '2000m를 얼마나 빨리 노를 저어 가는지로, 몸이 산소를 최대로 쓰는 능력(심폐지구력)을 추정합니다.',
      how: ['2~3분 가볍게 저으며 몸을 풉니다.', '시작을 누르고 최대한 빠르게 저어 갑니다.', '2000m가 되면 자동으로 끝나고, 1분 동안 가만히 앉아 회복 심박을 잽니다.'],
      read: '2000m 시간이 줄면 좋아진 것입니다. VO2max 숫자는 참고용이고, 같은 장비·같은 방법끼리 비교할 때 가장 정확합니다.',
      care: '전력 테스트입니다. 가슴 통증·어지럼·숨이 비정상적으로 차면 즉시 멈추세요.',
    },
  },
  {
    id: 'bike_astrand', machines: ['bike'], label: 'Åstrand 6분 테스트', short: '6분',
    target: { durationSec: 360 }, maximal: false, estimate: 'astrand',
    guide: '심박이 125~170 사이에 머무는 일정한 와트로 6분. 와트 숫자를 비슷하게 유지하세요.',
    caution: '',
    info: {
      what: '힘들지 않은 일정한 강도로 6분 탈 때 심박이 얼마나 오르는지 보고 최대 능력을 추정합니다. 같은 강도에서 심박이 덜 오를수록 체력이 좋은 것입니다.',
      how: ['와트를 정합니다(대략 여성 50~100W, 남성 75~150W).', '6분 동안 와트와 페달 속도를 일정하게 유지합니다.', '2분쯤 심박이 125보다 낮으면 조금 세게, 170보다 높으면 조금 약하게 조절합니다.', '6분이 되면 자동으로 끝나고 1분 회복 심박을 잽니다.'],
      read: '같은 와트에서 5~6분 심박이 낮아지면 좋아진 것입니다. 5분·6분 심박 차이가 5 이하여야 계산됩니다.',
      care: '심박을 낮추는 약(베타차단제 등)이나 카페인은 결과를 바꿉니다. 메모에 남겨 주세요.',
    },
  },
  {
    id: 'ski_1000', machines: ['ski'], label: '1000m 기록 테스트', short: '1000m',
    target: { distanceM: 1000 }, maximal: true, estimate: null,
    guide: '최대한 빠르게 1000m. 기록·평균 와트·심박을 남겨 회차별로 비교합니다.',
    caution: '전력 테스트입니다.',
    info: {
      what: '팔·몸통 위주의 지구력을 1000m 기록으로 봅니다. 스키에르고미터는 공인된 VO2max 계산식이 없어 기록과 와트로 비교합니다.',
      how: ['2~3분 가볍게 당기며 몸을 풉니다.', '시작을 누르고 최대한 빠르게 1000m를 당깁니다.', '1000m가 되면 자동으로 끝나고 1분 회복 심박을 잽니다.'],
      read: '시간이 줄고 평균 와트가 오르면 좋아진 것입니다. 1분 회복 심박이 커지면 회복이 빨라진 것입니다.',
      care: '전력 테스트입니다. 허리를 과하게 숙이지 않게 봐 주세요.',
    },
  },
  {
    id: 'step', machines: ['rower', 'bike', 'ski'], label: '단계 테스트(최대하)', short: '단계',
    target: { stageSec: STEP_STAGE_SEC }, maximal: false, estimate: 'hrPower',
    guide: `3분마다 목표 와트를 올립니다. 최대심박의 ${STEP_STOP_PCT}%에 닿으면 자동 종료. 재활·고령 회원에게 권장.`,
    caution: '',
    info: {
      what: '3분마다 조금씩 세게 하며 와트별 심박을 잽니다. 그 점들을 직선으로 이어 최대심박일 때의 파워를 추정합니다. 끝까지 전력을 다하지 않아 안전합니다.',
      how: ['화면의 목표 와트에 맞춰 운동합니다.', '3분마다 자동으로 다음 단계로 넘어가고 목표 와트가 올라갑니다.', '최대심박의 85%에 닿으면 자동으로 끝나고 1분 회복 심박을 잽니다.'],
      read: '추정 최대 파워가 오르면 좋아진 것입니다. 같은 장비로 반복할수록 점이 쌓여 신뢰 등급이 C→B→A로 올라갑니다. 에어바이크는 VO2max도 함께 계산합니다.',
      care: '재활·고령 회원에게 권장하는 방식입니다. 단계마다 와트를 목표에 최대한 맞춰야 정확합니다.',
    },
  },
  {
    id: 'free', machines: ['rower', 'bike', 'ski', 'treadmill', 'climber'], label: '자유 기록', short: '자유',
    target: {}, maximal: false, estimate: null,
    guide: '정해진 방식 없이 운동 내용을 그대로 기록합니다.',
    caution: '',
    info: {
      what: '정해진 테스트 없이 운동(인터벌 수업 등)을 그대로 기록합니다.',
      how: ['시작을 누르고 평소처럼 운동합니다.', '끝나면 "운동 끝"을 눌러 1분 회복 심박을 잽니다.'],
      read: '심박·와트 그래프와 1분 회복 심박으로 그날 컨디션과 변화를 비교합니다. VO2max는 계산하지 않습니다.',
      care: '',
    },
  },
];

// 결과 화면 '용어 설명'
export const CARDIO_GLOSSARY = [
  ['VO2max', '1분에 몸 1kg이 쓸 수 있는 최대 산소량(mL/kg/min). 클수록 심폐지구력이 좋습니다. 여기 값은 호흡가스 검사가 아닌 참고 추정치입니다.'],
  ['1분 회복 심박', '운동이 끝난 직후 심박에서 1분 뒤 심박을 뺀 값. 클수록 회복이 빠릅니다.'],
  ['최대심박', '처음엔 220-나이로 계산하고, 실제로 그보다 높게 찍힌 기록이 생기면 그 값으로 바뀝니다.'],
  ['신뢰 등급', 'A: 3회차 이상·점 6개 이상이 직선에 잘 맞음 / B: 점 3개 이상이 잘 맞음 / C: 기록이 적거나 공식이 장비와 다름(참고만).'],
  ['보정', '다른 곳에서 잰 실측 VO2max를 넣어 두면, 그 회원의 다음 추정값을 실측/추정 비율로 맞춥니다.'],
];

export function protocolsForMachine(machineId) {
  return CARDIO_PROTOCOLS.filter((p) => p.machines.includes(machineId));
}
export function getProtocol(id) {
  return CARDIO_PROTOCOLS.find((p) => p.id === id) || null;
}

export function normalizeSex(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (s.startsWith('f') || s.includes('여') || s === 'w' || s.includes('woman')) return 'female';
  if (s.startsWith('m') || s.includes('남')) return 'male';
  return null;
}

// ── 1초 단위 기록 ────────────────────────────────────────────────────────
// 화면이 1초마다 tick({ hr, powerW, cadence, distanceM }) 을 넣는다.
// 거리는 장비 누적값 → 시작 시점 값을 빼서 이번 테스트 거리로 바꾼다.
export function createRecorder() {
  return { t: [], hr: [], w: [], cad: [], dist: [], startDist: null };
}

const num = (v) => (Number.isFinite(v) ? v : null);

export function recordTick(rec, sec, { hr = null, powerW = null, cadence = null, distanceM = null } = {}) {
  if (!rec || rec.t.length >= CARDIO_SERIES_MAX_SEC) return rec;
  let d = num(distanceM);
  if (d != null) {
    if (rec.startDist == null || d < rec.startDist) rec.startDist = d; // 장비가 거리를 0으로 되돌린 경우 다시 기준
    d = d - rec.startDist;
  }
  rec.t.push(Math.round(sec));
  rec.hr.push(num(hr) != null && hr >= 30 && hr <= 240 ? Math.round(hr) : null);
  rec.w.push(num(powerW) != null && powerW >= 0 && powerW <= 3000 ? Math.round(powerW) : null);
  rec.cad.push(num(cadence) != null && cadence >= 0 && cadence <= 250 ? Math.round(cadence) : null);
  rec.dist.push(d != null ? Math.round(d) : null);
  return rec;
}

function vals(arr, from = 0, to = arr.length) {
  return arr.slice(from, to).filter((v) => v != null);
}
function mean(arr) {
  const v = arr.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const r0 = (v) => (v == null ? null : Math.round(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// 5초 구간 중앙값의 최대 — 순간 튀는 값(접촉 불량)이 최대심박으로 잡히지 않게.
function median(v) {
  const s = [...v].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export function smoothedMax(arr, win = 5) {
  let best = null;
  for (let i = 0; i + win <= arr.length; i += 1) {
    const w = vals(arr, i, i + win);
    if (w.length < Math.ceil(win * 0.6)) continue;
    const m = median(w);
    if (best == null || m > best) best = m;
  }
  return r0(best);
}

export function lastDistance(rec) {
  for (let i = rec.dist.length - 1; i >= 0; i -= 1) if (rec.dist[i] != null) return rec.dist[i];
  return null;
}

// 구간 [from, to) 초의 평균
export function windowAvg(rec, key, fromSec, toSec) {
  const out = [];
  for (let i = 0; i < rec.t.length; i += 1) {
    if (rec.t[i] >= fromSec && rec.t[i] < toSec && rec[key][i] != null) out.push(rec[key][i]);
  }
  return mean(out);
}

// 운동 구간 요약 (회복 구간은 제외: workEndSec 이전만)
export function summarizeWork(rec, workEndSec) {
  const end = rec.t.findIndex((s) => s >= workEndSec);
  const idx = end === -1 ? rec.t.length : end;
  const sub = { hr: rec.hr.slice(0, idx), w: rec.w.slice(0, idx), cad: rec.cad.slice(0, idx), dist: rec.dist.slice(0, idx) };
  const durationSec = Math.round(workEndSec);
  let distanceM = null;
  for (let i = sub.dist.length - 1; i >= 0; i -= 1) if (sub.dist[i] != null) { distanceM = sub.dist[i]; break; }
  const hrN = vals(sub.hr).length;
  return {
    durationSec,
    distanceM,
    avgPowerW: r0(mean(sub.w)),
    maxPowerW: sub.w.some((v) => v != null) ? Math.max(...vals(sub.w)) : null,
    avgCadence: r0(mean(sub.cad)),
    avgHr: r0(mean(sub.hr)),
    peakHr: smoothedMax(sub.hr),
    paceSec500: distanceM ? r1(durationSec / (distanceM / 500)) : null,
    hrCoveragePct: idx ? Math.round((hrN / idx) * 100) : 0,
    powerCoveragePct: idx ? Math.round((vals(sub.w).length / idx) * 100) : 0,
  };
}

// 회복 심박: 운동 끝(마지막 10초 평균) − 60초 뒤(55~65초 평균)
export function summarizeRecovery(rec, workEndSec) {
  const endHr = windowAvg(rec, 'hr', workEndSec - 10, workEndSec + 1);
  const hr60 = windowAvg(rec, 'hr', workEndSec + 55, workEndSec + 66);
  return {
    endHr: r0(endHr),
    hr60: r0(hr60),
    drop60: endHr != null && hr60 != null ? r0(endHr - hr60) : null,
  };
}

// 단계 테스트: 각 단계 마지막 60초 평균(심박이 안정된 구간)
export function summarizeStages(rec, workEndSec, stageSec = STEP_STAGE_SEC) {
  const stages = [];
  for (let s = 0; s * stageSec < workEndSec; s += 1) {
    const from = s * stageSec;
    const to = Math.min((s + 1) * stageSec, workEndSec);
    const complete = to - from >= stageSec * 0.9;
    const avgW = windowAvg(rec, 'w', Math.max(from, to - 60), to);
    const avgHr = windowAvg(rec, 'hr', Math.max(from, to - 60), to);
    stages.push({ stage: s + 1, fromSec: from, toSec: Math.round(to), complete, avgPowerW: r0(avgW), avgHr: r0(avgHr) });
  }
  return stages;
}

// ── 추정 공식 ──────────────────────────────────────────────────────────
// 로잉 2000m → Hagerman(Concept2 계산기 근거): VO2(mL/min) = 14.72 × W + 250.39
//  W 는 2000m 기록(시간)에서 Concept2 파워 공식 W = 2.8 / (초/미터)^3 으로 구한다.
export function wattsFromPace(timeSec, distanceM) {
  if (!timeSec || !distanceM) return null;
  const secPerM = timeSec / distanceM;
  return 2.8 / (secPerM ** 3);
}
export function hagermanVo2max({ timeSec, distanceM, weightKg }) {
  const w = wattsFromPace(timeSec, distanceM);
  if (!w || !weightKg) return null;
  return r1((14.72 * w + 250.39) / weightKg);
}

// Åstrand(1954/1960) 나이 보정 계수. 사이 나이는 직선 보간.
const ASTRAND_AGE = [[15, 1.1], [25, 1.0], [35, 0.87], [40, 0.83], [45, 0.78], [50, 0.75], [55, 0.71], [60, 0.68], [65, 0.65]];
export function astrandAgeFactor(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return 1;
  if (a <= ASTRAND_AGE[0][0]) return ASTRAND_AGE[0][1];
  for (let i = 1; i < ASTRAND_AGE.length; i += 1) {
    const [x1, y1] = ASTRAND_AGE[i];
    const [x0, y0] = ASTRAND_AGE[i - 1];
    if (a <= x1) return y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
  }
  return ASTRAND_AGE[ASTRAND_AGE.length - 1][1];
}
// workload: 와트 × 6.12 = kg·m/min. 결과 L/min → 나이 보정 → mL/kg/min
export function astrandVo2max({ sex, watts, hrSs, age, weightKg }) {
  if (!watts || !hrSs || !weightKg || !sex) return null;
  const load = watts * 6.12;
  const lpm = sex === 'female'
    ? ((0.00193 * load + 0.326) / (0.769 * hrSs - 56.1)) * 100
    : ((0.00212 * load + 0.299) / (0.769 * hrSs - 48.5)) * 100;
  if (!Number.isFinite(lpm) || lpm <= 0) return null;
  return r1((lpm * astrandAgeFactor(age) * 1000) / weightKg);
}

// 최소제곱 직선 y = a + b·x 와 결정계수 r²
export function linearFit(points) {
  const p = points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  const n = p.length;
  if (n < 2) return null;
  const mx = p.reduce((s, q) => s + q.x, 0) / n;
  const my = p.reduce((s, q) => s + q.y, 0) / n;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (const q of p) { sxx += (q.x - mx) ** 2; sxy += (q.x - mx) * (q.y - my); syy += (q.y - my) ** 2; }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2, n };
}

// 신뢰 등급: 점 개수·직선 적합도·모은 회차 수
export function confidenceGrade({ n = 0, r2 = 0, sessions = 1 } = {}) {
  if (n >= 6 && r2 >= 0.9 && sessions >= 3) return 'A';
  if (n >= 3 && r2 >= 0.85) return 'B';
  return 'C';
}

// ── 누적 데이터 ────────────────────────────────────────────────────────
// 이 회원의 과거 15번 기록(ai 세션) 중 같은 장비 기록만 고른다.
export function pastCardioRecords(sessions = [], machineId, { now = Date.now(), days = POOL_DAYS } = {}) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((s) => s?.data)
    .filter((d) => d && d.kind === CARDIO_RECORD_KIND && d.machineId === machineId)
    .filter((d) => {
      const at = Date.parse(d.startedAt || '');
      return !Number.isFinite(at) || now - at <= days * 86400000;
    });
}

// 개인 최대심박: 220-나이 와 실제 기록된 최고 심박(전력 테스트 포함 전체) 중 큰 값.
export function personalMaxHr({ age, sessions = [], currentPeak = null }) {
  const byAge = maxHeartRateFromAge(age);
  let observed = Number.isFinite(currentPeak) ? currentPeak : null;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const d = s?.data;
    if (d?.kind === CARDIO_RECORD_KIND && Number.isFinite(d?.result?.peakHr)) {
      observed = observed == null ? d.result.peakHr : Math.max(observed, d.result.peakHr);
    }
  }
  if (observed != null && byAge != null && observed > byAge) return { value: observed, source: 'observed' };
  if (byAge != null) return { value: byAge, source: 'age' };
  if (observed != null) return { value: observed, source: 'observed' };
  return { value: null, source: 'none' };
}

// 기준값 보정 계수: 과거 기록 중 (참고 추정, 트레이너가 넣은 실측) 쌍의 비율 중앙값.
export function calibrationFactor(past = [], method) {
  const ratios = past
    .filter((d) => d?.estimates?.vo2max?.method === method && Number.isFinite(d?.referenceVo2max) && Number.isFinite(d?.estimates?.vo2max?.value) && d.estimates.vo2max.value > 0)
    .map((d) => d.referenceVo2max / d.estimates.vo2max.value)
    .filter((x) => x > 0.5 && x < 1.5)
    .sort((a, b) => a - b);
  if (!ratios.length) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { factor: Math.round(median * 1000) / 1000, pairs: ratios.length };
}

// ── 전체 계산 ──────────────────────────────────────────────────────────
// rec: 1초 기록, workEndSec: 운동 끝(회복 시작) 초, subject: { age, sex, weightKg }
// past: pastCardioRecords() 결과, allSessions: 최대심박 계산용 전체 세션
// manual: 장비 미연결 시 트레이너 수기 입력 { timeSec, distanceM, avgPowerW }
export function computeCardioResult({ protocolId, machineId, rec, workEndSec, subject = {}, past = [], allSessions = [], manual = null, stageSec = STEP_STAGE_SEC }) {
  const protocol = getProtocol(protocolId);
  const result = summarizeWork(rec, workEndSec);
  if (manual) {
    if (Number.isFinite(manual.timeSec) && manual.timeSec > 0) { result.durationSec = Math.round(manual.timeSec); result.manualTime = true; }
    if (Number.isFinite(manual.distanceM) && manual.distanceM > 0) { result.distanceM = Math.round(manual.distanceM); result.manualDistance = true; }
    if (Number.isFinite(manual.avgPowerW) && manual.avgPowerW > 0) { result.avgPowerW = Math.round(manual.avgPowerW); result.manualPower = true; }
    if (result.distanceM && result.durationSec) result.paceSec500 = r1(result.durationSec / (result.distanceM / 500));
  }
  const recovery = summarizeRecovery(rec, workEndSec);
  const hrMax = personalMaxHr({ age: subject.age, sessions: allSessions, currentPeak: result.peakHr });
  const sex = normalizeSex(subject.sex);
  const weightKg = Number(subject.weightKg) || null;
  const estimates = { vo2max: null, maxPower: null };
  let stages = null;
  const notes = [];

  if (protocol?.estimate === 'hagerman') {
    const done = result.distanceM != null && result.distanceM >= (protocol.target.distanceM || 2000) * 0.98;
    const value = done ? hagermanVo2max({ timeSec: result.durationSec, distanceM: result.distanceM, weightKg }) : null;
    estimates.vo2max = {
      value, method: 'hagerman', unit: 'mL/kg/min', grade: value ? 'C' : null, valid: Boolean(value),
      reason: !done ? '2000m를 끝까지 하지 않아 계산하지 않았습니다.' : !weightKg ? '체중이 없어 계산하지 않았습니다.' : 'Concept2 기준 공식이라 다른 장비에서는 참고용입니다.',
    };
  }

  if (protocol?.estimate === 'astrand') {
    const hr5 = windowAvg(rec, 'hr', 240, 300);
    const hr6 = windowAvg(rec, 'hr', 300, 360);
    const watts = result.manualPower ? result.avgPowerW : windowAvg(rec, 'w', 240, 360);
    const hrSs = hr5 != null && hr6 != null ? (hr5 + hr6) / 2 : null;
    const steady = hr5 != null && hr6 != null && Math.abs(hr6 - hr5) <= 5;
    const inRange = hrSs != null && hrSs >= 125 && hrSs <= 170;
    const longEnough = workEndSec >= 350;
    const value = steady && inRange && longEnough ? astrandVo2max({ sex, watts, hrSs, age: subject.age, weightKg }) : null;
    estimates.vo2max = {
      value, method: 'astrand', unit: 'mL/kg/min', grade: value ? 'C' : null, valid: Boolean(value),
      hrSs: r0(hrSs), watts: r0(watts),
      reason: !longEnough ? '6분을 채우지 않아 계산하지 않았습니다.'
        : hrSs == null ? '5~6분 심박이 기록되지 않았습니다.'
          : !inRange ? `안정 심박 ${r0(hrSs)}이 125~170 밖이라 공식 적용이 안 됩니다. 와트를 조절해 다시 하세요.`
            : !steady ? '5분·6분 심박 차이가 5보다 커서 안정 상태가 아닙니다. 1분 더 하거나 다시 하세요.'
              : !sex || !weightKg ? '성별·체중이 없어 계산하지 않았습니다.'
                : '에어바이크 와트의 정밀도가 확인되지 않아 참고용입니다.',
    };
  }

  if (protocol?.estimate === 'hrPower') {
    stages = summarizeStages(rec, workEndSec, stageSec);
    const nowPts = stages.filter((s) => s.complete && s.avgPowerW > 0 && s.avgHr >= 90).map((s) => ({ x: s.avgPowerW, y: s.avgHr }));
    const pastPts = [];
    let pastSessions = 0;
    for (const d of past) {
      if (d.protocolId !== 'step' || !Array.isArray(d.stages)) continue;
      const pts = d.stages.filter((s) => s.complete && s.avgPowerW > 0 && s.avgHr >= 90).map((s) => ({ x: s.avgPowerW, y: s.avgHr }));
      if (pts.length) { pastPts.push(...pts); pastSessions += 1; }
    }
    // 이번 점만 / 과거 포함 — 둘 다 계산해 더 믿을 만한 쪽을 쓴다.
    const fitNow = linearFit(nowPts);
    const fitAll = pastPts.length ? linearFit([...nowPts, ...pastPts]) : null;
    const useAll = fitAll && fitAll.b > 0 && fitAll.r2 >= (fitNow?.r2 ?? 0) - 0.05;
    const fit = useAll ? fitAll : fitNow;
    const sessionsUsed = useAll ? pastSessions + 1 : 1;
    let wMax = null;
    if (fit && fit.b > 0 && hrMax.value) wMax = (hrMax.value - fit.a) / fit.b;
    if (wMax != null && (wMax <= 0 || wMax > 1500)) wMax = null;
    const grade = fit ? confidenceGrade({ n: fit.n, r2: fit.r2, sessions: sessionsUsed }) : null;
    estimates.maxPower = {
      value: r0(wMax), unit: 'W', method: 'hrPowerExtrapolation', grade, points: fit?.n || 0, r2: fit ? Math.round(fit.r2 * 1000) / 1000 : null,
      sessionsUsed, hrMaxUsed: hrMax.value,
      reason: !fit ? '완료한 단계가 2개 이상 있어야 계산합니다.' : fit.b <= 0 ? '와트가 올라도 심박이 오르지 않아 계산하지 않았습니다.' : `심박-와트 직선을 최대심박 ${hrMax.value}까지 연장한 값입니다.`,
    };
    if (machineId === 'bike' && wMax && weightKg) {
      // ACSM 다리 사이클 식: VO2 = 10.8 × W / kg + 7 (에어바이크는 팔 동작이 섞여 참고용)
      const value = r1((10.8 * wMax) / weightKg + 7);
      estimates.vo2max = { value, method: 'acsmCycle', unit: 'mL/kg/min', grade, valid: true, reason: '단계 테스트 심박-와트 연장 + ACSM 사이클 식. 에어바이크라 참고용입니다.' };
    }
    if (!stages.some((s) => s.complete)) notes.push('완료한 단계가 없습니다.');
  }

  // 기준값 보정(트레이너가 넣은 실측 VO2max 가 과거에 있으면)
  if (estimates.vo2max?.value) {
    const cal = calibrationFactor(past, estimates.vo2max.method);
    if (cal) {
      estimates.vo2max.calibratedValue = r1(estimates.vo2max.value * cal.factor);
      estimates.vo2max.calibration = cal;
    }
  }

  return {
    result,
    recovery,
    stages,
    estimates,
    hrMax,
    subject: { age: Number(subject.age) || null, sex, weightKg },
    notes,
  };
}

// 저장 페이로드. 필드 이름은 다른 측정 유형 판정(unifiedReport.inferReportType)에 걸리지 않게
// 고른다(summary·analysis·mode·type·heightCm·rsi·diagnosis 사용 금지).
export function buildCardioRecord({ protocolId, machineId, machine = null, startedAt, endedAt, rec, computed, hrSource = 'none', manual = null, trainerNote = '', confirmedVo2max = null, referenceVo2max = null, stepPlan = null }) {
  const protocol = getProtocol(protocolId);
  return {
    kind: CARDIO_RECORD_KIND,
    version: 1,
    protocolId,
    protocolLabel: protocol?.label || '',
    machineId,
    machineLabel: CARDIO_MACHINES[machineId]?.label || machineId,
    machine: machine ? { name: String(machine.name || '').slice(0, 40), protocol: machine.protocol || null, reportedKind: machine.machineKind || null, services: (machine.services || []).slice(0, 12), characteristics: (machine.characteristics || []).slice(0, 6), detectedKind: machine.detectedKind || null } : null,
    startedAt: startedAt || null,
    endedAt: endedAt || null,
    hrSource,
    subject: computed.subject,
    hrMax: computed.hrMax,
    result: computed.result,
    recovery: computed.recovery,
    stages: computed.stages,
    stepPlan: stepPlan || null,
    estimates: computed.estimates,
    notes: computed.notes,
    manual: manual || null,
    trainerNote: String(trainerNote || '').slice(0, 300),
    confirmedVo2max: Number.isFinite(confirmedVo2max) ? confirmedVo2max : null,
    referenceVo2max: Number.isFinite(referenceVo2max) ? referenceVo2max : null,
    series: { stepSec: 1, t: rec.t, hr: rec.hr, w: rec.w, cad: rec.cad, dist: rec.dist },
  };
}

export function formatPace(sec500) {
  if (!Number.isFinite(sec500) || sec500 <= 0) return '-';
  const m = Math.floor(sec500 / 60);
  const s = Math.round(sec500 % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 측정 이력 카드 요약 칩(값만, 판정 없음)
export function cardioHistoryMetrics(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = [];
  const vo2 = p.estimates?.vo2max;
  const shownVo2 = Number.isFinite(p.confirmedVo2max) ? p.confirmedVo2max : (vo2?.calibratedValue ?? vo2?.value);
  if (Number.isFinite(shownVo2)) out.push({ key: 'vo2max', label: Number.isFinite(p.confirmedVo2max) ? 'VO2max(확인)' : 'VO2max(참고)', displayValue: String(shownVo2), unit: 'mL/kg/min', value: shownVo2 });
  if (Number.isFinite(p.estimates?.maxPower?.value)) out.push({ key: 'maxPower', label: '추정 최대파워', displayValue: String(p.estimates.maxPower.value), unit: 'W', value: p.estimates.maxPower.value });
  if (Number.isFinite(p.result?.distanceM) && p.result.distanceM > 0) out.push({ key: 'distanceM', label: '거리', displayValue: String(p.result.distanceM), unit: 'm', value: p.result.distanceM });
  if (Number.isFinite(p.result?.durationSec)) out.push({ key: 'durationSec', label: '시간', displayValue: formatClock(p.result.durationSec), unit: '', value: p.result.durationSec });
  if (Number.isFinite(p.result?.avgPowerW)) out.push({ key: 'avgPowerW', label: '평균 와트', displayValue: String(p.result.avgPowerW), unit: 'W', value: p.result.avgPowerW });
  if (Number.isFinite(p.recovery?.drop60)) out.push({ key: 'drop60', label: '1분 회복', displayValue: String(p.recovery.drop60), unit: 'bpm', value: p.recovery.drop60 });
  return out;
}
