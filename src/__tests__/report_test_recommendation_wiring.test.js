import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...parts) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('결과리포트 회원별 추천 테스트 연결', () => {
  const reportSource = readSrc('src', 'pages', 'Report.jsx');
  const combinedSource = readSrc('src', 'components', 'report', 'CombinedAssessmentPanel.jsx');

  it('결과리포트가 AI 측정 홈과 같은 추천 엔진과 공용 패널을 사용한다', () => {
    expect(reportSource).toContain("import MemberTestRecommendationPanel from '../components/ai/MemberTestRecommendationPanel';");
    expect(reportSource).toContain("import { buildMemberTestRecommendations } from '../ai-measure/core/memberTestRecommendation';");
    expect(reportSource).toContain('<MemberTestRecommendationPanel');
  });

  it('신체정보와 7종 측정을 모두 추천 입력으로 전달한다', () => {
    for (const kind of ['body', 'posture', 'rom', 'gait', 'jump', 'lifting', 'stance', 'squat']) {
      expect(reportSource).toMatch(new RegExp(`\\b${kind}:`));
    }
  });

  it('추천 테스트를 선택하면 회원과 테스트를 지정해 AI 측정 화면으로 이동한다', () => {
    expect(reportSource).toContain('setPendingVoiceTarget({ memberName: member.name, testId });');
    expect(reportSource).toContain("navigate('/ai');");
  });

  it('측정 종합 분석 결과 안에도 같은 추천 결과를 표시한다', () => {
    expect(reportSource).toContain('recommendation={testRecommendation}');
    expect(combinedSource).toContain('통합 결과 기반 다음 측정');
    expect(combinedSource).toContain('recommendation.recommendations.map');
    expect(combinedSource).toContain('onStartTest?.(item.id)');
  });
});
