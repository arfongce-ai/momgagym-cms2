// live_record_composite_video.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] "오버헤드스쿼트 녹화 저장 시 스켈레톤만 나옴" 현장 버그 회귀.
//
//  원인: 녹화 합성 루프는 (1) 검은 배경 → (2) 카메라 영상 프레임 → (3) 스켈레톤
//  → (4) HUD 순서로 같은 캔버스에 겹쳐 그린다. 그런데 drawSkeleton()이 미리보기
//  용으로 만들어진 함수라 맨 앞에서 ctx.clearRect()로 캔버스를 통째로 지웠다.
//  그 결과 (2)에서 그린 영상이 지워지고 스켈레톤만 남은 채 저장됐다
//  (실제 저장본 확인: 화면의 96%가 검은색).
//
//  수정: clearFirst 파라미터를 두고, 합성 루프에서는 false로 호출한다.
//  미리보기 캔버스는 매 프레임 지워야 잔상이 안 남으므로 기본값은 true 유지.
//
//  SLST(StanceLiveAnalysis)도 같은 구조라 함께 고쳤다 — 두 화면 모두 검증한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

describe.each([
  ['ai-measure/menus/SquatLiveAnalysis.jsx', '오버헤드스쿼트'],
  ['ai-measure/menus/StanceLiveAnalysis.jsx', 'SLST(한다리서기)'],
])('%s (%s) — 저장 영상에 카메라 화면이 남아있다', (path) => {
  const src = read(path);

  it('drawSkeleton에 clearFirst 파라미터가 있고 기본값은 true다(미리보기 잔상 방지)', () => {
    expect(src).toMatch(/function drawSkeleton\([^)]*clearFirst = true\)/);
  });

  it('clearRect는 clearFirst가 true일 때만 실행된다', () => {
    expect(src).toMatch(/if \(clearFirst\) ctx\.clearRect\(0, 0, cw, ch\);/);
  });

  it('캔버스 크기 재설정도 clearFirst일 때만 한다(합성 캔버스 크기를 덮어쓰면 내용이 날아간다)', () => {
    expect(src).toMatch(/if \(clearFirst && \(canvas\.width !== cw \|\| canvas\.height !== ch\)\)/);
  });

  it('녹화 합성 루프는 clearFirst=false로 호출한다', () => {
    const drawStart = src.indexOf('const draw = () => {');
    expect(drawStart).toBeGreaterThan(-1);
    const drawBody = src.slice(drawStart, src.indexOf('\n    };', drawStart));
    const call = drawBody.match(/drawSkeleton\([^;]*\);/);
    expect(call).not.toBeNull();
    expect(call[0]).toMatch(/,\s*false\)/);
  });

  it('합성 순서가 지켜진다: 배경 → 영상 → 스켈레톤 (영상이 스켈레톤보다 먼저)', () => {
    const drawStart = src.indexOf('const draw = () => {');
    const drawBody = src.slice(drawStart, src.indexOf('\n    };', drawStart));
    const fillIdx = drawBody.indexOf('ctx.fillRect(0, 0, canvas.width, canvas.height)');
    const videoIdx = drawBody.indexOf('drawVideoCover(ctx, video');
    const skelIdx = drawBody.indexOf('drawSkeleton(canvas, video');
    expect(fillIdx).toBeGreaterThan(-1);
    expect(videoIdx).toBeGreaterThan(fillIdx);
    expect(skelIdx).toBeGreaterThan(videoIdx);
  });

  it('미리보기 쪽 호출은 clearFirst를 넘기지 않아 기본값(true)으로 지워진다', () => {
    // 미리보기 렌더 경로(캔버스 ref 사용)는 합성 루프 밖에 있고, false를
    // 넘기지 않아야 매 프레임 잔상이 지워진다.
    const drawStart = src.indexOf('const draw = () => {');
    const drawEnd = src.indexOf('\n    };', drawStart);
    const outsideCompose = src.slice(0, drawStart) + src.slice(drawEnd);
    const previewCalls = outsideCompose.match(/drawSkeleton\(canvasRef\.current[^;]*\);/g) || [];
    expect(previewCalls.length).toBeGreaterThan(0);
    previewCalls.forEach((c) => expect(c).not.toMatch(/,\s*false\)/));
  });
});
