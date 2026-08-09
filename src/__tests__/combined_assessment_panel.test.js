import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../demoData.js', () => ({
  store: {},
  aiStore: {
    ensurePostureReports: vi.fn().mockResolvedValue([]),
    ensureRomReports: vi.fn().mockResolvedValue([]),
    ensureGaitReports: vi.fn().mockResolvedValue([]),
    ensureSessions: vi.fn().mockResolvedValue([]),
  },
}));

import CombinedAssessmentPanel from '../components/report/CombinedAssessmentPanel.jsx';

describe('CombinedAssessmentPanel', () => {
  it('컴포넌트가 함수로 정상 임포트된다(문법 확인)', () => {
    expect(typeof CombinedAssessmentPanel).toBe('function');
  });

  // [축1] 룰 기반 종합 분석 결과가 나온 뒤, 모미에게 통합 가이드를 요청하는 버튼이
  // askMomiCombined로 연결돼 있는지 소스 패턴으로 확인한다.
  it('모미 통합 가이드 버튼이 askMomiCombined를 호출한다', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'report', 'CombinedAssessmentPanel.jsx'),
      'utf8'
    );
    expect(src).toContain("from '../../services/momiService'");
    expect(src).toContain('askMomiCombined');
    expect(src).toContain('모미에게 통합 가이드 요청');
  });
});
