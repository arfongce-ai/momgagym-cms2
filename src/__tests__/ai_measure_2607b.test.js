// src/__tests__/ai_measure_2607b.test.js
// ════════════════════════════════════════════════════════════════════════
//  2607(B) 요청 검증:
//   1) 탭 순서 정리 + '던지기'·'스윙' 탭 제거
//   2) 미등록회원 신체정보 접기/펴기
//   3) 미등록회원 신체정보 아래 볼륨 카드 제거
//   6) 스켈레톤 모드(ON/OFF) 전역 토글
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MEASURE_MENUS } from '../ai-measure/registry';
import {
  isSkeletonEnabled, setSkeletonEnabled, subscribeSkeleton,
} from '../ai-measure/core/skeletonPref';

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');

// ── [1] 탭 순서 · throw/swing 제거 ──
describe('[2607-1/4] 탭 순서 정리 및 던지기·스윙 제거', () => {
  it("'던지기'(throw)·'스윙'(swing) 탭이 완전히 제거되었다", () => {
    expect(MEASURE_MENUS.find((m) => m.id === 'throw')).toBeUndefined();
    expect(MEASURE_MENUS.find((m) => m.id === 'swing')).toBeUndefined();
    expect(MEASURE_MENUS.some((m) => m.status === 'planned')).toBe(false);
  });

  it('모든 탭이 ready 상태이며 컴포넌트가 연결되어 있다', () => {
    for (const m of MEASURE_MENUS) {
      expect(m.status).toBe('ready');
      expect(m.component).toBeTruthy();
    }
  });

  it('탭 순서(no)가 측정 흐름 순으로 1..N 오름차순 정렬된다', () => {
    const nos = MEASURE_MENUS.map((m) => m.no);
    const sorted = [...nos].sort((a, b) => a - b);
    expect(nos).toEqual(sorted);
    // 정수·중복 없음(정리된 순번)
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos.every((n) => Number.isInteger(n))).toBe(true);
  });

  it('신체 정보가 첫 탭, 도구(녹화/초시계)가 마지막 쪽에 온다', () => {
    const order = [...MEASURE_MENUS].sort((a, b) => a.no - b.no).map((m) => m.id);
    expect(order[0]).toBe('body');
    expect(order.indexOf('timer')).toBe(order.length - 1);
    // 측정 흐름: 자세 → ROM → 보행 → 점프 → 리프팅
    expect(order.indexOf('posture')).toBeLessThan(order.indexOf('rom'));
    expect(order.indexOf('rom')).toBeLessThan(order.indexOf('jump'));
    expect(order.indexOf('lifting')).toBeGreaterThan(order.indexOf('jump'));
  });

  it('기존 측정 탭은 회귀 없이 유지된다', () => {
    for (const id of ['body', 'posture', 'rom', 'gait', 'jump', 'lifting', 'record', 'timer']) {
      expect(MEASURE_MENUS.find((m) => m.id === id)?.status).toBe('ready');
    }
  });
});

// ── [2] 미등록회원 신체정보 접기/펴기 ──
describe('[2607-2] 미등록회원 신체정보 접기/펴기', () => {
  const hub = read('ai-measure/AiMeasureHub.jsx');
  it('접힘 상태 토글(guestOpen) 상태와 헤더 버튼이 있다', () => {
    expect(hub).toMatch(/const \[guestOpen, setGuestOpen\] = useState\(false\)/);
    expect(hub).toMatch(/setGuestOpen\(\(v\) => !v\)/);
    expect(hub).toMatch(/aria-expanded=\{guestOpen\}/);
  });
  it('펴진 상태에서만 입력 영역이 렌더된다', () => {
    expect(hub).toMatch(/\{guestOpen && \(</);
  });
  it('접힌 상태에서도 입력 요약을 보여준다', () => {
    expect(hub).toMatch(/!guestOpen && virtualMember/);
  });
});

// ── [3] 볼륨 카드 제거 ──
describe('[2607-3] 홈의 사운드 볼륨 카드 제거', () => {
  const hub = read('ai-measure/AiMeasureHub.jsx');
  it('허브에서 SoundVolumeControl 렌더·임포트가 모두 제거되었다', () => {
    expect(hub).not.toContain('<SoundVolumeControl');
    expect(hub).not.toContain("import SoundVolumeControl");
  });
  it('볼륨 조절 경로는 초시계 탭에 남아 있다(완전 삭제 아님)', () => {
    expect(read('ai-measure/menus/TimerTool.jsx')).toContain('<SoundVolumeControl');
  });
});

// ── [6] 스켈레톤 모드 ON/OFF ──
describe('[2607-6] 스켈레톤 오버레이 전역 토글', () => {
  beforeEach(() => setSkeletonEnabled(true));

  it('기본값 ON, set/get/subscribe 가 동작한다', () => {
    expect(isSkeletonEnabled()).toBe(true);
    let notified = null;
    const off = subscribeSkeleton((v) => { notified = v; });
    setSkeletonEnabled(false);
    expect(isSkeletonEnabled()).toBe(false);
    expect(notified).toBe(false);
    off();
    setSkeletonEnabled(true);
    // 해제 후에는 더 이상 통지되지 않음
    expect(notified).toBe(false);
  });

  it('공통 토글 칩 컴포넌트가 있고 전역 훅을 쓴다', () => {
    const chip = read('ai-measure/menus/SkeletonToggleChip.jsx');
    expect(chip).toMatch(/useSkeletonOverlay/);
    expect(chip).toMatch(/스켈레톤/);
  });

  it('CameraStage 가 토글 칩을 옵션으로 렌더한다', () => {
    const cam = read('ai-measure/menus/CameraStage.jsx');
    expect(cam).toMatch(/showSkeletonToggle/);
    expect(cam).toMatch(/<SkeletonToggleChip/);
  });

  it('자세·ROM 카메라가 토글을 노출한다', () => {
    expect(read('ai-measure/menus/PostureMeasure.jsx')).toMatch(/showSkeletonToggle/);
    expect(read('ai-measure/menus/RomMeasure.jsx')).toMatch(/showSkeletonToggle/);
  });

  it('보행·점프는 자체 헤더에 토글 칩을 직접 배치한다', () => {
    expect(read('ai-measure/menus/GaitRunningAnalysis.jsx')).toMatch(/<SkeletonToggleChip/);
    expect(read('ai-measure/menus/JumpPrecisionAnalysis.jsx')).toMatch(/<SkeletonToggleChip/);
  });

  it('모든 스켈레톤 draw 가 OFF 시 그리지 않고 추적은 유지한다', () => {
    for (const f of [
      'ai-measure/menus/PostureMeasure.jsx',
      'ai-measure/menus/RomMeasure.jsx',
      'ai-measure/menus/GaitRunningAnalysis.jsx',
      'ai-measure/menus/JumpPrecisionAnalysis.jsx',
    ]) {
      expect(read(f), `${f} 에 isSkeletonEnabled 가드 없음`).toMatch(/if \(!isSkeletonEnabled\(\)\) return;/);
    }
  });

  it('ROM 녹화 합성 영상도 OFF 시 스켈레톤을 굽지 않는다', () => {
    const rom = read('ai-measure/menus/RomMeasure.jsx');
    // drawSkeletonToRecord 내부에 가드 존재
    const idx = rom.indexOf('function drawSkeletonToRecord');
    expect(idx).toBeGreaterThan(-1);
    expect(rom.slice(idx, idx + 400)).toMatch(/isSkeletonEnabled\(\)/);
  });
});
