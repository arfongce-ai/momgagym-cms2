// record_aspect.test.js — 측정 녹화 비율 표준(3:4/1:1) 공통 로직 회귀 보호
import { describe, it, expect } from 'vitest';
import {
  ASPECT_KEYS, DEFAULT_ASPECT, OUTPUT_SIZE,
  normalizeAspect, outputSize, aspectCss, aspectLabel,
  coverTransform, coverMapPath, drawVideoCover,
} from '../ai-measure/core/recordAspect.js';

describe('비율 표준 — 인스타 3:4 기본 / 1:1 전환', () => {
  it('기본값은 3:4, 유효 키는 3/4·1/1', () => {
    expect(DEFAULT_ASPECT).toBe('3/4');
    expect(ASPECT_KEYS).toEqual(['3/4', '1/1']);
  });

  it('출력 해상도는 1080 폭 고정(3:4=1440h, 1:1=1080h)', () => {
    expect(OUTPUT_SIZE['3/4']).toEqual({ width: 1080, height: 1440 });
    expect(OUTPUT_SIZE['1/1']).toEqual({ width: 1080, height: 1080 });
    expect(outputSize('1/1').height).toBe(1080);
  });

  it('잘못된 비율은 기본 3:4로 정규화', () => {
    expect(normalizeAspect('16/9')).toBe('3/4');
    expect(normalizeAspect(undefined)).toBe('3/4');
    expect(outputSize('bogus')).toEqual(OUTPUT_SIZE['3/4']);
  });

  it('CSS/라벨 헬퍼', () => {
    expect(aspectCss('3/4')).toBe('3 / 4');
    expect(aspectCss('1/1')).toBe('1 / 1');
    expect(aspectLabel('3/4')).toBe('3:4');
    expect(aspectLabel('1/1')).toBe('1:1');
  });
});

describe('cover 크롭 좌표 매핑', () => {
  // 가로가 넓은 원본(1920×1080)을 3:4 캔버스(1080×1440)에 cover.
  const video = { videoWidth: 1920, videoHeight: 1080 };

  it('중앙점(0.5,0.5)은 캔버스 중앙으로 매핑된다', () => {
    const t = coverTransform(video, 1080, 1440);
    expect(Math.round(t.X({ x: 0.5, y: 0.5 }))).toBe(540);
    expect(Math.round(t.Y({ x: 0.5, y: 0.5 }))).toBe(720);
  });

  it('비디오 크기가 없으면 단순 정규화 매핑으로 폴백', () => {
    const t = coverTransform({}, 1080, 1440);
    expect(t.X({ x: 0.5 })).toBe(540);
    expect(t.Y({ y: 0.25 })).toBe(360);
  });

  it('coverMapPath 는 경로 중앙점을 캔버스 중앙(0.5)으로 유지', () => {
    const mapped = coverMapPath([{ x: 0.5, y: 0.5 }], video, 1080, 1440);
    expect(mapped[0].x).toBeCloseTo(0.5, 5);
    expect(mapped[0].y).toBeCloseTo(0.5, 5);
  });

  it('drawVideoCover 는 비디오 준비 전이면 false', () => {
    const ctx = { drawImage: () => {} };
    expect(drawVideoCover(ctx, {}, 1080, 1440)).toBe(false);
    expect(drawVideoCover(ctx, video, 1080, 1440)).toBe(true);
  });
});

describe('cover 크롭 + 회전 보정(카메라 원본이 90/180/270도 돌아간 채로 들어오는 경우)', () => {
  const video = { videoWidth: 1920, videoHeight: 1080 }; // 가로로 넓은 원본

  it.each([90, 180, 270])('%i도 보정 시에도 중앙점(0.5,0.5)은 캔버스 중앙으로 매핑된다', (deg) => {
    const t = coverTransform(video, 1080, 1440, deg);
    expect(Math.round(t.X({ x: 0.5, y: 0.5 }))).toBe(540);
    expect(Math.round(t.Y({ x: 0.5, y: 0.5 }))).toBe(720);
  });

  it('회전을 주면 중앙이 아닌 점의 매핑이 회전 없음과 달라진다(보정이 실제로 적용됨을 확인)', () => {
    const base = coverTransform(video, 1080, 1440, 0);
    const rotated = coverTransform(video, 1080, 1440, 90);
    const p = { x: 0.5, y: 0 };
    expect(Math.round(rotated.X(p))).not.toBe(Math.round(base.X(p)));
  });

  it('coverMapPath 도 회전 보정 시 경로 중앙점을 0.5로 유지한다', () => {
    const mapped = coverMapPath([{ x: 0.5, y: 0.5 }], video, 1080, 1440, 90);
    expect(mapped[0].x).toBeCloseTo(0.5, 5);
    expect(mapped[0].y).toBeCloseTo(0.5, 5);
  });

  it('drawVideoCover 는 회전값이 있으면 save→rotate→restore 순으로 그린다', () => {
    const calls = [];
    const ctx = {
      save: () => calls.push('save'),
      translate: (...a) => calls.push(['translate', ...a]),
      rotate: (...a) => calls.push(['rotate', ...a]),
      restore: () => calls.push('restore'),
      drawImage: (...a) => calls.push(['drawImage', ...a]),
    };
    expect(drawVideoCover(ctx, video, 1080, 1440, 90)).toBe(true);
    expect(calls[0]).toBe('save');
    expect(calls.at(-1)).toBe('restore');
    expect(calls.some((c) => Array.isArray(c) && c[0] === 'rotate')).toBe(true);
  });

  it('drawVideoCover 는 회전값이 0이면 save/rotate 없이 기존과 동일하게 그린다(회귀 방지)', () => {
    const calls = [];
    const ctx = { drawImage: (...a) => calls.push(['drawImage', ...a]) };
    expect(drawVideoCover(ctx, video, 1080, 1440, 0)).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('drawImage');
  });
});
