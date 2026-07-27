import { describe, expect, it } from 'vitest';
import StanceUploadAnalysis from '../ai-measure/menus/StanceUploadAnalysis';
import StanceAnalysisHub from '../ai-measure/menus/StanceAnalysisHub';

describe('stance UI 컴포넌트 임포트/문법 스모크 테스트', () => {
  it('StanceUploadAnalysis는 함수 컴포넌트로 정상 임포트된다', () => {
    expect(typeof StanceUploadAnalysis).toBe('function');
  });
  it('StanceAnalysisHub는 함수 컴포넌트로 정상 임포트된다', () => {
    expect(typeof StanceAnalysisHub).toBe('function');
  });
});
