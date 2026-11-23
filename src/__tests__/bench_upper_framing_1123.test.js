import { describe, it, expect } from 'vitest';
import { assessFraming } from '../ai-measure/core/framingGuide';
import { LM } from '../ai-measure/core/geometry';

// 누워서 하는 벤치: 어깨·손목만 보이고 머리·발목은 안 보이는 프레임
function benchFrame() {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  lms[LM.LEFT_SHOULDER] = { x: 0.45, y: 0.5, visibility: 0.9 };
  lms[LM.RIGHT_SHOULDER] = { x: 0.47, y: 0.5, visibility: 0.9 };
  lms[LM.LEFT_WRIST] = { x: 0.46, y: 0.3, visibility: 0.9 };
  lms[LM.RIGHT_WRIST] = { x: 0.47, y: 0.3, visibility: 0.9 };
  return lms;
}

describe('assessFraming upperOnly (벤치프레스 카운팅) — 2026-11-23', () => {
  it('기본(전신 기준)에서는 발목이 없으면 fullBody=false', () => {
    expect(assessFraming(benchFrame()).fullBody).toBe(false);
  });
  it('upperOnly면 어깨+손목만으로 fullBody=true, 거리(fillRatio) 검사는 건너뜀', () => {
    const r = assessFraming(benchFrame(), { upperOnly: true });
    expect(r.fullBody).toBe(true);
    expect(r.fillRatio).toBeNull();
    expect(r.ok).toBe(true);
  });
  it('upperOnly라도 손목이 안 보이면 false, 안내 문구는 어깨·바', () => {
    const f = benchFrame();
    f[LM.LEFT_WRIST].visibility = 0; f[LM.RIGHT_WRIST].visibility = 0;
    const r = assessFraming(f, { upperOnly: true });
    expect(r.fullBody).toBe(false);
    expect(r.message).toContain('바');
  });
});
