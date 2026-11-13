// 2026-11-13 — 15번 결과 리포트 저장, A4 JPG 저장·전송, 저장 확인 팝업.
import { describe, it, expect } from 'vitest';
import { planA4Pages } from '../ai-measure/core/reportShare';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSummaryData, inferReportType } from '../ai-measure/core/unifiedReport';
import { extractSessionMetric } from '../pages/Report';
import CardioReportSheet from '../components/report/CardioReportSheet';

const record = {
  kind: 'cardio_test', protocolId: 'rower_2k', protocolLabel: '2000m', machineId: 'rower', machineLabel: '로잉머신',
  startedAt: '2026-11-13T01:00:00.000Z', endedAt: '2026-11-13T01:08:00.000Z', hrSource: 'band',
  subject: { age: 40, sex: 'male', weightKg: 80 }, hrMax: { value: 180 },
  result: { durationSec: 480, distanceM: 2000, avgPowerW: 180, avgHr: 160, peakHr: 175, paceSec500: 120 },
  recovery: { endHr: 175, hr60: 140, drop60: 35 }, stages: null,
  estimates: { vo2max: { value: 45.2, method: 'hagerman', valid: true, reason: '참고용' }, maxPower: null },
  notes: [], trainerNote: '컨디션 좋음',
  series: { stepSec: 1, t: [0, 1, 2, 3], hr: [100, 110, 120, 130], w: [100, 150, 160, 170], cad: [], dist: [] },
};

describe('15번 VO2max 리포트 저장', () => {
  it('통합 리포트 유형 cardio 로 분류돼 리포트에 쌓인다', () => {
    expect(inferReportType({ menu: 'cardio', data: record })).toBe('cardio');
    const summary = buildSummaryData({ ...record }, { reportType: 'cardio' });
    expect(summary.keyMetrics.map((m) => m.key)).toContain('vo2max');
    expect(summary.status).toBe('unknown'); // 추정값이라 정상/위험 판정을 만들지 않는다
  });
  it('회차 비교 지표에 VO2max 가 나온다', () => {
    const m = extractSessionMetric({ menu: 'cardio', data: record });
    expect(m.value).toBe(45.2);
  });
  it('A4 리포트가 값·이유·메모를 그린다', () => {
    const html = renderToStaticMarkup(createElement(CardioReportSheet, { report: record, member: { name: '테스트' }, showActions: false }));
    expect(html).toContain('45.2');
    expect(html).toContain('컨디션 좋음');
    expect(html).toContain('report-a4-page');
  });
  it('VO2max 를 계산하지 못한 기록은 이유를 보여준다', () => {
    const html = renderToStaticMarkup(createElement(CardioReportSheet, { report: { ...record, estimates: { vo2max: { value: null, reason: '2000m를 끝까지 하지 않아 계산하지 않았습니다.' } } }, member: { name: '테스트' }, showActions: false }));
    expect(html).toContain('계산하지 않았습니다');
  });
});

describe('리포트 저장·전송(A4 JPG)', () => {
  it('A4 페이지 계획: 짧으면 채우고, 조금 길면 줄이고, 길면 여러 장으로 나눈다', () => {
    const w = 1588; const h = Math.round(w * 297 / 210);
    expect(planA4Pages(w, h - 300)).toMatchObject({ mode: 'pad', pages: 1 });
    expect(planA4Pages(w, Math.round(h * 1.04))).toMatchObject({ mode: 'fit', pages: 1 });
    expect(planA4Pages(w, h * 2.5)).toMatchObject({ mode: 'slice', pages: 3 });
    expect(planA4Pages(w, h).pageH).toBe(h);
  });
  it('공통 버튼(ReportActions)과 리포트 화면이 같은 A4 JPG 로 저장·전송한다(프린트 버튼 없음)', () => {
    const src = readFileSync('src/components/report/ReportActions.jsx', 'utf8');
    expect(src).toContain('리포트 저장');
    expect(src).not.toContain('프린트');
    expect(src).toContain('captureNodeToA4Files');
    const report = readFileSync('src/pages/Report.jsx', 'utf8');
    expect(report).toContain('captureNodeToA4Files');
    expect(report).not.toContain('printUnifiedResult');
    expect(report).not.toContain('captureNodeToJpgFile(targets');
  });
  it('15번 리포트도 공통 버튼을 쓴다', () => {
    expect(readFileSync('src/components/report/CardioReportSheet.jsx', 'utf8')).toContain('<ReportActions');
  });
});

describe('저장 확인 팝업', () => {
  const hub = readFileSync('src/ai-measure/AiMeasureHub.jsx', 'utf8');
  it('handleSave 가 저장 전에 팝업을 묻고, 거절하면 저장하지 않고 오류로 돌려준다', () => {
    expect(hub).toContain('저장하시겠습니까?');
    expect(hub).toMatch(/askSaveConfirm\(\)\)\) \{\s*[\s\S]*?throw new Error\('저장하지 않았습니다/);
    const confirmIdx = hub.indexOf('await askSaveConfirm()');
    expect(confirmIdx).toBeGreaterThan(hub.indexOf('const handleSave'));
    expect(confirmIdx).toBeLessThan(hub.indexOf('aiStore.addSession(saveMid'));
  });
  it('신체정보(1번)는 저장 전에 화면에서 한 번만 묻는다', () => {
    expect(hub).toContain("active.id !== 'body' && !(await askSaveConfirm())");
    expect(readFileSync('src/ai-measure/menus/BodyInfoMeasure.jsx', 'utf8')).toContain('onConfirmSave');
  });
});
