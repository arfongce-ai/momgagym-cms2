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

  it('같은 마운트 동안 중복 호출을 막는 가드(triedRef)가 있다', () => {
    expect(src).toContain('triedRef');
    expect(src).toContain('if (note || triedRef.current) return;');
  });

  it('생성된 노트를 onSaved 콜백으로 영속 저장한다', () => {
    expect(src).toContain('onSaved');
    expect(src).toContain('momiNote: saved');
  });

  it('실패해도 조용히 넘어간다(리포트 열람 자체를 막지 않음 — try/catch로 감싸짐)', () => {
    expect(src).toContain('.catch((e) => setError(');
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
