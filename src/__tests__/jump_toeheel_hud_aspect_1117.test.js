import { describe, it, expect } from 'vitest';
import { measurePointX, measureStartX, broadJumpDistanceCm } from '../ai-measure/core/jumpBiomechanics';
import fs from 'fs';

const lm = (() => { const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  a[29].x = 0.30; a[30].x = 0.30; a[31].x = 0.40; a[32].x = 0.40; a[27].x = 0.33; a[28].x = 0.33; return a; })();

describe('제자리 멀리뛰기 표준 기록법(출발 발끝 → 착지 뒤꿈치)', () => {
  it('출발선은 발끝, 착지는 뒤꿈치 x를 쓴다', () => {
    expect(measureStartX(lm, 'toeheel')).toBeCloseTo(0.40);
    expect(measurePointX(lm, 'toeheel')).toBeCloseTo(0.30);
  });
  it('다른 부위는 출발·착지가 같은 점', () => {
    expect(measureStartX(lm, 'heel')).toBeCloseTo(measurePointX(lm, 'heel'));
    expect(measureStartX(lm, 'feet')).toBeCloseTo(measurePointX(lm, 'feet'));
  });
});

describe('화면 HUD 거리 = 저장 거리', () => {
  it('가로세로비를 넣어야 같은 값이 된다(16:9 → 1.78배)', () => {
    const noAspect = broadJumpDistanceCm(0.8, 0.2, 400, 1);
    const withAspect = broadJumpDistanceCm(0.8, 0.2, 400, 16 / 9);
    expect(withAspect / noAspect).toBeCloseTo(16 / 9, 1);
  });
  it('JumpPrecisionAnalysis의 두 환산 호출 모두 frameAspect를 넘긴다', () => {
    const src = fs.readFileSync('src/ai-measure/menus/JumpPrecisionAnalysis.jsx', 'utf8');
    expect((src.match(/frameAspect: tracker\.frameAspect/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
