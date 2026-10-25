import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const src = fs.readFileSync('src/ai-measure/AiMeasureHub.jsx', 'utf8');

describe('AiMeasureHub 저장 실패 전파', () => {
  it('바벨·스탠스·스쿼트도 저장 실패를 throw 해 호출부가 error 상태를 표시한다', () => {
    expect(src).toMatch(/isSprint \|\| isLifting \|\| isStance \|\| isSquat\) throw e/);
  });
  it('바벨·스탠스·스쿼트 페이로드도 sanitize(undefined·Blob 제거) 후 저장한다', () => {
    expect(src).toMatch(/measurementKind \|\| isLifting \|\| isStance \|\| isSquat/);
  });
});
