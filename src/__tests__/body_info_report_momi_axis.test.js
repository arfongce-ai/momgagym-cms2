// [Axis3/4 확장 2026-08-11] BodyInfoReport.jsx에 MomiInsightPanel(축4, "물어보기")을
// 연결한 배선 확인 + MomiInsightPanel.jsx 자체가 인라인 style(하드코딩 라이트 전용)
// 대신 dark: variant를 쓰는지 확인(라이트모드 작업 중 발견한 별도 버그 수정분).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('BodyInfoReport.jsx — MomiInsightPanel(축4) 연결', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'BodyInfoReport.jsx');

  it('MomiInsightPanel을 import한다', () => {
    expect(src).toMatch(/import MomiInsightPanel from ['"]\.\.\/\.\.\/components\/report\/MomiInsightPanel(\.jsx)?['"]/);
  });

  it('kind="body"로 렌더하고, report엔 result를 그대로 넘긴다(개별 문서 id가 없어 result 자체가 리포트 데이터)', () => {
    expect(src).toContain('<MomiInsightPanel kind="body" report={result} member={member} />');
  });

  it('MomiAutoNote(축3)는 아직 연결하지 않았다 — report.id 기반 저장 방식이라 신체정보(기록 목록 구조)엔 안 맞아 별도 확인 후 진행하기로 함(의도적 보류, 회귀 방지용으로 명시)', () => {
    // 왜 안 넣었는지 설명하는 주석엔 "MomiAutoNote"라는 단어 자체는 나올 수 있으니
    // (바로 위 import 옆 주석 참고), 실제 JSX로 렌더하는지(<MomiAutoNote 태그)만 검사.
    expect(src).not.toContain('<MomiAutoNote');
  });

  it('헤더(UnifiedReportHeader) 바로 다음에 온다(다른 7종 리포트와 동일 위치)', () => {
    const headerEnd = src.indexOf('onClose={onClose}\n        />');
    const panelIdx = src.indexOf('<MomiInsightPanel');
    expect(headerEnd).toBeGreaterThan(-1);
    expect(panelIdx).toBeGreaterThan(headerEnd);
  });
});

describe('MomiInsightPanel.jsx — 라이트모드 대응(인라인 style 제거)', () => {
  const src = readSrc('src', 'components', 'report', 'MomiInsightPanel.jsx');

  it('더 이상 하드코딩 인라인 style을 쓰지 않는다(예전엔 style={{background:"#f9fafb"}} 식으로 항상 밝은 색 고정 — 다크모드에서 튀는 원인이었음)', () => {
    // 위 파일 헤더 주석에 그 옛날 방식을 예시로 설명하느라 "style={{"라는
    // 문자열 자체는 주석에 남아있을 수 있다 — 실제 JSX 태그 속성으로 쓰이는
    // 경우(줄바꿈/공백 없이 태그명 바로 뒤에 오는 형태)만 정확히 검사한다.
    const jsxStyleAttr = /<\w+\s[^>]*\bstyle=\{\{/;
    expect(src).not.toMatch(jsxStyleAttr);
  });

  it('주요 배경·글자색이 dark: variant를 쓴다', () => {
    expect(src).toContain('dark:bg-slate-700');
    expect(src).toContain('dark:bg-slate-800');
    expect(src).toContain('dark:text-slate-100');
  });

  it('버튼 클릭·질문 전송 등 실제 동작 로직(handleAsk/handleFollowUp)은 그대로다(색만 바꿨고 기능은 안 건드림)', () => {
    expect(src).toContain('const handleAsk = async () => {');
    expect(src).toContain('const handleFollowUp = async () => {');
    expect(src).toContain("askMomi({ kind, report, member })");
    expect(src).toContain('askMomi({ kind, report, member, question: q, history })');
  });
});
