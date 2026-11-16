import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createCaptureTracker, judgeResolution, judgeFps, judgeDelegate, assessMeasureQuality,
} from '../ai-measure/core/captureQuality';
import { buildMissingItems, resolveReportQuality } from '../ai-measure/core/quickResultSheet';
import { buildPostureMissing } from '../ai-measure/core/postureResultSheet';

function body(fill = 0.8) {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
  const top = 0.5 - fill / 2; const bot = 0.5 + fill / 2;
  a[0] = { x: 0.5, y: top, visibility: 0.99 };
  a[11] = { x: 0.42, y: top + 0.1, visibility: 0.99 }; a[12] = { x: 0.58, y: top + 0.1, visibility: 0.99 };
  a[27] = { x: 0.46, y: bot, visibility: 0.99 }; a[28] = { x: 0.54, y: bot, visibility: 0.99 };
  return a;
}
const video = { videoWidth: 1920, videoHeight: 1080 };

describe('촬영 품질 판정', () => {
  it('화질·프레임·느린 모드 기준', () => {
    expect(judgeResolution(1920, 1080).level).toBe('good');
    expect(judgeResolution(640, 480).level).toBe('warn');
    expect(judgeResolution(320, 240).level).toBe('bad');
    expect(judgeFps(30).level).toBe('good');
    expect(judgeFps(18).level).toBe('warn');
    expect(judgeFps(10).level).toBe('bad');
    expect(judgeDelegate('CPU').level).toBe('warn');
  });

  it('프레임 속도·전신 비율을 누적하고, 카메라가 꺼지면 live() 는 null', () => {
    let t = 0;
    const tr = createCaptureTracker(() => t);
    tr.setDelegate('GPU');
    for (let i = 0; i < 30; i += 1) { t += 33; tr.record(i < 24 ? body() : null, video); }
    expect(Math.round(tr.fps())).toBe(30);
    expect(tr.live().resolution.level).toBe('good');
    const sum = tr.summary();
    expect(sum.fullBodyRatio).toBe(0.8);
    expect(sum.reasons.noPerson).toBe(6);
    t += 5000;
    expect(tr.live()).toBeNull();
  });

  it('발이 잘리면 구도 경고', () => {
    let t = 0;
    const tr = createCaptureTracker(() => t);
    const cut = body(); cut[27].visibility = 0.1; cut[28].visibility = 0.1;
    t += 10; tr.record(cut, video);
    expect(tr.live().frame.level).not.toBe('good');
    expect(tr.live().frame.text).toContain('발');
  });
});

describe('측정 품질 등급', () => {
  it('인식률 높고 조건 좋으면 좋음', () => {
    const q = assessMeasureQuality({ recognition: { ratio: 0.95 }, capture: { fullBodyRatio: 0.97, avgFps: 30, resolution: { w: 1920, h: 1080 }, delegate: 'GPU', reasons: {} } });
    expect(q.grade).toBe('good');
    expect(q.remeasure).toBe(false);
  });
  it('시간 측정에서 프레임 부족 + 전신 잘림이면 낮음·재측정 권장', () => {
    const q = assessMeasureQuality({ timing: true, recognition: { ratio: 0.7 }, capture: { fullBodyRatio: 0.5, avgFps: 14, resolution: { w: 1280, h: 720 }, delegate: 'CPU', reasons: { notFull: 40 } } });
    expect(q.grade).toBe('poor');
    expect(q.remeasure).toBe(true);
    expect(q.reasons.join(' ')).toMatch(/머리나 발/);
  });
  it('영상 없는 측정은 등급 없음', () => {
    expect(assessMeasureQuality({})).toBeNull();
  });
  it('옛 기록은 인식률만으로 등급 계산', () => {
    expect(resolveReportQuality({ recognition: { ratio: 0.7 } }).grade).toBe('fair');
    expect(resolveReportQuality({ kind: 'gait' })).toBeNull();
  });
});

describe('계산 안 된 항목', () => {
  it('보행: 판정 기준 있는 지표가 빠지면 이유와 함께 표시', () => {
    const m = buildMissingItems({ kind: 'gait', metrics: { cadence: 110 } }, { presentKeys: ['cadence'] });
    expect(m.map((x) => x.key)).toContain('pelvicDrop');
    expect(m[0].reason).toBeTruthy();
  });
  it('스프린트는 테스트마다 지표가 달라 빠짐으로 보지 않음', () => {
    expect(buildMissingItems({ kind: 'sprint' }, { presentKeys: [] })).toEqual([]);
  });
  it('자세: 측면 미촬영과 인식 부족을 구분', () => {
    const noSide = buildPostureMissing({ perViewAnalysis: { front: {} }, presentKeys: ['shoulder_height'] });
    expect(noSide.find((x) => x.key === 'forward_head').reason).toContain('측면을 찍지 않음');
    const withSide = buildPostureMissing({ perViewAnalysis: { front: {}, left: {} }, presentKeys: [] });
    expect(withSide.find((x) => x.key === 'forward_head').reason).toContain('충분히 잡히지 않음');
  });
});

describe('연결', () => {
  const root = path.resolve(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  it('두 인식 엔진 모두 인식률·촬영 품질을 보고한다', () => {
    const eng = read('ai-measure/core/usePoseEngine.js');
    expect(eng).toContain('recordRecognitionFrame(');
    expect(eng).toContain('recordCaptureFrame(');
    expect(read('ai-measure/core/poseBackend.js')).toContain('recordCaptureFrame(');
  });
  it('허브가 카메라 측정에 신호등·촬영 기준·저장 품질을 붙인다', () => {
    const hub = read('ai-measure/AiMeasureHub.jsx');
    expect(hub).toContain('<CaptureReadinessBar />');
    expect(hub).toContain('<CaptureGuideStrip');
    expect(hub).toContain('data-testid="save-quality"');
    expect(hub).toContain('resetCaptureQuality()');
  });
  it('자세·ROM은 정밀 모델, CPU 면 full 로 자동 하향', () => {
    expect(read('ai-measure/menus/PostureMeasure.jsx')).toContain("modelTier: 'heavy'");
    expect(read('ai-measure/menus/RomMeasure.jsx')).toContain("modelTier: 'heavy'");
    expect(read('ai-measure/core/usePoseEngine.js')).toMatch(/modelTier === 'heavy' \? 'full'/);
  });
});
