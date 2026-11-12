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
  withTimeout,
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
    expect(src.match(/<HeartRatePanel /g)).toHaveLength(1);
    expect(src.indexOf('<HeartRatePanel ')).toBeGreaterThan(src.indexOf('<Metronome '));
  });
});

describe('withTimeout — 연결이 멈춰도 화면이 갇히지 않게', () => {
  it('제때 끝나면 값을 그대로 돌려준다', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
  it('시간 안에 안 끝나면 timeout 오류', async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow('timeout');
  });
  it('원래 오류는 그대로 전달', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});

// ── [심박 기록 2026-11-11] 기록 요약·이력 표시 ─────────────────────────────
import {
  HEART_RATE_RECORD_KIND,
  summarizeHeartRateSamples,
  buildHeartRateRecord,
  heartRateHistoryMetrics,
  formatDuration,
} from '../ai-measure/core/heartRateBle.js';
import { mergeMeasureEntries, describeEntry, TYPE_LABEL } from '../services/measureHistoryService.js';
import { inferReportType } from '../ai-measure/core/unifiedReport.js';

const everySecond = (bpms) => bpms.map((bpm, i) => ({ t: i * 1000, bpm }));

describe('summarizeHeartRateSamples — 기록 구간 요약', () => {
  it('평균·최고·최저·시간', () => {
    const s = summarizeHeartRateSamples(everySecond([100, 110, 120, 130, 140]), { durationMs: 5000 });
    expect(s).toMatchObject({ durationSec: 5, avgBpm: 120, maxBpm: 140, minBpm: 100, sampleCount: 5, zoneSec: null, maxHrEstimate: null, avgPctOfMax: null });
  });
  it('값이 없으면 null, 0·이상값(밴드 미접촉)은 버린다', () => {
    expect(summarizeHeartRateSamples([])).toBeNull();
    expect(summarizeHeartRateSamples(everySecond([0, 0, 0]))).toBeNull();
    expect(summarizeHeartRateSamples(everySecond([0, 100, 255, 110])).sampleCount).toBe(2);
  });
  it('최대심박이 있으면 구간별 시간(초)을 센다', () => {
    // 최대 180 기준: 100=56%(1구간) 3초, 150=83%(4구간) 2초
    const s = summarizeHeartRateSamples(everySecond([100, 100, 100, 150, 150]), { durationMs: 5000, maxHr: 180 });
    expect(s.zoneSec).toEqual({ z1: 3, z2: 0, z3: 0, z4: 2, z5: 0 });
    expect(s.avgPctOfMax).toBe(67);
  });
  it('신호가 끊긴 긴 공백은 5초까지만 구간 시간으로 인정', () => {
    const s = summarizeHeartRateSamples([{ t: 0, bpm: 100 }, { t: 60000, bpm: 100 }], { durationMs: 61000, maxHr: 180 });
    expect(s.zoneSec.z1).toBe(6); // 5초(공백 상한) + 1초
    expect(s.durationSec).toBe(61);
  });
  it('그래프용 값: 5초 묶음 평균, 신호 없는 묶음은 0', () => {
    const s = summarizeHeartRateSamples([...everySecond([100, 100, 100, 100, 100]), { t: 12000, bpm: 130 }], { durationMs: 13000 });
    expect(s.seriesStepSec).toBe(5);
    expect(s.bpmSeries).toEqual([100, 0, 130]);
  });
  it('긴 기록은 간격을 넓혀 360개 이하로 유지', () => {
    const twoHours = Array.from({ length: 7200 }, (_, i) => ({ t: i * 1000, bpm: 120 }));
    const s = summarizeHeartRateSamples(twoHours, { durationMs: 7200000 });
    expect(s.bpmSeries.length).toBeLessThanOrEqual(360);
    expect(s.seriesStepSec).toBe(40);
    expect(s.avgBpm).toBe(120);
  });
});

describe('buildHeartRateRecord — 저장 페이로드', () => {
  const summary = summarizeHeartRateSamples(everySecond([100, 120, 140]), { durationMs: 3000, maxHr: 180 });
  const record = buildHeartRateRecord({ summary, startedAt: '2026-11-11T10:00:00.000Z', endedAt: '2026-11-11T10:00:03.000Z', bandLabel: '7번', timerTab: 'interval' });

  it('kind 와 요약 필드를 담고 undefined 가 없다(Firestore 저장 가능)', () => {
    expect(record.kind).toBe(HEART_RATE_RECORD_KIND);
    expect(record).toMatchObject({ bandLabel: '7번', timerTab: 'interval', avgBpm: 120, maxBpm: 140 });
    expect(JSON.stringify(record)).not.toContain('undefined');
    expect(Object.values(record).some((v) => v === undefined)).toBe(false);
  });
  it('요약이 없으면 null', () => {
    expect(buildHeartRateRecord({ summary: null })).toBeNull();
  });
  it('다른 측정 유형으로 오인되지 않는다(통합 리포트 미러링 제외 = general)', () => {
    expect(inferReportType({ menu: 'timer', menuTitle: '초시계·메트로놈', data: record })).toBe('general');
  });
});

describe('측정 이력 표시', () => {
  const summary = summarizeHeartRateSamples(everySecond([100, 120, 140]), { durationMs: 95000, maxHr: 180 });
  const record = buildHeartRateRecord({ summary, startedAt: '2026-11-11T10:00:00.000Z', endedAt: '2026-11-11T10:01:35.000Z' });
  const session = { id: 'ai_1', menu: 'timer', menuTitle: '초시계·메트로놈', recordedAt: '2026-11-11', recordedAtFull: '2026-11-11T10:01:35.000Z', data: record };

  it('심박 기록 세션은 "심박 측정"으로 묶인다', () => {
    const [entry] = mergeMeasureEntries({ sessions: [session] });
    expect(entry.type).toBe('heart_rate');
    expect(entry.title).toBe(TYPE_LABEL.heart_rate);
    expect(entry.title).toBe('심박 측정');
  });
  it('평균·최고·시간 칩을 보여주고 신뢰도는 미기록', () => {
    const [entry] = mergeMeasureEntries({ sessions: [session] });
    const { metrics, confidence } = describeEntry(entry);
    expect(metrics.map((m) => `${m.label}: ${m.displayValue}${m.unit}`)).toEqual(['평균: 120bpm', '최고: 140bpm', '시간: 1분 35초', '평균 강도: 67%']);
    expect(confidence).toEqual({ pct: null, source: '' });
  });
  it('다른 초시계 세션(심박 아님)은 기존 표시 그대로', () => {
    const [entry] = mergeMeasureEntries({ sessions: [{ id: 'ai_2', menu: 'timer', menuTitle: '초시계·메트로놈', recordedAt: '2026-11-11', data: { laps: 3 } }] });
    expect(entry.type).toBe('timer');
    expect(entry.title).toBe('초시계·메트로놈');
  });
  it('요약 칩·시간 표기 보조 함수', () => {
    expect(formatDuration(0)).toBe('0분 00초');
    expect(formatDuration(125)).toBe('2분 05초');
    expect(heartRateHistoryMetrics({})).toEqual([]);
  });
});

describe('허브·패널 저장 연결', () => {
  const hub = readFileSync(new URL('../ai-measure/AiMeasureHub.jsx', import.meta.url), 'utf8');
  const tool = readFileSync(new URL('../ai-measure/menus/TimerTool.jsx', import.meta.url), 'utf8');
  it('TimerTool 이 onSave·member·현재 탭을 패널에 넘긴다', () => {
    expect(tool).toContain('<HeartRatePanel member={member} onSave={onSave} timerTab={tab} />');
  });
  it('허브는 심박 기록을 alert 없이 돌려주고 실패는 전파한다', () => {
    expect(hub).toContain("const isHeartRate = active.id === 'timer' && data?.kind === 'heart_rate';");
    expect(hub).toMatch(/if \(isHeartRate\) \{\s*return savedSession;/);
    expect(hub).toContain('if (isHeartRate) throw e;');
  });
});
