import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  CARDIO_PROTOCOLS, protocolsForMachine, getProtocol, parseDistanceM, curvedComparison,
  createRecorder, recordTick, computeCardioResult, buildCardioRecord, cardioHistoryMetrics,
} from '../ai-measure/core/cardioTest';

const src = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');

function run(protocolId, workEndSec, manual = null, subject = { age: 25, sex: 'female', weightKg: 55 }) {
  const rec = createRecorder();
  for (let t = 0; t < workEndSec + 60; t += 1) recordTick(rec, t, { hr: 150 });
  return computeCardioResult({ protocolId, machineId: 'treadmill', rec, workEndSec, subject, manual });
}

describe('커브드 트레드밀 테스트(2.4km·12분)', () => {
  it('트레드밀에는 커브드 2.4km·12분·자유 기록이 있고 커브드가 먼저 나온다', () => {
    expect(protocolsForMachine('treadmill').map((p) => p.id)).toEqual(['curved_2400', 'curved_12min', 'free']);
    expect(getProtocol('curved_2400').basis).toBe('curved');
    expect(getProtocol('curved_12min').target.durationSec).toBe(720);
    expect(CARDIO_PROTOCOLS.filter((p) => p.basis === 'curved').every((p) => p.estimate === null)).toBe(true);
  });
  it('콘솔 거리 입력: 2.43(km)·2430(m) 모두 2430m, 10m 단위', () => {
    expect(parseDistanceM('2.43')).toBe(2430);
    expect(parseDistanceM('2430')).toBe(2430);
    expect(parseDistanceM('2,43')).toBe(2430);
    expect(parseDistanceM('2433')).toBe(2430);
    expect(parseDistanceM('')).toBeNull();
    expect(parseDistanceM('abc')).toBeNull();
  });
  it('2.4km: 입력한 콘솔 시간을 쓰고 거리는 2400m, VO2max는 계산하지 않는다', () => {
    const c = run('curved_2400', 805, { timeSec: 13 * 60 + 5 });
    expect(c.result.durationSec).toBe(785);
    expect(c.result.distanceM).toBe(2400);
    expect(c.estimates.vo2max).toBeNull();
    expect(c.notes.join(' ')).toContain('커브드');
  });
  it('12분: 시간 720초, 콘솔 거리를 넣으면 거리 기록, 안 넣으면 안내', () => {
    const ok = run('curved_12min', 720, { distanceM: 2430 });
    expect(ok.result.durationSec).toBe(720);
    expect(ok.result.distanceM).toBe(2430);
    const none = run('curved_12min', 720);
    expect(none.result.distanceM).toBeNull();
    expect(none.notes.join(' ')).toContain('DIS.');
  });
  it('교재 표(평지) 대비 위치는 flatReference 로 저장만 하고, 점수·VO2max 로는 안 쓴다', () => {
    const c = run('curved_2400', 880, { timeSec: 14 * 60 + 50 });
    expect(c.flatReference.source).toBe('book');
    expect(c.flatReference.percentile).toBe(40);
    expect(c.flatReference.note).toContain('연구용');
    expect(c.estimates.vo2max).toBeNull();
    const rec = createRecorder();
    const record = buildCardioRecord({ protocolId: 'curved_2400', machineId: 'treadmill', startedAt: '2026-11-17T10:00:00Z', rec, computed: c });
    expect(record.basis).toBe('curved');
    expect(record.flatReference.percentile).toBe(40);
    // 이력 칩에는 등급·백분위 없이 값만
    const chips = cardioHistoryMetrics(record).map((m) => m.key);
    expect(chips).toEqual(expect.arrayContaining(['distanceM', 'durationSec']));
    expect(JSON.stringify(cardioHistoryMetrics(record))).not.toContain('percentile');
  });
  it('성별·나이가 없으면 flatReference 는 null(기준을 만들지 않는다)', () => {
    const c = run('curved_2400', 880, { timeSec: 890 }, { age: null, sex: '', weightKg: null });
    expect(c.flatReference).toBeNull();
  });
  it('직전 비교: 같은 테스트·장비끼리만, 시간은 짧을수록 거리는 길수록 좋다', () => {
    const base = { machineId: 'treadmill', protocolId: 'curved_2400', startedAt: '2026-11-10T09:00:00Z', result: { durationSec: 800 } };
    const cur = { machineId: 'treadmill', protocolId: 'curved_2400', result: { durationSec: 770 } };
    expect(curvedComparison(cur, base)).toMatchObject({ kind: 'time', diff: -30, direction: 'improved', previousDate: '2026-11-10' });
    const d1 = { machineId: 'treadmill', protocolId: 'curved_12min', result: { distanceM: 2400 } };
    const d2 = { machineId: 'treadmill', protocolId: 'curved_12min', result: { distanceM: 2350 } };
    expect(curvedComparison(d2, d1).direction).toBe('worsened');
    expect(curvedComparison(cur, d1)).toBeNull(); // 다른 테스트
    expect(curvedComparison({ ...cur, machineId: 'rower' }, base)).toBeNull(); // 다른 장비
    expect(curvedComparison({ protocolId: 'rower_2k', machineId: 'rower', result: { durationSec: 1 } }, { protocolId: 'rower_2k', machineId: 'rower', result: { durationSec: 2 } })).toBeNull(); // 커브드만
  });
  it('화면은 책 표 등급(백분위)을 보여주지 않는다', () => {
    const measure = src('ai-measure/menus/CardioTestMeasure.jsx');
    const sheet = src('components/report/CardioReportSheet.jsx');
    expect(measure).not.toMatch(/flatReference|percentile|백분위/);
    expect(sheet).not.toMatch(/flatReference|percentile|백분위/);
    expect(measure).toContain('cardio-curved-compare');
  });
});
