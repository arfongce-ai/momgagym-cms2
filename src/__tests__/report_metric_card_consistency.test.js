// report_metric_card_consistency.test.js
// 회귀 테스트: AI측정분석 리포트들의 "핵심 수치" 카드가 공용 MetricCard(숫자 text-2xl 통일)를
// 계속 쓰는지 확인한다. 예전에는 리포트마다 자체 카드(local MetricCard/SmallMetric/SummaryStat)를
// 두고 있어서 숫자 글자 크기가 리포트마다 제각각이었다(ROM: text-lg/xl 혼용, 보행: text-xl,
// 체성분: text-sm 등). 아래 파일들은 공용 컴포넌트로 통일되었으므로, 다시 로컬 카드가
// 생기면(또는 공용 MetricCard import가 사라지면) 이 테스트가 실패해야 한다.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (relPath) => fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf-8');

// 공용 MetricCard로 통일된 리포트 — 각 리포트의 "핵심 수치" 그리드가 이 컴포넌트를 쓴다.
const UNIFIED_METRIC_CARD_FILES = [
  'ai-measure/menus/RomReport.jsx',
  'ai-measure/menus/PostureReport.jsx',
  'ai-measure/menus/GaitReportDashboard.jsx',
  'ai-measure/menus/BodyInfoReport.jsx',
];

describe('AI측정분석 리포트 — 핵심 수치 카드가 공용 MetricCard로 통일되어 있다', () => {
  it.each(UNIFIED_METRIC_CARD_FILES)('%s: UnifiedReportPrimitives의 MetricCard를 import해서 쓴다', (relPath) => {
    const src = read(relPath);
    expect(src).toMatch(/import\s*\{[^}]*\bMetricCard\b[^}]*\}\s*from\s*['"][^'"]*UnifiedReportPrimitives['"]/);
    expect(src).toMatch(/<MetricCard\b/);
  });

  it('RomReport는 더 이상 자체 MetricCard(label/value/sub props)를 재정의하지 않는다', () => {
    const src = read('ai-measure/menus/RomReport.jsx');
    expect(src).not.toMatch(/function MetricCard\(\{\s*label,\s*value,\s*sub/);
  });

  it('PostureReport는 더 이상 자체 SmallMetric(text-xl 카드)을 재정의하지 않는다', () => {
    const src = read('ai-measure/menus/PostureReport.jsx');
    expect(src).not.toMatch(/function SmallMetric/);
  });

  it('GaitReportDashboard는 더 이상 자체 SummaryStat(text-xl 카드)을 재정의하지 않는다', () => {
    const src = read('ai-measure/menus/GaitReportDashboard.jsx');
    expect(src).not.toMatch(/function SummaryStat/);
  });

  it('GaitReportDashboard는 공용 rangeToStatus로 상태를 판정한다(색상 임계값 로직 중복 방지)', () => {
    const src = read('ai-measure/menus/GaitReportDashboard.jsx');
    expect(src).toMatch(/import\s*\{\s*rangeToStatus\s*\}\s*from\s*['"][^'"]*unifiedReport['"]/);
  });

  it('BodyInfoReport는 등급을 공용 scoreToStatus 토큰으로 변환해 MetricCard에 전달한다', () => {
    const src = read('ai-measure/menus/BodyInfoReport.jsx');
    expect(src).toMatch(/scoreToStatus/);
    expect(src).not.toMatch(/const TIER = \{/);
  });

  // LiftingReportDashboard/JumpReportDashboard는 각자 고유한 이유로 자체 카드를 유지한다:
  //  · Lifting: '핵심 지표 1개 강조(accent)'는 정상/주의/위험 상태가 아니라 단순 시각적 강조라
  //    공용 MetricCard의 상태 배지 의미와 맞지 않는다. 대신 숫자 크기만 다른 리포트와
  //    동일하게(text-2xl) 맞췄다.
  //  · Jump: 값 자릿수에 따라 폰트 크기를 동적으로 줄이는 자체 로직(StatCard)이 있어,
  //    긴 숫자가 좁은 카드에서 넘치는 것을 막아준다 — 공용 카드로 바꾸면 오히려 회귀.
  it('LiftingReportDashboard의 핵심 수치 폰트는 다른 리포트와 같은 text-2xl이다', () => {
    const src = read('ai-measure/menus/LiftingReportDashboard.jsx');
    expect(src).toMatch(/font-mono font-black text-2xl/);
    expect(src).not.toMatch(/font-mono font-black text-xl[^0-9]/);
  });
});
