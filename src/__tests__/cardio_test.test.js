// [15번 심폐지구력 2026-11-12] 장비 신호 해석·기록 요약·참고 VO2max·누적 보정·화면 배선.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRowerData, parseIndoorBikeData, parseCrossTrainerData, parseCyclingPower, serviceLabel,
} from '../ai-measure/core/fitnessMachineBle';
import {
  CARDIO_RECORD_KIND, astrandAgeFactor, astrandVo2max, buildCardioRecord, calibrationFactor, cardioHistoryMetrics,
  computeCardioResult, confidenceGrade, createRecorder, hagermanVo2max, lastDistance, linearFit, normalizeSex,
  pastCardioRecords, personalMaxHr, protocolsForMachine, recordTick, smoothedMax, summarizeRecovery, wattsFromPace,
} from '../ai-measure/core/cardioTest';
import { inferReportType } from '../ai-measure/core/unifiedReport';
import { mergeMeasureEntries, describeEntry } from '../services/measureHistoryService';

const read = (f) => readFileSync(join(process.cwd(), 'src', f), 'utf8');
const dv = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

describe('FTMS 신호 해석', () => {
  it('Rower Data: 스트로크·거리·페이스·파워·심박·시간', () => {
    // flags = 0x0A2C → bit2 거리, bit3 페이스, bit5 파워, bit9 심박, bit11 시간 (bit0=0 → 스트로크 포함)
    const flags = 0x0004 | 0x0008 | 0x0020 | 0x0200 | 0x0800;
    const d = parseRowerData(dv([
      flags & 0xff, flags >> 8,
      56, 0x10, 0x00, // stroke rate 28spm(0.5단위), count 16
      0xd0, 0x07, 0x00, // 거리 2000m
      0xcb, 0x00, // 페이스 203초/500m
      0x26, 0x00, // 38W
      140, // 심박
      0x2c, 0x01, // 300초
    ]));
    expect(d).toMatchObject({ machineKind: 'rower', cadence: 28, strokeCount: 16, distanceM: 2000, paceSec500: 203, powerW: 38, hrBpm: 140, elapsedSec: 300 });
  });

  it('Indoor Bike Data: 속도·케이던스·거리·파워', () => {
    const flags = 0x0004 | 0x0010 | 0x0040; // bit0=0 → 속도 포함
    const d = parseIndoorBikeData(dv([flags & 0xff, flags >> 8, 0xb8, 0x0b, 100, 0, 0xf4, 0x01, 0x00, 150, 0]));
    expect(d).toMatchObject({ machineKind: 'bike', speedKmh: 30, cadence: 50, distanceM: 500, powerW: 150 });
  });

  it('Cross Trainer Data(24bit flags): 파워·심박', () => {
    const flags = 0x0001 | 0x0100 | 0x0800; // bit0=1 → 속도 없음
    const d = parseCrossTrainerData(dv([flags & 0xff, (flags >> 8) & 0xff, 0, 0x50, 0x00, 120]));
    expect(d).toMatchObject({ machineKind: 'cross', powerW: 80, hrBpm: 120 });
  });

  it('잘린 패킷은 있는 데까지만 읽고 죽지 않는다', () => {
    expect(() => parseRowerData(dv([0x20, 0x00, 56]))).not.toThrow();
    expect(parseRowerData(dv([0x01]))).toBeNull();
  });

  it('Cycling Power: 크랭크 회전 차이로 케이던스', () => {
    const first = parseCyclingPower(dv([0x20, 0x00, 200, 0, 10, 0, 0x00, 0x04]));
    expect(first.data.powerW).toBe(200);
    const second = parseCyclingPower(dv([0x20, 0x00, 210, 0, 11, 0, 0x00, 0x08]), first.crank); // 1회전 / 1초
    expect(second.data.cadence).toBe(60);
  });

  it('서비스 이름 표시', () => {
    expect(serviceLabel('00001826-0000-1000-8000-00805f9b34fb')).toContain('FTMS');
  });
});

describe('추정 공식', () => {
  it('Concept2 파워 공식과 Hagerman: 2000m 7:00, 80kg ≈ 58.8', () => {
    expect(Math.round(wattsFromPace(420, 2000))).toBe(302);
    expect(hagermanVo2max({ timeSec: 420, distanceM: 2000, weightKg: 80 })).toBeCloseTo(58.8, 0);
  });
  it('Åstrand: 남 150W, 안정심박 130 ≈ 4.36 L/min(25세 기준)', () => {
    const v = astrandVo2max({ sex: 'male', watts: 150, hrSs: 130, age: 25, weightKg: 80 });
    expect(v).toBeCloseTo(54.5, 0); // 4.36 L/min ÷ 80kg
    expect(astrandAgeFactor(45)).toBeCloseTo(0.78, 2);
    expect(astrandAgeFactor(30)).toBeCloseTo(0.935, 2);
  });
  it('직선 맞춤·신뢰 등급', () => {
    const fit = linearFit([{ x: 50, y: 100 }, { x: 100, y: 120 }, { x: 150, y: 140 }]);
    expect(fit.b).toBeCloseTo(0.4, 3);
    expect(fit.r2).toBeCloseTo(1, 3);
    expect(confidenceGrade({ n: 3, r2: 0.99, sessions: 1 })).toBe('B');
    expect(confidenceGrade({ n: 8, r2: 0.95, sessions: 3 })).toBe('A');
    expect(confidenceGrade({ n: 2, r2: 1 })).toBe('C');
  });
  it('성별 표기 통일', () => {
    expect(normalizeSex('여')).toBe('female');
    expect(normalizeSex('M')).toBe('male');
    expect(normalizeSex('')).toBeNull();
  });
});

// 가짜 1초 기록 만들기
function simulate(seconds, fn) {
  const rec = createRecorder();
  for (let s = 0; s < seconds; s += 1) recordTick(rec, s, fn(s));
  return rec;
}

describe('1초 기록·요약', () => {
  it('장비 누적 거리는 시작값을 빼서 저장한다', () => {
    const rec = simulate(5, (s) => ({ distanceM: 1000 + s * 5 }));
    expect(rec.dist[0]).toBe(0);
    expect(lastDistance(rec)).toBe(20);
  });
  it('이상한 심박(30 미만)은 버린다, 순간 튀는 값은 최대심박이 아니다', () => {
    const rec = simulate(30, (s) => ({ hr: s === 10 ? 230 : s === 11 ? 10 : 150 }));
    expect(rec.hr[11]).toBeNull();
    expect(smoothedMax(rec.hr)).toBe(150);
  });
  it('회복 심박: 끝 10초 평균 − 60초 뒤', () => {
    const rec = simulate(200, (s) => ({ hr: s < 120 ? 170 : 130 }));
    expect(summarizeRecovery(rec, 120).drop60).toBeGreaterThanOrEqual(35);
  });
});

describe('전체 계산', () => {
  it('로잉 2000m 완료 → Hagerman 참고 VO2max', () => {
    const rec = simulate(480, (s) => ({ hr: 120 + Math.min(s, 400) / 8, powerW: 300, distanceM: Math.min(2000, Math.round(s * 4.76)) }));
    const out = computeCardioResult({ protocolId: 'rower_2k', machineId: 'rower', rec, workEndSec: 420, subject: { age: 30, sex: 'male', weightKg: 80 } });
    expect(out.result.distanceM).toBeGreaterThanOrEqual(1990);
    expect(out.estimates.vo2max.valid).toBe(true);
    expect(out.estimates.vo2max.value).toBeGreaterThan(50);
  });
  it('2000m를 못 채우면 계산하지 않고 이유를 남긴다', () => {
    const rec = simulate(200, (s) => ({ hr: 150, powerW: 250, distanceM: s * 4 }));
    const out = computeCardioResult({ protocolId: 'rower_2k', machineId: 'rower', rec, workEndSec: 200, subject: { age: 30, sex: 'male', weightKg: 80 } });
    expect(out.estimates.vo2max.value).toBeNull();
    expect(out.estimates.vo2max.reason).toContain('2000m');
  });
  it('장비 기록이 없어도 수기 입력으로 계산된다', () => {
    const rec = simulate(430, () => ({ hr: 160 }));
    const out = computeCardioResult({ protocolId: 'rower_2k', machineId: 'rower', rec, workEndSec: 420, subject: { age: 30, sex: 'male', weightKg: 80 }, manual: { timeSec: 420, distanceM: 2000 } });
    expect(out.estimates.vo2max.value).toBeCloseTo(58.8, 0);
  });
  it('Åstrand: 심박이 125~170 밖이면 계산 안 함', () => {
    const rec = simulate(360, () => ({ hr: 110, powerW: 80 }));
    const out = computeCardioResult({ protocolId: 'bike_astrand', machineId: 'bike', rec, workEndSec: 360, subject: { age: 30, sex: 'male', weightKg: 80 } });
    expect(out.estimates.vo2max.value).toBeNull();
    expect(out.estimates.vo2max.reason).toContain('125~170');
  });
  it('Åstrand: 안정 심박 140 → 값', () => {
    const rec = simulate(360, () => ({ hr: 140, powerW: 150 }));
    const out = computeCardioResult({ protocolId: 'bike_astrand', machineId: 'bike', rec, workEndSec: 360, subject: { age: 30, sex: 'male', weightKg: 80 } });
    expect(out.estimates.vo2max.value).toBeGreaterThan(30);
  });
  it('단계 테스트: 이번 점 + 과거 점을 모아 최대 파워·신뢰 등급이 올라간다', () => {
    const stageRec = (offset = 0) => simulate(540, (s) => {
      const st = Math.floor(s / 180);
      const w = 50 + st * 25;
      return { powerW: w, hr: 90 + w * 0.6 + offset };
    });
    const rec = stageRec();
    const solo = computeCardioResult({ protocolId: 'step', machineId: 'bike', rec, workEndSec: 540, subject: { age: 40, sex: 'female', weightKg: 60 } });
    expect(solo.stages.filter((s) => s.complete)).toHaveLength(3);
    expect(solo.estimates.maxPower.value).toBeGreaterThan(100);
    expect(solo.estimates.maxPower.grade).toBe('B');
    expect(solo.estimates.vo2max.method).toBe('acsmCycle');
    const pastRec = buildCardioRecord({ protocolId: 'step', machineId: 'bike', rec: stageRec(), computed: solo });
    const pastRec2 = buildCardioRecord({ protocolId: 'step', machineId: 'bike', rec: stageRec(), computed: solo });
    const pooled = computeCardioResult({ protocolId: 'step', machineId: 'bike', rec, workEndSec: 540, subject: { age: 40, sex: 'female', weightKg: 60 }, past: [pastRec, pastRec2] });
    expect(pooled.estimates.maxPower.sessionsUsed).toBe(3);
    expect(pooled.estimates.maxPower.grade).toBe('A');
  });
  it('개인 최대심박: 실제 기록이 220-나이보다 높으면 교체', () => {
    expect(personalMaxHr({ age: 40 }).value).toBe(180);
    const sessions = [{ data: { kind: CARDIO_RECORD_KIND, result: { peakHr: 188 } } }];
    expect(personalMaxHr({ age: 40, sessions })).toEqual({ value: 188, source: 'observed' });
  });
  it('실측값이 있으면 보정 계수를 만든다', () => {
    const past = [
      { estimates: { vo2max: { method: 'hagerman', value: 50 } }, referenceVo2max: 45 },
      { estimates: { vo2max: { method: 'hagerman', value: 40 } }, referenceVo2max: 36 },
    ];
    expect(calibrationFactor(past, 'hagerman')).toEqual({ factor: 0.9, pairs: 2 });
    expect(calibrationFactor(past, 'astrand')).toBeNull();
  });
  it('과거 기록은 같은 장비·최근 180일만', () => {
    const now = Date.parse('2026-11-12T00:00:00Z');
    const sessions = [
      { data: { kind: CARDIO_RECORD_KIND, machineId: 'bike', startedAt: '2026-10-01T00:00:00Z' } },
      { data: { kind: CARDIO_RECORD_KIND, machineId: 'rower', startedAt: '2026-10-01T00:00:00Z' } },
      { data: { kind: CARDIO_RECORD_KIND, machineId: 'bike', startedAt: '2025-01-01T00:00:00Z' } },
    ];
    expect(pastCardioRecords(sessions, 'bike', { now })).toHaveLength(1);
  });
});

describe('저장 페이로드·이력', () => {
  const rec = simulate(430, (s) => ({ hr: 150, powerW: 280, distanceM: Math.min(2000, s * 5) }));
  const computed = computeCardioResult({ protocolId: 'rower_2k', machineId: 'rower', rec, workEndSec: 400, subject: { age: 30, sex: 'male', weightKg: 75 } });
  const record = buildCardioRecord({ protocolId: 'rower_2k', machineId: 'rower', rec, computed, startedAt: '2026-11-12T06:00:00Z', referenceVo2max: null });

  it('1초 원본을 평평한 배열로 저장(Firestore 중첩 배열 금지)', () => {
    expect(record.series.hr).toHaveLength(430);
    expect(Object.values(record.series).every((v) => !Array.isArray(v) || v.every((x) => !Array.isArray(x)))).toBe(true);
  });
  it('다른 측정 유형으로 잘못 분류되지 않는다', () => {
    expect(inferReportType({ menu: 'cardio', data: record })).toBe('general');
  });
  it('측정 이력에 "심폐지구력"과 요약 칩이 나온다', () => {
    const entries = mergeMeasureEntries({ sessions: [{ id: 's1', menu: 'cardio', menuTitle: '심폐지구력 (VO2max)', recordedAt: '2026-11-12', data: record }] });
    const e = entries.find((x) => x.id === 's1');
    expect(e.type).toBe(CARDIO_RECORD_KIND);
    expect(e.title).toContain('심폐지구력');
    expect(describeEntry(e).metrics.map((m) => m.key)).toContain('vo2max');
  });
  it('트레이너 확인값이 있으면 그 값을 먼저 보여준다', () => {
    const m = cardioHistoryMetrics({ ...record, confirmedVo2max: 47 });
    expect(m[0]).toMatchObject({ label: 'VO2max(확인)', value: 47 });
  });
  it('장비별 테스트 목록', () => {
    expect(protocolsForMachine('rower').map((p) => p.id)).toEqual(['rower_2k', 'step', 'free']);
    expect(protocolsForMachine('treadmill').map((p) => p.id)).toEqual(['free']);
  });
});

describe('테스트별 설명', () => {
  it('모든 테스트에 무엇을 보나·하는 방법·결과 보는 법이 있다', async () => {
    const { CARDIO_PROTOCOLS, CARDIO_GLOSSARY } = await import('../ai-measure/core/cardioTest');
    for (const p of CARDIO_PROTOCOLS) {
      expect(p.info?.what, p.id).toBeTruthy();
      expect(p.info?.how?.length, p.id).toBeGreaterThan(0);
      expect(p.info?.read, p.id).toBeTruthy();
    }
    expect(CARDIO_GLOSSARY.map(([t]) => t)).toContain('1분 회복 심박');
  });
});

describe('화면·허브 배선', () => {
  const registry = read('ai-measure/registry.js');
  const hub = read('ai-measure/AiMeasureHub.jsx');
  const screen = read('ai-measure/menus/CardioTestMeasure.jsx');
  it('15번 메뉴가 등록되고 가로·세로 모두 허용', () => {
    expect(registry).toContain("id: 'cardio'");
    expect(registry).toContain('no: 15');
    expect(registry).toContain("import('./menus/CardioTestMeasure.jsx')");
  });
  it('허브는 15번 기록을 alert 없이 세션으로 돌려주고 실패는 전파', () => {
    expect(hub).toContain("const isCardio = active.id === 'cardio' && data?.kind === 'cardio_test';");
    expect(hub).toContain('if (isHeartRate || isCardio) {');
    expect(hub).toContain('if (isHeartRate || isCardio) throw e;');
  });
  it('화면을 나가면 장비·밴드 연결을 끊는다', () => {
    expect(screen).toMatch(/machineRef\.current\?\.disconnect\(\);\s*bandRef\.current\?\.disconnect\(\);/);
  });
  it('음성명령으로 15번을 연다', () => {
    expect(read('services/voiceCommandService.js')).toContain("{ id: 'cardio', keywords:");
  });
});

describe('15번 화면 렌더 스모크', () => {
  it('회원 정보로 첫 화면이 그려진다(블루투스 없는 환경)', async () => {
    const { renderToString } = await import('react-dom/server');
    const React = await import('react');
    const { default: CardioTestMeasure } = await import('../ai-measure/menus/CardioTestMeasure.jsx');
    const html = renderToString(React.createElement(CardioTestMeasure, {
      onBack: () => {}, onSave: async () => {},
      member: { id: '', isVirtual: true, name: '미등록회원', birthDate: '1990-01-01', sex: 'male', weight: 75 },
    }));
    expect(html).toContain('심폐지구력');
    expect(html).toContain('2000m 기록 테스트');
    expect(html).toContain('블루투스 연결을 지원하지 않습니다');
    expect(html).toContain('무엇을 보나');
  });
});
