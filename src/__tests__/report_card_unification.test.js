import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (relPath) => fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf-8');

// 7개 A4 리포트 컴포넌트가 전부 같은 틀(UnifiedReportCanvas)과 같은 카드 폭(mx-auto)을
// 쓰는지 확인한다. 하나라도 손으로 재작성된 outer wrapper가 남아있으면 실패한다.
const REPORT_FILES = [
  'components/report/SessionShareReport.jsx',
  'ai-measure/menus/PostureReport.jsx',
  'ai-measure/menus/JumpReportDashboard.jsx',
  'ai-measure/menus/GaitReportDashboard.jsx',
  'ai-measure/menus/RomReport.jsx',
  'ai-measure/menus/LiftingReportDashboard.jsx',
  'ai-measure/menus/BodyInfoReport.jsx',
];

describe('A4 리포트 7종 — outer wrapper 통일(UnifiedReportCanvas)', () => {
  it.each(REPORT_FILES)('%s: UnifiedReportCanvas를 쓰고, 손으로 재작성한 배경 wrapper가 없다', (relPath) => {
    const src = read(relPath);
    expect(src).toContain('UnifiedReportCanvas');
    expect(src).not.toMatch(/min-h-full w-full bg-slate-950|bg-slate-950 min-h-full/);
  });

  it.each(REPORT_FILES)('%s: UnifiedReportPage 가 mx-auto로 중앙정렬된다', (relPath) => {
    const src = read(relPath);
    expect(src).toMatch(/<UnifiedReportPage[^>]*className="[^"]*mx-auto/);
  });
});

describe('자세·ROM 리포트 — 스스로 캡처 노드 id를 가진다(다른 5종과 동일한 방식)', () => {
  it('PostureReport 는 id prop을 받아 UnifiedReportPage에 전달한다', () => {
    const src = read('ai-measure/menus/PostureReport.jsx');
    expect(src).toContain("id = 'posture-report-sheet'");
    expect(src).toMatch(/<UnifiedReportPage id=\{id\}/);
  });

  it('RomReport 는 id prop을 받아 UnifiedReportPage에 전달한다', () => {
    const src = read('ai-measure/menus/RomReport.jsx');
    expect(src).toContain("id = 'rom-report-sheet'");
    expect(src).toMatch(/<UnifiedReportPage[^>]*id=\{id\}/);
  });

  it('PostureMeasure/RomMeasure 는 더 이상 중복 id wrapper를 손으로 부여하지 않는다', () => {
    expect(read('ai-measure/menus/PostureMeasure.jsx')).not.toContain('id="posture-report-sheet"');
    expect(read('ai-measure/menus/RomMeasure.jsx')).not.toContain('id="rom-report-sheet"');
  });
});

describe('Report.jsx 뷰어 — 자세·ROM 재열람 시에도 이미지 저장 버튼이 있다(다른 리포트와 기능 동일)', () => {
  it('rom 뷰어와 posture 뷰어 모두 ReportActions 로 연결되어 있다', () => {
    const src = read('pages/Report.jsx');
    expect(src).toMatch(/reportNodeId="rom-report-sheet"/);
    expect(src).toMatch(/reportNodeId="posture-report-sheet"/);
  });
});

describe('리포트 내부 액션바 폭 — 모두 카드와 동일한 794px', () => {
  it('Jump/Gait/Lifting 리포트의 저장 액션바가 820px 등 다른 폭을 쓰지 않는다', () => {
    for (const f of ['ai-measure/menus/JumpReportDashboard.jsx', 'ai-measure/menus/GaitReportDashboard.jsx', 'ai-measure/menus/LiftingReportDashboard.jsx']) {
      const src = read(f);
      expect(src).not.toMatch(/max-w-\[820px\]/);
    }
  });
});
