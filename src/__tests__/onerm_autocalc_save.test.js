import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const src = readFileSync('src/ai-measure/menus/OneRMEstimate.jsx', 'utf8');

describe('1RM 녹화 정지 → 자동 계산 → 카메라 안 저장', () => {
  it('카운트 정지(수동·60초 자동) 두 경로 모두 결과를 자동 계산한다', () => {
    expect(src.match(/autoCalc\(applyEngineResult\(\)\)/g)?.length).toBe(2);
  });
  it('카메라 화면에서 result 가 있으면 저장 버튼이 나온다', () => {
    expect(src).toMatch(/!counting && result && \(/);
  });
  it('저장 시 녹화 Blob 확정을 기다린다', () => {
    expect(src).toMatch(/recorderDoneRef/);
    expect(src).toMatch(/const save = async/);
  });
});
