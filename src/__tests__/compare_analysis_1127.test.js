// 전/후 비교 인식 개선 + 동작 분석 각도 계산.
import { describe, expect, it } from 'vitest';
import { extractAlignPair } from '../ai-measure/core/overlayAlign';
import { computeMetrics, pickSide, pointsFromLandmarks, templatePoints } from '../ai-measure/core/compareAngles';
import { mapBack, poseScore } from '../ai-measure/core/poseRobust';

const body = (over = {}) => Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: i / 40, visibility: 0.9, ...(over[i] || {}) }));

describe('extractAlignPair — 기준점 대체', () => {
  it('발목이 보이면 발목 기준', () => {
    expect(extractAlignPair({ landmarks: body() }, { landmarks: body() }).basis).toBe('ankle');
  });
  it('한쪽 장면에서 발목이 안 보이면 두 장 모두 무릎 기준', () => {
    const cut = body({ 27: { visibility: 0.1 }, 28: { visibility: 0.1 } });
    expect(extractAlignPair({ landmarks: body() }, { landmarks: cut }).basis).toBe('knee');
  });
  it('화면 밖 추측 좌표는 쓰지 않는다', () => {
    const out = body({ 27: { y: 1.3 }, 28: { y: 1.3 } });
    expect(extractAlignPair({ landmarks: out }, { landmarks: body() }).basis).toBe('knee');
  });
  it('어깨가 없거나 인식 실패면 null', () => {
    const noSh = body({ 11: { visibility: 0 }, 12: { visibility: 0 } });
    expect(extractAlignPair({ landmarks: noSh }, { landmarks: body() })).toBeNull();
    expect(extractAlignPair(null, { landmarks: body() })).toBeNull();
  });
});

describe('computeMetrics', () => {
  const straight = {
    shoulder: { x: 0.5, y: 0.2 }, elbow: { x: 0.5, y: 0.35 }, wrist: { x: 0.5, y: 0.5 },
    hip: { x: 0.5, y: 0.5 }, knee: { x: 0.5, y: 0.7 }, ankle: { x: 0.5, y: 0.9 }, foot: { x: 0.6, y: 0.9 },
  };
  it('바로 선 자세는 굽힘 0°, 발목 90°', () => {
    expect(computeMetrics(straight, 720, 1280)).toEqual({ trunk: 0, shoulder: 0, elbow: 0, hip: 0, knee: 0, ankle: 90 });
  });
  it('화면 비율을 반영한다(가로 영상의 45° 기울기)', () => {
    const p = { ...straight, shoulder: { x: 0.5 + 300 / 1920, y: 0.5 - 300 / 1080 } };
    expect(computeMetrics(p, 1920, 1080).trunk).toBe(45);
  });
  it('무릎 90° 굽힘', () => {
    const p = { ...straight, ankle: { x: 0.5 - 200 / 1000, y: 0.7 } };
    expect(computeMetrics(p, 1000, 1000).knee).toBe(90);
  });
});

describe('점·좌표 도우미', () => {
  it('더 잘 보이는 쪽을 고르고, 안 보이는 점을 표시한다', () => {
    const lm = body({ 11: { visibility: 0.1 }, 25: { visibility: 0.1 } });
    expect(pickSide(lm)).toBe('right');
    expect(pointsFromLandmarks(lm, 'left').low).toEqual(['shoulder', 'knee']);
    expect(Object.keys(templatePoints())).toHaveLength(7);
  });
  it('여백·확대 화면의 좌표를 원본 좌표로 되돌린다', () => {
    expect(mapBack([{ x: 0.5, y: 0.5 }], { pad: 0.25 })[0]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(mapBack([{ x: 0, y: 1 }], { crop: 0.7 })[0].x).toBeCloseTo(0.15);
    expect(poseScore(body())).toBeCloseTo(0.9);
  });
});

import fs from 'node:fs';
import path from 'node:path';

describe('OverlayCompare — 정렬 시점', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'ai-measure/menus/OverlayCompare.jsx'), 'utf-8');
  it('정렬 진행 화면은 비교 화면을 대신하지 않고 위에 덮는다(사진·영상이 먼저 올라와야 인식)', () => {
    expect(src).not.toMatch(/if \(step === 2\) \{\s*return/);
    expect(src).toContain('{alignPanel}');
  });
  it('비교 시작 버튼은 정렬을 바로 부르지 않고 파일 준비를 기다린다', () => {
    expect(src).not.toContain('requestAnimationFrame(() => runAlignSequence())');
    expect(src).toContain('setLayerA((p) => ({ ...p, ready: false }));');
  });
});
