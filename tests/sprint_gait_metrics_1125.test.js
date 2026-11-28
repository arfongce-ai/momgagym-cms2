import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BiomechAccumulator } from '../src/ai-measure/core/gaitBiomechanics';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const frame = (spread) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[11] = { x: 0.45, y: 0.2, visibility: 1 }; lm[12] = { x: 0.55, y: 0.2, visibility: 1 };
  lm[23] = { x: 0.46, y: 0.5, visibility: 1 }; lm[24] = { x: 0.54, y: 0.5, visibility: 1 };
  lm[27] = { x: 0.5 - spread / 2, y: 0.9, visibility: 1 }; lm[28] = { x: 0.5 + spread / 2, y: 0.9, visibility: 1 };
  return lm;
};

describe('보폭 비율 표시 오류 수정', () => {
  it('보폭 비율은 소수 둘째 자리 이하 깔끔한 숫자', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 20; i++) acc.push(frame(0.77));
    const s = acc.summary();
    expect(String(s.strideToHeight).length).toBeLessThanOrEqual(5);
    expect(s.strideToHeight).toBeCloseTo(1.1, 1);
  });
  it('비현실적 값(3배 초과)은 null', () => {
    const acc = new BiomechAccumulator();
    for (let i = 0; i < 20; i++) acc.push(frame(2.5));
    expect(acc.summary().strideToHeight).toBeNull();
  });
  it('대시보드는 toFixed(2)로 표시', () => {
    expect(read('src/ai-measure/menus/GaitReportDashboard.jsx')).toMatch(/Number\(m\.strideToHeight\)\.toFixed\(2\)/);
  });
});

describe('5번 스프린트·왕복달리기 보행 지표', () => {
  const live = read('src/ai-measure/menus/SprintLiveAnalysis.jsx');
  it('측면에서도 보행 누적기를 쌓고 리포트 metrics에 저장', () => {
    expect(live).toMatch(/GaitCycleTracker/);
    expect(live).toMatch(/metrics: \{ \.\.\.gaitPart/);
    expect(live).toMatch(/runMechanics: runMechRef\.current\.summary/);
  });
  it('리포트에 보행 지표 패널', () => {
    expect(read('src/ai-measure/menus/SprintReportDashboard.jsx')).toMatch(/보행 지표 \(참고\)/);
  });
});

describe('리포트 목록 중복·뷰어 연결', () => {
  const rep = read('src/pages/Report.jsx');
  it('sprint 세션은 상세 세션 메뉴로 취급(중복 카드 방지)', () => {
    expect(rep).toMatch(/DETAIL_SESSION_MENUS = new Set\(\[[^\]]*'sprint'/);
  });
  it('스프린트 기록은 SprintReportDashboard로 연다', () => {
    expect(rep).toMatch(/isSprintKind\(savedReports\[viewerIdx\]\)\s*\?\s*<SprintReportDashboard/);
  });
  it('gait 분류에서 스프린트·점프 제외', () => {
    expect(rep).toMatch(/gait: savedReports\.filter\(\(item\) => !isSprintKind\(item\)/);
  });
});

import { resolveGaitMode, cadenceRangeFor } from '../src/ai-measure/core/gaitMode';
describe('측정 전 걷기/달리기 구분', () => {
  it('명시 선택이 케이던스 자동 구분보다 우선', () => {
    expect(resolveGaitMode(170, 'walk')).toBe('walk');
    expect(resolveGaitMode(110, 'run')).toBe('run');
    expect(resolveGaitMode(110, null)).toBe('walk');
    expect(cadenceRangeFor(110, 'run').good).toEqual([160, 180]);
  });
  it('트레드밀·5번 화면에 선택 UI와 저장', () => {
    expect(read('src/ai-measure/menus/GaitRunningAnalysis.jsx')).toMatch(/\['walk', '걷기'\], \['run', '달리기'\]/);
    expect(read('src/ai-measure/menus/SprintLiveAnalysis.jsx')).toMatch(/gaitMode: gaitModeSel === 'auto'/);
  });
});
