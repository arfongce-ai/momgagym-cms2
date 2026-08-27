import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// analyzeBody()의 grade(good/warn/bad) 판정을 SimpleResultReport가 기대하는
// status(normal/caution/risk) 모양으로 잘 바꾸는지 소스 레벨로 확인한다.
// (BodyInfoMeasure.jsx가 store/analyzeBody 등 여러 앱 의존성을 가져와서
//  풀 렌더 테스트 대신, 이 파일의 다른 테스트들과 같은 소스 스캔 방식을 쓴다.)
describe('신체정보 쉬운 버전 어댑터(buildBodyInfoSimpleSummary)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../ai-measure/menus/BodyInfoMeasure.jsx'),
    'utf-8'
  );

  it('grade(good/warn/bad)를 status(normal/caution/risk)로 매핑한다', () => {
    expect(src).toContain("good: 'normal'");
    expect(src).toContain("warn: 'caution'");
    expect(src).toContain("bad: 'risk'");
  });

  it('items가 없으면 null을 반환해 빈 카드가 뜨지 않는다', () => {
    expect(src).toContain('if (!result?.items?.length) return null;');
  });

  it('ReportActions에 simpleSummary/simpleMember를 전달한다', () => {
    expect(src).toContain('simpleSummary={buildBodyInfoSimpleSummary(result)}');
    expect(src).toContain('simpleMember={member}');
  });
});
