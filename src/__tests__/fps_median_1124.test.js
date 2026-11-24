import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { medianComTakeoff, combineJumpTrials } from '../ai-measure/core/jumpBiomechanics';

const com = (v, conf = 'ok') => ({ velocity: v, flightVelocity: v, gapPct: 5, confidence: conf, fps: 60, basis: 'pelvis' });
const trial = (v, c) => ({ heightCm: 30, takeoffVelocity: 2.4, peakPower: 3000, comTakeoff: c });

describe('이륙속도 참고값 중앙값', () => {
  it('신뢰 가능한 회차만 모아 중앙값', () => {
    const r = medianComTakeoff([trial(0, com(2.0)), trial(0, com(3.5, 'low')), trial(0, com(2.4)), trial(0, com(2.2))]);
    expect(r.velocity).toBe(2.2);
    expect(r.confidence).toBe('ok');
    expect(r.trialsUsed).toBe(3);
    expect(r.trialsTotal).toBe(4);
  });
  it('모두 낮음이면 전체 중앙값·신뢰 낮음', () => {
    const r = medianComTakeoff([trial(0, com(2.0, 'low')), trial(0, com(2.6, 'low'))]);
    expect(r.velocity).toBe(2.3);
    expect(r.confidence).toBe('low');
  });
  it('값이 없으면 undefined, 합친 결과에도 필드 안 붙음', () => {
    expect(medianComTakeoff([{}, {}])).toBeUndefined();
    expect(combineJumpTrials([trial(0, null), trial(0, null)], 'power').comTakeoff).toBeNull();
  });
  it('combineJumpTrials 가 중앙값을 대표로 쓴다', () => {
    const c = combineJumpTrials([trial(0, com(1.9)), trial(0, com(2.5)), trial(0, com(2.1))], 'power');
    expect(c.comTakeoff.velocity).toBe(2.1);
  });
});

describe('60fps 요청', () => {
  const src = fs.readFileSync('src/ai-measure/core/cameraSelect.js', 'utf8');
  it('preferFps 옵션이 있고 기본은 기존 후보 그대로', () => {
    expect(src).toContain('preferFps = 0');
    expect(src).toContain('if (!(preferFps > 0)) return base;');
    expect(src).toContain('frameRate: { ideal: preferFps }');
  });
  it('점프 라이브 화면만 60fps 요청 + 저fps 안내', () => {
    const j = fs.readFileSync('src/ai-measure/menus/JumpPrecisionAnalysis.jsx', 'utf8');
    expect(j).toContain('preferFps: 60');
    expect(j).toContain('low-fps-notice');
    expect(j).toContain("import { openMainCameraStream, describeCameraError, readStreamFps } from '../core/cameraSelect';");
  });
});
