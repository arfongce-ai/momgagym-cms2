import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { zonesFromRange, markerPct, betterDirection, buildQuickItems, pickTopItems } from '../ai-measure/core/quickResultSheet';

describe('공용 결과시트 계산', () => {
  it('한쪽 기준(0부터) 범위는 아래 여백 없이 정상→주의→위험', () => {
    const z = zonesFromRange({ good: [0, 4], warn: [0, 7] });
    expect(z.min).toBe(0);
    expect(z.zones.map((x) => x.level)).toEqual(['normal', 'caution', 'risk']);
  });
  it('양쪽 기준 범위는 위험-주의-정상-주의-위험', () => {
    const z = zonesFromRange({ good: [160, 180], warn: [150, 190] });
    expect(z.zones.map((x) => x.level)).toEqual(['risk', 'caution', 'normal', 'caution', 'risk']);
    expect(markerPct(170, z)).toBe(50);
  });
  it('좋은 방향 추정', () => {
    expect(betterDirection({ range: { good: [0, 4], warn: [0, 7] } })).toBe('lower');
    expect(betterDirection({ range: { good: [92, 100], warn: [85, 100] } })).toBe('higher');
    expect(betterDirection({ better: 'higher' })).toBe('higher');
    expect(betterDirection({})).toBeNull();
  });
  it('보행: 기존 판정 그대로 + 지난번 대비', () => {
    const items = buildQuickItems({ kind: 'gait', metrics: { cadence: 112, pelvicDropAbs: 5.2 } },
      { previousReport: { kind: 'gait', metrics: { cadence: 105, pelvicDropAbs: 6.4 } } });
    const drop = items.find((i) => i.key === 'pelvicDrop');
    expect(drop.level).toBe('caution');
    expect(drop.improved).toBe(true);
    expect(pickTopItems(items)[0].key).toBe('pelvicDrop');
  });
  it('점프 높이처럼 기준 없는 지표는 판정하지 않는다', () => {
    const items = buildQuickItems({ kind: 'jump', heightCm: 38 });
    const h = items.find((i) => i.key === 'jumpHeight');
    expect(h.level).toBeNull();
    expect(h.dir).toBe('higher');
  });
});

describe('리포트 연결', () => {
  const dir = path.resolve(__dirname, '../ai-measure/menus');
  ['GaitReportDashboard', 'SprintReportDashboard', 'RomReport', 'JumpReportDashboard', 'LiftingReportDashboard',
    'SquatReportDashboard', 'StanceReportDashboard', 'BodyInfoReport'].forEach((f) => {
    it(`${f}에 QuickResultSheet가 붙어 있다`, () => {
      expect(fs.readFileSync(path.join(dir, `${f}.jsx`), 'utf8')).toMatch(/<QuickResultSheet/);
    });
  });
});

describe('리포트 UI 통일', () => {
  const root = path.resolve(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

  it('자세체형도 같은 공용 QuickResultSheet로 점수·먼저 볼 것·항목 카드를 그린다', () => {
    const src = read('ai-measure/menus/PostureResultSheet.jsx');
    expect(src).toContain("import QuickResultSheet from '../../components/report/QuickResultSheet.jsx'");
    expect(src).not.toMatch(/function (ScoreZoneCard|PriorityCard|DetailCard)\(/);
  });

  it('공용 헤더·섹션 제목이 밝은 화면에서도 보인다(단독 text-white 없음)', () => {
    const src = read('components/report/UnifiedReportPrimitives.jsx');
    expect(src).not.toMatch(/(?<![:\w-])text-white(?![\w/-])(?![^"]*dark:text-white)/);
    expect(src).toContain('text-slate-900 dark:text-white');
  });
});
