// [2026-11-18] "한발서기 오른쪽 촬영이 안 됨" — 좌/우 대칭 + 반대발 들림 보강 회귀 테스트.
import { describe, expect, it } from 'vitest';
import { StandingCalibrator, SingleLegStanceTracker } from '../ai-measure/core/singleLegStanceTracker';

function mkLM({ ankLY = 0.9, ankRY = 0.9 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  lm[0] = { x: 0.5, y: 0.1, z: 0, visibility: 0.99 };
  lm[23] = { x: 0.45, y: 0.5, z: 0, visibility: 0.99 };
  lm[24] = { x: 0.55, y: 0.5, z: 0, visibility: 0.99 };
  lm[27] = { x: 0.45, y: ankLY, z: 0, visibility: 0.99 };
  lm[28] = { x: 0.55, y: ankRY, z: 0, visibility: 0.99 };
  return lm;
}
function calib() {
  const c = new StandingCalibrator({ heightCm: 170 });
  for (let i = 0; i < 15; i++) c.push(mkLM());
  return c.result;
}
// liftSide: 'left' | 'right' — 들리는 발. 1.5초 들고 0.5초 내려놓는다.
function run(tr, liftSide) {
  let t = 0;
  const up = liftSide === 'left' ? { ankLY: 0.85 } : { ankRY: 0.85 };
  for (let i = 0; i < 45; i++, t += 33) tr.push(mkLM(up), t);
  for (let i = 0; i < 15; i++, t += 33) tr.push(mkLM(), t);
  tr.finalize(t);
  return tr.summary();
}

describe('SLST 좌/우 지지다리 대칭', () => {
  it('왼쪽 지지(오른발 듦) 시행이 잡힌다', () => {
    const s = run(new SingleLegStanceTracker(calib(), 'left', { maxTrials: 1 }), 'right');
    expect(s.trialsFound).toBe(1);
    expect(s.trial1.sideMismatch).toBe(false);
    expect(s.trial1.holdTimeMs).toBeGreaterThan(1000);
  });
  it('오른쪽 지지(왼발 듦) 시행이 잡힌다', () => {
    const s = run(new SingleLegStanceTracker(calib(), 'right', { maxTrials: 1 }), 'left');
    expect(s.trialsFound).toBe(1);
    expect(s.trial1.sideMismatch).toBe(false);
    expect(s.trial1.holdTimeMs).toBeGreaterThan(1000);
  });
  it('오른쪽 지지로 선택했는데 반대발(오른발)이 들려도 시행이 잡히고 sideMismatch 표시', () => {
    const s = run(new SingleLegStanceTracker(calib(), 'right', { maxTrials: 1 }), 'right');
    expect(s.trialsFound).toBe(1);
    expect(s.trial1.sideMismatch).toBe(true);
  });
  it('반대발이 잠깐(300ms 미만) 흔들린 정도로는 시행이 시작되지 않는다', () => {
    const tr = new SingleLegStanceTracker(calib(), 'right', { maxTrials: 1 });
    let t = 0;
    for (let i = 0; i < 5; i++, t += 33) tr.push(mkLM({ ankRY: 0.85 }), t);
    for (let i = 0; i < 30; i++, t += 33) tr.push(mkLM(), t);
    expect(tr.phase).toBe('waiting');
    expect(tr.trials.length).toBe(0);
  });
});

import { readFileSync } from 'node:fs';
describe('SLST 허브 — 촬영 후 자동저장', () => {
  const hub = readFileSync('src/ai-measure/menus/StanceAnalysisHub.jsx', 'utf8');
  it("record 단계에서 같은 measuredAt 1회만 persist를 자동 호출한다", () => {
    expect(hub).toMatch(/view !== 'record' \|\| !pending/);
    expect(hub).toMatch(/autoSavedRef\.current === pending\.measuredAt/);
    expect(hub).toMatch(/persist\(pending, \{ note: '' \}\)/);
  });
});
