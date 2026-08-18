// 자비스 로드맵 축3(자동 업데이터) 첫 실물 — MomiAutoNote.jsx 배선 확인.
// 이 프로젝트는 vitest 환경이 'node'라 jsdom 기반 실제 마운트 테스트 대신,
// Settings.jsx(축1 무결성검사)·CombinedAssessmentPanel.jsx(축1 통합분석)와
// 동일한 정적 소스 패턴 테스트 관례를 따른다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('MomiAutoNote.jsx — 축3 자동 트리거 배선', () => {
  const src = readSrc('src', 'components', 'report', 'MomiAutoNote.jsx');

  it('report에 이미 momiNote가 있으면 그걸로 초기화한다(재호출 방지)', () => {
    expect(src).toContain('useState(report?.momiNote');
  });

  it('useEffect 안에서 버튼 클릭 없이 askMomi를 자동 호출한다', () => {
    const effectStart = src.indexOf('useEffect(() => {');
    const effectEnd = src.indexOf('}, [report?.id, member?.id]);');
    const effectBody = src.slice(effectStart, effectEnd);
    expect(effectBody).toContain('askMomi(');
    expect(effectBody).not.toMatch(/onClick/); // 버튼 트리거가 아니라 마운트 시 자동 트리거여야 함
  });

  it('리포트·원본 버전별 중복 호출을 막는 가드가 있다', () => {
    expect(src).toContain('attemptedKeyRef');
    expect(src).toContain('if (attemptedKeyRef.current === requestKey) return;');
    expect(src).toContain('MOMI_PROMPT_VERSION');
  });

  it('생성된 노트를 onSaved 콜백으로 영속 저장한다', () => {
    expect(src).toContain('onSaved');
    expect(src).toContain('momiNote: saved');
  });

  it('실패해도 조용히 넘어간다(리포트 열람 자체를 막지 않음 — try/catch로 감싸짐)', () => {
    expect(src).toContain('.catch((e) => {');
    expect(src).toContain("setError(e.message || '모미 노트를 만드는 중 문제가 생겼어요.')");
  });
});

describe('PostureReport.jsx — MomiAutoNote 연결 확인', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'PostureReport.jsx');

  it("kind='posture'로 MomiAutoNote를 렌더하고, updatePostureReport로 저장한다", () => {
    expect(src).toContain("from '../../components/report/MomiAutoNote.jsx'");
    expect(src).toContain('kind="posture"');
    expect(src).toContain('aiStore.updatePostureReport(member.id, report.id, patch)');
  });
});

// [Axis3 확장 2026-08-08] MomiAutoNote를 나머지 4개 리포트 타입(ROM·보행·점프·리프팅)
// 에도 연결. gait_reports 컬렉션은 gait/jump kind를 공유하므로 둘 다 updateGaitReport를
// 쓰고, VBT/1RM(lifting)은 전용 컬렉션이 없어 새로 추가한 updateSession을 쓴다.
describe('RomReport.jsx — MomiAutoNote 연결 확인', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'RomReport.jsx');

  it("kind='rom'으로 MomiAutoNote를 렌더하고, updateRomReport로 저장한다", () => {
    expect(src).toContain("from '../../components/report/MomiAutoNote.jsx'");
    expect(src).toContain('kind="rom"');
    expect(src).toContain('aiStore.updateRomReport(');
  });
});

describe('GaitReportDashboard.jsx — MomiAutoNote 연결 확인', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'GaitReportDashboard.jsx');

  it("kind='gait'로 MomiAutoNote를 렌더하고, updateGaitReport로 저장한다", () => {
    expect(src).toContain("from '../../components/report/MomiAutoNote.jsx'");
    expect(src).toContain('<MomiAutoNote kind="gait"');
    expect(src).toContain('aiStore.updateGaitReport(');
  });
});

describe('JumpReportDashboard.jsx — MomiAutoNote 연결 확인', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'JumpReportDashboard.jsx');

  it("kind='jump'로 MomiAutoNote를 렌더하고, gait_reports를 공유하는 updateGaitReport로 저장한다", () => {
    expect(src).toContain("from '../../components/report/MomiAutoNote.jsx'");
    expect(src).toContain('<MomiAutoNote kind="jump"');
    expect(src).toContain('aiStore.updateGaitReport(');
  });
});

describe('LiftingReportDashboard.jsx — MomiAutoNote 연결 확인', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'LiftingReportDashboard.jsx');

  it("kind='lifting'으로 MomiAutoNote를 렌더하고, 세션 기반이라 updateSession으로 저장한다", () => {
    expect(src).toContain("from '../../components/report/MomiAutoNote.jsx'");
    expect(src).toContain('<MomiAutoNote kind="lifting"');
    expect(src).toContain('aiStore.updateSession(');
  });
});

// [Axis3 확장 2026-08-08 계속] SLST(StanceAnalysisHub)·스쿼트(SquatAnalysisHub)는
// 별도 Report 컴포넌트가 아니라 측정+결과를 한 화면에서 다루는 "Hub" 패턴이라
// view==='report' 블록 안에 있다는 점만 다르고, 나머지는 동일한 패턴.
// [리포트 통합 2026-08-09] SLST의 리포트 표시(MomiAutoNote 포함)는
// StanceReportDashboard.jsx로 뽑혀 나갔다(Report.jsx 뷰어에서도 재사용하기
// 위함) — 이제 그 컴포넌트 자체가 "리포트 화면"이라 view==='report' 가드는
// 없다(애초에 report가 있어야만 이 컴포넌트가 렌더됨).
describe('StanceReportDashboard.jsx — MomiAutoNote 연결 확인(SLST)', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'StanceReportDashboard.jsx');

  it("kind='stance'로 MomiAutoNote를 렌더하고, updateSession으로 저장한다", () => {
    expect(src).toContain("from '../../components/report/MomiAutoNote.jsx'");
    expect(src).toContain('<MomiAutoNote kind="stance"');
    expect(src).toContain('aiStore.updateSession(');
  });

  it('report가 없으면 아무 것도 렌더하지 않는다(측정 중엔 안 뜸)', () => {
    expect(src).toContain('if (!report) return null;');
  });
});

describe('SquatReportDashboard.jsx — MomiAutoNote 연결 확인', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'SquatReportDashboard.jsx');

  it("kind='squat'로 MomiAutoNote를 렌더하고, updateSession으로 저장한다", () => {
    expect(src).toContain("from '../../components/report/MomiAutoNote.jsx'");
    expect(src).toContain('<MomiAutoNote kind="squat"');
    expect(src).toContain('aiStore.updateSession(');
  });

  it('report가 없으면 아무 것도 렌더하지 않는다(측정 중엔 안 뜸)', () => {
    expect(src).toContain('if (!report) return null;');
  });
});

describe('demoData.js — updateSession (세션 기반 리포트용 신규 저장 함수)', () => {
  const src = readSrc('src', 'demoData.js');

  it('updateGaitReport/updateRomReport와 동일한 낙관적 갱신 + 롤백 패턴을 따른다', () => {
    const start = src.indexOf('updateSession: async (mid, sid, patch) => {');
    const end = src.indexOf('\n  },', start);
    const body = src.slice(start, end);
    expect(body).toContain('cache.ai[mid] = (cache.ai[mid] || []).map(');
    expect(body).toContain("data: { ...(s.data || {}), ...nextPatch }");
    expect(body).toContain("fbSet('ai', sid,");
    expect(body).toContain('catch (e) { cache.ai[mid] = prev;');
  });
});

// MomiAutoNote 자체의 순수 로직 부분(초기 렌더 시 무엇을 보여줄지 결정하는 조건)은
// 컴포넌트 밖으로 뽑혀있지 않아 직접 단위테스트하기 어렵다 — 대신 momiService.js의
// askMomi가 report/member 누락 시 명확히 실패한다는 계약은 momi_service.test.js에서
// 이미 검증하고 있고, MomiAutoNote는 그 계약 위에서 report?.id/member?.id가 없으면
// 아예 useEffect 본문을 실행하지 않도록 방어한다.
describe('MomiAutoNote.jsx — report/member 누락 방어', () => {
  const src = readSrc('src', 'components', 'report', 'MomiAutoNote.jsx');

  it('report.id 또는 member.id가 없으면 아무 것도 렌더하지 않는다', () => {
    expect(src).toContain('if (!report?.id || !member?.id) return null;');
    expect(src).toContain('if (!report?.id || !member?.id) return;');
  });
});

// [Axis4 확장 2026-08-08] "계속 진행해줘"로 이어서 — MomiInsightPanel(후속 질문
// 대화창)도 MomiAutoNote와 같은 7개 리포트 타입에 전부 연결. onSaved가 필요 없어
// (자동 저장 아님) 배선이 더 단순 — kind/report/member 3개 props만 맞으면 된다.
describe('MomiInsightPanel.jsx가 MomiAutoNote와 같은 7개 리포트 타입에 전부 연결됐다', () => {
  const cases = [
    { file: 'PostureReport.jsx', kind: 'posture' },
    { file: 'RomReport.jsx', kind: 'rom' },
    { file: 'GaitReportDashboard.jsx', kind: 'gait' },
    { file: 'JumpReportDashboard.jsx', kind: 'jump' },
    { file: 'LiftingReportDashboard.jsx', kind: 'lifting' },
    { file: 'StanceReportDashboard.jsx', kind: 'stance' },
    { file: 'SquatReportDashboard.jsx', kind: 'squat' },
  ];

  for (const { file, kind } of cases) {
    it(`${file} — kind="${kind}"로 MomiInsightPanel을 임포트하고 렌더한다`, () => {
      const src = readSrc('src', 'ai-measure', 'menus', file);
      expect(src).toContain("import MomiInsightPanel from '../../components/report/MomiInsightPanel.jsx';");
      expect(src).toContain(`<MomiInsightPanel kind="${kind}"`);
    });

    it(`${file} — MomiAutoNote와 MomiInsightPanel이 같은 member를 공유한다(따로 계산 안 함)`, () => {
      const src = readSrc('src', 'ai-measure', 'menus', file);
      const autoNoteIdx = src.indexOf(`<MomiAutoNote kind="${kind}"`);
      const insightIdx = src.indexOf(`<MomiInsightPanel kind="${kind}"`);
      expect(autoNoteIdx).toBeGreaterThan(-1);
      expect(insightIdx).toBeGreaterThan(autoNoteIdx); // MomiAutoNote 바로 다음에 위치
    });
  }
});
