import { describe, expect, it, vi } from 'vitest';

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
});
