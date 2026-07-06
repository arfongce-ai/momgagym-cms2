// src/__tests__/recording_name.test.js
// ════════════════════════════════════════════════════════════════════════
//  일반 영상 녹화 — 촬영별 고유 파일명 + '다시 녹화' 즉시성(카메라 유지) 검증.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildRecordingFileName, _resetRecordingNameState } from '../utils/recordingName';

const D = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s);

describe('촬영별 고유 파일명 (몸가짐YYMMDDHHmm)', () => {
  beforeEach(() => _resetRecordingNameState());

  it('기본 형식: 2026-07-06 20:26 → 몸가짐2607062026.mp4', () => {
    expect(buildRecordingFileName('video/mp4', D(2026, 7, 6, 20, 26, 5)))
      .toBe('몸가짐2607062026.mp4');
  });

  it('다른 분(minute)에 찍으면 예시 그대로 분 단위 이름', () => {
    expect(buildRecordingFileName('video/mp4', D(2026, 7, 6, 20, 26, 5))).toBe('몸가짐2607062026.mp4');
    expect(buildRecordingFileName('video/mp4', D(2026, 7, 6, 20, 30, 10))).toBe('몸가짐2607062030.mp4');
  });

  it('같은 분 안에서 연속 촬영(10초 영상×여러 번)해도 이름이 절대 겹치지 않는다', () => {
    const a = buildRecordingFileName('video/mp4', D(2026, 7, 6, 20, 26, 5));
    const b = buildRecordingFileName('video/mp4', D(2026, 7, 6, 20, 26, 48));
    const c = buildRecordingFileName('video/mp4', D(2026, 7, 6, 20, 26, 59));
    expect(a).toBe('몸가짐2607062026.mp4');
    expect(b).toBe('몸가짐260706202648.mp4'); // 같은 분 → 초 추가
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('자릿수 패딩: 1월 1일 09:05 → 몸가짐2601010905', () => {
    expect(buildRecordingFileName('video/mp4', D(2026, 1, 1, 9, 5, 0)))
      .toBe('몸가짐2601010905.mp4');
  });

  it('webm 코덱이면 확장자 webm', () => {
    expect(buildRecordingFileName('video/webm;codecs=vp9', D(2026, 7, 6, 20, 26)))
      .toMatch(/\.webm$/);
  });
});

describe("일반 영상 녹화 — '다시 녹화' 즉시성 배선", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'ai-measure/menus/RecordMeasure.jsx'), 'utf-8',
  );

  it('녹화 종료(onstop)가 미리보기 스트림을 끄지 않는다(카메라 유지)', () => {
    const onstop = src.slice(src.indexOf('rec.onstop'), src.indexOf('recorderRef.current = rec'));
    expect(onstop).not.toContain('stopStream()');
    expect(onstop).toContain('stopRecordStream()'); // 캔버스 합성 스트림만 정리
  });

  it('파일명은 종료 시점에 buildRecordingFileName 으로 고정·표시된다', () => {
    expect(src).toContain('buildRecordingFileName(type)');
    expect(src).toContain('setSavedFileName(fileName)');
    expect(src).toContain('{savedFileName}');
  });

  it('스트림 해제는 화면 이탈(stopAll)에서만 수행된다', () => {
    const stopAll = src.slice(src.indexOf('const stopAll'), src.indexOf('const reset'));
    expect(stopAll).toContain('stopStream()');
  });
});

describe('일반 영상 녹화 — 용량(화질 프리셋)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'ai-measure/menus/RecordMeasure.jsx'), 'utf-8',
  );

  it('표준/고화질 프리셋이 있고 기본은 표준(카톡 최적)', () => {
    expect(src).toContain('QUALITY_PRESETS');
    expect(src).toContain("standard: {");
    expect(src).toContain("high: {");
    expect(src).toContain("return QUALITY_PRESETS[v] ? v : 'standard'");
  });

  it('표준 화질은 고화질보다 비트레이트·해상도가 낮다(용량 절감)', () => {
    const std = src.match(/standard:[\s\S]*?videoBps:\s*([\d_]+)/)[1].replace(/_/g, '');
    const high = src.match(/high:[\s\S]*?videoBps:\s*([\d_]+)/)[1].replace(/_/g, '');
    expect(Number(std)).toBeLessThan(Number(high));
    expect(Number(std)).toBeLessThanOrEqual(4_000_000); // 10초 ≈ 4~5MB 보장
    expect(src).toContain('width: 720, height: 960');   // 표준 3/4 해상도
  });

  it('녹화 캔버스와 MediaRecorder 가 선택 프리셋을 사용한다', () => {
    expect(src).toContain('preset.size[aspect]');
    expect(src).toContain('videoBitsPerSecond: preset.videoBps');
    expect(src).toContain('audioBitsPerSecond: preset.audioBps');
  });

  it('선택한 화질은 localStorage 에 유지된다', () => {
    expect(src).toContain('QUALITY_STORAGE_KEY');
    expect(src).toContain('localStorage.setItem(QUALITY_STORAGE_KEY');
  });
});

