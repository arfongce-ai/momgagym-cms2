// jump_overflow_hidden.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: 점프 화면 최상위 컨테이너에 overflow-hidden이 없었다. 회전(90°/270°)이
//  걸리면 비디오 래퍼가 width:100vh/height:100vw로 뷰포트보다 커지는데(예:
//  가로 1920×세로 1080 키오스크에서 90도 회전 시 래퍼 높이가 1920px로 화면
//  높이 1080px보다 큼), 이걸 잘라낼 장치가 없어 페이지가 흘러넘쳤다
//  ("전체화면으로 잡힌다"로 보고된 증상). 다른 측정 화면(CameraStage 기반)은
//  .cam-stage 에 overflow:hidden 이 있어서 이 문제가 없었다 — 점프만 빠져 있었다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('JumpPrecisionAnalysis.jsx — 회전된 비디오가 뷰포트 밖으로 흘러넘치지 않는다', () => {
  it('카메라 뷰 최상위 컨테이너에 overflow-hidden이 있다', () => {
    const idx = src.indexOf("fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950 overflow-hidden");
    expect(idx).toBeGreaterThan(-1);
    // 회전 래퍼(100vh/100vw)보다 앞서 선언돼 있어야 실제로 그걸 잘라낸다.
    const rotWrapIdx = src.indexOf("100vh' : '100%'");
    expect(rotWrapIdx).toBeGreaterThan(idx);
  });
});
