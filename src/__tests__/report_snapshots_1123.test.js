import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCaptureTracker } from '../ai-measure/core/captureQuality';
import { resolveSnapshots } from '../components/report/QuickResultSheet.jsx';
import { sanitizeReportPayload } from '../ai-measure/core/unifiedReport';

const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));

describe('측정 사진(썸네일) — 2026-11-23', () => {
  it('video 크기가 없으면(테스트·미준비) 사진 없이도 기록·요약은 정상', () => {
    let t = 0;
    const tr = createCaptureTracker(() => (t += 2500));
    tr.record(lms, { videoWidth: 0, videoHeight: 0 });
    expect(tr.snapshots()).toEqual([]);
    expect(tr.summary().frames).toBe(1);
  });
  it('resolveSnapshots는 data:image 만 통과시킨다(data 래퍼도 인식)', () => {
    const ok = { label: '시작', dataUrl: 'data:image/jpeg;base64,AAAA' };
    expect(resolveSnapshots({ snapshots: [ok, { dataUrl: 'http://x' }, null] })).toEqual([ok]);
    expect(resolveSnapshots({ data: { snapshots: [ok] } })).toEqual([ok]);
    expect(resolveSnapshots({})).toEqual([]);
  });
  it('저장 정리(sanitize) 후에도 snapshots 가 남는다', () => {
    const out = sanitizeReportPayload({ a: 1, videoBlob: new Blob(['x']), snapshots: [{ label: '시작', dataUrl: 'data:image/jpeg;base64,AAAA' }] });
    expect(out.snapshots).toHaveLength(1);
    expect(out.videoBlob).toBeUndefined();
  });
  it('Hub가 카메라 측정 저장에 snapshots 를 싣는다', () => {
    const src = readFileSync(join(process.cwd(), 'src/ai-measure/AiMeasureHub.jsx'), 'utf-8');
    expect(src).toContain('getCaptureSnapshots()');
    expect(src).toContain('enrichedData = { ...enrichedData, snapshots }');
  });
});
