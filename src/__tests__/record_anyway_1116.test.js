import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { broadJumpDistanceCm } from '../ai-measure/core/jumpBiomechanics';

const read = (p) => fs.readFileSync(new URL(`../ai-measure/${p}`, import.meta.url), 'utf8');

describe('2026-11-16 이상 데이터도 일단 기록', () => {
  it('허브는 무효 측정을 throw 하지 않고 needsReview 로 저장한다', () => {
    const src = read('AiMeasureHub.jsx');
    expect(src).not.toContain("throw new Error('무효 측정은 저장되지 않습니다");
    expect(src).not.toContain("측정값이 비정상이라 저장되지 않습니다");
    expect(src).toContain('needsReview: true');
    expect(src).toContain('if (isJump) {');
  });
  it('자동저장은 valid 여부로 막지 않는다', () => {
    expect(read('menus/GaitRunningAnalysis.jsx')).not.toContain('if (reportData.valid !== true) return;');
    expect(read('menus/JumpPrecisionAnalysis.jsx')).not.toContain('reportData.valid !== true || !saveToFirebase');
  });
  it('자세 측정은 카운트다운 끝에 전신 재검사로 촬영을 거부하지 않는다', () => {
    const src = read('menus/PostureMeasure.jsx');
    expect(src).not.toContain('!isFullBodyVisible(live) || !stillStable');
    expect(src).not.toContain('전신(어깨·골반·무릎·발목)이 모두 보여야 강제 촬영');
  });
});

describe('제자리멀리뛰기 가로 거리 보정', () => {
  it('aspect 미지정 시 기존 값과 동일', () => {
    expect(broadJumpDistanceCm(0.8, 0.2, 200)).toBe(120);
  });
  it('16:9 가로에서는 가로세로비만큼 환산', () => {
    expect(broadJumpDistanceCm(0.8, 0.2, 100, 16 / 9)).toBe(106.7);
  });
});

describe('스프린트 녹화 시간 표시', () => {
  it('SprintLiveAnalysis 가 bigTimeMs 를 넘긴다', () => {
    expect(read('menus/SprintLiveAnalysis.jsx')).toContain('bigTimeMs');
    expect(read('core/recordingOverlay.js')).toContain('bigTimeMs');
  });
});
