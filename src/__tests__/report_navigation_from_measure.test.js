// [리포트 통합 2026-08-09] "AI 측정 후 리포트저장은 결과리포트로 이동" 배선
// 확인. 세 파일에 걸쳐 있다:
//   1) AiMeasureHub.jsx  — viewInReport()가 pendingVoiceTarget을 심고 navigate.
//   2) PostureMeasure.jsx — 저장 완료 후에만 "결과리포트에서 보기" 버튼 노출
//      (강제 이동 아님 — 영상 저장·카카오 공유 같은 그 자리 액션을 안 끊음).
//   3) Report.jsx — 도착해서 해당 종류의 저장된 리포트가 준비되면 자동으로 연다.
// posture로 먼저 끝까지 검증한 패턴 — 나머지 측정 종류로 확장할 때 이 셋을
// 그대로 복제하면 된다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('AiMeasureHub.jsx — viewInReport (결과리포트로 이동)', () => {
  const src = readSrc('src', 'ai-measure', 'AiMeasureHub.jsx');

  it('useNavigate를 가져와 쓴다', () => {
    expect(src).toContain("import { useNavigate } from 'react-router-dom';");
    expect(src).toContain('const navigate = useNavigate();');
  });

  it('setPendingVoiceTarget을 가져와 쓴다(1회성 신호 재사용 — 새로 만들지 않음)', () => {
    expect(src).toContain(
      "import { consumePendingVoiceTarget, setPendingVoiceTarget } from '../voice/pendingVoiceTarget';"
    );
  });

  it('미등록회원(게스트)은 지원하지 않는다 — 결과리포트 화면의 회원 목록엔 게스트가 없어 매칭될 수 없다', () => {
    const start = src.indexOf('const viewInReport = (openReportKind) => {');
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (!member || member.isVirtual) return;');
  });

  it('setPendingVoiceTarget으로 memberName과 openReportKind를 심은 뒤 /report로 이동한다', () => {
    const start = src.indexOf('const viewInReport = (openReportKind) => {');
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);
    expect(body).toContain('setPendingVoiceTarget({ memberName: member.name, openReportKind });');
    expect(body).toContain("navigate('/report');");
  });

  it('측정 컴포넌트에 onViewInReport를 넘긴다(active.id로 종류를 알려줌)', () => {
    expect(src).toContain('onViewInReport={() => viewInReport(active.id)}');
  });
});

describe('PostureMeasure.jsx — "결과리포트에서 보기" 버튼(강제 이동 아님)', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'PostureMeasure.jsx');

  it('onViewInReport prop을 받는다', () => {
    expect(src).toMatch(/PostureMeasure\(\{ member, onSave, onBack, onViewInReport \}\)/);
  });

  it('저장 완료(saveState===\'saved\') 이후에만 버튼이 뜬다 — 저장 전이나 실패 시엔 안 뜸', () => {
    const idx = src.indexOf('📊 결과리포트에서 보기');
    expect(idx).toBeGreaterThan(-1);
    const guardStart = src.lastIndexOf("saveState === 'saved'", idx);
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(idx);
  });

  it('미등록회원이면 버튼을 안 보여준다(눌러도 소용없는 버튼을 애초에 안 보여줌)', () => {
    const idx = src.indexOf('📊 결과리포트에서 보기');
    const guardStart = src.lastIndexOf("saveState === 'saved' && !member?.isVirtual", idx);
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(idx);
  });

  it('onClick은 onViewInReport를 그대로 부른다(따로 값을 안 만듦 — AiMeasureHub가 종류를 이미 앎)', () => {
    const idx = src.indexOf('📊 결과리포트에서 보기');
    const buttonStart = src.lastIndexOf('<button', idx);
    const buttonArea = src.slice(buttonStart, idx);
    expect(buttonArea).toContain('onClick={onViewInReport}');
  });
});

describe('Report.jsx — 도착 시 pendingOpenKind로 자동 리포트 열기', () => {
  const src = readSrc('src', 'pages', 'Report.jsx');

  it('마운트 시 consumePendingVoiceTarget의 openReportKind를 pendingOpenKind에 담아둔다', () => {
    const start = src.indexOf('const pending = consumePendingVoiceTarget();');
    const end = src.indexOf('}, []);', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (pending?.openReportKind) setPendingOpenKind(pending.openReportKind);');
  });

  it('savedPostureReports가 준비되면(길이>0) postureViewerIdx를 0(최신)으로 열고 pendingOpenKind를 비운다', () => {
    const start = src.indexOf("if (pendingOpenKind !== 'posture') return;");
    const end = src.indexOf('}, [pendingOpenKind, savedPostureReports]);', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (savedPostureReports.length === 0) return;');
    expect(body).toContain('setPostureViewerIdx(0);');
    expect(body).toContain('setPendingOpenKind(null);');
  });

  it('savedRomReports도 같은 방식으로 처리한다(posture 패턴 그대로 확장)', () => {
    const start = src.indexOf("if (pendingOpenKind !== 'rom') return;");
    const end = src.indexOf('}, [pendingOpenKind, savedRomReports]);', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('if (savedRomReports.length === 0) return;');
    expect(body).toContain('setRomViewerIdx(0);');
    expect(body).toContain('setPendingOpenKind(null);');
  });

  it('gait/jump은 같은 목록(savedReports)을 kind로 구분해서 찾는다(단순 0번이 아님)', () => {
    const gaitStart = src.indexOf("if (pendingOpenKind !== 'gait') return;");
    const gaitEnd = src.indexOf('}, [pendingOpenKind, savedReports]);', gaitStart);
    const gaitBody = src.slice(gaitStart, gaitEnd);
    expect(gaitStart).toBeGreaterThan(-1);
    expect(gaitBody).toContain("savedReports.findIndex((r) => r.kind !== 'jump')");
    expect(gaitBody).toContain('setViewerIdx(idx);');

    const jumpStart = src.indexOf("if (pendingOpenKind !== 'jump') return;");
    const jumpEnd = src.indexOf('}, [pendingOpenKind, savedReports]);', jumpStart);
    const jumpBody = src.slice(jumpStart, jumpEnd);
    expect(jumpStart).toBeGreaterThan(gaitStart);
    expect(jumpBody).toContain("savedReports.findIndex((r) => r.kind === 'jump')");
  });

  it('savedLiftingSessions도 같은 방식으로 처리한다', () => {
    const start = src.indexOf("if (pendingOpenKind !== 'lifting') return;");
    const end = src.indexOf('}, [pendingOpenKind, savedLiftingSessions]);', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('if (savedLiftingSessions.length === 0) return;');
    expect(body).toContain('setLiftingViewerIdx(0);');
  });

  it('이 effect는 savedPostureReports 정의(useMemo) 이후에 위치한다(정의 전에 참조하는 순서 버그 방지)', () => {
    const memoIdx = src.indexOf('const savedPostureReports = useMemo(');
    const effectIdx = src.indexOf("if (pendingOpenKind !== 'posture') return;");
    expect(memoIdx).toBeGreaterThan(-1);
    expect(effectIdx).toBeGreaterThan(memoIdx);
  });
});

describe('RomMeasure.jsx — "결과리포트에서 보기" 버튼(PostureMeasure.jsx와 동일 패턴)', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'RomMeasure.jsx');

  it('onViewInReport prop을 받는다', () => {
    expect(src).toMatch(/RomMeasure\(\{ member, onSave, onBack, onViewInReport \}\)/);
  });

  it('저장 완료 + 등록회원일 때만 버튼이 뜬다', () => {
    const idx = src.indexOf('📊 결과리포트에서 보기');
    expect(idx).toBeGreaterThan(-1);
    const guardStart = src.lastIndexOf("saveState === 'saved' && !member?.isVirtual", idx);
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(idx);
  });
});

// [리포트 통합 2026-08-09] gait/jump/lifting/stance/squat — 이 다섯은 인라인
// 리포트 화면(측정 직후 바로 이어지는, 페이지 이동 없는 결과 표시)을 이미
// 갖고 있어서 posture/rom과 배선 위치가 다르다: "저장 완료 상태"가 아니라
// "리포트 화면(view==='report' 등)에 들어와 있는 상태"가 버튼 노출 조건이다
// (그 화면 자체가 이미 저장된 결과를 보여주고 있으므로).
describe('GaitAnalysisHub.jsx / JumpAnalysisHub.jsx / BarbellLiftingHub.jsx / StanceAnalysisHub.jsx / SquatAnalysisHub.jsx — "결과리포트에서 보기" 버튼', () => {
  const FILES = [
    ['ai-measure/menus/GaitAnalysisHub.jsx', 'GaitAnalysisHub'],
    ['ai-measure/menus/JumpAnalysisHub.jsx', 'JumpAnalysisHub'],
    ['ai-measure/menus/BarbellLiftingHub.jsx', 'BarbellLiftingHub'],
    ['ai-measure/menus/StanceAnalysisHub.jsx', 'StanceAnalysisHub'],
    ['ai-measure/menus/SquatAnalysisHub.jsx', 'SquatAnalysisHub'],
  ];

  it.each(FILES)('%s: onViewInReport prop을 받는다', (relPath) => {
    const src = readSrc('src', ...relPath.split('/'));
    expect(src).toContain('onViewInReport');
  });

  it.each(FILES)('%s: 미등록회원이면 버튼을 안 보여준다', (relPath) => {
    const src = readSrc('src', ...relPath.split('/'));
    const idx = src.indexOf('📊 결과리포트에서 보기');
    expect(idx).toBeGreaterThan(-1);
    const guardStart = src.lastIndexOf('!member?.isVirtual', idx);
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(idx);
  });

  it.each(FILES)('%s: onClick은 onViewInReport를 그대로 부른다', (relPath) => {
    const src = readSrc('src', ...relPath.split('/'));
    const idx = src.indexOf('📊 결과리포트에서 보기');
    const buttonStart = src.lastIndexOf('<button', idx);
    const buttonArea = src.slice(buttonStart, idx);
    expect(buttonArea).toContain('onClick={onViewInReport}');
  });
});

describe('AiMeasureHub.jsx — onViewInReport를 모든 측정 컴포넌트에 공통으로 넘긴다', () => {
  const src = readSrc('src', 'ai-measure', 'AiMeasureHub.jsx');

  it('제네릭 렌더 블록(<Comp>)에서 한 곳에만 배선한다 — 측정 종류마다 따로 안 함', () => {
    expect(src).toContain('onViewInReport={() => viewInReport(active.id)}');
    // 이 한 줄이 gait/jump/posture/rom/lifting/stance/squat 전부를 커버한다
    // (active.id가 종류를 결정) — 종류별 분기 코드가 여기 새로 생기지 않았는지.
    const occurrences = (src.match(/onViewInReport=\{/g) || []).length;
    expect(occurrences).toBe(1);
  });
});
