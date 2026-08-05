// slst_squat_no_height_required.test.js
// ════════════════════════════════════════════════════════════════════════
//  2026-08-02: SLST(한다리서기)와 오버헤드 딥 스쿼트는 더 이상 키(신장) 입력을
//  요구하지 않는다 — 두 판정 모두 각도·비율·유지시간 기반이라 cm 환산이
//  필수가 아니다(SLST의 흔들림-cm 판정은 원래도 있으면 좋은 부가 신호였을 뿐,
//  없어도 나머지 재현성 신호로 정상 판정된다). "키가 필요합니다" 게이트가
//  4개 측정 화면에 남아있지 않은지 소스 레벨로 고정한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const files = [
  'ai-measure/menus/StanceLiveAnalysis.jsx',
  'ai-measure/menus/StanceUploadAnalysis.jsx',
  'ai-measure/menus/SquatLiveAnalysis.jsx',
  'ai-measure/menus/SquatUploadAnalysis.jsx',
];

describe.each(files)('%s — 키 입력 게이트가 남아있지 않다', (path) => {
  const src = readFileSync(join(process.cwd(), 'src', path), 'utf8');

  it('heightCm/needHeight/applyHeight/키가 필요합니다 문구가 전혀 없다', () => {
    expect(src).not.toMatch(/heightCm/);
    expect(src).not.toMatch(/needHeight/);
    expect(src).not.toMatch(/applyHeight/);
    expect(src).not.toMatch(/키가 필요합니다/);
  });

  it('StandingCalibrator를 빈 옵션으로 생성한다(높이 없이도 기준선/각도 판정은 그대로 동작)', () => {
    expect(src).toMatch(/new StandingCalibrator\(\{\}\)/);
  });
});
