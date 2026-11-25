import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PAPS_TESTS, PAPS_TEST_ORDER, bestOfTrials, buildPapsRecord, evaluatePapsTest, papsChange, papsGroupKey, papsHistoryMetrics,
} from '../ai-measure/core/papsTests';
import { inferReportType } from '../ai-measure/core/unifiedReport';
import { subtypeOf } from '../ai-measure/core/measureSubtype';
import { MEASURE_MENUS } from '../ai-measure/registry';

describe('PAPS 탭 (2026-11-25)', () => {
  it('모든 테스트에 설명·단위·종류가 있다', () => {
    PAPS_TEST_ORDER.forEach((id) => {
      const t = PAPS_TESTS[id];
      expect(t.label && t.unit && t.kind && t.how.length).toBeTruthy();
      expect(typeof t.easy(5)).toBe('string');
    });
  });
  it('등급 판정은 하지 않는다 — status 는 항상 unknown', () => {
    expect(evaluatePapsTest('pushup', 20).status).toBe('unknown');
    expect(evaluatePapsTest('pushup', 20).valid).toBe(true);
  });
  it('무효·값 없음·음수는 valid=false 로 저장은 가능', () => {
    expect(evaluatePapsTest('pushup', 20, { invalid: true }).valid).toBe(false);
    expect(evaluatePapsTest('pushup', '').valid).toBe(false);
    expect(evaluatePapsTest('pullup', -1).valid).toBe(false);
    expect(evaluatePapsTest('sitreach', -3.5).valid).toBe(true); // 앞굽히기는 마이너스 가능
    const rec = buildPapsRecord({ testId: 'pushup', value: '', invalid: true });
    expect(rec.kind).toBe('paps_test');
    expect(rec.valid).toBe(false);
  });
  it('value 형은 가장 좋은 값을 쓴다', () => {
    expect(bestOfTrials([{ value: '10' }, { value: '12.5' }, { value: '' }])).toBe(12.5);
    expect(bestOfTrials([])).toBe(null);
  });
  it('무릎 방식은 별도 추이이고, 같은 테스트끼리만 변화를 비교한다', () => {
    const a = buildPapsRecord({ testId: 'pushup', value: 10 });
    const b = buildPapsRecord({ testId: 'pushup', value: 14 });
    const k = buildPapsRecord({ testId: 'pushup', value: 14, variant: 'knee' });
    expect(papsGroupKey(a)).not.toBe(papsGroupKey(k));
    expect(papsChange(b, a)).toMatchObject({ diff: 4, direction: 'improved' });
    expect(papsChange(k, a)).toBe(null);
    const c = buildPapsRecord({ testId: 'pushup', value: 14, invalid: true });
    expect(papsChange(c, a)).toBe(null);
  });
  it('이력 칩·종합분석 분류·세부종류가 연결된다', () => {
    const rec = buildPapsRecord({ testId: 'situp1m', value: 30, subject: { age: 13, sex: 'male', grade: '중1' } });
    expect(papsHistoryMetrics(rec)[0].displayValue).toBe('30');
    expect(inferReportType(rec)).toBe('paps');
    expect(subtypeOf('paps', rec).key).toBe('situp1m');
    expect(rec.subject.grade).toBe('중1');
  });
  it('메뉴 14번 paps, paps 그룹', () => {
    const m = MEASURE_MENUS.find((x) => x.id === 'paps');
    expect(m.no).toBe(14);
    expect(m.group).toBe('paps');
  });
  it('허브·리포트·음성에 등록되어 있다', () => {
    const hub = readFileSync('src/ai-measure/AiMeasureHub.jsx', 'utf8');
    expect(hub).toContain("const isPaps = active.id === 'paps' && data?.kind === 'paps_test';");
    expect(readFileSync('src/pages/Report.jsx', 'utf8')).toContain('PapsReportSheet');
    expect(readFileSync('functions/api/voice-command.js', 'utf8')).toContain("'paps'");
  });
});
