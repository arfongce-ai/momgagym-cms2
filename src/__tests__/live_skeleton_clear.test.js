// live_skeleton_clear.test.js
// ════════════════════════════════════════════════════════════════════════
//  버그: SLST·스쿼트 실시간 화면의 drawSkeleton()이 매 프레임 캔버스를 지우지
//  않고 그 위에 계속 덧그려서, 시간이 지날수록 스켈레톤이 뒤엉킨 그물망(잔상)
//  으로 쌓여 화면을 뒤덮었다. ROM 등 다른 측정 화면은 처음부터 clearRect 를
//  쓰고 있었음 — 이 두 화면만 빠져 있었다.
//  수정: getContext 직후, landmarks 가드보다 먼저 clearRect 를 호출한다.
//  (landmarks 가드 "안"에 넣으면 추적이 잠깐 끊긴 프레임에서 이전 그림이 그대로
//  남는 문제가 재발하므로, 반드시 가드보다 먼저 와야 한다.)
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe.each([
  'ai-measure/menus/SquatLiveAnalysis.jsx',
  'ai-measure/menus/StanceLiveAnalysis.jsx',
])('%s — 실시간 스켈레톤 캔버스 클리어', (path) => {
  const src = read(path);
  const start = src.indexOf('function drawSkeleton(');
  const end = src.indexOf('\n}', start);
  const fnBody = src.slice(start, end);

  it('drawSkeleton 함수가 존재한다', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('getContext 이후 · landmarks 가드 이전에 clearRect 를 호출한다(순서 고정)', () => {
    const ctxIdx = fnBody.indexOf("getContext('2d')");
    const clearIdx = fnBody.indexOf('clearRect(');
    const guardIdx = fnBody.indexOf('if (!landmarks)');
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(ctxIdx);
    expect(guardIdx).toBeGreaterThan(clearIdx);
  });
});
