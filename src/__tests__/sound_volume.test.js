// src/__tests__/sound_volume.test.js
// ════════════════════════════════════════════════════════════════════════
//  측정 사운드 — 마스터 볼륨(2.5× 부스트 + 0~100% 조절) 검증.
//   · boostedGain: 부스트 반영, 1.0 클리핑 상한, 음소거(0) 처리
//   · get/set/subscribe: 전역 상태 + 저장 + 구독 통지
//   · 모든 측정 화면이 boostedGain 을 경유하는지(정적 배선)
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  boostedGain, getSoundVolume, setSoundVolume, subscribeSoundVolume,
} from '../ai-measure/core/audioCue';

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');

describe('boostedGain — 2.5배 부스트 + 볼륨 + 클리핑', () => {
  beforeEach(() => setSoundVolume(1));

  it('100% 볼륨에서 기준 게인의 2.5배(단, 1.0 상한)', () => {
    expect(boostedGain(0.3)).toBeCloseTo(0.75, 5);   // 0.3×2.5 = 0.75
    expect(boostedGain(0.5)).toBe(1);                 // 0.5×2.5 = 1.25 → 클램프 1.0
    expect(boostedGain(0.18)).toBeCloseTo(0.45, 5);   // 카운트다운 틱도 또렷해짐
  });

  it('볼륨 50%면 절반, 0%(음소거)면 무음', () => {
    setSoundVolume(0.5);
    expect(boostedGain(0.3)).toBeCloseTo(0.375, 5);
    setSoundVolume(0);
    expect(boostedGain(0.4)).toBe(0);
  });

  it('부스트로 기존보다 확실히 커진다(같은 기준 게인 비교)', () => {
    setSoundVolume(1);
    // 기존 로직은 base 를 그대로 썼다. 부스트 후에는 최소 2배 이상.
    const base = 0.2;
    expect(boostedGain(base)).toBeGreaterThanOrEqual(base * 2);
  });
});

describe('볼륨 상태 — get/set/subscribe', () => {
  it('set 후 get 이 일치하고, 범위를 벗어나면 클램프', () => {
    setSoundVolume(0.7);
    expect(getSoundVolume()).toBe(0.7);
    setSoundVolume(5);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(-1);
    expect(getSoundVolume()).toBe(0);
  });

  it('구독자에게 변경이 통지되고, 해제하면 더 이상 안 온다', () => {
    const fn = vi.fn();
    const off = subscribeSoundVolume(fn);
    setSoundVolume(0.4);
    expect(fn).toHaveBeenCalledWith(0.4);
    off();
    setSoundVolume(0.9);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('모든 측정 사운드가 부스트를 경유하는지(정적 배선)', () => {
  const files = {
    TimerTool: 'ai-measure/menus/TimerTool.jsx',
    RecordMeasure: 'ai-measure/menus/RecordMeasure.jsx',
    GaitRunning: 'ai-measure/menus/GaitRunningAnalysis.jsx',
  };
  for (const [name, f] of Object.entries(files)) {
    it(`${name} 의 게인 설정이 boostedGain 을 쓴다`, () => {
      const src = read(f);
      expect(src).toContain('boostedGain(');
      // 부스트를 우회하는 원시 setValueAtTime(0.x, ...) 잔존 금지
      expect(src).not.toMatch(/gain\.setValueAtTime\(0\.\d+,/);
    });
  }

  it('audioCue 자체 톤도 부스트를 적용한다', () => {
    const src = read('ai-measure/core/audioCue.js');
    expect(src).toContain('boostedGain(gain)');
  });

  it('VBT·1RM은 렙 증가 시 beepRep 을 울린다', () => {
    for (const f of ['ai-measure/menus/VbtMeasure.jsx', 'ai-measure/menus/OneRMEstimate.jsx']) {
      const src = read(f);
      expect(src).toContain('beepRep()');
      expect(src).toContain('lv.reps > prev');
    }
  });

  it('[2607-3] AI측정 홈의 볼륨 카드는 제거되고, 초시계 탭에서 계속 조절한다', () => {
    // 홈(허브)에서는 볼륨 카드 제거 — 미등록회원 신체정보 아래 불필요 UI 정리
    expect(read('ai-measure/AiMeasureHub.jsx')).not.toContain('<SoundVolumeControl');
    // 볼륨 조절 경로 자체는 유지: 초시계·메트로놈 탭
    expect(read('ai-measure/menus/TimerTool.jsx')).toContain('<SoundVolumeControl');
  });
});
