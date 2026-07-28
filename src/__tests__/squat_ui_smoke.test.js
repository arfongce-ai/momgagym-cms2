import { describe, expect, it } from 'vitest';
import SquatUploadAnalysis from '../ai-measure/menus/SquatUploadAnalysis';
import SquatLiveAnalysis from '../ai-measure/menus/SquatLiveAnalysis';
import SquatAnalysisHub from '../ai-measure/menus/SquatAnalysisHub';

describe('squat UI 컴포넌트 임포트/문법 스모크 테스트', () => {
  it('SquatUploadAnalysis는 함수 컴포넌트로 정상 임포트된다', () => {
    expect(typeof SquatUploadAnalysis).toBe('function');
  });
  it('SquatLiveAnalysis는 함수 컴포넌트로 정상 임포트된다', () => {
    expect(typeof SquatLiveAnalysis).toBe('function');
  });
  it('SquatAnalysisHub는 함수 컴포넌트로 정상 임포트된다', () => {
    expect(typeof SquatAnalysisHub).toBe('function');
  });
});
