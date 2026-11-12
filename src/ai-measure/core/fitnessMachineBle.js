// ai-measure/core/fitnessMachineBle.js
// ════════════════════════════════════════════════════════════════════════
//  [15번 심폐지구력 2026-11-12] 유산소 장비(로잉머신·에어바이크·스키에르고미터)의
//  블루투스 표준 신호를 크롬 Web Bluetooth로 직접 읽는다. (비용 0원, 서버 없음)
//   · FTMS(Fitness Machine Service 0x1826): Rower Data / Indoor Bike Data / Cross Trainer Data
//   · Cycling Power(0x1818): 파워미터형 바이크
//  표준이 아닌 장비는 "어떤 신호를 내는지" 목록(services)을 남겨, 다음 버전에서 지원을
//  추가할 수 있게 한다(점진적 확장). 해석 함수는 순수 함수라 테스트에서 직접 검증한다.
//  화면 연결 흐름은 core/heartRateBle.js 와 같은 방식(타임아웃·재연결)을 따른다.
// ════════════════════════════════════════════════════════════════════════
import { isHeartRateBleSupported, withTimeout } from './heartRateBle';

export const FTMS_SERVICE = 0x1826;
export const FTMS_ROWER_DATA = 0x2ad1;
export const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
export const FTMS_CROSS_TRAINER_DATA = 0x2ace;
export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;

// 진단용: 표준이 아닌 장비가 흔히 쓰는 서비스. 연결되면 "어떤 것이 있는지"만 기록한다.
export const DIAGNOSTIC_SERVICES = [
  FTMS_SERVICE,
  CYCLING_POWER_SERVICE,
  0x1816, // Cycling Speed and Cadence
  0x180d, // Heart Rate
  0x180a, // Device Information
  0x180f, // Battery
  0xfff0, 0xffe0, 0xfee7, // 중국산 콘솔에 흔한 자체 규격
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  'ce060000-43e5-11e4-916c-0800200c9a66', // Concept2 PM5
];

export const MACHINE_CONNECT_TIMEOUT_MS = 15000;

export function isFitnessMachineBleSupported(nav) {
  return isHeartRateBleSupported(nav);
}

// 작은 읽기 도우미 — 남은 바이트가 모자라면 null(잘린 패킷은 그 뒤를 버린다).
function reader(view) {
  let o = 0;
  const has = (n) => view && o + n <= view.byteLength;
  return {
    get offset() { return o; },
    u8() { if (!has(1)) return null; const v = view.getUint8(o); o += 1; return v; },
    u16() { if (!has(2)) return null; const v = view.getUint16(o, true); o += 2; return v; },
    s16() { if (!has(2)) return null; const v = view.getInt16(o, true); o += 2; return v; },
    u24() { if (!has(3)) return null; const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16); o += 3; return v; },
    skip(n) { o += n; },
  };
}

// FTMS Rower Data(0x2AD1). 로잉머신·일부 스키에르고미터가 쓴다.
//  flags(16bit) bit0=0 일 때 Stroke Rate(0.5 spm)+Stroke Count 가 들어 있다(반대 의미 주의).
export function parseRowerData(view) {
  if (!view || view.byteLength < 2) return null;
  const r = reader(view);
  const f = r.u16();
  const out = { machineKind: 'rower' };
  if (!(f & 0x0001)) { const sr = r.u8(); const sc = r.u16(); if (sr != null) out.cadence = sr / 2; if (sc != null) out.strokeCount = sc; }
  if (f & 0x0002) r.skip(1); // 평균 스트로크
  if (f & 0x0004) { const d = r.u24(); if (d != null) out.distanceM = d; }
  if (f & 0x0008) { const p = r.u16(); if (p != null && p > 0) out.paceSec500 = p; }
  if (f & 0x0010) r.skip(2); // 평균 페이스
  if (f & 0x0020) { const w = r.s16(); if (w != null) out.powerW = w; }
  if (f & 0x0040) r.skip(2); // 평균 파워
  if (f & 0x0080) { const lv = r.s16(); if (lv != null) out.resistance = lv; }
  if (f & 0x0100) { const e = r.u16(); r.skip(3); if (e != null && e !== 0xffff) out.energyKcal = e; }
  if (f & 0x0200) { const hr = r.u8(); if (hr) out.hrBpm = hr; }
  if (f & 0x0400) r.skip(1); // MET
  if (f & 0x0800) { const t = r.u16(); if (t != null) out.elapsedSec = t; }
  return out;
}

// FTMS Indoor Bike Data(0x2AD2). 에어바이크·스핀바이크.
export function parseIndoorBikeData(view) {
  if (!view || view.byteLength < 2) return null;
  const r = reader(view);
  const f = r.u16();
  const out = { machineKind: 'bike' };
  if (!(f & 0x0001)) { const s = r.u16(); if (s != null) out.speedKmh = s / 100; }
  if (f & 0x0002) r.skip(2); // 평균 속도
  if (f & 0x0004) { const c = r.u16(); if (c != null) out.cadence = c / 2; }
  if (f & 0x0008) r.skip(2); // 평균 케이던스
  if (f & 0x0010) { const d = r.u24(); if (d != null) out.distanceM = d; }
  if (f & 0x0020) { const lv = r.s16(); if (lv != null) out.resistance = lv; }
  if (f & 0x0040) { const w = r.s16(); if (w != null) out.powerW = w; }
  if (f & 0x0080) r.skip(2); // 평균 파워
  if (f & 0x0100) { const e = r.u16(); r.skip(3); if (e != null && e !== 0xffff) out.energyKcal = e; }
  if (f & 0x0200) { const hr = r.u8(); if (hr) out.hrBpm = hr; }
  if (f & 0x0400) r.skip(1);
  if (f & 0x0800) { const t = r.u16(); if (t != null) out.elapsedSec = t; }
  return out;
}

// FTMS Cross Trainer Data(0x2ACE). flags 가 24bit. 스키에르고미터가 이 규격을 쓰기도 한다.
export function parseCrossTrainerData(view) {
  if (!view || view.byteLength < 3) return null;
  const r = reader(view);
  const f = r.u24();
  const out = { machineKind: 'cross' };
  if (!(f & 0x0001)) { const s = r.u16(); if (s != null) out.speedKmh = s / 100; }
  if (f & 0x0002) r.skip(2);
  if (f & 0x0004) { const d = r.u24(); if (d != null) out.distanceM = d; }
  if (f & 0x0008) { const spm = r.u16(); r.skip(2); if (spm != null) out.cadence = spm; }
  if (f & 0x0010) r.skip(2);
  if (f & 0x0020) r.skip(4);
  if (f & 0x0040) r.skip(4);
  if (f & 0x0080) { const lv = r.s16(); if (lv != null) out.resistance = lv; }
  if (f & 0x0100) { const w = r.s16(); if (w != null) out.powerW = w; }
  if (f & 0x0200) r.skip(2);
  if (f & 0x0400) { const e = r.u16(); r.skip(3); if (e != null && e !== 0xffff) out.energyKcal = e; }
  if (f & 0x0800) { const hr = r.u8(); if (hr) out.hrBpm = hr; }
  if (f & 0x1000) r.skip(1);
  if (f & 0x2000) { const t = r.u16(); if (t != null) out.elapsedSec = t; }
  return out;
}

// Cycling Power Measurement(0x2A63). 케이던스는 크랭크 누적 회전수의 차이로 계산하므로
// 직전 값(prev)을 받아 { data, crank } 를 돌려준다.
export function parseCyclingPower(view, prev = null) {
  if (!view || view.byteLength < 4) return { data: null, crank: prev };
  const r = reader(view);
  const f = r.u16();
  const data = { machineKind: 'bike' };
  const w = r.s16();
  if (w != null) data.powerW = w;
  if (f & 0x0001) r.skip(1); // pedal power balance
  if (f & 0x0004) r.skip(2); // accumulated torque
  if (f & 0x0010) r.skip(6); // wheel revolution
  let crank = prev;
  if (f & 0x0020) {
    const revs = r.u16();
    const time = r.u16(); // 1/1024초
    if (revs != null && time != null) {
      if (prev) {
        const dRev = (revs - prev.revs + 0x10000) % 0x10000;
        const dT = ((time - prev.time + 0x10000) % 0x10000) / 1024;
        if (dRev > 0 && dT > 0) data.cadence = Math.round((dRev / dT) * 60);
        else if (dRev === 0) data.cadence = 0;
      }
      crank = { revs, time };
    }
  }
  return { data, crank };
}

const FTMS_PARSERS = [
  [FTMS_ROWER_DATA, parseRowerData],
  [FTMS_INDOOR_BIKE_DATA, parseIndoorBikeData],
  [FTMS_CROSS_TRAINER_DATA, parseCrossTrainerData],
];

export function serviceLabel(uuid) {
  const s = String(uuid).toLowerCase();
  if (s.startsWith('00001826')) return 'FTMS(표준 운동기구)';
  if (s.startsWith('00001818')) return 'Cycling Power';
  if (s.startsWith('00001816')) return 'Cycling Speed/Cadence';
  if (s.startsWith('0000180d')) return 'Heart Rate';
  if (s.startsWith('0000180a')) return 'Device Information';
  if (s.startsWith('0000180f')) return 'Battery';
  if (s.startsWith('6e400001')) return 'Nordic UART(자체 규격)';
  if (s.startsWith('ce06')) return 'Concept2';
  return s;
}

// 장비 1대 연결. 버튼 클릭 안에서만 호출해야 크롬 선택 창이 뜬다.
//   showAll=true 이면 표준 신호를 광고하지 않는 장비도 목록에 보여 준다(진단용).
//   onData(normalized), onStatus('connected'|'reconnecting'|'disconnected')
// 반환 { id, name, protocol:'ftms'|'cps', machineKind, services, disconnect() }
// 표준 데이터가 없으면 Error('unsupported-machine') 에 .services 를 붙여 던진다.
export async function connectFitnessMachine({ onData, onStatus, showAll = false } = {}) {
  if (!isFitnessMachineBleSupported()) throw new Error('unsupported');
  const device = await navigator.bluetooth.requestDevice(showAll
    ? { acceptAllDevices: true, optionalServices: DIAGNOSTIC_SERVICES }
    : { filters: [{ services: [FTMS_SERVICE] }, { services: [CYCLING_POWER_SERVICE] }], optionalServices: DIAGNOSTIC_SERVICES });

  let closed = false;
  let subscribed = null; // { characteristic, handler }
  let info = { protocol: null, machineKind: null, services: [] };

  const openSteps = async () => {
    const server = await device.gatt.connect();
    let services = [];
    try { services = await server.getPrimaryServices(); } catch { services = []; }
    info.services = services.map((s) => serviceLabel(s.uuid));

    const ftms = services.find((s) => String(s.uuid).toLowerCase().startsWith('00001826'));
    if (ftms) {
      for (const [uuid, parse] of FTMS_PARSERS) {
        let ch = null;
        try { ch = await ftms.getCharacteristic(uuid); } catch { ch = null; }
        if (!ch) continue;
        const handler = (e) => { const d = parse(e.target.value); if (d) onData?.(d); };
        ch.addEventListener('characteristicvaluechanged', handler);
        await ch.startNotifications();
        subscribed = { characteristic: ch, handler };
        info = { ...info, protocol: 'ftms', machineKind: parse === parseRowerData ? 'rower' : parse === parseIndoorBikeData ? 'bike' : 'cross' };
        return server;
      }
    }
    const cps = services.find((s) => String(s.uuid).toLowerCase().startsWith('00001818'));
    if (cps) {
      const ch = await cps.getCharacteristic(CYCLING_POWER_MEASUREMENT);
      let crank = null;
      const handler = (e) => { const res = parseCyclingPower(e.target.value, crank); crank = res.crank; if (res.data) onData?.(res.data); };
      ch.addEventListener('characteristicvaluechanged', handler);
      await ch.startNotifications();
      subscribed = { characteristic: ch, handler };
      info = { ...info, protocol: 'cps', machineKind: 'bike' };
      return server;
    }
    const err = new Error('unsupported-machine');
    err.services = info.services;
    err.deviceName = device.name || '';
    throw err;
  };
  const open = () => withTimeout(openSteps(), MACHINE_CONNECT_TIMEOUT_MS);

  const release = () => {
    try { subscribed?.characteristic.removeEventListener('characteristicvaluechanged', subscribed.handler); } catch { /* 이미 끊김 */ }
    subscribed = null;
  };

  const handleDisconnect = async () => {
    if (closed) return;
    release();
    onStatus?.('reconnecting');
    for (let attempt = 0; attempt < 5 && !closed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      if (closed) return;
      try { await open(); onStatus?.('connected'); return; } catch { /* 다음 시도 */ }
    }
    if (!closed) onStatus?.('disconnected');
  };
  device.addEventListener('gattserverdisconnected', handleDisconnect);

  try {
    await open();
  } catch (err) {
    closed = true;
    device.removeEventListener('gattserverdisconnected', handleDisconnect);
    release();
    try { if (device.gatt.connected) device.gatt.disconnect(); } catch { /* 이미 끊김 */ }
    throw err;
  }
  onStatus?.('connected');
  return {
    id: device.id,
    name: device.name || '운동 장비',
    protocol: info.protocol,
    machineKind: info.machineKind,
    services: info.services,
    disconnect() {
      closed = true;
      device.removeEventListener('gattserverdisconnected', handleDisconnect);
      release();
      try { if (device.gatt.connected) device.gatt.disconnect(); } catch { /* 이미 끊김 */ }
    },
  };
}
