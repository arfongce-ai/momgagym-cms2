// ai-measure/core/heartRateBle.js
// ════════════════════════════════════════════════════════════════════════
//  [심박 밴드 2026-11-11] 블루투스 표준 심박 신호(Heart Rate 0x180D)를 내보내는
//  밴드(HW702A 손목 밴드, 가슴 밴드 등)를 크롬 Web Bluetooth로 직접 읽는다.
//  · 전용 프로그램·서버·유료 API 없음 (비용 0원).
//  · 화면 표시 전용 — 심박 값은 어디에도 저장하지 않는다.
//  · 안드로이드 크롬 / 윈도우 크롬에서 동작. 아이폰·아이패드는 미지원.
//  순수 함수(parse/zone/label)는 테스트에서 직접 실행해 검증한다.
// ════════════════════════════════════════════════════════════════════════

export const HEART_RATE_SERVICE = 0x180d;
export const HEART_RATE_MEASUREMENT = 0x2a37;
export const BATTERY_SERVICE = 0x180f;
export const BATTERY_LEVEL = 0x2a19;

// 한 기기에서 동시에 연결하는 밴드 수 상한. 블루투스 어댑터 한계(보통 5~7개)
// 안쪽으로 잡는다 — 센터 그룹 수업 최대 인원(5명)에 맞춘 값.
export const MAX_HEART_RATE_BANDS = 5;

export function isHeartRateBleSupported(nav = typeof navigator !== 'undefined' ? navigator : null) {
  return Boolean(nav && nav.bluetooth && typeof nav.bluetooth.requestDevice === 'function');
}

// Heart Rate Measurement(0x2A37) 값 해석.
//   byte0 = flags. bit0: 0이면 심박이 1바이트, 1이면 2바이트(little-endian).
//   bit1~2: 센서 접촉 상태(지원하는 밴드만). 0b11=접촉됨, 0b10=접촉 안 됨.
export function parseHeartRateMeasurement(view) {
  if (!view || view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  const is16 = (flags & 0x01) === 1;
  if (is16 && view.byteLength < 3) return null;
  const bpm = is16 ? view.getUint16(1, true) : view.getUint8(1);
  const contactBits = (flags >> 1) & 0x03;
  const contact = contactBits === 3 ? true : contactBits === 2 ? false : null; // null = 밴드가 접촉 감지를 지원 안 함
  return { bpm, contact };
}

// 나이 → 추정 최대심박(220 - 나이). 나이가 없거나 이상하면 null.
export function maxHeartRateFromAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n) || n < 5 || n > 100) return null;
  return 220 - Math.round(n);
}

// [회원 연계 준비] 생년월일(YYYY-MM-DD) → 만 나이. 측정 허브에서 회원을 골라 두면
// 나이를 직접 넣지 않아도 강도 색이 나온다. 값이 없거나 이상하면 null.
export function ageFromBirthDate(birthDate, today = new Date()) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(birthDate || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age >= 5 && age <= 100 ? age : null;
}

// 최대심박 대비 % → 구간(1~5). 최대심박을 모르면 null(색 없이 숫자만 표시).
export function heartRateZone(bpm, maxHr) {
  if (!bpm || !maxHr) return null;
  const pct = Math.round((bpm / maxHr) * 100);
  const zone = pct >= 90 ? 5 : pct >= 80 ? 4 : pct >= 70 ? 3 : pct >= 60 ? 2 : 1;
  return { zone, pct };
}

export const HEART_RATE_ZONE_LABELS = {
  1: '아주 가볍게',
  2: '가볍게',
  3: '보통',
  4: '힘들게',
  5: '최대',
};

// 밴드 이름 "HW702A-1015188" → 뒷면에 새겨진 ID 끝 4자리 "5188".
// 여러 밴드 중 어느 것인지 고를 때 뒷면 ID와 맞춰 보라고 보여준다.
export function shortBandId(name) {
  const digits = String(name || '').replace(/\D+/g, '');
  return digits ? digits.slice(-4) : '';
}

// ── [심박 기록 2026-11-11] 기록 요약 ─────────────────────────────────────
// 화면에서 "기록 시작 ~ 종료" 사이에 받은 값(samples: [{ t: 시작 후 ms, bpm }])을
// 저장용 요약으로 줄인다. 초 단위 원본은 저장하지 않고(문서 크기·읽기 비용),
// 평균·최고·최저·구간별 시간 + 굵게 줄인 그래프용 값만 남긴다.
export const HEART_RATE_RECORD_KIND = 'heart_rate';
export const HEART_RATE_MIN_RECORD_SEC = 10;   // 이보다 짧으면 저장 가치가 없어 저장 버튼을 막는다
const SERIES_MAX_POINTS = 360;                 // 그래프용 값 최대 개수(5초 간격이면 30분)
const SERIES_BASE_STEP_SEC = 5;

export function summarizeHeartRateSamples(samples = [], { durationMs = null, maxHr = null } = {}) {
  const valid = (Array.isArray(samples) ? samples : [])
    .filter((s) => s && Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.bpm) && s.bpm >= 30 && s.bpm <= 240)
    .sort((a, b) => a.t - b.t);
  if (!valid.length) return null;

  const lastT = valid[valid.length - 1].t;
  const totalMs = Math.max(Number.isFinite(durationMs) ? durationMs : 0, lastT);
  const durationSec = Math.round(totalMs / 1000);

  let sum = 0;
  let maxBpm = 0;
  let minBpm = Infinity;
  for (const s of valid) {
    sum += s.bpm;
    if (s.bpm > maxBpm) maxBpm = s.bpm;
    if (s.bpm < minBpm) minBpm = s.bpm;
  }

  // 구간별 머문 시간(초): 한 값이 다음 값이 올 때까지 유지됐다고 본다.
  // 신호가 끊긴 긴 공백(5초 초과)은 5초까지만 인정해 부풀리지 않는다.
  let zoneSec = null;
  if (maxHr) {
    zoneSec = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    for (let i = 0; i < valid.length; i += 1) {
      const next = i + 1 < valid.length ? valid[i + 1].t : totalMs;
      const held = Math.min(Math.max(next - valid[i].t, 0), 5000) / 1000;
      const zone = heartRateZone(valid[i].bpm, maxHr);
      if (zone) zoneSec[`z${zone.zone}`] += held;
    }
    for (const k of Object.keys(zoneSec)) zoneSec[k] = Math.round(zoneSec[k]);
  }

  // 그래프용 값: stepSec 간격으로 묶어 평균. 길어지면 간격을 넓혀 개수를 제한한다.
  let stepSec = SERIES_BASE_STEP_SEC;
  while (Math.ceil((totalMs / 1000 + 1) / stepSec) > SERIES_MAX_POINTS) stepSec *= 2;
  const buckets = new Map();
  for (const s of valid) {
    const idx = Math.floor(s.t / 1000 / stepSec);
    const b = buckets.get(idx) || { sum: 0, n: 0 };
    b.sum += s.bpm; b.n += 1;
    buckets.set(idx, b);
  }
  const bucketCount = Math.max(...buckets.keys()) + 1;
  const bpmSeries = [];
  for (let i = 0; i < bucketCount; i += 1) {
    const b = buckets.get(i);
    bpmSeries.push(b ? Math.round(b.sum / b.n) : 0); // 0 = 그 구간에 신호 없음
  }

  return {
    durationSec,
    avgBpm: Math.round(sum / valid.length),
    maxBpm,
    minBpm,
    sampleCount: valid.length,
    maxHrEstimate: maxHr || null,
    avgPctOfMax: maxHr ? Math.round((sum / valid.length / maxHr) * 100) : null,
    zoneSec,
    seriesStepSec: stepSec,
    bpmSeries,
  };
}

// 저장 페이로드. 측정 허브의 기존 저장 경로(onSave → ai 세션)를 그대로 탄다.
// 필드 이름은 다른 측정 유형 판정(unifiedReport.inferReportType)에 걸리지 않게 고른다
// (heightCm·mode·type·summary·analysis 등 사용 금지).
export function buildHeartRateRecord({ summary, startedAt, endedAt, bandLabel = '', timerTab = '' } = {}) {
  if (!summary) return null;
  return {
    kind: HEART_RATE_RECORD_KIND,
    startedAt: startedAt || null,
    endedAt: endedAt || null,
    bandLabel: String(bandLabel || '').slice(0, 12),
    timerTab: String(timerTab || ''),
    ...summary,
  };
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
}

// 측정 이력 카드에 보여줄 요약 칩. 정상/주의 판정은 하지 않는다(값만 표시).
export function heartRateHistoryMetrics(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = [];
  if (Number.isFinite(p.avgBpm)) out.push({ key: 'avgBpm', label: '평균', displayValue: String(p.avgBpm), unit: 'bpm', value: p.avgBpm });
  if (Number.isFinite(p.maxBpm)) out.push({ key: 'maxBpm', label: '최고', displayValue: String(p.maxBpm), unit: 'bpm', value: p.maxBpm });
  if (Number.isFinite(p.durationSec)) out.push({ key: 'durationSec', label: '시간', displayValue: formatDuration(p.durationSec), unit: '', value: p.durationSec });
  if (Number.isFinite(p.avgPctOfMax)) out.push({ key: 'avgPctOfMax', label: '평균 강도', displayValue: String(p.avgPctOfMax), unit: '%', value: p.avgPctOfMax });
  return out;
}

// 밴드별 표시 이름(번호 스티커 등)·나이를 이 기기에만 기억한다(localStorage).
// 회원 실명 대신 밴드 번호를 쓰도록 화면에서 안내한다. 심박 값은 저장하지 않는다.
const PROFILE_KEY = 'momgagym.heartRateBandProfiles.v1';

export function loadBandProfiles(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const raw = storage?.getItem(PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveBandProfile(bandName, profile, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!bandName) return;
  try {
    const all = loadBandProfiles(storage);
    all[bandName] = { label: String(profile?.label || '').slice(0, 12), age: profile?.age ? Number(profile.age) : null };
    storage?.setItem(PROFILE_KEY, JSON.stringify(all));
  } catch {
    // 저장 실패(시크릿 모드 등)는 무시 — 이번 화면에서만 유지된다.
  }
}

// [2026-11-11 보완] 블루투스 연결은 기기 한도·거리 문제로 응답 없이 멈출 수 있다.
// 정해진 시간 안에 안 끝나면 'timeout' 오류로 끊어, 화면이 "찾는 중…"에 갇히지 않게 한다.
export const HEART_RATE_CONNECT_TIMEOUT_MS = 12000;

export function withTimeout(promise, ms, label = 'timeout') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 밴드 1개 연결. 반드시 버튼 클릭(사용자 동작) 안에서 호출해야 크롬이 기기 선택 창을 띄운다.
//   onValue({ bpm, contact })  : 심박이 올 때마다(약 1초 간격)
//   onStatus('connected' | 'reconnecting' | 'disconnected')
//   excludeIds : 이미 연결된 밴드 id — 같은 밴드를 두 번 고르는 것을 막는다.
// 반환: { id, name, battery, disconnect() }
export async function connectHeartRateBand({ onValue, onStatus, excludeIds = [] } = {}) {
  if (!isHeartRateBleSupported()) throw new Error('unsupported');

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [HEART_RATE_SERVICE] }],
    optionalServices: [BATTERY_SERVICE],
  });
  if (excludeIds.includes(device.id)) throw new Error('duplicate');

  let closed = false;
  let characteristic = null;

  const handleValue = (event) => {
    const parsed = parseHeartRateMeasurement(event.target.value);
    if (parsed) onValue?.(parsed);
  };

  const openSteps = async () => {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    characteristic.addEventListener('characteristicvaluechanged', handleValue);
    await characteristic.startNotifications();
    return server;
  };
  const open = () => withTimeout(openSteps(), HEART_RATE_CONNECT_TIMEOUT_MS);

  // 밴드가 잠깐 멀어지거나 헐거워져 끊기면 몇 번 다시 붙여 본다.
  const handleDisconnect = async () => {
    if (closed) return;
    onStatus?.('reconnecting');
    for (let attempt = 0; attempt < 5 && !closed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      if (closed) return;
      try {
        await open();
        onStatus?.('connected');
        return;
      } catch {
        // 다음 시도로 넘어간다.
      }
    }
    if (!closed) onStatus?.('disconnected');
  };
  device.addEventListener('gattserverdisconnected', handleDisconnect);

  let server;
  try {
    server = await open();
  } catch (err) {
    // 실패하면 반쯤 열린 연결을 꼭 놓아 준다 — 안 그러면 다음 시도도 막힌다.
    closed = true;
    device.removeEventListener('gattserverdisconnected', handleDisconnect);
    try { if (device.gatt.connected) device.gatt.disconnect(); } catch { /* 이미 끊김 */ }
    throw err;
  }

  // 배터리는 있으면 한 번만 읽는다(없거나 3초 안에 답이 없으면 조용히 건너뜀).
  let battery = null;
  try {
    battery = await withTimeout((async () => {
      const batteryService = await server.getPrimaryService(BATTERY_SERVICE);
      const level = await batteryService.getCharacteristic(BATTERY_LEVEL);
      return (await level.readValue()).getUint8(0);
    })(), 3000);
  } catch {
    battery = null;
  }

  onStatus?.('connected');

  return {
    id: device.id,
    name: device.name || '심박 밴드',
    battery,
    disconnect() {
      closed = true;
      device.removeEventListener('gattserverdisconnected', handleDisconnect);
      try { characteristic?.removeEventListener('characteristicvaluechanged', handleValue); } catch { /* 이미 끊김 */ }
      try { if (device.gatt.connected) device.gatt.disconnect(); } catch { /* 이미 끊김 */ }
    },
  };
}
