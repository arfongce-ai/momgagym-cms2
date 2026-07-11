// interval_whistle.test.js
//  · [7·8] REC/TMR 인터벌 초 종료 시 크게 휘슬.
//    - audioCue.whistle() 합성이 Web Audio 노드를 만들고 재생하는지(모킹)
//    - RecordMeasure/TimerTool 이 구간 종료(left<=0) 지점에서 whistle 을 호출하는지(배선)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ── Web Audio 모의 컨텍스트 ──
function installMockAudio() {
  const created = { oscillators: 0, gains: 0, starts: 0, connects: 0 };
  class FakeParam { constructor() { this.value = 0; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
  class FakeOsc {
    constructor() { this.frequency = new FakeParam(); this.type = 'sine'; created.oscillators++; }
    connect() { created.connects++; return this; }
    start() { created.starts++; }
    stop() {}
  }
  class FakeGain {
    constructor() { this.gain = new FakeParam(); created.gains++; }
    connect() { created.connects++; return this; }
  }
  class FakeCtx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return new FakeOsc(); }
    createGain() { return new FakeGain(); }
    resume() { this.state = 'running'; }
  }
  globalThis.window = globalThis.window || {};
  globalThis.window.AudioContext = FakeCtx;
  globalThis.window.webkitAudioContext = FakeCtx;
  return created;
}

describe('audioCue.whistle — 크고 또렷한 인터벌 휘슬', () => {
  beforeEach(() => { vi.resetModules(); });

  it('오실레이터/게인을 만들고 재생을 시작한다(두 번 끊어 불기)', async () => {
    const created = installMockAudio();
    const mod = await import('../ai-measure/core/audioCue.js');
    mod.setSoundVolume(1);
    mod.primeAudio();
    mod.whistle();
    // 두 번의 blast × (톤 osc + 트릴 osc) = 4개 이상 오실레이터, 각 blast 마다 gain
    expect(created.oscillators).toBeGreaterThanOrEqual(4);
    expect(created.gains).toBeGreaterThanOrEqual(2);
    expect(created.starts).toBeGreaterThanOrEqual(4);
  });

  it('음소거(볼륨 0)면 소리를 만들지 않는다', async () => {
    const created = installMockAudio();
    const mod = await import('../ai-measure/core/audioCue.js');
    mod.setSoundVolume(0);
    mod.whistle();
    expect(created.oscillators).toBe(0);
    mod.setSoundVolume(1); // 원복
  });
});

describe('[7·8] REC/TMR 인터벌 종료 배선', () => {
  it('TimerTool 이 인터벌 구간 종료 지점에서 whistle 을 호출한다', () => {
    const src = read('ai-measure/menus/TimerTool.jsx');
    expect(src).toContain("import { boostedGain, whistle, primeAudio }");
    // 인터벌 tick 의 left<=0 블록(advance 로 다음 구간 진행)에서 whistle
    const clean = src.replace(/\r/g, '');
    const idx = clean.indexOf('lastTickRef.current = -1;\n      whistle();');
    expect(idx).toBeGreaterThan(-1);
    const seg = clean.slice(idx, idx + 120);
    expect(seg.indexOf('whistle()')).toBeLessThan(seg.indexOf('advance()'));
  });

  it('RecordMeasure(REC) 도 인터벌 구간 종료 지점에서 whistle 을 호출한다', () => {
    const src = read('ai-measure/menus/RecordMeasure.jsx');
    expect(src).toContain("import { boostedGain, whistle, primeAudio }");
    const clean = src.replace(/\r/g, '');
    const idx = clean.indexOf('lastTickRef.current = -1;\n      whistle();');
    expect(idx).toBeGreaterThan(-1);
    const seg = clean.slice(idx, idx + 120);
    expect(seg.indexOf('whistle()')).toBeLessThan(seg.indexOf('advance()'));
  });

  it('시작 버튼에서 오디오 컨텍스트를 프라임한다(정책 대응)', () => {
    expect(read('ai-measure/menus/TimerTool.jsx')).toContain('primeAudio();');
    expect(read('ai-measure/menus/RecordMeasure.jsx')).toContain('primeAudio();');
  });
});
