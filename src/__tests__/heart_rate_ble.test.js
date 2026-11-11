// [심박 밴드 2026-11-11] heartRateBle.js 순수 함수 검증 — 실제 모듈을 import해서
// 실행한다. 블루투스 연결 자체는 실기기에서만 확인 가능하므로 여기서는 값 해석,
// 구간 계산, 이름표 저장, 그리고 TimerTool에 패널이 붙어 있는지만 본다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_HEART_RATE_BANDS,
  parseHeartRateMeasurement,
  maxHeartRateFromAge,
  ageFromBirthDate,
  heartRateZone,
  shortBandId,
  isHeartRateBleSupported,
  loadBandProfiles,
  saveBandProfile,
} from '../ai-measure/core/heartRateBle.js';

const view = (...bytes) => new DataView(new Uint8Array(bytes).buffer);

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

describe('parseHeartRateMeasurement — 0x2A37 값 해석', () => {
  it('1바이트 심박(HW702A 실측: flags 0x00, 101 bpm, 접촉 감지 미지원)', () => {
    expect(parseHeartRateMeasurement(view(0x00, 101))).toEqual({ bpm: 101, contact: null });
  });
  it('2바이트 심박(little-endian)', () => {
    expect(parseHeartRateMeasurement(view(0x01, 0x2c, 0x01))).toEqual({ bpm: 300, contact: null });
  });
  it('접촉 감지 지원 밴드: 접촉됨 / 접촉 안 됨', () => {
    expect(parseHeartRateMeasurement(view(0x06, 80)).contact).toBe(true);
    expect(parseHeartRateMeasurement(view(0x04, 0)).contact).toBe(false);
  });
  it('값이 모자라면 null', () => {
    expect(parseHeartRateMeasurement(view(0x00))).toBeNull();
    expect(parseHeartRateMeasurement(view(0x01, 0x50))).toBeNull();
    expect(parseHeartRateMeasurement(null)).toBeNull();
  });
});

describe('구간 계산', () => {
  it('나이 → 최대심박(220-나이), 이상한 값은 null', () => {
    expect(maxHeartRateFromAge(40)).toBe(180);
    expect(maxHeartRateFromAge('')).toBeNull();
    expect(maxHeartRateFromAge(0)).toBeNull();
    expect(maxHeartRateFromAge(150)).toBeNull();
  });
  it('최대심박 대비 %로 1~5 구간', () => {
    expect(heartRateZone(90, 180)).toEqual({ zone: 1, pct: 50 });
    expect(heartRateZone(108, 180).zone).toBe(2);
    expect(heartRateZone(126, 180).zone).toBe(3);
    expect(heartRateZone(144, 180).zone).toBe(4);
    expect(heartRateZone(162, 180).zone).toBe(5);
  });
  it('최대심박을 모르면 null(색 없이 숫자만)', () => {
    expect(heartRateZone(120, null)).toBeNull();
    expect(heartRateZone(0, 180)).toBeNull();
  });
});

describe('회원 연계 준비 — 생년월일 → 만 나이', () => {
  const today = new Date(2026, 10, 11); // 2026-11-11
  it('생일이 지났으면 그대로, 안 지났으면 한 살 적게', () => {
    expect(ageFromBirthDate('1990-11-11', today)).toBe(36);
    expect(ageFromBirthDate('1990-11-12', today)).toBe(35);
    expect(ageFromBirthDate('1990-01-05', today)).toBe(36);
  });
  it('값이 없거나 이상하면 null(단순 측정으로 동작)', () => {
    expect(ageFromBirthDate('', today)).toBeNull();
    expect(ageFromBirthDate(null, today)).toBeNull();
    expect(ageFromBirthDate('abc', today)).toBeNull();
    expect(ageFromBirthDate('2025-01-01', today)).toBeNull();
  });
});

describe('밴드 식별·이름표', () => {
  it('이름에서 뒷면 ID 끝 4자리를 뽑는다', () => {
    expect(shortBandId('HW702A-1015188')).toBe('5188');
    expect(shortBandId('')).toBe('');
  });
  it('이름표·나이를 저장하고 다시 읽는다(심박 값은 저장 항목에 없음)', () => {
    const storage = memoryStorage();
    saveBandProfile('HW702A-1015188', { label: '7번', age: '35', bpm: 101 }, storage);
    expect(loadBandProfiles(storage)).toEqual({ 'HW702A-1015188': { label: '7번', age: 35 } });
  });
  it('저장소가 깨져 있어도 빈 객체', () => {
    expect(loadBandProfiles({ getItem: () => '{oops' })).toEqual({});
  });
});

describe('지원 여부·상한', () => {
  it('navigator.bluetooth가 없으면 미지원', () => {
    expect(isHeartRateBleSupported({})).toBe(false);
    expect(isHeartRateBleSupported({ bluetooth: { requestDevice() {} } })).toBe(true);
  });
  it('동시 연결 상한은 5', () => {
    expect(MAX_HEART_RATE_BANDS).toBe(5);
  });
});

describe('TimerTool 연결', () => {
  const src = readFileSync(new URL('../ai-measure/menus/TimerTool.jsx', import.meta.url), 'utf8');
  it('심박 패널이 도구(초시계 등) 아래에 한 번만 들어가 있다', () => {
    expect(src.match(/<HeartRatePanel member=\{member\} \/>/g)).toHaveLength(1);
    expect(src.indexOf('<HeartRatePanel member={member} />')).toBeGreaterThan(src.indexOf('<Metronome command={liveCommand} />'));
  });
});
