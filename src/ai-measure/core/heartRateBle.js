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

  const open = async () => {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    characteristic.addEventListener('characteristicvaluechanged', handleValue);
    await characteristic.startNotifications();
    return server;
  };

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

  const server = await open();

  // 배터리는 있으면 한 번만 읽는다(없는 밴드는 조용히 건너뜀).
  let battery = null;
  try {
    const batteryService = await server.getPrimaryService(BATTERY_SERVICE);
    const level = await batteryService.getCharacteristic(BATTERY_LEVEL);
    battery = (await level.readValue()).getUint8(0);
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
