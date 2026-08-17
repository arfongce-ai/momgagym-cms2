// overlay_compare_export_quality.test.js
// ════════════════════════════════════════════════════════════════════════
//  '전/후 비교' 저장 화질 개선 — overlay_compare_registry.test.js와 같은
//  정적 소스 패턴 테스트. 이 화면은 렌더 테스트 하네스가 프로젝트에 없어
//  다른 측정 화면들처럼 소스 문자열 배선을 확인한다.
//
//  변경 요지: 스냅샷(PNG)은 이미 devicePixelRatio만큼 캔버스를 키워서
//  찍었지만, "영상으로 저장"(녹화)은 화면 CSS 픽셀 그대로 캔버스를 만들어
//  레티나 화면에서 스냅샷보다 화질이 떨어졌다. 녹화도 스냅샷과 동일하게
//  devicePixelRatio를 반영하고, 해상도가 커진 만큼 비트레이트도 함께
//  올리며, 캔버스에 그릴 때 리샘플링 품질을 최고로 지정한다.
//
//  회귀 방지 포인트: startRecording()과 recordDrawLoop() 양쪽의 캔버스
//  픽셀 크기 계산이 서로 다른 반올림 순서를 쓰면(CSS 폭을 먼저 반올림한 뒤
//  dpr을 곱하는 이중 반올림) 매 프레임 크기가 미세하게 어긋나 캔버스가
//  계속 리사이즈되고, 녹화 중인 captureStream 트랙 해상도가 프레임마다
//  바뀌어 인코더가 정상적인 영상을 만들지 못하는(거의 빈 파일) 실제 버그가
//  있었다 — 두 위치의 계산식이 같은 형태(Math.round(rect.* * dpr))를
//  쓰는지 반드시 함께 확인한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(__dirname, '..', 'ai-measure/menus/OverlayCompare.jsx'),
  'utf-8',
);

describe('OverlayCompare.jsx — 합성 렌더 품질(image smoothing)', () => {
  it('drawCompositeFrame은 항상 최고 품질 리샘플링으로 그린다(스냅샷·영상 저장 공용)', () => {
    const idx = src.indexOf('const drawCompositeFrame = useCallback');
    expect(idx).toBeGreaterThan(-1);
    const end = src.indexOf('}, []);', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('ctx.imageSmoothingEnabled = true');
    expect(block).toContain("ctx.imageSmoothingQuality = 'high'");
  });
});

describe('OverlayCompare.jsx — 영상 저장(녹화) 해상도가 스냅샷과 동일하게 devicePixelRatio를 반영한다', () => {
  it('startRecording은 캔버스를 devicePixelRatio만큼 키우고 스케일을 맞춘다', () => {
    const idx = src.indexOf('const startRecording = useCallback');
    const end = src.indexOf('[recordDrawLoop, seekA]', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('const dpr = window.devicePixelRatio || 1');
    expect(block).toContain('canvas.width = Math.round(rect.width * dpr)');
    expect(block).toContain('canvas.height = Math.round(rect.height * dpr)');
    expect(block).toContain('ctx.scale(dpr, dpr)');
    expect(block).toContain('canvas.captureStream(30)');
  });

  it('recordDrawLoop도 startRecording과 같은 반올림 순서(Math.round(rect.* * dpr))로 캔버스 크기를 계산한다(회귀 방지)', () => {
    const idx = src.indexOf('const recordDrawLoop = useCallback');
    const end = src.indexOf('[drawCompositeFrame, stopRecording]', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('const pixelW = Math.round(rect.width * dpr)');
    expect(block).toContain('const pixelH = Math.round(rect.height * dpr)');
    expect(block).toContain('aDone && bDone');
    expect(block).toContain('stopRecording()');
  });

  it('recordDrawLoop은 캔버스 크기가 바뀔 때마다 scale()을 다시 걸어준다(리사이즈가 transform을 초기화하므로)', () => {
    const idx = src.indexOf('const recordDrawLoop = useCallback');
    const end = src.indexOf('[drawCompositeFrame, stopRecording]', idx);
    const block = src.slice(idx, end);
    const resizeIdx = block.indexOf('canvas.width !== pixelW');
    expect(resizeIdx).toBeGreaterThan(-1);
    const resizeBlock = block.slice(resizeIdx, resizeIdx + 300);
    expect(resizeBlock).toContain('canvas.width = pixelW');
    expect(resizeBlock).toContain('canvas.height = pixelH');
    expect(resizeBlock).toContain('recordCtxRef.current.scale(dpr, dpr)');
  });

  it('영상 저장 비트레이트는 해상도에 맞춰 커지도록 computeRecordBitrate로 계산한다(고정 6Mbps로 화질이 뭉개지지 않도록)', () => {
    expect(src).toContain('function computeRecordBitrate(pixelW, pixelH)');
    const idx = src.indexOf('const startRecording = useCallback');
    const end = src.indexOf('[recordDrawLoop, seekA]', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('videoBitsPerSecond: computeRecordBitrate(canvas.width, canvas.height)');
  });
});
