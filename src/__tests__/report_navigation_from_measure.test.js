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

  it('savedStanceSessions도 같은 방식으로 처리한다(SLST — 리포트 뷰어 신설)', () => {
    const start = src.indexOf("if (pendingOpenKind !== 'stance') return;");
    const end = src.indexOf('}, [pendingOpenKind, savedStanceSessions]);', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('if (savedStanceSessions.length === 0) return;');
    expect(body).toContain('setStanceViewerIdx(0);');
  });

  it('savedSquatSessions도 같은 방식으로 처리한다(스쿼트 — 리포트 뷰어 신설)', () => {
    const start = src.indexOf("if (pendingOpenKind !== 'squat') return;");
    const end = src.indexOf('}, [pendingOpenKind, savedSquatSessions]);', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('if (savedSquatSessions.length === 0) return;');
    expect(body).toContain('setSquatViewerIdx(0);');
  });

  it('이 effect는 savedPostureReports 정의(useMemo) 이후에 위치한다(정의 전에 참조하는 순서 버그 방지)', () => {
    const memoIdx = src.indexOf('const savedPostureReports = useMemo(');
    const effectIdx = src.indexOf("if (pendingOpenKind !== 'posture') return;");
    expect(memoIdx).toBeGreaterThan(-1);
    expect(effectIdx).toBeGreaterThan(memoIdx);
  });
});

// [리포트 통합 2026-08-09] SLST — posture/rom/gait/jump/lifting과 달리 이제까지
// Report.jsx에서 저장된 리포트를 다시 볼 방법 자체가 없었다(뷰어가 아예 없었음).
// StanceReportDashboard.jsx(측정 화면에서 뽑아낸 재사용 컴포넌트)를 그대로 가져와
// 뷰어를 신설한다 — 재구현 아님.
describe('Report.jsx — SLST 저장된 리포트 뷰어 신설', () => {
  const src = readSrc('src', 'pages', 'Report.jsx');

  it('StanceReportDashboard를 lazy import한다(다른 리포트 컴포넌트와 동일 패턴)', () => {
    expect(src).toContain(
      "const StanceReportDashboard = lazy(() => import('../ai-measure/menus/StanceReportDashboard'));"
    );
  });

  it('savedStanceSessions는 lifting과 완전히 같은 방식으로 만든다(전용 컬렉션 없이 세션에서 menu 필터)', () => {
    const start = src.indexOf('const savedStanceSessions = useMemo(');
    const end = src.indexOf('}, [member, dataReady]);', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("filter((s) => s.menu === 'stance')");
  });

  it('stanceViewerIdx 상태와 뷰어 모달을 갖고 있다', () => {
    expect(src).toContain('const [stanceViewerIdx, setStanceViewerIdx] = useState(null);');
    expect(src).toContain('stanceViewerIdx != null && savedStanceSessions[stanceViewerIdx]');
  });

  it('저장된 리포트를 다시 보는 중이라 onRemeasure(다시 측정)는 넘기지 않는다', () => {
    const start = src.indexOf('<StanceReportDashboard');
    const end = src.indexOf('/>', start);
    const body = src.slice(start, end);
    expect(body).not.toContain('onRemeasure');
    expect(body).toContain('onClose={() => setStanceViewerIdx(null)}');
  });
});

// [리포트 통합 2026-08-09] 오버헤드 딥 스쿼트 — SLST와 완전히 같은 이유로,
// 이제까지 Report.jsx에서 저장된 리포트를 다시 볼 방법이 없었다. 뷰어 신설.
describe('Report.jsx — 오버헤드 딥 스쿼트 저장된 리포트 뷰어 신설', () => {
  const src = readSrc('src', 'pages', 'Report.jsx');

  it('SquatReportDashboard를 lazy import한다', () => {
    expect(src).toContain(
      "const SquatReportDashboard = lazy(() => import('../ai-measure/menus/SquatReportDashboard'));"
    );
  });

  it('savedSquatSessions는 stance/lifting과 완전히 같은 방식으로 만든다', () => {
    const start = src.indexOf('const savedSquatSessions = useMemo(');
    const end = src.indexOf('}, [member, dataReady]);', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("filter((s) => s.menu === 'squat')");
  });

  it('squatViewerIdx 상태와 뷰어 모달을 갖고 있다', () => {
    expect(src).toContain('const [squatViewerIdx, setSquatViewerIdx] = useState(null);');
    expect(src).toContain('squatViewerIdx != null && savedSquatSessions[squatViewerIdx]');
  });

  it('저장된 리포트를 다시 보는 중이라 onRemeasure(다시 측정)는 넘기지 않는다', () => {
    const start = src.indexOf('<SquatReportDashboard');
    const end = src.indexOf('/>', start);
    const body = src.slice(start, end);
    expect(body).not.toContain('onRemeasure');
    expect(body).toContain('onClose={() => setSquatViewerIdx(null)}');
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
  // onViewInReport prop 자체는 항상 "측정 화면(Hub)" 쪽이 받아서 리포트
  // 컴포넌트로 넘겨준다(AiMeasureHub.jsx가 Hub에 넘기므로).
  const FILES = [
    ['ai-measure/menus/GaitAnalysisHub.jsx', 'GaitAnalysisHub'],
    ['ai-measure/menus/JumpAnalysisHub.jsx', 'JumpAnalysisHub'],
    ['ai-measure/menus/BarbellLiftingHub.jsx', 'BarbellLiftingHub'],
    ['ai-measure/menus/StanceAnalysisHub.jsx', 'StanceAnalysisHub'],
    ['ai-measure/menus/SquatAnalysisHub.jsx', 'SquatAnalysisHub'],
  ];

  // 버튼 자체가 실제로 그려지는 파일 — gait/jump/lifting은 Hub 파일에 인라인,
  // stance는 [리포트 통합 2026-08-09]로 StanceReportDashboard.jsx(Report.jsx
  // 뷰어에서도 재사용하는 독립 컴포넌트)로 뽑혀 나갔다. squat도 같은 방식으로
  // 뽑을 예정(현재는 아직 SquatAnalysisHub.jsx에 인라인).
  const BUTTON_FILES = [
    ['ai-measure/menus/GaitAnalysisHub.jsx', 'GaitAnalysisHub'],
    ['ai-measure/menus/JumpAnalysisHub.jsx', 'JumpAnalysisHub'],
    ['ai-measure/menus/BarbellLiftingHub.jsx', 'BarbellLiftingHub'],
    ['ai-measure/menus/StanceReportDashboard.jsx', 'StanceReportDashboard'],
    ['ai-measure/menus/SquatReportDashboard.jsx', 'SquatReportDashboard'],
  ];

  it.each(FILES)('%s: onViewInReport prop을 받는다', (relPath) => {
    const src = readSrc('src', ...relPath.split('/'));
    expect(src).toContain('onViewInReport');
  });

  it.each(BUTTON_FILES)('%s: 미등록회원이면 버튼을 안 보여준다', (relPath) => {
    const src = readSrc('src', ...relPath.split('/'));
    const idx = src.indexOf('📊 결과리포트에서 보기');
    expect(idx).toBeGreaterThan(-1);
    const guardStart = src.lastIndexOf('!member?.isVirtual', idx);
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(idx);
  });

  it.each(BUTTON_FILES)('%s: onClick은 onViewInReport를 그대로 부른다', (relPath) => {
    const src = readSrc('src', ...relPath.split('/'));
    const idx = src.indexOf('📊 결과리포트에서 보기');
    const buttonStart = src.lastIndexOf('<button', idx);
    const buttonArea = src.slice(buttonStart, idx);
    expect(buttonArea).toContain('onClick={onViewInReport}');
  });
});

// [리포트 통합 2026-08-09] StanceAnalysisHub.jsx는 리포트 표시를 통째로
// StanceReportDashboard.jsx에 위임한다 — GaitAnalysisHub.jsx가
// GaitReportDashboard.jsx에 위임하는 것과 같은 패턴.
describe('StanceAnalysisHub.jsx — StanceReportDashboard.jsx로 위임(회귀 방지)', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'StanceAnalysisHub.jsx');

  it('StanceReportDashboard를 import해서 쓴다', () => {
    expect(src).toContain("import StanceReportDashboard from './StanceReportDashboard';");
    expect(src).toContain('<StanceReportDashboard');
  });

  it('onClose(닫기)와 onRemeasure(다시 측정)를 분리해서 넘긴다', () => {
    const start = src.indexOf('<StanceReportDashboard');
    const end = src.indexOf('/>', start);
    const body = src.slice(start, end);
    expect(body).toContain('onClose={onBack}');
    expect(body).toContain('onRemeasure={backToMeasure}');
    expect(body).toContain('onViewInReport={onViewInReport}');
  });

  it('리포트 표시용 헬퍼(HoldTimeBar 등)를 더 이상 자체적으로 갖고 있지 않다(중복 구현 방지)', () => {
    expect(src).not.toContain('function HoldTimeBar');
    expect(src).not.toContain('function AngleBar');
  });
});

// [리포트 통합 2026-08-09] SquatAnalysisHub.jsx도 같은 방식으로
// SquatReportDashboard.jsx에 위임한다.
describe('SquatAnalysisHub.jsx — SquatReportDashboard.jsx로 위임(회귀 방지)', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'SquatAnalysisHub.jsx');

  it('SquatReportDashboard를 import해서 쓴다', () => {
    expect(src).toContain("import SquatReportDashboard from './SquatReportDashboard';");
    expect(src).toContain('<SquatReportDashboard');
  });

  it('onClose(닫기)와 onRemeasure(다시 측정)를 분리해서 넘긴다', () => {
    const start = src.indexOf('<SquatReportDashboard');
    const end = src.indexOf('/>', start);
    const body = src.slice(start, end);
    expect(body).toContain('onClose={onBack}');
    expect(body).toContain('onRemeasure={backToMeasure}');
    expect(body).toContain('onViewInReport={onViewInReport}');
  });

  it('리포트 표시용 헬퍼(MetricBar 등)를 더 이상 자체적으로 갖고 있지 않다(중복 구현 방지)', () => {
    expect(src).not.toContain('function MetricBar');
  });
});

describe('AiMeasureHub.jsx — onViewInReport를 모든 측정 컴포넌트에 공통으로 넘긴다', () => {
  const src = readSrc('src', 'ai-measure', 'AiMeasureHub.jsx');

  it('제네릭 렌더 블록(<Comp>)에서 한 곳에만 배선한다 — 측정 종류마다 따로 안 함', () => {
    expect(src).toContain('onViewInReport={() => viewInReport(active.id)}');
    // 이 한 줄이 gait/jump/posture/rom/lifting/stance/squat/body 전부를 커버한다
    // (active.id가 종류를 결정) — 종류별 분기 코드가 여기 새로 생기지 않았는지.
    const occurrences = (src.match(/onViewInReport=\{/g) || []).length;
    expect(occurrences).toBe(1);
  });
});

// [리포트 통합 2026-08-09] 신체정보 — 7개 중 유일하게 "열어줄 뷰어"가 필요 없는
// 케이스. 단일 리포트가 아니라 회원의 측정 캘린더(Report.jsx)에 누적되는
// 값이고, 그 화면이 이미 가장 최근 측정일을 기본으로 보여주므로(dailyGroups[0])
// 회원 선택만으로 충분하다 — Report.jsx 쪽 변경이 필요 없다(버튼만 추가).
describe('BodyInfoMeasure.jsx — "결과리포트에서 보기" 버튼(뷰어 오픈 로직 불필요)', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'BodyInfoMeasure.jsx');

  it('onViewInReport prop을 받는다', () => {
    expect(src).toContain('onViewInReport');
  });

  it('저장 완료(saveState===\'saved\') + 등록회원일 때만 버튼이 뜬다', () => {
    const idx = src.indexOf('📊 결과리포트에서 보기');
    expect(idx).toBeGreaterThan(-1);
    const guardStart = src.lastIndexOf("saveState === 'saved' && !isVirtual", idx);
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(idx);
  });

  it('전신측정(result 있음)·컨디션만 저장(result 없음) 두 경우 모두에서 뜬다(둘 다 saveState만 확인)', () => {
    // 버튼 조건이 result가 아니라 saveState만 보는지 — 컨디션만 저장해도
    // 캘린더엔 그대로 반영되므로 버튼이 나와야 한다.
    const start = src.indexOf('📊 결과리포트에서 보기');
    const guardLine = src.slice(src.lastIndexOf('{saveState', start), start);
    expect(guardLine).not.toContain('result &&');
  });

  it('onClick은 onViewInReport를 그대로 부른다', () => {
    const idx = src.indexOf('📊 결과리포트에서 보기');
    const buttonStart = src.lastIndexOf('<button', idx);
    const buttonArea = src.slice(buttonStart, idx);
    expect(buttonArea).toContain('onClick={onViewInReport}');
  });
});
