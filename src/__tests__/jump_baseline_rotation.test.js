// jump_baseline_rotation.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: 점프 화면의 캘리브 기준선(초록 점선)이 카메라 회전(90°/270°) 상태에서
//  키오스크 화면에 세로선으로 보였다(보고된 증상). 원인: 90/270에서는 캔버스
//  전체가 바깥 래퍼에서 CSS로 통째로 돌아가는데, drawBaseline은 버퍼 로컬
//  좌표에서 "폭 전체를 가로지르는 가로선"만 그리고 있었다 — 회전 후 화면에는
//  세로선으로 보인다. drawSkeleton은 점 하나하나를 x·y 둘 다 매핑해서 이 회전과
//  무관하게 맞는데, drawBaseline은 축 하나뿐이라 rotationDeg를 몰랐던 게 문제.
//  2026-07-31: rotationDeg 인자를 받아 90/270에서는 버퍼 로컬 세로선으로 그리도록
//  수정 — 회전 후 화면에서 가로로 보인다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} 함수를 찾지 못함`).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  return src.slice(start, end);
}

describe('JumpPrecisionAnalysis.jsx — 캘리브 기준선이 회전 상태에서도 화면에는 가로로 보인다', () => {
  it('drawBaseline이 rotationDeg 인자를 받는다', () => {
    expect(src).toMatch(/function drawBaseline\(canvas, video, baselineFeetY, rotationDeg\s*=\s*0\)/);
  });

  it('90/270에서는 버퍼 로컬 세로선(moveTo(y,0)→lineTo(y,ch))을 그린다', () => {
    const body = extractFn('drawBaseline');
    expect(body).toMatch(/rotationDeg === 90 \|\| rotationDeg === 270/);
    expect(body).toMatch(/moveTo\(y,\s*0\);\s*ctx\.lineTo\(y,\s*ch\)/);
  });

  it('0/180에서는 기존처럼 버퍼 로컬 가로선(moveTo(0,y)→lineTo(cw,y))을 그린다', () => {
    const body = extractFn('drawBaseline');
    expect(body).toMatch(/moveTo\(0,\s*y\);\s*ctx\.lineTo\(cw,\s*y\)/);
  });

  it('호출부에서 rotationDeg를 실제로 넘긴다', () => {
    expect(src).toMatch(/drawBaseline\(skeletonCanvasRef\.current, video, calib\.result\.baselineFeetY, rotationDeg\)/);
  });
});
