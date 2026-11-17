import { describe, it, expect } from 'vitest';
import {
  pseudonymId, ageBand5, buildResearchRows, buildMemberResearchRows, researchRowsToCsv, researchCodebookCsv,
  RESEARCH_COLUMNS, RESEARCH_SCHEMA_VERSION,
} from '../ai-measure/core/researchData';
import { createRecorder, recordTick, computeCardioResult, buildCardioRecord } from '../ai-measure/core/cardioTest';

const member = { id: 'mem-123', name: '홍길동', phone: '010-1111-2222', birthDate: '1995-03-01', sex: 'female', height: 165, weight: 55 };

function curvedRecord() {
  const rec = createRecorder();
  for (let t = 0; t < 900; t += 1) recordTick(rec, t, { hr: 170 });
  const computed = computeCardioResult({ protocolId: 'curved_2400', machineId: 'treadmill', rec, workEndSec: 840, subject: { age: 31, sex: 'female', weightKg: 55 }, manual: { timeSec: 890 } });
  return buildCardioRecord({ protocolId: 'curved_2400', machineId: 'treadmill', startedAt: '2026-11-17T10:00:00.000Z', rec, computed });
}

describe('연구용 데이터(가명·긴 형식)', () => {
  it('가명 ID 는 같은 회원이면 같고 이름·전화와 무관하다', () => {
    expect(pseudonymId('mem-123')).toBe(pseudonymId('mem-123'));
    expect(pseudonymId('mem-123')).not.toBe(pseudonymId('mem-124'));
    expect(pseudonymId('mem-123')).toMatch(/^S[0-9A-Z]{11,12}$/);
    expect(pseudonymId('')).toBe('');
  });
  it('연령대는 5세 단위', () => {
    expect(ageBand5(31)).toBe('30-34');
    expect(ageBand5(25)).toBe('25-29');
    expect(ageBand5(null)).toBe('');
  });
  it('커브드 기록: 조건 열(curved)과 교재 기준 위치를 저장하고 이름·전화·생년월일은 내보내지 않는다', () => {
    const rows = buildResearchRows({ member, record: curvedRecord(), source: 'session', id: 'r1' });
    expect(rows.length).toBeGreaterThan(2);
    const csv = researchRowsToCsv(rows);
    expect(rows[0]).toMatchObject({ schema: RESEARCH_SCHEMA_VERSION, report_type: 'cardio', test_id: 'curved_2400', device_basis: 'curved', machine: '커브드 트레드밀', sex: 'female', age_band: '30-34', ref_test: 'run2400', ref_source: 'book' });
    expect(rows.every((r) => r.ref_percentile !== '')).toBe(true);
    for (const secret of ['홍길동', '010-1111-2222', '1995-03-01', 'mem-123']) expect(csv).not.toContain(secret);
    expect(rows.map((r) => r.metric_key)).toEqual(expect.arrayContaining(['durationSec', 'distanceM']));
  });
  it('일반 측정(점프 등)도 같은 열로 나온다', () => {
    const rows = buildResearchRows({ member, record: { kind: 'jump', heightCm: 31.5, measuredAt: '2026-11-10T09:00:00Z', jumpType: 'cmj' }, source: 'session', id: 'j1' });
    expect(rows.find((r) => r.metric_key === 'jumpHeight')).toMatchObject({ report_type: 'jump', metric_value: 31.5, metric_unit: 'cm', measured_date: '2026-11-10', device_basis: '' });
  });
  it('회원 전체 기록 묶음: 세션 래퍼·보행·자세·ROM 모두 처리하고 빈 값은 건너뛴다', () => {
    const rows = buildMemberResearchRows({
      member,
      sessions: [{ id: 's1', menu: 'cardio', recordedAt: '2026-11-17', data: curvedRecord() }, { id: 's2', menu: 'x', data: null }],
      gaitReports: [{ id: 'g1', kind: 'gait', measuredAt: '2026-11-09T00:00:00Z', metrics: { cadence: 168, stancePct: 60, pelvicDropAbs: 3, kneeSymmetry: 95, verticalOscillation: 7 } }],
      postureReports: [], romReports: [],
    });
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['session', 'saved-report']));
    expect(rows.filter((r) => r.report_type === 'gait').length).toBeGreaterThanOrEqual(4);
    expect(buildMemberResearchRows({ member: null })).toEqual([]);
  });
  it('CSV: 헤더·BOM·따옴표 이스케이프, 설명서에 모든 열', () => {
    const csv = researchRowsToCsv([{ subject_id: 'S1', metric_label: 'a,"b"' }]);
    expect(csv.startsWith('﻿schema,subject_id')).toBe(true);
    expect(csv).toContain('"a,""b"""');
    const book = researchCodebookCsv();
    RESEARCH_COLUMNS.forEach(([k]) => expect(book).toContain(k));
  });
});
