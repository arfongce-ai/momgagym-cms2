// 2026-11-13 — 15번 결과 리포트 저장, 공통 A4 인쇄, 저장 확인 팝업.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSummaryData, inferReportType } from '../ai-measure/core/unifiedReport';
import { extractSessionMetric } from '../pages/Report';
import { printReportNodes } from '../utils/printA4';
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

describe('공통 A4 인쇄', () => {
  // 이 저장소 테스트 환경엔 DOM(jsdom)이 없어 소스 규칙으로 확인한다. 실제 인쇄 미리보기는 브라우저에서 확인 필요.
  const print = readFileSync('src/utils/printA4.js', 'utf8');
  it('A4 용지·페이지 나눔·정리 규칙이 있다', () => {
    expect(print).toContain('size: A4');
    expect(print).toContain('break-after: page');
    expect(print).toContain("classList.remove('dark')"); // 흰 종이로 인쇄
    expect(print).toContain("addEventListener('afterprint'"); // 인쇄 뒤 원래대로
    expect(print).toContain('canvas.toDataURL'); // 캔버스 그림 유지
  });
  it('모든 결과 리포트 공통 버튼(ReportActions)에 인쇄가 있다', () => {
    const src = readFileSync('src/components/report/ReportActions.jsx', 'utf8');
    expect(src).toContain('printReportById');
    expect(src).toContain('A4 인쇄');
  });
  it('printReportNodes 는 노드가 없으면 인쇄하지 않는다', () => {
    expect(printReportNodes([])).toBe(false);
    expect(printReportNodes(null)).toBe(false);
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
