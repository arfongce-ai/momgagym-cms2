import { describe, it, expect } from 'vitest';
import { buildVbtPlainSummary } from '../ai-measure/core/vbtPlainSummary';
import { recommendedViews, wantForView, defaultView, VIEWS, detectView, viewStatusText } from '../ai-measure/core/cameraViewGuide';
import { pushTrailPoint } from '../ai-measure/core/barbell';

describe('VBT 쉬운 해석', () => {
  it('0.42m/s·속도저하 45%·궤적 9cm → 최대근력 설명 + 부족한 점 + 할 일', () => {
    const r = buildVbtPlainSummary({ mode: 'vbt', exerciseType: 'squat', metrics: { meanVelocity: 0.42, velocityLoss: 45 }, metadata: { reps: 5 }, barPath: { maxDriftCm: 9 } });
    expect(r.meaning).toContain('최대근력');
    expect(r.lack.length).toBeGreaterThanOrEqual(2);
    expect(r.todo.length).toBeGreaterThanOrEqual(2);
    expect(r.headline).toContain('보완');
  });
  it('좋은 세트는 잘한 점만, 부족한 점 없음', () => {
    const r = buildVbtPlainSummary({ mode: 'vbt', exerciseType: 'squat', metrics: { meanVelocity: 0.9, velocityLoss: 8 }, consistencyCvPct: 3, barPath: { maxDriftCm: 2 } });
    expect(r.lack).toEqual([]); expect(r.good.length).toBeGreaterThanOrEqual(3);
  });
  it('값이 없으면 문장을 지어내지 않는다', () => {
    const r = buildVbtPlainSummary({ mode: 'vbt', exerciseType: 'squat' });
    expect(r.meaning).toBeNull(); expect(r.good).toEqual([]); expect(r.lack).toEqual([]);
  });
  it('역도 종목은 속도를 참고용으로만 말한다', () => {
    const r = buildVbtPlainSummary({ mode: 'vbt', exerciseType: 'clean', metrics: { meanVelocity: 0.42 } });
    expect(r.meaning).toContain('참고용');
  });
});
describe('촬영 위치', () => {
  it('모든 종목에 4가지 위치와 첫 권장(측면)', () => {
    for (const t of ['squat', 'deadlift', 'bench_press', 'snatch', 'clean', 'clean_jerk', 'unknown']) {
      const r = recommendedViews(t);
      expect(r.views.length).toBe(4); expect(r.views[0].recommended).toBe(true); expect(r.views[0].key).toBe('side');
    }
    expect(wantForView('front')).toBe('front'); expect(wantForView('back')).toBe('front'); expect(wantForView('diagonal')).toBe('any');
    expect(defaultView('clean')).toBe('side'); expect(Object.keys(VIEWS).length).toBe(4);
  });
});
describe('궤적 점 필터', () => {
  it('손목이 한 프레임에 튀면 건너뛰고, 계속되면 받아들인다', () => {
    const tr = []; const st = { skipped: 0 };
    pushTrailPoint(tr, st, { x: 0.5, y: 0.5 }, 0);
    expect(pushTrailPoint(tr, st, { x: 0.9, y: 0.1 }, 33)).toBe(false);
    pushTrailPoint(tr, st, { x: 0.51, y: 0.49 }, 66);
    expect(tr.length).toBe(2);
    let accepted = false;
    for (let i = 0; i < 5; i++) accepted = pushTrailPoint(tr, st, { x: 0.9, y: 0.1 }, 100 + i * 33) || accepted;
    expect(accepted).toBe(true);
  });
  it('오래된 점은 버린다', () => {
    const tr = []; const st = {};
    pushTrailPoint(tr, st, { x: 0.5, y: 0.5 }, 0, { keepMs: 1000 });
    pushTrailPoint(tr, st, { x: 0.5, y: 0.51 }, 2000, { keepMs: 1000 });
    expect(tr.length).toBe(1);
  });
});

describe('촬영 위치 자동 인식', () => {
  const pose = (sx, hipx, noseVis = 0.9) => {
    const l = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    l[11] = { x: 0.5 - sx / 2, y: 0.3, visibility: 0.9 }; l[12] = { x: 0.5 + sx / 2, y: 0.3, visibility: 0.9 };
    l[23] = { x: 0.5 - hipx / 2, y: 0.6, visibility: 0.9 }; l[24] = { x: 0.5 + hipx / 2, y: 0.6, visibility: 0.9 };
    l[0] = { x: 0.5, y: 0.2, visibility: noseVis };
    return l;
  };
  it('측면·대각선·정면·후면', () => {
    expect(detectView(pose(0.03, 0.03))).toBe('side');
    expect(detectView(pose(0.12, 0.1))).toBe('diagonal');
    expect(detectView(pose(0.25, 0.18))).toBe('front');
    expect(detectView(pose(0.25, 0.18, 0.1))).toBe('back');
    expect(detectView(null)).toBeNull();
  });
  it('측면이 아니면 한계를 짧게 알려 준다', () => {
    expect(viewStatusText('side')).toBe('촬영 위치 측면');
    expect(viewStatusText('front')).toContain('속도');
  });
});
