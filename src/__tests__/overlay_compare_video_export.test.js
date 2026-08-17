// overlay_compare_video_export.test.js
// ════════════════════════════════════════════════════════════════════════
//  '전/후 비교' 영상으로 저장 — overlay_compare_registry.test.js와 같은
//  정적 소스 패턴 테스트. 이 화면은 렌더 테스트 하네스가 프로젝트에 없어
//  다른 측정 화면들처럼 소스 문자열 배선을 확인한다.
//
//  변경 요지: 스냅샷(PNG) 저장만 있던 것에 더해, 오버레이 합성 화면을
//  canvas.captureStream() + MediaRecorder로 녹화해 WebM 파일로 저장하는
//  "영상으로 저장" 기능을 추가한다. 레이어 A/B 중 최소 하나가 동영상일
//  때만 노출되고(showVideoPanel과 동일 조건), 재생이 끝나면 자동으로
//  녹화를 마무리해 다운로드/공유한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(__dirname, '..', 'ai-measure/menus/OverlayCompare.jsx'),
  'utf-8',
);

describe('OverlayCompare.jsx — 영상으로 저장 (MediaRecorder)', () => {
  it('스냅샷과 영상 저장이 drawCompositeFrame 합성 로직을 공유한다', () => {
    expect(src).toContain('const drawCompositeFrame = useCallback');
    const snapshotIdx = src.indexOf('const takeSnapshot = useCallback');
    const snapshotEnd = src.indexOf('[layerA, layerB, drawCompositeFrame]', snapshotIdx);
    expect(snapshotEnd).toBeGreaterThan(snapshotIdx);
    const snapshotBlock = src.slice(snapshotIdx, snapshotEnd);
    expect(snapshotBlock).toContain('drawCompositeFrame(ctx, rect.width, rect.height)');
  });

  it('startRecording/stopRecording/toggleRecording이 정의돼 있다', () => {
    expect(src).toContain('const startRecording = useCallback');
    expect(src).toContain('const stopRecording = useCallback');
    expect(src).toContain('const toggleRecording = useCallback');
  });

  it('MediaRecorder 지원 여부와 mimeType을 확인한 뒤에만 녹화를 시작한다', () => {
    const idx = src.indexOf('const startRecording = useCallback');
    const end = src.indexOf('[recordDrawLoop, seekA]', idx);
    const block = src.slice(idx, end);
    expect(block).toContain("typeof MediaRecorder === 'undefined'");
    expect(block).toContain('MediaRecorder.isTypeSupported');
    expect(block).toContain('canvas.captureStream(30)');
  });

  it('레이어 A/B 중 최소 하나가 동영상이 아니면 녹화를 거부한다', () => {
    const idx = src.indexOf('const startRecording = useCallback');
    const block = src.slice(idx, idx + 500);
    expect(block).toContain("layerARef.current.type !== 'video' && layerBRef.current.type !== 'video'");
  });

  it('두 레이어(또는 동영상인 쪽)가 재생을 마치면 자동으로 녹화를 멈춘다', () => {
    const idx = src.indexOf('const recordDrawLoop = useCallback');
    const end = src.indexOf('[drawCompositeFrame, stopRecording]', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('aDone && bDone');
    expect(block).toContain('stopRecording()');
  });

  it('녹화 종료 시 WebM 파일을 생성해 다운로드/공유한다', () => {
    const idx = src.indexOf('recorder.onstop = async () => {');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 500);
    expect(block).toContain('new Blob(recordChunksRef.current');
    expect(block).toContain('.webm');
    expect(block).toContain('shareOrDownloadFile(file');
  });

  it('영상으로 저장 버튼은 showVideoPanel 조건(레이어 A/B 중 하나라도 동영상)일 때만 렌더된다', () => {
    const idx = src.indexOf('onClick={toggleRecording}');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, idx - 200), idx);
    expect(before).toContain('showVideoPanel && (');
  });

  it('화면을 벗어날 때(언마운트) 진행 중인 녹화를 정리한다', () => {
    const idx = src.lastIndexOf('useEffect(() => () => {');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 300);
    expect(block).toContain('recorderRef.current');
    expect(block).toContain('.stop()');
  });
});
